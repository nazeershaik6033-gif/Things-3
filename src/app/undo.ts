import { peekUndo, recordUndo, undo } from '../db/undo';
import { showToast } from './focusState';
import { haptic } from './motion';

/** The UI half of undo: actions that move or remove things say what they did
 *  in a toast with an Undo button, and Cmd/Ctrl+Z undoes the last action on
 *  a keyboard. The recording and the safe replay live in `db/undo.ts`. */

const UNDO_TOAST_MS = 5000;

/** Run `fn` as one undoable action. With `toast`, announce it with an Undo
 *  button bound to exactly this action. */
export async function undoable<T>(label: string, fn: () => Promise<T>, toast?: string): Promise<T> {
  const result = await recordUndo(label, fn);
  const entry = peekUndo();
  if (toast && entry && entry.label === label) {
    const id = entry.id;
    showToast(toast, UNDO_TOAST_MS, { label: 'Undo', run: () => void runUndo(id) });
  }
  return result;
}

export async function runUndo(id?: number): Promise<void> {
  const r = await undo(id);
  if (!r) {
    showToast('Nothing to undo');
    return;
  }
  haptic('tick');
  if (r.restored === 0) showToast(`Couldn't undo — it changed since`);
  else if (r.skipped > 0) showToast(`Undid part of “${r.label}” — some of it changed since`);
  else showToast(`Undid ${r.label.toLowerCase()}`);
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Cmd/Ctrl+Z anywhere except inside a text field, where the browser's own
 *  text undo is what you want. */
export function startUndoKeys(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() !== 'z' || e.shiftKey || e.altKey) return;
    if (!(e.metaKey || e.ctrlKey)) return;
    if (isTyping(e.target)) return;
    e.preventDefault();
    void runUndo();
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
