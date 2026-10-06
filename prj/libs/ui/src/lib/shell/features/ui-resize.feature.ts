import type { UiSashResize } from '../../models/interaction.model';
import type { UiWorkbenchService } from '../ui-workbench.service';

/** Pixel bounds for the resizable regions, mirroring VS Code's own limits, unless the configuration says otherwise. */
const LEFT = { min: 170, max: 600 } as const;
const RIGHT = { min: 200, max: 640 } as const;
const PANEL = { min: 80, max: 720 } as const;

interface Bounds {
  readonly min: number;
  readonly max: number;
}

function clamp(value: number, { min, max }: Bounds): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Dragging the borders of the workbench regions.
 *
 * Sashes report pixel deltas; the sizes themselves live on the service because
 * more than one feature reads them. Note the sign flips: the right sidebar and
 * the bottom panel grow when their sash travels towards the origin.
 */
export class UiResizeFeature {
  readonly leftBounds: Bounds;
  readonly rightBounds: Bounds;
  readonly bottomBounds: Bounds;

  constructor(protected readonly parent: UiWorkbenchService) {
    this.leftBounds = parent.config.sizes?.left ?? LEFT;
    this.rightBounds = parent.config.sizes?.right ?? RIGHT;
    this.bottomBounds = parent.config.sizes?.bottom ?? PANEL;
  }

  resizeLeftSidebar(event: UiSashResize): void {
    if (event.phase === 'move') {
      this.parent.leftSidebarWidth.update((width) => clamp(width + event.delta, this.leftBounds));
    }
  }

  resizeRightSidebar(event: UiSashResize): void {
    if (event.phase === 'move') {
      this.parent.rightSidebarWidth.update((width) => clamp(width - event.delta, this.rightBounds));
    }
  }

  resizeBottomPanel(event: UiSashResize): void {
    if (event.phase === 'move') {
      this.parent.bottomPanelHeight.update((height) => clamp(height - event.delta, this.bottomBounds));
    }
  }
}
