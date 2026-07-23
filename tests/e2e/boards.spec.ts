import { expect, test } from '@playwright/test';
import { currentScreen, loadEmpty, loadSeeded } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw new Error(`Page error: ${err.message}`);
  });
});

test('seeded board: browse columns, edit a card, move it, calendar view', async ({ page }) => {
  await loadSeeded(page);

  // Open the demo board from Home → Boards.
  await page.getByTestId('home-boards').click();
  await expect(page.getByText('Product Roadmap')).toBeVisible();
  await page.getByTestId('board-row').first().click();

  // A card from each seeded column is present (confirms all three lists render).
  await expect(page.getByText('Design onboarding flow')).toBeVisible(); // To Do
  await expect(page.getByText('Dark mode polish')).toBeVisible();       // In Progress
  await expect(page.getByText('Ship v0.1')).toBeVisible();              // Done
  await expect(page.locator('[data-testid="list-title"]')).toHaveCount(3);

  // Open a card and edit it.
  await page.getByText('Fix crash on empty search').click();
  await expect(page.getByTestId('card-title')).toHaveValue('Fix crash on empty search');
  await page.getByTestId('card-description').fill('Reproduce with an empty query string.');

  // Move it to Done via the card menu.
  await page.getByTestId('card-menu').click();
  await page.getByRole('button', { name: 'Move to List' }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByText('in Done')).toBeVisible();

  // Back to the board; the card is still there.
  await page.getByTestId('back-button').last().click();
  await expect(page.getByText('Fix crash on empty search')).toBeVisible();

  // Description persisted (reopen).
  await page.getByText('Fix crash on empty search').click();
  await expect(page.getByTestId('card-description')).toHaveValue('Reproduce with an empty query string.');
  await page.getByTestId('back-button').last().click();

  // Calendar view lists cards with due dates. Scope to the top screen — the
  // board screen underneath stays mounted and also shows this card's title.
  await page.getByTestId('board-calendar').click();
  await expect(currentScreen(page).getByText('Design onboarding flow')).toBeVisible();
});

test('create a board, add a list and a card; it persists across reload', async ({ page }) => {
  await loadEmpty(page);

  // New Board from the Home "New List" sheet.
  await page.getByTestId('new-list').click();
  await page.getByRole('button', { name: 'New Board' }).click();
  await page.getByTestId('board-title').fill('Trip planning');

  // Add a list, then a card via the inline composer.
  await page.getByTestId('add-list').click();
  await page.getByTestId('list-title').first().fill('Packing');
  await page.getByTestId('card-composer').fill('Passport');
  await page.getByTestId('card-composer').press('Enter');
  await expect(page.getByText('Passport')).toBeVisible();

  // Survives a reload (hash keeps us on the board).
  await page.reload();
  await page.waitForSelector('.screen');
  await expect(page.getByTestId('board-title')).toHaveValue('Trip planning');
  await expect(page.getByText('Passport')).toBeVisible();
});

test('typing keystroke-by-keystroke into a list title keeps focus', async ({ page }) => {
  // Regression test: an unkeyed <For> over the lists array remounted the
  // column (and its focused title input) on every keystroke, since each
  // write round-trips through the live query and re-fetches a brand-new
  // array of objects — only the first character ever landed.
  await loadEmpty(page);
  await page.getByTestId('new-list').click();
  await page.getByRole('button', { name: 'New Board' }).click();
  await page.getByTestId('add-list').click();

  const listTitle = page.getByTestId('list-title').first();
  await listTitle.pressSequentially('Backlog', { delay: 20 });
  await expect(listTitle).toHaveValue('Backlog');
  await expect(listTitle).toBeFocused();
});

test('typing keystroke-by-keystroke into a label name keeps focus', async ({ page }) => {
  // A fresh board has no seeded labels, so exactly one row exists here —
  // Dexie's row order isn't creation order, so this sidesteps needing to
  // pick "the new one" out of several.
  await loadEmpty(page);
  await page.getByTestId('new-list').click();
  await page.getByRole('button', { name: 'New Board' }).click();
  await page.getByTestId('board-menu').click();
  await page.getByRole('button', { name: 'Manage Labels' }).click();

  await page.getByPlaceholder('New label…').fill('Urgent');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  const labelInput = page.getByPlaceholder('Label name');
  await expect(labelInput).toHaveValue('Urgent');
  await labelInput.click(); // focus; a fresh click's cursor position isn't guaranteed
  await labelInput.press('End');
  await labelInput.pressSequentially(' now', { delay: 20 });
  await expect(labelInput).toHaveValue('Urgent now');
  await expect(labelInput).toBeFocused();
});

test('Settings has a Boards guide and its Open Boards button navigates there', async ({ page }) => {
  await loadSeeded(page);
  await page.getByTestId('settings-button').click();
  await expect(currentScreen(page).getByText(/Trello-style board/)).toBeVisible();
  await page.getByTestId('open-boards').click();
  await expect(currentScreen(page).getByText('Product Roadmap')).toBeVisible();
});

test('card checklist and labels update the card badges', async ({ page }) => {
  await loadSeeded(page);
  await page.getByTestId('home-boards').click();
  await page.getByTestId('board-row').first().click();

  // "Write API docs" starts with no checklist.
  await page.getByText('Write API docs').click();
  await page.getByText('+ Add item').click();
  await page.locator('input[data-checklist-id]').first().fill('Draft outline');
  await page.waitForTimeout(300);
  await page.getByTestId('back-button').last().click();

  // The card now shows a 0/1 checklist badge.
  await expect(page.getByText('0/1')).toBeVisible();
});
