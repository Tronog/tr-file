import { computed } from '@angular/core';
import type { UiWindowControl } from '@tr-file/ui';
import type { WorkbenchService } from '../workbench.service';

/** Room left at the leading edge for macOS's traffic lights, in pixels. */
const TRAFFIC_LIGHT_INSET = 78;

/**
 * The window's own buttons, and the bar they live in (PRD 001, §8.2).
 *
 * The desktop shell runs without window decorations, so the title bar has to
 * supply what the frame used to: somewhere to drag the window by, and
 * minimise / maximise / close at its end — the way VS Code does it. This
 * feature decides what that looks like; `DesktopWindowService` is the seam
 * that can actually move a window, and `UiTitleBar` only draws what it is
 * handed.
 *
 * Three cases, and each one is a different answer:
 *
 * - **A browser tab.** No shell, no buttons, no drag region: the tab already
 *   has all three, and a drag region in a page would only break selection.
 * - **macOS.** The platform insists on drawing its own traffic lights over the
 *   bar, and nothing convincing can be drawn in their place — so the app draws
 *   none and leaves a gap for them instead.
 * - **Everywhere else.** The app draws all three, and the middle one wears
 *   Restore or Maximise depending on what the window is actually doing.
 */
export class WindowControlsFeature {
  constructor(private readonly parent: WorkbenchService) {}

  /** Starts following the window; called once, with the rest of the workbench. */
  start(): void {
    this.parent.desktopWindow.start();
  }

  /** Whether the title bar is what the window is dragged by. */
  readonly draggable = computed(() => this.parent.desktopWindow.isAvailable);

  /** Blank space reserved at the leading edge, for buttons we do not draw. */
  readonly leadingInset = computed(() => (this.isMac() ? TRAFFIC_LIGHT_INSET : 0));

  /** The buttons, in window order. Empty in a browser and on macOS. */
  readonly controls = computed<readonly UiWindowControl[]>(() => {
    if (!this.parent.desktopWindow.isAvailable || this.isMac()) {
      return [];
    }

    const maximized = this.parent.desktopWindow.state().maximized;
    return [
      { id: 'minimize', label: 'Minimize', icon: 'window-min' },
      maximized
        ? { id: 'toggleMaximize', label: 'Restore Down', icon: 'window-restore' }
        : { id: 'toggleMaximize', label: 'Maximize', icon: 'window-max' },
      { id: 'close', label: 'Close', icon: 'x', danger: true },
    ];
  });

  /** One of the buttons was pressed. */
  run(id: string): void {
    switch (id) {
      case 'minimize':
        this.parent.desktopWindow.minimize();
        break;
      case 'toggleMaximize':
        this.parent.desktopWindow.toggleMaximize();
        break;
      case 'close':
        this.parent.desktopWindow.close();
        break;
      default:
        break;
    }
  }

  /**
   * A double-click on the bar's empty space, which every desktop treats as
   * maximise/restore. Only ours to handle off macOS, where the platform does
   * it for the window itself and acting again would undo it.
   */
  toggleFromDragArea(): void {
    if (!this.parent.desktopWindow.isAvailable || this.isMac()) {
      return;
    }
    this.parent.desktopWindow.toggleMaximize();
  }

  private isMac(): boolean {
    return this.parent.desktopWindow.platform === 'darwin';
  }
}
