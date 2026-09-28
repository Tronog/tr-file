import {
  Component,
  DestroyRef,
  afterRenderEffect,
  effect,
  inject,
  computed,
  input,
  output,
  signal,
  viewChild,
  ElementRef,
} from '@angular/core';
import { UiEmptyState } from '../empty-state/ui-empty-state';
import { UiKeymap } from '../keyboard/keymap';
import { UiIcon } from '../icon/ui-icon';
import { UiProgress } from '../progress/ui-progress';
import { UiTabBar } from '../tabs/ui-tab-bar';
import { UI_TAB_MIME } from '../models';

/**
 * How long a load runs before the loading rail shows. Most answers — a
 * refresh, a cached folder's revalidation — come back well inside it, and a
 * bar that flashes for a frame says nothing but "something flickered".
 */
export const UI_LOADING_RAIL_DELAY_MS = 150;
import type {
  UiContextMenuRequest,
  UiDropZone,
  UiFilesDrop,
  UiPanelGroupModel,
  UiTabDragData,
  UiTabDrop,
  UiTabMove,
  UiTabReorder,
} from '../models';

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

/** Where a key types text: a text input, a text area, or editable content. */
function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'reset', 'submit'].includes(target.type);
  }
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable;
}

/** The chords of the group itself; see `onGroupKeydown`. */
const GROUP_COMMANDS = ['view.splitRight', 'tab.new', 'view.toggleMaximize', 'tab.close', 'tab.next', 'tab.previous'] as const;

/**
 * One editor group: the shell around whatever its active tab shows.
 *
 * The group owns the tab bar, the loading rail under it and the body's frame;
 * what goes *in* the body is content the application projects — file
 * management today (`UiFileBrowser`), other kinds later — each its own
 * component with its own toolbar and model. The group never looks inside that
 * content. It agrees with it on one thing only: the element marked
 * `uiPanelBody` (see `UiPanelBody`) is where focus goes; a press on blank
 * space anywhere in the panel — body, tab bar or the content's chrome — asks
 * for it (`bodyPress`). A group with no tabs has no content, and
 * renders its `empty` placeholder instead.
 *
 * The body is a drop target for tabs: the pointer's position inside it picks a
 * `UiDropZone` — the outer quarter on a side splits, the middle joins — which
 * is painted as an overlay while the drag lasts and reported as a `UiTabDrop`
 * when it ends. Which zone is lit is transient presentation state; the layout
 * itself is the application's business.
 *
 * The body also accepts files dragged in from the desktop, when `acceptFiles`
 * says the content wants them: such a drag carries no tab payload, so it never
 * computes a zone — it lights the whole body and reports the dropped `File`s
 * through `fileDrop`. Uploading them is, again, the application's business.
 */
@Component({
  selector: 'ui-panel-group',
  imports: [UiTabBar, UiEmptyState, UiProgress, UiIcon],
  templateUrl: './ui-panel-group.html',
  styleUrl: './ui-panel-group.scss',
  host: {
    '[class.is-active]': 'active()',
    '(pointerdown)': 'onGroupPointerDown($event)',
    '(keydown)': 'onGroupKeydown($event)',
  },
})
export class UiPanelGroup {
  readonly group = input.required<UiPanelGroupModel>();

  /** Whether this group owns the workbench focus. */
  readonly active = input<boolean>(false);

  /**
   * Whether files dragged in from the desktop may be dropped on the body.
   * Off by default: only content that has somewhere to put them — a folder
   * listing — turns it on.
   */
  readonly acceptFiles = input<boolean>(false);

  /**
   * A token the application bumps to ask the body to take focus (PRD 001,
   * Section 6.3). `0` means it has never asked; any change is one request,
   * which is why it is a number and not a boolean — asking twice for the same
   * group has to be two asks.
   */
  readonly focusBody = input<number>(0);

  readonly tabSelect = output<string>();

  /**
   * A tab was chosen rather than roved past; see `UiTabBar.activate`. The
   * application answers this by bumping `focusBody`.
   */
  readonly tabActivate = output<string>();

  /** A tab was double-clicked; see `UiTabBar.tabDoubleClick`. */
  readonly tabDoubleClick = output<string>();

  /** A tab's context menu was asked for; see `UiTabBar.tabContextMenu`. */
  readonly tabContextMenu = output<UiContextMenuRequest>();

