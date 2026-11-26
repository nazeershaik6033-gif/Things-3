import { createSignal } from 'solid-js';
import { getSetting, setSetting } from '../db/mutations';
import { DEFAULT_LAYOUT, normalizeLayout, type HomeLayout } from '../domain/homeLayout';

/** The user's Home layout (which tab holds what), mirrored from the settings
 *  table into a signal so the tab bar can read it synchronously. It lives in
 *  IndexedDB, so it travels with a backup. */

const [homeLayout, setLayoutSignal] = createSignal<HomeLayout>(normalizeLayout(DEFAULT_LAYOUT));
export { homeLayout };

export async function startHomeLayout(): Promise<void> {
  setLayoutSignal(normalizeLayout(await getSetting<unknown>('homeLayout', DEFAULT_LAYOUT)));
}

export function saveHomeLayout(next: HomeLayout): void {
  setLayoutSignal(next);
  void setSetting('homeLayout', next);
}

export function resetHomeLayout(): void {
  saveHomeLayout(normalizeLayout(DEFAULT_LAYOUT));
}

/** The open tab. Remembered on this device only, as a convenience: storage
 *  can be unavailable (private mode), so every access is guarded. */
const TAB_KEY = 'clarity.homeTab';

function readTab(): string | null {
  try {
    return localStorage.getItem(TAB_KEY);
  } catch {
    return null;
  }
}

const [storedTab, setStoredTab] = createSignal<string | null>(readTab());

/** The open tab's category id; falls back to the first category when the
 *  remembered one no longer exists. */
export function homeTab(): string {
  const cats = homeLayout().categories;
  const want = storedTab();
  return cats.some((c) => c.id === want) ? want! : cats[0]!.id;
}

export function setHomeTab(id: string): void {
  setStoredTab(id);
  try {
    localStorage.setItem(TAB_KEY, id);
  } catch {
    /* storage unavailable: the tab just isn't remembered */
  }
}
