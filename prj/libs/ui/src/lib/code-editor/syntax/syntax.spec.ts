import { tokenizeBash } from './bash-syntax';
import { tokenizeJson } from './json-syntax';
import { UiSyntaxHighlighter } from './syntax-highlighter';
import type { UiLineTokenizer, UiSyntaxKind } from './syntax.model';

/** The runs of each line, carrying the state down, as `[text, kind]` — plain text left out. */
function colours(tokenizer: UiLineTokenizer, text: string): [string, UiSyntaxKind][][] {
  let state = '';
  return text.split('\n').map((line) => {
    const result = tokenizer(line, state);
    state = result.end;
    return result.tokens.filter((token) => token.kind !== null).map((token) => [token.text, token.kind as UiSyntaxKind]);
  });
}

/** PRD 005, §4 — the editor colours JSON, bash and markdown. */
describe('syntax', () => {
  it('colours JSON: keys apart from strings, numbers, literals, comments, and what is not JSON', () => {
    expect(colours(tokenizeJson, '{ "name": "tr-file", "n": -1.5e3, "ok": true, "none": null, bad }')[0]).toEqual([
      ['{', 'punctuation'],
      ['"name"', 'property'],
      [':', 'punctuation'],
      ['"tr-file"', 'string'],
      [',', 'punctuation'],
      ['"n"', 'property'],
      [':', 'punctuation'],
      ['-1.5e3', 'number'],
      [',', 'punctuation'],
      ['"ok"', 'property'],
      [':', 'punctuation'],
      ['true', 'literal'],
      [',', 'punctuation'],
      ['"none"', 'property'],
      [':', 'punctuation'],
      ['null', 'literal'],
      [',', 'punctuation'],
      ['bad', 'invalid'],
      ['}', 'punctuation'],
    ]);
    expect(colours(tokenizeJson, '/* a\nb */ 1 // c')).toEqual([[['/* a', 'comment']], [['b */', 'comment'], ['1', 'number'], ['// c', 'comment']]]);
  });

  it('colours bash: comments, keywords, builtins, variables in and out of strings, assignments', () => {
    const [shebang, line, loop] = colours(tokenizeBash, '#!/bin/bash\nNAME="a $HOME b" # set\nfor f in *; do echo "${f}"; done');
    expect(shebang).toEqual([['#!/bin/bash', 'comment']]);
    expect(line).toEqual([
      ['NAME', 'variable'],
      ['=', 'operator'],
      ['"a ', 'string'],
      ['$HOME', 'variable'],
      [' b"', 'string'],
      ['# set', 'comment'],
    ]);
    expect(loop).toEqual([
      ['for', 'keyword'],
      ['in', 'keyword'],
      [';', 'operator'],
      ['do', 'keyword'],
      ['echo', 'function'],
      ['"', 'string'],
      ['${f}', 'variable'],
      ['"', 'string'],
      [';', 'operator'],
      ['done', 'keyword'],
    ]);
  });

  it('carries a bash string and a heredoc across lines', () => {
    const lines = colours(tokenizeBash, "echo 'one\ntwo' x\ncat <<-EOF\n\t$not a var\n\tEOF\nls");
    expect(lines[1]).toEqual([["two'", 'string']]);
    expect(lines[2]).toEqual([['<<-', 'operator'], ['EOF', 'meta']]);
    expect(lines[3]).toEqual([['\t$not a var', 'string']]);
    expect(lines[4]).toEqual([['\tEOF', 'meta']]);
    expect(lines[5]).toEqual([]);
  });

  it('colours markdown, and a fenced block in the language it names', () => {
    const highlighter = new UiSyntaxHighlighter('markdown');
    const lines = ['# Title', '- **bold** and `code` [link](http://x)', '```json', '{"a": 1}', '```', '> quote'];
    const kinds = lines.map((_, index) => highlighter.tokens(lines, index).filter((token) => token.kind !== null).map((token) => [token.text, token.kind]));
    expect(kinds[0]).toEqual([['# Title', 'heading']]);
    expect(kinds[1]).toEqual([
      ['-', 'keyword'],
      ['**bold**', 'strong'],
      ['`code`', 'code'],
      ['[', 'punctuation'],
      ['link', 'link'],
      ['](', 'punctuation'],
      ['http://x', 'string'],
      [')', 'punctuation'],
    ]);
    expect(kinds[2]).toEqual([['```json', 'meta']]);
    expect(kinds[3]).toEqual([['{', 'punctuation'], ['"a"', 'property'], [':', 'punctuation'], ['1', 'number'], ['}', 'punctuation']]);
    expect(kinds[4]).toEqual([['```', 'meta']]);
    expect(kinds[5]).toEqual([['> quote', 'quote']]);
  });

  it('works states out again from the first line an edit changed', () => {
    const highlighter = new UiSyntaxHighlighter('markdown');
    const before = ['```', 'inside', 'after'];
    expect(highlighter.tokens(before, 2)[0]?.kind).toBe('code');

    const after = ['text', 'inside', 'after'];
    highlighter.invalidate(0);
    expect(highlighter.tokens(after, 2)[0]?.kind).toBeNull();
  });
});
