import { Component, inject, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { UiButton, UiDialog, UiModal } from '@tr-file/ui';
import type { UiDialogModel, UiDialogResult } from '@tr-file/ui';
import { settled } from '../workbench/testing/fs-fixtures';
import { ModalHost } from './modal-host';
import { MODAL_REF, type ModalRef } from './modal-ref';
import { ModalService } from './modal.service';

/** PRD 002, §3 — modal windows that behave like VS Code's. */

function keydown(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
}

/** A modal over a page with a button that had focus before it opened. */
@Component({
  imports: [UiModal, UiButton],
  template: `
    <button id="opener" type="button">Open</button>
    @if (open()) {
      <ui-modal label="Test" [dismissible]="dismissible()" (dismiss)="dismissed.set(dismissed() + 1)">
        <button id="one" uiButton type="button">One</button>
        <button id="two" uiButton type="button" data-autofocus>Two</button>
        <button id="three" uiButton type="button">Three</button>
      </ui-modal>
    }
  `,
})
class ModalPage {
  readonly open = signal(false);
  readonly dismissible = signal(true);
  readonly dismissed = signal(0);
}

describe('UiModal', () => {
  let fixture: ComponentFixture<ModalPage>;
  const $ = (selector: string): HTMLElement => fixture.nativeElement.querySelector(selector);

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ModalPage] }).compileComponents();
    fixture = TestBed.createComponent(ModalPage);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    $('#opener').focus();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
  });

  afterEach(() => fixture.nativeElement.remove());

  it('is a modal dialog to assistive tech', () => {
    const window = $('[role="dialog"]');
    expect(window.getAttribute('aria-modal')).toBe('true');
    expect(window.getAttribute('aria-label')).toBe('Test');
  });

  it('puts focus on what asks for it', () => {
    expect(document.activeElement).toBe($('#two'));
  });

  it('keeps Tab inside the window, both ways', () => {
    $('#three').focus();
    const forward = keydown('Tab');
    $('#three').dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe($('#one'));

    const back = keydown('Tab', { shiftKey: true });
    $('#one').dispatchEvent(back);
    expect(document.activeElement).toBe($('#three'));
  });

  it('asks to be dismissed on Escape', () => {
    $('#two').dispatchEvent(keydown('Escape'));

    expect(fixture.componentInstance.dismissed()).toBe(1);
  });

  /** VS Code's answer to a click outside a dialog: it waits, and says so. */
  it('shakes rather than closing on a press outside it', () => {
    $('.backdrop').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    return Promise.resolve().then(() => {
      fixture.detectChanges();
      expect($('.window').classList).toContain('is-shaking');
      expect(fixture.componentInstance.dismissed()).toBe(0);
    });
  });

  it('shakes on Escape too when it must be answered', () => {
    fixture.componentInstance.dismissible.set(false);
    fixture.detectChanges();

    $('#two').dispatchEvent(keydown('Escape'));

    expect(fixture.componentInstance.dismissed()).toBe(0);
  });

  it('gives focus back to what had it, once it closes', () => {
    fixture.componentInstance.open.set(false);
    fixture.detectChanges();

    expect(document.activeElement).toBe($('#opener'));
  });
});

