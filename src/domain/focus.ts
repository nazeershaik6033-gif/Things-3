import type { DateStr, EnergyLog, Sprint, Task } from '../db/models';

/** The Focus Framework ("How To Train Your Focus") as pure, testable logic:
 *  Level 0 foundation (sleep, single-tasking) · Level 1 digital environment ·
 *  Level 2 Everest + MIT/LIT · Level 3 biological clock · Level 4 focus
 *  sprints · Level 5 reset/incubation. */

// --------------------------------------------------------------- MIT/LIT --

/** "Choose 1–3 tasks that contribute most to your meaningful goals." */
export const MIT_LIMIT = 3;

export function isMit(t: Task, today: DateStr): boolean {
  return t.mitDate === today && t.trashedAt === null;
}

/** Open MITs picked for today — the count the limit applies to. */
export function openMitCount(tasks: Task[], today: DateStr): number {
  return tasks.filter((t) => isMit(t, today) && t.status === 'open').length;
}

export function canAddMit(tasks: Task[], today: DateStr): boolean {
  return openMitCount(tasks, today) < MIT_LIMIT;
}

// --------------------------------------------------------------- profile --

/** Every choice is discrete so each combination has a pre-built, statically
 *  served calendar file (iOS home-screen apps can't hand generated files to
 *  Calendar reliably; an https text/calendar URL always works). */
export const WAKE_CHOICES = ['06:00', '07:00', '08:00', '09:00'] as const;
export const BED_CHOICES = ['22:30', '23:00', '23:30', '00:00'] as const;
export const SPRINT_CHOICES = [25, 45] as const;

export interface FocusProfile {
  wake: (typeof WAKE_CHOICES)[number];
  bed: (typeof BED_CHOICES)[number];
  sprintMinutes: (typeof SPRINT_CHOICES)[number];
  /** Mixed chronotype: a second, evening sprint. */
  eveningSprint: boolean;
}

export const DEFAULT_PROFILE: FocusProfile = {
  wake: '07:00',
  bed: '23:00',
  sprintMinutes: 45,
  eveningSprint: true,
};

export function normalizeProfile(p: Partial<FocusProfile> | null | undefined): FocusProfile {
  const pick = <T>(v: unknown, choices: readonly T[], fallback: T): T =>
    choices.includes(v as T) ? (v as T) : fallback;
  return {
    wake: pick(p?.wake, WAKE_CHOICES, DEFAULT_PROFILE.wake),
    bed: pick(p?.bed, BED_CHOICES, DEFAULT_PROFILE.bed),
    sprintMinutes: pick(p?.sprintMinutes, SPRINT_CHOICES, DEFAULT_PROFILE.sprintMinutes),
    eveningSprint: typeof p?.eveningSprint === 'boolean' ? p.eveningSprint : DEFAULT_PROFILE.eveningSprint,
  };
}

