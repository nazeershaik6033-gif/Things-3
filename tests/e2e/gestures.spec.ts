import { expect, test } from '@playwright/test';
import { loadSeeded, swipe, longPressDrag } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw new Error(`Page error: ${err.message}`);
  });
  await loadSeeded(page);
});

test('swipe right completes a task', async ({ page }) => {
  await page.getByTestId('home-inbox').click();
  await expect(page.getByText('Check insurance offer')).toBeVisible();
  await swipe(page, '[data-key] .task-row:has-text("Check insurance offer")', 160);
  // Completed: checkbox filled, still visible during grace
  await expect(
    page.locator('.task-row', { hasText: 'Check insurance offer' }).getByRole('button', { name: 'Mark incomplete' }),
  ).toBeVisible();
  // Then it animates out of the Inbox
  await expect(page.getByText('Check insurance offer')).toBeHidden({ timeout: 6000 });
});

test('swipe left opens the schedule picker', async ({ page }) => {
  await page.getByTestId('home-inbox').click();
  await swipe(page, '.task-row:has-text("New idea: balcony garden")', -160);
  await expect(page.getByText('When', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.getByText('New idea: balcony garden')).toBeHidden();
  // Now in Today
  await page.getByTestId('back-button').last().click();
  await page.getByTestId('home-today').click();
  await expect(page.getByText('New idea: balcony garden')).toBeVisible();
});

test('long-press drag reorders within the inbox and persists', async ({ page }) => {
  await page.getByTestId('home-inbox').click();
  const rows = page.locator('[data-reorder-row] .task-row');
  await expect(rows).toHaveCount(2);
  const first = await rows.first().textContent();
  // Drag the first row below the second
  await longPressDrag(page, '[data-reorder-row]:has-text("New idea")', 60);
  await page.waitForTimeout(600); // settle + write
  const rowsAfter = page.locator('[data-reorder-row] .task-row');
  expect(await rowsAfter.first().textContent()).not.toBe(first);
  // Order survives reload
  await page.reload();
  await page.waitForSelector('.task-row');
  expect(await page.locator('[data-reorder-row] .task-row').first().textContent()).not.toBe(first);
});

test('drag between Today and This Evening moves the task', async ({ page }) => {
  await page.getByTestId('home-today').click();
  await expect(page.getByText('This Evening')).toBeVisible();
  // 'Water the plants' is in This Evening; drag it far up into the day section
  const eveningRow = '[data-reorder-row][data-section="evening"]';
  await expect(page.locator(eveningRow)).toHaveCount(1);
  await longPressDrag(page, eveningRow, -260);
  await page.waitForTimeout(600);
  // The evening section is now empty → heading hidden, task in day section
  await expect(page.getByText('This Evening')).toBeHidden();
  await expect(page.getByText('Water the plants')).toBeVisible();
});

test('magic plus drag-to-position inserts at that spot', async ({ page }) => {
  await page.getByTestId('home-inbox').click();
  const fab = page.getByTestId('magic-plus');
  const box = (await fab.boundingBox())!;
  const firstRow = page.locator('[data-reorder-row]').first();
  const target = (await firstRow.boundingBox())!;
  // Drag the FAB onto the middle of the first row (insert before second row)
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const to = { x: target.x + 100, y: target.y + target.height + 5 };
  await fab.dispatchEvent('pointerdown', {
    pointerId: 5, isPrimary: true, bubbles: true, pointerType: 'touch',
    clientX: from.x, clientY: from.y,
  });
  for (let i = 1; i <= 10; i++) {
    await fab.dispatchEvent('pointermove', {
      pointerId: 5, isPrimary: true, bubbles: true, pointerType: 'touch',
      clientX: from.x + ((to.x - from.x) * i) / 10,
      clientY: from.y + ((to.y - from.y) * i) / 10,
    });
    await page.waitForTimeout(16);
  }
  await fab.dispatchEvent('pointerup', {
    pointerId: 5, isPrimary: true, bubbles: true, pointerType: 'touch',
    clientX: to.x, clientY: to.y,
  });
  // Quick entry opens for that position
  await page.getByPlaceholder('New To-Do').fill('Inserted by drag');
  await page.getByTestId('quick-entry-save').click();
  await expect(page.getByTestId('quick-entry-save')).toBeHidden();
  // It landed as the second row (after the first)
  const texts = await page.locator('[data-reorder-row] .task-row').allTextContents();
  expect(texts[1]).toContain('Inserted by drag');
});

test('edge swipe goes back', async ({ page }) => {
  await page.getByTestId('home-today').click();
  await expect(page).toHaveURL(/#\/today$/);
  await page.waitForTimeout(800); // let the push transition settle
  // Swipe from the left edge to the right
  await page.locator('.screen').last().dispatchEvent('pointerdown', {
    pointerId: 7, isPrimary: true, bubbles: true, pointerType: 'touch', clientX: 8, clientY: 300,
  });
  for (let i = 1; i <= 12; i++) {
    await page.locator('.screen').last().dispatchEvent('pointermove', {
      pointerId: 7, isPrimary: true, bubbles: true, pointerType: 'touch',
      clientX: 8 + i * 22, clientY: 300,
    });
    await page.waitForTimeout(16);
  }
  await page.locator('.screen').last().dispatchEvent('pointerup', {
    pointerId: 7, isPrimary: true, bubbles: true, pointerType: 'touch', clientX: 8 + 12 * 22, clientY: 300,
  });
  await expect(page).toHaveURL(/#\/$/, { timeout: 3000 });
  await expect(page.getByTestId('home-inbox')).toBeVisible();
});
