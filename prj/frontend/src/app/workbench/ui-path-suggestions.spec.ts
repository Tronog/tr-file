import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { UiBreadcrumbs, type UiPathSuggestion } from '@tr-file/ui';

/** PRD 004, §4.2 — the path bar suggests places as it is typed in. */
describe('UiBreadcrumbs suggestions', () => {
  let fixture: ComponentFixture<UiBreadcrumbs>;
  let typed: string[];
  let submitted: string[];

  const SUGGESTIONS: readonly UiPathSuggestion[] = [
    { value: '/docs/prd', label: 'prd', icon: 'folder', folder: true },
    { value: '/docs/Prd-notes.md', label: 'Prd-notes.md', icon: 'file' },
  ];

  beforeEach(() => {
    fixture = TestBed.createComponent(UiBreadcrumbs);
    fixture.componentRef.setInput('items', [{ id: 'root', label: 'tr-file' }]);
    fixture.componentRef.setInput('location', '/docs');
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    typed = [];
    submitted = [];
    fixture.componentInstance.pathInput.subscribe((text) => typed.push(text));
    fixture.componentInstance.pathSubmit.subscribe((text) => submitted.push(text));
    fixture.componentInstance.edit();
    fixture.detectChanges();
  });

  afterEach(() => fixture.nativeElement.remove());

  const field = () => fixture.nativeElement.querySelector('input.location') as HTMLInputElement;
  const options = () => [...fixture.nativeElement.querySelectorAll('[role=option]')] as HTMLElement[];
  const key = (name: string, init: KeyboardEventInit = {}) => {
    field().dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
    fixture.detectChanges();
  };
  const suggest = (suggestions: readonly UiPathSuggestion[]) => {
    fixture.componentRef.setInput('suggestions', suggestions);
    fixture.detectChanges();
  };

  it('reports what the field holds as the edit begins, and as it is typed in', () => {
    expect(typed).toEqual(['/docs']);
    field().value = '/docs/pr';
    field().dispatchEvent(new Event('input'));
    expect(typed).toEqual(['/docs', '/docs/pr']);
  });

  it('lists the suggestions under the field, as a combobox', () => {
    suggest(SUGGESTIONS);
    expect(options().map((option) => option.querySelector('.suggestion-label')?.textContent)).toEqual(['prd', 'Prd-notes.md']);
    expect(field().getAttribute('aria-expanded')).toBe('true');
    expect(field().getAttribute('role')).toBe('combobox');
  });

  it('chooses the first at once, so Enter goes to it', () => {
    suggest(SUGGESTIONS);
    expect(options()[0]?.getAttribute('aria-selected')).toBe('true');
    expect(field().getAttribute('aria-activedescendant')).toBe(options()[0]?.id);
    key('Enter');
    expect(submitted).toEqual(['/docs/prd']);
  });

  it('chooses another with the arrows, round at the ends', () => {
    suggest(SUGGESTIONS);
    key('ArrowDown');
    expect(options()[1]?.getAttribute('aria-selected')).toBe('true');
    key('ArrowDown');
    key('ArrowUp');
    expect(options()[1]?.getAttribute('aria-selected')).toBe('true');
    key('Enter');
    expect(submitted).toEqual(['/docs/Prd-notes.md']);
  });

  it('goes where typed once the list is closed, or when nothing fits', () => {
    suggest(SUGGESTIONS);
    field().value = '/docs/somewhere';
    key('Escape');
    key('Enter');
    expect(submitted).toEqual(['/docs/somewhere']);
  });

  it('completes the text with Tab — a folder with a slash, to go on inside it', () => {
    suggest(SUGGESTIONS);
    key('Tab');
    expect(field().value).toBe('/docs/prd/');
    expect(typed.at(-1)).toBe('/docs/prd/');
  });

  it('closes the list with Escape, and the edit with the next', () => {
    suggest(SUGGESTIONS);
    key('Escape');
    expect(options()).toEqual([]);
    expect(field()).not.toBeNull();
    key('Escape');
    expect(fixture.nativeElement.querySelector('input.location')).toBeNull();
  });

  it('goes to a suggestion pressed, without the field losing the edit first', () => {
    suggest(SUGGESTIONS);
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    options()[1]?.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    expect(submitted).toEqual(['/docs/Prd-notes.md']);
  });
});
