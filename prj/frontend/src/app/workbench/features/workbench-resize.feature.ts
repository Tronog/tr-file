import type { UiSashResize } from '@tr-file/ui';
import type { WorkbenchService } from '../workbench.service';

/** Pixel bounds for the resizable regions, mirroring VS Code's own limits. */
const LEFT = { min: 170, max: 600 } as const;
const RIGHT = { min: 200, max: 640 } as const;
const PANEL = { min: 80, max: 720 } as const;

function clamp(value: number, { min, max }: { min: number; max: number }): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Dragging the borders of the workbench regions.
 *
 * Sashes report pixel deltas; the sizes themselves live on the service because
 * more than one feature reads them. Note the sign flips: the right sidebar and
 * the bottom panel grow when their sash travels towards the origin.
 */
export class WorkbenchResizeFeature {
  constructor(private readonly parent: WorkbenchService) {}

  readonly leftBounds = LEFT;
  readonly rightBounds = RIGHT;

  resizeLeftSidebar(event: UiSashResize): void {
    if (event.phase !== 'move') {
      return;
    }
    this.parent.leftSidebarWidth.update((width) => clamp(width + event.delta, LEFT));
  }

  resizeRightSidebar(event: UiSashResize): void {
    if (event.phase !== 'move') {
      return;
    }
    this.parent.rightSidebarWidth.update((width) => clamp(width - event.delta, RIGHT));
  }

  resizeBottomPanel(event: UiSashResize): void {
    if (event.phase !== 'move') {
      return;
    }
    this.parent.bottomPanelHeight.update((height) => clamp(height - event.delta, PANEL));
  }
}
