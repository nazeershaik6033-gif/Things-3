import { expect, test, type Page } from '@playwright/test';
import { loadSeeded } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw new Error(`Page error: ${err.message}`);
  });
  await loadSeeded(page);
});

const pad = (n: number) => String(n).padStart(2, '0');
function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function openFocus(page: Page): Promise<void> {
  await page.getByTestId('home-focus').click();
  await expect(page.getByTestId('health-card')).toBeVisible();
}

test("manual check-in reproduces the Watch's night and adapts the day", async ({ page }) => {
  await openFocus(page);
  await expect(page.getByTestId('no-sleep')).toBeVisible();

  await page.getByTestId('health-manual').click();
  await page.getByTestId('manual-hours').fill('5');
  await page.getByTestId('manual-mins').fill('28');
  await page.getByTestId('manual-onset').fill('00:39');
  await page.getByTestId('manual-wakeups').fill('3');
  await page.getByTestId('manual-awake').fill('5');
  await page.getByTestId('manual-move').fill('337');
  await page.getByTestId('manual-exercise').fill('30');
  await page.getByTestId('manual-stand').fill('13');
  await page.getByTestId('manual-save').click();

  // Same 54 / Low as Apple's Sleep Score for this night
  await expect(page.getByTestId('sleep-score')).toHaveText('54');
  await expect(page.getByTestId('health-card')).toContainText('Low');
  await expect(page.getByTestId('sleep-duration')).toHaveText('5h 28m');
  await expect(page.getByTestId('day-advice')).toContainText('Short night');
  await expect(page.getByTestId('rings')).toContainText('337');

  // The flow reads the Watch: sleep step stays open, exercise ring closes it
  await expect(page.getByTestId('flow-sleep-check')).toHaveAttribute('data-done', 'false');
  await expect(page.getByTestId('measured-sleep-check')).toContainText('5h 28m');
  await expect(page.getByTestId('flow-exercise')).toHaveAttribute('data-done', 'true');

  // Today suggests a lighter day; the sprint defaults to 25 min
  await page.getByTestId('back-button').last().click();
  await page.getByTestId('home-today').first().click();
  await expect(page.getByTestId('today-short-night')).toContainText('5h 28m');
  await page.getByTestId('today-start-sprint').click();
  await expect(page.getByTestId('sprint-short-night')).toContainText('25 min');
  await expect(page.getByTestId('sprint-duration-25')).toHaveCSS('color', 'rgb(255, 255, 255)');
});

test('pasting the Shortcut output imports sleep and rings', async ({ page }) => {
  await openFocus(page);
  const d = localDate();
  const prev = localDate(new Date(Date.now() - 86_400_000));
  const payload = JSON.stringify({
    v: 1,
    date: d,
    sleep: [
      `${prev}T23:05:00|${d}T03:00:00|Core`,
      `${d}T03:00:00|${d}T03:04:00|Awake`,
      `${d}T03:04:00|${d}T06:35:00|Deep`,
    ].join('\n'),
    move: '412 kcal',
    exercise: '41',
    stand: 11,
  });
  await page.getByTestId('health-sync').click();
  await expect(page.getByTestId('run-shortcut')).toHaveAttribute('href', 'shortcuts://run-shortcut?name=Clarity%20Health');
  await page.getByTestId('health-text').fill(payload);
  await page.getByTestId('apply-health-text').click();
  await expect(page.getByTestId('toast')).toContainText('Synced: 7h 26m sleep');
  await expect(page.getByTestId('sleep-duration')).toHaveText('7h 26m');
  await expect(page.getByTestId('rings')).toContainText('412');
  await expect(page.getByTestId('flow-sleep-check')).toHaveAttribute('data-done', 'true');

  // A bad paste explains itself
  await page.getByTestId('health-sync').click();
  await page.getByTestId('health-text').fill('hello');
  await page.getByTestId('apply-health-text').click();
  await expect(page.getByTestId('sync-error')).toContainText('doesn’t look like');
});

