import { TestBed } from '@angular/core/testing';
import { UiIconView, type UiIconViewItem } from '@tr-file/ui';

/** PRD 003, §6 — the icon view draws a file's picture where it has one, and says which tiles are on screen. */

const ITEMS: readonly UiIconViewItem[] = [
  { id: 'docs', label: 'docs', icon: 'folder' },
  { id: 'photo.png', label: 'photo.png', icon: 'file', thumbnail: 'blob:thumb' },
];

describe('UiIconView thumbnails', () => {
  it('draws a thumbnail in place of the icon, and reports the tiles it shows', async () => {
    await TestBed.configureTestingModule({ imports: [UiIconView] }).compileComponents();
    const fixture = TestBed.createComponent(UiIconView);
    const shown: (readonly string[])[] = [];
    fixture.componentInstance.shown.subscribe((ids) => shown.push(ids));
    fixture.componentRef.setInput('items', ITEMS);
    fixture.detectChanges();
    await fixture.whenStable();

    const tiles = fixture.nativeElement.querySelectorAll('.item') as NodeListOf<HTMLElement>;
    expect(tiles[0]?.querySelector('img')).toBeNull();
    expect(tiles[1]?.querySelector('img')?.getAttribute('src')).toBe('blob:thumb');
    expect(tiles[1]?.querySelector('ui-icon')).toBeNull();
    expect(shown).toEqual([['docs', 'photo.png']]);

    fixture.componentRef.setInput('items', [...ITEMS]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(shown).toHaveLength(1);
  });
});
