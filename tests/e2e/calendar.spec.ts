import { expect, test } from '@playwright/test';
import { loadSeeded } from './helpers';

function icsFixture(todayCompact: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Fixture//EN',
    'BEGIN:VEVENT',
    'UID:standup@fixture',
    'SUMMARY:Team standup',
    `DTSTART:${todayCompact}T140000Z`,
    `DTEND:${todayCompact}T143000Z`,
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:allday@fixture',
    'SUMMARY:Company holiday',
    `DTSTART;VALUE=DATE:${todayCompact}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

test('ICS subscription shows events in Today', async ({ page }) => {
  const today = new Date();
  const compact = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  await page.route('https://calendar.example.com/feed.ics', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/calendar',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: icsFixture(compact),
    }),
  );

  await loadSeeded(page);
  await page.getByTestId('settings-button').click();
  await page.getByTestId('ics-url').fill('https://calendar.example.com/feed.ics');
  await page.getByTestId('save-calendar').click();
  await expect(page.getByText(/Updated — 2 events/)).toBeVisible();

  await page.getByTestId('back-button').last().click();
  await page.getByTestId('home-today').click();
  const block = page.getByTestId('calendar-block');
  await expect(block).toBeVisible();
  await expect(block).toContainText('Company holiday');
  await expect(block).toContainText('Team standup');
  await expect(block).toContainText('all-day');
});
