import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, ClarityDB } from '../../src/db/db';
import {
  createTask, toggleMit, setTaskEnergy, createSprint, startSprint, finishSprint, logEnergy,
} from '../../src/db/mutations';
import { exportData, importData, validateExport } from '../../src/db/exportImport';
import {
  addMinutes, analyzeEnergy, allProfiles, canAddMit, dailyFlow, DEFAULT_PROFILE, formatClock,
  isMit, morningSprintTime, normalizeProfile, routineFileName, routineItems, windowOf,
} from '../../src/domain/focus';
import {
  buildCalendar, escapeText, foldLine, routineCalendar, sprintCalendar, triggerFor,
} from '../../src/domain/icsWrite';
import { parseICS } from '../../src/domain/ics';
import { todayStr } from '../../src/domain/dates';
import type { EnergyLog } from '../../src/db/models';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('MIT / LIT', () => {
  it('toggles an MIT for today and pulls it into Today', async () => {
    const id = await createTask({ title: 'Write report' });
    expect(await toggleMit(id)).toBe('added');
    const t = (await db.tasks.get(id))!;
    expect(t.mitDate).toBe(todayStr());
    expect(t.startDate).toBe(todayStr());
    expect(t.bucket).toBe('anytime');
    expect(await toggleMit(id)).toBe('removed');
    expect((await db.tasks.get(id))!.mitDate).toBeNull();
  });

  it('caps open MITs at 3 — completed ones free a slot', async () => {
    const ids = await Promise.all([1, 2, 3, 4].map((n) => createTask({ title: `t${n}` })));
    for (const id of ids.slice(0, 3)) expect(await toggleMit(id)).toBe('added');
    expect(await toggleMit(ids[3]!)).toBe('limit');
    expect(canAddMit(await db.tasks.toArray(), todayStr())).toBe(false);
    await db.tasks.update(ids[0]!, { status: 'completed' });
    expect(await toggleMit(ids[3]!)).toBe('added');
  });

  it('MIT-ness is per day', async () => {
    const id = await createTask({ title: 'x', mitDate: '2020-01-01' });
    const t = (await db.tasks.get(id))!;
    expect(isMit(t, '2020-01-01')).toBe(true);
    expect(isMit(t, '2020-01-02')).toBe(false);
  });

  it('stores energy tags', async () => {
    const id = await createTask({ title: 'x' });
    await setTaskEnergy(id, 'high');
    expect((await db.tasks.get(id))!.energy).toBe('high');
  });
});

describe('focus sprints', () => {
  it('runs one sprint at a time and closes the loop into the checklist', async () => {
    const taskId = await createTask({ title: 'Website' });
    const a = await createSprint({ taskId, title: 'Website', durationMin: 45 });
    const b = await createSprint({ taskId, title: 'Website', durationMin: 25 });
    await startSprint(a, 1_000);
    let sa = (await db.sprints.get(a))!;
    expect(sa.status).toBe('running');
    expect(sa.endsAt).toBe(1_000 + 45 * 60_000);
    await startSprint(b, 2_000);
    sa = (await db.sprints.get(a))!;
    expect(sa.status).toBe('abandoned');

    await finishSprint(b, { note: 'Drafted headline', nextAction: 'Test the contact form', completeTask: false }, 5_000);
    const sb = (await db.sprints.get(b))!;
    expect(sb.status).toBe('done');
    expect(sb.completedNote).toBe('Drafted headline');
    const t = (await db.tasks.get(taskId))!;
    expect(t.checklist[0]!.title).toBe('Test the contact form');
    expect(t.status).toBe('open');
  });

  it('can complete the to-do on finish', async () => {
    const taskId = await createTask({ title: 'Email' });
    const s = await createSprint({ taskId, title: 'Email', durationMin: 25 });
    await startSprint(s);
    await finishSprint(s, { note: '', nextAction: 'ignored', completeTask: true });
    const t = (await db.tasks.get(taskId))!;
    expect(t.status).toBe('completed');
    expect(t.checklist).toHaveLength(0);
  });

  it('formats the visible timer', () => {
    expect(formatClock(45 * 60_000)).toBe('45:00');
    expect(formatClock(61_001)).toBe('01:02');
    expect(formatClock(0)).toBe('00:00');
  });
});

