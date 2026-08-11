import { expect, test } from '@playwright/test';
import { loadSeeded } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw new Error(`Page error: ${err.message}`);
  });
  await loadSeeded(page);
});

test('set a target in the morning, judge it at night', async ({ page }) => {
  // Home says nothing is set yet
  await expect(page.getByTestId('home-target-state')).toHaveText('Not set');

  await page.getByTestId('home-target').click();
  await expect(page).toHaveURL(/#\/target$/);

  await page.getByTestId('target-input').fill('Finish the migration plan');
  await page.getByTestId('target-save').click();

  const screen = page.locator('.screen').last();
  await expect(page.getByTestId('target-text')).toHaveText('Finish the migration plan');
  await expect(page.getByTestId('target-streak')).toContainText('No streak yet');

  // The night half: record a verdict with a note
  await page.getByTestId('target-reflection').fill('Took all afternoon but it is done.');
  await page.getByTestId('target-hit').click();
  await expect(screen.getByText('Hit', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('target-streak')).toContainText('1-day streak');

  // Home reflects the verdict, and it survives a reload
  await page.getByTestId('back-button').last().click();
  await expect(page.getByTestId('home-target-state')).toHaveText('Hit');
  await expect(page.getByTestId('widget-target-text')).toHaveText('Finish the migration plan');

  await page.reload();
  await expect(page.getByTestId('home-target-state')).toHaveText('Hit');
});

test('only one target exists per day — setting again replaces it', async ({ page }) => {
  await page.getByTestId('home-target').click();
  await page.getByTestId('target-input').fill('First idea');
  await page.getByTestId('target-save').click();
  await expect(page.getByTestId('target-text')).toHaveText('First idea');

  await page.getByTestId('target-menu').click();
  await page.getByRole('button', { name: 'Edit target' }).click();
  await page.getByTestId('target-input').fill('Sharper idea');
  await page.getByTestId('target-save').click();

  await expect(page.getByTestId('target-hero')).toHaveCount(1);
  await expect(page.getByTestId('target-text')).toHaveText('Sharper idea');
});

test('a linked to-do carries the target, and a verdict overrides it', async ({ page }) => {
  await page.getByTestId('home-target').click();
  await page.getByTestId('target-input').fill('Ship the groceries run');
  await page.getByTestId('target-save').click();

  // Link one of today's seeded to-dos
  await page.getByTestId('target-menu').click();
  await page.getByRole('button', { name: 'Link a to-do' }).click();
  // Exact: Home's Today banner also reads "Next: Buy groceries"
  await page.getByRole('button', { name: 'Buy groceries', exact: true }).click();
  await expect(page.getByTestId('target-linked')).toContainText('Buy groceries');

  // Completing that to-do counts the target as hit, without a manual verdict
  await page.getByTestId('back-button').last().click();
  await page.getByTestId('home-today').click();
  await page
    .locator('.screen')
    .last()
    .locator('div.task-row', { hasText: 'Buy groceries' })
    .getByRole('button', { name: 'Mark complete' })
    .click();
  await page.getByTestId('back-button').last().click();
  await expect(page.getByTestId('home-target-state')).toHaveText('Hit');

  // An explicit verdict wins over the derived one
  await page.getByTestId('home-target').click();
  await page.getByTestId('target-missed').click();
  await page.getByTestId('back-button').last().click();
  await expect(page.getByTestId('home-target-state')).toHaveText('Missed');
});

test('a verdict can be undone', async ({ page }) => {
  await page.getByTestId('home-target').click();
  await page.getByTestId('target-input').fill('Write the brief');
  await page.getByTestId('target-save').click();
  await page.getByTestId('target-hit').click();
  await expect(page.getByTestId('target-streak')).toContainText('1-day streak');

  await page.getByTestId('target-menu').click();
  await page.getByRole('button', { name: 'Undo verdict' }).click();
  await expect(page.getByTestId('target-streak')).toContainText('No streak yet');
});
