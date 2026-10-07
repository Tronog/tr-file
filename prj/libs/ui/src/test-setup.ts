/**
 * Runs before every spec file. What the app remembers between sessions
 * (PRD 003, §6) lives in `localStorage` in a browser — and jsdom keeps one per
 * test run, so a layout one test saved would be restored by the next. Each
 * test starts with nothing remembered.
 */
beforeEach(() => {
  localStorage.clear();
});
