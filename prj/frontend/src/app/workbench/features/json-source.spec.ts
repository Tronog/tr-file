import { applyJsonEdit, readJsonSource } from './json-source';

/** PRD 005, §5.2 — an edit in the tree changes its own characters, and nothing else of the file. */
describe('JSON source', () => {
  const TEXT = '{\n  "name": "tr-file",   "n": 1.50,\n  "tags": ["a", "b/c"],\n  "deep": {"x~y": null}\n}\n';

  it('reads where every value and key is', () => {
    const source = readJsonSource(TEXT);
    expect(source?.value).toEqual({ name: 'tr-file', n: 1.5, tags: ['a', 'b/c'], deep: { 'x~y': null } });
    const at = (pointer: string, part: 'key' | 'value') => {
      const span = source?.spans.get(pointer)?.[part];
      return span === undefined ? undefined : TEXT.slice(span[0], span[1]);
    };
    expect(at('/name', 'key')).toBe('"name"');
    expect(at('/n', 'value')).toBe('1.50');
    expect(at('/tags/1', 'value')).toBe('"b/c"');
    expect(at('/deep/x~0y', 'value')).toBe('null');
    expect(at('', 'value')).toBe(TEXT.trimEnd());
  });

  it('is not fooled by what is not JSON', () => {
    expect(readJsonSource('{"a": 1,}')).toBeNull();
    expect(readJsonSource('{"a": 1} x')).toBeNull();
    expect(readJsonSource('// c\n{}')).toBeNull();
  });

  it('writes a value where it stands, the rest of the file as it was', () => {
    expect(applyJsonEdit(TEXT, { pointer: '/name', value: 'tr "file"' })).toEqual({
      text: TEXT.replace('"tr-file"', '"tr \\"file\\""'),
    });
    expect(applyJsonEdit(TEXT, { pointer: '/deep/x~0y', value: 42 })).toEqual({ text: TEXT.replace('null', '42') });
  });

  it('renames a key, refusing one the object has already', () => {
    expect(applyJsonEdit(TEXT, { pointer: '/n', key: 'count' })).toEqual({ text: TEXT.replace('"n": 1.50', '"count": 1.50') });
    expect(applyJsonEdit(TEXT, { pointer: '/n', key: 'name' })).toEqual({ problem: 'There is a key "name" already.' });
    expect(applyJsonEdit(TEXT, { pointer: '/tags/0', key: 'x' })).toEqual({ problem: 'Only a key of an object can be renamed.' });
    expect(applyJsonEdit(TEXT, { pointer: '/gone', value: 1 })).toEqual({ problem: 'That value is no longer in the file.' });
  });
});
