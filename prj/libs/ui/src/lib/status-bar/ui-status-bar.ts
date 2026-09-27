import { NgTemplateOutlet } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import type { UiFunctionKey, UiStatusItem } from '../models/chrome.model';

/**
 * The 22px status bar: leading items (remote, branch, problems) and trailing
 * items (selection, sort, encoding), with the function-key strip centred
 * between them when there is one.
 *
 * An `accent` item renders on the accent background, matching VS Code's remote
 * indicator.
 *
 * The strip (PRD 004, §2) is Midnight Commander's bottom line — `1 Help
 * 2 Menu 3 View …` — so the keys are discoverable and clickable. The keys
 * themselves are the application's to bind; a click only reports the key's
 * `id`. Pressing one does not take focus, so it acts on the panel the
 * keyboard was in, and the strip is not a tab stop: the keys it stands for
 * are the keyboard way to it. It gives way first when the bar is narrow.
 */
@Component({
  selector: 'ui-status-bar',
  imports: [UiIcon, NgTemplateOutlet],
  templateUrl: './ui-status-bar.html',
  styleUrl: './ui-status-bar.scss',
  host: {
    role: 'group',
    'aria-label': 'Status bar',
  },
})
export class UiStatusBar {
  readonly leadingItems = input<readonly UiStatusItem[]>([]);

  readonly trailingItems = input<readonly UiStatusItem[]>([]);

  /** The function-key strip; nothing is drawn for it when empty. */
  readonly functionKeys = input<readonly UiFunctionKey[]>([]);

  readonly select = output<string>();

  /** A key of the strip was clicked: its `id`. */
  readonly functionKeySelect = output<string>();
}
