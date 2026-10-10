import { UiListSelection } from './list-selection';
import { uiSelectionMode } from './selection-modes';

const plain = { shiftKey: false, ctrlKey: false, metaKey: false };
const shift = { ...plain, shiftKey: true };
const ctrl = { ...plain, ctrlKey: true };

describe('selection modes (PRD 004, §2.2)', () => {
  it('normal: the selection follows the cursor, a click picks one entry', () => {
    const normal = uiSelectionMode('normal');
    expect(normal.move(plain)).toBe('replace');
    expect(normal.move(ctrl)).toBe('focus');
    expect(normal.move(shift)).toBe('range');
    expect(normal.click(plain)).toBe('replace');
    expect(normal.click(ctrl)).toBe('toggle');
    expect(normal.find()).toBe('replace');
    expect(normal.keepsLone).toBe(true);
    expect(normal.blankPressClears).toBe(true);
  });

  it('additive: moving leaves the selection, a click toggles, Shift adds a range', () => {
    const additive = uiSelectionMode('additive');
    expect(additive.move(plain)).toBe('focus');
    expect(additive.move(shift)).toBe('range-add');
    expect(additive.click(plain)).toBe('toggle');
    expect(additive.click(ctrl)).toBe('toggle');
    expect(additive.click(shift)).toBe('range-add');
    expect(additive.find()).toBe('focus');
    expect(additive.keepsLone).toBe(false);
    expect(additive.blankPressClears).toBe(false);
  });
});

describe('UiListSelection.mark', () => {
  const ids = ['a', 'b', 'c'];

  it('keeps the lone entry the cursor stands on, by default', () => {
    const change = new UiListSelection().mark({ ids, selected: new Set(['a']), target: 'a', next: 'b' });
    expect(change).toEqual({ selected: ['a'], focused: 'b' });
  });

  it('flips a lone entry when told it was picked (additive)', () => {
    const change = new UiListSelection().mark({ ids, selected: new Set(['a']), target: 'a', next: 'b', keepsLone: false });
    expect(change).toEqual({ selected: [], focused: 'b' });
  });
});
