import { Service, signal } from '@angular/core';

/** Whether the desktop shell has found a newer version (PRD 001, §8.6). */
export interface DesktopUpdateStatus {
  /** The distributable that would be installed, by file name; `null` when up to date. */
  readonly available: string | null;
  /** It is being put in place; the window is about to close. */
  readonly upgrading: boolean;
}

/** The object the Electron preload script exposes on `window`. */
interface DesktopUpdateApi {
  readonly version: number;
  invoke(command: 'status' | 'check' | 'upgrade'): Promise<unknown>;
  /** Subscribes to what the main process found; returns unsubscribe. */
  onStatus(listener: (status: unknown) => void): () => void;
}

declare global {
  interface Window {
    /** Present only inside the desktop shell; see `prj/desktop`. */
    readonly trFileUpdate?: DesktopUpdateApi;
  }
}

const UPDATE_VERSION = 1;

const UP_TO_DATE: DesktopUpdateStatus = { available: null, upgrading: false };

/**
 * The desktop's self-update, as the page sees it (PRD 001, §8.6).
 *
 * The main process looks at the share and decides what is newer; this is the
 * seam that hears about it and asks for the upgrade. Thin on purpose: what the
 * title bar shows, and asking the user first, is `AppUpdateFeature`'s. In a
 * browser there is nothing to update and `status` stays up to date.
 */
@Service()
export class DesktopUpdateService {
  readonly status = signal<DesktopUpdateStatus>(UP_TO_DATE);

  /** Whether this copy updates itself at all — not a development run, not turned off. */
  readonly supported = signal(false);

  private stopListening: (() => void) | undefined;

  /** Whether this app is running inside the desktop shell at all. */
  get isAvailable(): boolean {
    return this.api !== undefined;
  }

  /** Reads the status and starts following it; called once by the workbench. */
  start(): void {
    const api = this.api;
    if (api === undefined || this.stopListening !== undefined) {
      return;
    }
    this.stopListening = api.onStatus((status) => this.status.set(DesktopUpdateService.read(status)));
    void this.send('status');
  }

  stop(): void {
    this.stopListening?.();
    this.stopListening = undefined;
  }

  /**
   * Looks at the share now (*File › Check for Updates…*, PRD 001, §8.6.1).
   * Resolves with why it could not, or `null` — `status` and `supported` say
   * what was found.
   */
  async check(): Promise<string | null> {
    const answer = await this.send('check');
    return answer?.error ?? null;
  }

  /**
   * Upgrades and restarts. Resolves with why it could not, or `null` once the
   * window is on its way out.
   */
  async upgrade(): Promise<string | null> {
    const answer = await this.send('upgrade');
    return answer?.error ?? null;
  }

  private get api(): DesktopUpdateApi | undefined {
    const api = globalThis.window?.trFileUpdate;
    return api?.version === UPDATE_VERSION ? api : undefined;
  }

  private async send(command: 'status' | 'check' | 'upgrade'): Promise<{ error?: string } | null> {
    const api = this.api;
    if (api === undefined) {
      return null;
    }
    try {
      const answer = (await api.invoke(command)) as { status?: unknown; supported?: unknown; error?: unknown } | null;
      if (answer === null || typeof answer !== 'object') {
        return null;
      }
      this.status.set(DesktopUpdateService.read(answer.status));
      this.supported.set(answer.supported === true);
      return typeof answer.error === 'string' ? { error: answer.error } : {};
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  private static read(value: unknown): DesktopUpdateStatus {
    if (typeof value !== 'object' || value === null) {
      return UP_TO_DATE;
    }
    const { available, upgrading } = value as Partial<DesktopUpdateStatus>;
    return { available: typeof available === 'string' && available !== '' ? available : null, upgrading: upgrading === true };
  }
}
