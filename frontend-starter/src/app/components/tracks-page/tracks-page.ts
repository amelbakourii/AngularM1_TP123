import { Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Track } from '../../shared/models/track.model';
import { TrackService } from '../../shared/services/track.service';

/** Mêmes types MIME que la liste `allowed` du backend (backend/src/app.js). */
const ALLOWED_TYPES: Record<string, string> = {
  'audio/mpeg': 'MP3',
  'audio/wav': 'WAV',
  'audio/x-wav': 'WAV',
  'audio/ogg': 'OGG',
  'audio/mp4': 'M4A',
  'audio/x-m4a': 'M4A',
};

/** Même limite que MAX_FILE_SIZE dans le backend : 25 Mo. */
const MAX_SIZE = 25 * 1024 * 1024;

/** Bibliothèque audio : liste paginée, upload et lecture. */
@Component({
  imports: [ReactiveFormsModule, DatePipe],
  templateUrl: './tracks-page.html',
  styleUrl: './tracks-page.css',
})
export class TracksPageComponent {
  private readonly service = inject(TrackService);
  private readonly destroyRef = inject(DestroyRef);
  // Référence au champ <input type="file"> du template (#fileInput).
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  // Liste paginée.
  readonly tracks = signal<Track[]>([]);
  readonly page = signal(1);
  readonly pages = signal(1);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  // Formulaire d'upload.
  readonly title = new FormControl('', { nonNullable: true });
  readonly file = signal<File | null>(null);
  readonly uploading = signal(false);
  readonly uploadError = signal<string | null>(null);
  readonly uploadSuccess = signal<string | null>(null);

  // Lecteur audio.
  readonly audioUrl = signal('');
  readonly currentTrack = signal<Track | null>(null);
  readonly audioLoading = signal(false);
  readonly audioError = signal<string | null>(null);

  constructor() {
    // Chargement de la première page dès l'ouverture.
    this.load();
    // Libère l'audio téléchargé à la sortie de la page (ex. après une déconnexion).
    this.destroyRef.onDestroy(() => {
      const url = this.audioUrl();
      if (url) URL.revokeObjectURL(url);
    });
  }

  /** Sélection d'un fichier : vérifications locales avant tout envoi. */
  choose(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.uploadError.set(null);
    this.uploadSuccess.set(null);
    console.debug('[TracksPage] Fichier sélectionné', file?.name);

    // Ces contrôles évitent un aller-retour inutile ; le backend refait les siens.
    // Sans type, le navigateur enverrait application/octet-stream, que le backend refuse :
    // accepter le fichier d'après son extension mènerait donc à un 400.
    if (file && !file.type) {
      this.rejectFile('Type de fichier non reconnu par votre navigateur. Formats acceptés : MP3, WAV, OGG, M4A.');
      return;
    }
    // Format hors liste autorisée.
    if (file && !Object.hasOwn(ALLOWED_TYPES, file.type)) {
      this.rejectFile(`Format non accepté (${file.type || 'inconnu'}). Formats acceptés : MP3, WAV, OGG, M4A.`);
      return;
    }
    // Taille supérieure à 25 Mo.
    if (file && file.size > MAX_SIZE) {
      this.rejectFile(`Fichier trop volumineux (${this.formatSize(file.size)}). Taille maximale : 25 Mo.`);
      return;
    }
    // Fichier valide : bouton « Envoyer » activé.
    this.file.set(file);
  }

