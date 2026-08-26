import { createSignal } from 'solid-js';
import { getSetting, setSetting } from '../db/mutations';

/** Preferences that UI code needs to read synchronously during a tap. They are
 *  mirrored from IndexedDB into signals at boot; the DB stays the source of
 *  truth and every write goes to both. */

const [askCompletionDate, setAskSignal] = createSignal(true);
export { askCompletionDate };

export async function startSettings(): Promise<void> {
  setAskSignal(await getSetting('askCompletionDate', true));
}

export async function setAskCompletionDate(value: boolean): Promise<void> {
  setAskSignal(value);
  await setSetting('askCompletionDate', value);
}
