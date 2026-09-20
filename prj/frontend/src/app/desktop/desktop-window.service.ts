import { Service, signal } from '@angular/core';

/** What the window is doing, as far as the page can tell. */
export interface DesktopWindowState {
  readonly maximized: boolean;
  readonly fullScreen: boolean;
}

/** Everything the page may ask of its own window. */
export type DesktopWindowCommand = 'state' | 'minimize' | 'toggleMaximize' | 'close';

/** The object the Electron preload script exposes on `window`. */
interface DesktopWindowApi {
  /** Contract version, so a stale preload is recognised rather than used. */
  readonly version: number;
  /** `process.platform` of the host, e.g. `'darwin'`. */
  readonly platform: string;
  invoke(request: { command: DesktopWindowCommand }): Promise<unknown>;
  /** Subscribes to changes the window made by itself; returns unsubscribe. */
  onState(listener: (state: unknown) => void): () => void;
}

declare global {
  interface Window {
    /** Present only inside the desktop shell; see `prj/desktop`. */
    readonly trFileWindow?: DesktopWindowApi;
  }
}

/** The contract version this service speaks. */
const WINDOW_VERSION = 1;

const CLOSED: DesktopWindowState = { maximized: false, fullScreen: false };

/**
 * The application's own window (PRD 001, §8.2).
 *
 * The desktop shell takes the window's frame away and the Angular title bar
 * becomes the title bar, so the page needs a way to minimise, maximise and
 * close — which a web page cannot do on its own. This is the seam: a thin
 * wrapper over the preload's channel, holding only the state the buttons are
 * drawn from.
 *
 * Deliberately thin, per `docs/ai/ANGULAR.md`. What the buttons *are* — which
 * of them to show, which icon the middle one wears, whether the bar is
 * draggable at all — is `WindowControlsFeature`'s business, not this class's.
 *
 * In a browser there is no such object. `isAvailable` is then `false`,
 * everything else is a no-op, and the workbench simply shows no window
 * buttons: the tab already has its own.
 */
@Service()
export class DesktopWindowService {
  /** The live window state; `maximized` drives the middle button's icon. */
  readonly state = signal<DesktopWindowState>(CLOSED);

  private stopListening: (() => void) | undefined;

  /** Whether this app is running inside the desktop shell at all. */
  get isAvailable(): boolean {
    return this.api !== undefined;
  }

  /**
   * Which OS the shell is on, or `''` in a browser. The workbench needs it
   * because macOS draws its own window buttons over the title bar.
   */
  get platform(): string {
    return this.api?.platform ?? '';
  }

  /**
   * Reads the window's current state and starts following it.
   *
   * Called once, by the workbench, rather than from the constructor — creating
   * the service in a test must talk to nothing. Following matters because the
   * OS can maximise a window without any button being pressed: a snap gesture,
   * a keyboard shortcut, a drag to the top of the screen.
   */
  start(): void {
    const api = this.api;
    if (api === undefined || this.stopListening !== undefined) {
      return;
    }

    this.stopListening = api.onState((state) => this.state.set(DesktopWindowService.read(state)));
    void this.send('state');
  }

  /** Stops following the window. Safe when `start` was never called. */
  stop(): void {
    this.stopListening?.();
    this.stopListening = undefined;
  }

  minimize(): void {
    void this.send('minimize');
  }

  toggleMaximize(): void {
    void this.send('toggleMaximize');
  }

  close(): void {
    void this.send('close');
  }

  /* -- internals ---------------------------------------------------------- */

  private get api(): DesktopWindowApi | undefined {
    const api = globalThis.window?.trFileWindow;
    return api?.version === WINDOW_VERSION ? api : undefined;
  }

  /**
   * Sends one command and records the state it answers with.
   *
   * Every command answers, so the button that was just pressed is already
   * showing the right icon before the window's own event arrives. A channel
   * that fails is ignored: there is no window left to report it on.
   */
  private async send(command: DesktopWindowCommand): Promise<void> {
    const api = this.api;
    if (api === undefined) {
      return;
    }

    try {
      const state = DesktopWindowService.read(await api.invoke({ command }));
      this.state.set(state);
    } catch {
      // The main process is gone, or refused. Either way the window is not
      // ours to describe any more.
    }
  }

  /** Narrows whatever crossed the channel; anything odd reads as "not maximised". */
  private static read(value: unknown): DesktopWindowState {
    if (typeof value !== 'object' || value === null) {
      return CLOSED;
    }
    const { maximized, fullScreen } = value as Partial<DesktopWindowState>;
    return { maximized: maximized === true, fullScreen: fullScreen === true };
  }
}
