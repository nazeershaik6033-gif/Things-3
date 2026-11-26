import { expect, test, type Page } from '@playwright/test';
import { currentScreen, loadSeeded, homeRow } from './helpers';

async function quickAdd(page: Page, title: string): Promise<void> {
  await page.getByTestId('magic-plus').click();
  await page.locator('[data-quick-entry] textarea').first().fill(title);
  await page.getByTestId('quick-entry-save').click();
}

async function openRow(page: Page, title: string): Promise<void> {
  await currentScreen(page).locator('.task-row', { hasText: title }).first().click();
}

async function closeCard(page: Page): Promise<void> {
  await page.getByTestId('card-backdrop').click({ position: { x: 20, y: 20 } });
}

test('stages, waits-for, the lock, Can Do Now and the unlock nudge', async ({ page }) => {
  await loadSeeded(page);
  await page.goto('./#/anytime');
  await quickAdd(page, 'Write tests');
  await quickAdd(page, 'Deploy app');
  await openRow(page, 'Deploy app');
  await page.getByTestId('chip-waits').click();
  await page.getByTestId('waits-search').fill('Write tests');
  await page.getByTestId('waits-option').first().click();
  await closeCard(page);
  await expect(currentScreen(page).locator('.task-row', { hasText: 'Deploy app' }).getByTestId('row-locked')).toBeVisible();

  await openRow(page, 'Write tests');
  await page.getByTestId('stage-doing').click();
  await closeCard(page);
  await expect(currentScreen(page).locator('.task-row', { hasText: 'Write tests' }).getByTestId('row-stage-doing')).toBeVisible();

  await page.goto('./#/cando');
  const cando = currentScreen(page);
  await expect(cando.locator('.task-row', { hasText: 'Write tests' })).toBeVisible();
  await expect(cando.locator('.task-row', { hasText: 'Deploy app' })).toHaveCount(0);

  // Finishing the blocker frees it
  await cando.locator('.task-row', { hasText: 'Write tests' }).locator('[role="checkbox"], button').first().click();
  await expect(page.getByTestId('toast-text')).toHaveText('🔓 Ready now: Deploy app');
});

test('Kanban: hold a card and drop it in another column', async ({ page }) => {
  await loadSeeded(page);
  await page.goto('./#/today');
  await page.click('[data-testid="today-view-board"]');
  const screen = currentScreen(page);
  await expect(screen.getByTestId('kanban-col')).toHaveCount(3);
  const card = screen.getByTestId('kanban-card').first();
  const title = await card.getAttribute('data-title');
  const from = (await card.boundingBox())!;
  // Drop on the "In Progress" column, scrolled into view
  // The next column peeks in from the right on a phone: drop on its visible edge
  const to = (await screen.locator('[data-kb-col="doing"]').boundingBox())!;
  const fromNow = from;
  await page.evaluate(async ({ a, b }) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const el = document.elementFromPoint(a.x, a.y)!;
    const ev = (type: string, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, { pointerId: 9, isPrimary: true, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
    ev('pointerdown', a.x, a.y);
    await sleep(450);
    for (let i = 1; i <= 8; i++) {
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, isPrimary: true, pointerType: 'touch', clientX: a.x + ((b.x - a.x) * i) / 8, clientY: a.y + ((b.y - a.y) * i) / 8 }));
      await sleep(16);
    }
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, isPrimary: true, pointerType: 'touch', clientX: b.x, clientY: b.y }));
  }, { a: { x: fromNow.x + 60, y: fromNow.y + 12 }, b: { x: Math.min(to.x + 24, 380), y: to.y + 40 } });
  await expect(page.getByTestId('toast-text')).toHaveText('Moved to In Progress');
  await expect(screen.locator('[data-kb-col="doing"]').locator(`[data-title="${title}"]`)).toBeVisible();
});

test('Daily Note saves, and the Weekly Review walks the steps', async ({ page }) => {
  await loadSeeded(page);
  await (await homeRow(page, 'home-note')).click();
  const note = page.getByTestId('note-text');
  await note.click();
  await note.fill('## Plan\nShip phase 4');
  await note.blur();
  await page.reload();
  await expect(currentScreen(page).getByTestId('note-view')).toContainText('Ship phase 4');

  await page.goto('./');
  await expect((await homeRow(page, 'home-review-due'))).toBeVisible();
  await (await homeRow(page, 'home-review')).click();
  await expect(currentScreen(page).getByText('Celebrate what got done')).toBeVisible();
  await page.getByTestId('review-finish').click();
  await expect((await homeRow(page, 'home-review-due'))).toHaveCount(0);
});

test('a saved view filters to-dos', async ({ page }) => {
  await loadSeeded(page);
  await page.getByTestId('home-add').click();
  await page.getByText('New View (filtered list)').click();
  await page.getByTestId('view-title').fill('Due soon');
  await page.getByTestId('view-due-7').click();
  await page.getByTestId('view-save').click();
  const screen = currentScreen(page);
  await expect(screen.locator('h1')).toHaveText('Due soon');
  await page.goto('./');
  await expect((await homeRow(page, 'home-view'))).toHaveText(/Due soon/);
});

test('a project saved as a template starts a new project', async ({ page }) => {
  await loadSeeded(page);
  await page.getByTestId('home-add').click();
  await page.getByText('New Project').click();
  await page.getByTestId('project-title').fill('Launch plan');
  await quickAdd(page, 'Draft announcement');
  await quickAdd(page, 'Publish');
  await page.getByTestId('project-menu').click();
  await page.getByText('Save as Template').click();
  await page.goto('./');
  await page.getByTestId('home-add').click();
  await page.getByText('Project from Template').click();
  await page.getByTestId('template-use').first().click();
  const screen = currentScreen(page);
  await expect(screen.getByTestId('project-title')).toHaveValue('Launch plan');
  await expect(screen.locator('.task-row', { hasText: 'Draft announcement' })).toBeVisible();
  await expect(screen.locator('.task-row', { hasText: 'Publish' })).toBeVisible();
});

test('multi-select moves several to-dos to tomorrow, and undo brings them back', async ({ page }) => {
  await loadSeeded(page);
  await page.goto('./#/today');
  await page.click('[data-testid="today-view-list"]');
  const screen = currentScreen(page);
  const before = await screen.locator('.task-row').count();
  await screen.getByTestId('select-start').click();
  await screen.locator('.task-row').nth(0).click();
  await screen.locator('.task-row').nth(1).click();
  await expect(page.getByTestId('selection-count')).toHaveText('2 selected');
  await page.getByTestId('sel-tomorrow').click();
  await expect(page.getByTestId('toast-text')).toHaveText('Moved to Tomorrow · 2');
  await expect(screen.locator('.task-row')).toHaveCount(before - 2);
  await page.getByTestId('toast-action').click();
  await expect(screen.locator('.task-row')).toHaveCount(before);
});
