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

test('Calendar screen shows month grid with events from home row', async ({ page }) => {
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
  // Link the calendar in settings first
  await page.getByTestId('settings-button').click();
  await page.getByTestId('ics-url').fill('https://calendar.example.com/feed.ics');
  await page.getByTestId('save-calendar').click();
  await expect(page.getByText(/Updated — 2 events/)).toBeVisible();
  await page.getByTestId('back-button').last().click();

  // Open the new Calendar screen from the home row above Logbook
  await page.getByTestId('home-calendar').click();
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  await expect(page.getByTestId('cal-month-label')).toHaveText(`${monthNames[today.getMonth()]} ${today.getFullYear()}`);

  // Today is selected by default and its events listed
  const dayEvents = page.getByTestId('cal-day-events');
  await expect(dayEvents).toContainText('Team standup');
  await expect(dayEvents).toContainText('Company holiday');
  await expect(dayEvents).toContainText('all-day');

  // Month navigation works
  await page.getByTestId('cal-next').click();
  const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  await expect(page.getByTestId('cal-month-label')).toHaveText(`${monthNames[next.getMonth()]} ${next.getFullYear()}`);
  await page.getByTestId('cal-prev').click();
  await expect(page.getByTestId('cal-month-label')).toHaveText(`${monthNames[today.getMonth()]} ${today.getFullYear()}`);

  // Manual refresh button reports status
  await page.getByTestId('calendar-refresh').click();
  await expect(page.getByText(/Updated — 2 events/)).toBeVisible();
});

test('sync still works when proxy field is cleared (Google-style CORS block)', async ({ page }) => {
  const today = new Date();
  const compact = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  // Direct fetch fails like Google (no CORS header → browser blocks it)
  await page.route('https://calendar.google.com/calendar/ical/secret/basic.ics', (route) =>
    route.abort('failed'),
  );
  // Default proxy serves the feed
  await page.route('https://corsproxy.io/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/calendar',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: icsFixture(compact),
    }),
  );

  await loadSeeded(page);
  await page.getByTestId('settings-button').click();
  await page.getByTestId('ics-url').fill('https://calendar.google.com/calendar/ical/secret/basic.ics');
  // Simulate the user having cleared the proxy field
  await page.getByPlaceholder('CORS proxy prefix (optional)').fill('');
  await page.getByTestId('save-calendar').click();
  await expect(page.getByText(/Updated — 2 events/)).toBeVisible();
  // The field restored itself to the default proxy
  await expect(page.getByPlaceholder('CORS proxy prefix (optional)')).toHaveValue(/corsproxy/);
});

test('pasting a Google "Embed" link auto-converts to the public feed', async ({ page }) => {
  const today = new Date();
  const compact = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  // The app should request the converted public ical URL, not the embed page
  await page.route('https://calendar.google.com/calendar/ical/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/calendar',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: icsFixture(compact),
    }),
  );

  await loadSeeded(page);
  await page.getByTestId('settings-button').click();
  await page
    .getByTestId('ics-url')
    .fill('https://calendar.google.com/calendar/embed?src=me%40gmail.com&ctz=Asia%2FKolkata');
  await page.getByTestId('save-calendar').click();
  await expect(page.getByText(/Updated — 2 events/)).toBeVisible();
});

test('private embed link that cannot be fetched explains which link to copy', async ({ page }) => {
  // Both direct and proxied fetches fail (private calendar)
  await page.route('https://calendar.google.com/calendar/ical/**', (r) => r.abort('failed'));
  await page.route('https://corsproxy.io/**', (r) => r.abort('failed'));
  await page.route('https://api.allorigins.win/**', (r) => r.abort('failed'));

  await loadSeeded(page);
  await page.getByTestId('settings-button').click();
  await page
    .getByTestId('ics-url')
    .fill('https://calendar.google.com/calendar/embed?src=me%40gmail.com');
  await page.getByTestId('save-calendar').click();
  await expect(page.getByText(/Secret address in iCal format/).first()).toBeVisible({ timeout: 15_000 });
});
