import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../shared/services/auth.service';

@Component({
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login-page.html',
  styleUrl: './login-page.css',
})
export class LoginPageComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly error = signal('');
  readonly loading = signal(false);

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
    if (this.form.invalid || this.loading()) {
      this.form.markAllAsTouched();
      return;
    }
    this.error.set('');
    this.loading.set(true);

    const { email, password } = this.form.getRawValue();
    this.auth
      .login(email.trim().toLowerCase(), password)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: () => {
          console.debug('[LoginPage] Connexion réussie');
          void this.router.navigateByUrl('/tracks');
        },
        error: (error: unknown) => {
          // On ne logue que le statut : ni le mot de passe ni le token.
          console.error(
            '[LoginPage] Échec de connexion, statut',
            error instanceof HttpErrorResponse ? error.status : 'réponse inattendue',
          );
          this.error.set(this.errorMessage(error));
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
      case 0:
        return 'Serveur injoignable. Vérifiez votre connexion ou réessayez plus tard.';
      case 400:
        return 'Veuillez renseigner votre email et votre mot de passe.';
      case 401:
        return 'Email ou mot de passe incorrect.';
      default:
        return error.status >= 500
          ? 'Erreur du serveur. Réessayez dans quelques instants.'
          : 'Erreur inattendue pendant la connexion. Réessayez plus tard.';
    }
  }
}
