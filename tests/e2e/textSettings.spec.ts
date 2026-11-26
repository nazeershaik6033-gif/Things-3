import { expect, test } from '@playwright/test';
import { currentScreen, loadSeeded } from './helpers';

const rootVar = (page: import('@playwright/test').Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test('text settings restyle the app and survive a reload', async ({ page }) => {
  await loadSeeded(page);
  await page.getByTestId('settings-button').click();
  await page.getByTestId('settings-search').fill('font');
  await page.getByTestId('settings-result-text').click();
  await expect(page.getByTestId('text-preview')).toBeVisible();

  await page.getByTestId('font-serif').click();
  await page.getByTestId('text-size').fill('1.2');
  await expect(page.getByTestId('text-size-value')).toHaveText('120%');
  await page.getByTestId('toggle-bold-text').click();
  await page.getByTestId('lines-roomy').click();

  await expect.poll(() => rootVar(page, '--ts')).toBe('1.2');
  await expect.poll(() => rootVar(page, '--lh')).toBe('1.18');
  await expect(page.locator('html')).toHaveAttribute('data-bold', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-lines', 'roomy');
  expect(await rootVar(page, '--font')).toContain('ui-serif');

  // A 17px row title is now 20.4px, and a 600 weight is 700
  const preview = page.getByTestId('text-preview').locator('span').nth(1);
  await expect(preview).toHaveCSS('font-size', '20.4px');
  await expect(page.getByTestId('text-reset')).toHaveCSS('font-weight', '700');

  await page.reload();
  await expect.poll(() => rootVar(page, '--ts')).toBe('1.2');
  await expect(page.locator('html')).toHaveAttribute('data-bold', 'true');

  await page.getByTestId('text-reset').click();
  await expect.poll(() => rootVar(page, '--ts')).toBe('1');
  await expect(page.locator('html')).toHaveAttribute('data-bold', 'false');
});

test('notes have their own font and size', async ({ page }) => {
  await loadSeeded(page);
  await page.goto(page.url().replace(/#.*/, '#/settings/general/text'));
  await page.getByTestId('notes-font-mono').click();
  await page.getByTestId('notes-size').fill('1.4');
  await expect(page.getByTestId('notes-size-value')).toHaveText('140%');

  const note = page.getByTestId('text-preview').locator('.notes-type');
  await expect(note).toHaveCSS('font-size', '21px'); // 15px × 1.4
  expect(await note.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('monospace');
  // The rest of the app keeps its own font and size
  const row = page.getByTestId('text-preview').locator('span').nth(1);
  await expect(row).toHaveCSS('font-size', '17px');
  expect(await row.evaluate((el) => getComputedStyle(el).fontFamily)).not.toContain('monospace');

  // "Same" puts notes back on the app's font
  await page.getByTestId('notes-font-same').click();
  expect(await note.evaluate((el) => getComputedStyle(el).fontFamily)).not.toContain('monospace');
  await expect(currentScreen(page).getByText('General', { exact: true })).toBeVisible();
});
