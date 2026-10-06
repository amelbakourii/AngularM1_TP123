import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { finalize } from 'rxjs';
import { AuthService } from '../../shared/services/auth.service';

/** Même règle que le modèle User côté API : nom obligatoire, 2 caractères minimum après trim. */
function trimmedMinLength(min: number) {
  return (control: AbstractControl<string>): ValidationErrors | null =>
    control.value.trim().length >= min ? null : { trimmedMinLength: { min } };
}

/** Page profil : affichage et modification du nom. */
@Component({
  imports: [ReactiveFormsModule],
  templateUrl: './profile-page.html',
  styleUrl: './profile-page.css',
})
export class ProfilePageComponent implements OnInit {
  // Public : currentUser est lu directement dans le template.
  readonly auth = inject(AuthService);

  // États de l'interface : chargement, enregistrement, messages.
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal('');

  readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, trimmedMinLength(2)],
    }),
  });

  /** Chargement automatique du profil à l'ouverture de la page. */
  ngOnInit(): void {
    this.load();
  }

  /** Affiche l'erreur d'un champ seulement après que l'utilisateur l'a touché. */
  hasError(error: string): boolean {
    const control = this.form.controls.name;
    return control.touched && control.hasError(error);
  }

  /** GET /api/users/me via le service, puis pré-remplissage du champ nom. */
  load(): void {
    this.error.set('');
    this.success.set('');
    this.loading.set(true);
    this.auth
      .profile()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (user) => {
          console.debug('[ProfilePage] Profil chargé', user.id);
          this.form.reset({ name: user.name });
        },
        error: (error: unknown) => {
          console.error('[ProfilePage] Chargement impossible, statut', this.status(error));
          this.error.set(this.errorMessage(error, 'le chargement du profil'));
        },
      });
  }

  /** PUT /api/users/me avec le nouveau nom. */
  save(): void {
    // 1. Nom invalide ou enregistrement déjà en cours : pas de requête.
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    // 2. Réinitialisation des messages et début de l'enregistrement.
    this.error.set('');
    this.success.set('');
    this.saving.set(true);

    // 3. Envoi du nom sans espaces superflus.
    const name = this.form.getRawValue().name.trim();
    this.auth
      .update(name)
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        // 4a. Succès : currentUser mis à jour par le service, message de confirmation.
        next: (user) => {
          console.debug('[ProfilePage] Profil enregistré', user.id);
          this.form.reset({ name: user.name });
          this.success.set('Votre nom a bien été mis à jour.');
        },
        // 4b. Échec : message lisible selon le statut HTTP.
        error: (error: unknown) => {
          console.error('[ProfilePage] Enregistrement impossible, statut', this.status(error));
          this.error.set(this.errorMessage(error, 'l’enregistrement'));
        },
      });
  }

  /** Statut HTTP de l'erreur, pour les logs. */
  private status(error: unknown): number | string {
    return error instanceof HttpErrorResponse ? error.status : 'réponse inattendue';
  }

  /** Traduit une erreur de /api/users/me en message lisible. */
  private errorMessage(error: unknown, action: string): string {
    if (!(error instanceof HttpErrorResponse)) {
      return 'Réponse inattendue du serveur. Réessayez plus tard.';
    }
    switch (error.status) {
      case 0: // Backend injoignable.
        return 'Serveur injoignable. Vérifiez votre connexion ou réessayez plus tard.';
      case 400: // Nom refusé par le backend.
        return 'Nom invalide : il doit contenir au moins 2 caractères.';
      case 401:
        // L'intercepteur a déjà nettoyé la session et redirigé vers /login.
        return 'Votre session a expiré. Veuillez vous reconnecter.';
      case 404: // Compte supprimé entre-temps.
        return 'Compte introuvable. Veuillez vous reconnecter.';
      default:
        return error.status >= 500
          ? 'Erreur du serveur. Réessayez dans quelques instants.'
          : `Erreur inattendue pendant ${action}. Réessayez plus tard.`;
    }
  }
}
