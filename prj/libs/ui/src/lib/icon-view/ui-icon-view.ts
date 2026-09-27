import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  signal,
  viewChildren,
} from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import { isTypeaheadKey, pageStep, UiTypeahead } from '../keyboard/list-navigation';
import { UiKeymap } from '../keyboard/keymap';
import { LIST_PANEL_KEYS, listCommandFor, listKeyShortcuts, type UiListCommand } from '../keyboard/list-keys';
import { clickMode, moveMode, UiListSelection, type UiSelectMode } from '../keyboard/list-selection';
import type { UiIconViewItem, UiPanelKey, UiSelectionChange } from '../models';
import { UiVirtualViewport, VIRTUAL_THRESHOLD, visibleRange } from '../virtual/ui-virtual-viewport';

/** The grid's `gap` and `padding`, as the stylesheet sets them. */
const GAP = 4;
const PADDING = 10;

/** One visual row of tiles, gap included, until one has been measured. */
const DEFAULT_LINE_HEIGHT = 84;

/** A press that moves less than this is a click, not the start of a box. */
const DRAG_THRESHOLD = 4;

/** How close to the scroll container's edge a box drag starts scrolling it. */
const AUTOSCROLL_EDGE = 24;
const AUTOSCROLL_STEP = 20;

/** A rectangle in the host's own coordinates, which scroll with the tiles. */
interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A box selection in progress. */
interface MarqueeDrag {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  /** What stays selected whatever the box covers: nothing, or — with `Ctrl` or `Shift` — what already was. */
  readonly base: ReadonlySet<string>;
  dragging: boolean;
  /** The last selection reported, so an unchanged box reports nothing. */
  lastKey: string;
}

/**
 * The "large icons" view of a directory: an auto-filling grid of 96px tiles.
 *
 * Exposed as a listbox rather than a grid because selection, not spatial
 * position, is what the control is about.
 *
 * Its keyboard (PRD 001, Section 6.2) is the list's, bent around the layout:
 * `←`/`→` step one tile, `↑`/`↓` step one *visual row*, and since the number
 * of columns is whatever the container's width allows, it is measured from the
 * rendered tiles rather than assumed. Letters jump to a name, and selection
 * follows focus exactly as it does in the list view. The keys that mean
 * something to the workbench leave as a `UiPanelKey` for the app to decide,
 * again as in the list view.
 *
 * A long folder renders only the visual rows near the viewport (PRD 003, §1),
 * as the list view does: a full-width spacer stands in above and below, and
 * a key that moves off the rendered tiles scrolls there and focuses the tile
 * once it exists.
 *
 * Selection is multiple (PRD 004, §1.2), exactly as in the list view — see
 * `UiListSelection`, Midnight Commander's `Insert`, `*`, `+` and `-` (§2)
 * included, and the first tile taking focus and the selection when focus is
 * handed in with nothing selected (PRD 002, §3.1) — and the grid adds a *box selection*: dragging across the
 * blank space between and around the tiles selects every tile the box
 * touches, added to the selection when `Ctrl` or `Shift` is held; a plain
 * click on blank space clears it. The box is hit-tested against the grid's
 * geometry rather than against rendered tiles, so it reaches tiles the window
 * has not rendered, and dragging near the edge of the panel scrolls it.
 */
