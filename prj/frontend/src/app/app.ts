import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './auth/auth.service';
import { Login } from './auth/login/login';
import { UiThemeService } from '@tr-file/ui';
import { UiModalHost, UiModalService } from '@tr-file/ui';

/**
 * The shell around every screen: the workbench once there is a session — or
 * when the backend wants none — and the sign-in screen until then
 * (PRD 003, §2). The workbench is only built behind that, so it never asks
 * for a listing it would be refused.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Login, UiModalHost],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly modal = inject(UiModalService);
  constructor() {
    // The colour theme (PRD 010, §4), applied before any screen — the sign-in one included.
    inject(UiThemeService);
    // Which backend this window talks to — its own, or a remote server
    // (PRD 006, §1) — is known already: the app initializer asked.
    void this.auth.start();
  }
}
