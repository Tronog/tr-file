import { Component, computed, inject } from '@angular/core';
import {
  UiBottomTabTemplate,
  UiEmptyState,
  UiNotes,
  UiPaneTemplate,
  UiPanelBody,
  UiPanelContentTemplate,
  UiPropertyList,
  UiSubAppTemplate,
  UiTree,
  UiWorkbenchService,
  UiWorkbenchShell,
  type UiProperty,
} from '@tr-file/ui';
import type { DemoWorkbenchService } from './demo-workbench.service';

/**
 * The demo's window: the library's shell, and what the demo draws in it —
 * the Explorer's and Details' panes, a note in a panel, the bottom panel's
 * tabs, and the About sub-application. No sidebar, panel grid, menu, palette
 * or key handling of its own: those are the library's.
 */
@Component({
  selector: 'demo-workbench',
  imports: [
    UiBottomTabTemplate,
    UiEmptyState,
    UiNotes,
    UiPaneTemplate,
    UiPanelBody,
    UiPanelContentTemplate,
    UiPropertyList,
    UiSubAppTemplate,
    UiTree,
    UiWorkbenchShell,
  ],
  template: `
    @let notes = workbench.notesFt;
    <ui-workbench-shell>
      <!-- The Explorer's panes. -->
      <ng-template uiPane="notes" [paneActions]="[{ id: 'new', label: 'New note', icon: 'plus' }]" (paneAction)="notes.create()">
        <ui-tree label="Notes" [nodes]="notes.tree()" (activate)="notes.open($event)" />
      </ng-template>
      <ng-template uiPane="outline">
        @if (notes.outline().length === 0) {
          <p class="note">No headings in the note open.</p>
        } @else {
          <ui-tree label="Outline" [nodes]="notes.outline()" />
        }
      </ng-template>

      <!-- Details' panes. -->
      <ng-template uiPane="info">
        @if (info().length === 0) {
          <p class="note">Open a note to see about it.</p>
        } @else {
          <ui-property-list [properties]="info()" />
        }
      </ng-template>
      <ng-template uiPane="help">
        <p class="note">Ctrl+Shift+P runs any command; F1 lists every key.</p>
      </ng-template>

      <!-- A panel's content: a note to edit, or the welcome page. -->
      <ng-template uiPanelContent="note" let-groupId>
        @if (noteOf(groupId); as note) {
          <div uiPanelBody class="body">
            <ui-notes [label]="note.title" [text]="note.text" (textChange)="notes.edit(note.id, $event)" />
          </div>
        }
      </ng-template>
      <ng-template uiPanelContent="welcome">
        <div uiPanelBody class="body">
          <ui-empty-state [state]="{ icon: 'file-text', title: 'Welcome', hint: 'Open a note from the Explorer, or make one:', keys: ['Alt', 'N'] }" />
        </div>
      </ng-template>

      <!-- The bottom panel. -->
      <ng-template uiBottomTab="output">
        <ul class="log">
          @for (line of notes.log(); track $index) {
            <li>{{ line }}</li>
          }
        </ul>
      </ng-template>
      <ng-template uiBottomTab="scratch">
        <ui-notes label="Scratch" placeholder="Anything — it is not kept." [text]="''" />
      </ng-template>

      <!-- The other sub-application. -->
      <ng-template uiSubApp="about">
        <div class="about">
          <ui-empty-state [state]="{ icon: 'info', title: 'A workbench, as a library', hint: 'This demo is @tr-file/ui alone (PRD 001, §17.1).' }" />
        </div>
      </ng-template>
    </ui-workbench-shell>
  `,
  styles: `
    :host {
      display: contents;
    }

    .body,
    .about {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-height: 0;
    }

    .body ui-notes {
      flex: 1;
    }

    .about {
      align-items: center;
      justify-content: center;
      background: var(--vsc-editor-bg);
    }

    .note {
      margin: 0;
      padding: 10px 14px;
      color: var(--vsc-fg-muted);
      font-size: var(--vsc-font-size-sm);
    }

    .log {
      margin: 0;
      padding: 4px 2px;
      list-style: none;
      font-family: var(--vsc-font-mono);
      font-size: var(--vsc-font-size-xs);
    }
  `,
})
export class DemoWorkbench {
  protected readonly workbench = inject(UiWorkbenchService) as DemoWorkbenchService;

  /** The note a group's active tab shows. */
  protected noteOf(groupId: string) {
    const groups = this.workbench.editorGroupsFt;
    const group = groups.stateOf(groupId);
    const tab = group === undefined ? undefined : groups.activeTabOf(group);
    return tab?.noteId === undefined ? undefined : this.workbench.notesFt.find(tab.noteId);
  }

  /** About the note open in the active panel. */
  protected readonly info = computed<readonly UiProperty[]>(() => {
    const note = this.workbench.notesFt.active();
    if (note === null) {
      return [];
    }
    const words = note.text.split(/\s+/).filter((word) => word !== '').length;
    return [
      { label: 'Title', value: note.title },
      { label: 'Id', value: note.id, mono: true },
      { label: 'Words', value: String(words) },
      { label: 'Lines', value: String(note.text.split('\n').length) },
    ];
  });
}
