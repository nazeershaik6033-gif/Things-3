import { expect, test } from '@playwright/test';
import { loadSeeded } from './helpers';

test('app works fully offline after first load (service worker)', async ({ page, context }) => {
  await loadSeeded(page);
  // Let the service worker install and precache everything
  await page.evaluate(async () => {
    await navigator.serviceWorker?.ready;
  });
  await page.waitForTimeout(1500);

  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('[data-testid="home-inbox"]', { timeout: 10_000 });

  // Data intact and the app is interactive offline
  await expect(page.getByTestId('home-inbox')).toContainText('2');
  await page.getByTestId('home-today').click();
  await expect(page.getByText('Buy groceries')).toBeVisible();

  // Writes work offline too
  await page.getByTestId('magic-plus').click();
  await page.getByPlaceholder('New To-Do').fill('Created offline');
  await page.getByTestId('quick-entry-save').click();
  await expect(page.getByTestId('quick-entry-save')).toBeHidden();
  await expect(page.getByText('Created offline')).toBeVisible();

  // And persist through an offline reload
  await page.reload();
  await page.waitForSelector('[data-testid="back-button"]', { timeout: 10_000 });
  await expect(page.getByText('Created offline')).toBeVisible();

  await context.setOffline(false);
});

test('data persists across full reload (fresh page, same storage)', async ({ page }) => {
  await loadSeeded(page);
  await page.getByTestId('home-inbox').click();
  await page.getByTestId('magic-plus').click();
  await page.getByPlaceholder('New To-Do').fill('Persistence check');
  await page.getByTestId('quick-entry-save').click();
  await expect(page.getByTestId('quick-entry-save')).toBeHidden();

  await page.goto('./'); // plain load, no reseed
  await page.waitForSelector('[data-testid="home-inbox"]');
  await page.getByTestId('home-inbox').click();
  await expect(page.getByText('Persistence check')).toBeVisible();
});
