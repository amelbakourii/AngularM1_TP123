import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../shared/services/auth.service';

/** Vérifie que password et confirmPassword sont identiques. */
const passwordsMatch: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const password = group.get('password')?.value;
  const confirm = group.get('confirmPassword')?.value;
  return password && confirm && password !== confirm ? { passwordMismatch: true } : null;
};

/** Refuse un champ composé uniquement d'espaces (le backend fait un trim sur le nom). */
const notBlank: ValidatorFn = (control: AbstractControl): ValidationErrors | null =>
  control.value && !String(control.value).trim() ? { blank: true } : null;

/** Page d'inscription. */
@Component({
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register-page.html',
  styleUrl: './register-page.css',
})
export class RegisterPageComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  // Message d'erreur global affiché sous le formulaire.
  readonly error = signal('');
  // Requête en cours : bouton désactivé, texte « Création… ».
  readonly loading = signal(false);

  // Règles par champ + règle de groupe (mots de passe identiques).
  readonly form = new FormGroup(
    {
      name: new FormControl('', { nonNullable: true, validators: [Validators.required, notBlank, Validators.minLength(2)] }),
      email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
      password: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(8)] }),
      confirmPassword: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    },
    { validators: passwordsMatch },
  );

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

    // 3. Appel au service avec des valeurs nettoyées (confirmPassword non envoyé).
    const { name, email, password } = this.form.getRawValue();
    this.auth
      .register(name.trim(), email.trim().toLowerCase(), password)
      // Fin du chargement dans tous les cas (succès ou erreur).
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        // 4a. Succès : compte créé et session ouverte, redirection vers le profil.
        next: () => {
          console.debug('[RegisterPage] Inscription réussie');
          void this.router.navigateByUrl('/profile');
        },
        // 4b. Échec : message lisible selon le statut HTTP.
        error: (error: HttpErrorResponse) => {
          // Seul le statut est journalisé : ni corps de requête (mot de passe) ni token.
          console.error('[RegisterPage] Échec de l’inscription, statut', error.status);
          this.error.set(this.errorMessage(error));
          // Email déjà utilisé : erreur rattachée directement au champ email.
          if (error.status === 409) {
            this.form.controls.email.setErrors({ emailTaken: true });
          }
        },
      });
  }

  /** Traduit une erreur HTTP de POST /api/auth/register en message lisible. */
  private errorMessage(error: HttpErrorResponse): string {
    switch (error.status) {
      case 0: // Backend injoignable.
        return 'Serveur injoignable. Vérifiez votre connexion ou réessayez plus tard.';
      case 400: // Données refusées par le backend : son message est réutilisé.
        return error.error?.message ?? 'Données invalides : vérifiez les champs du formulaire.';
      case 409: // Email déjà enregistré.
        return 'Un compte existe déjà avec cet email.';
      default:
        return 'Erreur inattendue pendant l’inscription. Réessayez plus tard.';
    }
  }
}
