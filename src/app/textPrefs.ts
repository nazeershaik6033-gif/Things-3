import { createSignal } from 'solid-js';
import { getSetting, setSetting } from '../db/mutations';
import { DEFAULT_TEXT, normalizeText, textStyle, type TextPrefs } from '../domain/textPrefs';

/** The text settings, mirrored from IndexedDB into a signal and onto <html>.
 *
 *  IndexedDB is the source of truth (so the settings travel in a backup);
 *  a copy in localStorage lets the very first paint use the right font and
 *  size instead of flashing the defaults while the database opens. */

const CACHE_KEY = 'clarity.text';

const [textPrefs, setSignal] = createSignal<TextPrefs>(DEFAULT_TEXT);
export { textPrefs };

function apply(p: TextPrefs): void {
  const root = document.documentElement;
  const { vars, bold, lines } = textStyle(p);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.bold = bold ? 'true' : 'false';
  root.dataset.lines = lines;
}

function cache(p: TextPrefs): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: the next launch just paints defaults first */
  }
}

/** Before the first render: apply the cached copy, synchronously. */
export function applyCachedTextPrefs(): void {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const p = normalizeText(JSON.parse(cached));
      setSignal(p);
      apply(p);
    }
  } catch {
    /* unreadable cache: startTextPrefs() fixes it from the database */
  }
}

/** At startup: load the stored settings (the source of truth). */
export async function startTextPrefs(): Promise<void> {
  const stored = normalizeText(await getSetting<unknown>('text', DEFAULT_TEXT));
  setSignal(stored);
  apply(stored);
  cache(stored);
}

export async function updateTextPrefs(patch: Partial<TextPrefs>): Promise<void> {
  const next = normalizeText({ ...textPrefs(), ...patch });
  setSignal(next);
  apply(next);
  cache(next);
  await setSetting('text', next);
}

export async function resetTextPrefs(): Promise<void> {
  await updateTextPrefs(DEFAULT_TEXT);
}
