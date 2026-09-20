import { Component, computed, input } from '@angular/core';
import type { UiIconName, UiIconSize, UiIconTint } from '../models/icon.model';

/**
 * A single workbench icon.
 *
 * Draws a `<use>` reference into the sprite rendered by `UiIconSprite`, so an
 * icon costs one element regardless of how many paths it has. Purely
 * decorative by default; pass `label` when the icon is the only content of an
 * interactive element and nothing else names it.
 */
@Component({
  selector: 'ui-icon',
  template: `
    <svg
      class="ui-icon"
      [attr.aria-hidden]="label() ? null : 'true'"
      [attr.role]="label() ? 'img' : null"
      [attr.aria-label]="label()"
      focusable="false"
    >
      <use [attr.href]="href()"></use>
    </svg>
  `,
  styleUrl: './ui-icon.scss',
  host: {
    class: 'ui-icon-host',
    '[class]': '"ui-icon-size-" + size()',
    '[style.color]': 'tintColor()',
  },
})
export class UiIcon {
  /** Which symbol to draw. */
  readonly name = input.required<UiIconName>();

  /** 16px (`sm`, the list/tab size), 20px, 24px or 42px. */
  readonly size = input<UiIconSize>('sm');

  /** File-type tint; resolves to the matching `--vsc-ic-*` token. */
  readonly tint = input<UiIconTint | undefined>(undefined);

  /** Accessible name. Leave unset for decorative icons. */
  readonly label = input<string | undefined>(undefined);

  protected readonly href = computed(() => `#ui-icon-${this.name()}`);

  protected readonly tintColor = computed(() => {
    const tint = this.tint();
    return tint ? `var(--vsc-ic-${tint})` : null;
  });
}
