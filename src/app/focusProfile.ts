import { createMemo, type Accessor } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { setSetting } from '../db/mutations';
import { normalizeProfile, type FocusProfile } from '../domain/focus';

/** Reactive focus settings (call inside a component). */
export function useFocusProfile(): Accessor<FocusProfile> {
  const row = createLiveQuery(() => db.settings.get('focusProfile'), undefined);
  return createMemo(() => normalizeProfile(row()?.value as Partial<FocusProfile> | undefined));
}

export function useEverest(): Accessor<string> {
  const row = createLiveQuery(() => db.settings.get('everest'), undefined);
  return () => (typeof row()?.value === 'string' ? (row()!.value as string) : '');
}

export async function saveFocusProfile(p: FocusProfile): Promise<void> {
  await setSetting('focusProfile', normalizeProfile(p));
}

/** Per-day manual check-offs on the Daily Focus flowchart. */
export function flowKey(date: string): string {
  return `flow:${date}`;
}
