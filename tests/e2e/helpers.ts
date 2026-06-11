import type { Page } from '@playwright/test';

/** Load the app fresh with demo data. */
export async function loadSeeded(page: Page): Promise<void> {
  await page.goto('./#seed');
  await page.waitForSelector('[data-testid="home-inbox"]');
}

/** Load the app fresh and empty. */
export async function loadEmpty(page: Page): Promise<void> {
  await page.goto('.');
  await page.waitForSelector('[data-testid="home-inbox"]');
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    void dbs;
  });
}

/** Synthesize a horizontal touch swipe on an element. */
export async function swipe(
  page: Page,
  selector: string,
  dx: number,
  opts: { steps?: number } = {},
): Promise<void> {
  const el = page.locator(selector).first();
  const box = (await el.boundingBox())!;
  const startX = box.x + box.width / 2 - dx / 4;
  const y = box.y + box.height / 2;
  const steps = opts.steps ?? 12;
  await page.touchscreen.tap; // ensure touch interface exists
  // Use CDP-free touch sequence via dispatchTouchEvent through page.touchscreen
  await page.evaluate(() => undefined);
  // Playwright has no multi-step touchscreen drag; emulate with pointer events
  // through the mouse API only works when hasTouch=false. Instead dispatch
  // PointerEvents directly:
  await el.dispatchEvent('pointerdown', {
    pointerId: 1,
    isPrimary: true,
    clientX: startX,
    clientY: y,
    bubbles: true,
    pointerType: 'touch',
  });
  for (let i = 1; i <= steps; i++) {
    await el.dispatchEvent('pointermove', {
      pointerId: 1,
      isPrimary: true,
      clientX: startX + (dx * i) / steps,
      clientY: y,
      bubbles: true,
      pointerType: 'touch',
    });
    await page.waitForTimeout(16);
  }
  await el.dispatchEvent('pointerup', {
    pointerId: 1,
    isPrimary: true,
    clientX: startX + dx,
    clientY: y,
    bubbles: true,
    pointerType: 'touch',
  });
}

/** Long-press then drag vertically (reorder), via dispatched pointer events. */
export async function longPressDrag(
  page: Page,
  selector: string,
  dy: number,
): Promise<void> {
  const el = page.locator(selector).first();
  const box = (await el.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await el.dispatchEvent('pointerdown', {
    pointerId: 2,
    isPrimary: true,
    clientX: x,
    clientY: y,
    bubbles: true,
    pointerType: 'touch',
  });
  await page.waitForTimeout(450); // > long-press duration
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await el.dispatchEvent('pointermove', {
      pointerId: 2,
      isPrimary: true,
      clientX: x,
      clientY: y + (dy * i) / steps,
      bubbles: true,
      pointerType: 'touch',
    });
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(100);
  await el.dispatchEvent('pointerup', {
    pointerId: 2,
    isPrimary: true,
    clientX: x,
    clientY: y + dy,
    bubbles: true,
    pointerType: 'touch',
  });
}
