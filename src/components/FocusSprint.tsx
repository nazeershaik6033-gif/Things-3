import {
  createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import type { Sprint, Task } from '../db/models';
import {
  createSprint, finishSprint, logEnergy, startSprint, updateSprint,
} from '../db/mutations';
import { currentDate } from '../app/currentDate';
import { closeSprint, openSprint, showToast, sprintLaunch } from '../app/focusState';
import { useFocusProfile } from '../app/focusProfile';
import { deliverFile } from '../app/deliverFile';
import {
  ENVIRONMENT_CHECKS, RECOVERY_OPTIONS, SPRINT_STEPS, formatClock, isMit, sprintRemainingMs,
} from '../domain/focus';
import { inToday, todaySortKey } from '../domain/smartLists';
import { sprintCalendar } from '../domain/icsWrite';
import { Icon } from '../ui/Icon';
import { Checkbox } from '../ui/Checkbox';

type Stage = 'schedule' | 'action' | 'environment' | 'timer' | 'recover';
const STAGE_INDEX: Record<Stage, number> = { schedule: 1, action: 2, environment: 3, timer: 4, recover: 5 };

// ------------------------------------------------------------ chime/wake --

let audio: AudioContext | undefined;
/** Must run inside a tap so iOS lets us play the end chime later. */
function unlockAudio(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audio ??= new Ctx();
    void audio.resume();
  } catch { /* no audio: the calendar alert still fires */ }
}

function chime(): void {
  if (!audio) return;
  const t0 = audio.currentTime;
  [660, 880, 1320].forEach((freq, i) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.0001, t0 + i * 0.28);
    gain.gain.exponentialRampToValueAtTime(0.35, t0 + i * 0.28 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.28 + 1.2);
    osc.connect(gain).connect(audio!.destination);
    osc.start(t0 + i * 0.28);
    osc.stop(t0 + i * 0.28 + 1.3);
  });
  navigator.vibrate?.([200, 100, 200]);
}

type WakeLockSentinelLike = { release: () => Promise<void> };
function createWakeLock(): { on: () => boolean; set: (v: boolean) => void } {
  const [on, setOn] = createSignal(false);
  let sentinel: WakeLockSentinelLike | null = null;
  const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } };
  const acquire = async () => {
    try {
      sentinel = (await nav.wakeLock?.request('screen')) ?? null;
    } catch { sentinel = null; }
  };
  const onVis = () => {
    if (on() && document.visibilityState === 'visible') void acquire();
  };
  document.addEventListener('visibilitychange', onVis);
  onCleanup(() => {
    document.removeEventListener('visibilitychange', onVis);
    void sentinel?.release();
  });
  return {
    on,
    set: (v) => {
      setOn(v);
      if (v) void acquire();
      else void sentinel?.release().catch(() => {});
    },
  };
}

// --------------------------------------------------------------- shared ---

const pill = (active: boolean): JSX.CSSProperties => ({
  padding: '8px 14px',
  'border-radius': '999px',
  'font-size': '15px',
  'font-weight': '600',
  background: active ? 'var(--blue)' : 'var(--bg-inset)',
  color: active ? 'var(--text-invert)' : 'var(--text)',
});

const primaryBtn: JSX.CSSProperties = {
  width: '100%',
  padding: '15px',
  'border-radius': '14px',
  background: 'var(--blue)',
  color: 'var(--text-invert)',
  'font-size': '17px',
  'font-weight': '600',
};

const secondaryBtn: JSX.CSSProperties = {
  width: '100%',
  padding: '13px',
  'border-radius': '14px',
  background: 'var(--bg-inset)',
  color: 'var(--text)',
  'font-size': '16px',
  'font-weight': '500',
};

const field: JSX.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  'border-radius': '12px',
  background: 'var(--bg-inset)',
  'font-size': '16px',
  'line-height': '1.4',
};

