import { expect, test } from '@playwright/test';
import { loadSeeded } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw new Error(`Page error: ${err.message}`);
  });
  await loadSeeded(page);
});

test('calendar: month grid lists the whole month and pins the selected day', async ({ page }) => {
  await page.getByTestId('home-calendar').click();
  await expect(page).toHaveURL(/#\/calendar$/);
  await expect(page.getByTestId('month-calendar')).toBeVisible();

  // Today is selected on arrival and pinned above the month list
  const pinned = page.getByTestId('pinned-day');
  await expect(pinned).toBeVisible();
  await expect(pinned).toContainText('SELECTED');

  // The seeded to-dos give this month at least one dated entry
  await expect(page.getByTestId('agenda-day').first()).toBeVisible();

  // Picking another day repins without losing the month list
  const label = await page.getByTestId('month-label').textContent();
  const monthDays = page.locator('[data-day]');
  const target = monthDays.nth(15);
  const targetDate = await target.getAttribute('data-day');
  await target.click();
  await expect(page.getByTestId('pinned-day')).toHaveAttribute('data-date', targetDate!);
  await expect(page.getByTestId('month-label')).toHaveText(label!);
  await expect(page.getByTestId('agenda-day').first()).toBeVisible();
});

test('calendar: paging months keeps the pin inside the visible month', async ({ page }) => {
  await page.getByTestId('home-calendar').click();
  const label = await page.getByTestId('month-label').textContent();

  await page.getByTestId('month-next').click();
  await expect(page.getByTestId('month-label')).not.toHaveText(label!);
  const pinned = await page.getByTestId('pinned-day').getAttribute('data-date');
  const shown = await page.getByTestId('month-label').textContent();
  // Pinned day belongs to the month now on screen
  expect(shown!.startsWith(new Date(`${pinned}T12:00:00`).toLocaleString('en-US', { month: 'long' }))).toBe(true);

  await page.getByTestId('month-prev').click();
  await expect(page.getByTestId('month-label')).toHaveText(label!);
});

test('calendar: the Google Calendar link targets the selected day', async ({ page }) => {
  await page.getByTestId('home-calendar').click();
  const pinned = (await page.getByTestId('pinned-day').getAttribute('data-date'))!;
  const href = await page.getByTestId('add-google-event').getAttribute('href');
  expect(href).toContain(pinned.replace(/-/g, ''));
  expect(href).toContain('calendar.google.com');
});
