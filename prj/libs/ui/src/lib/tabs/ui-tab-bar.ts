import {
  Component,
  ElementRef,
  computed,
  input,
  output,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import { UiIconButton } from '../controls/ui-icon-button';
import { UI_TAB_MIME } from '../models';
import type { UiContextMenuRequest, UiIconAction, UiTab, UiTabDragData, UiTabMove, UiTabReorder } from '../models';

/** Where the insertion bar sits, and which tab a drop would land in front of. */
interface TabDropMarker {
  /** Offset in pixels from the left edge of the tab strip. */
  readonly left: number;
  /** `null` appends to the end of the bar. */
  readonly beforeTabId: string | null;
}

/**
 * Reads a tab drag payload off a `DataTransfer`, tolerating anything that is
 * not one: a foreign drag, an empty payload or malformed JSON all yield `null`
 * so the caller can ignore the drop.
 */
function readTabDragData(transfer: DataTransfer | null): UiTabDragData | null {
  if (!transfer) {
    return null;
  }

  const raw = transfer.getData(UI_TAB_MIME) || transfer.getData('text/plain');
  if (!raw) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    const { tabId, groupId } = parsed as Partial<UiTabDragData>;
    return typeof tabId === 'string' && typeof groupId === 'string' ? { tabId, groupId } : null;
  } catch {
    return null;
  }
}

/**
 * An editor group's tab bar: the open tabs plus the group's own action icons.
 *
 * Two rendering rules are not obvious from the markup: the 1px accent rule on
 * the active tab appears only while the owning group is focused (`groupActive`),
 * and a `dirty` tab trades its close button for an 8px dot, exactly as VS Code
 * does. The close button is a sibling of the tab button rather than a child,
 * because a button may never nest inside another button.
 *
 * Choosing a tab and roving to one are different events: a click emits
 * `select` *and* `activate`, while the arrow keys emit only `select`. The
 * application uses the difference to decide when focus may leave the bar.
 *
 * The bar is both a drag source and a drop target for tabs. It never reorders
 * anything itself: a drop is reported as a `UiTabReorder` and a `Ctrl+Arrow`
 * as a `UiTabMove`, and the application decides what that means. The only
 * state kept here is the transient drag presentation — which tab is being
 * dragged, and where the insertion bar sits.
 */
@Component({
  selector: 'ui-tab-bar',
  imports: [UiIcon, UiIconButton],
  templateUrl: './ui-tab-bar.html',
  styleUrl: './ui-tab-bar.scss',
  host: {
    '[class.is-group-active]': 'groupActive()',
  },
})
export class UiTabBar {
  readonly tabs = input.required<readonly UiTab[]>();

  /** Id of the group that owns this bar; travels in the drag payload. */
  readonly groupId = input.required<string>();

  /** Icons shown at the far right of the bar (split, maximize, more…). */
  readonly actions = input<readonly UiIconAction[]>([]);

  /** Whether the owning group has focus; drives the active tab's accent rule. */
  readonly groupActive = input<boolean>(false);

  /** Accessible name of the tab list. */
  readonly label = input<string>('Open folders');

  readonly select = output<string>();

  /**
   * A tab was *chosen* — clicked, or `Enter`/`Space`d, which the browser turns
   * into a click. Distinct from `select`, which the arrow keys also emit as
   * they rove: focus may follow a deliberate choice out of the bar and into
   * the group's body, but it must never follow an arrow, or a keyboard user
   * could never reach the tab after next.
   */
  readonly activate = output<string>();

  /**
   * A tab was double-clicked (PRD 001, §6.1.1). Reported rather than acted on:
   * a double click is a gesture, and what it means to a tab — maximize here,
   * pin it in some editors — is the application's to decide.
   */
  readonly tabDoubleClick = output<string>();

  readonly close = output<string>();
  readonly actionSelect = output<string>();

  /** A tab's context menu was asked for — right-click, `Shift`+`F10`, the menu key (PRD 003, §5). */
  readonly tabContextMenu = output<UiContextMenuRequest>();

  /** A tab — possibly from another group — was dropped on this bar. */
  readonly tabDrop = output<UiTabReorder>();

  /** `Ctrl+ArrowLeft` / `Ctrl+ArrowRight` on the focused tab. */
  readonly tabMove = output<UiTabMove>();

  private readonly strip = viewChild.required<ElementRef<HTMLElement>>('strip');
  private readonly tabElements = viewChildren<ElementRef<HTMLElement>>('tabElement');
  private readonly tabButtons = viewChildren<ElementRef<HTMLButtonElement>>('tabButton');

  /** The tab currently being dragged out of this bar; dims to 40%. */
  protected readonly draggingId = signal<string | null>(null);

  /**
   * The insertion bar, or `null` while no drag hovers the strip. `dragover`
   * fires continuously, so the marker compares by value: an unchanged
   * insertion point does not re-render the bar.
   */
  protected readonly marker = signal<TabDropMarker | null>(null, {
    equal: (a, b) =>
      a === b || (a !== null && b !== null && a.left === b.left && a.beforeTabId === b.beforeTabId),
  });

  /** The one tab that is keyboard reachable (roving tabindex). */
  protected readonly focusId = computed(() => {
    const tabs = this.tabs();
    return (tabs.find((tab) => tab.active) ?? tabs[0])?.id ?? null;
  });

