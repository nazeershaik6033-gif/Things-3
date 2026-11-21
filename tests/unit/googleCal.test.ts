import { describe, expect, it } from 'vitest';
import { googleCalendarEventUrl } from '../../src/domain/googleCal';

describe('googleCalendarEventUrl', () => {
  it('builds a timed event with default 60 min duration', () => {
    const url = googleCalendarEventUrl({ title: 'Standup', date: '2026-07-01', time: '09:30' });
    expect(url).toContain('action=TEMPLATE');
    expect(url).toContain('text=Standup');
    expect(url).toContain('dates=20260701T093000%2F20260701T103000');
  });

  it('rolls the end time into the next day when it crosses midnight', () => {
    const url = googleCalendarEventUrl({ date: '2026-07-01', time: '23:30', durationMin: 60 });
    expect(url).toContain('dates=20260701T233000%2F20260702T003000');
  });

  it('builds an all-day event with exclusive end date', () => {
    const url = googleCalendarEventUrl({ title: 'Trip', date: '2026-07-01' });
    expect(url).toContain('dates=20260701%2F20260702');
  });

  it('URL-encodes title and details', () => {
    const url = googleCalendarEventUrl({
      title: 'Lunch & sync',
      date: '2026-07-01',
      details: 'room 4, floor 2',
    });
    expect(url).toContain('text=Lunch+%26+sync');
    expect(url).toContain('details=room+4%2C+floor+2');
  });
});
