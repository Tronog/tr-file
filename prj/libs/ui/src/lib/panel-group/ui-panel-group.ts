import {
  Component,
  afterRenderEffect,
  computed,
  input,
  output,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { UiBreadcrumbs } from '../breadcrumbs/ui-breadcrumbs';
import { UiIconButton } from '../controls/ui-icon-button';
import { UiSearchField } from '../controls/ui-search-field';
import { UiSegmented, type UiSegmentedOption } from '../controls/ui-segmented';
import { UiDocumentView } from '../document-view/ui-document-view';
import { UiEmptyState } from '../empty-state/ui-empty-state';
import { UiFileList } from '../file-list/ui-file-list';
import { UiIcon } from '../icon/ui-icon';
import { UiIconView } from '../icon-view/ui-icon-view';
import { UiProgress } from '../progress/ui-progress';
import { UiTabBar } from '../tabs/ui-tab-bar';
import { UI_TAB_MIME } from '../models';
import type {
  UiDropZone,
  UiPanelGroupModel,
  UiPanelKey,
  UiPanelView,
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

/**
 * One editor group: tab bar, optional breadcrumbs, optional toolbar and a body.
 *
 * Every chrome row is conditional on the data — breadcrumbs appear only when
 * the group has any, the toolbar only when it has something to show — and a
 * group carrying an `empty` state renders that instead of a body, which is how
 * "no folder opened" is expressed. The view switch is stateless: it renders
 * `group().view` and re-emits changes through `viewChange`.
 *
 * The body is a drop target for tabs: the pointer's position inside it picks a
 * `UiDropZone` — the outer quarter on a side splits, the middle joins — which
 * is painted as an overlay while the drag lasts and reported as a `UiTabDrop`
 * when it ends. Which zone is lit is transient presentation state; the layout
 * itself is the application's business.
 *
 * The body also accepts files dragged in from the desktop: such a drag carries
 * no tab payload, so it never computes a zone — it lights the whole body and
 * reports the dropped `File`s through `fileDrop`. Uploading them is, again,
 * the application's business.
 */
@Component({
  selector: 'ui-panel-group',
  imports: [
    UiTabBar,
    UiBreadcrumbs,
    UiIconButton,
    UiSegmented,
    UiSearchField,
    UiFileList,
    UiIconView,
    UiEmptyState,
    UiDocumentView,
    UiProgress,
    UiIcon,
  ],
  templateUrl: './ui-panel-group.html',
  styleUrl: './ui-panel-group.scss',
  host: {
    '[class.is-active]': 'active()',
    '(pointerdown)': 'focusRequest.emit()',
    '(keydown)': 'onGroupKeydown($event)',
  },
})
export class UiPanelGroup {
  readonly group = input.required<UiPanelGroupModel>();

  /** Whether this group owns the workbench focus. */
  readonly active = input<boolean>(false);

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

  /**
   * A press landed on the body's blank space — below the last row, beside the
   * tiles, on the "no folder opened" placeholder (PRD 001, §6.3.1). Nothing
   * there takes focus on its own, so the press would otherwise leave the panel
   * active but empty-handed; the application answers by bumping `focusBody`.
   */
  readonly bodyPress = output<void>();

  readonly tabClose = output<string>();
  readonly actionSelect = output<string>();
  readonly breadcrumbSelect = output<string>();
  readonly toolbarAction = output<string>();
  readonly viewChange = output<UiPanelView>();
  readonly rowSelect = output<string>();
  readonly rowActivate = output<string>();
  readonly itemSelect = output<string>();
  readonly itemActivate = output<string>();

  /** A key pressed inside the body whose meaning is the application's. */
  readonly command = output<UiPanelKey>();

  /** A tab was dropped on this group's tab bar. */
  readonly tabDrop = output<UiTabReorder>();

  /** A keyboard reorder of the focused tab. */
  readonly tabMove = output<UiTabMove>();

  /** A tab was dropped over the group's body, in one of its five zones. */
  readonly zoneDrop = output<UiTabDrop>();

  /** OS files were dropped on the group's body. Never emitted empty. */
  readonly fileDrop = output<readonly File[]>();

  /** Any pointer press inside the group asks the application to focus it. */
  readonly focusRequest = output<void>();

  /** The zone lit while a tab drag hovers the body, or `null`. */
  protected readonly dropZone = signal<UiDropZone | null>(null);

  /** Whether a file drag from outside the page is hovering the body. */
  protected readonly fileDragging = signal(false);

  private readonly bodyElement = viewChild.required<ElementRef<HTMLElement>>('body');

  /** The last `focusBody` this component has seen; a change is a new request. */
  private seenFocusToken = 0;

  /** A request that has not found anything to focus yet. */
  private focusWanted = false;

  constructor() {
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
   * Focuses the body's single tab stop — the focused row, the focused tile or
   * the document's scroll container, whichever the body is currently showing.
   *
   * A body with nothing in it still takes focus, on the container itself:
   * an empty folder shows a placeholder with no focusable element at all, and
   * leaving the keyboard outside the panel would strand it there — the panel's
   * own keys (`Alt`+`←`/`→`, `Backspace`) would reach nothing, so a keyboard
   * user could enter an empty folder and not get out again.
   *
   * Reports whether a *real* tab stop was found, which is not the same thing:
   * a body that is still loading gets the fallback now and the first row when
   * it arrives.
   */
  private moveFocusIntoBody(): boolean {
    const body = this.bodyElement().nativeElement;
    const target = body.querySelector<HTMLElement>('[tabindex="0"]');
    (target ?? body).focus();
    return target !== null;
  }

  protected readonly viewOptions: readonly UiSegmentedOption[] = [
    { id: 'list', label: 'List view', icon: 'list' },
    { id: 'grid', label: 'Grid view', icon: 'layout-grid' },
  ];

  /**
   * Each group's path bar is its own landmark, so they need distinct names —
   * duplicated landmark labels are indistinguishable to a screen reader.
   */
  protected readonly breadcrumbLabel = computed(() => {
    const group = this.group();
    const active = group.tabs.find((tab) => tab.active) ?? group.tabs[0];
    return active ? `Path of ${active.label}` : 'Path';
  });

  /** Accessible name of the loading bar, e.g. `Loading Documents`. */
  protected readonly loadingLabel = computed(() => {
    const group = this.group();
    const active = group.tabs.find((tab) => tab.active) ?? group.tabs[0];
    const folder = active?.label ?? group.breadcrumbs.at(-1)?.label;
    return folder ? `Loading ${folder}` : 'Loading';
  });

  /**
   * A file is open in this group, so its body is a read-only viewer rather
   * than a listing. `empty` still wins: a group with no tabs has no document.
   */
  protected readonly document = computed(() => {
    const group = this.group();
    return group.empty ? undefined : group.document;
  });

  /**
   * The list/grid switch is a choice about a directory listing, so a document
   * hides it — a file has no second view to offer.
   */
  protected readonly showViewSwitch = computed(
    () => !!this.group().showViewSwitch && !this.document(),
  );

  protected readonly showToolbar = computed(() => {
    const group = this.group();
    return group.toolbarActions.length > 0 || this.showViewSwitch() || !!group.searchPlaceholder;
  });

  protected onViewChange(value: string): void {
    this.viewChange.emit(value === 'grid' ? 'grid' : 'list');
  }

  /**
   * The panel's own keys, wherever focus sits inside its body.
   *
   * `Alt`+`←`/`→` walks the folders this panel has visited (PRD 001, §6.2.1).
   * It is handled here rather than in the list and the grid because it is
   * about the *panel*, not about what is selected in it — and because it must
   * work just as well when the body is a document, or the empty-state
   * placeholder, neither of which has a keyboard of its own. Both views let an
   * `Alt` chord bubble untouched so it arrives here exactly once.
   *
   * `Backspace` and `F5` are handled here *only* when the body itself has
   * focus, which is the empty-folder case: without it, a keyboard user who
   * walked into an empty folder would have no way to walk back out of it.
   * Whenever there is a row or a tile to stand on, those keys belong to the
   * view that owns it.
   */
  /**
   * The chords that belong to the panel as a whole (PRD 001, §6.2.2).
   *
   * Bound on the host rather than the body, so they work with focus anywhere
   * in the group — a row, a tile, the document, or a tab in the bar. Neither
   * is a new capability: they emit exactly what the tab bar's split button and
   * its close button emit, which is why the application needs no new wiring
   * and the two paths can never drift apart.
   */
  protected onGroupKeydown(event: KeyboardEvent): void {
    if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
      return;
    }

    switch (event.key.toLowerCase()) {
      case 't':
        this.actionSelect.emit('split-right');
        break;
      case 'w': {
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
      default:
        return;
    }

    event.preventDefault();
  }

  protected onBodyKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    if (event.altKey) {
      if (event.key === 'ArrowLeft') {
        this.command.emit({ command: 'back', entryId: null });
      } else if (event.key === 'ArrowRight') {
        this.command.emit({ command: 'forward', entryId: null });
      } else {
        return;
      }
      event.preventDefault();
      return;
    }

    // Only when the body itself has focus, which happens when it has nothing
    // to give focus to: an empty folder. The list and the grid own these keys
    // whenever there is a row or a tile to stand on, and handling them here as
    // well would run them twice.
    if (event.target !== this.bodyElement().nativeElement) {
      return;
    }

    if (event.key === 'Backspace') {
      this.command.emit({ command: 'up', entryId: null });
    } else if (event.key === 'F5') {
      this.command.emit({ command: 'refresh', entryId: null });
    } else {
      return;
    }

    event.preventDefault();
  }

  /**
   * Reports a press only when it landed on the body itself.
   *
   * Anything focusable under the pointer — a row, a tile, the document's
   * scroll container, a button — is already about to take focus, and asking
   * for the body's tab stop as well would drag focus off whatever was
   * actually clicked.
   */
  protected onBodyPointerDown(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    // The body carries `tabindex="-1"` so it can hold focus when it has
    // nothing else to offer, so a match on the body itself is not a match:
    // pressing it *is* pressing the empty area.
    const focusable = target.closest(
      'button, a, input, textarea, select, [tabindex], [contenteditable]',
    );
    if (focusable !== null && focusable !== this.bodyElement().nativeElement) {
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

    if (types.includes('Files')) {
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
      const files = transfer ? Array.from(transfer.files) : [];
      if (files.length > 0) {
        this.fileDrop.emit(files);
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
