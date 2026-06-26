import { expect, test } from '@playwright/test';
import { loadSeeded } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw new Error(`Page error: ${err.message}`);
  });
  await loadSeeded(page);
});

test('full lifecycle: create → schedule → complete → logbook → reopen', async ({ page }) => {
  // Create in Inbox via Magic Plus tap
  await page.getByTestId('home-inbox').click();
  await page.getByTestId('magic-plus').click();
  await page.getByPlaceholder('New To-Do').fill('Write the report');
  await page.getByTestId('quick-entry-save').click();
  await expect(page.getByText('Write the report')).toBeVisible();

  // Expand inline, schedule for Today via the card's When picker
  await page.getByText('Write the report').click();
  await expect(page.locator('[data-task-card]')).toBeVisible();
  await page.getByRole('button', { name: 'Schedule' }).click();
  await page.getByRole('button', { name: 'Today (Anytime)', exact: true }).click();

  // Scheduling moves it out of the Inbox (card closes with it)
  await expect(page.getByText('Write the report')).toBeHidden();
  await page.getByTestId('back-button').last().click();
  await page.getByTestId('home-today').click();
  await expect(page.getByText('Write the report')).toBeVisible();

  // Complete it: row checkbox
  await page
    .locator('div.task-row', { hasText: 'Write the report' })
    .getByRole('button', { name: 'Mark complete' })
    .click();
  // Grace period: still visible, struck through
  await expect(page.getByText('Write the report')).toBeVisible();
  // After grace it animates out
  await expect(page.getByText('Write the report')).toBeHidden({ timeout: 5000 });

  // Shows up in the Logbook under today
  await page.getByTestId('back-button').last().click();
  await page.getByTestId('home-logbook').click();
  await expect(page.getByText('Write the report')).toBeVisible();

  // Reopen from the logbook (newest entry is first)
  await page.getByRole('button', { name: 'Mark incomplete' }).first().click();
  await expect(page.getByText('Write the report')).toBeHidden();
});

test('quick entry with notes, checklist, tags, deadline and destination', async ({ page }) => {
  await page.getByTestId('magic-plus').click();
  await page.getByPlaceholder('New To-Do').fill('Prepare slides');

  // Notes
  await page.getByRole('button', { name: 'Notes' }).click();
  await page.getByPlaceholder('Notes').fill('Use the **new** template');

  // Checklist
  await page.getByRole('button', { name: 'Checklist' }).click();
  await page.getByText('+ Add item').click();
  await page.locator('input[data-checklist-id]').first().fill('Outline');

  // Deadline (pick a day from the calendar: use "Today" not available → tap a date)
  await page.getByRole('button', { name: 'Deadline' }).click();
  await page.getByRole('button', { name: 'Next month' }).click();
  await page.getByRole('button', { name: '15', exact: true }).click();

  // Destination → Website Launch project
  await page.getByRole('button', { name: /Inbox/ }).last().click();
  await page.getByRole('button', { name: 'Website Launch' }).last().click();

  await page.getByTestId('quick-entry-save').click();
  await expect(page.getByTestId('quick-entry-save')).toBeHidden();

  // Verify in the project
  await page.getByText('Website Launch').click();
  await expect(page.getByText('Prepare slides')).toBeVisible();
  await expect(page.getByText('0/1')).toBeVisible(); // checklist chip
});

test('edit title, notes and checklist inline; data persists', async ({ page }) => {
  await page.getByTestId('home-inbox').click();
  await page.getByText('New idea: balcony garden').click();
  const card = page.locator('[data-task-card]');
  await expect(card).toBeVisible();

  await card.getByPlaceholder('New To-Do').fill('Balcony garden v2');
  await card.getByText('Notes').click();
  await card.getByPlaceholder('Notes').fill('Start with herbs: *basil*, mint');
  await card.getByText('+ Add item').click();
  await card.locator('input[data-checklist-id]').first().fill('Buy pots');
  await page.waitForTimeout(450); // debounce flush

  // Collapse and verify the row shows the new state
  await page.getByTestId('card-backdrop').click({ position: { x: 10, y: 40 } });
  await expect(page.getByText('Balcony garden v2')).toBeVisible();
  await expect(page.getByText('0/1')).toBeVisible();

  // Survives reload
  await page.reload();
  await page.waitForSelector('.screen');
  await expect(page.getByText('Balcony garden v2')).toBeVisible();
});

test('trash and restore from the card; empty trash deletes forever', async ({ page }) => {
  await page.getByTestId('home-inbox').click();
  await page.getByText('Check insurance offer').click();
  await page.locator('[data-task-card]').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Check insurance offer')).toBeHidden();

  await page.getByTestId('back-button').last().click();
  await page.getByTestId('home-trash').click();
  await expect(page.getByText('Check insurance offer')).toBeVisible();

  // Restore
  await page.getByRole('button', { name: 'Restore' }).first().click();
  await expect(page.getByText('Check insurance offer')).toBeHidden();

  // Trash it again, then empty the trash
  await page.getByTestId('back-button').last().click();
  await page.getByTestId('home-inbox').click();
  await page.getByText('Check insurance offer').click();
  await page.locator('[data-task-card]').getByRole('button', { name: 'Delete' }).click();
  await page.getByTestId('back-button').last().click();
  await page.getByTestId('home-trash').click();
  await page.getByTestId('empty-trash').click();
  await page.getByRole('button', { name: 'Empty Trash' }).click();
  await expect(page.getByText('The Trash is empty.')).toBeVisible();
});

test('new project: create, add heading, complete project', async ({ page }) => {
  await page.getByTestId('new-list').click();
  await page.getByRole('button', { name: 'New Project' }).click();
  await page.getByTestId('project-title').fill('Spring cleaning');

  // Add a to-do via Magic Plus
  await page.getByTestId('magic-plus').click();
  await page.getByPlaceholder('New To-Do').fill('Clean the windows');
  await page.getByTestId('quick-entry-save').click();
  await expect(page.getByText('Clean the windows')).toBeVisible();

  // Add a heading via the project menu
  await page.getByTestId('project-menu').click();
  await page.getByRole('button', { name: 'Add Heading' }).click();
  await page.getByPlaceholder('Heading').fill('Inside');

  // Complete the project → its open tasks complete too, back home
  await page.getByTestId('project-menu').click();
  await page.getByRole('button', { name: 'Complete Project' }).click();
  await expect(page.getByTestId('home-inbox')).toBeVisible();
  await page.getByTestId('home-logbook').click();
  await expect(page.getByText('Spring cleaning')).toBeVisible();
  await expect(page.getByText('Clean the windows')).toBeVisible();
});

test('evening tasks: quick entry from Today tonight section', async ({ page }) => {
  await page.getByTestId('home-today').click();
  await page.getByTestId('magic-plus').click();
  await page.getByPlaceholder('New To-Do').fill('Stretch before bed');
  // Set to Tonight via the When chip
  await page.getByRole('button', { name: 'When' }).click();
  await page.getByRole('button', { name: 'Tonight' }).click();
  await page.getByTestId('quick-entry-save').click();
  await expect(page.getByTestId('quick-entry-save')).toBeHidden();

  // It lands under the Tonight section
  await expect(page.getByText('Tonight')).toBeVisible();
  await expect(page.getByText('Stretch before bed')).toBeVisible();
});
