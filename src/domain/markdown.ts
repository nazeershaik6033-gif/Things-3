/** Minimal markdown for notes: **bold**, *italic* or _italic_, "- " bullets,
 *  "1. " numbered lists. Returns an AST; the renderer emits real elements,
 *  never HTML strings, so injection is structurally impossible. */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: Inline[] }
  | { type: 'italic'; children: Inline[] };

export type Block =
  | { type: 'p'; children: Inline[] }
  | { type: 'ul'; items: Inline[][] }
  | { type: 'ol'; start: number; items: Inline[][] };

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    if (bullet) {
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = /^\s*[-*]\s+(.*)$/.exec(lines[i]!);
        if (!m) break;
        items.push(parseInline(m[1]!));
        i++;
      }
      blocks.push({ type: 'ul', items });
    } else if (numbered) {
      const start = Number(numbered[1]);
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = /^\s*\d+\.\s+(.*)$/.exec(lines[i]!);
        if (!m) break;
        items.push(parseInline(m[1]!));
        i++;
      }
      blocks.push({ type: 'ol', start, items });
    } else {
      blocks.push({ type: 'p', children: parseInline(line) });
      i++;
    }
  }
  return blocks;
}

export function parseInline(text: string): Inline[] {
  return parseDelimited(text, 0).nodes;
}

interface ParseResult {
  nodes: Inline[];
  end: number;
}

/** Scan for ** / * / _ delimiters; unmatched delimiters render as plain text. */
function parseDelimited(text: string, from: number, closer?: string): ParseResult {
  const nodes: Inline[] = [];
  let buf = '';
  let i = from;
  const flush = () => {
    if (buf) nodes.push({ type: 'text', text: buf });
    buf = '';
  };
  while (i < text.length) {
    if (closer && text.startsWith(closer, i)) {
      flush();
      return { nodes, end: i + closer.length };
    }
    const two = text.slice(i, i + 2);
    const one = text[i]!;
    if (two === '**') {
      const inner = parseDelimited(text, i + 2, '**');
      if (inner.end > i + 2 && closed(text, inner.end, '**')) {
        flush();
        nodes.push({ type: 'bold', children: inner.nodes });
        i = inner.end;
        continue;
      }
    }
    if ((one === '*' || one === '_') && text[i + 1] !== one) {
      const inner = parseDelimited(text, i + 1, one);
      if (inner.end > i + 1 && closed(text, inner.end, one)) {
        flush();
        nodes.push({ type: 'italic', children: inner.nodes });
        i = inner.end;
        continue;
      }
    }
    buf += one;
    i++;
  }
  flush();
  // Unterminated closer scope: caller treats this as "no match"
  return closer ? { nodes: [{ type: 'text', text: text.slice(from) }], end: -1 } : { nodes, end: i };
}

/** True if a recursive parse actually found its closing delimiter. */
function closed(text: string, end: number, closer: string): boolean {
  return end >= closer.length && text.slice(end - closer.length, end) === closer;
}

/** Plain text preview (first line, markers stripped) for row subtitles. */
export function markdownPreview(src: string): string {
  const first = src.split('\n').find((l) => l.trim() !== '') ?? '';
  return first.replace(/\*\*|\*|_/g, '').replace(/^\s*([-*]|\d+\.)\s+/, '').trim();
}