  /**
   * A press landed on the panel's blank space — below the last row, beside
   * the tiles, on the "no folder opened" placeholder (PRD 001, §6.3.1), and
   * anywhere else in the panel that nothing takes focus from: the tab bar
   * beside the tabs, the loading rail, the gaps of the content's toolbar
   * (PRD 002, §3.1). Nothing there takes focus on its own, so the press would
   * otherwise leave the panel active but empty-handed — the browser drops
   * focus to the page — and the application answers by bumping `focusBody`.
   */
  readonly bodyPress = output<void>();

  readonly tabClose = output<string>();
  readonly actionSelect = output<string>();

  /** A tab was dropped on this group's tab bar. */
  readonly tabDrop = output<UiTabReorder>();

  /** A keyboard reorder of the focused tab. */
  readonly tabMove = output<UiTabMove>();

  /** A tab was dropped over the group's body, in one of its five zones. */
  readonly zoneDrop = output<UiTabDrop>();

  /** OS files were dropped on the group's body. Never emitted empty. */
  readonly fileDrop = output<readonly File[]>();

  /**
   * The same drop as `fileDrop`, with what `fileDrop` cannot carry
   * (PRD 003, §6): the dropped items as file-system entries, read during the
   * drop, so a dropped *folder* can be walked; and whether `Ctrl` or `Alt`
   * was held. `target` is always `null` — the group's folder.
   */
  readonly filesDrop = output<UiFilesDrop>();

  /** Any pointer press inside the group asks the application to focus it. */
  readonly focusRequest = output<void>();

  /** The zone lit while a tab drag hovers the body, or `null`. */
  protected readonly dropZone = signal<UiDropZone | null>(null);

  /** Whether a file drag from outside the page is hovering the body. */
  protected readonly fileDragging = signal(false);

  private readonly bodyElement = viewChild.required<ElementRef<HTMLElement>>('body');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** The key bindings in force (PRD 010, §2). */
  private readonly keymap = inject(UiKeymap);

  /** The projected content's `uiPanelBody` element, while there is one. */
  private contentBody: HTMLElement | null = null;

  /** The last `focusBody` this component has seen; a change is a new request. */
  private seenFocusToken = 0;

  /** A request that has not found anything to focus yet. */
  private focusWanted = false;

  /** `group().loading`, once it has lasted `UI_LOADING_RAIL_DELAY_MS`; ends with it. */
  protected readonly showLoading = signal(false);

