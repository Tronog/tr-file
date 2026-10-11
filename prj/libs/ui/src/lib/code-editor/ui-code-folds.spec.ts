import { foldRanges } from './ui-code-folds';

/** tr-prd PRD 005, §1.2 — which blocks fold, and what folding one hides. */
describe('foldRanges', () => {
  const ranges = (text: string, language: Parameters<typeof foldRanges>[1]): [number, number][] => [...foldRanges(text.split('\n'), language)].sort((a, b) => a[0] - b[0]);

  it('folds by indentation, leaving the closing line and trailing blank lines in view', () => {
    const json = ['{', '  "a": {', '    "b": 1', '', '  },', '  "c": [', '    1', '  ]', '}'].join('\n');
    expect(ranges(json, 'json')).toEqual([
      [0, 7],
      [1, 2],
      [5, 6],
    ]);
  });

  it('folds a bash function’s and an if’s bodies, tabs counted as indentation', () => {
    const bash = ['build() {', '\tif true; then', '\t\techo hi', '\tfi', '}', 'build'].join('\n');
    expect(ranges(bash, 'bash')).toEqual([
      [0, 3],
      [1, 2],
    ]);
  });

  it('folds markdown by sections — to the next heading as high — and by fenced blocks', () => {
    const markdown = ['# One', 'text', '## Two', '```sh', '# not a heading', 'ls', '```', '', '## Three', 'more', '', '# Four'].join('\n');
    expect(ranges(markdown, 'markdown')).toEqual([
      [0, 9],
      [2, 6],
      [3, 5],
      [8, 9],
    ]);
  });

  it('folds an unclosed fence to the end, and nothing that has no lines under it', () => {
    expect(ranges('# A\n# B\n```\nx\n', 'markdown')).toEqual([
      [1, 3],
      [2, 3],
    ]);
    expect(ranges('a\nb\n  ', 'plain')).toEqual([]);
  });
});
