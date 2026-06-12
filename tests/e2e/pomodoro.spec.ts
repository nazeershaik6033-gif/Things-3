import { expect, test } from '@playwright/test';
import { loadSeeded } from './helpers';

test('pomodoro timer: start, pause, skip phases, mini bar, stop', async ({ page }) => {
  await loadSeeded(page);
  await page.getByTestId('home-today').click();

  // Open from the Today header
  await page.getByTestId('pomo-open').click();
  await expect(page.getByTestId('pomo-overlay')).toBeVisible();
  await expect(page.getByTestId('pomo-phase')).toHaveText('Focus');
  await expect(page.getByTestId('pomo-remaining')).toHaveText('25:00');

  // Start → countdown begins
  await page.getByTestId('pomo-start').click();
  await expect(page.getByTestId('pomo-remaining')).not.toHaveText('25:00', { timeout: 5000 });

  // Pause freezes, Resume continues
  await page.getByTestId('pomo-pause').click();
  const frozen = await page.getByTestId('pomo-remaining').textContent();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('pomo-remaining')).toHaveText(frozen!);
  await page.getByTestId('pomo-start').click(); // Resume

  // Skip → Short Break
  await page.getByTestId('pomo-skip').click();
  await expect(page.getByTestId('pomo-phase')).toHaveText('Short Break');
  await expect(page.getByTestId('pomo-remaining')).toHaveText('5:00');

  // Close overlay → mini bar shows on other screens too
  await page.getByTestId('pomo-start').click();
  await page.getByTestId('pomo-close').click();
  await expect(page.getByTestId('pomo-minibar')).toBeVisible();
  await page.getByTestId('back-button').last().click(); // home
  await expect(page.getByTestId('pomo-minibar')).toBeVisible();

  // Tap mini bar to reopen, then stop ends the session
  await page.getByTestId('pomo-minibar').click();
  await page.getByTestId('pomo-stop').click();
  await page.getByTestId('pomo-close').click();
  await expect(page.getByTestId('pomo-minibar')).toBeHidden();
});

test('pomodoro settings change the focus length', async ({ page }) => {
  await loadSeeded(page);
  await page.getByTestId('settings-button').click();
  await page.getByTestId('pomo-workMin').selectOption('50');
  await page.getByTestId('back-button').last().click();
  await page.getByTestId('home-today').click();
  await page.getByTestId('pomo-open').click();
  await expect(page.getByTestId('pomo-remaining')).toHaveText('50:00');
});
