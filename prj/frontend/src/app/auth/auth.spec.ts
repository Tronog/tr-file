import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { App } from '../app';
import { ModalService } from '../modal/modal.service';
import { csrfInterceptor, sessionExpiryInterceptor } from '../file-system/fs-http.interceptors';
import { settled } from '../workbench/testing/fs-fixtures';
import { AuthService } from './auth.service';
import { Login } from './login/login';
import { SessionExpiryService } from './session-expiry.service';

/** PRD 003, §2 — signing in, and the header that keeps other sites out. */

const SIGNED_OUT = { required: true, authenticated: false, username: null };
const SIGNED_IN = { required: true, authenticated: true, username: 'ana' };
const OPEN = { required: false, authenticated: true, username: null };

function configure(): { http: HttpTestingController } {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([csrfInterceptor, sessionExpiryInterceptor])),
      provideHttpClientTesting(),
      provideRouter([]),
    ],
  });
  return { http: TestBed.inject(HttpTestingController) };
}

describe('the HTTP interceptors', () => {
  let http: HttpTestingController;
  let client: HttpClient;

  beforeEach(() => {
    ({ http } = configure());
    client = TestBed.inject(HttpClient);
  });

  afterEach(() => http.verify());

  it('marks every write to the API as the app’s own', () => {
    void firstValueFrom(client.post('/api/fs/upload?path=', {}));

    expect(http.expectOne('/api/fs/upload?path=').request.headers.get('X-TR-File-Request')).toBe('1');
  });

  it('leaves reads, and requests elsewhere, as they are', () => {
    void firstValueFrom(client.get('/api/fs/list?path='));
    void firstValueFrom(client.post('/elsewhere', {}));

    expect(http.expectOne('/api/fs/list?path=').request.headers.has('X-TR-File-Request')).toBe(false);
    expect(http.expectOne('/elsewhere').request.headers.has('X-TR-File-Request')).toBe(false);
  });

  it('reports an API request refused for want of a session', async () => {
    const expiry = TestBed.inject(SessionExpiryService);
    const request = firstValueFrom(client.get('/api/fs/list?path=')).catch(() => undefined);

    http.expectOne('/api/fs/list?path=').flush({ error: { code: 'UNAUTHORIZED', message: 'Sign in' } }, { status: 401, statusText: 'Unauthorized' });
    await request;

    expect(expiry.expired()).toBe(1);
  });

  /** A wrong password is the sign-in screen's to report, not an expiry. */
  it('does not count a refused sign-in as an expired session', async () => {
    const expiry = TestBed.inject(SessionExpiryService);
    const request = firstValueFrom(client.post('/api/auth/login', {})).catch(() => undefined);

    http.expectOne('/api/auth/login').flush({ error: { code: 'UNAUTHORIZED', message: 'Wrong' } }, { status: 401, statusText: 'Unauthorized' });
    await request;

    expect(expiry.expired()).toBe(0);
  });
});

describe('AuthService', () => {
  let http: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    ({ http } = configure());
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => http.verify());

  const start = async (status: unknown): Promise<void> => {
    const started = auth.start();
    http.expectOne('/api/auth/session').flush({ data: status });
    await started;
  };

  it('opens straight onto the workbench when nobody has to sign in', async () => {
    await start(OPEN);

    expect(auth.view()).toBe('open');
    expect(auth.canSignOut()).toBe(false);
  });

  it('asks to sign in when there is no session', async () => {
    await start(SIGNED_OUT);

    expect(auth.view()).toBe('signed-out');
  });

  it('picks up a session the browser already has', async () => {
    await start(SIGNED_IN);

    expect(auth.view()).toBe('signed-in');
    expect(auth.username()).toBe('ana');
  });

  it('says so when the server cannot be asked at all', async () => {
    const started = auth.start();
    http.expectOne('/api/auth/session').error(new ProgressEvent('error'), { status: 0 });
    await started;

    expect(auth.view()).toBe('unreachable');
  });

  it('signs in, sending the credentials as a write the server will accept', async () => {
    await start(SIGNED_OUT);

    const signingIn = auth.signIn('ana', 'secret');
    expect(auth.busy()).toBe(true);
    const request = http.expectOne('/api/auth/login');
    expect(request.request.body).toEqual({ username: 'ana', password: 'secret' });
    expect(request.request.headers.get('X-TR-File-Request')).toBe('1');
    request.flush({ data: SIGNED_IN });

    expect(await signingIn).toBe(true);
    expect(auth.view()).toBe('signed-in');
    expect(auth.busy()).toBe(false);
  });

  it('explains a refused sign-in without saying which half was wrong', async () => {
    await start(SIGNED_OUT);

    const signingIn = auth.signIn('ana', 'nope');
    http.expectOne('/api/auth/login').flush({ error: { code: 'UNAUTHORIZED', message: 'Wrong username or password' } }, { status: 401, statusText: 'Unauthorized' });

    expect(await signingIn).toBe(false);
    expect(auth.view()).toBe('signed-out');
    expect(auth.error()).toBe('Wrong username or password.');
  });

  it('asks a client that keeps guessing to wait', async () => {
    await start(SIGNED_OUT);

    const signingIn = auth.signIn('ana', 'nope');
    http.expectOne('/api/auth/login').flush({ error: { code: 'TOO_MANY_REQUESTS', message: 'Later' } }, { status: 429, statusText: 'Too Many Requests' });
    await signingIn;

    expect(auth.error()).toContain('Too many failed attempts');
  });

  it('goes back to the sign-in screen when the session ends under it', async () => {
    await start(SIGNED_IN);

    TestBed.inject(SessionExpiryService).report();
    TestBed.tick();

    expect(auth.view()).toBe('signed-out');
    expect(auth.error()).toContain('session has ended');
  });

  it('signs out', async () => {
    await start(SIGNED_IN);

    const signingOut = auth.signOut();
    http.expectOne('/api/auth/logout').flush({ data: SIGNED_OUT });
    await signingOut;

    expect(auth.view()).toBe('signed-out');
    expect(auth.username()).toBeNull();
  });
});

