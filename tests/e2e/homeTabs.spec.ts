import { expect, test } from '@playwright/test';
import { currentScreen, loadSeeded } from './helpers';

test('home is split into tabs: Tasks, Plan, Focus & Habits, Track', async ({ page }) => {
  await loadSeeded(page);
  const bar = page.getByTestId('home-tabbar');
  await expect(bar.getByRole('tab')).toHaveCount(4);
  await expect(page.getByTestId('home-title')).toHaveText('Tasks');
  await expect(page.getByTestId('home-tab-tasks')).toHaveAttribute('aria-selected', 'true');

  await page.getByTestId('home-tab-plan').click();
  await expect(page.getByTestId('home-title')).toHaveText('Plan');
  await expect(page.getByTestId('home-planner')).toBeVisible();
  await expect(page.getByTestId('home-calendar-row')).toBeVisible();
  await expect(page.getByTestId('home-inbox')).toHaveCount(0);

  await page.getByTestId('home-tab-focus').click();
  await expect(page.getByTestId('home-title')).toHaveText('Focus & Habits');
  await expect(page.getByTestId('home-routine')).toBeVisible();

  await page.getByTestId('home-tab-track').click();
  await expect(page.getByTestId('home-worklog')).toBeVisible();

  // Opening a destination and coming back keeps the tab
  await page.getByTestId('home-counters').click();
  await page.getByTestId('back-button').last().click();
  await expect(page.getByTestId('home-tab-track')).toHaveAttribute('aria-selected', 'true');

  // The tab is remembered across a reload
  await page.reload();
  await expect(page.getByTestId('home-title')).toHaveText('Track');
});

test('the + spins into a menu of things to create', async ({ page }) => {
  await loadSeeded(page);
  const plus = page.getByTestId('home-add');
  await expect(plus).toHaveAttribute('aria-expanded', 'false');
  await plus.click();
  await expect(plus).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('add-menu')).toBeVisible();
  await plus.click();
  await expect(page.getByTestId('add-menu')).toHaveCount(0);

  await plus.click();
  await page.getByTestId('add-todo').click();
  await expect(page.getByTestId('add-menu')).toHaveCount(0);
  await page.keyboard.type('Water the plants');
  await page.getByTestId('quick-entry-save').click();
  await page.getByTestId('home-inbox').click();
  await expect(currentScreen(page).getByText('Water the plants')).toBeVisible();
});

test('move a row to another tab with a long-press, and it stays there', async ({ page }) => {
  await loadSeeded(page);
  await page.getByTestId('home-tab-plan').click();
  // Right-click stands in for the touch long-press
  await page.getByTestId('home-note').click({ button: 'right' });
  await expect(page.getByTestId('move-sheet')).toBeVisible();
  await page.getByTestId('move-to-tasks').click();
  await expect(page.getByTestId('home-note')).toHaveCount(0);

  await page.getByTestId('home-tab-tasks').click();
  await expect(page.getByTestId('home-note')).toBeVisible();

  await page.reload();
  await page.getByTestId('home-tab-tasks').click();
  await expect(page.getByTestId('home-note')).toBeVisible();
});

test('move a row into a brand-new category from the Move sheet', async ({ page }) => {
  await loadSeeded(page);
  await page.getByTestId('home-tab-focus').click();
  await page.getByTestId('home-beliefs').click({ button: 'right' });
  await page.getByTestId('move-new-category').click();
  await page.getByTestId('move-new-category-name').fill('Mind');
  await page.getByTestId('move-new-category-create').click();
  await expect(page.getByTestId('home-tabbar').getByRole('tab')).toHaveCount(5);
  await page.getByRole('tab', { name: 'Mind' }).click();
  await expect(page.getByTestId('home-title')).toHaveText('Mind');
  await expect(page.getByTestId('home-beliefs')).toBeVisible();
});

