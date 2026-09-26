import { Component, input } from '@angular/core';

/**
 * A text button, VS Code style: `primary` in the accent colour, `secondary`
 * in a quiet grey. An attribute component on a real `<button>`, so it keeps
 * every native behaviour — focus, `disabled`, form submission.
 *
 *     <button uiButton type="button" (click)="…">Replace</button>
 *     <button uiButton variant="secondary" type="button" (click)="…">Cancel</button>
 */
@Component({
  selector: 'button[uiButton]',
  template: '<ng-content />',
  styleUrl: './ui-button.scss',
  host: {
    class: 'ui-button',
    '[class.is-secondary]': 'variant() === "secondary"',
  },
})
export class UiButton {
  readonly variant = input<'primary' | 'secondary'>('primary');
}