  /**
   * Documented on every tab, because the close button is deliberately kept out
   * of the tablist's accessible tree (a focusable button inside `role="tablist"`
   * violates `aria-required-children`).
   */
  protected readonly keyShortcuts = 'Delete Control+ArrowLeft Control+ArrowRight';

  /** A click chooses a tab: both a selection and a destination. */
  protected onActivate(id: string): void {
    this.select.emit(id);
    this.activate.emit(id);
  }

  protected onClose(event: Event, id: string): void {
    event.stopPropagation();
    this.close.emit(id);
  }

  /** Middle click closes a tab, as in VS Code. */
  protected onTabContextMenu(event: MouseEvent, id: string): void {
    event.preventDefault();
    this.tabContextMenu.emit({ target: id, x: event.clientX, y: event.clientY });
  }

  protected onAuxClick(event: MouseEvent, id: string): void {
    if (event.button !== 1) {
      return;
    }

    event.preventDefault();
    this.close.emit(id);
  }

  protected onDragStart(event: DragEvent, tabId: string): void {
    const transfer = event.dataTransfer;
    if (!transfer) {
      return;
    }

    const payload = JSON.stringify({
      tabId,
      groupId: this.groupId(),
    } satisfies UiTabDragData);
    transfer.setData(UI_TAB_MIME, payload);
    transfer.setData('text/plain', payload);
    transfer.effectAllowed = 'move';
    this.draggingId.set(tabId);
  }

  protected onDragEnd(): void {
    this.draggingId.set(null);
    this.marker.set(null);
  }

  protected onDragOver(event: DragEvent): void {
    const transfer = event.dataTransfer;
    if (!transfer || !Array.from(transfer.types).includes(UI_TAB_MIME)) {
      return;
    }

    event.preventDefault();
    transfer.dropEffect = 'move';
    this.marker.set(this.markerAt(event.clientX));
  }

  protected onDragLeave(event: DragEvent): void {
    const related = event.relatedTarget;
    if (related instanceof Node && this.strip().nativeElement.contains(related)) {
      return;
    }

    this.marker.set(null);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();

    const beforeTabId = this.markerAt(event.clientX).beforeTabId;
    this.marker.set(null);
    this.draggingId.set(null);

    const data = readTabDragData(event.dataTransfer);
    if (!data) {
      return;
    }

    this.tabDrop.emit({
      tabId: data.tabId,
      groupId: data.groupId,
      targetGroupId: this.groupId(),
      beforeTabId,
    });
  }

  protected onKeyDown(event: KeyboardEvent): void {
    const tabs = this.tabs();
    if (tabs.length === 0) {
      return;
    }

    const current = this.currentIndex(event.target);
    if (current < 0) {
      return;
    }

    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      event.preventDefault();
      this.tabContextMenu.emit({ target: tabs[current].id, x: rect.left + 8, y: rect.bottom });
      return;
    }

    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        if (event.ctrlKey) {
          this.tabMove.emit({ tabId: tabs[current].id, direction: -1 });
        } else {
          this.focusTab(current - 1);
        }
        break;

      case 'ArrowRight':
        event.preventDefault();
        if (event.ctrlKey) {
          this.tabMove.emit({ tabId: tabs[current].id, direction: 1 });
        } else {
          this.focusTab(current + 1);
        }
        break;

      case 'Home':
        event.preventDefault();
        this.focusTab(0);
        break;

      case 'End':
        event.preventDefault();
        this.focusTab(tabs.length - 1);
        break;

      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        this.close.emit(tabs[current].id);
        break;

      default:
        break;
    }
  }

  /**
   * Index of the tab the event came from, falling back to the roving-tabindex
   * tab so a key pressed on the strip itself still has an anchor.
   */
  private currentIndex(target: EventTarget | null): number {
    const fromTarget = this.tabButtons().findIndex(
      (button) => target instanceof Node && button.nativeElement.contains(target),
    );
    if (fromTarget >= 0) {
      return fromTarget;
    }

    const focusId = this.focusId();
    return this.tabs().findIndex((tab) => tab.id === focusId);
  }

  /** Moves focus to a tab and selects it; out-of-range indices are clamped. */
  private focusTab(index: number): void {
    const tabs = this.tabs();
    const clamped = Math.min(Math.max(index, 0), tabs.length - 1);
    this.tabButtons()[clamped]?.nativeElement.focus();
    this.select.emit(tabs[clamped].id);
  }

  /**
   * The insertion point for a pointer at `clientX`: the first tab whose
   * horizontal midpoint the pointer has not passed, or an append at the end.
   */
  private markerAt(clientX: number): TabDropMarker {
    const strip = this.strip().nativeElement;
    const stripRect = strip.getBoundingClientRect();
    const elements = this.tabElements();
    const tabs = this.tabs();
    const offsetOf = (edge: number): number =>
      Math.max(0, Math.min(edge - stripRect.left + strip.scrollLeft, strip.scrollWidth - 2));

    for (let index = 0; index < elements.length; index += 1) {
      const rect = elements[index].nativeElement.getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) {
        return {
          left: offsetOf(rect.left),
          beforeTabId: tabs[index]?.id ?? null,
        };
      }
    }

    const last = elements[elements.length - 1]?.nativeElement.getBoundingClientRect();
    return { left: last ? offsetOf(last.right) : 0, beforeTabId: null };
  }
}
