import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../services/auth.service';
import { authGuard } from './auth.guard';

// Valeur factice : ce n'est pas un JWT.
const FAKE_TOKEN = 'fake-test-token';

/** Page vide servant uniquement de destination aux routes de test. */
@Component({ template: '' })
class DummyPageComponent {}

describe('authGuard', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        // AuthService injecte HttpClient : réponses simulées, aucun backend.
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'login', component: DummyPageComponent },
          { path: 'tracks', component: DummyPageComponent, canActivate: [authGuard] },
        ]),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  // Le guard ne lit que le token : aucune requête HTTP ne doit partir.
  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('redirige vers /login un utilisateur sans token', async () => {
    expect(TestBed.inject(AuthService).token()).toBeNull();

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/tracks');

    expect(TestBed.inject(Router).url).toBe('/login');
  });

  it('laisse passer un utilisateur avec un token', async () => {
    TestBed.inject(AuthService).token.set(FAKE_TOKEN);

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/tracks');

    expect(TestBed.inject(Router).url).toBe('/tracks');
  });
});
