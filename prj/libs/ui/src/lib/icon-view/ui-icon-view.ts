import { Component, computed, input, output, viewChildren, type ElementRef } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import { isTypeaheadKey, pageStep, UiTypeahead } from '../keyboard/list-navigation';
import type { UiIconViewItem, UiPanelKey } from '../models';

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
 */
@Component({
  selector: 'ui-icon-view',
  imports: [UiIcon],
  template: `
    @for (item of items(); track item.id; let index = $index) {
      <button
        #tile
        type="button"
        class="item"
        role="option"
        [class.is-selected]="item.selected"
        [attr.aria-selected]="item.selected ? 'true' : 'false'"
        [attr.aria-keyshortcuts]="keyShortcuts"
        [attr.tabindex]="item.id === focusId() ? 0 : -1"
        [attr.title]="item.label"
        (click)="select.emit(item.id)"
        (dblclick)="activate.emit(item.id)"
        (keydown)="onKeydown($event, index)"
      >
        <ui-icon [name]="item.icon" [tint]="item.tint" size="xl" />
        <span class="item-label">{{ item.label }}</span>
      </button>
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

    this.tiles()[clamped]?.nativeElement.focus();
    this.select.emit(item.id);
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
