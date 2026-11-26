import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import type { HealthDay } from '../db/models';
import { saveHealth, setSetting } from '../db/mutations';
import { currentDate } from '../app/currentDate';
import { showToast } from '../app/focusState';
import { useFocusProfile } from '../app/focusProfile';
import {
  adviseDay, bedtimeOffset, DEFAULT_GOALS, formatDuration, GOOD_NIGHT_MIN, manualNight, mergeActivity,
  normalizeGoals, parseHealthPayload, ringProgress, sleepScore, type ActivityGoals,
} from '../domain/health';
import { addDays } from '../domain/dates';
import { Sheet, SheetTitle } from '../ui/Sheet';
import { Icon } from '../ui/Icon';

/** Apple Watch sleep + activity on Daily Focus (Level 0: the foundation). */

export const SHORTCUT_NAME = 'Clarity Health';
export const SHORTCUT_RUN_URL = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}`;

export function useHealthDays(): () => HealthDay[] {
  return createLiveQuery(() => db.healthDays.toArray(), [] as HealthDay[]);
}

export function useGoals(): () => ActivityGoals {
  const row = createLiveQuery(() => db.settings.get('activityGoals'), undefined);
  return createMemo(() => normalizeGoals(row()?.value as Partial<ActivityGoals> | undefined));
}

/** Apply a parsed Shortcut payload; returns a one-line summary. */
export async function importHealthText(text: string): Promise<string> {
  const p = parseHealthPayload(text);
  for (const n of p.nights) await saveHealth(n.date, { sleep: n.night }, 'shortcut');
  if (p.activity) await saveHealth(p.activity.date, { activity: p.activity.values }, 'shortcut', mergeActivity);
  const parts: string[] = [];
  const last = p.nights[p.nights.length - 1];
  if (last) parts.push(`${formatDuration(last.night.asleepMin)} sleep`);
  if (p.activity) {
    const a = p.activity.values;
    parts.push([a.moveKcal != null ? `${a.moveKcal} kcal` : '', a.exerciseMin != null ? `${a.exerciseMin} min` : '', a.standHr != null ? `${a.standHr} hr` : ''].filter(Boolean).join(' · '));
  }
  return `Synced: ${parts.filter(Boolean).join(' · ')}`;
}

const btn = (primary: boolean): JSX.CSSProperties => ({
  flex: '1', padding: '11px 8px', 'border-radius': '12px', 'font-size': 'calc(14px * var(--ts))', 'font-weight': 'var(--fw-600)',
  background: primary ? 'var(--blue)' : 'var(--bg-inset)', color: primary ? 'var(--text-invert)' : 'var(--text)',
  display: 'inline-flex', 'align-items': 'center', 'justify-content': 'center', gap: '6px', 'text-decoration': 'none',
});
const field: JSX.CSSProperties = {
  width: '100%', padding: '10px 12px', 'border-radius': '11px', background: 'var(--bg-inset)', 'font-size': 'calc(16px * var(--ts))', color: 'var(--text)',
};
const small: JSX.CSSProperties = { 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-secondary)', 'margin-bottom': '4px', 'font-weight': 'var(--fw-600)' };

// ---------------------------------------------------------------- rings ---

function Rings(props: { move: number; exercise: number; stand: number; size?: number }): JSX.Element {
  const size = () => props.size ?? 92;
  const ring = (r: number, p: number, color: string) => {
    const c = 2 * Math.PI * r;
    return (
      <>
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} stroke-opacity="0.2" stroke-width="9" />
        <circle
          cx="50" cy="50" r={r} fill="none" stroke={color} stroke-width="9" stroke-linecap="round"
          stroke-dasharray={`${c * Math.min(1, p)} ${c}`} transform="rotate(-90 50 50)"
        />
      </>
    );
  };
  return (
    <svg width={size()} height={size()} viewBox="0 0 100 100" aria-hidden="true" style={{ flex: 'none' }}>
      {ring(43, props.move, 'var(--red)')}
      {ring(32, props.exercise, 'var(--green)')}
      {ring(21, props.stand, 'var(--teal)')}
    </svg>
  );
}

// ----------------------------------------------------------- sleep chart --

/** Hours asleep, last 14 nights, with a 7h reference line. One series. */
function SleepChart(props: { days: HealthDay[]; today: string; targetBed: string }): JSX.Element {
  const nights = createMemo(() => {
    const out: { date: string; min: number | null; onset: string | null }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = addDays(props.today, -i);
      const h = props.days.find((x) => x.date === d);
      out.push({ date: d, min: h?.sleep?.asleepMin ?? null, onset: h?.sleep?.onset ?? null });
    }
    return out;
  });
  const [sel, setSel] = createSignal<string | null>(null);
  const MAX = 10 * 60;
  const selected = () => nights().find((n) => n.date === sel() && n.min !== null);
  return (
    <figure aria-label="Hours asleep, last 14 nights" style={{ margin: '12px 0 0' }}>
      <div style={{ position: 'relative', height: '84px', display: 'flex', 'align-items': 'flex-end', gap: '3px', 'border-bottom': '1px solid var(--separator)' }}>
        <div style={{ position: 'absolute', left: '0', right: '0', bottom: `${(GOOD_NIGHT_MIN / MAX) * 100}%`, 'border-top': '1px dashed var(--text-tertiary)' }} />
        <span style={{ position: 'absolute', right: '0', bottom: `calc(${(GOOD_NIGHT_MIN / MAX) * 100}% + 2px)`, 'font-size': 'calc(10px * var(--ts))', color: 'var(--text-secondary)' }}>7h</span>
        <For each={nights()}>
          {(n) => (
            <div
              onClick={() => setSel(sel() === n.date ? null : n.date)}
              onPointerEnter={() => setSel(n.date)}
              onPointerLeave={() => setSel(null)}
              style={{ flex: '1', height: '100%', display: 'flex', 'align-items': 'flex-end', cursor: n.min !== null ? 'pointer' : 'default' }}
            >
              <Show when={n.min !== null}>
                <div style={{
                  width: '100%', height: `${Math.min(1, n.min! / MAX) * 100}%`, background: 'var(--blue)',
                  opacity: sel() === null || sel() === n.date ? '1' : '0.45', 'border-radius': '4px 4px 0 0',
                }} />
              </Show>
            </div>
          )}
        </For>
        <Show when={selected()}>
          <div style={{
            position: 'absolute', top: '-4px', left: '50%', transform: 'translateX(-50%)', background: 'var(--bg-elevated)',
            'box-shadow': 'var(--shadow-card)', 'border-radius': '8px', padding: '4px 8px', 'font-size': 'calc(12px * var(--ts))',
            color: 'var(--text)', 'white-space': 'nowrap', 'pointer-events': 'none',
          }}>
            {selected()!.date.slice(5)} · {formatDuration(selected()!.min!)} · asleep {selected()!.onset}
          </div>
        </Show>
      </div>
      <div style={{ display: 'flex', 'justify-content': 'space-between', 'font-size': 'calc(11px * var(--ts))', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
        <span>{nights()[0]!.date.slice(5)}</span><span>last night</span>
      </div>
    </figure>
  );
}

// ------------------------------------------------------------- the card ---

export function HealthCard(): JSX.Element {
  const profile = useFocusProfile();
  const days = useHealthDays();
  const goals = useGoals();
  const today = () => currentDate();
  const todayRow = createMemo(() => days().find((d) => d.date === today()) ?? null);
  const night = () => todayRow()?.sleep ?? null;
  const score = createMemo(() => (night() ? sleepScore(night()!, profile().bed) : null));
  const advice = createMemo(() => adviseDay(night(), profile().bed, profile().sprintMinutes));
  const rings = createMemo(() => ringProgress(todayRow()?.activity ?? null, goals()));
  const yesterday = createMemo(() => days().find((d) => d.date === addDays(today(), -1))?.activity ?? null);
  const [sheet, setSheet] = createSignal<'sync' | 'manual' | 'guide' | 'goals' | null>(null);

  const offset = () => (night() ? bedtimeOffset(night()!.onset, profile().bed) : 0);

  return (
    <section data-testid="health-card" style={{ margin: '0 12px 14px', background: 'var(--bg-list)', 'border-radius': '14px', padding: '14px 16px' }}>
      <div style={{ display: 'flex', 'align-items': 'center', 'margin-bottom': '10px' }}>
        <h2 style={{ flex: '1', 'font-size': 'calc(13px * var(--ts))', 'font-weight': 'var(--fw-700)', color: 'var(--text-secondary)', 'text-transform': 'uppercase', 'letter-spacing': '0.4px' }}>
          Sleep &amp; activity
        </h2>
        <button onClick={() => setSheet('guide')} style={{ 'font-size': 'calc(13px * var(--ts))', color: 'var(--blue)' }}>Shortcut setup</button>
      </div>

      {/* ---------------- sleep ---------------- */}
      <Show
        when={night() && score()}
        fallback={
          <div data-testid="no-sleep" style={{ 'font-size': 'calc(15px * var(--ts))', color: 'var(--text-secondary)', 'line-height': 'calc(1.45 * var(--lh))' }}>
            No sleep data for last night yet. Sync from your Apple Watch or enter it by hand.
          </div>
        }
      >
        <div style={{ display: 'flex', gap: '14px', 'align-items': 'center' }}>
          <div
            data-testid="sleep-score"
            aria-label={`Clarity sleep score ${score()!.total}, ${score()!.label}`}
            style={{
              width: '68px', height: '68px', 'border-radius': '50%', border: '6px solid var(--blue)', display: 'flex',
              'align-items': 'center', 'justify-content': 'center', 'font-size': 'calc(24px * var(--ts))', 'font-weight': 'var(--fw-700)', color: 'var(--text)', flex: 'none',
            }}
          >
            {score()!.total}
          </div>
          <div style={{ 'min-width': '0' }}>
            <div style={{ 'font-size': 'calc(20px * var(--ts))', 'font-weight': 'var(--fw-700)', color: 'var(--text)' }}>{score()!.label}</div>
            <div style={{ 'font-size': 'calc(13px * var(--ts))', color: 'var(--text-secondary)' }}>Clarity sleep score · not Apple’s, but built the same way</div>
          </div>
        </div>
        <div style={{ display: 'grid', 'grid-template-columns': '1fr auto', gap: '6px 10px', margin: '12px 0 0', 'font-size': 'calc(14px * var(--ts))' }}>
          <span style={{ color: 'var(--text)' }}>Duration · <b data-testid="sleep-duration">{formatDuration(night()!.asleepMin)}</b></span>
          <span style={{ color: 'var(--text-secondary)', 'font-variant-numeric': 'tabular-nums' }}>{score()!.duration}/50</span>
          <span style={{ color: 'var(--text)' }}>
            Bedtime · {night()!.onset}{' '}
            <span style={{ color: 'var(--text-secondary)' }}>
              ({Math.abs(offset()) <= 15 ? 'on target' : `${formatDuration(Math.abs(offset()))} ${offset() > 0 ? 'late' : 'early'}`} vs {profile().bed})
            </span>
          </span>
          <span style={{ color: 'var(--text-secondary)', 'font-variant-numeric': 'tabular-nums' }}>{score()!.bedtime}/30</span>
          <span style={{ color: 'var(--text)' }}>Interruptions · {night()!.wakeups} wake-ups, {night()!.awakeMin}m</span>
          <span style={{ color: 'var(--text-secondary)', 'font-variant-numeric': 'tabular-nums' }}>{score()!.interruptions}/20</span>
        </div>
        <Show when={advice()}>
          <div
            data-testid="day-advice"
            style={{
              margin: '12px 0 0', padding: '10px 12px', 'border-radius': '11px', 'font-size': 'calc(14px * var(--ts))', 'line-height': 'calc(1.45 * var(--lh))',
              background: advice()!.shortNight ? 'color-mix(in srgb, var(--yellow) 22%, transparent)' : 'var(--bg-inset)', color: 'var(--text)',
            }}
          >
            {advice()!.message}
          </div>
        </Show>
      </Show>
      <SleepChart days={days()} today={today()} targetBed={profile().bed} />

      {/* ---------------- rings ---------------- */}
      <div style={{ display: 'flex', gap: '14px', 'align-items': 'center', margin: '16px 0 0' }}>
        <Rings move={rings().move} exercise={rings().exercise} stand={rings().stand} />
        <div data-testid="rings" style={{ display: 'grid', 'grid-template-columns': 'auto 1fr', gap: '4px 10px', 'font-size': 'calc(14px * var(--ts))', 'align-items': 'baseline' }}>
          <span style={{ color: 'var(--text-secondary)' }}><span style={{ color: 'var(--red)' }}>●</span> Move</span>
          <span style={{ color: 'var(--text)', 'font-variant-numeric': 'tabular-nums' }}><b>{todayRow()?.activity?.moveKcal ?? '–'}</b> / {goals().moveKcal} kcal</span>
          <span style={{ color: 'var(--text-secondary)' }}><span style={{ color: 'var(--green)' }}>●</span> Exercise</span>
          <span style={{ color: 'var(--text)', 'font-variant-numeric': 'tabular-nums' }}><b>{todayRow()?.activity?.exerciseMin ?? '–'}</b> / {goals().exerciseMin} min</span>
          <span style={{ color: 'var(--text-secondary)' }}><span style={{ color: 'var(--teal)' }}>●</span> Stand</span>
          <span style={{ color: 'var(--text)', 'font-variant-numeric': 'tabular-nums' }}><b>{todayRow()?.activity?.standHr ?? '–'}</b> / {goals().standHr} hr</span>
        </div>
      </div>
      <div style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)', margin: '6px 0 0' }}>
        Today so far.
        <Show when={yesterday()}>
          {' '}Yesterday: {yesterday()!.moveKcal ?? '–'} kcal · {yesterday()!.exerciseMin ?? '–'} min · {yesterday()!.standHr ?? '–'} hr.
        </Show>
        {' '}<button onClick={() => setSheet('goals')} style={{ color: 'var(--blue)', 'font-size': 'calc(12px * var(--ts))' }}>Goals</button>
      </div>

      <div style={{ display: 'flex', gap: '8px', margin: '14px 0 0' }}>
        <button data-testid="health-sync" style={btn(true)} onClick={() => setSheet('sync')}>
          <Icon name="repeat" size={15} /> Sync Watch
        </button>
        <button data-testid="health-manual" style={btn(false)} onClick={() => setSheet('manual')}>
          <Icon name="pencil" size={15} /> Enter by hand
        </button>
      </div>

      <Show when={sheet() === 'sync'}><SyncSheet onClose={() => setSheet(null)} onGuide={() => setSheet('guide')} /></Show>
      <Show when={sheet() === 'manual'}><ManualSheet onClose={() => setSheet(null)} /></Show>
      <Show when={sheet() === 'guide'}><GuideSheet onClose={() => setSheet(null)} /></Show>
      <Show when={sheet() === 'goals'}><GoalsSheet goals={goals()} onClose={() => setSheet(null)} /></Show>
    </section>
  );
}

// ------------------------------------------------------------- sheets -----

function SyncSheet(props: { onClose: () => void; onGuide: () => void }): JSX.Element {
  const [text, setText] = createSignal('');
  const [error, setError] = createSignal('');
  const apply = async (raw: string) => {
    try {
      const msg = await importHealthText(raw);
      showToast(msg, 3200);
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that.');
    }
  };
  const paste = async () => {
    setError('');
    try {
      const raw = await navigator.clipboard.readText();
      await apply(raw);
    } catch {
      setError('Clarity couldn’t read the clipboard. Long-press the box below and choose Paste.');
    }
  };
  return (
    <Sheet onClose={props.onClose} trackKeyboard>
      <SheetTitle>Sync from Apple Watch</SheetTitle>
      <div data-testid="sync-sheet" style={{ padding: '0 18px 18px' }}>
        <ol style={{ 'padding-left': '20px', 'font-size': 'calc(14px * var(--ts))', color: 'var(--text-secondary)', 'line-height': 'calc(1.55 * var(--lh))', margin: '0 0 12px' }}>
          <li>Run the <b>{SHORTCUT_NAME}</b> shortcut. It copies last night’s sleep and today’s rings.</li>
          <li>Come back here and tap <b>Paste</b>.</li>
        </ol>
        <div style={{ display: 'flex', gap: '8px' }}>
          <a data-testid="run-shortcut" href={SHORTCUT_RUN_URL} style={btn(false)}>
            <Icon name="play" size={15} /> 1 · Run shortcut
          </a>
          <button data-testid="paste-health" style={btn(true)} onClick={() => void paste()}>2 · Paste</button>
        </div>
        <textarea
          data-testid="health-text"
          rows={3}
          value={text()}
          placeholder="…or paste the copied text here"
          onInput={(e) => setText(e.currentTarget.value)}
          style={{ ...field, margin: '12px 0 0', 'font-size': 'calc(13px * var(--ts))', 'font-family': 'ui-monospace, monospace' }}
        />
        <Show when={text().trim()}>
          <button data-testid="apply-health-text" style={{ ...btn(true), width: '100%', margin: '8px 0 0' }} onClick={() => void apply(text())}>
            Import pasted text
          </button>
        </Show>
        <Show when={error()}>
          <div data-testid="sync-error" style={{ color: 'var(--red)', 'font-size': 'calc(13px * var(--ts))', margin: '10px 0 0' }}>{error()}</div>
        </Show>
        <p style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)', margin: '12px 0 0', 'line-height': 'calc(1.5 * var(--lh))' }}>
          Sync in the morning for sleep and again at your evening shutdown for the day’s rings. Rings only ever go up,
          so syncing twice never loses anything. No shortcut yet?{' '}
          <button onClick={props.onGuide} style={{ color: 'var(--blue)', 'font-size': 'calc(12px * var(--ts))' }}>Set it up</button>
        </p>
      </div>
    </Sheet>
  );
}

function ManualSheet(props: { onClose: () => void }): JSX.Element {
  const profile = useFocusProfile();
  const today = currentDate();
  const [date, setDate] = createSignal(today);
  const [hours, setHours] = createSignal('');
  const [mins, setMins] = createSignal('');
  const [onset, setOnset] = createSignal<string>(profile().bed);
  const [wakeups, setWakeups] = createSignal('');
  const [awake, setAwake] = createSignal('');
  const [move, setMove] = createSignal('');
  const [exercise, setExercise] = createSignal('');
  const [stand, setStand] = createSignal('');
  const num = (v: string) => (v.trim() === '' ? null : Number(v));

  const save = async () => {
    const h = num(hours());
    const m = num(mins());
    if (h !== null || m !== null) {
      await saveHealth(date(), {
        sleep: manualNight({ asleepMin: (h ?? 0) * 60 + (m ?? 0), onset: onset() || profile().bed, awakeMin: num(awake()) ?? 0, wakeups: num(wakeups()) ?? 0 }),
      }, 'manual');
    }
    if (move().trim() || exercise().trim() || stand().trim()) {
      await saveHealth(date(), { activity: { moveKcal: num(move()), exerciseMin: num(exercise()), standHr: num(stand()) } }, 'manual');
    }
    showToast('Saved');
    props.onClose();
  };

  const input = (testid: string, value: () => string, set: (v: string) => void, placeholder: string, mode: 'numeric' | 'decimal' = 'numeric') => (
    <input data-testid={testid} type="number" inputmode={mode} value={value()} placeholder={placeholder} onInput={(e) => set(e.currentTarget.value)} style={field} />
  );

  return (
    <Sheet onClose={props.onClose} trackKeyboard>
      <SheetTitle>Enter by hand</SheetTitle>
      <div data-testid="manual-sheet" style={{ padding: '0 18px 18px', 'max-height': '72vh', overflow: 'auto' }}>
        <div style={small}>Day (the morning you woke up)</div>
        <input data-testid="manual-date" type="date" value={date()} max={today} onInput={(e) => setDate(e.currentTarget.value || today)} style={field} />
        <div style={{ ...small, margin: '14px 0 4px' }}>SLEEP — from the Sleep app on your Watch</div>
        <div style={{ display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '8px' }}>
          {input('manual-hours', hours, setHours, 'Hours')}
          {input('manual-mins', mins, setMins, 'Minutes')}
          <div><div style={small}>Fell asleep</div><input data-testid="manual-onset" type="time" value={onset()} onInput={(e) => setOnset(e.currentTarget.value)} style={field} /></div>
          <div><div style={small}>Wake-ups</div>{input('manual-wakeups', wakeups, setWakeups, '0')}</div>
          <div><div style={small}>Minutes awake</div>{input('manual-awake', awake, setAwake, '0')}</div>
        </div>
        <div style={{ ...small, margin: '14px 0 4px' }}>RINGS</div>
        <div style={{ display: 'grid', 'grid-template-columns': '1fr 1fr 1fr', gap: '8px' }}>
          {input('manual-move', move, setMove, 'Move kcal')}
          {input('manual-exercise', exercise, setExercise, 'Exercise min')}
          {input('manual-stand', stand, setStand, 'Stand hr')}
        </div>
        <button data-testid="manual-save" onClick={() => void save()} style={{ ...btn(true), width: '100%', padding: '14px', margin: '16px 0 0', 'font-size': 'calc(16px * var(--ts))' }}>
          Save
        </button>
      </div>
    </Sheet>
  );
}

function GoalsSheet(props: { goals: ActivityGoals; onClose: () => void }): JSX.Element {
  const [g, setG] = createSignal({ ...props.goals });
  const row = (key: keyof ActivityGoals, label: string) => (
    <label style={{ display: 'grid', 'grid-template-columns': '1fr 110px', 'align-items': 'center', gap: '10px', margin: '0 0 8px', 'font-size': 'calc(15px * var(--ts))', color: 'var(--text)' }}>
      {label}
      <input type="number" inputmode="numeric" value={g()[key]} onInput={(e) => setG({ ...g(), [key]: Number(e.currentTarget.value) })} style={field} />
    </label>
  );
  return (
    <Sheet onClose={props.onClose} trackKeyboard>
      <SheetTitle>Ring goals</SheetTitle>
      <div style={{ padding: '0 18px 18px' }}>
        <p style={{ 'font-size': 'calc(13px * var(--ts))', color: 'var(--text-secondary)', margin: '0 0 12px' }}>Use the same goals as the Activity app on your Watch.</p>
        {row('moveKcal', 'Move (kcal)')}
        {row('exerciseMin', 'Exercise (min)')}
        {row('standHr', 'Stand (hr)')}
        <button
          onClick={() => { void setSetting('activityGoals', normalizeGoals(g())); props.onClose(); }}
          style={{ ...btn(true), width: '100%', padding: '13px', margin: '8px 0 0' }}
        >
          Save
        </button>
        <button onClick={() => setG({ ...DEFAULT_GOALS })} style={{ width: '100%', padding: '10px', color: 'var(--text-secondary)', 'font-size': 'calc(14px * var(--ts))' }}>
          Reset to 400 / 30 / 12
        </button>
      </div>
    </Sheet>
  );
}

/** Building the Shortcut, step by step. Clarity can't create it for you:
 *  iOS only installs shortcuts that a person builds or that are shared from
 *  an iCloud link. */
function GuideSheet(props: { onClose: () => void }): JSX.Element {
  const step = (n: number, body: JSX.Element) => (
    <li style={{ display: 'flex', gap: '10px', margin: '0 0 12px' }}>
      <span style={{ flex: 'none', width: '22px', height: '22px', 'border-radius': '50%', background: 'var(--blue)', color: 'var(--text-invert)', 'font-size': 'calc(12px * var(--ts))', 'font-weight': 'var(--fw-700)', display: 'flex', 'align-items': 'center', 'justify-content': 'center' }}>{n}</span>
      <div style={{ 'font-size': 'calc(14px * var(--ts))', 'line-height': 'calc(1.5 * var(--lh))', color: 'var(--text)' }}>{body}</div>
    </li>
  );
  const code: JSX.CSSProperties = { 'font-family': 'ui-monospace, monospace', 'font-size': 'calc(12.5px * var(--ts))', background: 'var(--bg-inset)', padding: '1px 5px', 'border-radius': '5px' };
  return (
    <Sheet onClose={props.onClose}>
      <SheetTitle>Set up the “{SHORTCUT_NAME}” shortcut</SheetTitle>
      <div data-testid="guide-sheet" style={{ padding: '0 18px 18px', 'max-height': '74vh', overflow: 'auto' }}>
        <p style={{ 'font-size': 'calc(13px * var(--ts))', color: 'var(--text-secondary)', margin: '0 0 14px', 'line-height': 'calc(1.5 * var(--lh))' }}>
          About 10 minutes, once. Open the <b>Shortcuts</b> app → <b>+</b>, name it exactly <span style={code}>{SHORTCUT_NAME}</span>,
          then add these actions in order. iOS asks for Health permission the first time it runs.
        </p>
        <ol style={{ 'list-style': 'none', padding: '0', margin: '0' }}>
          {step(1, <><b>Find Health Samples</b> → Type: <b>Sleep</b> (Sleep Analysis). Filter: <b>Start Date is in the last 1 day</b>. Sort by Start Date, oldest first.</>)}
          {step(2, <><b>Repeat with Each</b> item in Health Samples. Inside it add <b>Text</b>: <span style={code}>Start Date|End Date|Value</span> — insert each as the Repeat Item’s property; for both dates tap the variable → Date Format <b>ISO 8601</b>.</>)}
          {step(3, <>After <b>End Repeat</b>: <b>Combine Text</b> (Repeat Results) with <b>New Lines</b>.</>)}
          {step(4, <><b>Find Health Samples</b> → <b>Active Energy</b>, Start Date <b>is today</b>, <b>Group By: Day</b>. Then <b>Get Details of Health Sample</b> → <b>Value</b>.</>)}
          {step(5, <>Repeat step 4 for <b>Exercise Minutes</b>, and for <b>Stand Hours</b> if your list has it (skip it otherwise — type stand hours by hand).</>)}
          {step(6, <><b>Dictionary</b> with keys: <span style={code}>v</span> = 1, <span style={code}>date</span> = Current Date (Custom format <span style={code}>yyyy-MM-dd</span>), <span style={code}>sleep</span> = Combined Text, <span style={code}>move</span>, <span style={code}>exercise</span>, <span style={code}>stand</span> = the three Values.</>)}
          {step(7, <><b>Copy to Clipboard</b> (Dictionary). Optional: <b>Show Notification</b> “Copied — back to Clarity”.</>)}
        </ol>
        <p style={{ 'font-size': 'calc(13px * var(--ts))', color: 'var(--text-secondary)', 'line-height': 'calc(1.5 * var(--lh))', margin: '4px 0 0' }}>
          Labels can differ slightly between iOS versions. Clarity is lenient: it accepts Core/Deep/REM/Asleep/Awake/In Bed labels,
          values with units (“337 kcal”), and plain sample lines without the Dictionary. If something’s missing, <b>Enter by hand</b> fills the gap.
        </p>
        <p style={{ 'font-size': 'calc(13px * var(--ts))', color: 'var(--text-secondary)', 'line-height': 'calc(1.5 * var(--lh))', margin: '10px 0 0' }}>
          Your health data never leaves your phone: the Shortcut copies it, Clarity stores it on-device, and it’s included in your backup.
        </p>
      </div>
    </Sheet>
  );
}

