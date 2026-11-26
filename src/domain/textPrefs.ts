/** Text settings: font style, text size, Bold Text and line spacing for the
 *  app, plus a separate font and size for notes. Pure: this module only
 *  describes the settings and turns them into CSS custom properties;
 *  app/textPrefs.ts stores them and writes them onto <html>.
 *
 *  Every font offered is one the iPhone already has (San Francisco and its
 *  Rounded, New York serif and Mono cuts), so nothing is downloaded and the
 *  app stays fully offline. Other systems fall back to their closest cut. */

export type FontId = 'system' | 'rounded' | 'serif' | 'mono';
export type LineSpacing = 'tight' | 'normal' | 'roomy';

export interface TextPrefs {
  font: FontId;
  /** Text size as a multiple of the designed size. */
  scale: number;
  bold: boolean;
  lines: LineSpacing;
  /** Notes' own font; null = same as the app. */
  notesFont: FontId | null;
  notesScale: number;
}

export const DEFAULT_TEXT: TextPrefs = {
  font: 'system',
  scale: 1,
  bold: false,
  lines: 'normal',
  notesFont: null,
  notesScale: 1,
};

export const SCALE_MIN = 0.85;
export const SCALE_MAX = 1.4;
export const NOTES_SCALE_MIN = 0.85;
export const NOTES_SCALE_MAX = 1.6;
export const SCALE_STEP = 0.05;

export const FONTS: { id: FontId; label: string; stack: string }[] = [
  {
    id: 'system',
    label: 'System',
    stack: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
  {
    id: 'rounded',
    label: 'Rounded',
    stack: "ui-rounded, 'SF Pro Rounded', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  {
    id: 'serif',
    label: 'Serif',
    stack: "ui-serif, 'New York', Georgia, Cambria, 'Times New Roman', serif",
  },
  {
    id: 'mono',
    label: 'Mono',
    stack: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
  },
];

export const LINE_SPACING: { id: LineSpacing; label: string; factor: number }[] = [
  { id: 'tight', label: 'Tight', factor: 0.9 },
  { id: 'normal', label: 'Normal', factor: 1 },
  { id: 'roomy', label: 'Roomy', factor: 1.18 },
];

export function fontStack(id: FontId): string {
  return (FONTS.find((f) => f.id === id) ?? FONTS[0]!).stack;
}

/** Snap to the slider's 5% steps and keep inside the range. */
export function clampScale(v: unknown, min = SCALE_MIN, max = SCALE_MAX): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 1;
  const snapped = Math.round(n / SCALE_STEP) * SCALE_STEP;
  return Math.round(Math.min(max, Math.max(min, snapped)) * 100) / 100;
}

const isFont = (x: unknown): x is FontId => FONTS.some((f) => f.id === x);
const isLines = (x: unknown): x is LineSpacing => LINE_SPACING.some((l) => l.id === x);

/** Turn anything read from storage into valid settings. Never throws. */
export function normalizeText(raw: unknown): TextPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof TextPrefs, unknown>>;
  return {
    font: isFont(r.font) ? r.font : DEFAULT_TEXT.font,
    scale: clampScale(r.scale),
    bold: r.bold === true,
    lines: isLines(r.lines) ? r.lines : DEFAULT_TEXT.lines,
    notesFont: isFont(r.notesFont) ? r.notesFont : null,
    notesScale: clampScale(r.notesScale, NOTES_SCALE_MIN, NOTES_SCALE_MAX),
  };
}

/** The custom properties and data attributes that apply the settings. */
export function textStyle(p: TextPrefs): {
  vars: Record<'--font' | '--ts' | '--lh' | '--notes-font' | '--notes-ts', string>;
  bold: boolean;
  lines: LineSpacing;
} {
  return {
    vars: {
      '--font': fontStack(p.font),
      '--ts': String(p.scale),
      '--lh': String(LINE_SPACING.find((l) => l.id === p.lines)!.factor),
      '--notes-font': p.notesFont ? fontStack(p.notesFont) : 'var(--font)',
      '--notes-ts': String(p.notesScale),
    },
    bold: p.bold,
    lines: p.lines,
  };
}

/** "100%" for a scale of 1. */
export function percent(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}