describe('energy tracking', () => {
  const mk = (date: string, hour: number, level: number): EnergyLog => ({
    id: `${date}-${hour}`, at: 0, date, minuteOfDay: hour * 60, level,
  });
  const days = ['2026-11-01', '2026-11-02', '2026-11-03'];

  it('logEnergy clamps and records local minute of day', async () => {
    const id = await logEnergy(9, new Date(2026, 10, 20, 14, 30));
    const l = (await db.energyLogs.get(id))!;
    expect(l.level).toBe(5);
    expect(l.minuteOfDay).toBe(14 * 60 + 30);
    expect(l.date).toBe('2026-11-20');
  });

  it('needs enough data before calling a pattern', () => {
    expect(analyzeEnergy([mk('2026-11-01', 9, 5)]).kind).toBe('insufficient');
  });

  it('detects morning, evening and mixed patterns', () => {
    const pattern = (m: number, a: number, e: number) =>
      days.flatMap((d) => [mk(d, 10, m), mk(d, 14, a), mk(d, 20, e)]);
    expect(analyzeEnergy(pattern(5, 3, 2)).kind).toBe('morning');
    expect(analyzeEnergy(pattern(2, 3, 5)).kind).toBe('evening');
    expect(analyzeEnergy(pattern(4, 2, 4)).kind).toBe('mixed');
    expect(analyzeEnergy(pattern(3, 3, 3)).kind).toBe('flat');
    expect(analyzeEnergy(pattern(5, 3, 2)).peakHour).toBe(10);
  });

  it('buckets the day into windows', () => {
    expect(windowOf(4 * 60)).toBe('evening');
    expect(windowOf(9 * 60)).toBe('morning');
    expect(windowOf(13 * 60)).toBe('afternoon');
    expect(windowOf(22 * 60)).toBe('evening');
  });
});

describe('routine profile', () => {
  it('wraps time math around midnight', () => {
    expect(addMinutes('00:00', -60)).toBe('23:00');
    expect(addMinutes('23:30', 45)).toBe('00:15');
    expect(addMinutes('07:00', 30)).toBe('07:30');
  });

  it("builds the user's routine: plan 07:30, sprints 09:00 + 19:00, LITs 15:00, shutdown 22:00, bed 23:00", () => {
    const items = routineItems(DEFAULT_PROFILE);
    const at = Object.fromEntries(items.map((i) => [i.id, i.time]));
    expect(at).toEqual({
      plan: '07:30', 'sprint-morning': '09:00', lits: '15:00',
      'sprint-evening': '19:00', shutdown: '22:00', sleep: '23:00',
    });
    expect(items.find((i) => i.id === 'sprint-morning')!.alarms).toEqual([-5, 45]);
  });

  it('shifts the first sprint for late risers and drops the evening sprint when off', () => {
    expect(morningSprintTime({ ...DEFAULT_PROFILE, wake: '09:00' })).toBe('11:00');
    expect(routineItems({ ...DEFAULT_PROFILE, eveningSprint: false }).some((i) => i.id === 'sprint-evening')).toBe(false);
    expect(dailyFlow({ ...DEFAULT_PROFILE, eveningSprint: false }).some((s) => s.id === 'sprint-evening')).toBe(false);
  });

  it('normalizes unknown values back to supported choices', () => {
    expect(normalizeProfile({ wake: '05:13' as never, sprintMinutes: 90 as never })).toEqual(DEFAULT_PROFILE);
  });

  it('has one pre-built file per combination', () => {
    const names = new Set(allProfiles().map(routineFileName));
    expect(names.size).toBe(64);
    expect(routineFileName(DEFAULT_PROFILE)).toBe('focus-routine-w0700-b2300-s45-e1.ics');
  });
});

