import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { UiActivityBar, UiContextMenu, UiTitleBar } from '../../public-api';
import type { UiMenuAnchor, UiMenuBarItem, UiMenuBarSelection, UiMenuDismissReason, UiMenuItem } from '../../public-api';

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

/** PRD 008, §1 — the main menu: a menu bar whose titles open menus under them. */
@Component({
  imports: [UiTitleBar],
  template: `
    <ui-title-bar
      [menuItems]="menus()"
      (menuOpenChange)="open.set($event); requests.push($event)"
      (menuItemSelect)="chosen.push($event)"
    />
    <p id="elsewhere">Elsewhere</p>
  `,
})
class TitleBarPage {
  readonly open = signal<string | null>(null);
  readonly requests: (string | null)[] = [];
  readonly chosen: UiMenuBarSelection[] = [];
  private readonly base: readonly UiMenuBarItem[] = [
    { id: 'file', label: 'File', items: [{ id: 'todo', label: 'Todo', disabled: true }] },
    { id: 'edit', label: 'Edit', items: [{ id: 'todo', label: 'Todo', disabled: true }] },
    {
      id: 'go',
      label: 'Go',
      items: [
        { id: 'go.local', label: 'Local Computer', checked: true },
        { id: 'go.remote', label: 'Remote Computer…', checked: false },
      ],
    },
  ];
  readonly menus = () => this.base.map((menu) => ({ ...menu, open: menu.id === this.open() }));
}

describe('UiTitleBar main menu', () => {
  let fixture: ComponentFixture<TitleBarPage>;
  const $ = (selector: string): HTMLElement => fixture.nativeElement.querySelector(selector);
  const title = (label: string): HTMLButtonElement =>
    Array.from(fixture.nativeElement.querySelectorAll('.menu-item') as NodeListOf<HTMLButtonElement>).find(
      (button) => button.textContent?.trim() === label,
    ) as HTMLButtonElement;
  const page = (): TitleBarPage => fixture.componentInstance;
  const menu = (): HTMLElement | null => fixture.nativeElement.querySelector('ui-context-menu');
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TitleBarPage] }).compileComponents();
    fixture = TestBed.createComponent(TitleBarPage);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => fixture.nativeElement.remove());

  it('is a menu bar of menu buttons', () => {
    expect($('nav').getAttribute('role')).toBe('menubar');
    expect(title('Go').getAttribute('role')).toBe('menuitem');
    expect(title('Go').getAttribute('aria-haspopup')).toBe('menu');
    expect(title('Go').getAttribute('aria-expanded')).toBe('false');
  });

  it('opens a menu under its title on a click, and closes it on a second', async () => {
    title('Go').click();
    await settle();

    expect(page().requests).toEqual(['go']);
    expect(menu()?.getAttribute('aria-label')).toBe('Go');
    expect(title('Go').getAttribute('aria-expanded')).toBe('true');

    title('Go').click();
    await settle();
    expect(page().open()).toBeNull();
    expect(menu()).toBeNull();
  });

  it('shows the choice in effect with a check mark, as a radio item', async () => {
    title('Go').click();
    await settle();

    const rows = Array.from(fixture.nativeElement.querySelectorAll('.menu-row')) as HTMLElement[];
    expect(rows.map((row) => row.getAttribute('role'))).toEqual(['menuitemradio', 'menuitemradio']);
    expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect(rows[0]?.querySelector('ui-icon')).not.toBeNull();
    expect(rows[1]?.querySelector('ui-icon')).toBeNull();
  });

  it('reports a choice with the menu it was made in', async () => {
    title('Go').click();
    await settle();

    (fixture.nativeElement.querySelectorAll('.menu-row')[1] as HTMLElement).click();

    expect(page().chosen).toEqual([{ menuId: 'go', itemId: 'go.remote' }]);
  });

  /** A click on another title must not be taken for "a click elsewhere". */
  it('switches straight to another menu when its title is clicked', async () => {
    title('File').click();
    await settle();

    title('Edit').click();
    await settle();

    expect(page().open()).toBe('edit');
    expect(menu()?.getAttribute('aria-label')).toBe('Edit');
  });

  it('switches menus by pointing at another title while one is open, and not otherwise', async () => {
    title('Edit').dispatchEvent(new PointerEvent('pointerenter'));
    expect(page().requests).toEqual([]);

    title('File').click();
    await settle();
    title('Go').dispatchEvent(new PointerEvent('pointerenter'));
    await settle();

    expect(page().open()).toBe('go');
  });

  it('moves between menus with ← and → inside one, wrapping', async () => {
    title('File').click();
    await settle();

    (fixture.nativeElement.querySelector('.menu-row') as HTMLElement).dispatchEvent(keydown('ArrowLeft'));
    await settle();
    expect(page().open()).toBe('go');

    (fixture.nativeElement.querySelector('.menu-row') as HTMLElement).dispatchEvent(keydown('ArrowRight'));
    await settle();
    expect(page().open()).toBe('file');
  });

  it('opens a menu with ↓ on its title, and walks the titles with ← and →', async () => {
    title('File').focus();
    title('File').dispatchEvent(keydown('ArrowRight'));
    expect(document.activeElement).toBe(title('Edit'));

    title('Edit').dispatchEvent(keydown('ArrowDown'));
    await settle();
    expect(page().open()).toBe('edit');
  });

  it('closes on a click elsewhere, and on Escape, giving focus back to its title', async () => {
    title('Go').focus();
    title('Go').click();
    await settle();
    $('#elsewhere').click();
    await settle();
    expect(page().open()).toBeNull();

    title('Go').focus();
    title('Go').click();
    await settle();
    (fixture.nativeElement.querySelector('.menu-row') as HTMLElement).dispatchEvent(keydown('Escape'));
    await settle();
    expect(page().open()).toBeNull();
    expect(document.activeElement).toBe(title('Go'));
  });
});
