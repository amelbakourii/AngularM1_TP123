import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../shared/services/auth.service';

/** Page de connexion. */
@Component({
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login-page.html',
  styleUrl: './login-page.css',
})
export class LoginPageComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  // Message d'erreur global affiché sous le formulaire.
  readonly error = signal('');
  // Requête en cours : bouton désactivé, texte « Connexion… ».
  readonly loading = signal(false);

  // Formulaire réactif : chaque champ porte ses règles de validation.
  readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  /** Affiche l'erreur d'un champ seulement après que l'utilisateur l'a touché. */
  hasError(field: string, error: string): boolean {
    const control = this.form.get(field);
    return !!control && control.touched && control.hasError(error);
  }

  submit(): void {
    // 1. Formulaire invalide ou envoi déjà en cours : affichage des erreurs, pas de requête.
    if (this.form.invalid || this.loading()) {
      this.form.markAllAsTouched();
      return;
    }
    // 2. Réinitialisation de l'erreur précédente et début du chargement.
    this.error.set('');
    this.loading.set(true);

    // 3. Appel au service avec un email nettoyé (espaces, majuscules).
    const { email, password } = this.form.getRawValue();
    this.auth
      .login(email.trim().toLowerCase(), password)
      // Fin du chargement dans tous les cas (succès ou erreur).
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        // 4a. Succès : token déjà stocké par le service, redirection vers la bibliothèque.
        next: () => {
          console.debug('[LoginPage] Connexion réussie');
          void this.router.navigateByUrl('/tracks');
        },
        // 4b. Échec : message lisible selon le statut HTTP.
        error: (error: unknown) => {
          // Seul le statut est journalisé : ni mot de passe ni token.
          console.error(
            '[LoginPage] Échec de connexion, statut',
            error instanceof HttpErrorResponse ? error.status : 'réponse inattendue',
          );
          this.error.set(this.errorMessage(error));
          // Mauvais identifiants : champ mot de passe vidé.
          if (error instanceof HttpErrorResponse && error.status === 401) {
            this.form.controls.password.reset();
          }
        },
      });
  }

  /** Traduit une erreur de POST /api/auth/login en message lisible. */
  private errorMessage(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) {
      return 'Réponse inattendue du serveur. Réessayez plus tard.';
    }
    switch (error.status) {
      case 0: // Backend injoignable.
        return 'Serveur injoignable. Vérifiez votre connexion ou réessayez plus tard.';
      case 400: // Champs manquants.
        return 'Veuillez renseigner votre email et votre mot de passe.';
      case 401: // Identifiants incorrects.
        return 'Email ou mot de passe incorrect.';
      default:
        return error.status >= 500
          ? 'Erreur du serveur. Réessayez dans quelques instants.'
          : 'Erreur inattendue pendant la connexion. Réessayez plus tard.';
    }
  }
}
