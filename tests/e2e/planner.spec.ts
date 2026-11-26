import { expect, test, type Page } from '@playwright/test';
import { currentScreen, loadSeeded, homeRow } from './helpers';

/** Scroll the current screen so `min` (minutes since midnight) sits just
 *  under the timeline's pinned header. */
async function scrollTo(page: Page, min: number): Promise<void> {
  await page.evaluate((m) => {
    const sc = [...document.querySelectorAll<HTMLElement>('.screen-scroll')].pop()!;
    const col = sc.querySelector('[data-testid="tl-col"]')!;
    const st = sc.querySelector<HTMLElement>('[data-testid="tl-sticky"]')!;
    sc.scrollTop += col.getBoundingClientRect().top - sc.getBoundingClientRect().top + m * 1.2 - st.offsetHeight;
  }, min);
}

/** Touch press-and-hold, then drag, as real PointerEvents. */
async function holdDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, hold = 450): Promise<void> {
  await page.evaluate(async ({ from, to, hold }) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const el = document.elementFromPoint(from.x, from.y)!;
    const ev = (type: string, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, {
      pointerId: 7, isPrimary: true, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true,
    }));
    ev('pointerdown', from.x, from.y);
    await sleep(hold);
    for (let i = 1; i <= 10; i++) {
      ev('pointermove', from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10);
      await sleep(16);
    }
    ev('pointerup', to.x, to.y);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: to.x, clientY: to.y }));
  }, { from, to, hold });
}

const blockStarts = (page: Page) =>
  currentScreen(page).locator('[data-kind="task"]').evaluateAll((els) =>
    els.map((e) => `${(e as HTMLElement).dataset.title}@${Math.round(parseFloat((e as HTMLElement).style.top) / 1.2)}`));

test('Today timeline: place from the tray, move, undo, push the rest', async ({ page }) => {
  await loadSeeded(page);
  await (await homeRow(page, 'home-today')).click();
  await page.click('[data-testid="today-view-timeline"]');
  const screen = currentScreen(page);
  await expect(screen.getByTestId('timeline')).toBeVisible();
  await expect(screen.getByTestId('tl-now')).toBeVisible();

  // Tap a tray chip, then tap 9:00 on the grid
  const first = await screen.getByTestId('tl-chip').first().getAttribute('data-tl-chip');
  await screen.getByTestId('tl-chip').first().click();
  await scrollTo(page, 8 * 60);
  const col = (await screen.getByTestId('tl-col').first().boundingBox())!;
  await page.mouse.click(col.x + col.width / 2, col.y + 9 * 60 * 1.2 + 18);
  await expect(page.getByTestId('toast-text')).toHaveText('Scheduled 9 AM');
  await expect(screen.locator(`[data-tl-block="task:${first}"]`)).toBeVisible();

  // Hold and drag it an hour later
  const b = (await screen.locator(`[data-tl-block="task:${first}"]`).boundingBox())!;
  await holdDrag(page, { x: b.x + 120, y: b.y + 10 }, { x: b.x + 120, y: b.y + 10 + 72 });
  await expect(page.getByTestId('toast-text')).toHaveText('Moved to 10 AM');
  await page.getByTestId('toast-action').click();
  await expect(page.getByTestId('toast-text')).toHaveText('Undid move');
  await expect.poll(() => blockStarts(page)).toEqual([expect.stringMatching(/@540$/)]);

  // A second block right after it; with Push rest on, growing the first pushes it
  await screen.getByTestId('tl-chip').first().click();
  await page.mouse.click(col.x + col.width / 2, col.y + 9.5 * 60 * 1.2 + 18);
  await expect(page.getByTestId('toast-text')).toHaveText('Scheduled 9:30 AM');
  await screen.getByTestId('tl-push').click();
  const b2 = (await screen.locator(`[data-tl-block="task:${first}"]`).boundingBox())!;
  await holdDrag(page, { x: b2.x + 120, y: b2.y + 10 }, { x: b2.x + 120, y: b2.y + 10 }); // select
  const h = (await screen.getByTestId('tl-handle-end').boundingBox())!;
  await holdDrag(page, { x: h.x + h.width / 2, y: h.y + h.height / 2 }, { x: h.x + h.width / 2, y: h.y + h.height / 2 + 36 }, 0);
  await expect(page.getByTestId('toast-text')).toHaveText('9 – 10 AM · pushed 1 more');
  await expect.poll(() => blockStarts(page)).toEqual([expect.stringMatching(/@540$/), expect.stringMatching(/@600$/)]);

  // Tapping a block opens its card, which shows the time
  await screen.locator(`[data-tl-block="task:${first}"]`).click();
  await expect(page.getByTestId('tl-task-sheet').getByTestId('chip-time')).toHaveText('9 – 10 AM');
});

test('Planner: days, and a to-do timed from its card shows in the list', async ({ page }) => {
  await loadSeeded(page);
  await (await homeRow(page, 'home-planner')).click();
  const screen = currentScreen(page);
  await expect(screen.getByTestId('tl-col')).toHaveCount(3); // phone default
  await screen.getByTestId('planner-days-7').click();
  await expect(screen.getByTestId('tl-col')).toHaveCount(7);
  await screen.getByTestId('planner-days-1').click();
  await expect(screen.getByTestId('tl-col')).toHaveCount(1);

  // Set a time from the card in the Today list
  await page.goto('./#/today');
  await page.click('[data-testid="today-view-list"]');
  await currentScreen(page).locator('.task-row').first().click();
  await page.getByTestId('chip-time').click();
  await page.getByTestId('time-start').fill('14:00');
  await page.getByTestId('time-len-60').click();
  await page.getByTestId('time-save').click();
  await page.getByTestId('card-backdrop').click({ position: { x: 20, y: 20 } });
  await expect(currentScreen(page).getByTestId('row-time').first()).toHaveText('2 – 3 PM');
});