  /** GET /api/tracks pour la page courante uniquement (pagination côté serveur). */
  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.list(this.page()).subscribe({
      next: (response) => {
        console.debug('[TracksPage] Pistes chargées', response.items.length);
        this.pages.set(response.pages);
        // Page demandée inexistante (pistes supprimées entre-temps) : rechargement de la dernière.
        if (this.page() > response.pages) {
          this.page.set(response.pages);
          this.load();
          return;
        }
        this.tracks.set(response.items);
        this.loading.set(false);
      },
      error: (error) => {
        console.error('[TracksPage] Chargement impossible', error);
        this.tracks.set([]);
        this.error.set('Impossible de charger les pistes.');
        this.loading.set(false);
      },
    });
  }

  /** Boutons Précédent / Suivant : nouvelle requête HTTP à chaque changement de page. */
  go(page: number): void {
    if (page < 1 || page > this.pages()) return;
    this.page.set(page);
    this.load();
  }

  /** POST /api/tracks : envoi du fichier sélectionné. */
  upload(): void {
    // 1. Aucun fichier ou envoi déjà en cours : pas de double soumission.
    const file = this.file();
    if (!file || this.uploading()) return;

    // 2. Début de l'envoi, messages précédents effacés.
    this.uploading.set(true);
    this.uploadError.set(null);
    this.uploadSuccess.set(null);
    // Un titre fait d'espaces deviendrait vide après le trim de Mongoose et provoquerait un 400.
    this.service.upload(file, this.title.value.trim() || file.name).subscribe({
      // 3a. Succès : message, formulaire vidé, retour à la page 1 pour voir la nouvelle piste.
      next: (track) => {
        console.debug('[TracksPage] Piste envoyée', track.id);
        this.uploading.set(false);
        this.uploadSuccess.set(`« ${track.title} » a bien été ajouté.`);
        this.title.setValue('');
        this.clearFile();
        this.page.set(1);
        this.load();
      },
      // 3b. Échec : affichage du message du serveur.
      error: (error) => {
        console.error('[TracksPage] Envoi impossible', error);
        this.uploading.set(false);
        this.uploadError.set(this.serverMessage(error, 'Envoi impossible. Réessayez.'));
      },
    });
  }

  /**
   * Lecture authentifiée : téléchargement du Blob via HttpClient (JWT ajouté par l'intercepteur),
   * puis création d'une ObjectURL donnée au lecteur <audio>.
   */
  play(track: Track): void {
    // Un seul téléchargement à la fois.
    if (this.audioLoading()) return;

    this.audioLoading.set(true);
    this.audioError.set(null);
    this.service
      .audio(track.id)
      // Évite de créer une ObjectURL jamais révoquée si la page est quittée pendant le téléchargement.
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          console.debug('[TracksPage] Audio chargé', track.id);
          // Libération de l'ancienne ObjectURL pour éviter une fuite mémoire.
          const previousUrl = this.audioUrl();
          if (previousUrl) URL.revokeObjectURL(previousUrl);
          // Adresse locale temporaire vers le Blob, lue par <audio [src]>.
          this.audioUrl.set(URL.createObjectURL(blob));
          this.currentTrack.set(track);
          this.audioLoading.set(false);
        },
        error: (error) => {
          console.error('[TracksPage] Lecture impossible', error);
          this.audioLoading.set(false);
          // Avec responseType 'blob', le corps d'erreur est un Blob : seul le statut est exploité.
          const status = error instanceof HttpErrorResponse ? error.status : 0;
          this.audioError.set(
            status === 404
              ? `« ${track.title} » est introuvable ou ne vous appartient pas.`
              : status === 0
                ? 'Serveur injoignable : impossible de télécharger le morceau.'
                : `Impossible de lire « ${track.title} ».`,
          );
        },
      });
  }

  /** Événement (error) du lecteur : fichier reçu mais non décodable par le navigateur. */
  audioFailed(): void {
    console.error('[TracksPage] Le navigateur ne peut pas décoder le fichier', this.currentTrack()?.id);
    this.audioError.set('Ce fichier audio ne peut pas être lu par votre navigateur.');
  }

  /** Type MIME → libellé court (audio/mpeg → MP3). */
  formatOf(mimeType: string): string {
    return Object.hasOwn(ALLOWED_TYPES, mimeType) ? ALLOWED_TYPES[mimeType] : mimeType;
  }

  /** Octets → taille lisible en Ko ou Mo. */
  formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
    return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
  }

  /** Fichier refusé : message d'erreur et sélection annulée. */
  private rejectFile(message: string): void {
    this.uploadError.set(message);
    this.clearFile();
  }

  private clearFile(): void {
    this.file.set(null);
    // Le signal ne suffit pas : le champ natif garderait le nom du fichier affiché.
    this.fileInput().nativeElement.value = '';
  }

  /** Message d'erreur du backend s'il existe, sinon message par défaut. */
  private serverMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) return 'Serveur injoignable. Vérifiez que le backend est lancé.';
      const message: unknown = error.error?.message;
      if (typeof message === 'string' && message) return message;
    }
    return fallback;
  }
}
