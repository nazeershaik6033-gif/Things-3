import { describe, expect, it } from 'vitest';
import { parseMarkdown, parseInline, markdownPreview } from '../../src/domain/markdown';

describe('markdown parser', () => {
  it('plain paragraphs, one per line', () => {
    expect(parseMarkdown('hello\nworld')).toEqual([
      { type: 'p', children: [{ type: 'text', text: 'hello' }] },
      { type: 'p', children: [{ type: 'text', text: 'world' }] },
    ]);
  });

  it('bold and italic', () => {
    expect(parseInline('a **bold** and *it* and _it2_')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'bold', children: [{ type: 'text', text: 'bold' }] },
      { type: 'text', text: ' and ' },
      { type: 'italic', children: [{ type: 'text', text: 'it' }] },
      { type: 'text', text: ' and ' },
      { type: 'italic', children: [{ type: 'text', text: 'it2' }] },
    ]);
  });

  it('nested italic inside bold', () => {
    expect(parseInline('**a *b* c**')).toEqual([
      {
        type: 'bold',
        children: [
          { type: 'text', text: 'a ' },
          { type: 'italic', children: [{ type: 'text', text: 'b' }] },
          { type: 'text', text: ' c' },
        ],
      },
    ]);
  });

  it('unmatched markers stay literal', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ type: 'text', text: '2 * 3 = 6' }]);
    expect(parseInline('**unclosed')).toEqual([{ type: 'text', text: '**unclosed' }]);
    expect(parseInline('a_b_c')).toEqual([
      { type: 'text', text: 'a' },
      { type: 'italic', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: 'c' },
    ]);
  });

  it('bullet lists', () => {
    expect(parseMarkdown('- one\n- two\ntext')).toEqual([
      { type: 'ul', items: [[{ type: 'text', text: 'one' }], [{ type: 'text', text: 'two' }]] },
      { type: 'p', children: [{ type: 'text', text: 'text' }] },
    ]);
  });

  it('numbered lists keep their start number', () => {
    const blocks = parseMarkdown('3. three\n4. four');
    expect(blocks).toEqual([
      {
        type: 'ol', start: 3,
        items: [[{ type: 'text', text: 'three' }], [{ type: 'text', text: 'four' }]],
      },
    ]);
  });

  it('HTML renders as literal text (no injection surface)', () => {
    const blocks = parseMarkdown('<script>alert(1)</script>');
    expect(blocks).toEqual([
      { type: 'p', children: [{ type: 'text', text: '<script>alert(1)</script>' }] },
    ]);
  });

  it('markdownPreview strips markers and finds first non-empty line', () => {
    expect(markdownPreview('\n**Bold** _note_')).toBe('Bold note');
    expect(markdownPreview('- item one\nrest')).toBe('item one');
    expect(markdownPreview('')).toBe('');
  });
});