@Component({
  selector: 'ui-icon-view',
  imports: [UiIcon],
  template: `
    @if (spaceAbove() > 0) {
      <div class="spacer" aria-hidden="true" [style.height.px]="spaceAbove()"></div>
    }
    @for (item of visibleItems(); track item.id; let offset = $index) {
      @let index = range().start + offset;
      <button
        #tile
        type="button"
        class="item"
        role="option"
        [attr.data-item-id]="item.id"
        [class.is-selected]="item.selected"
        [class.is-cut]="item.cut"
        [class.is-drop-target]="item.id === dropTargetId()"
        [attr.draggable]="draggable() ? 'true' : null"
        [attr.aria-selected]="item.selected ? 'true' : 'false'"
        [attr.aria-posinset]="virtual() ? index + 1 : null"
        [attr.aria-setsize]="virtual() ? items().length : null"
        [attr.aria-keyshortcuts]="keyShortcuts()"
        [attr.tabindex]="item.id === tabStopId() ? 0 : -1"
        [attr.title]="item.label"
        (click)="onClick($event, index)"
        (dblclick)="activate.emit(item.id)"
        (keydown)="onKeydown($event, index)"
        (pointerdown)="pressing = true"
        (pointerup)="pressing = false"
        (pointercancel)="pressing = false"
        (focus)="onFocusArrived()"
      >
        @if (item.thumbnail; as thumbnail) {
          <img class="item-thumbnail" alt="" draggable="false" decoding="async" [src]="thumbnail" />
        } @else {
          <ui-icon [name]="item.icon" [tint]="item.tint" size="xl" />
        }
        <span class="item-label">{{ item.label }}</span>
      </button>
    }
    @if (spaceBelow() > 0) {
      <div class="spacer" aria-hidden="true" [style.height.px]="spaceBelow()"></div>
    }
    @if (marquee(); as box) {
      <div
        class="marquee"
        aria-hidden="true"
        [style.left.px]="box.left"
        [style.top.px]="box.top"
        [style.width.px]="box.width"
        [style.height.px]="box.height"
      ></div>
    }
  `,
  styleUrl: './ui-icon-view.scss',
  host: {
    role: 'listbox',
    '[attr.aria-label]': 'label()',
    'aria-multiselectable': 'true',
    '(pointerdown)': 'onPointerDown($event)',
    '(pointermove)': 'onPointerMove($event)',
    '(pointerup)': 'onPointerUp($event)',
    '(pointercancel)': 'endMarquee($event)',
  },
})
export class UiIconView {
  readonly items = input.required<readonly UiIconViewItem[]>();

  /** Accessible name of the listbox. */
  readonly label = input<string>('Files');

  /** Tiles may be dragged (PRD 005, §2); `UiFileBrowser` handles the drag. */
  readonly draggable = input(false);

  /** The folder tile a drag is over, lit as the drop target. */
  readonly dropTargetId = input<string | null>(null);

  readonly activate = output<string>();

  /** The tile a click or a key made current. */
  readonly select = output<string>();

  /** The whole selection after a click, a key or a box; see `UiSelectionChange`. */
  readonly selectionChange = output<UiSelectionChange>();

  /** A key whose meaning is the application's; see `UiPanelKey`. */
  readonly command = output<UiPanelKey>();

  /**
   * The tiles now rendered, by id, each time that set changes — all of them,
   * or the rows near the viewport of a long folder. What an application
   * making thumbnails needs to know: which pictures are worth reading now.
   */
  readonly shown = output<readonly string[]>();

  /** The set `shown` last reported. */
  private shownKey: string | null = null;

  /** The one tile that is keyboard reachable (roving tabindex). */
  protected readonly focusId = computed(() => {
    const items = this.items();
    const anchor = items.find((item) => item.focused) ?? items.find((item) => item.selected);
    return (anchor ?? items[0])?.id ?? null;
  });

  /** Keys documented on every tile, so the set is discoverable. */
  protected readonly keyShortcuts = computed(() => `${listKeyShortcuts(this.keymap)} PageUp PageDown Home End`);

  /** The key bindings in force (PRD 010, §2). */
  private readonly keymap = inject(UiKeymap);

  private readonly tiles = viewChildren<ElementRef<HTMLButtonElement>>('tile');

  private readonly typeahead = new UiTypeahead();
  private readonly selection = new UiListSelection();

  /** The box being dragged, in host coordinates, or `null`. */
  protected readonly marquee = signal<Box | null>(null);
  private drag: MarqueeDrag | null = null;

  private readonly viewport = new UiVirtualViewport();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly lineHeight = signal(DEFAULT_LINE_HEIGHT);
  private readonly perLine = signal(1);
  private readonly leading = signal(PADDING);

  /** A tile a key moved to before it was rendered; focused once it is. */
  private pendingFocusId: string | null = null;

  protected readonly virtual = computed(() => this.items().length >= VIRTUAL_THRESHOLD);

  /** The tiles rendered: all of them, or the visual rows near the viewport. */
  protected readonly range = computed(() => {
    const total = this.items().length;
    if (!this.virtual()) {
      return { start: 0, end: total };
    }
    return visibleRange({
      total,
      lineHeight: this.lineHeight(),
      perLine: this.perLine(),
      scrollTop: this.viewport.scrollTop(),
      viewportHeight: this.viewport.viewportHeight(),
      leading: this.leading(),
    });
  });

  protected readonly visibleItems = computed(() => {
    const { start, end } = this.range();
    return this.items().slice(start, end);
  });

