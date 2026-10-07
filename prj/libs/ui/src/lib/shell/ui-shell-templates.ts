import { Directive, Injector, TemplateRef, inject, input, output } from '@angular/core';
import type { UiIconAction } from '../models/icon.model';

/**
 * What a kind of panel content looks like (PRD 001, §17.1): drawn in a panel
 * group whose active tab is of that content (`UiPanelContentDef.type`), the
 * group's id as the template's implicit value.
 *
 *     <ng-template uiPanelContent="files" let-groupId>
 *       <ui-file-browser [browser]="files.browser(groupId)" … />
 *     </ng-template>
 */
@Directive({ selector: 'ng-template[uiPanelContent]' })
export class UiPanelContentTemplate {
  readonly type = input.required<string>({ alias: 'uiPanelContent' });
  readonly template = inject<TemplateRef<{ readonly $implicit: string }>>(TemplateRef);
}

/** A tab of the bottom panel, by its id (`UiBottomPanelConfig.tabs`). */
@Directive({ selector: 'ng-template[uiBottomTab]' })
export class UiBottomTabTemplate {
  readonly id = input.required<string>({ alias: 'uiBottomTab' });
  readonly template = inject<TemplateRef<unknown>>(TemplateRef);
}

/** A sub-application other than the main one: the whole centre, while it is shown (`UiSubApp`). */
@Directive({ selector: 'ng-template[uiSubApp]' })
export class UiSubAppTemplate {
  readonly id = input.required<string>({ alias: 'uiSubApp' });
  readonly template = inject<TemplateRef<unknown>>(TemplateRef);
}

/**
 * A whole sidebar drawn by the application, by its id (`UiSidebarDef`) — in
 * place of the one the shell draws from its panes' templates. The application
 * then draws the `UiSidebar`, its panes and its `data-focus-region` itself.
 */
@Directive({ selector: 'ng-template[uiSidebar]' })
export class UiSidebarTemplate {
  readonly id = input.required<string>({ alias: 'uiSidebar' });
  readonly template = inject<TemplateRef<unknown>>(TemplateRef);
}

/**
 * The content of a sidebar's pane, by its id (`UiPaneDef`): the shell draws
 * the `UiPane` around it — header, moving, resizing, collapsing — with
 * whatever the template adds to the header.
 */
@Directive({ selector: 'ng-template[uiPane]' })
export class UiPaneTemplate {
  readonly id = input.required<string>({ alias: 'uiPane' });
  /** The header, if not the pane's label. */
  readonly paneTitle = input<string | null>(null);
  /** Buttons in the header, reported by `paneAction`. */
  readonly paneActions = input<readonly UiIconAction[]>([]);
  /** Takes the room left in its sidebar. */
  readonly paneGrow = input(false);
  readonly paneAction = output<string>();
  /** The pane was opened or closed from its header. */
  readonly paneToggle = output<boolean>();
  readonly template = inject<TemplateRef<unknown>>(TemplateRef);
}

/**
 * Exposes the injector of the element it is on — so a template of the
 * application's drawn there sees the components around it, as the content of
 * a panel finds its `UiPanelGroup` (`UiPanelBody`).
 */
@Directive({ selector: '[uiNodeInjector]', exportAs: 'uiNodeInjector' })
export class UiNodeInjector {
  readonly injector = inject(Injector);
}
