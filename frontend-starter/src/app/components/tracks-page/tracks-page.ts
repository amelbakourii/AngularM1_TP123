import { Component, computed, DestroyRef, ElementRef, inject, Injectable, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatPaginator, MatPaginatorIntl, PageEvent } from '@angular/material/paginator';
import { MatSnackBar } from '@angular/material/snack-bar';
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

/** États possibles de l'envoi d'un fichier. */
type UploadState = 'idle' | 'uploading' | 'success' | 'error';

/** Tailles de page proposées : le backend plafonne `limit` à 20. */
const PAGE_SIZE_OPTIONS = [5, 10, 20];

/** Libellés français du mat-paginator (anglais par défaut). */
@Injectable()
export class FrenchPaginatorIntl extends MatPaginatorIntl {
  override itemsPerPageLabel = 'Pistes par page :';
  override nextPageLabel = 'Page suivante';
  override previousPageLabel = 'Page précédente';
  override firstPageLabel = 'Première page';
  override lastPageLabel = 'Dernière page';

  /** « Pistes 6 à 9 sur 9 · page 2 sur 2 » ; page est en base 0. */
  override getRangeLabel = (page: number, pageSize: number, length: number): string => {
    if (length === 0) return 'Aucune piste';
    const start = page * pageSize + 1;
    const end = Math.min(start + pageSize - 1, length);
    const pages = Math.ceil(length / pageSize);
    const range = start === end ? `Piste ${start} sur ${length}` : `Pistes ${start} à ${end} sur ${length}`;
    return `${range} · page ${page + 1} sur ${pages}`;
  };
}

