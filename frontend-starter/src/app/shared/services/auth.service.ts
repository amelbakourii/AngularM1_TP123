import { inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { AuthResponse } from '../models/auth-response.model';
import { User } from '../models/user.model';

/** Handles authentication and the current user's profile. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  readonly currentUser = signal<User | null>(null);
  readonly token = signal<string | null>(localStorage.getItem('gpc_token'));

  login(email: string, password: string) {
    return this.http
      .post<AuthResponse>('/api/auth/login', { email, password })
      .pipe(tap((response) => this.storeAuthentication(response)));
  }

  register(name: string, email: string, password: string) {
    return this.http
      .post<AuthResponse>('/api/auth/register', { name, email, password })
      .pipe(tap((response) => this.storeAuthentication(response)));
  }

  profile() {
    return this.http
      .get<User>('/api/users/me')
      .pipe(tap((user) => this.setCurrentUserIfAuthenticated(user)));
  }

  update(name: string) {
    return this.http
      .put<User>('/api/users/me', { name })
      .pipe(tap((user) => this.setCurrentUserIfAuthenticated(user)));
  }

  logout(): void {
    localStorage.removeItem('gpc_token');
    this.token.set(null);
    this.currentUser.set(null);
    // Jamais le token dans les logs : on trace seulement l'événement.
    console.debug('[AuthService] Session locale supprimée');
  }

  /**
   * Ignore une réponse de profil arrivée après une déconnexion,
   * pour ne pas remettre l'ancien utilisateur dans currentUser.
   */
  private setCurrentUserIfAuthenticated(user: User): void {
    if (this.token()) {
      this.currentUser.set(user);
    }
  }

  private storeAuthentication(response: AuthResponse): void {
    // Refuse une réponse incomplète plutôt que de stocker un token "undefined".
    if (typeof response?.token !== 'string' || !response.token || !response.user) {
      throw new Error('Réponse d’authentification inattendue');
    }
    localStorage.setItem('gpc_token', response.token);
    this.token.set(response.token);
    this.currentUser.set(response.user);
  }
}
