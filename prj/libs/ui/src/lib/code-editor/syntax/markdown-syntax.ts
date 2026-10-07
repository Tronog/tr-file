import { UiTokenWriter, type UiLineTokenizer, type UiTokenizedLine } from './syntax.model';

const FENCE = /^( {0,3})(`{3,}|~{3,})\s*([\w+#.-]*)/;
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const QUOTE = /^ {0,3}>/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[[ xX]\]\s)?/;

/**
 * The inline spans, longest-lived first: code, strong, emphasis, a link or an
 * image, an autolink, an HTML tag, an escape.
 */
const INLINE =
  /(`+)[^`]*?\1|\*\*(?=\S)[^*]+?\*\*|__(?=\S)[^_]+?__|\*(?=[^\s*])[^*]+?\*|(?<![\w])_(?=[^\s_])[^_]+?_(?![\w])|!?\[[^\]]*\]\([^)\s]*(?:\s+"[^"]*")?\)|<https?:\/\/[^>\s]+>|<\/?[A-Za-z][^>]*>|\\./g;

/** Separates the parts of a fence's state: `f`, the fence, its language, the inner state. */
const SEP = '\u0001';

/**
 * Markdown (PRD 005, §4): headings, quotes, rules, list markers and fences by
 * line; code spans, strong, emphasis, links and tags within one. A fenced
 * block is the state carried — and one marked `bash` or `json` is coloured
 * as that language, its own state carried inside the fence's.
 */
export function createMarkdownTokenizer(nested: (language: string) => UiLineTokenizer | null): UiLineTokenizer {
  return (line: string, state: string): UiTokenizedLine => {
    const out = new UiTokenWriter();

    if (state.startsWith(`f${SEP}`)) {
      const [, fence = '```', language = '', inner = ''] = state.split(SEP);
      const closing = line.trim();
      if (closing.startsWith(fence[0] as string) && closing.length >= fence.length && /^(`+|~+)$/.test(closing)) {
        out.push(line, 'meta');
        return out.done('');
      }
      const tokenizer = nested(language);
      if (tokenizer === null) {
        out.push(line, 'code');
        return out.done(state);
      }
      const result = tokenizer(line, inner);
      for (const token of result.tokens) {
        out.push(token.text, token.kind);
      }
      return out.done([`f`, fence, language, result.end].join(SEP));
    }

    const fence = FENCE.exec(line);
    if (fence !== null) {
      out.push(line, 'meta');
      return out.done(['f', fence[2] ?? '```', (fence[3] ?? '').toLowerCase(), ''].join(SEP));
    }
    if (HEADING.test(line)) {
      out.push(line, 'heading');
      return out.done('');
    }
    if (RULE.test(line)) {
      out.push(line, 'meta');
      return out.done('');
    }
    if (QUOTE.test(line)) {
      out.push(line, 'quote');
      return out.done('');
    }
    let at = 0;
    const list = LIST.exec(line);
    if (list !== null) {
      out.push(list[1] ?? '', null);
      out.push(list[2] ?? '', 'keyword');
      out.push(list[3] ?? '', null);
      out.push(list[4] ?? '', 'keyword');
      at = list[0].length;
    }
    inline(line.slice(at), out);
    return out.done('');
  };
}

/** The inline spans of `text`. */
function inline(text: string, out: UiTokenWriter): void {
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index;
    out.push(text.slice(at, index), null);
    const span = match[0];
    if (span.startsWith('`')) {
      out.push(span, 'code');
    } else if (span.startsWith('**') || span.startsWith('__')) {
      out.push(span, 'strong');
    } else if (span.startsWith('*') || span.startsWith('_')) {
      out.push(span, 'emphasis');
    } else if (span.startsWith('[') || span.startsWith('![')) {
      const middle = span.indexOf('](');
      const open = span.startsWith('!') ? 2 : 1;
      out.push(span.slice(0, open), 'punctuation');
      out.push(span.slice(open, middle), 'link');
      out.push('](', 'punctuation');
      out.push(span.slice(middle + 2, -1), 'string');
      out.push(')', 'punctuation');
    } else if (span.startsWith('<http')) {
      out.push(span, 'link');
    } else if (span.startsWith('<')) {
      out.push(span, 'keyword');
    } else {
      out.push(span, null);
    }
    at = index + span.length;
  }
  out.push(text.slice(at), null);
}
