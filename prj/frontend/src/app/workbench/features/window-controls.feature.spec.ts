import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { settled } from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';

/**
 * PRD 001, §8.2 — what the window's buttons are, on each of the three hosts
 * the app runs on. The preload is stubbed, so this covers the frontend half:
 * which buttons exist, which icon the middle one wears, and what a press does.
 */

interface State {
  maximized: boolean;
  fullScreen: boolean;
  zoom?: number;
}

/** Stands in for the preload's `window.trFileWindow`. */
class FakeWindowApi {
  readonly version = 1;
  readonly sent: string[] = [];
  readonly factors: number[] = [];

  state: State = { maximized: false, fullScreen: false };

  private listener: ((state: unknown) => void) | undefined;

  constructor(readonly platform: string) {}

  invoke = async (request: { command: string; factor?: number }): Promise<State> => {
    this.sent.push(request.command);
    if (request.factor !== undefined) {
      this.factors.push(request.factor);
      this.state = { ...this.state, zoom: request.factor };
    }
    if (request.command === 'toggleMaximize') {
      this.state = { ...this.state, maximized: !this.state.maximized };
    }
    return this.state;
  };

  onState = (listener: (state: unknown) => void): (() => void) => {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  };

  /** The window maximised itself — an OS snap, a keyboard shortcut. */
  push(state: State): void {
    this.state = state;
    this.listener?.(state);
  }

  get listening(): boolean {
    return this.listener !== undefined;
  }
}

function installWindowApi(api: FakeWindowApi | undefined): void {
  Object.defineProperty(window, 'trFileWindow', {
    value: api,
    configurable: true,
    writable: true,
  });
}

/** A workbench with the given host, started far enough to follow the window. */
function bootstrap(api: FakeWindowApi | undefined): WorkbenchService {
  installWindowApi(api);
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const workbench = TestBed.inject(WorkbenchService);
  workbench.windowControlsFt.start();
  return workbench;
}

afterEach(() => {
  installWindowApi(undefined);
  TestBed.inject(HttpTestingController).verify();
});

describe('WindowControlsFeature in a browser', () => {
  let workbench: WorkbenchService;

  beforeEach(() => {
    workbench = bootstrap(undefined);
  });

  /** The tab already has a title bar, buttons and a way to be dragged. */
  it('draws nothing and claims no drag region', () => {
    const controls = workbench.windowControlsFt;

    expect(controls.controls()).toEqual([]);
    expect(controls.draggable()).toBe(false);
    expect(controls.leadingInset()).toBe(0);
  });

  it('has no zoom control: the browser zooms its own page (PRD 001, §8.2.3)', () => {
    expect(workbench.windowControlsFt.zoom()).toBeNull();
    expect(workbench.commandsFt.isEnabled('view.zoomIn', workbench.commandsFt.activeTarget())).toBe(false);
  });

  it('does nothing when asked to act on a window it does not have', () => {
    expect(() => {
      workbench.windowControlsFt.run('close');
      workbench.windowControlsFt.toggleFromDragArea();
    }).not.toThrow();
  });
});

