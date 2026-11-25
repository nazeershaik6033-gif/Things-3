import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db/db';
import {
  createSprint, startSprint, finishSprint, editRunningSprint, editSprintRecord,
  saveHealth, deleteHealthDay, logEnergy,
} from '../../src/db/mutations';
import { exportData, importData, validateExport } from '../../src/db/exportImport';
import {
  adviseDay, bedtimeOffset, clockDiff, focusInsights, formatDuration, manualNight, mergeActivity,
  nightsFromSamples, parseHealthPayload, parseNum, parseSleepSamples, ringProgress, sampleKind,
  scoreLabel, sleepScore, DEFAULT_GOALS,
} from '../../src/domain/health';
import type { HealthDay, Sprint } from '../../src/db/models';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

// Times without an offset are local, like the Shortcut's own output in the
// user's timezone.
const line = (s: string, e: string, v: string) => `2026-11-${s}|2026-11-${e}|${v}`;

describe('sleep samples → nights', () => {
  it('reads Shortcuts labels leniently', () => {
    expect(sampleKind('Core')).toBe('asleep');
    expect(sampleKind('REM')).toBe('asleep');
    expect(sampleKind('Deep')).toBe('asleep');
    expect(sampleKind('Asleep (Unspecified)')).toBe('asleep');
    expect(sampleKind('Awake')).toBe('awake');
    expect(sampleKind('In Bed')).toBe('inbed');
    expect(sampleKind('banana')).toBeNull();
  });

  it('builds a night across midnight, counting wake-ups and awake time', () => {
    const text = [
      line('21T00:39:00', '21T02:00:00', 'Core'),
      line('21T02:00:00', '21T02:02:00', 'Awake'),
      line('21T02:02:00', '21T04:00:00', 'Deep'),
      line('21T04:02:00', '21T05:30:00', 'REM'),
      line('21T05:31:00', '21T06:12:00', 'Core'),
    ].join('\n');
    const [n] = nightsFromSamples(parseSleepSamples(text));
    expect(n!.date).toBe('2026-11-21');
    expect(n!.night.onset).toBe('00:39');
    expect(n!.night.wake).toBe('06:12');
    expect(n!.night.wakeups).toBe(3);
    expect(n!.night.awakeMin).toBe(5);
    expect(n!.night.asleepMin).toBe(328); // 5h 28m — the user's real night
  });

  it('does not double-count overlapping Watch + iPhone samples', () => {
    const text = [
      line('20T23:00:00', '21T06:00:00', 'Asleep'),
      line('20T23:30:00', '21T05:00:00', 'Core'),
    ].join('\n');
    expect(nightsFromSamples(parseSleepSamples(text))[0]!.night.asleepMin).toBe(420);
  });

  it('keeps the main sleep per wake date (a nap is a separate, smaller period)', () => {
    const text = [
      line('20T23:00:00', '21T06:30:00', 'Core'),
      line('21T14:00:00', '21T14:40:00', 'Core'),
    ].join('\n');
    const nights = nightsFromSamples(parseSleepSamples(text));
    expect(nights).toHaveLength(1);
    expect(nights[0]!.night.asleepMin).toBe(450);
  });

  it('falls back to "in bed" when there is no stage data', () => {
    const nights = nightsFromSamples(parseSleepSamples(line('20T23:10:00', '21T06:40:00', 'In Bed')));
    expect(nights[0]!.night.asleepMin).toBe(450);
  });

  it('parses object arrays and ignores junk lines', () => {
    const s = parseSleepSamples([
      { start: '2026-11-21T01:00:00', end: '2026-11-21T02:00:00', value: 'Core' },
      'not|a|sample',
      { start: 'x', end: 'y', value: 'Core' },
    ]);
    expect(s).toHaveLength(1);
  });
});

