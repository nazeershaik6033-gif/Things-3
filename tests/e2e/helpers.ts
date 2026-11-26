import type { Locator, Page } from '@playwright/test';

/** Load the app fresh with demo data. */
export async function loadSeeded(page: Page): Promise<void> {
  await page.goto('./#seed');
  await page.waitForSelector('[data-testid="home-inbox"]');
}

/** The topmost screen in the navigation stack. Prior screens stay mounted
 *  underneath (for the back-swipe animation), so scope text/role lookups here
 *  to avoid matching stale content on a screen further down the stack. */
export function currentScreen(page: Page) {
  return page.locator('.screen').last();
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

/** Which Home tab each Home test id lives on in the default layout. */
const HOME_TAB: Record<string, string> = {
  'today-banner': 'tasks', 'home-inbox': 'tasks', 'home-today': 'tasks', 'home-cando': 'tasks',
  'home-upcoming': 'tasks', 'home-prior': 'tasks', 'home-anytime': 'tasks', 'home-someday': 'tasks',
  'home-logbook': 'tasks', 'home-trash': 'tasks',
  'home-calendar': 'plan', 'home-calendar-row': 'plan', 'home-planner': 'plan', 'home-boards': 'plan',
  'home-note': 'plan', 'home-review': 'plan', 'home-review-due': 'plan', 'home-view': 'plan',
  'home-quote': 'focus', 'home-quote-text': 'focus', 'home-focus': 'focus', 'home-target': 'focus',
  'home-target-state': 'focus', 'home-routine': 'focus', 'home-routine-progress': 'focus',
  'home-beliefs': 'focus', 'home-beliefs-state': 'focus', 'home-myroutine': 'focus', 'home-myroutine-new': 'focus',
  'home-worklog': 'track', 'home-worklog-today': 'track', 'home-counters': 'track',
  'home-finish-day': 'track', 'home-finish-day-state': 'track',
};

/** A Home row (or badge) by test id. Home shows one tab at a time, so when
 *  the row isn't on screen this first switches to the tab that holds it. */
export async function homeRow(page: Page, testid: string): Promise<Locator> {
  const loc = page.getByTestId(testid);
  const tab = HOME_TAB[testid];
  if (tab && (await page.getByTestId(`home-page-${tab}`).count()) === 0) {
    await page.getByTestId(`home-tab-${tab}`).click();
    await page.getByTestId(`home-page-${tab}`).waitFor();
  }
  return loc;
}

/** Open Settings → one group's page (General, Planner & Time, …). */
export async function openSettings(
  page: Page,
  group: 'general' | 'planning' | 'integrations' | 'ai' | 'data',
): Promise<void> {
  await page.getByTestId('settings-button').click();
  await page.getByTestId(`settings-group-${group}`).click();
}