  constructor() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const loading = !!this.group().loading;
      clearTimeout(timer);
      if (!loading) {
        this.showLoading.set(false);
        return;
      }
      if (!this.showLoading()) {
        timer = setTimeout(() => this.showLoading.set(true), UI_LOADING_RAIL_DELAY_MS);
      }
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));

    // After render, not during it: the body has to exist before focus can go
    // into it, and on a tab switch the *new* tab's body is what must exist.
    // A request outlives an unsatisfied attempt while the listing is still
    // loading, so clicking a tab whose folder has not arrived yet still lands
    // focus on the first row once it does. Anything else settles the request,
    // or a stale ask would steal focus from wherever the user has since gone.
    afterRenderEffect(() => {
      const token = this.focusBody();
      const loading = !!this.group().loading;

      if (token !== this.seenFocusToken) {
        this.seenFocusToken = token;
        this.focusWanted = token > 0;
      }

      if (!this.focusWanted) {
        return;
      }

      if (this.moveFocusIntoBody() || !loading) {
        this.focusWanted = false;
      }
    });
  }

  /**
   * Called by `UiPanelBody` when content marks its body. Only one content is
   * showing at a time; the latest to arrive is the one that counts.
   */
  attachContentBody(element: HTMLElement): void {
    this.contentBody = element;
  }

  /**
   * Called by `UiPanelBody` as its content goes away. Guarded, because the
   * content replacing it may already have attached: a tab switch can build the
   * new body before the old one is torn down.
   */
  detachContentBody(element: HTMLElement): void {
    if (this.contentBody === element) {
      this.contentBody = null;
    }
  }

  /**
   * Focuses the body's single tab stop — the focused row, the focused tile or
   * the document's scroll container, whichever the content is showing. It is
   * looked for inside the content's `uiPanelBody`, so a tab stop in the chrome
   * above it (a path bar, a toolbar) never wins.
   *
   * A body with nothing in it still takes focus, on the `uiPanelBody` element
   * itself, or on the group's own body when there is no content at all: an
   * empty folder shows a placeholder with no focusable element, and leaving the
   * keyboard outside the panel would strand it there — the panel's own keys
   * (`Alt`+`←`/`→`, `Backspace`, `Ctrl`+`W`) would reach nothing, so a keyboard
   * user could enter an empty folder and not get out again.
   *
   * Reports whether a *real* tab stop was found, which is not the same thing:
   * a body that is still loading gets the fallback now and the first row when
   * it arrives.
   */
  private moveFocusIntoBody(): boolean {
    const scope = this.contentBody ?? this.bodyElement().nativeElement;
    const target = scope.querySelector<HTMLElement>('[tabindex="0"]');
    (target ?? scope).focus();
    return target !== null;
  }

  /** Accessible name of the loading bar, e.g. `Loading Documents`. */
  protected readonly loadingLabel = computed(() => {
    const group = this.group();
    const active = group.tabs.find((tab) => tab.active) ?? group.tabs[0];
    return active ? `Loading ${active.label}` : 'Loading';
  });

  /**
   * The chords that belong to the panel as a whole (PRD 001, §6.2.2), as the
   * keymap binds them (PRD 010, §2).
   *
   * Bound on the host rather than the body, so they work with focus anywhere
   * in the group — in its content, or on a tab in the bar. `/` and `Ctrl`+`W`
   * emit exactly what the tab bar's split and close buttons emit, `Ctrl`+`T`
   * asks for a new tab (`new-tab`, PRD 002, §2.2), `Ctrl`+`↑` maximizes or
   * restores the group as its maximize button does (§2.8), and `Ctrl`+`PageUp`/
   * `PageDown` (§6.2.4) emits what clicking the neighbouring tab emits — so
   * the pointer and the keyboard can never drift apart. A chord without
   * `Ctrl` or `Alt` — `/` — typed into a text field is text, not a command.
   *
   * Everything else is the content's: it sits inside this host, so its own
   * handlers see a key first — which is how `UiFileBrowser` answers
   * `Ctrl`+`Enter` about the entry it is standing on (§6.2.5).
   */
  protected onGroupKeydown(event: KeyboardEvent): void {
    // A key the content already took — a row's own binding — is not the group's too.
    if (event.defaultPrevented || (!event.ctrlKey && !event.metaKey && !event.altKey && isTextField(event.target))) {
      return;
    }
    switch (this.keymap.commandFor(event, 'panel', GROUP_COMMANDS)) {
      case 'view.splitRight':
        this.actionSelect.emit('split-right');
        break;
      case 'tab.new':
        this.actionSelect.emit('new-tab');
        break;
      case 'view.toggleMaximize':
        this.actionSelect.emit('maximize');
        break;
      case 'tab.close': {
        // The focused tab is the active one; a group with none has nothing to
        // close, and must not silently close somebody else's tab.
        const group = this.group();
        const active = group.tabs.find((tab) => tab.active) ?? group.tabs[0];
        if (!active) {
          return;
        }
        this.tabClose.emit(active.id);
        break;
      }
      case 'tab.next':
        if (!this.switchTab(1)) {
          return;
        }
        break;
      case 'tab.previous':
        if (!this.switchTab(-1)) {
          return;
        }
        break;
      default:
        return;
    }

    event.preventDefault();
  }

  /**
   * Moves to the tab `step` along, wrapping at either end (PRD 001, §6.2.4).
   *
   * Reported as the same pair a click on that tab emits — select it, then
   * choose it — so switching by keyboard lands focus in the new tab's content
   * exactly as clicking would. Without that, focus would be left on an element
   * belonging to the tab that just went away.
   *
   * Returns whether there was anywhere to go: a group with one tab or none
   * must not claim the chord.
   */
  private switchTab(step: 1 | -1): boolean {
    const tabs = this.group().tabs;
    if (tabs.length < 2) {
      return false;
    }

    const current = tabs.findIndex((tab) => tab.active);
    const from = current === -1 ? 0 : current;
    const next = tabs[(from + step + tabs.length) % tabs.length];
    if (!next) {
      return false;
    }

    this.tabSelect.emit(next.id);
    this.tabActivate.emit(next.id);
    return true;
  }

  /**
   * Any press makes the group the active one; a press that lands on blank
   * space is also reported as `bodyPress` (PRD 001, §6.3.1; PRD 002, §3.1).
   *
   * Blank is anything in the panel that nothing under the pointer takes focus
   * from: the body below the last row or beside the tiles, an empty-state
   * placeholder, the tab bar beside the tabs, the loading rail, the gaps of
   * the content's toolbar. A row, a tile, the document's scroll container, a
   * button is about to take focus itself, and asking for the body's tab stop
   * as well would drag focus off whatever was actually clicked.
   *
   * An element that answers a press of its own without being focusable — the
   * path bar, whose blank space turns it into a text field — says so with
   * `data-own-press`, so the panel does not pull focus away from what it does.
   */
  protected onGroupPointerDown(event: PointerEvent): void {
    this.focusRequest.emit();

    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    // Both the group's body and the content's carry `tabindex="-1"` so they
    // can hold focus when there is nothing else, so a match on either is not
    // a match: pressing it *is* pressing the empty area.
    const body = this.bodyElement().nativeElement;
    const focusable = target.closest(
      'button, a, input, textarea, select, [tabindex], [contenteditable], [data-own-press]',
    );
    if (
      focusable !== null &&
      focusable !== body &&
      focusable !== this.contentBody &&
      this.host.contains(focusable)
    ) {
      return;
    }

    this.bodyPress.emit();
  }

  protected onBodyDragOver(event: DragEvent): void {
    const transfer = event.dataTransfer;
    if (!transfer) {
      return;
    }

    const types = Array.from(transfer.types);
    if (types.includes(UI_TAB_MIME)) {
      event.preventDefault();
      transfer.dropEffect = 'move';
      this.fileDragging.set(false);
      this.dropZone.set(this.zoneAt(event));
      return;
    }

    if (types.includes('Files') && this.acceptFiles()) {
      event.preventDefault();
      transfer.dropEffect = 'copy';
      this.dropZone.set(null);
      this.fileDragging.set(true);
    }
  }

  protected onBodyDragLeave(event: DragEvent): void {
    const related = event.relatedTarget;
    const body = event.currentTarget;
    if (body instanceof Node && related instanceof Node && body.contains(related)) {
      return;
    }

    this.clearDragState();
  }

  protected onBodyDrop(event: DragEvent): void {
    event.preventDefault();

    const transfer = event.dataTransfer;
    // Classify from the event itself rather than from what `dragover` saw: a
    // drop that arrives without a preceding hover is still a file drop.
    const isFileDrag =
      this.fileDragging() || (transfer !== null && Array.from(transfer.types).includes('Files'));
    const zone = isFileDrag ? null : this.zoneAt(event);
    this.clearDragState();

    if (isFileDrag) {
      const files = transfer && this.acceptFiles() ? Array.from(transfer.files) : [];
      if (files.length > 0) {
        this.fileDrop.emit(files);
        const entries = Array.from(transfer?.items ?? [])
          .map((item) => (item.kind === 'file' ? item.webkitGetAsEntry?.() : null))
          .filter((entry): entry is FileSystemEntry => entry !== null && entry !== undefined);
        this.filesDrop.emit({ files, entries, target: null, copy: event.ctrlKey || event.altKey });
      }

      return;
    }

    const data = readTabDragData(transfer);
    if (!data || zone === null) {
      return;
    }

    this.zoneDrop.emit({
      tabId: data.tabId,
      groupId: data.groupId,
      targetGroupId: this.group().id,
      zone,
    });
  }

  /** A gesture that left the body or ended clears both overlays. */
  private clearDragState(): void {
    this.dropZone.set(null);
    this.fileDragging.set(false);
  }

  /**
   * The zone under the pointer: whichever edge it is within the outer quarter
   * of — the nearest one, so corners stay predictable — else `center`.
   */
  private zoneAt(event: DragEvent): UiDropZone {
    const body = event.currentTarget;
    if (!(body instanceof HTMLElement)) {
      return 'center';
    }

    const rect = body.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return 'center';
    }

    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const edges: readonly (readonly [UiDropZone, number])[] = [
      ['left', x],
      ['right', 1 - x],
      ['top', y],
      ['bottom', 1 - y],
    ];

    let nearest: readonly [UiDropZone, number] = edges[0];
    for (const edge of edges) {
      if (edge[1] < nearest[1]) {
        nearest = edge;
      }
    }

    return nearest[1] < 0.25 ? nearest[0] : 'center';
  }
}
