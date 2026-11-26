import { expect, test, type Page } from '@playwright/test';
import { currentScreen, loadSeeded, homeRow, openSettings, tapPlus } from './helpers';

/** Features ported from Super Productivity, end to end on the iPhone profile. */

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw new Error(`Page error: ${err.message}`);
  });
  await loadSeeded(page);
});

async function quickAdd(page: Page, text: string): Promise<void> {
  await tapPlus(page);
  await page.getByPlaceholder('New To-Do').fill(text);
  await page.getByTestId('quick-entry-save').click();
}

test('short syntax files tags, project, date and estimate', async ({ page }) => {
  await (await homeRow(page, 'home-inbox')).click();
  await tapPlus(page);
  await page.getByPlaceholder('New To-Do').fill('Plan sprint #planning @today ~45m');
  await expect(page.getByTestId('short-syntax-preview')).toContainText('#planning');
  await expect(page.getByTestId('short-syntax-preview')).toContainText('45m');
  await page.getByTestId('quick-entry-save').click();

  // @today moved it out of the Inbox and into Today, title cleaned up
  await expect(currentScreen(page).getByText('Plan sprint', { exact: true })).toBeHidden();
  await page.getByTestId('back-button').last().click();
  await (await homeRow(page, 'home-today')).click();
  const row = currentScreen(page).locator('div.task-row', { hasText: 'Plan sprint' });
  await expect(row).toBeVisible();
  await expect(row.getByTestId('row-time-chip')).toContainText('45m');
  await expect(row).toContainText('planning');
  await expect(currentScreen(page).getByTestId('today-plan-left')).toContainText('45m left');
});

test('track time on a to-do, see it live, stop it, find it in the Worklog', async ({ page }) => {
  await (await homeRow(page, 'home-inbox')).click();
  await quickAdd(page, 'Deep work block');
  await currentScreen(page).getByText('Deep work block').click();
  const card = page.locator('[data-task-card]');
  await card.getByTestId('chip-track').click();
  await expect(card.getByTestId('chip-track')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('tracker-bar')).toContainText('Deep work block');
  await expect(page.getByTestId('tracker-time')).toHaveText(/0:00:0[1-9]/, { timeout: 5000 });

  // Survives a reload: the tracker is wall-clock based
  await page.reload();
  await expect(page.getByTestId('tracker-bar')).toContainText('Deep work block');
  await page.waitForTimeout(1100);
  await page.getByTestId('tracker-stop').click();
  await expect(page.getByTestId('tracker-bar')).toBeHidden();

  // Logged in the Worklog; correct it to 1h 30m by hand
  await page.goto('./#/worklog');
  await expect(currentScreen(page).getByText('Deep work block')).toBeVisible();
  await currentScreen(page).getByTestId('worklog-entry-time').first().click();
  await currentScreen(page).getByTestId('worklog-entry-input').fill('1h30m');
  await currentScreen(page).getByTestId('worklog-entry-input').press('Enter');
  await expect(currentScreen(page).getByTestId('worklog-today-value')).toHaveText('1h 30m');
});

test('estimate a to-do from the card', async ({ page }) => {
  await (await homeRow(page, 'home-inbox')).click();
  await quickAdd(page, 'Write proposal');
  await currentScreen(page).getByText('Write proposal').click();
  const card = page.locator('[data-task-card]');
  await card.getByTestId('chip-estimate').click();
  await card.getByTestId('estimate-input').fill('1h15m');
  await card.getByTestId('estimate-save').click();
  await expect(card.getByTestId('chip-estimate')).toContainText('1h 15m');
});

test('make a to-do repeat daily and see the next one ahead', async ({ page }) => {
  await (await homeRow(page, 'home-inbox')).click();
  await quickAdd(page, 'Stand-up notes');
  await currentScreen(page).getByText('Stand-up notes').click();
  const card = page.locator('[data-task-card]');
  await card.getByRole('button', { name: 'Repeat', exact: true }).click();
  await card.getByTestId('repeat-daily').click();
  await expect(card.getByTestId('repeat-summary')).toContainText('Every day');
  await card.getByTestId('repeat-save').click();

  // It became a repeating to-do for today; the next occurrence is in Upcoming
  await page.getByTestId('back-button').last().click();
  await (await homeRow(page, 'home-today')).click();
  const row = currentScreen(page).locator('div.task-row', { hasText: 'Stand-up notes' });
  await expect(row.getByTestId('repeat-badge')).toBeVisible();
  await page.getByTestId('back-button').last().click();
  await (await homeRow(page, 'home-upcoming')).click();
  await expect(currentScreen(page).locator('div.task-row', { hasText: 'Stand-up notes' }).first()).toBeVisible();

  // The card shows the rule and can stop it
  await currentScreen(page).getByText('Stand-up notes').first().click();
  await expect(page.locator('[data-task-card]').getByTestId('chip-repeat')).toContainText('Every day');
  await page.locator('[data-task-card]').getByTestId('chip-repeat').click();
  await page.locator('[data-task-card]').getByTestId('repeat-stop').click();
  await expect(currentScreen(page).locator('div.task-row', { hasText: 'Stand-up notes' })).toHaveCount(0);
});

