import { expect, test } from '@playwright/test';

/** Regression test for the infinite-splash bug: if the JS bundle fails to
 *  load (e.g. a wedged service worker serving dead assets), index.html must
 *  detect it, clear service workers + caches, and reload into a working app
 *  instead of sitting on the splash forever. */
test('auto-recovers when the app bundle fails to load', async ({ page }) => {
  // Fail the bundle only for the first document; the recovery reload (second
  // navigation) gets it normally.
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  await page.route('**/assets/index-*.js', (route) => {
    if (navigations <= 1) return route.abort('failed');
    return route.continue();
  });

  await page.goto('.');
  // Splash is up, app cannot start — the capture-phase error handler should
  // kick in, reset storage and reload, after which the app must boot.
  await page.waitForSelector('[data-testid="home-inbox"]', { timeout: 15_000 });
  await expect(page.locator('#splash')).toHaveCount(0);
  // The one-shot recovery flag is re-armed after a successful boot
  expect(
    await page.evaluate(() => sessionStorage.getItem('clarity-recovered')),
  ).toBeNull();
});

test('shows reset instructions instead of reload-looping on repeated failure', async ({
  page,
}) => {
  await page.route('**/assets/index-*.js', (route) => route.abort('failed'));

  await page.goto('.');
  // First failure triggers the silent auto-recovery reload; the asset is
  // still blocked, so the second failure must surface the error screen.
  await page.waitForSelector('#err', { state: 'visible', timeout: 15_000 });
  await expect(page.locator('#err-msg')).toContainText('could not load');
  await expect(page.locator('#err-reset')).toBeVisible();
});
