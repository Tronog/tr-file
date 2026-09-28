import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { UiGridNode } from '@tr-file/ui';
import { WorkbenchService } from '../workbench.service';
import { provideOnePanel } from '../testing/one-panel';

describe('PanelLayoutFeature', () => {
  let workbench: WorkbenchService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideOnePanel()],
    });
    workbench = TestBed.inject(WorkbenchService);
  });

  const children = (): readonly UiGridNode[] => {
    const root = workbench.panelLayoutFt.grid();
    return root.kind === 'split' ? root.children : [];
  };

  /** A row of three groups, which is what most of these cases start from. */
  const threeInARow = (): void => {
    workbench.panelLayoutFt.insertBeside('group-root', 'group-b', 'right');
    workbench.panelLayoutFt.insertBeside('group-b', 'group-c', 'right');
  };

  it('starts as the single leaf the session was seeded with', () => {
    expect(workbench.panelLayoutFt.grid()).toBe(workbench.mockWorkbench.layout.grid);
    expect(workbench.panelLayoutFt.groupIds()).toEqual(['group-root']);
    expect(workbench.panelLayoutFt.maximizedGroupId()).toBeNull();
  });

  describe('insertBeside', () => {
    it('turns a leaf into a split of itself and the newcomer', () => {
      workbench.panelLayoutFt.insertBeside('group-root', 'group-b', 'right');

      expect(workbench.panelLayoutFt.grid()).toEqual({
        kind: 'split',
        direction: 'row',
        size: 1,
        children: [
          { kind: 'leaf', groupId: 'group-root', size: 1 },
          { kind: 'leaf', groupId: 'group-b', size: 1 },
        ],
      });
    });

    it('inserts before the target when the zone points at the start of the axis', () => {
      workbench.panelLayoutFt.insertBeside('group-root', 'group-b', 'left');

      expect(workbench.panelLayoutFt.groupIds()).toEqual(['group-b', 'group-root']);
    });

    it('reuses the parent split when the direction matches, halving the target share', () => {
      threeInARow();

      expect(workbench.panelLayoutFt.groupIds()).toEqual(['group-root', 'group-b', 'group-c']);
      expect(children()).toEqual([
        { kind: 'leaf', groupId: 'group-root', size: 1 },
        { kind: 'leaf', groupId: 'group-b', size: 0.5 },
        { kind: 'leaf', groupId: 'group-c', size: 0.5 },
      ]);
    });

    it('wraps the leaf in a nested split when the direction does not match', () => {
      threeInARow();

      workbench.panelLayoutFt.insertBeside('group-b', 'group-d', 'bottom');

      expect(children()[1]).toEqual({
        kind: 'split',
        direction: 'column',
        size: 0.5,
        children: [
          { kind: 'leaf', groupId: 'group-b', size: 1 },
          { kind: 'leaf', groupId: 'group-d', size: 1 },
        ],
      });
      expect(workbench.panelLayoutFt.groupIds()).toEqual([
        'group-root',
        'group-b',
        'group-d',
        'group-c',
      ]);
    });

    it('leaves the tree alone when the target is not in it', () => {
      const before = workbench.panelLayoutFt.grid();

      workbench.panelLayoutFt.insertBeside('nope', 'group-b', 'right');

      expect(workbench.panelLayoutFt.grid()).toEqual(before);
    });
  });

  describe('remove', () => {
    it('drops the leaf and leaves its siblings alone', () => {
      threeInARow();

      workbench.panelLayoutFt.remove('group-c');

      expect(workbench.panelLayoutFt.groupIds()).toEqual(['group-root', 'group-b']);
      expect(children()[1]).toEqual({ kind: 'leaf', groupId: 'group-b', size: 0.5 });
    });

    it("collapses a split left with one child, the survivor taking the split's size", () => {
      workbench.panelLayoutFt.insertBeside('group-root', 'group-b', 'right');

      workbench.panelLayoutFt.remove('group-root');

      expect(workbench.panelLayoutFt.grid()).toEqual({ kind: 'leaf', groupId: 'group-b', size: 1 });
    });

    it('keeps the tree when removing the only group would empty it', () => {
      workbench.panelLayoutFt.remove('group-root');

      expect(workbench.panelLayoutFt.groupIds()).toEqual(['group-root']);
    });

    it('clears the maximized group when that group is the one removed', () => {
      threeInARow();
      workbench.panelLayoutFt.toggleMaximize('group-c');

      workbench.panelLayoutFt.remove('group-c');

      expect(workbench.panelLayoutFt.maximizedGroupId()).toBeNull();
    });
  });

  it('reset() replaces the layout with a single full-size leaf', () => {
    threeInARow();
    workbench.panelLayoutFt.toggleMaximize('group-root');

    workbench.panelLayoutFt.reset('group-only');

    expect(workbench.panelLayoutFt.grid()).toEqual({ kind: 'leaf', groupId: 'group-only', size: 1 });
    expect(workbench.panelLayoutFt.groupIds()).toEqual(['group-only']);
    expect(workbench.panelLayoutFt.maximizedGroupId()).toBeNull();
  });

  describe('resize', () => {
    it('writes both sizes of the addressed pair', () => {
      threeInARow();

      workbench.panelLayoutFt.resize({ path: [], index: 1, sizes: [0.25, 0.75] });

      expect(children().slice(1)).toEqual([
        { kind: 'leaf', groupId: 'group-b', size: 0.25 },
        { kind: 'leaf', groupId: 'group-c', size: 0.75 },
      ]);
    });

    it('addresses a nested split through its path', () => {
      threeInARow();
      workbench.panelLayoutFt.insertBeside('group-b', 'group-d', 'bottom');

      workbench.panelLayoutFt.resize({ path: [1], index: 0, sizes: [0.3, 0.7] });

      const nested = children()[1];
      expect(nested?.kind === 'split' ? nested.children : []).toEqual([
        { kind: 'leaf', groupId: 'group-b', size: 0.3 },
        { kind: 'leaf', groupId: 'group-d', size: 0.7 },
      ]);
    });

    it('refuses a pair that would squeeze a child below the minimum share', () => {
      threeInARow();
      const before = workbench.panelLayoutFt.grid();

      workbench.panelLayoutFt.resize({ path: [], index: 0, sizes: [0.05, 0.95] });

      expect(workbench.panelLayoutFt.grid()).toBe(before);
    });
  });

  describe('toggleMaximize', () => {
    it('maximizes, restores, and moves to another group', () => {
      threeInARow();

      expect(workbench.panelLayoutFt.isMaximized('group-b')).toBe(false);

      workbench.panelLayoutFt.toggleMaximize('group-b');

      expect(workbench.panelLayoutFt.maximizedGroupId()).toBe('group-b');
      expect(workbench.panelLayoutFt.isMaximized('group-b')).toBe(true);

      workbench.panelLayoutFt.toggleMaximize('group-c');

      expect(workbench.panelLayoutFt.isMaximized('group-b')).toBe(false);
      expect(workbench.panelLayoutFt.isMaximized('group-c')).toBe(true);

      workbench.panelLayoutFt.toggleMaximize('group-c');

      expect(workbench.panelLayoutFt.maximizedGroupId()).toBeNull();
    });
  });
});
