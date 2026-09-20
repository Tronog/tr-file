import { Component, input } from '@angular/core';

/**
 * The 4px drag handle between two workbench areas.
 *
 * Transparent until hovered, focused or marked `active`, when an `::after`
 * overlay fills it with the accent colour — the same trick the mockup uses, so
 * the handle never shifts the layout.
 *
 * Not focusable on purpose: until dragging exists there is no value to report,
 * and a focusable `separator` must expose `aria-valuenow`. Adding drag support
 * means adding the value attributes and `tabindex` back together.
 *
 * Dragging is deliberately not implemented: PRD 001 defers interactivity, so
 * the sash only renders and announces itself. Resizing arrives with the
 * behaviour milestone.
 */
@Component({
  selector: 'ui-sash',
  template: '',
  styleUrl: './ui-sash.scss',
  host: {
    role: 'separator',
    // Hidden from assistive tech while it is inert: it exposes no value and
    // cannot be moved. Drag support removes this along with adding aria-value*.
    'aria-hidden': 'true',
    '[attr.aria-orientation]': 'orientation()',
    '[attr.aria-label]': 'label()',
    '[class.is-horizontal]': 'orientation() === "horizontal"',
    '[class.is-vertical]': 'orientation() === "vertical"',
    '[class.is-active]': 'active()',
  },
})
export class UiSash {
  /**
   * `vertical` separates two columns (a vertical line, `col-resize`);
   * `horizontal` separates two rows (a horizontal line, `row-resize`).
   */
  readonly orientation = input<'vertical' | 'horizontal'>('vertical');

  /** Held by the pointer; keeps the accent fill visible. */
  readonly active = input<boolean>(false);

  readonly label = input<string>('Resize');
}
