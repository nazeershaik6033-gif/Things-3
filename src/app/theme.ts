import { createEffect, createSignal } from 'solid-js';
import { getSetting, setSetting } from '../db/mutations';

export type ThemePref = 'auto' | 'light' | 'dark';

const [themePref, setThemePrefSignal] = createSignal<ThemePref>('auto');
const [systemDark, setSystemDark] = createSignal(false);

export { themePref };

export function resolvedTheme(): 'light' | 'dark' {
  const pref = themePref();
  if (pref === 'auto') return systemDark() ? 'dark' : 'light';
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

  void getSetting<ThemePref>('theme', 'auto').then(setThemePrefSignal);

  createEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme();
  });
}
