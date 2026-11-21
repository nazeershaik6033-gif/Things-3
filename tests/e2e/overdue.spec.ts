import { expect, test } from '@playwright/test';
import { loadSeeded } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw new Error(`Page error: ${err.message}`);
  });
  await loadSeeded(page);
});

/** The seed puts "Call the dentist" one day past its deadline. */
test('ticking an overdue to-do asks for the day and logs it there', async ({ page }) => {
  await page.getByTestId('home-today').click();
  const todayScreen = page.locator('.screen').last();
  await todayScreen
    .locator('div.task-row', { hasText: 'Call the dentist' })
    .getByRole('button', { name: 'Mark complete' })
    .click();

  // Nothing is written until the day is chosen
  await expect(page.getByText('When did you finish this?')).toBeVisible();
  await page.getByRole('button', { name: /^Yesterday$/ }).click();

  await expect(todayScreen.getByText('Call the dentist')).toBeHidden({ timeout: 5000 });

  // It lands under yesterday's heading in the Logbook, not under today's.
  // The Logbook labels past days as "Aug 9" rather than "Yesterday".
  const yesterdayLabel = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
  });
  await page.getByTestId('back-button').last().click();
  await page.getByTestId('home-logbook').click();
  const logbook = page.locator('.screen').last();
  await expect(logbook.getByText('Call the dentist')).toBeVisible();
  await expect(logbook.getByText(yesterdayLabel, { exact: true })).toBeVisible();
});

test('a to-do due today completes without asking', async ({ page }) => {
  await page.getByTestId('home-today').click();
  const todayScreen = page.locator('.screen').last();
  await todayScreen
    .locator('div.task-row', { hasText: 'Buy groceries' })
    .getByRole('button', { name: 'Mark complete' })
    .click();
  await expect(page.getByText('When did you finish this?')).toBeHidden();
});

test('the prompt can be turned off from Settings', async ({ page }) => {
  await page.getByTestId('settings-button').click();
  await page.getByTestId('toggle-ask-completion').click();
  await page.getByTestId('back-button').last().click();

  await page.getByTestId('home-today').click();
  await page
    .locator('.screen')
    .last()
    .locator('div.task-row', { hasText: 'Call the dentist' })
    .getByRole('button', { name: 'Mark complete' })
    .click();
  await expect(page.getByText('When did you finish this?')).toBeHidden();
});
