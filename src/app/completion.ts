import type { DateStr, Task } from '../db/models';
import { completeTask, completionTimeFor, reopenTask } from '../db/mutations';
import { addGrace, removeGrace, setCompletionPrompt } from './uiState';
import { currentDate } from './currentDate';
import { askCompletionDate } from './settings';
import { haptic } from './motion';

/** Completing a to-do stamps *when* it was done, and the Logbook files it by
 *  that stamp. For something whose day has already passed, "now" is usually
 *  the wrong answer — you finished it Tuesday and are only ticking it Friday.
 *  So a late to-do asks for the real date instead of quietly claiming today. */

export function isLate(task: Task, today: DateStr): boolean {
  if (task.status !== 'open' || task.trashedAt !== null) return false;
  const due = task.deadline ?? task.startDate;
  return due !== null && due < today;
}

/** What the prompt offers as the likeliest answer: the day it was due. */
export function suggestedCompletionDate(task: Task, today: DateStr): DateStr {
  const due = task.deadline ?? task.startDate;
  return due !== null && due < today ? due : today;
}

export function completeNow(task: Task): void {
  haptic('success');
  void completeTask(task.id);
  addGrace(task.id);
}

/** Finish a to-do on a specific day (from the prompt). */
export function completeOn(taskId: string, date: DateStr): void {
  haptic('success');
  void completeTask(taskId, false, completionTimeFor(date, currentDate()));
  addGrace(taskId);
}

/** The single entry point every checkbox in the app goes through. */
export function toggleComplete(task: Task): void {
  if (task.status !== 'open') {
    void reopenTask(task.id);
    removeGrace(task.id);
    return;
  }
  if (askCompletionDate() && isLate(task, currentDate())) {
    setCompletionPrompt({ taskId: task.id });
    return;
  }
  completeNow(task);
}