function StepHeader(props: { stage: Stage }): JSX.Element {
  const step = () => SPRINT_STEPS[STAGE_INDEX[props.stage] - 1]!;
  return (
    <div style={{ padding: '4px 0 14px' }}>
      <div style={{ display: 'flex', gap: '5px', 'margin-bottom': '14px' }}>
        <For each={SPRINT_STEPS}>
          {(s) => (
            <div
              style={{
                flex: '1',
                height: '4px',
                'border-radius': '2px',
                background: s.n <= step().n ? 'var(--blue)' : 'var(--bg-inset)',
              }}
            />
          )}
        </For>
      </div>
      <div style={{ 'font-size': '13px', 'font-weight': '700', color: 'var(--blue)', 'letter-spacing': '0.4px', 'text-transform': 'uppercase' }}>
        Step {step().n} of 5
      </div>
      <h2 data-testid="sprint-step-title" style={{ 'font-size': '26px', 'font-weight': '700', margin: '2px 0 6px', color: 'var(--text)' }}>
        {step().title}
      </h2>
      <p style={{ color: 'var(--text-secondary)', 'font-size': '15px', 'line-height': '1.45' }}>{step().hint}</p>
    </div>
  );
}

// ---------------------------------------------------------------- root ----

export function FocusSprint(): JSX.Element {
  return (
    <>
      <Show when={sprintLaunch()}>
        <SprintFlow key={JSON.stringify(sprintLaunch())} />
      </Show>
      <SprintPill />
    </>
  );
}

/** Floating "sprint running" pill while the overlay is minimized. */
function SprintPill(): JSX.Element {
  const running = createLiveQuery(
    () => db.sprints.where('status').equals('running').first(),
    undefined as Sprint | undefined,
  );
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(timer));
  return (
    <Show when={running() && !sprintLaunch()}>
      <button
        data-testid="sprint-pill"
        onClick={() => openSprint({ sprintId: running()!.id })}
        style={{
          position: 'fixed',
          top: 'calc(var(--safe-top) + 8px)',
          left: '50%',
          transform: 'translateX(-50%)',
          'z-index': '80',
          display: 'flex',
          'align-items': 'center',
          gap: '7px',
          padding: '7px 14px',
          'border-radius': '999px',
          background: 'var(--text)',
          color: 'var(--bg)',
          'font-size': '14px',
          'font-weight': '600',
          'font-variant-numeric': 'tabular-nums',
          'box-shadow': 'var(--shadow-card)',
        }}
      >
        <Icon name="target" size={15} />
        {sprintRemainingMs(running()!, now()) > 0 ? formatClock(sprintRemainingMs(running()!, now())) : 'Sprint over — recover'}
      </button>
    </Show>
  );
}

