import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * Intercepteur exécuté sur chaque requête HTTP :
 * - à l'aller : ajout du token JWT dans le header Authorization ;
 * - au retour : fin de session si l'API refuse le token (invalide ou expiré).
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.token();

  // Requête copiée avec le header "Bearer <token>" si un token existe, sinon envoyée telle quelle.
  return next(
    token
      ? request.clone({
          setHeaders: { Authorization: `Bearer ${token}` },
        })
      : request,
  ).pipe(
    // Inspection des réponses en erreur.
    catchError((error: unknown) => {
      if (isSessionRejected(error, request.url) && token && auth.token() === token) {
        // Seul le premier 401 d'une session passe ici : logout() vide le token,
        // donc les 401 suivants (requêtes parallèles) ou ceux d'un ancien token
        // arrivés après une reconnexion ne déclenchent ni nettoyage ni redirection.
        console.warn('[AuthInterceptor] Token refusé par l’API, retour à la connexion');
        auth.logout();
        // Redirection vers /login, sauf si la page est déjà affichée.
        if (!router.url.startsWith('/login')) {
          void router.navigateByUrl('/login');
        }
      }
      // L'erreur est toujours relancée : 400, 403, 404, 500… gardent leur traitement.
      return throwError(() => error);
    }),
  );
};

/**
 * Un 401 sur /api/auth/* signifie « identifiants incorrects » et reste géré
 * par les pages de connexion et d'inscription.
 */
function isSessionRejected(error: unknown, url: string): boolean {
  return (
    error instanceof HttpErrorResponse &&
    error.status === 401 &&
    !url.startsWith('/api/auth/')
  );
}