test('edit a tab: rename, reorder, hide and show, add and remove tabs', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await loadSeeded(page);
  await page.getByTestId('home-tab-track').click();
  await page.getByTestId('home-edit').click();
  await expect(page.getByTestId('home-editor')).toBeVisible();

  await page.getByTestId('category-title-input').fill('Review');
  await page.getByTestId('category-title-input').press('Enter');
  await expect(page.getByTestId('home-tab-track')).toHaveAccessibleName('Review');

  await page.getByTestId('edit-down-worklog').click();
  await page.getByTestId('edit-hide-finishDay').click();
  await expect(page.getByTestId('edit-item-finishDay')).toHaveCount(0);

  await page.getByTestId('home-edit-done').click();
  const rows = page.getByTestId('home-page-track').locator('button[data-testid^="home-"]');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute('data-testid', 'home-counters');
  await expect(page.getByTestId('home-finish-day')).toHaveCount(0);

  await page.getByTestId('home-edit').click();
  await page.getByTestId('edit-show-finishDay').click();
  await page.getByTestId('new-tab-name').fill('Later');
  await page.getByTestId('new-tab-create').click();
  await expect(page.getByTestId('home-tabbar').getByRole('tab')).toHaveCount(5);
  // The new tab opens in edit mode, empty
  await expect(page.getByTestId('category-title-input')).toHaveValue('Later');
  await page.getByTestId('tab-delete').click();
  await expect(page.getByTestId('home-tabbar').getByRole('tab')).toHaveCount(4);
  await page.getByTestId('home-edit-done').click();

  await page.getByTestId('home-tab-track').click();
  await expect(page.getByTestId('home-finish-day')).toBeVisible();

  // Reset puts everything back
  await page.getByTestId('home-edit').click();
  await page.getByTestId('home-reset').click();
  await page.getByTestId('home-edit').click();
  await page.getByTestId('home-tab-track').click();
  await expect(page.getByTestId('home-tab-track')).toHaveAccessibleName('Track');
});

test('settings open on groups, and search finds a section', async ({ page }) => {
  await loadSeeded(page);
  await page.getByTestId('settings-button').click();
  for (const g of ['general', 'planning', 'integrations', 'ai', 'data']) {
    await expect(page.getByTestId(`settings-group-${g}`)).toBeVisible();
  }
  await page.getByTestId('settings-search').fill('ics');
  await page.getByTestId('settings-result-google-calendar').click();
  await expect(currentScreen(page).getByText('Integrations', { exact: true })).toBeVisible();
  await expect(page.getByTestId('ics-url')).toBeVisible();
  await page.getByTestId('back-button').last().click();

  await page.getByTestId('settings-search').fill('');
  await page.getByTestId('settings-group-data').click();
  await expect(page.getByTestId('export-data')).toBeVisible();
  await expect(page.getByTestId('settings-section-appearance')).toHaveCount(0);
});

test('motion: rich, subtle and off are applied to the page and remembered', async ({ page }) => {
  await loadSeeded(page);
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'rich');
  await page.getByTestId('settings-button').click();
  await page.getByTestId('settings-group-general').click();
  await expect(page.getByTestId('motion-auto')).toHaveAttribute('aria-checked', 'true');

  await page.getByTestId('motion-subtle').click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'subtle');
  await page.getByTestId('motion-off').click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off');
  await expect(page.getByTestId('motion-hint')).toContainText('No animation');

  await page.goto(page.url().replace(/#.*/, ''));
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off');
});

test('motion: Auto follows the system Reduce Motion setting', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loadSeeded(page);
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'rich');
});

test('confetti when the last habit of the day is ticked', async ({ page }) => {
  await loadSeeded(page);
  await page.getByTestId('home-tab-focus').click();
  await page.getByTestId('home-routine').click();
  await page.getByTestId('routine-starter').click();
  const screen = currentScreen(page);
  const boxes = screen.getByRole('button', { name: 'Mark complete' });
  // Assert between clicks: the locator re-resolves by aria-label
  for (let done = 1; done < 8; done++) {
    await boxes.first().click();
    await expect(page.getByTestId('routine-hero')).toContainText(`${done}/8`);
  }
  await expect(page.locator('.confetti')).toHaveCount(0);
  await boxes.first().click();
  await expect(page.getByTestId('routine-hero')).toContainText('8/8');
  await expect(page.locator('.confetti').first()).toBeAttached();
});
