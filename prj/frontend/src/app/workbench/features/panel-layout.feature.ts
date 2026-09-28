import { computed, signal, type WritableSignal } from '@angular/core';
import type { UiDropZone, UiGridNode, UiGridSplit, UiSplitResize } from '@tr-file/ui';
import type { WorkbenchService } from '../workbench.service';

/** Smallest share a split child may be squeezed to when a sibling grows. */
const MIN_SHARE = 0.08;

/**
 * The editor layout tree.
 *
 * Splitting, moving and closing panels are all transformations of one
 * `UiGridNode`: every operation rebuilds the branch it touches and leaves the
 * rest alone, so the signal only notifies what actually changed. Two invariants
 * are maintained everywhere: a split always has at least two children (a split
 * left with one collapses into it), and a group id appears at most once.
 */
export class PanelLayoutFeature {
  private readonly tree: WritableSignal<UiGridNode>;
  private readonly maximized = signal<string | null>(null);

  constructor(parent: WorkbenchService) {
    this.tree = signal(parent.layout.grid);
  }

  /** The layout rendered by `ui-panel-grid`. */
  readonly grid = computed(() => this.tree());

  /** Group rendered alone, hiding the rest of the layout; `null` when none. */
  readonly maximizedGroupId = computed(() => this.maximized());

  /** Group ids in layout order — left to right, top to bottom. */
  readonly groupIds = computed(() => this.leaves(this.tree()));

  isMaximized(groupId: string): boolean {
    return this.maximized() === groupId;
  }

  toggleMaximize(groupId: string): void {
    this.maximized.update((current) => (current === groupId ? null : groupId));
  }

  /**
   * Places `newGroupId` next to `targetGroupId` on the given side. Reuses the
   * parent split when the direction already matches, so dividing a row three
   * times gives three siblings rather than nested pairs.
   */
  insertBeside(targetGroupId: string, newGroupId: string, zone: Exclude<UiDropZone, 'center'>): void {
    const direction = zone === 'left' || zone === 'right' ? 'row' : 'column';
    const after = zone === 'right' || zone === 'bottom';
    this.tree.update((node) => this.insert(node, targetGroupId, newGroupId, direction, after));
  }

  /**
   * Drops a group from the layout, collapsing any split left with one child.
   * Removing the only group would leave nothing to render, so the tree is kept
   * as it is — emptying the workbench goes through `reset` instead.
   */
  remove(groupId: string): void {
    this.maximized.update((current) => (current === groupId ? null : current));
    this.tree.update((node) => this.prune(node, groupId) ?? node);
  }

  /** Replaces the whole layout with a single group — used when the last one closes. */
  reset(groupId: string): void {
    this.maximized.set(null);
    this.tree.set({ kind: 'leaf', groupId, size: 1 });
  }

  /** Applies a sash drag: the two children swap share, everything else holds. */
  resize({ path, index, sizes }: UiSplitResize): void {
    const [first, second] = sizes;
    if (first < MIN_SHARE || second < MIN_SHARE) {
      return;
    }
    this.tree.update((node) => this.applySizes(node, path, index, first, second));
  }

  /* -- tree helpers ------------------------------------------------------ */

  private leaves(node: UiGridNode): readonly string[] {
    return node.kind === 'leaf' ? [node.groupId] : node.children.flatMap((child) => this.leaves(child));
  }

  private insert(
    node: UiGridNode,
    targetGroupId: string,
    newGroupId: string,
    direction: UiGridSplit['direction'],
    after: boolean,
  ): UiGridNode {
    if (node.kind === 'leaf') {
      if (node.groupId !== targetGroupId) {
        return node;
      }
      // The leaf becomes a split of itself and the newcomer, inheriting its share.
      const target: UiGridNode = { kind: 'leaf', groupId: node.groupId, size: 1 };
      const fresh: UiGridNode = { kind: 'leaf', groupId: newGroupId, size: 1 };
      return {
        kind: 'split',
        direction,
        ...(node.size === undefined ? {} : { size: node.size }),
        children: after ? [target, fresh] : [fresh, target],
      };
    }

    const index = node.children.findIndex(
      (child) => child.kind === 'leaf' && child.groupId === targetGroupId,
    );

    if (index === -1 || node.direction !== direction) {
      return { ...node, children: node.children.map((child) => this.insert(child, targetGroupId, newGroupId, direction, after)) };
    }

    // Same axis as the parent: become a sibling and halve the target's share.
    const target = node.children[index];
    if (!target) {
      return node;
    }
    const half = (target.size ?? 1) / 2;
    const shrunk: UiGridNode = { ...target, size: half };
    const fresh: UiGridNode = { kind: 'leaf', groupId: newGroupId, size: half };
    const children = [...node.children];
    children.splice(index, 1, ...(after ? [shrunk, fresh] : [fresh, shrunk]));
    return { ...node, children };
  }

  private prune(node: UiGridNode, groupId: string): UiGridNode | null {
    if (node.kind === 'leaf') {
      return node.groupId === groupId ? null : node;
    }

    // A child that goes gives its share to the one beside it — the one before, or the one after when
    // it was first: the panel it was split from gets its room back, and splitting a panel and closing
    // it again leaves the layout as it was, the others as they were.
    const children: UiGridNode[] = [];
    let unclaimed = 0;
    for (const child of node.children) {
      const kept = this.prune(child, groupId);
      if (kept === null) {
        const share = child.size ?? 1;
        const before = children.pop();
        if (before === undefined) {
          unclaimed += share;
        } else {
          children.push({ ...before, size: (before.size ?? 1) + share });
        }
        continue;
      }
      children.push(unclaimed === 0 ? kept : { ...kept, size: (kept.size ?? 1) + unclaimed });
      unclaimed = 0;
    }

    if (children.length === 0) {
      return null;
    }
    if (children.length === 1) {
      // A split needs two children; the survivor takes the split's own share.
      const survivor = children[0] as UiGridNode;
      return { ...survivor, ...(node.size === undefined ? {} : { size: node.size }) };
    }
    return { ...node, children };
  }

  private applySizes(
    node: UiGridNode,
    path: readonly number[],
    index: number,
    first: number,
    second: number,
  ): UiGridNode {
    if (node.kind !== 'split') {
      return node;
    }

    const [step, ...rest] = path;
    if (step !== undefined) {
      const child = node.children[step];
      if (!child) {
        return node;
      }
      const children = [...node.children];
      children[step] = this.applySizes(child, rest, index, first, second);
      return { ...node, children };
    }

    const left = node.children[index];
    const right = node.children[index + 1];
    if (!left || !right) {
      return node;
    }
    const children = [...node.children];
    children[index] = { ...left, size: first };
    children[index + 1] = { ...right, size: second };
    return { ...node, children };
  }
}