describe('Shortcut payload', () => {
  it('parses the dictionary JSON with unit strings', () => {
    const json = JSON.stringify({
      v: 1,
      date: '2026-11-21',
      sleep: [line('21T00:39:00', '21T06:12:00', 'Core')].join('\n'),
      move: '337 kcal',
      exercise: 30,
      stand: '13',
    });
    const p = parseHealthPayload(json);
    expect(p.nights[0]!.date).toBe('2026-11-21');
    expect(p.activity).toEqual({ date: '2026-11-21', values: { moveKcal: 337, exerciseMin: 30, standHr: 13 } });
  });

  it('accepts bare sample lines (sleep only)', () => {
    const p = parseHealthPayload(line('20T23:00:00', '21T06:00:00', 'Core'));
    expect(p.nights).toHaveLength(1);
    expect(p.activity).toBeNull();
  });

  it('explains empty or foreign clipboards', () => {
    expect(() => parseHealthPayload('  ')).toThrow(/empty/);
    expect(() => parseHealthPayload('hello there')).toThrow(/doesn’t look like/);
    expect(() => parseHealthPayload('{"v":1}')).toThrow(/No sleep or activity/);
  });

  it('parseNum handles commas and units', () => {
    expect(parseNum('1,234.5 kcal')).toBe(1234.5);
    expect(parseNum('')).toBeNull();
    expect(parseNum(12)).toBe(12);
  });

  it('rings merge upward within a day', () => {
    expect(mergeActivity({ moveKcal: 337, exerciseMin: 30, standHr: null }, { moveKcal: 12, exerciseMin: 45, standHr: 2 }))
      .toEqual({ moveKcal: 337, exerciseMin: 45, standHr: 2 });
  });
});

describe('sleep score', () => {
  it("reproduces the user's Apple Watch night: 24 + 11 + 19 = 54, Low", () => {
    // 5h 28m asleep, 3 wake-ups / 5 min, onset 1h39m after the 23:00 target
    const night = { asleepMin: 328, onset: '00:39', wake: '06:12', awakeMin: 5, wakeups: 3 };
    expect(sleepScore(night, '23:00')).toEqual({ duration: 24, bedtime: 11, interruptions: 19, total: 54, label: 'Low' });
  });

  it('a full on-time night scores 100', () => {
    expect(sleepScore({ asleepMin: 480, onset: '23:05', wake: '07:05', awakeMin: 0, wakeups: 0 }, '23:00').total).toBe(100);
  });

  it('bands match Apple’s labels', () => {
    expect([40, 41, 60, 61, 80, 81, 95, 96].map(scoreLabel))
      .toEqual(['Very Low', 'Low', 'Low', 'OK', 'OK', 'High', 'High', 'Very High']);
  });

  it('clock math wraps midnight', () => {
    expect(clockDiff('00:39', '23:00')).toBe(99);
    expect(clockDiff('22:30', '00:00')).toBe(90);
    expect(bedtimeOffset('00:39', '23:00')).toBe(99);
    expect(bedtimeOffset('22:30', '23:00')).toBe(-30);
    expect(formatDuration(328)).toBe('5h 28m');
  });

  it('manual nights compute the wake time', () => {
    expect(manualNight({ asleepMin: 328, onset: '00:39', awakeMin: 5, wakeups: 3 }).wake).toBe('06:12');
    expect(manualNight({ asleepMin: 480, onset: '23:30' }).wake).toBe('07:30');
  });
});

describe('adapting the day', () => {
  it('after a short night: 25-min sprints, 1–2 MITs', () => {
    const a = adviseDay({ asleepMin: 328, onset: '00:39', wake: '06:12', awakeMin: 5, wakeups: 3 }, '23:00', 45)!;
    expect(a.shortNight).toBe(true);
    expect(a.sprintMinutes).toBe(25);
    expect(a.mitSuggest).toBe(2);
    expect(a.message).toContain('5h 28m');
  });

  it('after a good night: normal plan; no data: no advice', () => {
    const a = adviseDay({ asleepMin: 460, onset: '23:10', wake: '07:00', awakeMin: 10, wakeups: 1 }, '23:00', 45)!;
    expect(a.shortNight).toBe(false);
    expect(a.sprintMinutes).toBe(45);
    expect(adviseDay(null, '23:00', 45)).toBeNull();
  });
});