  /**
   * Spacer heights for the visual rows not rendered. A spacer is itself a
   * grid row, so the `gap` after it is part of what it stands in for.
   */
  protected readonly spaceAbove = computed(() =>
    Math.max(0, (this.range().start / this.perLine()) * this.lineHeight() - GAP),
  );
  protected readonly spaceBelow = computed(() => {
    const remaining = Math.ceil((this.items().length - this.range().end) / this.perLine());
    return Math.max(0, remaining * this.lineHeight() - GAP);
  });

  /** The focused tile when it is rendered, else the first tile that is. */
  protected readonly tabStopId = computed(() => {
    const focusId = this.focusId();
    const visible = this.visibleItems();
    return visible.some((item) => item.id === focusId) ? focusId : (visible[0]?.id ?? null);
  });

  constructor() {
    afterNextRender(() => this.viewport.attach(this.host));
    inject(DestroyRef).onDestroy(() => this.viewport.dispose());

    // After render, so what is reported is what is on screen.
    afterRenderEffect(() => {
      const ids = this.visibleItems().map((item) => item.id);
      const key = ids.join('\n');
      if (key !== this.shownKey) {
        this.shownKey = key;
        this.shown.emit(ids);
      }
    });

    // After each render of a long folder: measure the layout the window is
    // computed from — `auto-fill` decides the columns, not this component —
    // and focus a tile a key moved to while it was off-screen.
    afterRenderEffect(() => {
      this.range();
      if (!this.virtual()) {
        return;
      }
      const columns = this.columns();
      const tiles = this.tiles();
      const first = tiles[0]?.nativeElement;
      const nextLine = tiles[columns]?.nativeElement;
      if (first !== undefined && nextLine !== undefined && nextLine.offsetTop > first.offsetTop) {
        this.lineHeight.set(nextLine.offsetTop - first.offsetTop);
      }
      // Only a whole row of tiles says how many fit, and the window always
      // starts on a row boundary, so the count holds for the full list.
      if (tiles.length > columns) {
        this.perLine.set(columns);
      }
      this.leading.set(this.viewport.offsetOf(this.host) + PADDING);
      this.focusPending();
    });
  }

  /**
   * Focus arrived on a tile from outside — the panel handing the keyboard
   * to its content (a click on its blank space, a tab chosen, `Tab` from
   * another panel, a folder entered), a sort — while nothing is selected
   * (PRD 002, §3.1): the first tile takes the cursor and becomes the
   * selection. A pointer press selects by its own rules, and a move of this
   * component's own (`Ctrl`+arrow, `Insert`) has already said what it means.
   */
  protected onFocusArrived(): void {
    if (this.movingFocus || this.pressing) {
      this.pressing = false;
      return;
    }
    if (this.selectedIds().size === 0) {
      this.focusTile(0);
    }
  }

  /** Set while this component moves focus itself; see `onFocusArrived`. */
  private movingFocus = false;

  /** Set from a pointer press on a tile until it is released; see `onFocusArrived`. */
  protected pressing = false;

  /** A click selects by the keys held: alone, toggled, or as a range. */
  protected onClick(event: MouseEvent, index: number): void {
    const item = this.items()[index];
    if (item) {
      this.pick(item.id, clickMode(event));
    }
  }

  protected onKeydown(event: KeyboardEvent, index: number): void {
    const items = this.items();
    const item = items[index];
    if (!item) {
      return;
    }

    // A key bound to a list command (PRD 010, §2), as in the list view.
    const bound = listCommandFor(this.keymap, event, this.typeahead.typing());
    if (bound !== null) {
      this.runBound(bound, index);
      event.preventDefault();
      return;
    }

    // An `Alt` chord is the panel's, not a step between tiles: its history
    // and `Up` (PRD 001, §6.2.1, §6.2.3). So are the other `Ctrl` chords —
    // switching tabs (§6.2.4), `Ctrl`+`Enter` — so they bubble to
    // `UiFileBrowser` and `UiPanelGroup` untouched.
    if (event.altKey) {
      return;
    }
    const command = event.ctrlKey || event.metaKey;

    const target = this.movementTarget(event.key, index);
    if (target !== null) {
      if (command && (event.key === 'PageUp' || event.key === 'PageDown')) {
        return;
      }
      this.focusTile(target, moveMode(event));
      event.preventDefault();
      return;
    }

    if (command || !isTypeaheadKey(event)) {
      // `Enter` and `Space` would otherwise also click the tile, and
      // `Backspace` navigate the browser back — even with nothing bound to them.
      if (!command && (event.key === 'Enter' || event.key === ' ' || event.key === 'Backspace')) {
        event.preventDefault();
      }
      return;
    }

    const found = this.typeahead.match(
      event.key,
      items.map((candidate) => candidate.label),
      index,
    );
    if (found !== -1) {
      this.focusTile(found);
    }
    event.preventDefault();
  }

