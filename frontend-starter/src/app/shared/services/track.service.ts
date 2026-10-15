import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Page } from '../models/page.model';
import { Track } from '../models/track.model';

/** Toutes les requêtes HTTP liées aux pistes audio. */
@Injectable({ providedIn: 'root' })
export class TrackService {
  private readonly http = inject(HttpClient);

  /** GET /api/tracks?page=..&limit=.. : une seule page de résultats, découpée par le serveur. */
  list(page = 1, limit = 5) {
    return this.http.get<Page<Track>>('/api/tracks', {
      params: { page, limit },
    });
  }

  /**
   * POST /api/tracks : envoi multipart avec les champs attendus par le backend.
   * observe: 'events' + reportProgress : l'Observable émet chaque étape (Sent, UploadProgress…)
   * et pas seulement la réponse finale, ce qui permet d'afficher la progression.
   */
  upload(file: File, title: string) {
    const body = new FormData();
    body.append('audio', file);
    body.append('title', title);
    return this.http.post<Track>('/api/tracks', body, {
      reportProgress: true,
      observe: 'events',
    });
  }

  /**
   * GET /api/tracks/:id/audio : téléchargement du fichier complet sous forme de Blob.
   * Passage par HttpClient pour que l'intercepteur ajoute le JWT.
   */
  audio(id: string) {
    return this.http.get(`/api/tracks/${id}/audio`, {
      responseType: 'blob',
    });
  }

  /**
   * DELETE /api/tracks/:id : réponse 204 sans corps.
   * Le backend ne supprime que si la piste appartient à l'utilisateur du JWT (sinon 404).
   */
  deleteTrack(id: string) {
    return this.http.delete<void>(`/api/tracks/${id}`);
  }
}
