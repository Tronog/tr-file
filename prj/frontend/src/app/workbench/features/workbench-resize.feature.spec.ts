import { TestBed } from '@angular/core/testing';
import type { UiSashResize } from '@tr-file/ui';
import { WorkbenchService } from '../workbench.service';

describe('WorkbenchResizeFeature', () => {
  let workbench: WorkbenchService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    workbench = TestBed.inject(WorkbenchService);
  });

  const move = (delta: number): UiSashResize => ({ delta, phase: 'move' });

  it('applies deltas only while the drag is moving', () => {
    workbench.resizeFt.resizeLeftSidebar({ delta: 40, phase: 'start' });
    workbench.resizeFt.resizeLeftSidebar({ delta: 40, phase: 'end' });

    expect(workbench.leftSidebarWidth()).toBe(280);

    workbench.resizeFt.resizeLeftSidebar(move(40));

    expect(workbench.leftSidebarWidth()).toBe(320);
  });

  it('grows the right sidebar as its sash travels towards the origin', () => {
    workbench.resizeFt.resizeRightSidebar(move(-40));

    expect(workbench.rightSidebarWidth()).toBe(360);

    workbench.resizeFt.resizeRightSidebar(move(40));

    expect(workbench.rightSidebarWidth()).toBe(320);
  });

  it('grows the bottom panel as its sash travels upwards', () => {
    workbench.resizeFt.resizeBottomPanel(move(-50));

    expect(workbench.bottomPanelHeight()).toBe(250);

    workbench.resizeFt.resizeBottomPanel(move(50));

    expect(workbench.bottomPanelHeight()).toBe(200);
  });

  it('clamps the left sidebar at its bounds', () => {
    workbench.resizeFt.resizeLeftSidebar(move(1000));

    expect(workbench.leftSidebarWidth()).toBe(workbench.resizeFt.leftBounds.max);

    workbench.resizeFt.resizeLeftSidebar(move(-1000));

    expect(workbench.leftSidebarWidth()).toBe(workbench.resizeFt.leftBounds.min);
  });

  it('clamps the right sidebar at its bounds', () => {
    workbench.resizeFt.resizeRightSidebar(move(-1000));

    expect(workbench.rightSidebarWidth()).toBe(workbench.resizeFt.rightBounds.max);

    workbench.resizeFt.resizeRightSidebar(move(1000));

    expect(workbench.rightSidebarWidth()).toBe(workbench.resizeFt.rightBounds.min);
  });

  it('clamps the bottom panel at its bounds', () => {
    workbench.resizeFt.resizeBottomPanel(move(-1000));

    expect(workbench.bottomPanelHeight()).toBe(720);

    workbench.resizeFt.resizeBottomPanel(move(1000));

    expect(workbench.bottomPanelHeight()).toBe(80);
  });
});
