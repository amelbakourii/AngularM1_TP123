import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from '../../shared/services/auth.service';

/** Composant racine : en-tête, menu de navigation et zone d'affichage des pages. */
@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class AppComponent {
  // Public : utilisé dans le template pour adapter le menu (connecté / déconnecté).
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Supprime la session locale puis renvoie vers la page de connexion. */
  logout(): void {
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }
}
