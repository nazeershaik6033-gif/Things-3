import { expect, test } from '@playwright/test';
import { loadSeeded } from './helpers';

test('Remind downloads an .ics calendar alert for the task', async ({ page }) => {
  await loadSeeded(page);
  await page.getByTestId('home-today').click();

  // Expand a seeded task and open the Remind picker
  await page.getByText('Buy groceries').click();
  await page.getByRole('button', { name: 'Remind' }).click();
  await expect(page.getByTestId('remind-picker')).toBeVisible();

  // Pick a time and download
  await page.getByTestId('remind-time').fill('18:30');
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('remind-download').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^reminder-\d{4}-\d{2}-\d{2}\.ics$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks).toString();
  expect(body).toContain('BEGIN:VCALENDAR');
  expect(body).toContain('SUMMARY:Buy groceries');
  expect(body).toContain('T183000');
  expect(body).toContain('BEGIN:VALARM');
});

test('Remind via Google Calendar opens a pre-filled template', async ({ page, context }) => {
  await context.route('https://calendar.google.com/calendar/render**', (r) =>
    r.fulfill({ status: 200, contentType: 'text/html', body: '<title>stub</title>' }),
  );
  await loadSeeded(page);
  await page.getByTestId('home-today').click();
  await page.getByText('Buy groceries').click();
  await page.getByRole('button', { name: 'Remind' }).click();
  await page.getByTestId('remind-time').fill('18:30');
  const popupPromise = context.waitForEvent('page');
  await page.getByTestId('remind-google').click();
  const popup = await popupPromise;
  expect(popup.url()).toContain('calendar.google.com/calendar/render');
  expect(popup.url()).toContain('text=Buy+groceries');
  expect(popup.url()).toContain('T183000');
  await popup.close();
});
