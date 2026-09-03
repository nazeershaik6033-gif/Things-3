import { expect, test } from '@playwright/test';
import { loadSeeded } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw new Error(`Page error: ${err.message}`);
  });
  await loadSeeded(page);
});

test('daily routine: seed a starter set, tick items, progress reaches Home', async ({ page }) => {
  await page.getByTestId('home-routine').click();
  await expect(page).toHaveURL(/#\/routine$/);

  // Empty state offers a starter routine
  await page.getByTestId('routine-starter').click();
  const screen = page.locator('.screen').last();
  await expect(screen.getByText('Natural light')).toBeVisible();
  await expect(page.getByTestId('routine-streak')).toContainText('No streak yet');

  // Tick the first two checks. Assert between clicks: the locator re-resolves
  // by aria-label, so firing both back to back can hit the same box twice.
  const boxes = screen.getByRole('button', { name: 'Mark complete' });
  await boxes.first().click();
  await expect(page.getByTestId('routine-hero')).toContainText('1/8');
  await boxes.first().click();
  await expect(page.getByTestId('routine-hero')).toContainText('2/8');

  // Home reflects today's progress
  await page.getByTestId('back-button').last().click();
  await expect(page.getByTestId('home-routine-progress')).toContainText('2/8');
});

test('daily routine: add and delete a check in edit mode', async ({ page }) => {
  await page.getByTestId('home-routine').click();
  await page.getByTestId('routine-edit').click();
  await page.getByTestId('routine-new').fill('Cold shower');
  await page.getByTestId('routine-new').press('Enter');

  const checks = page.locator('input[placeholder="Routine check"]');
  await expect(checks).toHaveCount(1);
  await expect(checks.first()).toHaveValue('Cold shower');

  await page.getByRole('button', { name: 'Delete Cold shower' }).click();
  await expect(checks).toHaveCount(0);
});

test('routine state survives a reload', async ({ page }) => {
  await page.getByTestId('home-routine').click();
  await page.getByTestId('routine-starter').click();
  await page.locator('.screen').last().getByRole('button', { name: 'Mark complete' }).first().click();
  await expect(page.getByTestId('routine-hero')).toContainText('1');

  await page.reload();
  await expect(page).toHaveURL(/#\/routine$/);
  await expect(page.getByTestId('routine-hero')).toContainText('1');
});
