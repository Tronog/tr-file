import { Component, computed, input } from '@angular/core';

/**
 * A 4px progress track, as used by the Transfers panel.
 *
 * Implemented natively — the app does not load Tabler, which the mockup
 * borrowed the bar from. A `null` value means "queued": the bar becomes a 40%
 * wide sliver sliding back and forth, and the ARIA value attributes are
 * dropped so assistive tech announces it as indeterminate.
 */
@Component({
  selector: 'ui-progress',
  template: `
    <div class="bar" [class.is-indeterminate]="indeterminate()" [style.width.%]="width()"></div>
  `,
  styleUrl: './ui-progress.scss',
  host: {
    role: 'progressbar',
    '[attr.aria-label]': 'label()',
    '[attr.aria-valuenow]': 'value()',
    '[attr.aria-valuemin]': 'indeterminate() ? null : 0',
    '[attr.aria-valuemax]': 'indeterminate() ? null : 100',
  },
})
export class UiProgress {
  /** 0–100, or `null` for an indeterminate (queued) transfer. */
  readonly value = input<number | null>(null);

  /** Accessible name, e.g. the transfer it belongs to. */
  readonly label = input.required<string>();

  protected readonly indeterminate = computed(() => this.value() === null);

  protected readonly width = computed(() => this.value() ?? null);
}
