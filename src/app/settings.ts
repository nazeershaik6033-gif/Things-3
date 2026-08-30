import { createSignal } from 'solid-js';
import { getSetting, setSetting } from '../db/mutations';
import { DEFAULT_AI, type AiConfig, type AiProvider } from '../net/ai';

/** Preferences that UI code needs to read synchronously during a tap. They are
 *  mirrored from IndexedDB into signals at boot; the DB stays the source of
 *  truth and every write goes to both. */

const [askCompletionDate, setAskSignal] = createSignal(true);
export { askCompletionDate };

/** My Routine window reminders: a local notification when a window opens with
 *  something new waiting. Off until explicitly turned on. */
const [routineRemind, setRoutineRemindSignal] = createSignal(false);
export { routineRemind };

const [aiConfig, setAiSignal] = createSignal<AiConfig>(DEFAULT_AI);
export { aiConfig };

export async function startSettings(): Promise<void> {
  setAskSignal(await getSetting('askCompletionDate', true));
  setRoutineRemindSignal(await getSetting('routineRemind', false));
  setAiSignal(await getSetting<AiConfig>('ai', DEFAULT_AI));
}

export async function setAskCompletionDate(value: boolean): Promise<void> {
  setAskSignal(value);
  await setSetting('askCompletionDate', value);
}

export async function setRoutineRemind(value: boolean): Promise<void> {
  setRoutineRemindSignal(value);
  await setSetting('routineRemind', value);
}

export async function updateAiConfig(patch: Partial<AiConfig>): Promise<void> {
  const next = { ...aiConfig(), ...patch };
  setAiSignal(next);
  await setSetting('ai', next);
}

export async function setAiProvider(provider: AiProvider): Promise<void> {
  await updateAiConfig({ provider });
}
