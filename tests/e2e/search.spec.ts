import { expect, test } from '@playwright/test';
import { loadSeeded } from './helpers';

test.beforeEach(async ({ page }) => {
  await loadSeeded(page);
});

test('quick find searches tasks, projects, areas, tags', async ({ page }) => {
  await page.getByTestId('search-bar').click();
  const input = page.getByTestId('search-input');
  await input.fill('rome');
  await expect(page.getByTestId('search-overlay').getByText('Vacation in Rome')).toBeVisible();

  await input.fill('groc');
  await expect(page.getByTestId('search-overlay').getByText('Buy groceries')).toBeVisible();

  await input.fill('errand');
  await expect(page.getByTestId('search-overlay').getByText('Errand')).toBeVisible();

  await input.fill('zzzzz');
  await expect(page.getByText('No results')).toBeVisible();
});

test('search navigates to a project', async ({ page }) => {
  await page.getByTestId('search-bar').click();
  await page.getByTestId('search-input').fill('website');
  await page.getByTestId('search-overlay').getByText('Website Launch').click();
  await expect(page).toHaveURL(/#\/project\//);
  await expect(page.getByTestId('project-title')).toHaveValue('Website Launch');
});

test('search finds notes content and opens the task where it lives', async ({ page }) => {
  await page.getByTestId('search-bar').click();
  await page.getByTestId('search-input').fill('deep work');
  await page.getByTestId('search-overlay').getByText('Read “Deep Work”').click();
  await expect(page).toHaveURL(/#\/someday$/);
  // The task card auto-expands shortly after navigation
  await expect(page.locator('[data-task-card]')).toBeVisible({ timeout: 3000 });
});

test('empty query shows quick list shortcuts', async ({ page }) => {
  await page.getByTestId('home-today').click();
  await page.getByRole('button', { name: 'Search' }).last().click();
  // Today is the current list so it's omitted from shortcuts
  const overlay = page.getByTestId('search-overlay');
  await expect(overlay.getByText('Inbox')).toBeVisible();
  await expect(overlay.getByText('Logbook')).toBeVisible();
  await overlay.getByText('Someday').click();
  await expect(page).toHaveURL(/#\/someday$/);
});

test('export then import restores data (backup roundtrip)', async ({ page }) => {
  await page.getByTestId('settings-button').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-data').click();
  const download = await downloadPromise;
  const path = await download.path();

  // Wipe by importing an empty-ish state? Instead: delete a task, then import
  await page.getByTestId('back-button').last().click();
  await page.getByTestId('home-inbox').click();
  await page.getByText('Check insurance offer').click();
  await page.locator('[data-task-card]').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Check insurance offer')).toBeHidden();

  // Import the backup (accept the confirm dialog)
  await page.getByTestId('back-button').last().click();
  await page.getByTestId('settings-button').click();
  page.on('dialog', (d) => void d.accept());
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('import-data').click();
  await (await chooserPromise).setFiles(path!);
  await expect(page.getByText(/Imported \d+ to-dos/)).toBeVisible();

  // The deleted task is back in the Inbox
  await page.getByTestId('back-button').last().click();
  await page.getByTestId('home-inbox').click();
  await expect(page.getByText('Check insurance offer')).toBeVisible();
});
