import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { User } from '../models/user.model';
import { AuthService } from '../services/auth.service';
import { authInterceptor } from './auth.interceptor';

// Valeur factice : ce n'est pas un JWT, le backend n'est jamais appelé.
const FAKE_TOKEN = 'fake-test-token';

const fakeUser: User = {
  id: 'u1',
  name: 'Testeur',
  email: 'testeur@example.test',
  createdAt: '2026-10-01T10:00:00.000Z',
};

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    // AuthService lit localStorage à sa création : il doit être vide avant l'injection.
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('ajoute Authorization: Bearer <token> quand un token existe', () => {
    auth.token.set(FAKE_TOKEN);

    http.get<User>('/api/users/me').subscribe();

    const req = httpMock.expectOne('/api/users/me');
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('Authorization')).toBe(`Bearer ${FAKE_TOKEN}`);
    req.flush(fakeUser);
  });

  it("n'ajoute pas Authorization quand aucun token n'existe", () => {
    expect(auth.token()).toBeNull();

    http.get<User>('/api/users/me').subscribe();

    const req = httpMock.expectOne('/api/users/me');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush(fakeUser);
  });

  it('sur un 401 hors /api/auth : relance l’erreur, vide la session et redirige vers /login', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    auth.token.set(FAKE_TOKEN);
    let status: number | undefined;

    http.get<User>('/api/users/me').subscribe({
      error: (error: unknown) => {
        if (error instanceof HttpErrorResponse) status = error.status;
      },
    });
    httpMock.expectOne('/api/users/me').flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

    expect(status).toBe(401);
    expect(auth.token()).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/login');
  });

  it('sur un 401 de /api/auth/login : la session et la page ne changent pas', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    auth.token.set(FAKE_TOKEN);

    http.post('/api/auth/login', { email: 'testeur@example.test', password: 'mot-de-passe-factice' }).subscribe({
      error: () => undefined,
    });
    httpMock
      .expectOne('/api/auth/login')
      .flush({ message: 'Invalid credentials' }, { status: 401, statusText: 'Unauthorized' });

    expect(auth.token()).toBe(FAKE_TOKEN);
    expect(navigate).not.toHaveBeenCalled();
  });
});
