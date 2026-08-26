import { expect, test, type Page } from '@playwright/test';
import { loadSeeded } from './helpers';

/** Regression suite for focus loss while typing.
 *
 *  On iOS every one of these focus changes closes the software keyboard
 *  mid-word. Playwright cannot observe the keyboard itself, but focus is the
 *  thing that drives it: if the field still holds focus after a DB round-trip
 *  or a toolbar tap, the keyboard stays up on device. */

async function focusedInfo(page: Page): Promise<{ tag: string; placeholder: string; value: string }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    return {
      tag: el?.tagName ?? 'NONE',
      placeholder: el?.getAttribute('placeholder') ?? '',
      value: el?.value ?? '',
    };
  });
}

/** Type one character at a time with a gap longer than the 300ms write
 *  debounce, so every keystroke races a real Dexie round-trip. */
async function typeSlowly(page: Page, text: string): Promise<void> {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(400);
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw new Error(`Page error: ${err.message}`);
  });
  await loadSeeded(page);
});

test('quick entry keeps focus in the title while the DB echoes back', async ({ page }) => {
  await page.getByTestId('magic-plus').click();
  await page.getByPlaceholder('New To-Do').click();
  await typeSlowly(page, 'Groceries');

  const focused = await focusedInfo(page);
  expect(focused.placeholder).toBe('New To-Do');
  expect(focused.value).toBe('Groceries');
});

test('quick entry toolbar taps never steal focus from the field', async ({ page }) => {
  await page.getByTestId('magic-plus').click();
  await page.getByPlaceholder('New To-Do').click();
  await page.keyboard.type('Plan the trip');

  // The checklist ("to-dos") icon was the reported offender.
  await page.getByRole('button', { name: 'Checklist' }).click();
  let focused = await focusedInfo(page);
  expect(focused.placeholder).toBe('New To-Do');
  expect(focused.value).toBe('Plan the trip');

  await page.getByRole('button', { name: 'Tags' }).click();
  focused = await focusedInfo(page);
  expect(focused.placeholder).toBe('New To-Do');
});

test('quick entry shows title, notes and checklist at once', async ({ page }) => {
  await page.getByTestId('magic-plus').click();

  // Notes no longer hides behind a toolbar toggle.
  await expect(page.getByPlaceholder('Notes')).toBeVisible();

  await page.getByPlaceholder('New To-Do').fill('Pack');
  await page.getByPlaceholder('Notes').fill('Passport, charger');
  await page.getByRole('button', { name: 'Checklist' }).click();
  await page.getByText('+ Add item').click();
  await page.locator('input[data-checklist-id]').first().fill('Socks');

  // All three fields coexist rather than replacing one another.
  await expect(page.getByPlaceholder('New To-Do')).toHaveValue('Pack');
  await expect(page.getByPlaceholder('Notes')).toHaveValue('Passport, charger');

  await page.getByTestId('quick-entry-save').click();
  await expect(page.getByTestId('quick-entry-save')).toBeHidden();
  await page.getByTestId('home-inbox').click();
  await expect(page.getByText('Pack')).toBeVisible();
});

test('card notes keep focus and every character across debounce flushes', async ({ page }) => {
  await page.getByTestId('home-inbox').click();
  await page.getByText('New idea: balcony garden').click();
  const card = page.locator('[data-task-card]');
  await card.getByText('Notes').click();

  await typeSlowly(page, 'herbs');

  const focused = await focusedInfo(page);
  expect(focused.placeholder).toBe('Notes');
  expect(focused.value).toBe('herbs');
});

test('card checklist keeps focus while typing an item', async ({ page }) => {
  await page.getByTestId('home-inbox').click();
  await page.getByText('New idea: balcony garden').click();
  const card = page.locator('[data-task-card]');
  await card.getByText('+ Add item').click();

  await typeSlowly(page, 'Buy pots');

  const focused = await focusedInfo(page);
  expect(focused.tag).toBe('INPUT');
  expect(focused.value).toBe('Buy pots');
});

test('ticking a checklist item does not blur the item being typed', async ({ page }) => {
  await page.getByTestId('home-inbox').click();
  await page.getByText('New idea: balcony garden').click();
  const card = page.locator('[data-task-card]');

  await card.getByText('+ Add item').click();
  await page.keyboard.type('Soil');
  await page.waitForTimeout(400);

  await card.getByRole('button', { name: 'Check' }).first().click();
  await page.waitForTimeout(200);

  const focused = await focusedInfo(page);
  expect(focused.tag).toBe('INPUT');
  expect(focused.value).toBe('Soil');
});