describe('rings + insights', () => {
  it('ring progress against goals', () => {
    expect(ringProgress({ moveKcal: 337, exerciseMin: 30, standHr: 13 }, DEFAULT_GOALS))
      .toEqual({ move: 337 / 400, exercise: 1, stand: 13 / 12 });
    expect(ringProgress(null, DEFAULT_GOALS)).toEqual({ move: 0, exercise: 0, stand: 0 });
  });

  it('compares focused minutes after 7h+ nights vs shorter ones, once there is enough data', () => {
    const day = (date: string, asleepMin: number, exerciseMin: number): HealthDay => ({
      date, source: 'manual', updatedAt: 0,
      sleep: { asleepMin, onset: '23:00', wake: '07:00', awakeMin: 0, wakeups: 0 },
      activity: { moveKcal: 300, exerciseMin, standHr: 10 },
    });
    const sprint = (date: string, min: number): Sprint => ({
      id: `${date}-${min}`, taskId: null, title: '', nextAction: '', durationMin: min, date,
      plannedAt: null, startedAt: 0, endsAt: min * 60_000, endedAt: min * 60_000,
      status: 'done', completedNote: '', createdAt: 0,
    });
    const days = [
      day('2026-11-01', 480, 40), day('2026-11-02', 470, 40), day('2026-11-03', 450, 40),
      day('2026-11-04', 330, 0), day('2026-11-05', 360, 0), day('2026-11-06', 300, 0),
    ];
    const sprints = [
      sprint('2026-11-01', 90), sprint('2026-11-02', 80), sprint('2026-11-03', 70),
      sprint('2026-11-04', 30), sprint('2026-11-05', 40), sprint('2026-11-06', 35),
    ];
    const res = focusInsights(days, sprints, [], DEFAULT_GOALS);
    expect(res.map((r) => r.id)).toEqual(['sleep', 'exercise']);
    expect(res[0]!.good.focusMin).toBe(80);
    expect(res[0]!.poor.focusMin).toBe(35);
    expect(focusInsights(days.slice(0, 4), sprints, [], DEFAULT_GOALS)).toEqual([]);
  });
});

describe('health + sprint mutations', () => {
  it('saves sleep and merges Shortcut rings upward; manual rings replace', async () => {
    await saveHealth('2026-11-21', { activity: { moveKcal: 337, exerciseMin: 30, standHr: 13 } }, 'shortcut', mergeActivity);
    await saveHealth('2026-11-21', { activity: { moveKcal: 20, exerciseMin: 0, standHr: 1 } }, 'shortcut', mergeActivity);
    expect((await db.healthDays.get('2026-11-21'))!.activity!.moveKcal).toBe(337);
    await saveHealth('2026-11-21', { sleep: manualNight({ asleepMin: 328, onset: '00:39' }) }, 'manual');
    let d = (await db.healthDays.get('2026-11-21'))!;
    expect(d.sleep!.asleepMin).toBe(328);
    expect(d.activity!.moveKcal).toBe(337); // untouched by a sleep-only save
    await saveHealth('2026-11-21', { activity: { moveKcal: 200, exerciseMin: 10, standHr: 5 } }, 'manual');
    d = (await db.healthDays.get('2026-11-21'))!;
    expect(d.activity!.moveKcal).toBe(200);
    await deleteHealthDay('2026-11-21');
    expect(await db.healthDays.get('2026-11-21')).toBeUndefined();
  });

  it('edits a running sprint: task, next action and time left', async () => {
    const id = await createSprint({ title: 'A', durationMin: 45 });
    await startSprint(id, 1_000_000);
    await editRunningSprint(id, { title: 'B', nextAction: 'Draft intro', remainingMin: 20 }, 1_000_000 + 10 * 60_000);
    const s = (await db.sprints.get(id))!;
    expect(s.title).toBe('B');
    expect(s.nextAction).toBe('Draft intro');
    expect(s.endsAt).toBe(1_000_000 + 30 * 60_000);
    expect(s.durationMin).toBe(30);
  });

  it('edits a finished sprint in the log', async () => {
    const id = await createSprint({ title: 'A', durationMin: 45 });
    await startSprint(id, Date.parse('2026-11-20T09:00:00'));
    await finishSprint(id, { note: 'x', nextAction: '', completeTask: false }, Date.parse('2026-11-20T09:45:00'));
    const start = Date.parse('2026-11-19T10:00:00');
    await editSprintRecord(id, { startedAt: start, minutes: 30, title: 'Report', completedNote: 'Outline done' });
    const s = (await db.sprints.get(id))!;
    expect(s.date).toBe('2026-11-19');
    expect(s.endedAt! - s.startedAt!).toBe(30 * 60_000);
    expect(s.title).toBe('Report');
    expect(s.completedNote).toBe('Outline done');
  });

  it('backups carry health days (schema 8)', async () => {
    await saveHealth('2026-11-21', { sleep: manualNight({ asleepMin: 400, onset: '23:00' }) }, 'manual');
    await logEnergy(3);
    const file = await exportData();
    expect(file.schemaVersion).toBe(10);
    await db.healthDays.clear();
    await importData(validateExport(JSON.parse(JSON.stringify(file))));
    expect(await db.healthDays.count()).toBe(1);
  });
});
