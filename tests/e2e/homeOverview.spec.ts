import { expect, test } from '@playwright/test';
import { loadEmpty, loadSeeded } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw new Error(`Page error: ${err.message}`);
  });
});

test('the widget deck starts minimised when there is nothing in it', async ({ page }) => {
  await loadEmpty(page);

  await expect(page.getByTestId('widget-deck')).toBeHidden();
  await expect(page.getByTestId('widget-deck-summary')).toHaveText('Nothing scheduled');

  // The arrow opens it anyway — an empty deck is hidden, not unavailable
  await page.getByTestId('widget-deck-toggle').click();
  await expect(page.getByTestId('widget-deck')).toBeVisible();
  await expect(page.getByTestId('widget-target')).toBeVisible();
  await expect(page.getByTestId('widget-up-next')).toBeVisible();
  await expect(page.getByTestId('widget-deck-summary')).toBeHidden();

  // ...and that choice outlives a reload
  await page.reload();
  await expect(page.getByTestId('widget-deck')).toBeVisible();
});

test('a day with something on it opens the deck by default', async ({ page }) => {
  // The seed leaves "Call the dentist" past its deadline
  await loadSeeded(page);

  await expect(page.getByTestId('widget-deck')).toBeVisible();
  await expect(page.getByTestId('widget-overdue-count')).not.toHaveText('0');

  // Minimising by hand sticks even though the day has news to report
  await page.getByTestId('widget-deck-toggle').click();
  await expect(page.getByTestId('widget-deck')).toBeHidden();
  await expect(page.getByTestId('widget-deck-summary')).toContainText('overdue');

  await page.reload();
  await expect(page.getByTestId('widget-deck')).toBeHidden();
});

test('setting a target opens the deck on an otherwise empty day', async ({ page }) => {
  await loadEmpty(page);
  await expect(page.getByTestId('widget-deck')).toBeHidden();

  await page.getByTestId('home-target').click();
  await page.getByTestId('target-input').fill('Ship the release');
  await page.getByTestId('target-save').click();
  await page.getByTestId('back-button').last().click();

  await expect(page.getByTestId('widget-deck')).toBeVisible();
  await expect(page.getByTestId('widget-target-text')).toHaveText('Ship the release');
});
