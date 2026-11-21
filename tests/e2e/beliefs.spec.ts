import { expect, test } from '@playwright/test';
import { currentScreen, loadSeeded } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw new Error(`Page error: ${err.message}`);
  });
  await loadSeeded(page);
});

async function addBelief(page: import('@playwright/test').Page, text: string): Promise<void> {
  await page.getByTestId('beliefs-edit').click();
  await page.getByTestId('belief-new').fill(text);
  await page.getByTestId('belief-new').press('Enter');
  await page.getByTestId('beliefs-edit').click(); // leave edit mode
}

test('beliefs: the board starts empty and never writes a belief for you', async ({ page }) => {
  await page.getByTestId('home-beliefs').click();
  await expect(page).toHaveURL(/#\/beliefs$/);
  const screen = currentScreen(page);
  await expect(screen.getByText(/A belief here is a sentence you are deliberately installing/)).toBeVisible();
  await expect(page.getByTestId('belief-card')).toHaveCount(0);
  await expect(page.getByTestId('beliefs-hero')).toHaveCount(0);
});

test('beliefs: say it out loud, score it, and the conviction lands on the board', async ({ page }) => {
  await page.getByTestId('home-beliefs').click();
  await addBelief(page, 'I finish what I start.');
  await addBelief(page, 'Rest is part of the work.');
  await expect(page.getByTestId('belief-card')).toHaveCount(2);
  await expect(page.getByTestId('beliefs-hero')).toContainText('Not spoken yet today');

  await page.getByTestId('beliefs-start').click();
  await expect(page.getByTestId('session-position')).toHaveText('1 of 2');
  await expect(page.getByTestId('session-belief')).toHaveText('I finish what I start.');

  await page.getByTestId('conviction-7').click();
  await expect(page.getByTestId('session-score-label')).toContainText('mostly believe');

  await page.getByTestId('session-next').click();
  await expect(page.getByTestId('session-position')).toHaveText('2 of 2');
  await expect(page.getByTestId('session-belief')).toHaveText('Rest is part of the work.');

  await page.getByTestId('conviction-5').click();
  await page.getByTestId('session-next').click();

  // The closing card reports the session honestly
  await expect(page.getByTestId('session-summary')).toContainText('2 of 2 rated');
  await expect(page.getByTestId('session-summary')).toContainText('6.0');
  await page.getByTestId('session-next').click();

  // …and the board and Home agree with it
  await expect(page.getByTestId('beliefs-hero')).toContainText('All spoken today');
  await expect(page.getByTestId('belief-score').first()).toHaveText('7/10');
  await page.getByTestId('back-button').last().click();
  await expect(page.getByTestId('home-beliefs-state')).toContainText('2/2');
});

test('beliefs: the previous score is offered as an outline, never pre-picked', async ({ page }) => {
  await page.getByTestId('home-beliefs').click();
  await addBelief(page, 'My focus is a skill.');

  await page.getByTestId('beliefs-start').click();
  await page.getByTestId('conviction-9').click();
  await page.getByTestId('session-close').click();

  // Re-opening the same day shows the score that was recorded, not a blank
  await page.getByTestId('beliefs-start').click();
  await expect(page.getByTestId('session-score-label')).toContainText('I believe it');
  await page.getByTestId('session-close').click();
  await expect(page.getByTestId('belief-score').first()).toHaveText('9/10');
});

test('beliefs: evidence typed in the session is kept against the belief', async ({ page }) => {
  await page.getByTestId('home-beliefs').click();
  await addBelief(page, 'I keep my word to myself.');

  await page.getByTestId('beliefs-start').click();
  await page.getByTestId('conviction-6').click();
  await page.getByTestId('session-evidence').fill('Trained before work even though I did not feel like it.');
  await page.getByTestId('session-next').click();
  await page.getByTestId('session-next').click();

  // The detail sheet renders in a portal, so it sits outside the screen stack
  await page.getByTestId('belief-card').first().click();
  await expect(page.getByText('Evidence (1)')).toBeVisible();
  await expect(
    page.getByText('Trained before work even though I did not feel like it.'),
  ).toBeVisible();
});

test('beliefs: retiring keeps the history, deleting throws it away', async ({ page }) => {
  await page.getByTestId('home-beliefs').click();
  await addBelief(page, 'Keep me.');
  await addBelief(page, 'Delete me.');

  await page.getByTestId('beliefs-edit').click();
  await page.getByRole('button', { name: 'Retire Keep me.' }).click();
  await expect(currentScreen(page).getByText('Retired')).toBeVisible();


  await page.getByRole('button', { name: 'Delete Delete me.' }).click();
  await page.getByTestId('beliefs-edit').click();
  await expect(page.getByTestId('belief-card')).toHaveCount(0);
});

test('beliefs: a rating survives a reload', async ({ page }) => {
  await page.getByTestId('home-beliefs').click();
  await addBelief(page, 'I am the kind of person who trains daily.');
  await page.getByTestId('beliefs-start').click();
  await page.getByTestId('conviction-8').click();
  await page.getByTestId('session-close').click();

  await page.reload();
  await expect(page).toHaveURL(/#\/beliefs$/);
  await expect(page.getByTestId('belief-score').first()).toHaveText('8/10');
});

test('quotes: Home carries today’s quote and it opens with its attribution', async ({ page }) => {
  const card = page.getByTestId('home-quote');
  await expect(card).toBeVisible();
  const text = (await page.getByTestId('home-quote-text').textContent())!.trim();
  expect(text.length).toBeGreaterThan(10);

  await card.click();
  await expect(page.getByTestId('quote-sheet-text')).toContainText(text.slice(0, 30));
  await expect(page.getByTestId('quote-deeper')).toBeVisible();

  // Keeping a quote sticks
  await page.getByTestId('quote-save').click();
  await expect(page.getByTestId('quote-save')).toContainText('Kept');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByTestId('home-quote').click();
  await expect(page.getByTestId('quote-save')).toContainText('Kept');
});

test('quotes: the same day shows the same quote, offline', async ({ page, context }) => {
  const before = (await page.getByTestId('home-quote-text').textContent())!.trim();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('home-quote-text')).toHaveText(before);
  await context.setOffline(false);
});
