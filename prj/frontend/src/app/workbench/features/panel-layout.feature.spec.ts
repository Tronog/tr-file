import { TestBed } from '@angular/core/testing';
import type { UiGridNode } from '@tr-file/ui';
import { WorkbenchService } from '../workbench.service';

describe('PanelLayoutFeature', () => {
  let workbench: WorkbenchService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    workbench = TestBed.inject(WorkbenchService);
  });

  /** Children of the root split, which the mock seeds as a row. */
  const rootChildren = (): readonly UiGridNode[] => {
    const root = workbench.panelLayoutFt.grid();
    return root.kind === 'split' ? root.children : [];
  };

  it('lists the group ids left to right, top to bottom', () => {
    expect(workbench.panelLayoutFt.groupIds()).toEqual(['group-prj', 'group-docs', 'group-assets']);
  });

  describe('insertBeside', () => {
    it('reuses the parent split when the direction matches, halving the target share', () => {
      workbench.panelLayoutFt.insertBeside('group-prj', 'group-new', 'right');

      expect(rootChildren().slice(0, 2)).toEqual([
        { kind: 'leaf', groupId: 'group-prj', size: 0.5 },
        { kind: 'leaf', groupId: 'group-new', size: 0.5 },
      ]);
      expect(workbench.panelLayoutFt.groupIds()).toEqual([
        'group-prj',
        'group-new',
        'group-docs',
        'group-assets',
      ]);
    });

    it('inserts before the target when the zone points at the start of the axis', () => {
      workbench.panelLayoutFt.insertBeside('group-prj', 'group-new', 'left');

      expect(workbench.panelLayoutFt.groupIds()).toEqual([
        'group-new',
        'group-prj',
        'group-docs',
        'group-assets',
      ]);
    });

    it('wraps the leaf in a new split when the direction does not match', () => {
      workbench.panelLayoutFt.insertBeside('group-docs', 'group-new', 'left');

      expect(rootChildren()[1]).toEqual({
        kind: 'split',
        direction: 'column',
        size: 1,
        children: [
          {
            kind: 'split',
            direction: 'row',
            size: 1,
            children: [
              { kind: 'leaf', groupId: 'group-new', size: 1 },
              { kind: 'leaf', groupId: 'group-docs', size: 1 },
            ],
          },
          { kind: 'leaf', groupId: 'group-assets', size: 1 },
        ],
      });
    });
  });

  describe('remove', () => {
    it('drops the leaf and leaves the other children alone', () => {
      workbench.panelLayoutFt.insertBeside('group-prj', 'group-new', 'right');

      workbench.panelLayoutFt.remove('group-new');

      expect(rootChildren()[0]).toEqual({ kind: 'leaf', groupId: 'group-prj', size: 0.5 });
      expect(workbench.panelLayoutFt.groupIds()).toEqual(['group-prj', 'group-docs', 'group-assets']);
    });

    it('collapses a split left with one child, the survivor taking the split\'s size', () => {
      workbench.panelLayoutFt.resize({ path: [], index: 0, sizes: [0.3, 0.7] });

      workbench.panelLayoutFt.remove('group-assets');

      expect(rootChildren()).toEqual([
        { kind: 'leaf', groupId: 'group-prj', size: 0.3 },
        { kind: 'leaf', groupId: 'group-docs', size: 0.7 },
      ]);
    });

    it('clears the maximized group when that group is the one removed', () => {
      workbench.panelLayoutFt.toggleMaximize('group-assets');

      workbench.panelLayoutFt.remove('group-assets');

      expect(workbench.panelLayoutFt.maximizedGroupId()).toBeNull();
    });
  });

  it('reset() replaces the layout with a single full-size leaf', () => {
    workbench.panelLayoutFt.toggleMaximize('group-prj');

    workbench.panelLayoutFt.reset('group-only');

    expect(workbench.panelLayoutFt.grid()).toEqual({ kind: 'leaf', groupId: 'group-only', size: 1 });
    expect(workbench.panelLayoutFt.groupIds()).toEqual(['group-only']);
    expect(workbench.panelLayoutFt.maximizedGroupId()).toBeNull();
  });

  describe('resize', () => {
    it('writes both sizes of the addressed pair', () => {
      workbench.panelLayoutFt.resize({ path: [1], index: 0, sizes: [0.25, 0.75] });

      expect(rootChildren()[1]).toMatchObject({
        kind: 'split',
        children: [
          { kind: 'leaf', groupId: 'group-docs', size: 0.25 },
          { kind: 'leaf', groupId: 'group-assets', size: 0.75 },
        ],
      });
    });

    it('refuses a pair that would squeeze a child below the minimum share', () => {
      const before = workbench.panelLayoutFt.grid();

      workbench.panelLayoutFt.resize({ path: [], index: 0, sizes: [0.05, 0.95] });

      expect(workbench.panelLayoutFt.grid()).toBe(before);
    });
  });

  describe('toggleMaximize', () => {
    it('maximizes, restores, and moves to another group', () => {
      expect(workbench.panelLayoutFt.isMaximized('group-docs')).toBe(false);

      workbench.panelLayoutFt.toggleMaximize('group-docs');

      expect(workbench.panelLayoutFt.maximizedGroupId()).toBe('group-docs');
      expect(workbench.panelLayoutFt.isMaximized('group-docs')).toBe(true);

      workbench.panelLayoutFt.toggleMaximize('group-assets');

      expect(workbench.panelLayoutFt.isMaximized('group-docs')).toBe(false);
      expect(workbench.panelLayoutFt.isMaximized('group-assets')).toBe(true);

      workbench.panelLayoutFt.toggleMaximize('group-assets');

      expect(workbench.panelLayoutFt.maximizedGroupId()).toBeNull();
    });
  });
});