describe('UiDialog', () => {
  let fixture: ComponentFixture<UiDialog>;
  let chosen: UiDialogResult[];
  const $ = (selector: string): HTMLElement => fixture.nativeElement.querySelector(selector);
  const buttons = (): HTMLButtonElement[] => Array.from(fixture.nativeElement.querySelectorAll('.buttons button'));

  const render = async (model: UiDialogModel): Promise<void> => {
    await TestBed.configureTestingModule({ imports: [UiDialog] }).compileComponents();
    fixture = TestBed.createComponent(UiDialog);
    fixture.componentRef.setInput('dialog', model);
    fixture.componentRef.setInput('idPrefix', 'd1');
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    chosen = [];
    fixture.componentInstance.choose.subscribe((result) => chosen.push(result));
  };

  afterEach(() => fixture.nativeElement.remove());

  it('lays out a VS Code message: icon, message, detail, primary button first', async () => {
    await render({
      severity: 'warning',
      message: 'Replace it?',
      detail: 'It will be overwritten.',
      buttons: [
        { id: 'replace', label: 'Replace' },
        { id: 'cancel', label: 'Cancel' },
      ],
    });

    expect($('ui-icon.severity').classList).toContain('severity-warning');
    expect($('#d1-message').textContent).toBe('Replace it?');
    expect($('#d1-detail').textContent).toBe('It will be overwritten.');
    expect(buttons().map((button) => button.textContent?.trim())).toEqual(['Replace', 'Cancel']);
    expect(buttons()[0]?.classList).not.toContain('is-secondary');
    expect(buttons()[1]?.classList).toContain('is-secondary');
    expect(buttons()[0]?.hasAttribute('data-autofocus')).toBe(true);
  });

  it('reports the button pressed, with the checkbox as it was left', async () => {
    await render({ message: 'Go?', buttons: [{ id: 'go', label: 'Go' }], checkbox: { label: 'Always' } });

    ($('.checkbox input') as HTMLInputElement).click();
    buttons()[0]?.click();

    expect(chosen).toEqual([{ buttonId: 'go', checked: true, value: '' }]);
  });

  it('walks the buttons with the arrows, wrapping', async () => {
    await render({ message: 'x', buttons: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
    buttons()[0]?.focus();

    buttons()[0]?.dispatchEvent(keydown('ArrowRight'));
    expect(document.activeElement).toBe(buttons()[1]);
    buttons()[1]?.dispatchEvent(keydown('ArrowRight'));
    expect(document.activeElement).toBe(buttons()[0]);
  });

  it('focuses the field, selects what was asked, and presses the primary button on Enter', async () => {
    await render({
      message: 'Rename',
      input: { value: 'notes.txt', selection: [0, 5] },
      buttons: [{ id: 'ok', label: 'OK' }, { id: 'cancel', label: 'Cancel' }],
    });
    const field = $('input[type="text"]') as HTMLInputElement;

    expect(field.hasAttribute('data-autofocus')).toBe(true);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 5]);

    field.value = 'todo.txt';
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(keydown('Enter'));

    expect(chosen).toEqual([{ buttonId: 'ok', checked: false, value: 'todo.txt' }]);
  });

  it('holds the primary button back while the field has an error', async () => {
    await render({
      message: 'Name',
      input: { value: '', error: 'A name is required' },
      buttons: [{ id: 'ok', label: 'OK' }],
    });

    expect(buttons()[0]?.disabled).toBe(true);
    expect($('[role="alert"]').textContent).toBe('A name is required');
    $('input').dispatchEvent(keydown('Enter'));
    expect(chosen).toEqual([]);
  });
});

/** A component of the application's own, opened in a window. */
@Component({
  template: `<p>{{ greeting() }}</p><button id="done" type="button" (click)="ref.close('yes')">Done</button>`,
})
class Custom {
  readonly greeting = input('');
  protected readonly ref = inject<ModalRef<string>>(MODAL_REF);
}

