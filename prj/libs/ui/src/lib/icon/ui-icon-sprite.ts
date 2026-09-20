import { Component } from '@angular/core';

/**
 * The hidden SVG sprite every `<ui-icon>` references.
 *
 * Render it exactly once, as early in the document as possible — `UiWorkbench`
 * does this for the app shell.
 */
@Component({
  selector: 'ui-icon-sprite',
  templateUrl: './ui-icon-sprite.html',
  styles: `
    :host {
      display: none;
    }
  `,
})
export class UiIconSprite {}
