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
});
