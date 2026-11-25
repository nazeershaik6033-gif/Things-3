import { expect, test } from '@playwright/test';
import { currentScreen, loadSeeded } from './helpers';

test('Quick Entry reads plain words: time, length and a weekly repeat', async ({ page }) => {
  await loadSeeded(page);
  await page.click('[data-testid="home-today"]');
  await page.click('[data-testid="today-view-list"]');
  await page.getByTestId('magic-plus').click();
  const title = page.locator('[data-quick-entry] textarea').first();
  await title.fill('Gym tue thu 7am 1h');
  await expect(page.getByTestId('short-syntax-preview')).toHaveText('7 AM – 8 AM  ·  ↻ every Tue, Thu');
  await page.getByTestId('quick-entry-save').click();

  // It repeats on Tue/Thu at 7–8 AM: the next one waits in Upcoming
  await page.goto('./#/upcoming');
  const row = currentScreen(page).locator('.task-row', { hasText: 'Gym' }).first();
  await expect(row).toBeVisible();
  await expect(row.getByTestId('repeat-badge')).toBeVisible();
  await expect(row).toContainText('7 AM');
});

test('"Keep as text" saves the words as typed', async ({ page }) => {
  await loadSeeded(page);
  await page.click('[data-testid="home-inbox"]');
  await page.getByTestId('magic-plus').click();
  await page.locator('[data-quick-entry] textarea').first().fill('Read Monday notes');
  await expect(page.getByTestId('short-syntax-preview')).toHaveText('Mon');
  await page.getByTestId('nl-toggle').click();
  await page.getByTestId('quick-entry-save').click();
  await expect(currentScreen(page).locator('.task-row', { hasText: 'Read Monday notes' })).toBeVisible();
});

test('# suggests existing tags', async ({ page }) => {
  await loadSeeded(page);
  await page.click('[data-testid="home-inbox"]');
  await page.getByTestId('magic-plus').click();
  const tagTitle = await page.evaluate(async () => {
    const req = indexedDB.open('clarity');
    const db: IDBDatabase = await new Promise((r) => { req.onsuccess = () => r(req.result); });
    const all: { title: string }[] = await new Promise((r) => {
      const q = db.transaction('tags').objectStore('tags').getAll();
      q.onsuccess = () => r(q.result);
    });
    return all[0]?.title ?? '';
  });
  test.skip(!tagTitle, 'seed has no tags');
  await page.locator('[data-quick-entry] textarea').first().fill(`Call #${tagTitle.slice(0, 1)}`);
  await expect(page.getByTestId('token-suggestions')).toContainText(`#${tagTitle}`);
});

test('Alerts: a timed to-do offers calendar alerts with the default on', async ({ page }) => {
  await loadSeeded(page);
  await page.click('[data-testid="home-today"]');
  await page.click('[data-testid="today-view-list"]');
  await currentScreen(page).locator('.task-row').first().click();
  await page.getByTestId('chip-time').click();
  await page.getByTestId('time-start').fill('16:00');
  await page.getByTestId('time-save').click();
  await page.getByRole('button', { name: 'Remind' }).click();
  await expect(page.getByTestId('alert-start-5')).toHaveAttribute('aria-pressed', 'true'); // the default
  await page.getByTestId('alert-start-15').click();
  await expect(page.getByTestId('alert-start-15')).toHaveAttribute('aria-pressed', 'true');
  // The timeline offers to send the day's alerts in one file
  await page.getByTestId('card-backdrop').click({ position: { x: 20, y: 20 } });
  await page.click('[data-testid="today-view-timeline"]');
  await expect(currentScreen(page).getByTestId('tl-alerts')).toHaveText(/Send 1 alert/);
});