  /** A bound list command on tile `index`; see `UiFileList.runBound`. */
  private runBound(command: UiListCommand, index: number): void {
    const items = this.items();
    const item = items[index] as UiIconViewItem;
    const panelKey = LIST_PANEL_KEYS[command];
    if (panelKey !== undefined) {
      this.command.emit({ command: panelKey, entryId: item.id });
      return;
    }
    switch (command) {
      case 'selection.all':
        this.pick(item.id, 'all');
        break;
      case 'list.toggleSelection':
        this.pick(item.id, 'toggle');
        break;
      case 'list.toggleAll':
        this.pick(item.id, 'toggle-all');
        break;
      case 'list.mark': {
        const next = Math.min(index + 1, items.length - 1);
        const change = this.selection.mark({
          ids: items.map((candidate) => candidate.id),
          selected: this.selectedIds(),
          target: item.id,
          next: (items[next] as UiIconViewItem).id,
        });
        this.moveFocus(next);
        this.report(change);
        break;
      }
      default:
        break;
    }
  }

  /** Where a movement key goes from `index`, or `null` for any other key. */
  private movementTarget(key: string, index: number): number | null {
    const columns = this.columns();
    switch (key) {
      case 'ArrowRight':
        return index + 1;
      case 'ArrowLeft':
        return index - 1;
      case 'ArrowDown':
        return index + columns;
      case 'ArrowUp':
        return index - columns;
      case 'Home':
        return 0;
      case 'End':
        return this.items().length - 1;
      case 'PageDown':
        return index + columns * this.rowsPerPage();
      case 'PageUp':
        return index - columns * this.rowsPerPage();
      default:
        return null;
    }
  }

  /** Applies a selection gesture to `id` and reports the result. */
  private pick(id: string, mode: UiSelectMode): void {
    this.report(
      this.selection.pick({
        ids: this.items().map((item) => item.id),
        selected: this.selectedIds(),
        cursor: this.focusId(),
        target: id,
        mode,
      }),
    );
  }

  private report(change: UiSelectionChange): void {
    this.selectionChange.emit(change);
    if (change.focused !== null) {
      this.select.emit(change.focused);
    }
  }

  private selectedIds(): ReadonlySet<string> {
    return new Set(this.items().filter((item) => item.selected).map((item) => item.id));
  }

  /* -- box selection ------------------------------------------------------ */

