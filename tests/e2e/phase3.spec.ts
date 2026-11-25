import { expect, test, type Page } from '@playwright/test';
import { currentScreen, loadSeeded } from './helpers';

async function putEvent(page: Page, ev: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (ev) => {
    const req = indexedDB.open('clarity');
    const db: IDBDatabase = await new Promise((r) => { req.onsuccess = () => r(req.result); });
    await new Promise<void>((r) => {
      const tx = db.transaction('calendarEvents', 'readwrite');
      tx.objectStore('calendarEvents').put(ev);
      tx.oncomplete = () => r();
    });
    db.close();
  }, ev);
}

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('a calendar event becomes a to-do, or a prep to-do before it', async ({ page }) => {
  await loadSeeded(page);
  const d = todayStr();
  const start = new Date(`${d}T15:00:00`).getTime();
  await putEvent(page, { id: 'u#ev1', date: d, start, end: start + 3_600_000, title: 'Design review', allDay: false, calendarUrl: 'file' });
  // Dexie's live queries don't see writes made outside it: reload
  await page.goto('./#/planner');
  await page.reload();
  await page.getByTestId('planner-days-1').click();
  const ev = currentScreen(page).locator('[data-kind="event"]', { hasText: 'Design review' });
  await ev.scrollIntoViewIfNeeded();
  await ev.click();
  await expect(page.getByTestId('event-sheet')).toContainText('3 – 4 PM');
  await page.getByTestId('event-prep').click();
  await expect(page.getByTestId('toast-text')).toHaveText('Prep added at 2:30 PM');
  await expect(currentScreen(page).locator('[data-kind="task"]', { hasText: 'Prep: Design review' })).toBeVisible();
  await ev.click();
  await page.getByTestId('event-to-todo').click();
  await expect(currentScreen(page).locator('[data-kind="task"][data-title="Design review"]')).toBeVisible();
});

test('skip one occurrence of a repeating to-do', async ({ page }) => {
  await loadSeeded(page);
  await page.click('[data-testid="home-inbox"]');
  await page.getByTestId('magic-plus').click();
  await page.locator('[data-quick-entry] textarea').first().fill('Stretch every day');
  await page.getByTestId('quick-entry-save').click();
  await page.goto('./#/today');
  await page.click('[data-testid="today-view-list"]');
  await currentScreen(page).locator('.task-row', { hasText: 'Stretch' }).first().click();
  await page.getByTestId('chip-skip').click();
  await expect(page.getByTestId('toast-text')).toHaveText('Skipped — the next one is planned');
  await expect(currentScreen(page).locator('.task-row', { hasText: 'Stretch' })).toHaveCount(0);
  // The next one waits in Upcoming, and its history shows the skip
  await page.goto('./#/upcoming');
  await currentScreen(page).locator('.task-row', { hasText: 'Stretch' }).first().click();
  await expect(page.locator('[data-testid="repeat-history"] [data-state="skipped"]')).toHaveCount(1);
});

test('calendar: year view, week numbers, Sunday weeks, week opens the Planner', async ({ page }) => {
  await loadSeeded(page);
  await page.goto('./#/settings');
  await page.getByTestId('week-start-0').click();
  await page.getByTestId('toggle-week-numbers').click();
  await page.goto('./#/calendar');
  const screen = currentScreen(page);
  await expect(screen.getByTestId('cal-weeknum').first()).toBeVisible();
  await expect(screen.getByTestId('cal-dots').first()).toBeAttached();
  await screen.getByTestId('cal-view-year').click();
  await expect(screen.getByTestId('cal-year-month')).toHaveCount(12);
  await screen.getByTestId('cal-year-month').nth(0).click();
  await expect(screen.getByTestId('cal-month-label')).toContainText('January');
  await screen.getByTestId('cal-view-week').click();
  const planner = currentScreen(page);
  await expect(planner.getByTestId('tl-col')).toHaveCount(7);
  // Sunday start: the first column header is a Sunday
  await expect(planner.getByTestId('tl-day-header').first()).toContainText('Sun');
});
