import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { UiTitleBar } from '@tr-file/ui';
import { settled } from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';

/**
 * PRD 001, §8.6 — the blue *Upgrade* button right of the command palette box: shown while
 * the desktop shell has found a newer version, asked first, then upgraded.
 */

interface Status {
  available: string | null;
  upgrading: boolean;
}

/** Stands in for the preload's `window.trFileUpdate`. */
class FakeUpdateApi {
  readonly version = 1;
  readonly sent: string[] = [];
  status: Status = { available: null, upgrading: false };
  supported = true;
  error: string | undefined;
  /** What the share holds, found by the next `check`. */
  onShare: string | null | undefined;
  checkError: string | undefined;
  private listener: ((status: unknown) => void) | undefined;

  invoke = async (command: string): Promise<unknown> => {
    this.sent.push(command);
    if (command === 'upgrade' && this.error === undefined) {
      this.status = { ...this.status, upgrading: true };
    }
    if (command === 'check' && this.onShare !== undefined) {
      this.status = { ...this.status, available: this.onShare };
    }
    const error = command === 'upgrade' ? this.error : command === 'check' ? this.checkError : undefined;
    return { status: this.status, supported: this.supported, ...(error ? { error } : {}) };
  };

  onStatus = (listener: (status: unknown) => void): (() => void) => {
    this.listener = listener;
    return () => (this.listener = undefined);
  };

  push(status: Status): void {
    this.status = status;
    this.listener?.(status);
  }
}

function install(api: FakeUpdateApi | undefined): void {
  Object.defineProperty(window, 'trFileUpdate', { value: api, configurable: true, writable: true });
}

function bootstrap(api: FakeUpdateApi | undefined): WorkbenchService {
  install(api);
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  const workbench = TestBed.inject(WorkbenchService);
  workbench.appUpdateFt.start();
  return workbench;
}

afterEach(() => {
  install(undefined);
  TestBed.inject(HttpTestingController).verify();
});

describe('AppUpdateFeature', () => {
  it('never shows the button in a browser', () => {
    const workbench = bootstrap(undefined);
    expect(workbench.appUpdateFt.upgrade()).toBeNull();
  });

  it('shows the button once the shell finds a newer version', async () => {
    const api = new FakeUpdateApi();
    const workbench = bootstrap(api);
    await settled();
    expect(api.sent).toEqual(['status']);
    expect(workbench.appUpdateFt.upgrade()).toBeNull();

    api.push({ available: 'tr-file-1.0.1-x86_64.AppImage', upgrading: false });
    expect(workbench.appUpdateFt.upgrade()).toEqual({
      label: 'Upgrade',
      title: 'A new version is available: tr-file-1.0.1-x86_64.AppImage',
      busy: false,
    });
  });

  it('asks first, and upgrades only when told to', async () => {
    const api = new FakeUpdateApi();
    api.status = { available: 'tr-file-Setup-1.0.1-x64.exe', upgrading: false };
    const workbench = bootstrap(api);
    await settled();

    const confirm = vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(false);
    await workbench.appUpdateFt.run();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(api.sent).toEqual(['status']);

    confirm.mockResolvedValue(true);
    await workbench.appUpdateFt.run();
    expect(api.sent).toEqual(['status', 'upgrade']);
    expect(workbench.appUpdateFt.upgrade()).toMatchObject({ label: 'Upgrading…', busy: true });
  });

  it('says why an upgrade could not be done', async () => {
    const api = new FakeUpdateApi();
    api.status = { available: 'tr-file-1.0.1-x64.exe', upgrading: false };
    api.error = 'The folder is read-only.';
    const workbench = bootstrap(api);
    await settled();

    vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(true);
    const message = vi.spyOn(workbench.modal, 'message').mockResolvedValue();
    await workbench.appUpdateFt.run();
    expect(message).toHaveBeenCalledWith(expect.objectContaining({ detail: 'The folder is read-only.', severity: 'error' }));
  });
});

describe('File › Check for Updates… (PRD 001, §8.6.1)', () => {
  it('is in the File menu, and disabled in a browser', () => {
    const workbench = bootstrap(undefined);
    const file = workbench.chromeFt.menuItems().find((menu) => menu.id === 'file');
    const item = file?.items?.find((entry) => entry.id === 'file.checkForUpdates');
    expect(item?.label).toBe('Check for Updates…');
    expect(item?.disabled).toBe(true);
  });

  it('says when the app is up to date', async () => {
    const api = new FakeUpdateApi();
    const workbench = bootstrap(api);
    await settled();
    const message = vi.spyOn(workbench.modal, 'message').mockResolvedValue();

    workbench.commandsFt.run('file.checkForUpdates');
    await settled();
    expect(api.sent).toEqual(['status', 'check']);
    expect(message).toHaveBeenCalledWith(expect.objectContaining({ message: 'tr-file is up to date.' }));
  });

  it('offers a newer version found now, and upgrades to it when told to', async () => {
    const api = new FakeUpdateApi();
    api.onShare = 'tr-file-0.1.1-x86_64.AppImage';
    const workbench = bootstrap(api);
    await settled();
    const confirm = vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(true);

    await workbench.appUpdateFt.check();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'A new version of tr-file is available.', confirmLabel: 'Upgrade' }));
    expect(api.sent).toEqual(['status', 'check', 'upgrade']);
    expect(workbench.appUpdateFt.upgrade()).toMatchObject({ busy: true });
  });

  it('keeps the button for later when the user says so', async () => {
    const api = new FakeUpdateApi();
    api.onShare = 'tr-file-0.1.1-x86_64.AppImage';
    const workbench = bootstrap(api);
    await settled();
    vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(false);

    await workbench.appUpdateFt.check();
    expect(api.sent).toEqual(['status', 'check']);
    expect(workbench.appUpdateFt.upgrade()).toMatchObject({ label: 'Upgrade' });
  });

  it('says why the share could not be looked at, or that this copy does not update', async () => {
    const api = new FakeUpdateApi();
    api.checkError = 'The update folder /S/x could not be read.';
    const workbench = bootstrap(api);
    await settled();
    const message = vi.spyOn(workbench.modal, 'message').mockResolvedValue();

    await workbench.appUpdateFt.check();
    expect(message).toHaveBeenLastCalledWith(expect.objectContaining({ detail: 'The update folder /S/x could not be read.', severity: 'warning' }));

    api.supported = false;
    await workbench.appUpdateFt.check();
    expect(message).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'This copy of tr-file does not update itself.' }));
  });
});

describe('UiTitleBar upgrade button', () => {
  it('draws the button right of the command palette box and reports the press', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const fixture = TestBed.createComponent(UiTitleBar);
    fixture.componentRef.setInput('menuItems', []);
    fixture.componentRef.setInput('commandLabel', 'tr-file');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.upgrade-btn')).toBeNull();

    fixture.componentRef.setInput('upgrade', { label: 'Upgrade', title: 'A new version is available' });
    fixture.detectChanges();
    const button = host.querySelector<HTMLButtonElement>('.titlebar-right > .upgrade-btn');
    expect(button?.textContent?.trim()).toBe('Upgrade');
    // Next to the command palette box: the first thing after it, before any chrome button.
    expect(host.querySelector('.command-center')?.nextElementSibling?.firstElementChild).toBe(button);
    expect(button?.disabled).toBe(false);

    let pressed = 0;
    fixture.componentInstance.upgradeSelect.subscribe(() => pressed++);
    button?.click();
    expect(pressed).toBe(1);
  });
});
