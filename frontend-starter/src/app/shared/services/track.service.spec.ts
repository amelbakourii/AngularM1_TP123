import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Page } from '../models/page.model';
import { Track } from '../models/track.model';
import { TrackService } from './track.service';

/** Page simulée : aucune donnée ne vient du backend ni de MongoDB. */
function fakePage(page: number, limit: number): Page<Track> {
  return {
    items: [
      {
        id: 't1',
        title: 'Blues en La',
        originalName: 'blues.mp3',
        mimeType: 'audio/mpeg',
        size: 2048,
        createdAt: '2026-10-01T10:00:00.000Z',
      },
    ],
    page,
    limit,
    total: 12,
    pages: 2,
  };
}

describe('TrackService', () => {
  let service: TrackService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TrackService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  // Aucune requête inattendue ou restée sans réponse.
  afterEach(() => httpMock.verify());

  it('list(2, 10) envoie GET /api/tracks avec page=2 et limit=10', () => {
    const expected = fakePage(2, 10);
    let result: Page<Track> | undefined;

    service.list(2, 10).subscribe((page) => (result = page));

    const req = httpMock.expectOne((request) => request.url === '/api/tracks');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('limit')).toBe('10');
    expect(req.request.urlWithParams).toBe('/api/tracks?page=2&limit=10');
    expect(req.request.body).toBeNull();

    req.flush(expected);
    expect(result).toEqual(expected);
  });

  it('list() sans argument envoie les valeurs par défaut page=1 et limit=5', () => {
    service.list().subscribe();

    const req = httpMock.expectOne('/api/tracks?page=1&limit=5');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('limit')).toBe('5');

    req.flush(fakePage(1, 5));
  });
});