describe('ModalService and ModalHost', () => {
  let fixture: ComponentFixture<ModalHost>;
  let modal: ModalService;
  const $ = (selector: string): HTMLElement | null => fixture.nativeElement.querySelector(selector);
  const buttons = (): HTMLButtonElement[] => Array.from(fixture.nativeElement.querySelectorAll('.buttons button'));

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ModalHost] }).compileComponents();
    fixture = TestBed.createComponent(ModalHost);
    document.body.appendChild(fixture.nativeElement);
    modal = TestBed.inject(ModalService);
    fixture.detectChanges();
  });

  afterEach(() => fixture.nativeElement.remove());

  const draw = async (): Promise<void> => {
    fixture.detectChanges();
    await settled();
    fixture.detectChanges();
  };

  it('confirms with the primary button, and not with the other', async () => {
    const yes = modal.confirm({ message: 'Delete?', confirmLabel: 'Delete' });
    await draw();
    expect(buttons().map((button) => button.textContent?.trim())).toEqual(['Delete', 'Cancel']);
    buttons()[0]?.click();
    expect(await yes).toBe(true);

    const no = modal.confirm({ message: 'Delete?' });
    await draw();
    buttons()[1]?.click();
    expect(await no).toBe(false);
  });

  it('names the window by its message, for assistive tech', async () => {
    void modal.confirm({ message: 'Delete?', detail: 'For good.' });
    await draw();

    const window = $('[role="dialog"]');
    const labelled = window?.getAttribute('aria-labelledby') ?? '';
    expect(document.getElementById(labelled)?.textContent).toBe('Delete?');
    expect(document.getElementById(window?.getAttribute('aria-describedby') ?? '')?.textContent).toBe('For good.');
  });

  it('resolves null when dismissed with Escape', async () => {
    const answer = modal.show({ message: 'x', buttons: [{ id: 'ok', label: 'OK' }] });
    await draw();

    $('[role="dialog"]')?.dispatchEvent(keydown('Escape'));

    expect(await answer).toBeNull();
    expect(modal.isOpen()).toBe(false);
  });

  it('prompts, validating as the value changes', async () => {
    const name = modal.prompt({
      message: 'New folder',
      validate: (value) => (value.trim() === '' ? 'A name is required' : null),
    });
    await draw();
    expect(buttons()[0]?.disabled).toBe(true);

    const field = $('input') as HTMLInputElement;
    field.value = 'photos';
    field.dispatchEvent(new Event('input'));
    await draw();
    expect(buttons()[0]?.disabled).toBe(false);

    buttons()[0]?.click();
    expect(await name).toBe('photos');
  });

  it('stacks windows, and only the top one can be used', async () => {
    void modal.message({ message: 'First' });
    void modal.message({ message: 'Second' });
    await draw();

    const windows = Array.from(fixture.nativeElement.querySelectorAll('ui-modal')) as HTMLElement[];
    expect(windows).toHaveLength(2);
    expect(windows[0]?.hasAttribute('inert')).toBe(true);
    expect(windows[1]?.hasAttribute('inert')).toBe(false);
  });

  /** PRD 004, §2.2 — a question something waits on stays above every window opened after it. */
  it('keeps a window asked to stay on top above those opened after it', async () => {
    void modal.message({ message: 'Under' });
    const answer = modal.show({ message: 'Cannot copy', onTop: true, buttons: [{ id: 'skip', label: 'Skip' }] });
    void modal.open(Custom, { label: 'Progress', inputs: { greeting: 'Copying' } });
    void modal.message({ message: 'Later' });
    await draw();

    const windows = Array.from(fixture.nativeElement.querySelectorAll('ui-modal')) as HTMLElement[];
    expect(windows.map((window) => window.textContent?.includes('Cannot copy'))).toEqual([false, false, false, true]);
    expect(windows.map((window) => window.hasAttribute('inert'))).toEqual([true, true, true, false]);

    // Answered, it goes, and the last window opened is the one in use.
    windows[3]?.querySelector<HTMLButtonElement>('.buttons button')?.click();
    expect((await answer)?.buttonId).toBe('skip');
    await draw();
    const left = Array.from(fixture.nativeElement.querySelectorAll('ui-modal')) as HTMLElement[];
    expect(left.at(-1)?.textContent).toContain('Later');
    expect(left.at(-1)?.hasAttribute('inert')).toBe(false);
  });

  it('opens a component of the application’s own, which closes itself with a result', async () => {
    const answer = modal.open<string>(Custom, { label: 'Custom', inputs: { greeting: 'Hello' } });
    await draw();

    expect($('ui-modal p')?.textContent).toBe('Hello');
    ($('#done') as HTMLButtonElement).click();

    expect(await answer).toBe('yes');
    expect(modal.isOpen()).toBe(false);
  });
});
