import { expect, test } from '@playwright/test';
import { loadSeeded } from './helpers';

/** Regression: the demo seed used to fire on any hash *containing* "seed",
 *  so a reload on a route like #/project/<id-with-seed-in-it> wiped the whole
 *  database. Data must survive every reload the app can land on. */

async function taskTitles(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(async () => {
    const req = indexedDB.open('clarity');
    const db = await new Promise<IDBDatabase>((res) => {
      req.onsuccess = () => res(req.result);
    });
    return new Promise<string[]>((res) => {
      const r = db.transaction('tasks', 'readonly').objectStore('tasks').getAll();
      r.onsuccess = () => res(r.result.map((t: { title: string }) => t.title));
    });
  });
}

test('a reload on a route whose id contains "seed" keeps the data', async ({ page }) => {
  await loadSeeded(page);
  await page.getByTestId('home-inbox').click();
  await page.getByTestId('magic-plus').click();
  await page.getByPlaceholder('New To-Do').fill('Precious to-do');
  await page.getByTestId('quick-entry-save').click();
  await expect(page.getByText('Precious to-do')).toBeVisible();

  await page.goto('./#/project/AbseedXyz');
  await page.reload();
  await page.waitForSelector('[data-testid="home-inbox"]');
  expect(await taskTitles(page)).toContain('Precious to-do');
});

test('completed to-dos stay in the Logbook across a reload', async ({ page }) => {
  await loadSeeded(page);
  await page.getByTestId('home-inbox').click();
  await page.getByTestId('magic-plus').click();
  await page.getByPlaceholder('New To-Do').fill('Logged to-do');
  await page.getByTestId('quick-entry-save').click();
  await page
    .locator('div.task-row', { hasText: 'Logged to-do' })
    .getByRole('button', { name: 'Mark complete' })
    .click();
  await expect(page.getByText('Logged to-do')).toBeHidden({ timeout: 5000 });

  await page.goto('./');
  await page.waitForSelector('[data-testid="home-logbook"]');
  await page.getByTestId('home-logbook').click();
  await expect(page.getByText('Logged to-do')).toBeVisible();
});

test('re-seeding over existing data asks first, and declining keeps the data', async ({ page }) => {
  await loadSeeded(page);
  await page.getByTestId('home-inbox').click();
  await page.getByTestId('magic-plus').click();
  await page.getByPlaceholder('New To-Do').fill('Do not delete me');
  await page.getByTestId('quick-entry-save').click();
  await expect(page.getByText('Do not delete me')).toBeVisible();

  let asked = false;
  page.on('dialog', (d) => {
    asked = true;
    void d.dismiss();
  });
  await page.goto('./#seed');
  await page.reload();
  await page.waitForSelector('[data-testid="home-inbox"]');
  expect(asked).toBe(true);
  expect(await taskTitles(page)).toContain('Do not delete me');

  // The trigger is stripped from the URL, so a further reload can't re-fire it.
  expect(new URL(page.url()).hash).toBe('#/');
});