test('a running sprint can be edited: next action and time left', async ({ page }) => {
  await page.getByTestId('home-today').first().click();
  await page.getByTestId('today-start-sprint').click();
  const sprint = page.getByTestId('focus-sprint');
  await sprint.getByTestId('sprint-task-option').first().click();
  await sprint.getByTestId('sprint-next').click();
  await sprint.getByTestId('sprint-next-action').fill('Outline');
  await sprint.getByTestId('sprint-next').click();
  await sprint.getByTestId('sprint-start').click();
  await expect(sprint.getByTestId('sprint-clock')).toHaveText(/^4[45]:\d\d$/);
  // Regression: a freshly started sprint must actually count down
  await expect(sprint.getByTestId('sprint-clock')).toHaveText(/^44:5\d$/, { timeout: 4000 });

  await sprint.getByTestId('sprint-edit-open').click();
  const edit = page.getByTestId('sprint-edit');
  await edit.getByTestId('edit-next-action').fill('Write the first paragraph');
  await edit.getByTestId('edit-remaining').fill('10');
  await edit.getByTestId('edit-save').click();
  await expect(page.getByTestId('sprint-clock')).toHaveText(/^(10:00|09:5\d)$/);
  await expect(page.getByTestId('focus-sprint')).toContainText('Next: Write the first paragraph');
});

test('finished sprints are editable in the log; scheduled ones can be moved', async ({ page }) => {
  // Finish a sprint
  await page.getByTestId('home-today').first().click();
  await page.getByTestId('today-start-sprint').click();
  const sprint = page.getByTestId('focus-sprint');
  await sprint.getByTestId('sprint-free-title').fill('Write report');
  await sprint.getByTestId('sprint-next').click();
  await sprint.getByTestId('sprint-next').click();
  await sprint.getByTestId('sprint-start').click();
  await sprint.getByTestId('sprint-end').click();
  await page.getByTestId('sprint-finish').click();

  // Schedule one for later
  await page.getByTestId('today-start-sprint').click();
  await sprint.getByTestId('sprint-free-title').fill('Plan launch');
  await sprint.getByTestId('sprint-later').click();
  await sprint.getByTestId('sprint-later-time').fill('23:30');
  const download = page.waitForEvent('download').catch(() => null);
  await sprint.getByTestId('sprint-schedule').click();
  await download;

  await page.getByTestId('back-button').last().click();
  await openFocus(page);

  // Fix the finished sprint: it was really a 30-minute session
  const row = page.getByTestId('sprint-log-row').first();
  await expect(row).toContainText('Write report');
  await row.click();
  await page.getByTestId('edit-minutes').fill('30');
  await page.getByTestId('edit-note').fill('Drafted the summary');
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('sprint-log-minutes').first()).toHaveText('30 min');
  await expect(page.getByTestId('sprint-log-row').first()).toContainText('Drafted the summary');

  // Move the scheduled sprint
  await page.getByTestId('planned-sprint').first().getByText('Plan launch').click();
  await page.getByTestId('edit-time').fill('22:15');
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('planned-sprint').first()).toContainText(/22:15|10:15/);

  // Delete the logged sprint
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('sprint-log-row').first().click();
  await page.getByTestId('edit-delete').click();
  await expect(page.getByTestId('sprint-log-row')).toHaveCount(0);
});

test('routine sprint times are free-form; custom times use the share sheet', async ({ page }) => {
  await openFocus(page);
  await expect(page.getByTestId('add-routine-calendar')).toBeVisible();
  await page.getByTestId('morning-sprint-time').fill('10:30');
  await page.getByTestId('morning-sprint-time').dispatchEvent('change');
  await page.getByTestId('evening-sprint-time').fill('20:15');
  await page.getByTestId('evening-sprint-time').dispatchEvent('change');
  await page.getByTestId('sprint-length').fill('50');
  await page.getByTestId('sprint-length').dispatchEvent('change');

  await expect(page.getByTestId('routine-sprint-morning')).toContainText('10:30');
  await expect(page.getByTestId('routine-sprint-evening')).toContainText('20:15');
  await expect(page.getByTestId('flow-sprint')).toContainText('Focus Sprint · 50 min');
  await expect(page.getByTestId('add-routine-calendar')).toHaveCount(0);
  await expect(page.getByTestId('share-routine-calendar')).toBeVisible();
  await expect(page.getByTestId('custom-routine-note')).toContainText('share sheet');
});