describe('ICS writer', () => {
  it('escapes text and formats triggers', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    expect(triggerFor(0)).toBe('PT0S');
    expect(triggerFor(-5)).toBe('-PT5M');
    expect(triggerFor(45)).toBe('PT45M');
    expect(triggerFor(90)).toBe('PT1H30M');
  });

  it('folds long lines at 75 octets without splitting emoji', () => {
    const line = `SUMMARY:${'🎯'.repeat(40)}`;
    const folded = foldLine(line);
    const enc = new TextEncoder();
    for (const part of folded.split('\r\n')) expect(enc.encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });

  it('routine calendar is valid, recurring, alarmed, and deterministic', () => {
    const ics = routineCalendar(DEFAULT_PROFILE);
    expect(ics).toBe(routineCalendar(DEFAULT_PROFILE));
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(6);
    expect(ics.match(/RRULE:FREQ=DAILY/g)).toHaveLength(6);
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(8); // two per sprint
    expect(ics).toContain('DTSTART:20260101T090000');
    expect(ics).toContain('DTEND:20260101T094500');
    expect(ics).toContain('TRIGGER:-PT5M');
    // round-trips through the app's own parser (which skips RRULE events),
    // so check structure via a non-recurring copy
    const single = ics.replace(/RRULE:FREQ=DAILY\r\n/g, '');
    const parsed = parseICS(single, { calendarUrl: 'x', from: '2026-01-01', to: '2026-01-02' });
    expect(parsed.map((e) => e.title)).toContain('☀️ Plan: Everest → 1–3 MITs');
  });

  it('bedtime at midnight ends on the next day', () => {
    const ics = routineCalendar({ ...DEFAULT_PROFILE, bed: '00:00' });
    expect(ics).toContain('DTSTART:20260101T000000');
    expect(ics).toContain('DTSTART:20260101T230000'); // shutdown 23:00
  });

  it('builds a one-off sprint with prep + end alerts', () => {
    const ics = sprintCalendar({
      id: 'abc', start: new Date(2026, 10, 21, 9, 0), durationMin: 45,
      title: 'Report', nextAction: 'Draft section 1',
    });
    expect(ics).toContain('DTSTART:20261121T090000');
    expect(ics).toContain('DTEND:20261121T094500');
    expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
    expect(ics).toContain('TRIGGER:PT45M');
    expect(ics).toContain('Next action: Draft section 1');
  });

  it('empty calendar still well-formed', () => {
    expect(buildCalendar('x', [])).toContain('X-WR-CALNAME:x');
  });
});

describe('schema v7 migration + backup', () => {
  it('upgrades pre-v7 tasks with null focus fields', async () => {
    const name = `migrate-${Math.random()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({
      tasks: 'id, status, bucket, startDate, deadline, projectId, headingId, areaId, completedAt, trashedAt, *tagIds',
      projects: 'id, status, areaId, completedAt, trashedAt, *tagIds',
      headings: 'id, projectId', areas: 'id', tags: 'id', settings: 'key',
      calendarEvents: 'id, date, calendarUrl',
    });
    await v1.table('tasks').put({ id: 'old', title: 'legacy', status: 'open', trashedAt: null });
    v1.close();

    const v2 = new ClarityDB(name);
    const t = (await v2.tasks.get('old'))!;
    expect(t.mitDate).toBeNull();
    expect(t.energy).toBeNull();
    expect(await v2.sprints.count()).toBe(0);
    v2.close();
  });

  it('exports and re-imports sprints + energy logs; accepts v1 backups', async () => {
    await createTask({ title: 'a' });
    await createSprint({ title: 's' });
    await logEnergy(4);
    const file = await exportData();
    expect(file.schemaVersion).toBe(7);
    await importData(validateExport(JSON.parse(JSON.stringify(file))));
    expect(await db.sprints.count()).toBe(1);
    expect(await db.energyLogs.count()).toBe(1);

    const v1 = { ...file, schemaVersion: 1, data: { ...file.data, sprints: undefined, energyLogs: undefined } };
    for (const t of v1.data.tasks) {
      delete (t as Partial<typeof t>).mitDate;
      delete (t as Partial<typeof t>).energy;
    }
    await importData(validateExport(JSON.parse(JSON.stringify(v1))));
    expect((await db.tasks.toArray())[0]!.mitDate).toBeNull();
    expect(await db.sprints.count()).toBe(0);
  });
});
