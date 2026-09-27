import { Component, ElementRef, afterRenderEffect, input, output, viewChild } from '@angular/core';
import { UiButton } from '../controls/ui-button';
import { UiIcon } from '../icon/ui-icon';
import type { UiScmActionEvent, UiScmModel } from '../models';

/**
 * VS Code's source control view, for the details sidebar (PRD 011, §1): the
 * branch and how far it is from its upstream, the commit message box, the
 * changes by group — each row a file, with its buttons — and the latest
 * commits.
 *
 * Presentational like everything else here: it says which button was
 * pressed, on which row or group, and the application decides what that
 * means. The only thing it does itself is `Ctrl`+`Enter` in the message box,
 * which is the Commit button.
 */
@Component({
  selector: 'ui-source-control',
  imports: [UiIcon, UiButton],
  templateUrl: './ui-source-control.html',
  styleUrl: './ui-source-control.scss',
  host: { class: 'ui-source-control', '[attr.aria-busy]': 'scm().busy ? "true" : null' },
})
export class UiSourceControl {
  readonly scm = input.required<UiScmModel>();

  /** What the message box holds, as it is typed. */
  readonly messageChange = output<string>();

  /** The Commit button, or `Ctrl`+`Enter` in the message box. */
  readonly commit = output<void>();

  /** The branch button: switch, or make one. */
  readonly branchSelect = output<void>();

  /** The sync button: pull, then push. */
  readonly syncSelect = output<void>();

  /** A group's header was clicked: `commits` for the log. */
  readonly groupToggle = output<string>();

  /** A button in a group's header. */
  readonly groupAction = output<UiScmActionEvent>();

  /** A row was chosen: show its change. */
  readonly itemOpen = output<string>();

  /** A button on a row. */
  readonly itemAction = output<UiScmActionEvent>();

  /** *Load more* under the commits. */
  readonly moreCommits = output<void>();

  private readonly message = viewChild<ElementRef<HTMLTextAreaElement>>('message');

  private seenFocus = 0;

  constructor() {
    afterRenderEffect(() => {
      const token = this.scm().messageFocus ?? 0;
      if (token !== this.seenFocus) {
        this.seenFocus = token;
        if (token > 0) {
          this.message()?.nativeElement.focus();
        }
      }
    });
  }

  protected onInput(event: Event): void {
    this.messageChange.emit((event.target as HTMLTextAreaElement).value);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (this.scm().canCommit && !this.scm().busy) {
        this.commit.emit();
      }
    }
  }
}
