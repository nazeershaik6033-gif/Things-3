import { createEffect, createSignal } from 'solid-js';
import { getSetting, setSetting } from '../db/mutations';

export type Palette = 'snow' | 'parchment' | 'slate' | 'midnight';
export type ThemePref = 'auto' | Palette;

export const PALETTES: { id: Palette; label: string; bg: string; dark: boolean }[] = [
  { id: 'snow',      label: 'Snow',      bg: '#f5f5f7', dark: false },
  { id: 'parchment', label: 'Parchment', bg: '#ede8dc', dark: false },
  { id: 'slate',     label: 'Slate',     bg: '#3a3a3c', dark: true  },
  { id: 'midnight',  label: 'Midnight',  bg: '#111114', dark: true  },
];

const [themePref, setThemePrefSignal] = createSignal<ThemePref>('auto');
const [systemDark, setSystemDark] = createSignal(false);

export { themePref };

export function resolvedTheme(): Palette {
  const pref = themePref();
  if (pref === 'auto') return systemDark() ? 'midnight' : 'snow';
  return pref;
}

export async function setThemePref(pref: ThemePref): Promise<void> {
  setThemePrefSignal(pref);
  await setSetting('theme', pref);
}

export function startTheme(): void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  setSystemDark(mq.matches);
  mq.addEventListener('change', (e) => setSystemDark(e.matches));

  void getSetting<ThemePref>('theme', 'auto').then((stored) => {
    // Migrate legacy 'light'/'dark' values from old builds
    const migrated: Record<string, ThemePref> = { light: 'snow', dark: 'midnight' };
    setThemePrefSignal(migrated[stored as string] ?? stored);
  });

  createEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme();
  });
}
