import { inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { AuthResponse } from '../models/auth-response.model';
import { User } from '../models/user.model';

/** Authentification et profil de l'utilisateur courant : seul point d'accès HTTP pour ces routes. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  // Utilisateur connecté (null si déconnecté) : l'affichage se met à jour à chaque changement.
  readonly currentUser = signal<User | null>(null);
  // Token JWT relu au démarrage pour conserver la session après un rechargement.
  readonly token = signal<string | null>(localStorage.getItem('gpc_token'));

  /** POST /api/auth/login : envoi des identifiants, puis stockage du token reçu. */
  login(email: string, password: string) {
    return this.http
      .post<AuthResponse>('/api/auth/login', { email, password })
      .pipe(tap((response) => this.storeAuthentication(response)));
  }

  /** POST /api/auth/register : création du compte, puis connexion automatique. */
  register(name: string, email: string, password: string) {
    return this.http
      .post<AuthResponse>('/api/auth/register', { name, email, password })
      .pipe(tap((response) => this.storeAuthentication(response)));
  }

  /** GET /api/users/me : lecture du profil (route protégée, token ajouté par l'intercepteur). */
  profile() {
    return this.http
      .get<User>('/api/users/me')
      .pipe(tap((user) => this.setCurrentUserIfAuthenticated(user)));
  }

  /** PUT /api/users/me : modification du nom. */
  update(name: string) {
    return this.http
      .put<User>('/api/users/me', { name })
      .pipe(tap((user) => this.setCurrentUserIfAuthenticated(user)));
  }

  /** Déconnexion : suppression du token stocké et remise à zéro de l'état local. */
  logout(): void {
    localStorage.removeItem('gpc_token');
    this.token.set(null);
    this.currentUser.set(null);
    // Trace de l'événement uniquement, jamais du token.
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

  /** Enregistrement de la session après login ou register. */
  private storeAuthentication(response: AuthResponse): void {
    // Refus d'une réponse incomplète plutôt que stockage d'un token "undefined".
    if (typeof response?.token !== 'string' || !response.token || !response.user) {
      throw new Error('Réponse d’authentification inattendue');
    }
    // Token conservé dans le navigateur, puis état mis à jour.
    localStorage.setItem('gpc_token', response.token);
    this.token.set(response.token);
    this.currentUser.set(response.user);
  }
}
