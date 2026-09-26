import { Component, inject, signal } from '@angular/core';
import { FormField, form, required, submit } from '@angular/forms/signals';
import { AuthService } from '../auth.service';
import { RemoteConnectionService } from '../../file-system/remote-connection.service';

interface Credentials {
  username: string;
  password: string;
}

/**
 * The sign-in screen (PRD 003, §2): shown instead of the workbench while the
 * backend wants a session and there is none. Render-only — signing in is
 * `AuthService`'s.
 */
@Component({
  selector: 'app-login',
  imports: [FormField],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  protected readonly auth = inject(AuthService);
  /** On a remote server, the screen says which one it is signing in to (PRD 006, §1). */
  protected readonly connection = inject(RemoteConnectionService);

  protected readonly model = signal<Credentials>({ username: '', password: '' });

  protected readonly credentials = form(this.model, (path) => {
    required(path.username, { message: 'Enter your username' });
    required(path.password, { message: 'Enter your password' });
  });

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await submit(this.credentials, async () => {
      const { username, password } = this.model();
      const signedIn = await this.auth.signIn(username, password);
      if (!signedIn) {
        // Keep the username; a wrong password is the usual mistake.
        this.model.update((value) => ({ ...value, password: '' }));
      }
      return undefined;
    });
  }
}
