import { contentTag } from './content-tag';

/** PRD 005, §4 — the backend's `contentTag` is pinned by the same three. */
describe('contentTag', () => {
  it('is the length and 64 bits of cyrb53, as the backend computes it', () => {
    const bytes = (text: string) => new TextEncoder().encode(text);
    expect(contentTag(new Uint8Array())).toBe('0:488bdcb81aee8d83');
    expect(contentTag(bytes('hello\n'))).toBe('6:41407a367a4ce3d6');
    expect(contentTag(bytes('héllo, wörld'))).toBe('14:379a0f8293280947');
  });
});
