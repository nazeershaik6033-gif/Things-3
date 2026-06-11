import { expect, test } from '@playwright/test';
import { loadSeeded } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw new Error(`Page error: ${err.message}`);
  });
  await loadSeeded(page);
});

test('home shows lists, counts, areas and projects', async ({ page }) => {
  await expect(page.getByTestId('home-inbox')).toContainText('Inbox');
  await expect(page.getByTestId('home-inbox')).toContainText('2'); // seeded inbox count
  await expect(page.getByTestId('home-today')).toContainText('Today');
  await expect(page.getByText('Family')).toBeVisible();
  await expect(page.getByText('Vacation in Rome')).toBeVisible();
  await expect(page.getByText('Website Launch')).toBeVisible();
});

test('navigate into every built-in list and back', async ({ page }) => {
  for (const list of ['inbox', 'today', 'upcoming', 'anytime', 'someday', 'logbook', 'trash']) {
    await page.getByTestId(`home-${list}`).click();
    await expect(page).toHaveURL(new RegExp(`#/${list}$`));
    await expect(page.locator('.screen').last()).toBeVisible();
    await page.getByTestId('back-button').last().click();
    await expect(page).toHaveURL(/#\/$/);
    await page.waitForTimeout(400); // pop animation
  }
});

test('today shows seeded tasks in day and evening sections', async ({ page }) => {
  await page.getByTestId('home-today').click();
  await expect(page.getByText('Buy groceries')).toBeVisible();
  await expect(page.getByText('Book flights')).toBeVisible();
  await expect(page.getByText('This Evening')).toBeVisible();
  await expect(page.getByText('Water the plants')).toBeVisible();
  // Overdue deadline appears in Today with a red flag
  await expect(page.getByText('Call the dentist')).toBeVisible();
  await expect(page.getByText('yesterday')).toBeVisible();
});

test('project screen shows headings, progress and logged toggle', async ({ page }) => {
  await page.getByText('Vacation in Rome').click();
  await expect(page.getByTestId('project-title')).toHaveValue('Vacation in Rome');
  await expect(page.getByPlaceholder('Heading')).toHaveValue('Before we go');
  await expect(page.getByText('Book flights')).toBeVisible();
  // Completed-today task stays visible inline (struck through)
  await expect(page.getByText('Make packing list')).toBeVisible();
});

test('upcoming groups by day and month', async ({ page }) => {
  await page.getByTestId('home-upcoming').click();
  await expect(page.getByText('Tomorrow')).toBeVisible();
  await expect(page.getByText('Set up analytics')).toBeVisible();
  await expect(page.getByText('Plan weekend hike')).toBeVisible();
});

test('deep link to a list works after reload', async ({ page }) => {
  await page.getByTestId('home-today').click();
  await page.reload();
  await expect(page.getByText('Buy groceries')).toBeVisible();
  // back still goes home
  await page.getByTestId('back-button').last().click();
  await expect(page.getByTestId('home-inbox')).toBeVisible();
});

test('dark mode toggle persists across reload', async ({ page }) => {
  await page.getByTestId('settings-button').click();
  await page.getByTestId('theme-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await page.waitForSelector('[data-route]');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
