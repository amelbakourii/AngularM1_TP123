import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Page } from '../../shared/models/page.model';
import { Track } from '../../shared/models/track.model';
import { FrenchPaginatorIntl, TracksPageComponent } from './tracks-page';

const trackA: Track = {
  id: 'a1',
  title: 'Blues en La',
  originalName: 'blues.mp3',
  mimeType: 'audio/mpeg',
  size: 2048,
  createdAt: '2026-10-01T10:00:00.000Z',
};

const trackB: Track = {
  id: 'b2',
  title: 'Funk en Mi',
  originalName: 'funk.wav',
  mimeType: 'audio/wav',
  size: 4096,
  createdAt: '2026-10-02T10:00:00.000Z',
};

/** Page simulée renvoyée à la place du backend ; overrides pour simuler plusieurs pages. */
function fakePage(items: Track[], overrides: Partial<Page<Track>> = {}): Page<Track> {
  return { items, page: 1, limit: 5, total: items.length, pages: 1, ...overrides };
}

describe('TracksPageComponent', () => {
  let fixture: ComponentFixture<TracksPageComponent>;
  let component: TracksPageComponent;
  let httpMock: HttpTestingController;
  // MatSnackBar remplacé par un espion : aucun affichage réel, seuls les appels sont vérifiés.
  const snackBarMock = { open: vi.fn<MatSnackBar['open']>() };

  beforeEach(() => {
    snackBarMock.open.mockReset();
    TestBed.configureTestingModule({
      imports: [TracksPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MatSnackBar, useValue: snackBarMock },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);

    // Le constructeur appelle load() : réponse au premier GET avant chaque test.
    fixture = TestBed.createComponent(TracksPageComponent);
    component = fixture.componentInstance;
    // Premier rendu : résout viewChild.required('fileInput'), utilisé après un upload réussi.
    fixture.detectChanges();
    httpMock.expectOne('/api/tracks?page=1&limit=5').flush(fakePage([trackA, trackB]));
    expect(component.tracks()).toEqual([trackA, trackB]);
  });

  afterEach(() => {
    httpMock.verify();
    vi.restoreAllMocks();
  });

  describe('suppression', () => {
    it('après confirmation : DELETE /api/tracks/:id, snackbar, puis rechargement de la liste', () => {
      const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);

      component.remove(trackA);

      expect(confirmSpy).toHaveBeenCalledWith(`Supprimer définitivement « ${trackA.title} » ?`);
      // Pendant la requête : la piste est marquée « en cours de suppression ».
      expect(component.deletingId()).toBe(trackA.id);
      fixture.detectChanges();
      const deleteButton: HTMLButtonElement | null = fixture.nativeElement.querySelector('button.delete');
      expect(deleteButton?.textContent?.trim()).toBe('Suppression…');

      const req = httpMock.expectOne({ method: 'DELETE', url: `/api/tracks/${trackA.id}` });
      expect(req.request.body).toBeNull();
      req.flush(null, { status: 204, statusText: 'No Content' });

      expect(component.deletingId()).toBeNull();
      expect(snackBarMock.open).toHaveBeenCalledWith(`« ${trackA.title} » a été supprimée.`, 'Fermer', {
        duration: 4000,
      });

      // Rechargement de la page courante.
      const reload = httpMock.expectOne('/api/tracks?page=1&limit=5');
      expect(reload.request.method).toBe('GET');
      reload.flush(fakePage([trackB]));
      expect(component.tracks()).toEqual([trackB]);
    });

    it('annulée : aucune requête, aucun état modifié', () => {
      const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);

      component.remove(trackA);

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      httpMock.expectNone({ method: 'DELETE' });
      httpMock.expectNone('/api/tracks?page=1&limit=5');
      expect(component.deletingId()).toBeNull();
      expect(snackBarMock.open).not.toHaveBeenCalled();
      expect(component.tracks()).toEqual([trackA, trackB]);
    });

    it('dernière piste d’une page > 1 : recharge la page précédente avec la même taille', () => {
      vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
      component.onPage({ pageIndex: 1, pageSize: 10, previousPageIndex: 0, length: 11 });
      httpMock
        .expectOne('/api/tracks?page=2&limit=10')
        .flush(fakePage([trackA], { page: 2, limit: 10, total: 11, pages: 2 }));

      component.remove(trackA);
      httpMock
        .expectOne({ method: 'DELETE', url: `/api/tracks/${trackA.id}` })
        .flush(null, { status: 204, statusText: 'No Content' });

      httpMock.expectOne('/api/tracks?page=1&limit=10').flush(fakePage([trackB], { limit: 10, total: 10 }));
      expect(component.page()).toBe(1);
      expect(component.limit()).toBe(10);
    });
  });

  describe('pagination (mat-paginator)', () => {
    /** Bouton de navigation du paginator (first, previous, next, last). */
    function navButton(name: string): HTMLButtonElement {
      return fixture.nativeElement.querySelector(`.mat-mdc-paginator-navigation-${name}`);
    }

    function rangeLabel(): string {
      return fixture.nativeElement.querySelector('.mat-mdc-paginator-range-label').textContent.trim();
    }

    /** Recharge la page 1 avec 12 pistes au total (3 pages de 5). */
    function loadTwelveTracks(): void {
      component.load();
      httpMock.expectOne('/api/tracks?page=1&limit=5').flush(fakePage([trackA, trackB], { total: 12, pages: 3 }));
      fixture.detectChanges();
    }

    it('clic sur « Page suivante » : une seule requête ?page=2 (pageIndex 1 → page 2)', () => {
      loadTwelveTracks();
      expect(rangeLabel()).toBe('Pistes 1 à 5 sur 12 · page 1 sur 3');

      navButton('next').click();

      httpMock
        .expectOne('/api/tracks?page=2&limit=5')
        .flush(fakePage([trackB], { page: 2, total: 12, pages: 3 }));
      expect(component.page()).toBe(2);
      fixture.detectChanges();
      expect(rangeLabel()).toBe('Pistes 6 à 10 sur 12 · page 2 sur 3');
    });

    it('changement de taille de page : requête avec le nouveau limit', () => {
      component.onPage({ pageIndex: 0, pageSize: 10, previousPageIndex: 0, length: 2 });

      httpMock.expectOne('/api/tracks?page=1&limit=10').flush(fakePage([trackA, trackB], { limit: 10 }));
      expect(component.page()).toBe(1);
      expect(component.limit()).toBe(10);
    });

    it('reprend total et limit de la réponse (limit plafonné à 20 par le backend)', () => {
      component.limit.set(50);
      component.load();

      httpMock.expectOne('/api/tracks?page=1&limit=50').flush(fakePage([trackA], { limit: 20, total: 30, pages: 2 }));
      expect(component.limit()).toBe(20);
      expect(component.total()).toBe(30);
    });

    it('désactivé pendant le chargement : un clic n’envoie aucune requête', () => {
      loadTwelveTracks();
      expect(navButton('next').getAttribute('aria-disabled')).not.toBe('true');

      // Actualisation en cours : la requête n'est pas encore résolue.
      component.load();
      fixture.detectChanges();
      expect(navButton('next').getAttribute('aria-disabled')).toBe('true');

      navButton('next').click();
      httpMock.expectNone('/api/tracks?page=2&limit=5');

      httpMock.expectOne('/api/tracks?page=1&limit=5').flush(fakePage([trackA, trackB], { total: 12, pages: 3 }));
      fixture.detectChanges();
      expect(navButton('next').getAttribute('aria-disabled')).not.toBe('true');
    });

    it('page au-delà du nombre de pages : recharge la dernière page', () => {
      component.onPage({ pageIndex: 2, pageSize: 5, previousPageIndex: 1, length: 12 });

      // Des pistes ont été supprimées entre-temps : il n'y a plus que 2 pages.
      httpMock.expectOne('/api/tracks?page=3&limit=5').flush(fakePage([], { page: 3, total: 10, pages: 2 }));
      expect(component.loading()).toBe(true);

      httpMock
        .expectOne('/api/tracks?page=2&limit=5')
        .flush(fakePage([trackA, trackB], { page: 2, total: 10, pages: 2 }));
      expect(component.page()).toBe(2);
      expect(component.tracks()).toEqual([trackA, trackB]);
      expect(component.loading()).toBe(false);
    });

    it('affiche les libellés français (MatPaginatorIntl)', () => {
      const intl = new FrenchPaginatorIntl();
      expect(intl.getRangeLabel(1, 5, 23)).toBe('Pistes 6 à 10 sur 23 · page 2 sur 5');
      expect(intl.getRangeLabel(4, 5, 23)).toBe('Pistes 21 à 23 sur 23 · page 5 sur 5');
      expect(intl.getRangeLabel(0, 5, 0)).toBe('Aucune piste');
      expect(intl.getRangeLabel(1, 5, 6)).toBe('Piste 6 sur 6 · page 2 sur 2');
      expect(intl.getRangeLabel(1, 5, 9)).toBe('Pistes 6 à 9 sur 9 · page 2 sur 2');

      expect(navButton('next').getAttribute('aria-label')).toBe('Page suivante');
      expect(navButton('first').getAttribute('aria-label')).toBe('Première page');
      expect(fixture.nativeElement.querySelector('.mat-mdc-paginator-page-size-label').textContent.trim()).toBe(
        'Pistes par page :',
      );
    });
  });

  describe('upload', () => {
    const file = new File(['abc'], 'demo.mp3', { type: 'audio/mpeg' });

    beforeEach(() => {
      component.file.set(file);
      component.title.setValue('Démo');
    });

    it('met à jour la progression (UploadProgress) puis passe en succès (Response)', () => {
      component.upload();

      expect(component.uploadState()).toBe('uploading');
      expect(component.uploadProgress()).toBe(0);
      expect(component.title.disabled).toBe(true);

      const req = httpMock.expectOne({ method: 'POST', url: '/api/tracks' });
      expect(req.request.reportProgress).toBe(true);
      const body = req.request.body;
      expect(body).toBeInstanceOf(FormData);
      if (!(body instanceof FormData)) return;
      expect(body.get('title')).toBe('Démo');
      const audio = body.get('audio');
      expect(audio).toBeInstanceOf(File);
      expect(audio instanceof File ? audio.name : null).toBe('demo.mp3');

      // Progression : 50 octets envoyés sur 100.
      req.event({ type: HttpEventType.UploadProgress, loaded: 50, total: 100 });
      expect(component.uploadProgress()).toBe(50);
      expect(component.uploadState()).toBe('uploading');

      // Taille totale inconnue : progression indéterminée.
      req.event({ type: HttpEventType.UploadProgress, loaded: 80 });
      expect(component.uploadProgress()).toBeNull();

      // Réponse 201 (événement Response).
      const created: Track = { ...trackA, id: 'n3', title: 'Démo', originalName: 'demo.mp3' };
      req.flush(created, { status: 201, statusText: 'Created' });

      expect(component.uploadState()).toBe('success');
      expect(component.uploadMessage()).toBe('« Démo » a bien été ajouté.');
      expect(component.title.enabled).toBe(true);
      expect(component.title.value).toBe('');
      expect(component.file()).toBeNull();

      // Retour à la page 1 pour afficher la nouvelle piste.
      httpMock.expectOne('/api/tracks?page=1&limit=5').flush(fakePage([created, trackA, trackB]));
      expect(component.page()).toBe(1);
    });

    it('passe en erreur sur un échec HTTP 400, sans recharger la liste', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      component.upload();
      httpMock
        .expectOne({ method: 'POST', url: '/api/tracks' })
        .flush({ message: 'Invalid file type' }, { status: 400, statusText: 'Bad Request' });

      expect(component.uploadState()).toBe('error');
      expect(component.uploadMessage()).toBe('Fichier refusé : Invalid file type.');
      expect(component.title.enabled).toBe(true);
      // Le fichier reste sélectionné pour pouvoir réessayer.
      expect(component.file()).toBe(file);
      httpMock.expectNone('/api/tracks?page=1&limit=5');
    });

    it('passe en erreur « serveur injoignable » sur une erreur réseau (statut 0)', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      component.upload();
      httpMock.expectOne({ method: 'POST', url: '/api/tracks' }).error(new ProgressEvent('error'));

      expect(component.uploadState()).toBe('error');
      expect(component.uploadMessage()).toBe('Serveur injoignable. Vérifiez que le backend est lancé.');
    });
  });
});
