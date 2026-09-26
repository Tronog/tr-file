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
import type { UiIconViewItem, UiPanelKey } from '../models';
import { UiVirtualViewport, VIRTUAL_THRESHOLD, visibleRange } from '../virtual/ui-virtual-viewport';

/** The grid's `gap` and `padding`, as the stylesheet sets them. */
const GAP = 4;
const PADDING = 10;

/** One visual row of tiles, gap included, until one has been measured. */
const DEFAULT_LINE_HEIGHT = 84;

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
        [attr.aria-selected]="item.selected ? 'true' : 'false'"
        [attr.aria-posinset]="virtual() ? index + 1 : null"
        [attr.aria-setsize]="virtual() ? items().length : null"
        [attr.aria-keyshortcuts]="keyShortcuts"
        [attr.tabindex]="item.id === tabStopId() ? 0 : -1"
        [attr.title]="item.label"
        (click)="select.emit(item.id)"
        (dblclick)="activate.emit(item.id)"
        (keydown)="onKeydown($event, index)"
      >
        <ui-icon [name]="item.icon" [tint]="item.tint" size="xl" />
        <span class="item-label">{{ item.label }}</span>
      </button>
    }
    @if (spaceBelow() > 0) {
      <div class="spacer" aria-hidden="true" [style.height.px]="spaceBelow()"></div>
    }
  `,
  styleUrl: './ui-icon-view.scss',
  host: {
    role: 'listbox',
    '[attr.aria-label]': 'label()',
  },
})
export class UiIconView {
  readonly items = input.required<readonly UiIconViewItem[]>();

  /** Accessible name of the listbox. */
  readonly label = input<string>('Files');

  readonly activate = output<string>();
  readonly select = output<string>();

  /** A key whose meaning is the application's; see `UiPanelKey`. */
  readonly command = output<UiPanelKey>();

  /** The one tile that is keyboard reachable (roving tabindex). */
  protected readonly focusId = computed(() => {
    const items = this.items();
    const anchor = items.find((item) => item.focused) ?? items.find((item) => item.selected);
    return (anchor ?? items[0])?.id ?? null;
  });

  /** Keys documented on every tile, so the set is discoverable. */
  protected readonly keyShortcuts = 'Enter Space Backspace F5 PageUp PageDown Home End';

  private readonly tiles = viewChildren<ElementRef<HTMLButtonElement>>('tile');

  private readonly typeahead = new UiTypeahead();

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

  protected onKeydown(event: KeyboardEvent, index: number): void {
    const items = this.items();
    const item = items[index];
    if (!item) {
      return;
    }

    // An `Alt` or `Ctrl` chord is the panel's, not a step between tiles: its
    // history and `Up`, and switching tabs (PRD 001, §6.2.1, §6.2.3, §6.2.4).
    // Let it bubble to `UiPanelGroup` untouched.
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const columns = this.columns();

    switch (event.key) {
      case 'ArrowRight':
        this.focusTile(index + 1);
        break;
      case 'ArrowLeft':
        this.focusTile(index - 1);
        break;
      case 'ArrowDown':
        this.focusTile(index + columns);
        break;
      case 'ArrowUp':
        this.focusTile(index - columns);
        break;
      case 'Home':
        this.focusTile(0);
        break;
      case 'End':
        this.focusTile(items.length - 1);
        break;
      case 'PageDown':
        this.focusTile(index + columns * this.rowsPerPage());
        break;
      case 'PageUp':
        this.focusTile(index - columns * this.rowsPerPage());
        break;
      case 'Enter':
        this.command.emit({ command: 'open', entryId: item.id });
        break;
      case ' ':
        this.command.emit({ command: 'select', entryId: item.id });
        break;
      case 'Backspace':
        this.command.emit({ command: 'up', entryId: item.id });
        break;
      case 'F5':
        this.command.emit({ command: 'refresh', entryId: item.id });
        break;
      default: {
        if (!isTypeaheadKey(event)) {
          return;
        }
        const found = this.typeahead.match(
          event.key,
          items.map((candidate) => candidate.label),
          index,
        );
        if (found === -1) {
          break;
        }
        this.focusTile(found);
        break;
      }
    }

    // Claimed unconditionally: `Enter` and `Space` would otherwise also click
    // the tile, and `Backspace` would navigate the browser back.
    event.preventDefault();
  }

  /** Moves focus to a tile and makes it the selection; indices are clamped. */
  private focusTile(index: number): void {
    const items = this.items();
    const clamped = Math.min(Math.max(index, 0), items.length - 1);
    const item = items[clamped];
    if (!item) {
      return;
    }

    if (this.virtual()) {
      const line = Math.floor(clamped / this.perLine());
      this.viewport.reveal(this.leading() + line * this.lineHeight(), this.lineHeight());
    }
    // By id, not by position: once the window has moved, the rendered tiles
    // are the old window's until the next render.
    this.pendingFocusId = item.id;
    this.focusPending();
    this.select.emit(item.id);
  }

  /** Focuses the tile a key moved to, if it is rendered yet. */
  private focusPending(): void {
    const id = this.pendingFocusId;
    if (id === null) {
      return;
    }
    const tile = this.tiles().find((candidate) => candidate.nativeElement.dataset['itemId'] === id);
    if (tile) {
      tile.nativeElement.focus();
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