  /** A primary press on blank space may start a box; a press on a tile is a click. */
  protected onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !(event.target instanceof Element) || event.target.closest('.item') !== null) {
      return;
    }
    const point = this.pointIn(event);
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    this.drag = {
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      base: additive ? this.selectedIds() : new Set(),
      dragging: false,
      lastKey: '',
    };
    this.host.setPointerCapture?.(event.pointerId);
  }

  protected onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (drag === null || event.pointerId !== drag.pointerId) {
      return;
    }

    this.viewport.autoScroll(event.clientY, AUTOSCROLL_EDGE, AUTOSCROLL_STEP);
    const point = this.pointIn(event);
    if (!drag.dragging && Math.hypot(point.x - drag.startX, point.y - drag.startY) < DRAG_THRESHOLD) {
      return;
    }
    drag.dragging = true;

    const box: Box = {
      left: Math.min(drag.startX, point.x),
      top: Math.min(drag.startY, point.y),
      width: Math.abs(point.x - drag.startX),
      height: Math.abs(point.y - drag.startY),
    };
    this.marquee.set(box);

    const hits = this.tilesIn(box);
    const selected = new Set([...drag.base, ...hits]);
    const ordered = this.items().map((item) => item.id).filter((id) => selected.has(id));
    const key = ordered.join('\u0000');
    if (key === drag.lastKey) {
      return;
    }
    drag.lastKey = key;
    // The cursor goes to the last tile the box caught, and the next Shift
    // range starts there — as after clicking it.
    const focused = hits.at(-1) ?? null;
    this.selection.setAnchor(focused);
    this.selectionChange.emit({ selected: ordered, focused });
  }

  protected onPointerUp(event: PointerEvent): void {
    const drag = this.drag;
    if (drag === null || event.pointerId !== drag.pointerId) {
      return;
    }
    // A plain click on blank space clears the selection, as in every file
    // manager; with a modifier held it leaves it be.
    if (!drag.dragging && drag.base.size === 0 && !(event.ctrlKey || event.metaKey || event.shiftKey)) {
      if (this.selectedIds().size > 0) {
        this.selection.setAnchor(null);
        this.selectionChange.emit({ selected: [], focused: null });
      }
    }
    this.endMarquee(event);
  }

  protected endMarquee(event: PointerEvent): void {
    if (this.drag !== null) {
      this.host.releasePointerCapture?.(event.pointerId);
    }
    this.drag = null;
    this.marquee.set(null);
  }

  /** The pointer, in host coordinates — which scroll with the tiles. */
  private pointIn(event: PointerEvent): { x: number; y: number } {
    const rect = this.host.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /**
   * Every tile the box touches, in list order. Worked out from the grid's
   * geometry — the first rendered tile, the stride between columns and
   * between rows — so tiles the window has not rendered are found too.
   */
  private tilesIn(box: Box): string[] {
    const tiles = this.tiles().map((tile) => tile.nativeElement);
    const first = tiles[0];
    if (first === undefined) {
      return [];
    }
    const columns = this.columns();
    const width = first.offsetWidth;
    const height = first.offsetHeight;
    const strideX = columns > 1 && tiles[1] !== undefined ? tiles[1].offsetLeft - first.offsetLeft : width + GAP;
    const strideY =
      tiles[columns] !== undefined && tiles[columns].offsetTop > first.offsetTop
        ? tiles[columns].offsetTop - first.offsetTop
        : height + GAP;
    const originX = first.offsetLeft;
    const originY = first.offsetTop - Math.floor(this.range().start / columns) * strideY;

    const right = box.left + box.width;
    const bottom = box.top + box.height;
    return this.items()
      .filter((_, index) => {
        const x = originX + (index % columns) * strideX;
        const y = originY + Math.floor(index / columns) * strideY;
        return x < right && x + width > box.left && y < bottom && y + height > box.top;
      })
      .map((item) => item.id);
  }

  /** Moves focus to a tile and selects by `mode` — the tile alone unless told otherwise; indices are clamped. */
  private focusTile(index: number, mode: UiSelectMode = 'replace'): void {
    const item = this.moveFocus(index);
    if (item !== undefined) {
      this.pick(item.id, mode);
    }
  }

  /** Moves focus to a tile, selecting nothing; see `focusTile`. */
  private moveFocus(index: number): UiIconViewItem | undefined {
    const items = this.items();
    const clamped = Math.min(Math.max(index, 0), items.length - 1);
    const item = items[clamped];
    if (!item) {
      return undefined;
    }

    if (this.virtual()) {
      const line = Math.floor(clamped / this.perLine());
      this.viewport.reveal(this.leading() + line * this.lineHeight(), this.lineHeight());
    }
    // By id, not by position: once the window has moved, the rendered tiles
    // are the old window's until the next render.
    this.pendingFocusId = item.id;
    this.focusPending();
    return item;
  }

  /** Focuses the tile a key moved to, if it is rendered yet. */
  private focusPending(): void {
    const id = this.pendingFocusId;
    if (id === null) {
      return;
    }
    const tile = this.tiles().find((candidate) => candidate.nativeElement.dataset['itemId'] === id);
    if (tile) {
      this.movingFocus = true;
      try {
        tile.nativeElement.focus();
      } finally {
        this.movingFocus = false;
      }
      this.pendingFocusId = null;
    }
  }

  /**
   * Tiles per visual row, read off the layout: the leading run of tiles that
   * share the first one's `offsetTop`. `auto-fill` decides this, not the
   * component, so there is nothing to compute it from but the result.
   */
  private columns(): number {
    const tiles = this.tiles();
    const first = tiles[0]?.nativeElement;
    if (!first) {
      return 1;
    }

    let count = 0;
    for (const tile of tiles) {
      if (tile.nativeElement.offsetTop !== first.offsetTop) {
        break;
      }
      count += 1;
    }

    return Math.max(1, count);
  }

  private rowsPerPage(): number {
    return pageStep(this.tiles()[0]?.nativeElement);
  }
}
