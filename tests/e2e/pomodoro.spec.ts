import { expect, test } from '@playwright/test';
import { loadSeeded } from './helpers';

test('focus timer: start, minimize to mini bar, reopen, finish → logged record', async ({ page }) => {
  await loadSeeded(page);
  await page.getByTestId('home-today').click();

  // Open from the Today header
  await page.getByTestId('pomo-open').click();
  await expect(page.getByTestId('pomo-overlay')).toBeVisible();

  // Default focus mode: the top compass preset is 25 minutes
  await expect(page.getByTestId('pomo-slot-0')).toHaveText('25');

  // Tap the dial to begin — the running clock shows the planned time, counting down
  await page.getByTestId('pomo-start').click();
  await expect(page.getByTestId('pomo-remaining')).toHaveText('25:00');
  await expect(page.getByTestId('pomo-remaining')).not.toHaveText('25:00', { timeout: 5000 });

  // Tap the face for controls, then minimize → the session keeps running behind a mini bar
  await page.getByTestId('pomo-face').click();
  await page.getByTestId('pomo-minimize').click();
  await expect(page.getByTestId('pomo-overlay')).toBeHidden();
  await expect(page.getByTestId('pomo-minibar')).toBeVisible();

  // Mini bar follows you to other screens
  await page.getByTestId('back-button').last().click(); // back to home
  await expect(page.getByTestId('pomo-minibar')).toBeVisible();

  // Tap the mini bar to jump back in, then finish
  await page.getByTestId('pomo-minibar').click();
  await expect(page.getByTestId('pomo-overlay')).toBeVisible();
  await page.getByTestId('pomo-face').click();
  await page.getByTestId('pomo-done').click();

  // Session cleared → dial again; the finished session is logged in Records
  await expect(page.getByTestId('pomo-start')).toBeVisible();
  await page.getByTestId('pomo-records').click();
  await expect(page.getByTestId('pomo-record').first()).toBeVisible();
});

test('focus timer: discard leaves no record', async ({ page }) => {
  await loadSeeded(page);
  await page.getByTestId('home-today').click();
  await page.getByTestId('pomo-open').click();

  await page.getByTestId('pomo-start').click();
  await page.getByTestId('pomo-face').click();
  await page.getByTestId('pomo-discard').click();

  await expect(page.getByTestId('pomo-start')).toBeVisible();
  await page.getByTestId('pomo-records').click();
  await expect(page.getByTestId('pomo-record')).toHaveCount(0);
});

test('focus timer: editing a compass preset changes the planned time', async ({ page }) => {
  await loadSeeded(page);
  await page.getByTestId('home-today').click();
  await page.getByTestId('pomo-open').click();

  await page.getByTestId('pomo-settings').click();
  const top = page.getByTestId('pomo-preset-0');
  await top.fill('50');
  await top.press('Tab'); // commit (onChange fires on blur)

  await page.getByTestId('pomo-back').click(); // back to the dial
  await expect(page.getByTestId('pomo-slot-0')).toHaveText('50');

  await page.getByTestId('pomo-start').click();
  await expect(page.getByTestId('pomo-remaining')).toHaveText('50:00');
});
