import { expect, test, type Page } from '@playwright/test';
import { loadSeeded } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw new Error(`Page error: ${err.message}`);
  });
  await loadSeeded(page);
});

async function markMit(page: Page, title: string, expectCount: number): Promise<void> {
  await page.locator('div.task-row', { hasText: title }).first().click();
  await expect(page.locator('[data-task-card]')).toBeVisible();
  await page.getByTestId('chip-mit').click();
  // The row moves into "Most Important" and the card stays open there
  await expect(page.getByTestId('mit-count')).toContainText(`${expectCount}/3 MITs`);
  await expect(page.locator('[data-task-card]')).toHaveCount(1);
  await expect(page.getByTestId('chip-mit')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('card-backdrop').click({ position: { x: 200, y: 40 } });
  await expect(page.locator('[data-task-card]')).toBeHidden();
}

test('pick MITs in Today: own section, ≤3 cap, energy chip', async ({ page }) => {
  await page.getByTestId('home-today').click();
  await expect(page.getByTestId('today-focus-bar')).toBeVisible();

  await markMit(page, 'Buy groceries', 1);
  await expect(page.getByTestId('mit-section')).toBeVisible();

  await markMit(page, 'Book flights', 2);
  await markMit(page, 'Finish landing page', 3);
  await expect(page.getByTestId('mit-count')).toContainText('3/3 MITs');

  // A fourth is refused with a gentle nudge
  await page.locator('div.task-row', { hasText: 'Call the dentist' }).click();
  await page.getByTestId('chip-mit').click();
  await expect(page.getByTestId('toast')).toContainText('3 MITs max');
  await page.getByTestId('chip-energy-low').click();
  await page.getByTestId('card-backdrop').click({ position: { x: 200, y: 40 } });
  await expect(page.locator('[data-testid="energy-chip-low"]')).toHaveCount(1);
  await expect(page.getByTestId('mit-count')).toContainText('3/3 MITs');
});

test('focus sprint: five steps, next action lands in the checklist', async ({ page }) => {
  await page.getByTestId('home-today').click();
  await markMit(page, 'Finish landing page', 1);
  await page.getByTestId('today-start-sprint').click();

  const sprint = page.getByTestId('focus-sprint');
  await expect(sprint.getByTestId('sprint-step-title')).toHaveText('Schedule the sprint');
  // MITs are offered first
  await expect(sprint.getByTestId('sprint-task-option').first()).toContainText('Finish landing page');
  await sprint.getByTestId('sprint-task-option').first().click();
  await sprint.getByTestId('sprint-duration-25').click();
  await sprint.getByTestId('sprint-next').click();

  await expect(sprint.getByTestId('sprint-step-title')).toHaveText('Define the next action');
  await sprint.getByTestId('sprint-next-action').fill('Rewrite the headline');
  await sprint.getByTestId('sprint-next').click();

  await expect(sprint.getByTestId('sprint-step-title')).toHaveText('Design your environment');
  await sprint.getByTestId('env-phone').click();
  await sprint.getByTestId('sprint-start').click();

  await expect(sprint.getByTestId('sprint-step-title')).toHaveText('Use a visible timer');
  await expect(sprint.getByTestId('sprint-clock')).toHaveText(/^2[45]:\d\d$/);
  // The clock ticks (not frozen at the starting value)
  await expect(sprint.getByTestId('sprint-clock')).toHaveText(/^24:5\d$/, { timeout: 4000 });

  // Minimize: the pill keeps the running sprint one tap away
  await sprint.getByTestId('sprint-close').click();
  await expect(page.getByTestId('sprint-pill')).toBeVisible();
  await page.getByTestId('sprint-pill').click();
  await expect(page.getByTestId('sprint-clock')).toBeVisible();

  // Stuck → reset card (incubation)
  await page.getByTestId('sprint-stuck').click();
  await expect(page.getByTestId('reset-card')).toContainText('Step away');
  await page.getByTestId('sprint-end').click();

  await expect(page.getByTestId('sprint-step-title')).toHaveText('Close the loop & recover');
  await expect(page.getByTestId('sprint-next-step')).toHaveValue('Rewrite the headline');
  await page.getByTestId('sprint-note').fill('Outlined the hero section');
  await page.getByTestId('sprint-next-step').fill('Test the contact form');
  await page.getByTestId('sprint-finish').click();
  await expect(page.getByTestId('toast')).toContainText('next action added to checklist');
  await expect(page.getByTestId('sprint-pill')).toBeHidden();

  // The next action is now the first checklist item (0 of 1 done on the row)
  const row = page.locator('div.task-row', { hasText: 'Finish landing page' });
  await expect(row).toContainText('0/1');
  await row.click();
  const values = await page.locator('[data-task-card] input, [data-task-card] textarea')
    .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(values).toContain('Test the contact form');
});

test('daily focus: Everest, flow auto-checks, energy, routine calendar', async ({ page, request }) => {
  await page.getByTestId('home-focus').click();
  await expect(page.getByTestId('daily-flow')).toBeVisible();

  // Everest persists
  await page.getByTestId('everest-input').fill('Build a calm, independent design studio');
  await page.getByTestId('daily-flow').click({ position: { x: 5, y: 5 } }); // blur
  await expect(page.getByTestId('everest-text')).toHaveText('Build a calm, independent design studio');

  // Manual step toggles; energy check-in auto-completes its step
  await page.getByTestId('flow-sleep-check').getByText('Slept 7h+? No phone in bed').click();
  await expect(page.getByTestId('flow-sleep-check')).toHaveAttribute('data-done', 'true');
  await expect(page.getByTestId('flow-energy')).toHaveAttribute('data-done', 'false');
  await page.getByTestId('energy-4').click();
  await expect(page.getByTestId('flow-energy')).toHaveAttribute('data-done', 'true');
  await expect(page.getByTestId('chronotype')).toContainText('Log your energy');

  // The user's routine: plan 07:30, sprints 09:00 + 19:00, LITs 15:00, shutdown 22:00, bed 23:00
  await expect(page.getByTestId('routine-plan')).toContainText('07:30');
  await expect(page.getByTestId('routine-sprint-evening')).toContainText('19:00');
  await expect(page.getByTestId('routine-shutdown')).toContainText('22:00');
  const link = page.getByTestId('add-routine-calendar');
  await expect(link).toHaveAttribute('href', /cal\/focus-routine-w0700-b2300-s45-e1\.ics$/);

  // The static calendar file is served as text/calendar with alarms
  const res = await request.get((await link.getAttribute('href'))!);
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toContain('text/calendar');
  const body = await res.text();
  expect(body).toContain('BEGIN:VALARM');
  expect(body).toContain('DTSTART:20260101T190000');

  // Changing a setting switches to the matching pre-built file
  await page.getByTestId('evening-off').click();
  await expect(page.getByTestId('routine-sprint-evening')).toHaveCount(0);
  await expect(link).toHaveAttribute('href', /e0\.ics$/);

  // Everest shows on Today
  await page.getByTestId('back-button').last().click();
  await page.getByTestId('home-today').click();
  await expect(page.getByTestId('today-focus-bar')).toContainText('design studio');
});