/** "HH:mm" ± minutes, wrapping around midnight. */
export function addMinutes(hhmm: string, delta: number): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const total = (((h * 60 + m + delta) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** The first protected sprint lands ~2h after waking, never before 09:00. */
export function morningSprintTime(p: FocusProfile): string {
  return p.wake <= '07:00' ? '09:00' : addMinutes(p.wake, 120);
}

export const EVENING_SPRINT_TIME = '19:00';
/** Afternoon dip — batch Least Important Tasks here. */
export const LIT_BATCH_TIME = '15:00';

export interface RoutineItem {
  id: string;
  time: string; // HH:mm local
  durationMin: number;
  title: string;
  /** Shown in the calendar alert / event notes. */
  notes: string;
  /** Alarm offsets in minutes relative to the start (negative = before). */
  alarms: number[];
  phase: 'morning' | 'focus' | 'afternoon' | 'evening';
}

/** The daily routine that becomes calendar events with alarms. */
export function routineItems(p: FocusProfile): RoutineItem[] {
  const sprint = (id: string, time: string, which: string): RoutineItem => ({
    id,
    time,
    durationMin: p.sprintMinutes,
    title: `🎯 Focus Sprint — ${which}`,
    notes:
      `In 5 min: open Clarity → Focus Sprint.\n` +
      `1 Schedule (done) · 2 Define the next action · 3 Phone out of reach, close tabs, clear desk · ` +
      `4 Visible timer ${p.sprintMinutes} min · 5 Record, next action, step away.\n` +
      `Stuck? Reset: work deliberately → step away → return fresh.`,
    alarms: [-5, p.sprintMinutes],
    phase: id === 'sprint-evening' ? 'evening' : 'focus',
  });
  const items: RoutineItem[] = [
    {
      id: 'plan',
      time: addMinutes(p.wake, 30),
      durationMin: 15,
      title: '☀️ Plan: Everest → 1–3 MITs',
      notes:
        'Open Clarity → Daily Focus. Did you sleep 7h+? Look at your Everest. ' +
        'Pick 1–3 Most Important Tasks; everything else is a LIT for the afternoon. Log your energy.',
      alarms: [0],
      phase: 'morning',
    },
    sprint('sprint-morning', morningSprintTime(p), 'MIT #1'),
    {
      id: 'lits',
      time: LIT_BATCH_TIME,
      durationMin: 30,
      title: '📥 Batch LITs (low-energy window)',
      notes: 'Emails, errands, admin, organizing files. Save sharp hours for MITs. Log your energy.',
      alarms: [0],
      phase: 'afternoon',
    },
  ];
  if (p.eveningSprint) items.push(sprint('sprint-evening', EVENING_SPRINT_TIME, 'MIT #2 (evening peak)'));
  items.push(
    {
      id: 'shutdown',
      time: addMinutes(p.bed, -60),
      durationMin: 15,
      title: '🌙 Shutdown: phone away',
      notes:
        'Phone out of the bedroom, no endless scrolling — read or listen instead. ' +
        "Note tomorrow's MIT candidates. Log your energy.",
      alarms: [0],
      phase: 'evening',
    },
    {
      id: 'sleep',
      time: p.bed,
      durationMin: 5,
      title: '😴 Lights out — protect 7h+',
      notes: 'Sleep is the foundation: attention, memory, decisions and mood depend on it.',
      alarms: [0],
      phase: 'evening',
    },
  );
  return items;
}

/** File name of the pre-built routine calendar for a profile. */
export function routineFileName(p: FocusProfile): string {
  return `focus-routine-w${p.wake.replace(':', '')}-b${p.bed.replace(':', '')}-s${p.sprintMinutes}-e${p.eveningSprint ? 1 : 0}.ics`;
}

export function allProfiles(): FocusProfile[] {
  const out: FocusProfile[] = [];
  for (const wake of WAKE_CHOICES) {
    for (const bed of BED_CHOICES) {
      for (const sprintMinutes of SPRINT_CHOICES) {
        for (const eveningSprint of [true, false]) out.push({ wake, bed, sprintMinutes, eveningSprint });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- energy --

export type Chronotype = 'morning' | 'evening' | 'mixed' | 'flat' | 'insufficient';

export interface EnergyAnalysis {
  kind: Chronotype;
  days: number;
  logs: number;
  /** Average level per window, null when the window has no data. */
  morning: number | null; // 05:00–12:00
  afternoon: number | null; // 12:00–17:00
  evening: number | null; // 17:00–05:00
  /** Hour (0–23) with the highest average among hours with ≥2 logs. */
  peakHour: number | null;
}

export const MIN_DAYS = 3;
export const MIN_LOGS = 8;
export const TRACK_DAYS = 7;

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function windowOf(minuteOfDay: number): 'morning' | 'afternoon' | 'evening' {
  const h = Math.floor(minuteOfDay / 60);
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  return 'evening';
}

export function energyByHour(logs: EnergyLog[]): { hour: number; avg: number; n: number }[] {
  const byHour = new Map<number, number[]>();
  for (const l of logs) {
    const h = Math.floor(l.minuteOfDay / 60);
    byHour.set(h, [...(byHour.get(h) ?? []), l.level]);
  }
  return [...byHour.entries()]
    .map(([hour, xs]) => ({ hour, avg: avg(xs)!, n: xs.length }))
    .sort((a, b) => a.hour - b.hour);
}

/** "Track your energy for a week and identify when you concentrate best."
 *  Broad patterns, not fixed categories — so the thresholds are gentle. */
export function analyzeEnergy(logs: EnergyLog[]): EnergyAnalysis {
  const days = new Set(logs.map((l) => l.date)).size;
  const w = { morning: [] as number[], afternoon: [] as number[], evening: [] as number[] };
  for (const l of logs) w[windowOf(l.minuteOfDay)].push(l.level);
  const morning = avg(w.morning);
  const afternoon = avg(w.afternoon);
  const evening = avg(w.evening);
  const hours = energyByHour(logs).filter((h) => h.n >= 2);
  const peakHour = hours.length
    ? hours.reduce((best, h) => (h.avg > best.avg ? h : best)).hour
    : null;

  const base = { days, logs: logs.length, morning, afternoon, evening, peakHour };
  if (days < MIN_DAYS || logs.length < MIN_LOGS ||
      w.morning.length < 2 || w.afternoon.length < 2 || w.evening.length < 2) {
    return { ...base, kind: 'insufficient' };
  }
  const m = morning!, a = afternoon!, e = evening!;
  let kind: Chronotype;
  if (m - a >= 0.4 && e - a >= 0.4 && Math.abs(m - e) < 0.5) kind = 'mixed';
  else if (m - e >= 0.5 && m >= a) kind = 'morning';
  else if (e - m >= 0.5 && e >= a) kind = 'evening';
  else kind = 'flat';
  return { ...base, kind };
}

export const CHRONOTYPE_TEXT: Record<Chronotype, string> = {
  morning: 'Morning-oriented: you feel alert earlier. Put MITs before noon.',
  evening: 'Evening-oriented: you feel alert later. Guard an evening sprint for MITs.',
  mixed: 'Mixed pattern: a morning peak, an afternoon dip and an evening peak. Two sprints, LITs in the dip.',
  flat: 'No strong pattern yet — keep sprints consistent and watch for a peak.',
  insufficient: `Log your energy a few times a day for a week (${MIN_DAYS}+ days, ${MIN_LOGS}+ check-ins) to see your pattern.`,
};

/** Tracking week: started on first log, still running? */
export function trackingDay(logs: EnergyLog[], today: DateStr): number | null {
  if (logs.length === 0) return null;
  const first = logs.reduce((a, b) => (a.date < b.date ? a : b)).date;
  const d = Math.round((Date.parse(today) - Date.parse(first)) / 86_400_000) + 1;
  return d;
}

// --------------------------------------------------------------- sprints --

export function sprintRemainingMs(s: Pick<Sprint, 'endsAt'>, now: number): number {
  return s.endsAt === null ? 0 : Math.max(0, s.endsAt - now);
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function focusedMinutesToday(sprints: Sprint[], today: DateStr): number {
  return sprints
    .filter((s) => s.date === today && s.status === 'done' && s.startedAt !== null && s.endedAt !== null)
    .reduce((sum, s) => sum + Math.round((s.endedAt! - s.startedAt!) / 60_000), 0);
}

// --------------------------------------------------------- the daily flow --

export interface FlowStep {
  id: string;
  phase: 'Morning' | 'Focus sprint' | 'Afternoon' | 'Evening';
  title: string;
  hint: string;
  /** Level of the framework it comes from. */
  level: string;
}

/** The daily flowchart (also the source of the lock-screen wallpaper). */
export function dailyFlow(p: FocusProfile): (FlowStep & { time: string | null })[] {
  const sprintAt = morningSprintTime(p);
  return [
    { id: 'sleep-check', phase: 'Morning', time: p.wake, level: 'L0', title: 'Slept 7h+? No phone in bed', hint: 'Foundation first: sleep drives attention, memory and mood.' },
    { id: 'everest', phase: 'Morning', time: addMinutes(p.wake, 30), level: 'L2', title: 'Look at your Everest', hint: 'Does today serve your long-term direction? Reject the rest.' },
    { id: 'mits', phase: 'Morning', time: null, level: 'L2', title: 'Pick 1–3 MITs', hint: 'Everything else is a LIT — batch it into small gaps.' },
    { id: 'match', phase: 'Morning', time: null, level: 'L3', title: 'Match work to energy', hint: `MITs at your peaks (${sprintAt}${p.eveningSprint ? ` · ${EVENING_SPRINT_TIME}` : ''}), LITs in the dip (${LIT_BATCH_TIME}).` },
    { id: 'sprint', phase: 'Focus sprint', time: sprintAt, level: 'L4', title: `Focus Sprint · ${p.sprintMinutes} min`, hint: 'Protected block for MIT #1 — phone away, one task, defined end.' },
    { id: 'lits', phase: 'Afternoon', time: LIT_BATCH_TIME, level: 'L2', title: 'Batch LITs', hint: 'Emails, errands, admin, prep for tomorrow.' },
    { id: 'energy', phase: 'Afternoon', time: null, level: 'L3', title: 'Log energy (1–5)', hint: 'A few check-ins a day for a week reveal your peak hours.' },
    ...(p.eveningSprint
      ? [{ id: 'sprint-evening', phase: 'Evening' as const, time: EVENING_SPRINT_TIME, level: 'L4', title: `Evening Sprint · ${p.sprintMinutes} min`, hint: 'MIT #2 at your second peak — same five steps.' }]
      : []),
    { id: 'shutdown', phase: 'Evening', time: addMinutes(p.bed, -60), level: 'L1', title: 'Shutdown: phone away', hint: 'Read or listen instead of scrolling. Note tomorrow’s MITs.' },
    { id: 'lights-out', phase: 'Evening', time: p.bed, level: 'L0', title: 'Lights out', hint: 'Protect 7h+. Tomorrow’s focus starts tonight.' },
  ];
}

export const SPRINT_STEPS = [
  { n: 1, short: 'Schedule', title: 'Schedule the sprint', hint: 'A start time, one important task, a realistic duration, a protected environment.' },
  { n: 2, short: 'Next action', title: 'Define the next action', hint: 'Not “work on website” — “rewrite the headline”. Smaller gap, less hesitation.' },
  { n: 3, short: 'Environment', title: 'Design your environment', hint: 'Silence notifications, phone out of reach, close tabs, clear desk, prepare materials.' },
  { n: 4, short: 'Timer', title: 'Use a visible timer', hint: 'One task, one objective, a defined endpoint. Focused progress, not careless speed.' },
  { n: 5, short: 'Recover', title: 'Close the loop & recover', hint: 'Record what you did, identify the next action, step away from the screen.' },
] as const;

export const ENVIRONMENT_CHECKS = [
  { id: 'notifications', label: 'Silence nonessential notifications', hint: 'Turn on an iOS Focus (Do Not Disturb). Allow only genuinely urgent people.' },
  { id: 'phone', label: 'Phone out of reach', hint: 'Another room if you can. Clarity keeps the time — the sprint’s calendar alert or the chime brings you back.' },
  { id: 'tabs', label: 'Close unrelated tabs & apps', hint: 'Only what this one task needs.' },
  { id: 'desk', label: 'Clear your desk', hint: 'Remove visual attention breakers.' },
  { id: 'materials', label: 'Prepare needed materials', hint: 'Docs, notes, water — no mid-sprint fetching.' },
] as const;

export const RECOVERY_OPTIONS = ['Walk', 'Stretch', 'Sit quietly', 'Look at nature'] as const;

export const EVEREST_QUESTIONS = [
  'What do I want to accomplish over the next decade?',
  'What would I regret never pursuing?',
  'Which goals genuinely matter to me?',
] as const;
