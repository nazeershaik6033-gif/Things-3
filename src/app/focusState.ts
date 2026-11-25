import { createSignal } from 'solid-js';

/** Focus Sprint overlay state. The sprint itself lives in the DB (so a
 *  running timer survives reloads); this only tracks what's on screen. */

export interface SprintLaunch {
  /** Pre-selected to-do (from a task card / an MIT). */
  taskId?: string | null;
  /** Resume an existing sprint (planned or running). */
  sprintId?: string;
}

const [sprintLaunch, setSprintLaunch] = createSignal<SprintLaunch | null>(null);
export { sprintLaunch };

export function openSprint(launch: SprintLaunch = {}): void {
  setSprintLaunch({ ...launch });
}

export function closeSprint(): void {
  setSprintLaunch(null);
}

/** Lightweight toast for focus actions ("3 MITs max", "Saved"). */
const [toast, setToast] = createSignal<string | null>(null);
/** Optional button on the toast (Undo). Cleared with the toast. */
export interface ToastAction {
  label: string;
  run: () => void;
}
const [toastAction, setToastAction] = createSignal<ToastAction | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export { toast, toastAction };
export function showToast(text: string, ms = 2400, action?: ToastAction): void {
  clearTimeout(toastTimer);
  setToast(text);
  setToastAction(action ?? null);
  toastTimer = setTimeout(() => {
    setToast(null);
    setToastAction(null);
  }, ms);
}
export function hideToast(): void {
  clearTimeout(toastTimer);
  setToast(null);
  setToastAction(null);
}
