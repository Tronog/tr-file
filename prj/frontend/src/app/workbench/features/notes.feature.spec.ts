import { MemorySettingsStore } from '../../settings/settings.service';
import { NOTES_KEY, NOTES_MAX_BYTES, NOTES_SAVE_DELAY_MS, NotesFeature } from './notes.feature';

describe('NotesFeature', () => {
  let store: MemorySettingsStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new MemorySettingsStore();
  });

  afterEach(() => vi.useRealTimers());

  it('starts with what was kept, or nothing', () => {
    expect(new NotesFeature(store).text()).toBe('');
    store.set(NOTES_KEY, 'buy milk');
    expect(new NotesFeature(store).text()).toBe('buy milk');
    store.set(NOTES_KEY, 42);
    expect(new NotesFeature(store).text()).toBe('');
  });

  it('writes once typing pauses', () => {
    const notes = new NotesFeature(store);
    notes.edit('a');
    notes.edit('ab');
    expect(notes.text()).toBe('ab');
    expect(store.get(NOTES_KEY)).toBeUndefined();

    vi.advanceTimersByTime(NOTES_SAVE_DELAY_MS);
    expect(store.get(NOTES_KEY)).toBe('ab');
  });

  it('writes at once on flush, and only what is waiting', () => {
    const notes = new NotesFeature(store);
    const set = vi.spyOn(store, 'set');
    notes.flush();
    expect(set).not.toHaveBeenCalled();

    notes.edit('now');
    notes.flush();
    expect(store.get(NOTES_KEY)).toBe('now');
    vi.advanceTimersByTime(NOTES_SAVE_DELAY_MS);
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('forgets the key when the notes are emptied', () => {
    store.set(NOTES_KEY, 'old');
    const notes = new NotesFeature(store);
    notes.edit('');
    notes.flush();
    expect(store.get(NOTES_KEY)).toBeUndefined();
  });

  it('says so, and keeps the last good text, when the notes grow past the limit', () => {
    const notes = new NotesFeature(store);
    notes.edit('short');
    notes.flush();

    notes.edit('x'.repeat(NOTES_MAX_BYTES));
    notes.flush();
    expect(notes.error()).toMatch(/too long/);
    expect(store.get(NOTES_KEY)).toBe('short');

    notes.edit('short again');
    notes.flush();
    expect(notes.error()).toBeNull();
    expect(store.get(NOTES_KEY)).toBe('short again');
  });
});