function SprintFlow(_props: { key: string }): JSX.Element {
  const launch = sprintLaunch()!;
  const profile = useFocusProfile();
  const tasks = createLiveQuery(() => db.tasks.toArray(), [] as Task[]);
  const [stage, setStage] = createSignal<Stage>('schedule');
  const [sprintId, setSprintId] = createSignal<string | null>(launch.sprintId ?? null);
  const sprint = createLiveQuery(
    () => (sprintId() ? db.sprints.get(sprintId()!) : undefined),
    undefined as Sprint | undefined,
  );

  // form state
  const [taskId, setTaskId] = createSignal<string | null>(launch.taskId ?? null);
  const [freeTitle, setFreeTitle] = createSignal('');
  const [duration, setDuration] = createSignal<number>(0); // 0 = profile default
  const [later, setLater] = createSignal(false);
  const [laterTime, setLaterTime] = createSignal('');
  const [nextAction, setNextAction] = createSignal('');
  const [env, setEnv] = createSignal<Record<string, boolean>>({});
  const [resetOpen, setResetOpen] = createSignal(false);
  const [note, setNote] = createSignal('');
  const [nextStep, setNextStep] = createSignal('');
  const [markDone, setMarkDone] = createSignal(false);
  const [recovery, setRecovery] = createSignal<string | null>(null);
  const [energyLogged, setEnergyLogged] = createSignal<number | null>(null);
  const wake = createWakeLock();
  const [now, setNow] = createSignal(Date.now());

  const minutes = () => duration() || profile().sprintMinutes;

  // Resume an existing sprint at the right stage
  onMount(async () => {
    if (!launch.sprintId) return;
    const s = await db.sprints.get(launch.sprintId);
    if (!s) return;
    setTaskId(s.taskId);
    setFreeTitle(s.taskId ? '' : s.title);
    setDuration(s.durationMin);
    setNextAction(s.nextAction);
    setNextStep(s.nextAction);
    if (s.status === 'running') setStage(sprintRemainingMs(s, Date.now()) > 0 ? 'timer' : 'recover');
    else if (s.status === 'planned') setStage('action');
  });

  // Candidate to-dos: today's MITs first, then the rest of Today
  const candidates = createMemo(() => {
    const today = currentDate();
    const inT = tasks().filter((t) => inToday(t, today));
    inT.sort((a, b) => {
      const am = isMit(a, today) ? 0 : 1;
      const bm = isMit(b, today) ? 0 : 1;
      if (am !== bm) return am - bm;
      return todaySortKey(a) < todaySortKey(b) ? -1 : 1;
    });
    const pre = taskId() ? tasks().find((t) => t.id === taskId()) : undefined;
    if (pre && !inT.some((t) => t.id === pre.id)) inT.unshift(pre);
    return inT.slice(0, 8);
  });
  const task = createMemo(() => tasks().find((t) => t.id === taskId()) ?? null);
  const title = () => task()?.title || freeTitle().trim() || 'Deep work';
  const checklistIdeas = () => task()?.checklist.filter((c) => !c.completed).slice(0, 4) ?? [];

  // Timer tick (wall-clock based, so backgrounding can't drift it)
  const tick = setInterval(() => setNow(Date.now()), 250);
  onCleanup(() => clearInterval(tick));
  const remaining = () => (sprint() ? sprintRemainingMs(sprint()!, now()) : minutes() * 60_000);
  let chimed = false;
  createEffect(() => {
    if (stage() === 'timer' && sprint()?.status === 'running' && remaining() === 0 && !chimed) {
      chimed = true;
      chime();
      setStage('recover');
    }
  });
  createEffect(() => {
    if (stage() === 'recover' && !nextStep()) setNextStep(nextAction());
    if (stage() !== 'timer' && wake.on()) wake.set(false);
  });

  const ensureSprint = async (): Promise<string> => {
    const patch = {
      taskId: taskId(),
      title: title(),
      durationMin: minutes(),
      nextAction: nextAction().trim(),
    };
    if (sprintId()) {
      await updateSprint(sprintId()!, patch);
      return sprintId()!;
    }
    const id = await createSprint({ ...patch, date: currentDate() });
    setSprintId(id);
    return id;
  };

  const scheduleLater = async () => {
    if (!laterTime()) return;
    const [h, m] = laterTime().split(':').map(Number) as [number, number];
    const start = new Date();
    start.setHours(h, m, 0, 0);
    if (start.getTime() < Date.now()) start.setDate(start.getDate() + 1);
    const id = await ensureSprint();
    await updateSprint(id, { plannedAt: start.getTime() });
    const result = await deliverFile(
      'focus-sprint.ics',
      sprintCalendar({ id, start, durationMin: minutes(), title: title(), nextAction: nextAction() }),
      'text/calendar',
    );
    showToast(result === 'cancelled'
      ? 'Sprint scheduled (no calendar alert added)'
      : `Sprint scheduled for ${laterTime()} — add the file to Calendar for alerts`);
    closeSprint();
  };

  const start = async () => {
    unlockAudio();
    const id = await ensureSprint();
    await startSprint(id);
    chimed = false;
    setStage('timer');
  };

  const finish = async () => {
    const id = sprintId();
    if (!id) return closeSprint();
    await finishSprint(id, { note: note(), nextAction: nextStep(), completeTask: markDone() });
    const extra = markDone() ? 'to-do completed' : nextStep().trim() && task() ? 'next action added to checklist' : 'logged';
    showToast(`Sprint closed — ${extra}. ${recovery() ? `${recovery()} now.` : 'Step away from the screen.'}`, 3200);
    closeSprint();
  };

  const minimizeOrClose = () => {
    if (stage() === 'timer' || stage() === 'recover') closeSprint(); // pill keeps it reachable
    else closeSprint();
  };

  const ringR = 118;
  const ringC = 2 * Math.PI * ringR;
  const progress = () => (sprint()?.durationMin ? 1 - remaining() / (sprint()!.durationMin * 60_000) : 0);

  return (
    <Portal>
      <div
        data-testid="focus-sprint"
        style={{
          position: 'fixed',
          inset: '0',
          'z-index': '90',
          background: 'var(--bg-elevated)',
          display: 'flex',
          'flex-direction': 'column',
          animation: 'fade-in 180ms ease-out',
        }}
      >
        <header style={{ display: 'flex', 'align-items': 'center', padding: 'calc(var(--safe-top) + 6px) 8px 0', 'min-height': '44px' }}>
          <button
            aria-label={stage() === 'timer' ? 'Minimize' : 'Close'}
            data-testid="sprint-close"
            onClick={minimizeOrClose}
            style={{ padding: '10px', color: 'var(--text-secondary)', display: 'flex' }}
          >
            <Icon name={stage() === 'timer' ? 'chevron-down' : 'close'} size={22} />
          </button>
          <div style={{ flex: '1', 'text-align': 'center', 'font-weight': '600', 'font-size': '15px', color: 'var(--text)' }}>
            Focus Sprint
          </div>
          <div style={{ width: '42px' }} />
        </header>

        <div class="screen-scroll" style={{ padding: '8px 20px calc(var(--safe-bottom) + 24px)' }}>
          {/* ----------------------------------------------- 1 schedule */}
          <Show when={stage() === 'schedule'}>
            <StepHeader stage="schedule" />
            <div style={{ 'font-weight': '600', 'font-size': '15px', margin: '0 0 8px', color: 'var(--text)' }}>One important task</div>
            <div style={{ background: 'var(--bg-inset)', 'border-radius': '14px', overflow: 'hidden' }}>
              <For each={candidates()}>
                {(t) => (
                  <button
                    data-testid="sprint-task-option"
                    onClick={() => setTaskId(t.id)}
                    style={{
                      display: 'flex', 'align-items': 'center', gap: '10px', width: '100%',
                      padding: '12px 14px', 'text-align': 'left', 'font-size': '16px', color: 'var(--text)',
                      'border-bottom': '1px solid var(--separator)',
                      background: taskId() === t.id ? 'color-mix(in srgb, var(--blue) 14%, transparent)' : 'transparent',
                    }}
                  >
                    <Show when={isMit(t, currentDate())} fallback={<span style={{ width: '16px' }} />}>
                      <Icon name="star" size={16} color="var(--yellow-deep)" />
                    </Show>
                    <span style={{ flex: '1', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>
                      {t.title || 'New To-Do'}
                    </span>
                    <Show when={taskId() === t.id}>
                      <Icon name="check" size={17} color="var(--blue)" />
                    </Show>
                  </button>
                )}
              </For>
              <div style={{ display: 'flex', 'align-items': 'center', gap: '10px', padding: '4px 14px' }}>
                <Icon name="plus" size={16} color="var(--text-secondary)" />
                <input
                  data-testid="sprint-free-title"
                  value={freeTitle()}
                  placeholder="Or name the focus…"
                  onFocus={() => setTaskId(null)}
                  onInput={(e) => { setTaskId(null); setFreeTitle(e.currentTarget.value); }}
                  style={{ flex: '1', padding: '10px 0', 'font-size': '16px' }}
                />
              </div>
            </div>

            <div style={{ 'font-weight': '600', 'font-size': '15px', margin: '20px 0 8px', color: 'var(--text)' }}>A realistic duration</div>
            <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
              <For each={[25, 45, 60, 90]}>
                {(m) => (
                  <button data-testid={`sprint-duration-${m}`} onClick={() => setDuration(m)} style={pill(minutes() === m)}>
                    {m} min
                  </button>
                )}
              </For>
            </div>
            <p style={{ color: 'var(--text-tertiary)', 'font-size': '13px', margin: '8px 0 0' }}>
              Rebuilding attention? 25–45 min. Consistency beats longer sessions.
            </p>

            <div style={{ 'font-weight': '600', 'font-size': '15px', margin: '20px 0 8px', color: 'var(--text)' }}>A start time</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setLater(false)} style={pill(!later())}>Now</button>
              <button data-testid="sprint-later" onClick={() => setLater(true)} style={pill(later())}>Later today</button>
            </div>
            <Show when={later()}>
              <input
                type="time"
                data-testid="sprint-later-time"
                value={laterTime()}
                onInput={(e) => setLaterTime(e.currentTarget.value)}
                style={{ ...field, 'margin-top': '10px' }}
              />
              <p style={{ color: 'var(--text-tertiary)', 'font-size': '13px', margin: '8px 0 0', 'line-height': '1.45' }}>
                You’ll get a calendar file with two alerts — 5 min before (prepare) and at the end (recover).
                In the share sheet choose <b>Save to Files</b> or <b>Mail</b>, then tap the file and <b>Add All</b>.
              </p>
            </Show>

            <div style={{ height: '22px' }} />
            <Show
              when={later()}
              fallback={
                <button data-testid="sprint-next" style={primaryBtn} onClick={() => setStage('action')}>
                  Next: define the action
                </button>
              }
            >
              <button
                data-testid="sprint-schedule"
                style={{ ...primaryBtn, opacity: laterTime() ? '1' : '0.5' }}
                disabled={!laterTime()}
                onClick={() => void scheduleLater()}
              >
                Schedule &amp; add calendar alerts
              </button>
            </Show>
          </Show>

          {/* --------------------------------------------- 2 next action */}
          <Show when={stage() === 'action'}>
            <StepHeader stage="action" />
            <div style={{ color: 'var(--text-secondary)', 'font-size': '14px', margin: '0 0 6px' }}>
              Task: <b style={{ color: 'var(--text)' }}>{title()}</b>
            </div>
            <textarea
              data-testid="sprint-next-action"
              value={nextAction()}
              rows={3}
              placeholder="The very next concrete action, e.g. “Rewrite the headline”"
              onInput={(e) => setNextAction(e.currentTarget.value)}
              style={field}
            />
            <Show when={checklistIdeas().length > 0}>
              <div style={{ 'font-size': '13px', color: 'var(--text-secondary)', margin: '12px 0 6px' }}>From the checklist</div>
              <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
                <For each={checklistIdeas()}>
                  {(c) => (
                    <button onClick={() => setNextAction(c.title)} style={{ ...pill(nextAction() === c.title), 'font-weight': '500', 'font-size': '14px' }}>
                      {c.title}
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <div style={{ background: 'var(--bg-inset)', 'border-radius': '12px', padding: '12px 14px', margin: '16px 0 0', 'font-size': '14px', 'line-height': '1.5', color: 'var(--text-secondary)' }}>
              Instead of <i>“Work on website”</i>: review the homepage · rewrite the headline · draft the service
              description · test the contact form.
            </div>
            <div style={{ height: '22px' }} />
            <button data-testid="sprint-next" style={primaryBtn} onClick={() => setStage('environment')}>
              Next: set up your environment
            </button>
          </Show>

          {/* --------------------------------------------- 3 environment */}
          <Show when={stage() === 'environment'}>
            <StepHeader stage="environment" />
            <div style={{ background: 'var(--bg-inset)', 'border-radius': '14px', padding: '4px 14px' }}>
              <For each={ENVIRONMENT_CHECKS}>
                {(c) => (
                  <div
                    data-testid={`env-${c.id}`}
                    onClick={() => setEnv((e) => ({ ...e, [c.id]: !e[c.id] }))}
                    style={{ display: 'flex', gap: '14px', padding: '12px 0', 'border-bottom': '1px solid var(--separator)', cursor: 'pointer' }}
                  >
                    <div style={{ 'padding-top': '2px' }}>
                      <Checkbox checked={!!env()[c.id]} onToggle={() => setEnv((e) => ({ ...e, [c.id]: !e[c.id] }))} />
                    </div>
                    <div>
                      <div style={{ 'font-size': '16px', color: 'var(--text)', 'font-weight': '500' }}>{c.label}</div>
                      <div style={{ 'font-size': '13px', color: 'var(--text-secondary)', 'line-height': '1.4', 'margin-top': '2px' }}>{c.hint}</div>
                    </div>
                  </div>
                )}
              </For>
              <div style={{ 'font-size': '13px', color: 'var(--text-secondary)', padding: '12px 0' }}>
                Familiar instrumental music can help. Make focused behavior easier and distraction harder.
              </div>
            </div>
            <div style={{ height: '22px' }} />
            <button data-testid="sprint-start" style={primaryBtn} onClick={() => void start()}>
              Start {minutes()}-min timer
            </button>
          </Show>

          {/* -------------------------------------------------- 4 timer */}
          <Show when={stage() === 'timer'}>
            <StepHeader stage="timer" />
            <div style={{ position: 'relative', width: '270px', height: '270px', margin: '4px auto 10px' }}>
              <svg width="270" height="270" viewBox="0 0 270 270" aria-hidden="true" style={{ display: 'block' }}>
                <circle cx="135" cy="135" r={ringR} fill="none" stroke="var(--bg-inset)" stroke-width="14" />
                <circle
                  cx="135" cy="135" r={ringR} fill="none" stroke="var(--blue)" stroke-width="14"
                  stroke-linecap="round"
                  stroke-dasharray={String(ringC)}
                  stroke-dashoffset={String(ringC * progress())}
                  transform="rotate(-90 135 135)"
                />
              </svg>
              <div
                data-testid="sprint-clock"
                style={{
                  position: 'absolute', inset: '0', display: 'flex', 'align-items': 'center', 'justify-content': 'center',
                  'font-size': '56px', 'font-weight': '700',
                  'font-variant-numeric': 'tabular-nums', color: 'var(--text)', 'letter-spacing': '-1px',
                }}
              >
                {formatClock(remaining())}
              </div>
            </div>
            <div style={{ 'text-align': 'center', 'font-size': '18px', 'font-weight': '600', color: 'var(--text)' }}>{title()}</div>
            <Show when={nextAction().trim()}>
              <div style={{ 'text-align': 'center', 'font-size': '15px', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                Next: {nextAction()}
              </div>
            </Show>

            <div style={{ display: 'flex', gap: '8px', margin: '22px 0 10px' }}>
              <button
                data-testid="sprint-plus5"
                style={secondaryBtn}
                onClick={() => sprint() && void updateSprint(sprint()!.id, { endsAt: (sprint()!.endsAt ?? Date.now()) + 5 * 60_000, durationMin: sprint()!.durationMin + 5 })}
              >
                +5 min
              </button>
              <button data-testid="sprint-stuck" style={secondaryBtn} onClick={() => setResetOpen(true)}>
                Stuck? Reset
              </button>
            </div>
            <button data-testid="sprint-end" style={secondaryBtn} onClick={() => setStage('recover')}>
              End sprint &amp; recover
            </button>

            <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', margin: '18px 2px 0', 'font-size': '14px', color: 'var(--text-secondary)' }}>
              <label style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
                <input type="checkbox" checked={wake.on()} onChange={(e) => wake.set(e.currentTarget.checked)} />
                Keep screen on
              </label>
              <button
                style={{ color: 'var(--blue)', 'font-size': '14px' }}
                onClick={() => sprint() && void deliverFile(
                  'focus-sprint-end.ics',
                  sprintCalendar({
                    id: sprint()!.id,
                    start: new Date(sprint()!.startedAt ?? Date.now()),
                    durationMin: Math.round(((sprint()!.endsAt ?? Date.now()) - (sprint()!.startedAt ?? Date.now())) / 60_000),
                    title: title(),
                    nextAction: nextAction(),
                  }),
                  'text/calendar',
                )}
              >
                End alert via Calendar
              </button>
            </div>
            <p style={{ color: 'var(--text-tertiary)', 'font-size': '12px', 'text-align': 'center', margin: '14px 0 0', 'line-height': '1.45' }}>
              The timer runs on the clock — lock the phone or put it away. Clarity chimes if it’s open;
              your routine’s calendar alert marks the end of scheduled sprints.
            </p>

            <Show when={resetOpen()}>
              <div
                data-testid="reset-card"
                style={{ background: 'var(--bg-inset)', 'border-radius': '14px', padding: '16px', margin: '18px 0 0' }}
              >
                <div style={{ 'font-weight': '700', 'font-size': '17px', color: 'var(--text)', 'margin-bottom': '8px' }}>
                  Use reset to improve thinking
                </div>
                <ol style={{ 'padding-left': '20px', 'font-size': '15px', 'line-height': '1.55', color: 'var(--text)' }}>
                  <li><b>Work on it deliberately.</b> Gather info, explore options, name what’s unclear.</li>
                  <li><b>Step away.</b> A walk, a shower, a simple physical task.</li>
                  <li><b>Return with fresh attention.</b> Review and test new ideas.</li>
                </ol>
                <p style={{ 'font-size': '13px', color: 'var(--text-secondary)', margin: '8px 0 12px' }}>
                  This is incubation. A break doesn’t guarantee insight, but it can change your perspective.
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button style={secondaryBtn} onClick={() => setResetOpen(false)}>Keep going</button>
                  <button
                    data-testid="reset-step-away"
                    style={{ ...secondaryBtn, background: 'var(--blue)', color: 'var(--text-invert)' }}
                    onClick={() => {
                      setNote((n) => n || 'Incubating — stepped away to reset.');
                      setRecovery('Walk');
                      setResetOpen(false);
                      setStage('recover');
                    }}
                  >
                    Step away now
                  </button>
                </div>
              </div>
            </Show>
          </Show>

          {/* ------------------------------------------------ 5 recover */}
          <Show when={stage() === 'recover'}>
            <StepHeader stage="recover" />
            <label style={{ 'font-weight': '600', 'font-size': '15px', color: 'var(--text)' }}>What did you complete?</label>
            <textarea
              data-testid="sprint-note"
              value={note()}
              rows={2}
              placeholder="Record it — progress you can see keeps you going"
              onInput={(e) => setNote(e.currentTarget.value)}
              style={{ ...field, margin: '6px 0 14px' }}
            />
            <Show when={task()}>
              <label style={{ 'font-weight': '600', 'font-size': '15px', color: 'var(--text)' }}>The next action</label>
              <input
                data-testid="sprint-next-step"
                value={nextStep()}
                placeholder="So the next sprint starts concrete"
                onInput={(e) => setNextStep(e.currentTarget.value)}
                style={{ ...field, margin: '6px 0 6px' }}
              />
              <div style={{ 'font-size': '12px', color: 'var(--text-tertiary)', margin: '0 0 12px' }}>
                Added to the top of the to-do’s checklist.
              </div>
              <div
                onClick={() => setMarkDone((v) => !v)}
                style={{ display: 'flex', 'align-items': 'center', gap: '14px', padding: '6px 2px 14px', cursor: 'pointer' }}
              >
                <Checkbox checked={markDone()} onToggle={() => setMarkDone((v) => !v)} />
                <span style={{ 'font-size': '15px', color: 'var(--text)' }}>Mark “{task()!.title}” complete</span>
              </div>
            </Show>

            <div style={{ 'font-weight': '600', 'font-size': '15px', color: 'var(--text)', margin: '4px 0 8px' }}>Recover before you restart</div>
            <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
              <For each={RECOVERY_OPTIONS}>
                {(r) => <button onClick={() => setRecovery(r)} style={{ ...pill(recovery() === r), 'font-weight': '500' }}>{r}</button>}
              </For>
            </div>

            <div style={{ 'font-weight': '600', 'font-size': '15px', color: 'var(--text)', margin: '18px 0 8px' }}>
              Energy right now <span style={{ color: 'var(--text-tertiary)', 'font-weight': '400' }}>(optional)</span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <For each={[1, 2, 3, 4, 5]}>
                {(n) => (
                  <button
                    onClick={() => { void logEnergy(n); setEnergyLogged(n); }}
                    style={{ ...pill(energyLogged() === n), flex: '1', padding: '10px 0' }}
                  >
                    {n}
                  </button>
                )}
              </For>
            </div>

            <div style={{ height: '24px' }} />
            <button data-testid="sprint-finish" style={primaryBtn} onClick={() => void finish()}>
              Close the loop
            </button>
          </Show>
        </div>
      </div>
    </Portal>
  );
}
