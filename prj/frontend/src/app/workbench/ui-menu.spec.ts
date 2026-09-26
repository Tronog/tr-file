import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { UiActivityBar, UiContextMenu } from '@tr-file/ui';
import type { UiMenuAnchor, UiMenuDismissReason, UiMenuItem } from '@tr-file/ui';

/** PRD 007, §1 — the Settings gear opens a menu, and the menu behaves like one. */

const ITEMS: readonly UiMenuItem[] = [
  { id: 'todo', label: 'Todo', disabled: true },
  { id: 'theme', label: 'Theme' },
  { id: 'keys', label: 'Keyboard Shortcuts', keybinding: 'Ctrl+K Ctrl+S' },
];

function keydown(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
}

/** A button that opens a menu, the way the workbench does it. */
@Component({
  imports: [UiContextMenu],
  template: `
    <button id="opener" type="button">Settings</button>
    <p id="elsewhere">Elsewhere</p>
    @if (open()) {
      <ui-context-menu
        label="Settings"
        origin="bottom-left"
        [fixed]="true"
        [x]="48"
        [y]="600"
        [items]="items"
        (select)="chosen.push($event)"
        (dismiss)="dismissed.push($event)"
      />
    }
  `,
})
class MenuPage {
  readonly open = signal(false);
  readonly items = ITEMS;
  readonly chosen: string[] = [];
  readonly dismissed: UiMenuDismissReason[] = [];
}

describe('UiContextMenu', () => {
  let fixture: ComponentFixture<MenuPage>;
  const $ = (selector: string): HTMLElement => fixture.nativeElement.querySelector(selector);
  const rows = (): HTMLButtonElement[] => Array.from(fixture.nativeElement.querySelectorAll('.menu-row'));
  const page = (): MenuPage => fixture.componentInstance;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MenuPage] }).compileComponents();
    fixture = TestBed.createComponent(MenuPage);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    $('#opener').focus();
    page().open.set(true);
    fixture.detectChanges();
  });

  afterEach(() => fixture.nativeElement.remove());

  it('is a menu of menu items, opening upward from its point in the viewport', () => {
    const menu = $('ui-context-menu');

    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.getAttribute('aria-label')).toBe('Settings');
    expect(rows().map((row) => row.getAttribute('role'))).toEqual(['menuitem', 'menuitem', 'menuitem']);
    expect(menu.style.position).toBe('fixed');
    expect([menu.style.left, menu.style.top]).toEqual(['48px', '600px']);
    expect(menu.classList).toContain('from-bottom');
  });

  it('takes focus on its first row as it opens', () => {
    expect(document.activeElement).toBe(rows()[0]);
  });

  /** Disabled rows stay in the keyboard order, so they can be read. */
  it('walks the rows with the arrows, wrapping, and jumps with Home and End', () => {
    rows()[0]?.dispatchEvent(keydown('ArrowDown'));
    expect(document.activeElement).toBe(rows()[1]);

    rows()[1]?.dispatchEvent(keydown('ArrowUp'));
    rows()[0]?.dispatchEvent(keydown('ArrowUp'));
    expect(document.activeElement).toBe(rows()[2]);

    rows()[2]?.dispatchEvent(keydown('Home'));
    expect(document.activeElement).toBe(rows()[0]);
    rows()[0]?.dispatchEvent(keydown('End'));
    expect(document.activeElement).toBe(rows()[2]);
  });

  it('says a disabled row is disabled, and does nothing when it is chosen', () => {
    expect(rows()[0]?.getAttribute('aria-disabled')).toBe('true');

    rows()[0]?.click();

    expect(page().chosen).toEqual([]);
    expect(page().dismissed).toEqual([]);
  });

  it('reports a choice, and hands focus back to the button that opened it', () => {
    rows()[1]?.click();

    expect(page().chosen).toEqual(['theme']);
    expect(document.activeElement).toBe($('#opener'));
  });

  it('asks to close on Escape, giving focus back', () => {
    rows()[0]?.dispatchEvent(keydown('Escape'));

    expect(page().dismissed).toEqual(['escape']);
    expect(document.activeElement).toBe($('#opener'));
  });

  it('asks to close on Tab, letting focus move on', () => {
    const tab = keydown('Tab');
    rows()[0]?.dispatchEvent(tab);

    expect(page().dismissed).toEqual(['tab']);
    expect(tab.defaultPrevented).toBe(false);
  });

  it('asks to close on a click elsewhere, but not on a click inside it', () => {
    rows()[0]?.click();
    expect(page().dismissed).toEqual([]);

    $('#elsewhere').click();
    expect(page().dismissed).toEqual(['outside']);
  });

  it('asks to close when the window loses focus', () => {
    window.dispatchEvent(new Event('blur'));

    expect(page().dismissed).toEqual(['blur']);
  });
});

describe('UiActivityBar menu buttons', () => {
  let fixture: ComponentFixture<UiActivityBar>;
  let opened: UiMenuAnchor[];
  let selected: string[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiActivityBar] }).compileComponents();
    fixture = TestBed.createComponent(UiActivityBar);
    fixture.componentRef.setInput('items', [{ id: 'explorer', label: 'Explorer', icon: 'copy' }]);
    fixture.componentRef.setInput('bottomItems', [
      { id: 'account', label: 'Account', icon: 'user' },
      { id: 'settings', label: 'Settings', icon: 'settings', hasMenu: true },
    ]);
    fixture.detectChanges();
    opened = [];
    selected = [];
    fixture.componentInstance.menuOpen.subscribe((anchor) => opened.push(anchor));
    fixture.componentInstance.select.subscribe((id) => selected.push(id));
  });

  const button = (label: string): HTMLButtonElement =>
    fixture.nativeElement.querySelector(`button[aria-label="${label}"]`);

  it('says a menu button opens a menu, and whether it is open', () => {
    expect(button('Settings').getAttribute('aria-haspopup')).toBe('menu');
    expect(button('Settings').getAttribute('aria-expanded')).toBe('false');
    expect(button('Account').hasAttribute('aria-haspopup')).toBe(false);

    fixture.componentRef.setInput('bottomItems', [
      { id: 'settings', label: 'Settings', icon: 'settings', hasMenu: true, expanded: true },
    ]);
    fixture.detectChanges();
    expect(button('Settings').getAttribute('aria-expanded')).toBe('true');
  });

  it('reports a menu button with where it is, and any other as a selection', () => {
    button('Settings').click();
    button('Account').click();

    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ id: 'settings' });
    expect(Object.keys(opened[0] ?? {}).sort()).toEqual(['bottom', 'id', 'left', 'right', 'top']);
    expect(selected).toEqual(['account']);
  });
});
