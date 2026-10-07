import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { UiJsonTree } from '../../public-api';

/** PRD 005, §5 — a JSON document as a tree, coloured, kept on one tab stop. */
describe('UiJsonTree', () => {
  let fixture: ComponentFixture<UiJsonTree>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiJsonTree] }).compileComponents();
    fixture = TestBed.createComponent(UiJsonTree);
    fixture.componentRef.setInput('value', { name: 'tr-file', tags: ['a', 'b'], deep: { inner: { x: 1 } }, none: null });
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => fixture.nativeElement.remove());

  /** A row's parts — key, colon, value, size — with a space between each. */
  const rows = (): string[] =>
    (Array.from(fixture.nativeElement.querySelectorAll('.row')) as HTMLElement[]).map((row) =>
      (Array.from(row.querySelectorAll('.key, .value, .size')) as HTMLElement[]).map((part) => part.textContent?.trim()).join(' '),
    );
  const press = (key: string): void => {
    fixture.nativeElement.querySelector('.viewport').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    fixture.detectChanges();
  };
  const where = (): string => (fixture.nativeElement.querySelector('.where') as HTMLElement).textContent ?? '';

  it('opens a small document two levels deep, keys and values coloured', () => {
    expect(rows()).toEqual(['{ 4 keys', '"name" "tr-file"', '"tags" [ 2 items', '0 "a"', '1 "b"', '"deep" { 1 key', '"inner" {…} 1 key', '"none" null']);
    expect(fixture.nativeElement.querySelector('.value.is-string')?.textContent).toBe('"tr-file"');
    expect(fixture.nativeElement.querySelector('.value.is-null')?.textContent).toBe('null');
  });

  it('walks with the arrows, opening and closing, and says where the cursor is', () => {
    press('ArrowDown');
    press('ArrowDown');
    expect(where()).toBe('$.tags');
    press('ArrowLeft');
    expect(rows()).toContain('"tags" […] 2 items');
    press('ArrowRight');
    press('ArrowRight');
    expect(where()).toBe('$.tags[0]');
    press('ArrowLeft');
    expect(where()).toBe('$.tags');
    press('End');
    expect(where()).toBe('$.none');
  });

  it('opens and closes everything', () => {
    (fixture.nativeElement.querySelector('[aria-label="Expand all"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(rows()).toContain('"x" 1');
    (fixture.nativeElement.querySelector('[aria-label="Collapse all"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(rows()).toEqual(['{ 4 keys', '"name" "tr-file"', '"tags" […] 2 items', '"deep" {…} 1 key', '"none" null']);
  });

  /** PRD 005, §5.1. */
  describe('search', () => {
    const search = (query: string): HTMLInputElement => {
      const field = fixture.nativeElement.querySelector('.search input') as HTMLInputElement;
      field.value = query;
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      return field;
    };
    const count = (): string => (fixture.nativeElement.querySelector('.matches') as HTMLElement).textContent?.trim() ?? '';

    it('finds keys and values in what is closed too, and steps to each, opening what it is in', () => {
      (fixture.nativeElement.querySelector('[aria-label="Collapse all"]') as HTMLElement).click();
      const field = search('X');
      expect(count()).toBe('1 found');

      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      fixture.detectChanges();
      expect(count()).toBe('1 of 1');
      expect(where()).toBe('$.deep.inner.x');
      expect(rows()).toContain('"x" 1');
      expect(fixture.nativeElement.querySelector('.row.is-focused mark')?.textContent).toBe('x');
    });

    it('steps round, forward and back, and says when nothing matches', () => {
      const field = search('a');
      // "name", "tags", the value "a", "tr-file"? no — keys and values holding an "a".
      const total = Number(count().split(' ')[0]);
      expect(total).toBeGreaterThan(1);
      const step = (shiftKey = false): void => {
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey, bubbles: true, cancelable: true }));
        fixture.detectChanges();
      };
      step();
      expect(count()).toBe(`1 of ${total}`);
      step(true);
      expect(count()).toBe(`${total} of ${total}`);

      search('zzz');
      expect(count()).toBe('No results');
    });

    it('is reached with Ctrl+F from the tree, and Escape clears it and goes back', () => {
      press('f');
      fixture.nativeElement.querySelector('.viewport').dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
      fixture.detectChanges();
      const field = fixture.nativeElement.querySelector('.search input') as HTMLInputElement;
      expect(document.activeElement).toBe(field);

      search('tags');
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      fixture.detectChanges();
      expect(field.value).toBe('');
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      fixture.detectChanges();
      expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.viewport'));
    });
  });

  /** PRD 005, §5.2. */
  describe('editing', () => {
    let edits: unknown[];

    beforeEach(() => {
      edits = [];
      fixture.componentInstance.edit.subscribe((edit) => edits.push(edit));
      fixture.componentRef.setInput('editable', true);
      fixture.detectChanges();
    });

    const field = (): HTMLInputElement => fixture.nativeElement.querySelector('input.edit') as HTMLInputElement;
    const type = (value: string, key = 'Enter'): void => {
      field().value = value;
      field().dispatchEvent(new Event('input'));
      fixture.detectChanges();
      field()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      fixture.detectChanges();
    };

    it('edits a value on Enter — a string stays a string — and reports it', () => {
      press('ArrowDown');
      press('Enter');
      expect(field().value).toBe('tr-file');
      type('7');
      expect(edits).toEqual([{ pointer: '/name', value: '7' }]);
      expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.viewport'));
    });

    it('reads another value as JSON, and keeps the field open when it is none', () => {
      (fixture.nativeElement.querySelectorAll('.value.is-null')[0] as HTMLElement).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      fixture.detectChanges();
      type('nope');
      expect(field().classList).toContain('is-invalid');
      expect(edits).toEqual([]);
      type('"text"');
      expect(edits).toEqual([{ pointer: '/none', value: 'text' }]);
    });

    it('renames a key on F2 over an object, refusing one its object has', () => {
      press('ArrowDown');
      press('ArrowDown');
      press('F2');
      expect(field().value).toBe('tags');
      type('name');
      expect(field().title).toContain('already');
      type('labels');
      expect(edits).toEqual([{ pointer: '/tags', key: 'labels' }]);
      expect(where()).toBe('$.labels');
    });

    it('drops the edit on Escape, and opens and closes an object on Enter', () => {
      press('ArrowDown');
      press('Enter');
      type('x', 'Escape');
      expect(edits).toEqual([]);
      expect(field()).toBeNull();

      press('ArrowDown');
      press('Enter');
      expect(rows()).toContain('"tags" […] 2 items');
    });

    it('edits nothing while it is only viewed', () => {
      fixture.componentRef.setInput('editable', false);
      fixture.detectChanges();
      press('ArrowDown');
      press('F2');
      expect(field()).toBeNull();
    });
  });
});
