import type { UiGridNode } from '../models';
import { UiPanelLayout } from './ui-panel-layout';

describe('UiPanelLayout', () => {
  const start: UiGridNode = { kind: 'leaf', groupId: 'group-root', size: 1 };
  let layout: UiPanelLayout;

  beforeEach(() => {
    layout = new UiPanelLayout(start);
  });

  const children = (): readonly UiGridNode[] => {
    const root = layout.grid();
    return root.kind === 'split' ? root.children : [];
  };

  /** A row of three groups, which is what most of these cases start from. */
  const threeInARow = (): void => {
    layout.insertBeside('group-root', 'group-b', 'right');
    layout.insertBeside('group-b', 'group-c', 'right');
  };

  it('starts as the single leaf the session was seeded with', () => {
    expect(layout.grid()).toBe(start);
    expect(layout.groupIds()).toEqual(['group-root']);
    expect(layout.maximizedGroupId()).toBeNull();
  });

  describe('insertBeside', () => {
    it('turns a leaf into a split of itself and the newcomer', () => {
      layout.insertBeside('group-root', 'group-b', 'right');

      expect(layout.grid()).toEqual({
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
      layout.insertBeside('group-root', 'group-b', 'left');

      expect(layout.groupIds()).toEqual(['group-b', 'group-root']);
    });

    it('reuses the parent split when the direction matches, halving the target share', () => {
      threeInARow();

      expect(layout.groupIds()).toEqual(['group-root', 'group-b', 'group-c']);
      expect(children()).toEqual([
        { kind: 'leaf', groupId: 'group-root', size: 1 },
        { kind: 'leaf', groupId: 'group-b', size: 0.5 },
        { kind: 'leaf', groupId: 'group-c', size: 0.5 },
      ]);
    });

    it('wraps the leaf in a nested split when the direction does not match', () => {
      threeInARow();

      layout.insertBeside('group-b', 'group-d', 'bottom');

      expect(children()[1]).toEqual({
        kind: 'split',
        direction: 'column',
        size: 0.5,
        children: [
          { kind: 'leaf', groupId: 'group-b', size: 1 },
          { kind: 'leaf', groupId: 'group-d', size: 1 },
        ],
      });
      expect(layout.groupIds()).toEqual([
        'group-root',
        'group-b',
        'group-d',
        'group-c',
      ]);
    });

    it('leaves the tree alone when the target is not in it', () => {
      const before = layout.grid();

      layout.insertBeside('nope', 'group-b', 'right');

      expect(layout.grid()).toEqual(before);
    });
  });

  describe('remove', () => {
    it('drops the leaf and gives its share to the one beside it — the panel it was split from', () => {
      threeInARow();

      layout.remove('group-c');

      expect(layout.groupIds()).toEqual(['group-root', 'group-b']);
      expect(children()[0]).toMatchObject({ groupId: 'group-root', size: 1 });
      expect(children()[1]).toEqual({ kind: 'leaf', groupId: 'group-b', size: 1 });
    });

    it('leaves the layout as it was when a panel split off is closed again', () => {
      threeInARow();
      const before = layout.grid();

      layout.insertBeside('group-b', 'group-d', 'right');
      layout.remove('group-d');
      expect(layout.grid()).toEqual(before);

      // Split to the left, the newcomer first: its share goes to the one after it.
      layout.insertBeside('group-root', 'group-e', 'left');
      layout.remove('group-e');
      expect(layout.grid()).toEqual(before);
    });

    it("collapses a split left with one child, the survivor taking the split's size", () => {
      layout.insertBeside('group-root', 'group-b', 'right');

      layout.remove('group-root');

      expect(layout.grid()).toEqual({ kind: 'leaf', groupId: 'group-b', size: 1 });
    });

    it('keeps the tree when removing the only group would empty it', () => {
      layout.remove('group-root');

      expect(layout.groupIds()).toEqual(['group-root']);
    });

    it('clears the maximized group when that group is the one removed', () => {
      threeInARow();
      layout.toggleMaximize('group-c');

      layout.remove('group-c');

      expect(layout.maximizedGroupId()).toBeNull();
    });
  });

  it('reset() replaces the layout with a single full-size leaf', () => {
    threeInARow();
    layout.toggleMaximize('group-root');

    layout.reset('group-only');

    expect(layout.grid()).toEqual({ kind: 'leaf', groupId: 'group-only', size: 1 });
    expect(layout.groupIds()).toEqual(['group-only']);
    expect(layout.maximizedGroupId()).toBeNull();
  });

  describe('resize', () => {
    it('writes both sizes of the addressed pair', () => {
      threeInARow();

      layout.resize({ path: [], index: 1, sizes: [0.25, 0.75] });

      expect(children().slice(1)).toEqual([
        { kind: 'leaf', groupId: 'group-b', size: 0.25 },
        { kind: 'leaf', groupId: 'group-c', size: 0.75 },
      ]);
    });

    it('addresses a nested split through its path', () => {
      threeInARow();
      layout.insertBeside('group-b', 'group-d', 'bottom');

      layout.resize({ path: [1], index: 0, sizes: [0.3, 0.7] });

      const nested = children()[1];
      expect(nested?.kind === 'split' ? nested.children : []).toEqual([
        { kind: 'leaf', groupId: 'group-b', size: 0.3 },
        { kind: 'leaf', groupId: 'group-d', size: 0.7 },
      ]);
    });

    it('refuses a pair that would squeeze a child below the minimum share', () => {
      threeInARow();
      const before = layout.grid();

      layout.resize({ path: [], index: 0, sizes: [0.05, 0.95] });

      expect(layout.grid()).toBe(before);
    });
  });

  describe('toggleMaximize', () => {
    it('maximizes, restores, and moves to another group', () => {
      threeInARow();

      expect(layout.isMaximized('group-b')).toBe(false);

      layout.toggleMaximize('group-b');

      expect(layout.maximizedGroupId()).toBe('group-b');
      expect(layout.isMaximized('group-b')).toBe(true);

      layout.toggleMaximize('group-c');

      expect(layout.isMaximized('group-b')).toBe(false);
      expect(layout.isMaximized('group-c')).toBe(true);

      layout.toggleMaximize('group-c');

      expect(layout.maximizedGroupId()).toBeNull();
    });
  });
});
