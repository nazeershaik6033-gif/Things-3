import { db } from '../db/db';
import { updateCard } from '../db/boardMutations';
import { fromDateStr } from '../domain/dates';
import type { Card } from '../db/models';

/** Local, best-effort due-date reminders for board cards.
 *
 *  This is a foreground/local mechanism only — there is no push server, so
 *  notifications fire while the app (or its tab) is alive and the browser
 *  allows Notifications. Each card fires at most once: once shown (or once we
 *  know permission is permanently denied) we stamp `reminded: true`. Changing
 *  a card's due date re-arms it (see updateCard).
 */

const SCAN_INTERVAL_MS = 30_000;
const DEFAULT_HOUR = 9; // cards with a date but no time remind at 9am

function supported(): boolean {
  return typeof Notification !== 'undefined';
}

/** Ask the user for notification permission (call from a user gesture, e.g.
 *  when they first set a due date). No-op if unsupported or already decided. */
export async function requestReminderPermission(): Promise<void> {
  if (!supported() || Notification.permission !== 'default') return;
  try {
    await Notification.requestPermission();
  } catch {
    /* Safari <16 uses the callback form; ignore failures */
  }
}

/** Epoch ms at which a card's reminder should fire. */
function dueAt(card: Card): number {
  const base = fromDateStr(card.due!);
  if (card.dueTime && /^\d{2}:\d{2}$/.test(card.dueTime)) {
    const [h, m] = card.dueTime.split(':').map(Number);
    base.setHours(h!, m!, 0, 0);
  } else {
    base.setHours(DEFAULT_HOUR, 0, 0, 0);
  }
  return base.getTime();
}

async function scan(): Promise<void> {
  if (!supported()) return;
  const now = Date.now();
  const cards = await db.cards.toArray();
  for (const card of cards) {
    if (card.archived || card.completed || card.reminded || !card.due) continue;
    if (dueAt(card) > now) continue;
    if (Notification.permission === 'granted') {
      try {
        new Notification(card.title || 'Card due', {
          body: 'This card is due.',
          tag: `card-${card.id}`,
        });
      } catch {
        /* construction can throw on some platforms; still mark to avoid loops */
      }
      await updateCard(card.id, { reminded: true });
    } else if (Notification.permission === 'denied') {
      // Never able to notify — stop re-scanning this card.
      await updateCard(card.id, { reminded: true });
    }
    // permission 'default': leave un-reminded so it fires once granted.
  }
}

export function startReminders(): void {
  if (!supported()) return;
  void scan();
  setInterval(() => void scan(), SCAN_INTERVAL_MS);
}
