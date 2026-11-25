import type { Task } from '../db/models';
import { db } from '../db/db';
import { markAlertsSent } from '../db/mutations';
import { alertMoments, alertSignature, alertsCalendar, effectiveAlerts } from '../domain/taskAlerts';
import { deliverFile } from './deliverFile';
import { defaultAlert } from './planner';
import { showToast } from './focusState';
import { haptic } from './motion';

/** Hand to-dos' alerts to iOS Calendar through the share sheet (Mail or Files
 *  → tap the file → Add All), then remember what was sent so the app can show
 *  "in Calendar" and notice later changes. */
export async function sendAlerts(tasks: Task[], fileName = 'clarity-alerts.ics'): Promise<boolean> {
  const def = defaultAlert();
  const withAlerts = tasks.filter((t) => effectiveAlerts(t, def).length > 0);
  if (withAlerts.length === 0) {
    showToast('No alerts to send');
    return false;
  }
  const result = await deliverFile(fileName, alertsCalendar(withAlerts, def), 'text/calendar');
  if (result === 'cancelled') return false;
  await markAlertsSent(withAlerts.map((t) => ({ id: t.id, sig: alertSignature(t, effectiveAlerts(t, def)) })));
  showToast(
    result === 'shared'
      ? `Open the file and tap Add All · ${withAlerts.length} to-do${withAlerts.length === 1 ? '' : 's'}`
      : `Downloaded · open it to add ${withAlerts.length} alert${withAlerts.length === 1 ? '' : 's'}`,
    4000,
  );
  return true;
}

/** While the app is open, alerts also show in the app as a toast (not a
 *  system notification — Calendar already sends that one). Only moments that
 *  pass while running count; nothing fires for the past on launch. */
export function startTaskNudges(): () => void {
  let last = Date.now();
  const tick = async () => {
    const now = Date.now();
    const from = last;
    last = now;
    if (now - from > 5 * 60_000) return; // asleep or suspended: don't replay a backlog
    const def = defaultAlert();
    const tasks = await db.tasks.where('status').equals('open').toArray();
    for (const t of tasks) {
      if (t.trashedAt !== null) continue;
      for (const m of alertMoments(t, def)) {
        if (m.at > from && m.at <= now) {
          haptic('success');
          showToast(`⏰ ${m.text}`, 6000);
        }
      }
    }
  };
  const id = setInterval(() => void tick(), 20_000);
  return () => clearInterval(id);
}
