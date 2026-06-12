import { expect, test } from '@playwright/test';
import { loadSeeded } from './helpers';

test('label a Today task with an Eisenhower quadrant and regroup', async ({ page }) => {
  await loadSeeded(page);
  await page.getByTestId('home-today').click();

  // Every Today row shows an unlabeled EM chip
  const row = page.locator('div.task-row', { hasText: 'Buy groceries' });
  await expect(row.getByTestId('em-chip')).toHaveText('EM');

  // Pick "Do" from the dropdown sheet
  await row.getByTestId('em-chip').click();
  await page.getByText('Do — Urgent & important').click();

  // Row regroups under a "Do" section (assert via the section's description).
  // The departing row leaves a ~220ms fade-out clone, so wait for exactly one
  // labelled chip (toHaveCount retries) before strict single-element asserts.
  await expect(page.getByText('Urgent & important', { exact: true })).toBeVisible();
  await expect(page.getByTestId('em-chip').filter({ hasText: 'Do' })).toHaveCount(1);
  await expect(row.getByTestId('em-chip')).toHaveText('Do');

  // Change to Eliminate → moves to that section
  await row.getByTestId('em-chip').click();
  await page.getByText('Eliminate — Neither — let it go').click();
  await expect(page.getByText('Neither — let it go', { exact: true })).toBeVisible();
  await expect(page.getByTestId('em-chip').filter({ hasText: 'Eliminate' })).toHaveCount(1);
  await expect(row.getByTestId('em-chip')).toHaveText('Eliminate');

  // Label survives a reload
  await page.reload();
  await page.waitForSelector('[data-testid="back-button"]');
  await expect(
    page.locator('div.task-row', { hasText: 'Buy groceries' }).getByTestId('em-chip'),
  ).toHaveText('Eliminate');

  // Clear returns it to the untriaged group
  await page.locator('div.task-row', { hasText: 'Buy groceries' }).getByTestId('em-chip').click();
  await page.getByText('Clear', { exact: true }).click();
  await expect(page.getByTestId('em-chip').filter({ hasText: 'Eliminate' })).toHaveCount(0);
  await expect(
    page.locator('div.task-row', { hasText: 'Buy groceries' }).getByTestId('em-chip'),
  ).toHaveText('EM');
});