test('counters: tap counter with a goal and a stopwatch', async ({ page }) => {
  await (await homeRow(page, 'home-counters')).click();
  await currentScreen(page).getByTestId('counter-add').click();
  await currentScreen(page).getByTestId('counter-title').fill('Water');
  await currentScreen(page).getByTestId('counter-goal').fill('2');
  await currentScreen(page).getByTestId('counter-save').click();
  const water = currentScreen(page).locator('[data-testid^="counter-"]', { hasText: 'Water' }).first();
  await water.getByTestId('counter-plus').click();
  await water.getByTestId('counter-plus').click();
  await water.getByTestId('counter-plus').click();
  await water.getByTestId('counter-minus').click();
  await expect(water.getByTestId('counter-value')).toHaveText('2');
  await expect(water.getByTestId('counter-streak')).toContainText('1');

  await currentScreen(page).getByTestId('counter-add').click();
  await currentScreen(page).getByTestId('counter-title').fill('Reading');
  await currentScreen(page).getByTestId('counter-kind-stopwatch').click();
  await currentScreen(page).getByTestId('counter-save').click();
  const reading = currentScreen(page).locator('[data-testid^="counter-"]', { hasText: 'Reading' }).first();
  await reading.getByTestId('counter-toggle').click();
  await expect(reading.getByTestId('counter-toggle')).toHaveAttribute('aria-pressed', 'true');
  await reading.getByTestId('counter-toggle').click();
  await expect(reading.getByTestId('counter-toggle')).toHaveAttribute('aria-pressed', 'false');

  await page.getByTestId('back-button').last().click();
  await expect((await homeRow(page, 'home-counters'))).toContainText('1/2');
});

test('finish day: roll leftovers to tomorrow and save a review', async ({ page }) => {
  await (await homeRow(page, 'home-inbox')).click();
  await quickAdd(page, 'Leftover task @today');
  await page.getByTestId('back-button').last().click();
  await (await homeRow(page, 'home-finish-day')).click();
  const open = currentScreen(page).getByTestId('fd-open-list');
  await expect(open).toContainText('Leftover task');
  await open.locator('div', { hasText: 'Leftover task' }).last().getByTestId('fd-tomorrow').click();
  await expect(open.getByText('Leftover task')).toBeHidden();
  await currentScreen(page).getByTestId('fd-impact-3').click();
  await currentScreen(page).getByPlaceholder(/One line about today/).fill('Shipped the port');
  await currentScreen(page).getByTestId('fd-finish').click();
  await expect((await homeRow(page, 'home-finish-day-state'))).toHaveText('Done');

  await page.goto('./#/worklog');
  await expect(currentScreen(page).getByTestId('worklog-review')).toContainText('High impact · Shipped the port');
});

test('settings expose break reminders, short syntax and GitHub import', async ({ page }) => {
  await openSettings(page, 'planning');
  await expect(currentScreen(page).getByTestId('toggle-break-reminder')).toHaveAttribute('aria-pressed', 'true');
  await currentScreen(page).getByTestId('toggle-break-reminder').click();
  await expect(currentScreen(page).getByTestId('toggle-break-reminder')).toHaveAttribute('aria-pressed', 'false');
  await expect(currentScreen(page).getByText('~45m')).toBeVisible();
  // GitHub import is in another group: back to the Settings landing page
  await page.getByTestId('back-button').last().click();
  await page.getByTestId('settings-group-integrations').click();
  await currentScreen(page).getByTestId('github-repo').fill('not a repo');
  await currentScreen(page).getByTestId('github-repo').blur();
  await currentScreen(page).getByTestId('github-sync').click();
  await expect(currentScreen(page).getByTestId('github-error')).toContainText('owner/name');
});
