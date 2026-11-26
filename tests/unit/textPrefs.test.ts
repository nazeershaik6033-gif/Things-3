import { describe, expect, it } from 'vitest';
import {
  clampScale, DEFAULT_TEXT, fontStack, normalizeText, NOTES_SCALE_MAX, percent, SCALE_MAX, SCALE_MIN, textStyle,
} from '../../src/domain/textPrefs';
import { searchSettings } from '../../src/domain/settingsGroups';

describe('text settings', () => {
  it('defaults to the designed look', () => {
    expect(normalizeText(undefined)).toEqual(DEFAULT_TEXT);
    const { vars, bold, lines } = textStyle(DEFAULT_TEXT);
    expect(vars['--ts']).toBe('1');
    expect(vars['--lh']).toBe('1');
    expect(vars['--notes-font']).toBe('var(--font)');
    expect(bold).toBe(false);
    expect(lines).toBe('normal');
  });

  it('repairs anything read from storage', () => {
    expect(normalizeText({ font: 'comic', scale: 'big', bold: 'yes', lines: 'double', notesFont: 'x', notesScale: null }))
      .toEqual(DEFAULT_TEXT);
    expect(normalizeText({ font: 'serif', scale: 1.2, bold: true, lines: 'roomy', notesFont: 'mono', notesScale: 1.5 }))
      .toEqual({ font: 'serif', scale: 1.2, bold: true, lines: 'roomy', notesFont: 'mono', notesScale: 1.5 });
  });

  it('keeps sizes in range and on 5% steps', () => {
    expect(clampScale(0.5)).toBe(SCALE_MIN);
    expect(clampScale(3)).toBe(SCALE_MAX);
    expect(clampScale(1.12)).toBe(1.1);
    expect(clampScale(1.13)).toBe(1.15);
    expect(clampScale(NaN)).toBe(1);
    expect(normalizeText({ notesScale: 9 }).notesScale).toBe(NOTES_SCALE_MAX);
    expect(normalizeText({ scale: 9 }).scale).toBe(SCALE_MAX);
  });

  it('turns settings into CSS variables', () => {
    const { vars, bold, lines } = textStyle({ font: 'rounded', scale: 1.25, bold: true, lines: 'tight', notesFont: 'serif', notesScale: 1.3 });
    expect(vars['--font']).toContain('ui-rounded');
    expect(vars['--ts']).toBe('1.25');
    expect(vars['--lh']).toBe('0.9');
    expect(vars['--notes-font']).toBe(fontStack('serif'));
    expect(vars['--notes-ts']).toBe('1.3');
    expect(bold).toBe(true);
    expect(lines).toBe('tight');
  });

  it('uses only fonts the iPhone already has, with fallbacks', () => {
    expect(fontStack('serif')).toMatch(/^ui-serif, 'New York'/);
    expect(fontStack('mono')).toMatch(/monospace$/);
    expect(fontStack('system')).toMatch(/sans-serif$/);
  });

  it('formats percentages and is findable in Settings search', () => {
    expect(percent(1)).toBe('100%');
    expect(percent(0.85)).toBe('85%');
    expect(searchSettings('font')[0]?.section).toBe('text');
    expect(searchSettings('bold')[0]?.section).toBe('text');
    expect(searchSettings('text size')[0]?.section).toBe('text');
  });
});
