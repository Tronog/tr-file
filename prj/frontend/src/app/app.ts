import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './auth/auth.service';
import { Login } from './auth/login/login';
import { ModalHost } from './modal/modal-host';
import { ModalService } from './modal/modal.service';

/**
 * The shell around every screen: the workbench once there is a session — or
 * when the backend wants none — and the sign-in screen until then
 * (PRD 003, §2). The workbench is only built behind that, so it never asks
 * for a listing it would be refused.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Login, ModalHost],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly modal = inject(ModalService);

  constructor() {
    void this.auth.start();
  }
}
