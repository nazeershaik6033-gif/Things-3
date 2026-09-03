import { expect, test } from '@playwright/test';
import { currentScreen, loadSeeded } from './helpers';

/** My Routine end to end. Every source added here is a plain link, so nothing
 *  in this file reaches the network — feed fetching only runs for YouTube,
 *  Telegram and RSS sources, of which there are none. */

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw new Error(`Page error: ${err.message}`);
  });
  await loadSeeded(page);
});

/** Create a group and put one link source in it. */
async function addSource(page: import('@playwright/test').Page, group: string, name: string): Promise<void> {
  const screen = currentScreen(page);
  if (await screen.getByText(group, { exact: true }).count() === 0) {
    await page.getByTestId('routine-new-group').click();
    await page.getByTestId('routine-group-name').fill(group);
    await page.getByTestId('routine-group-save').click();
  }
  await page.getByTestId('routine-add-source').first().click();
  await page.getByTestId('routine-source-url').fill(`${name.toLowerCase()}.example.com`);
  await page.getByTestId('routine-source-name').fill(name);
  await page.getByTestId('routine-source-save').click();
  await expect(currentScreen(page).getByText(name, { exact: true })).toBeVisible();
}

test('my routine: build a group, tick a source, and see progress reach Home', async ({ page }) => {
  await page.getByTestId('home-myroutine').click();
  await expect(page).toHaveURL(/#\/myroutine$/);

  const screen = currentScreen(page);
  await expect(screen.getByText(/Group the apps, sites and channels/)).toBeVisible();

  // Morning and Night exist from the first visit.
  await expect(page.getByTestId('routine-window-morning')).toBeVisible();
  await expect(page.getByTestId('routine-window-night')).toBeVisible();

  await addSource(page, 'Social', 'Instagram');
  await addSource(page, 'Social', 'WhatsApp');

  // Two to do, none done.
  await expect(page.getByTestId('routine-focus-todo')).toContainText('2');
  await expect(page.getByTestId('routine-focus-completed')).toContainText('0');

  await screen.getByRole('button', { name: 'Mark complete' }).first().click();
  await expect(page.getByTestId('routine-focus-completed')).toContainText('1');
  await expect(page.getByTestId('routine-focus-todo')).toContainText('1');

  // Clearing the whole window banks the day.
  await screen.getByRole('button', { name: 'Mark complete' }).first().click();
  await expect(page.getByTestId('routine-toast')).toContainText('Routine complete');

  // Sheets render through a Portal, so they sit outside `.screen`.
  await page.getByTestId('routine-stats').click();
  await expect(page.getByText('Day streak')).toBeVisible();
  await expect(page.getByText('1/7')).toBeVisible();
});

test('my routine: filters and search narrow the list', async ({ page }) => {
  await page.getByTestId('home-myroutine').click();
  await addSource(page, 'Social', 'Instagram');
  await addSource(page, 'Social', 'WhatsApp');

  const screen = currentScreen(page);
  await screen.getByRole('button', { name: 'Mark complete' }).first().click();

  // Completed shows only what was ticked.
  await page.getByTestId('routine-focus-completed').click();
  await expect(screen.getByText('Instagram', { exact: true })).toBeVisible();
  await expect(screen.getByText('WhatsApp', { exact: true })).toHaveCount(0);

  // To-do shows the complement.
  await page.getByTestId('routine-focus-todo').click();
  await expect(screen.getByText('WhatsApp', { exact: true })).toBeVisible();
  await expect(screen.getByText('Instagram', { exact: true })).toHaveCount(0);

  await page.getByTestId('routine-focus-all').click();
  await page.getByTestId('routine-search').click();
  await page.getByTestId('routine-search-input').fill('insta');
  await expect(screen.getByText('Instagram', { exact: true })).toBeVisible();
  await expect(screen.getByText('WhatsApp', { exact: true })).toHaveCount(0);
});

test('my routine: ticks are scoped to their window', async ({ page }) => {
  await page.getByTestId('home-myroutine').click();
  await addSource(page, 'Social', 'Instagram');

  const screen = currentScreen(page);
  await screen.getByRole('button', { name: 'Mark complete' }).click();
  await expect(screen.getByRole('button', { name: 'Mark incomplete' })).toBeVisible();

  // The other window is a separate occurrence: the tick does not carry over.
  // Whichever window is live now, the other one is the one to switch to.
  const isMorningLive = await page.getByTestId('routine-window-morning').getAttribute('aria-pressed');
  const other = isMorningLive === 'true' ? 'routine-window-night' : 'routine-window-morning';
  await page.getByTestId(other).click();

  // An upcoming window says so; a past one shows its own, untouched checkbox.
  const upcoming = screen.getByText(/This window begins at/);
  if (await upcoming.count() === 0) {
    await expect(screen.getByRole('button', { name: 'Mark complete' })).toBeVisible();
  } else {
    await expect(upcoming).toBeVisible();
  }
});

test('my routine: windows can be added and removed', async ({ page }) => {
  await page.getByTestId('home-myroutine').click();
  await page.getByTestId('routine-edit-windows').click();
  await page.getByTestId('routine-add-window').click();

  await expect(page.getByText('Routine windows')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('routine-window-routine')).toBeVisible();
});

test('my routine: history is present and explains itself when empty', async ({ page }) => {
  await page.getByTestId('home-myroutine').click();
  await addSource(page, 'Social', 'Instagram');

  await page.getByTestId('routine-history-toggle').click();
  const history = page.getByTestId('routine-history');
  await expect(history).toBeVisible();
  await expect(history.getByText('Last 14 days')).toBeVisible();
  await expect(history.getByText(/saved here automatically for 14 days/)).toBeVisible();
});

test('my routine: a group can be deleted without losing its sources', async ({ page }) => {
  await page.getByTestId('home-myroutine').click();
  await addSource(page, 'Social', 'Instagram');

  const screen = currentScreen(page);
  await screen.getByRole('button', { name: 'Delete Social' }).click();
  // The source survives, in the implicit Other group.
  await expect(screen.getByText('Other', { exact: true })).toBeVisible();
  await expect(screen.getByText('Instagram', { exact: true })).toBeVisible();
});

test('habits keeps its own screen alongside My Routine', async ({ page }) => {
  await expect(page.getByTestId('home-routine')).toContainText('Habits');
  await expect(page.getByTestId('home-myroutine')).toContainText('My Routine');

  await page.getByTestId('home-routine').click();
  await expect(page).toHaveURL(/#\/routine$/);
  await expect(currentScreen(page).getByRole('heading', { name: 'Habits' })).toBeVisible();
});

test('my routine: opening a source ticks it off and returns you to the list', async ({ page }) => {
  await page.getByTestId('home-myroutine').click();
  await addSource(page, 'Daily Watch', 'Veritasium');

  const screen = currentScreen(page);
  // The link opens in a new tab; keep the routine page as the one under test.
  const popup = page.waitForEvent('popup').catch(() => null);
  await screen.getByText('Veritasium', { exact: true }).click();
  const opened = await popup;

  // It went somewhere real — never a blank tab, which is what an unnavigable
  // URL produces.
  if (opened) {
    expect(opened.url()).not.toBe('about:blank');
    await opened.close();
  }

  // Back on the routine page, the row is checked without a second tap.
  await expect(screen.getByRole('button', { name: 'Mark incomplete' })).toBeVisible();
  await expect(page.getByTestId('routine-focus-completed')).toContainText('1');

  // Still undoable.
  await screen.getByRole('button', { name: 'Mark incomplete' }).click();
  await expect(page.getByTestId('routine-focus-completed')).toContainText('0');
});

test('my routine: a channel entered by name still opens somewhere real', async ({ page }) => {
  await page.getByTestId('home-myroutine').click();
  await page.getByTestId('routine-new-group').click();
  await page.getByTestId('routine-group-name').fill('Daily Watch');
  await page.getByTestId('routine-group-save').click();

  // A display name, not a handle or URL — this is what used to be stored as
  // "https://Diary of a CEO" and opened a blank in-app browser.
  await page.getByTestId('routine-add-source').first().click();
  await page.getByTestId('routine-kind-youtube').click();
  await page.getByTestId('routine-source-url').fill('Diary of a CEO');
  await page.getByTestId('routine-source-name').fill('Diary of a CEO');
  await page.getByTestId('routine-source-save').click();

  const screen = currentScreen(page);
  await expect(screen.getByText('Diary of a CEO', { exact: true })).toBeVisible();

  const stored = await page.evaluate(async () => {
    const req = indexedDB.open('clarity');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return await new Promise<string>((resolve, reject) => {
      const tx = db.transaction('routineSources', 'readonly').objectStore('routineSources').getAll();
      tx.onsuccess = () => resolve((tx.result as Array<{ url: string }>).map((s) => s.url).join('|'));
      tx.onerror = () => reject(tx.error);
    });
  });

  // Whatever we stored, a browser must be able to navigate to it.
  expect(() => new URL(stored)).not.toThrow();
  expect(stored).not.toContain(' ');
  expect(stored).toContain('youtube.com');
});