describe('Login', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    ({ http } = configure());
    await TestBed.compileComponents();
  });

  afterEach(() => http.verify());

  const render = () => {
    const fixture = TestBed.createComponent(Login);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const type = (selector: string, value: string): void => {
      const input = element.querySelector(selector) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const submit = async (): Promise<void> => {
      (element.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
      await settled();
      fixture.detectChanges();
    };
    return { fixture, element, type, submit };
  };

  it('has labelled fields the browser can fill in', () => {
    const { element } = render();

    expect(element.querySelector('input[autocomplete="username"]')?.closest('label')?.textContent).toContain('Username');
    expect(element.querySelector('input[type="password"][autocomplete="current-password"]')).not.toBeNull();
  });

  it('asks for both fields before sending anything', async () => {
    const { element, submit } = render();

    await submit();

    http.expectNone('/api/auth/login');
    expect(element.textContent).toContain('Enter your username');
    expect(element.textContent).toContain('Enter your password');
  });

  it('signs in with what was typed', async () => {
    const { type, submit } = render();
    type('input[autocomplete="username"]', 'ana');
    type('input[type="password"]', 'secret');

    await submit();

    const request = http.expectOne('/api/auth/login');
    expect(request.request.body).toEqual({ username: 'ana', password: 'secret' });
    request.flush({ data: SIGNED_IN });
    await settled();
    expect(TestBed.inject(AuthService).view()).toBe('signed-in');
  });

  it('shows why a sign-in failed, and clears the password', async () => {
    const { element, fixture, type, submit } = render();
    type('input[autocomplete="username"]', 'ana');
    type('input[type="password"]', 'nope');

    await submit();
    http.expectOne('/api/auth/login').flush({ error: { code: 'UNAUTHORIZED', message: 'Wrong' } }, { status: 401, statusText: 'Unauthorized' });
    await settled();
    fixture.detectChanges();

    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Wrong username or password');
    expect((element.querySelector('input[type="password"]') as HTMLInputElement).value).toBe('');
    expect((element.querySelector('input[autocomplete="username"]') as HTMLInputElement).value).toBe('ana');
  });
});

describe('App', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    ({ http } = configure());
    await TestBed.compileComponents();
  });

  it('shows the sign-in screen, not the workbench, until there is a session', async () => {
    const fixture = TestBed.createComponent(App);
    http.expectOne('/api/auth/session').flush({ data: SIGNED_OUT });
    await settled();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-login')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('router-outlet')).toBeNull();
    // Nothing asked the file system for anything.
    http.verify();
  });

  /** PRD 002, §3: nothing behind an open modal window can be reached. */
  it('makes the page inert while a modal window is open', async () => {
    const fixture = TestBed.createComponent(App);
    http.expectOne('/api/auth/session').flush({ data: OPEN });
    await settled();
    fixture.detectChanges();
    const content = (): HTMLElement => fixture.nativeElement.querySelector('.app-content');
    expect(content().hasAttribute('inert')).toBe(false);

    void TestBed.inject(ModalService).message({ message: 'Hello' });
    fixture.detectChanges();

    expect(content().hasAttribute('inert')).toBe(true);
    expect(fixture.nativeElement.querySelector('app-modal-host ui-modal')).not.toBeNull();
  });

  it('goes straight to the workbench when nobody has to sign in', async () => {
    const fixture = TestBed.createComponent(App);
    http.expectOne('/api/auth/session').flush({ data: OPEN });
    await settled();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-login')).toBeNull();
    expect(fixture.nativeElement.querySelector('router-outlet')).not.toBeNull();
  });
});