describe('WindowControlsFeature in the desktop shell', () => {
  let api: FakeWindowApi;
  let workbench: WorkbenchService;

  beforeEach(async () => {
    api = new FakeWindowApi('linux');
    workbench = bootstrap(api);
    await settled();
  });

  const labels = (): readonly string[] =>
    workbench.windowControlsFt.controls().map((control) => control.label);

  it('draws minimise, maximise and close, and takes the drag region', () => {
    expect(labels()).toEqual(['Minimize', 'Maximize', 'Close']);
    expect(workbench.windowControlsFt.draggable()).toBe(true);
    expect(workbench.windowControlsFt.leadingInset()).toBe(0);
  });

  it('marks only close as dangerous', () => {
    expect(workbench.windowControlsFt.controls().map((control) => control.danger)).toEqual([
      undefined,
      undefined,
      true,
    ]);
  });

  it('asks its state as soon as it starts following the window', () => {
    expect(api.sent).toEqual(['state']);
    expect(api.listening).toBe(true);
  });

  it('sends each button through to the window', async () => {
    workbench.windowControlsFt.run('minimize');
    workbench.windowControlsFt.run('close');
    await settled();

    expect(api.sent).toEqual(['state', 'minimize', 'close']);
  });

  it('swaps the middle button for Restore once the window is maximised', async () => {
    workbench.windowControlsFt.run('toggleMaximize');
    await settled();

    expect(labels()).toEqual(['Minimize', 'Restore Down', 'Close']);
    expect(workbench.windowControlsFt.controls()[1].icon).toBe('window-restore');

    workbench.windowControlsFt.run('toggleMaximize');
    await settled();

    expect(labels()).toEqual(['Minimize', 'Maximize', 'Close']);
  });

  /**
   * The OS can maximise a window with nobody pressing anything — a snap
   * gesture, a shortcut, a drag to the top of the screen.
   */
  it('follows the window when it maximises itself', () => {
    api.push({ maximized: true, fullScreen: false });

    expect(labels()).toEqual(['Minimize', 'Restore Down', 'Close']);
  });

  it('treats a double-click on the bar as maximise', async () => {
    workbench.windowControlsFt.toggleFromDragArea();
    await settled();

    expect(api.sent).toEqual(['state', 'toggleMaximize']);
    expect(labels()).toEqual(['Minimize', 'Restore Down', 'Close']);
  });

  it('shows the window zoom, and sends each zoom request through (PRD 001, §8.2.3)', async () => {
    expect(workbench.windowControlsFt.zoom()).toEqual({ percent: 100, min: 50, max: 300 });

    workbench.windowControlsFt.zoomTo({ kind: 'set', percent: 125 });
    await settled();
    expect(api.factors).toEqual([1.25]);
    expect(workbench.windowControlsFt.zoom()?.percent).toBe(125);

    workbench.windowControlsFt.zoomTo({ kind: 'in' });
    workbench.windowControlsFt.zoomTo({ kind: 'out' });
    workbench.commandsFt.run('view.resetZoom');
    await settled();
    expect(api.sent).toEqual(['state', 'setZoom', 'zoomIn', 'zoomOut', 'resetZoom']);

    // Zoomed by the keys of the main process's menu: the control follows.
    api.push({ maximized: false, fullScreen: false, zoom: 0.9 });
    expect(workbench.windowControlsFt.zoom()?.percent).toBe(90);
    expect(workbench.commandsFt.menuItem('view.zoomIn').keybinding).toBe('Ctrl+=');
  });

  it('ignores a button it does not know', async () => {
    workbench.windowControlsFt.run('self-destruct');
    await settled();

    expect(api.sent).toEqual(['state']);
  });
});

describe('WindowControlsFeature on macOS', () => {
  let api: FakeWindowApi;
  let workbench: WorkbenchService;

  beforeEach(async () => {
    api = new FakeWindowApi('darwin');
    workbench = bootstrap(api);
    await settled();
  });

  /**
   * The platform draws its own traffic lights over the bar and nothing
   * convincing can be drawn in their place, so the app draws none.
   */
  it('draws no buttons but still leaves room for the traffic lights', () => {
    expect(workbench.windowControlsFt.controls()).toEqual([]);
    expect(workbench.windowControlsFt.leadingInset()).toBeGreaterThan(0);
    // The bar is still what the window is dragged by.
    expect(workbench.windowControlsFt.draggable()).toBe(true);
  });

  /** macOS maximises on a title-bar double-click itself; acting would undo it. */
  it('leaves the double-click to the platform', async () => {
    workbench.windowControlsFt.toggleFromDragArea();
    await settled();

    expect(api.sent).toEqual(['state']);
  });
});