/** Bibliothèque audio : liste paginée, upload, lecture et suppression. */
@Component({
  imports: [ReactiveFormsModule, DatePipe, MatPaginator],
  // Fourni ici et non dans app.config : seuls les paginators de cette page sont concernés.
  providers: [{ provide: MatPaginatorIntl, useClass: FrenchPaginatorIntl }],
  templateUrl: './tracks-page.html',
  styleUrl: './tracks-page.css',
})
export class TracksPageComponent {
  private readonly service = inject(TrackService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly snackBar = inject(MatSnackBar);
  // Référence au champ <input type="file"> du template (#fileInput).
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');
  // Élément <audio> du lecteur fixe (absent tant qu'aucun morceau n'est chargé).
  private readonly audioElement = viewChild<ElementRef<HTMLAudioElement>>('audio');

  // Liste paginée. `page` reste en base 1 comme le backend ; le paginator reçoit page() - 1.
  readonly tracks = signal<Track[]>([]);
  readonly page = signal(1);
  readonly limit = signal(5);
  readonly pages = signal(1);
  // Nombre total de pistes : le paginator en déduit le nombre de pages et « x – y sur total ».
  readonly total = signal(0);
  readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  // Formulaire d'upload.
  readonly title = new FormControl('', { nonNullable: true });
  readonly file = signal<File | null>(null);
  readonly uploadState = signal<UploadState>('idle');
  // Pourcentage envoyé (0-100), ou null si le navigateur ne connaît pas la taille totale.
  readonly uploadProgress = signal<number | null>(null);
  // Message de réussite ou d'erreur, affiché selon uploadState.
  readonly uploadMessage = signal<string | null>(null);
  readonly uploading = computed(() => this.uploadState() === 'uploading');

  // Lecteur audio.
  readonly audioUrl = signal('');
  readonly currentTrack = signal<Track | null>(null);
  readonly audioLoading = signal(false);
  readonly audioError = signal<string | null>(null);
  // État du lecteur, mis à jour par les événements de l'élément <audio>.
  readonly playing = signal(false);
  readonly currentTime = signal(0);
  readonly duration = signal(0);
  readonly volume = signal(1);
  readonly muted = signal(false);

  // Suppression : id de la piste en cours de suppression (null = aucune).
  readonly deletingId = signal<string | null>(null);

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
    this.uploadState.set('idle');
    this.uploadMessage.set(null);
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
    this.service.list(this.page(), this.limit()).subscribe({
      next: (response) => {
        console.debug('[TracksPage] Pistes chargées', response.items.length);
        this.pages.set(response.pages);
        this.total.set(response.total);
        // Le serveur fait foi : un limit au-delà de 20 aurait été ramené à 20.
        this.limit.set(response.limit);
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

  /**
   * Événement (page) du mat-paginator : nouvelle requête HTTP à chaque changement de page ou de taille.
   * pageIndex est en base 0, le backend attend une page en base 1.
   */
  onPage(event: PageEvent): void {
    this.limit.set(event.pageSize);
    this.page.set(event.pageIndex + 1);
    this.load();
  }

  /** POST /api/tracks : envoi du fichier sélectionné. */
  upload(): void {
    // 1. Aucun fichier ou envoi déjà en cours : pas de double soumission.
    const file = this.file();
    if (!file || this.uploading()) return;

    // 2. Début de l'envoi : état « uploading », messages effacés, champ titre bloqué.
    // Un titre fait d'espaces deviendrait vide après le trim de Mongoose et provoquerait un 400.
    const title = this.title.value.trim() || file.name;
    this.uploadState.set('uploading');
    this.uploadProgress.set(0);
    this.uploadMessage.set(null);
    this.title.disable();
    console.debug('[TracksPage] Envoi démarré', file.name);

    this.service.upload(file, title).subscribe({
      // 3. Chaque événement HTTP : seuls la progression et la réponse finale nous intéressent.
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress) {
          // total absent (taille inconnue du navigateur) : barre sans pourcentage.
          this.uploadProgress.set(event.total ? Math.round((100 * event.loaded) / event.total) : null);
        } else if (event.type === HttpEventType.Response) {
          // 4a. Réponse 201 : réussite, formulaire vidé, retour à la page 1 pour voir la nouvelle piste.
          console.debug('[TracksPage] Envoi terminé', event.status, file.name);
          this.uploadState.set('success');
          this.uploadMessage.set(`« ${event.body?.title ?? title} » a bien été ajouté.`);
          this.title.enable();
          this.title.setValue('');
          this.clearFile();
          this.page.set(1);
          this.load();
        }
      },
      // 4b. Échec : message selon le statut. Seuls le statut et le nom du fichier sont journalisés.
      error: (error: unknown) => {
        const status = error instanceof HttpErrorResponse ? error.status : 0;
        console.error('[TracksPage] Envoi impossible', status, file.name);
        this.uploadState.set('error');
        this.uploadMessage.set(this.uploadErrorMessage(error, status));
        this.title.enable();
      },
    });
  }

  /** Message d'échec de l'upload selon le statut HTTP. */
  private uploadErrorMessage(error: unknown, status: number): string {
    switch (status) {
      case 0:
        return 'Serveur injoignable. Vérifiez que le backend est lancé.';
      case 400:
        // Multer refuse un fichier de plus de 25 Mo avec un 400 « File too large » (pas un 413).
        if (this.serverMessage(error, '') === 'File too large') return 'Fichier trop volumineux : 25 Mo maximum.';
        return `Fichier refusé : ${this.serverMessage(error, 'format non accepté')}.`;
      case 401:
        return 'Session expirée. Reconnectez-vous.';
      case 413:
        return 'Fichier trop volumineux : 25 Mo maximum.';
      default:
        return 'Envoi impossible. Réessayez.';
    }
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
          this.currentTime.set(0);
          this.duration.set(0);
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

  /** Bouton d'une carte : pause/reprise si c'est le morceau en cours, sinon téléchargement et lecture. */
  playOrToggle(track: Track): void {
    if (this.currentTrack()?.id === track.id && this.audioUrl()) {
      this.togglePlay();
    } else {
      this.play(track);
    }
  }

  /** Lecture / pause du morceau chargé. */
  togglePlay(): void {
    const audio = this.audioElement()?.nativeElement;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => this.playing.set(false));
    } else {
      audio.pause();
    }
  }

  /** Avance ou recule de quelques secondes, sans sortir des bornes du morceau. */
  skip(seconds: number): void {
    const audio = this.audioElement()?.nativeElement;
    if (!audio) return;
    audio.currentTime = Math.min(Math.max(0, audio.currentTime + seconds), audio.duration || 0);
  }

  /** Curseur de position : déplacement dans le morceau. */
  seek(event: Event): void {
    const audio = this.audioElement()?.nativeElement;
    if (!audio) return;
    audio.currentTime = Number((event.target as HTMLInputElement).value);
    this.currentTime.set(audio.currentTime);
  }

  /** Curseur de volume : un réglage au-dessus de 0 réactive le son. */
  changeVolume(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.volume.set(value);
    this.muted.set(value === 0);
    this.applyVolume();
  }

  toggleMute(): void {
    this.muted.update((muted) => !muted);
    // Réactiver le son à volume nul n'aurait aucun effet : retour à un niveau audible.
    if (!this.muted() && this.volume() === 0) this.volume.set(0.5);
    this.applyVolume();
  }

  onTimeUpdate(): void {
    const audio = this.audioElement()?.nativeElement;
    if (audio) this.currentTime.set(audio.currentTime);
  }

  /** Métadonnées chargées : durée connue, réglages de volume appliqués au nouvel élément. */
  onMetadata(): void {
    const audio = this.audioElement()?.nativeElement;
    if (!audio) return;
    this.duration.set(Number.isFinite(audio.duration) ? audio.duration : 0);
    this.applyVolume();
  }

  /** Secondes → m:ss. */
  formatTime(seconds: number): string {
    const total = Math.floor(seconds || 0);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  private applyVolume(): void {
    const audio = this.audioElement()?.nativeElement;
    if (!audio) return;
    audio.volume = this.volume();
    audio.muted = this.muted();
  }

  /** DELETE /api/tracks/:id après confirmation, puis rechargement de la page courante. */
  remove(track: Track): void {
    // 1. Une seule suppression à la fois : pas de double clic ni de rechargements croisés.
    if (this.deletingId() !== null) return;
    // 2. Confirmation : annuler n'envoie aucune requête.
    if (!confirm(`Supprimer définitivement « ${track.title} » ?`)) return;

    // 3. Début de la suppression : bouton désactivé, libellé « Suppression… ».
    this.deletingId.set(track.id);
    this.service.deleteTrack(track.id).subscribe({
      // 4a. 204 : piste supprimée côté serveur.
      next: () => {
        console.debug('[TracksPage] Piste supprimée', track.id);
        this.deletingId.set(null);
        this.snackBar.open(`« ${track.title} » a été supprimée.`, 'Fermer', { duration: 4000 });
        this.afterRemoval(track);
      },
      // 4b. Échec : message selon le statut HTTP.
      error: (error) => {
        console.error('[TracksPage] Suppression impossible', error);
        this.deletingId.set(null);
        const status = error instanceof HttpErrorResponse ? error.status : 0;
        if (status === 404) {
          // Déjà supprimée (autre onglet) ou piste d'un autre compte : le backend ne distingue pas
          // les deux cas. Pour cet utilisateur la piste n'existe plus : elle doit quitter l'écran.
          this.snackBar.open('Cette piste n’existe plus ou ne vous appartient pas.', 'Fermer', { duration: 5000 });
          this.afterRemoval(track);
        } else if (status === 401) {
          // L'intercepteur a déjà vidé la session et redirigé vers /login.
          this.snackBar.open('Session expirée. Reconnectez-vous.', 'Fermer', { duration: 5000 });
        } else {
          // Serveur injoignable ou erreur serveur : la liste reste affichée pour pouvoir réessayer.
          this.snackBar.open('Suppression impossible. Réessayez plus tard.', 'Fermer', { duration: 5000 });
        }
      },
    });
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

  /** Piste absente du serveur : arrêt du lecteur si besoin, puis rechargement de la page. */
  private afterRemoval(track: Track): void {
    if (this.currentTrack()?.id === track.id) this.stopPlayer();
    // Dernière piste de la page (hors page 1) : la page deviendrait vide, on recule d'une page.
    if (this.tracks().length === 1 && this.page() > 1) this.page.update((page) => page - 1);
    this.load();
  }

  /** Arrête le lecteur et libère l'ObjectURL du morceau. */
  private stopPlayer(): void {
    const url = this.audioUrl();
    if (url) URL.revokeObjectURL(url);
    this.audioUrl.set('');
    this.currentTrack.set(null);
    this.audioError.set(null);
    this.playing.set(false);
  }

  /** Fichier refusé : message d'erreur et sélection annulée. */
  private rejectFile(message: string): void {
    this.uploadState.set('error');
    this.uploadMessage.set(message);
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
