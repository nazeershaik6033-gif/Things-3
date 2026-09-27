import { describe, expect, it } from 'vitest';
import {
  attribution, deeperPrompt, quoteForDate, quoteIndexFor, QUOTES, strideFor, TOPIC_COLOR,
  TOPIC_LABEL, type BrainQuote,
} from '../../src/domain/quotes';
import { addDays } from '../../src/domain/dates';

describe('the quote library', () => {
  it('has a unique id, a text and an author for every quote', () => {
    const ids = new Set<string>();
    for (const q of QUOTES) {
      expect(q.text.length, q.id).toBeGreaterThan(10);
      expect(q.author.length, q.id).toBeGreaterThan(1);
      expect(ids.has(q.id), `duplicate id ${q.id}`).toBe(false);
      ids.add(q.id);
    }
    expect(ids.size).toBe(QUOTES.length);
  });

  it('never repeats the same text under two ids', () => {
    const texts = new Set(QUOTES.map((q) => q.text));
    expect(texts.size).toBe(QUOTES.length);
  });

  it('gives every topic a label and a colour', () => {
    for (const q of QUOTES) {
      expect(TOPIC_LABEL[q.topic], q.id).toBeTruthy();
      expect(TOPIC_COLOR[q.topic], q.id).toBeTruthy();
    }
  });

  it('holds enough quotes that a repeat is months away', () => {
    expect(QUOTES.length).toBeGreaterThanOrEqual(100);
  });
});

describe('the daily rotation', () => {
  it('is deterministic in the date alone', () => {
    expect(quoteForDate('2026-09-22')!.id).toBe(quoteForDate('2026-09-22')!.id);
  });

  it('walks the whole library before repeating anything', () => {
    const seen = new Set<string>();
    let date = '2026-01-01';
    for (let i = 0; i < QUOTES.length; i++) {
      seen.add(quoteForDate(date)!.id);
      date = addDays(date, 1);
    }
    expect(seen.size).toBe(QUOTES.length);
  });

  it('does not show two neighbours on consecutive days', () => {
    // A stride of 1 would walk the shelf in order, so a run of quotes by the
    // same author would land on a run of days.
    expect(strideFor(QUOTES.length)).toBeGreaterThan(1);
    const a = quoteIndexFor('2026-05-04', QUOTES.length);
    const b = quoteIndexFor('2026-05-05', QUOTES.length);
    expect(Math.abs(a - b)).toBeGreaterThan(1);
  });

  it('uses a stride coprime with the library size, whatever the size', () => {
    const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
    for (let len = 3; len < 200; len++) {
      expect(gcd(strideFor(len), len), `length ${len}`).toBe(1);
    }
  });

  it('stays inside the library for dates before 1970', () => {
    const i = quoteIndexFor('1969-07-20', QUOTES.length);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(QUOTES.length);
  });

  it('has nothing to show for an empty library', () => {
    expect(quoteForDate('2026-09-22', [])).toBeNull();
    expect(quoteIndexFor('2026-09-22', 0)).toBe(-1);
  });
});

describe('attribution', () => {
  const base: BrainQuote = {
    id: 'x', text: 'A line.', author: 'Someone', topic: 'plasticity',
  };

  it('names the work when one is known', () => {
    expect(attribution({ ...base, source: 'A Book' })).toBe('Someone · A Book');
  });

  it('says so when the attribution is only popular', () => {
    expect(attribution({ ...base, attributed: true })).toBe('attributed to Someone');
  });

  it('carries the quote and its attribution into the AI prompt', () => {
    const prompt = deeperPrompt({ ...base, source: 'A Book' });
    expect(prompt).toContain('A line.');
    expect(prompt).toContain('Someone · A Book');
  });
});
