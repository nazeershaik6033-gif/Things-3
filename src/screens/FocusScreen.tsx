import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import type { EnergyLog, Sprint, Task } from '../db/models';
import { deleteSprint, logEnergy, setSetting } from '../db/mutations';
import { currentDate } from '../app/currentDate';
import { push } from '../app/navigation';
import { openSprint, showToast } from '../app/focusState';
import { flowKey, saveFocusProfile, useEverest, useFocusProfile } from '../app/focusProfile';
import { appAssetUrl, deliverFile } from '../app/deliverFile';
import {
  BED_CHOICES, CHRONOTYPE_TEXT, EVEREST_QUESTIONS, SPRINT_CHOICES, SPRINT_STEPS, WAKE_CHOICES,
  MAX_SPRINT, MIN_SPRINT, eveningSprintTime, isPresetProfile, morningSprintTime,
  analyzeEnergy, dailyFlow, energyByHour, focusedMinutesToday, isMit, routineFileName, routineItems,
  trackingDay, TRACK_DAYS, type FocusProfile,
} from '../domain/focus';
import { routineCalendar } from '../domain/icsWrite';
import { addDays } from '../domain/dates';
import { Icon } from '../ui/Icon';
import { Checkbox } from '../ui/Checkbox';
import { ScreenChrome } from './common';
import { HealthCard, useGoals, useHealthDays } from '../components/HealthCard';
import { SprintEditSheet } from '../components/SprintEditSheet';
import { focusInsights, formatDuration, GOOD_NIGHT_MIN, sleepScore } from '../domain/health';

function Card(props: { title?: string; trailing?: JSX.Element; children: JSX.Element; testid?: string }): JSX.Element {
  return (
    <section data-testid={props.testid} style={{ margin: '0 12px 14px', background: 'var(--bg-list)', 'border-radius': '14px', padding: '14px 16px' }}>
      <Show when={props.title}>
        <div style={{ display: 'flex', 'align-items': 'center', 'margin-bottom': '10px' }}>
          <h2 style={{ flex: '1', 'font-size': 'calc(13px * var(--ts))', 'font-weight': 'var(--fw-700)', color: 'var(--text-secondary)', 'text-transform': 'uppercase', 'letter-spacing': '0.4px' }}>
            {props.title}
          </h2>
          {props.trailing}
        </div>
      </Show>
      {props.children}
    </section>
  );
}

const chip = (active: boolean): JSX.CSSProperties => ({
  padding: '6px 12px',
  'border-radius': '999px',
  'font-size': 'calc(14px * var(--ts))',
  'font-weight': 'var(--fw-600)',
  'font-variant-numeric': 'tabular-nums',
  background: active ? 'var(--blue)' : 'var(--bg-inset)',
  color: active ? 'var(--text-invert)' : 'var(--text)',
});

const PHASE_COLOR: Record<string, string> = {
  Morning: 'var(--yellow-deep)',
  'Focus sprint': 'var(--blue)',
  Afternoon: 'var(--teal)',
  Evening: 'var(--purple)',
};

export function FocusScreen(): JSX.Element {
  const profile = useFocusProfile();
  const everest = useEverest();
  const tasks = createLiveQuery(() => db.tasks.toArray(), [] as Task[]);
  const sprints = createLiveQuery(() => db.sprints.toArray(), [] as Sprint[]);
  const logs = createLiveQuery(() => db.energyLogs.toArray(), [] as EnergyLog[]);
  const checksRow = createLiveQuery(() => db.settings.get(flowKey(currentDate())), undefined);
  const checks = () => (checksRow()?.value as Record<string, boolean> | undefined) ?? {};
  const [editingEverest, setEditingEverest] = createSignal(false);

  const today = () => currentDate();
  const mitCount = createMemo(() => tasks().filter((t) => isMit(t, today())).length);
  const doneSprints = createMemo(() => sprints().filter((s) => s.date === today() && s.status === 'done').length);
  const todayLogs = createMemo(() => logs().filter((l) => l.date === today()));
  const planned = createMemo(() =>
    sprints()
      .filter((s) => s.status === 'planned' && s.plannedAt !== null && s.plannedAt > Date.now() - 6 * 3600_000)
      .sort((a, b) => a.plannedAt! - b.plannedAt!),
  );

  const healthDays = useHealthDays();
  const goals = useGoals();
  const todayHealth = createMemo(() => healthDays().find((d) => d.date === today()) ?? null);
  const [editSprint, setEditSprint] = createSignal<Sprint | null>(null);
  const [logExpanded, setLogExpanded] = createSignal(false);
  const LOG_PREVIEW = 5;
  const sprintLog = createMemo(() =>
    sprints()
      .filter((s) => (s.status === 'done' || s.status === 'abandoned') && s.startedAt !== null && s.date >= addDays(today(), -13))
      .sort((a, b) => b.startedAt! - a.startedAt!),
  );
  const insights = createMemo(() =>
    focusInsights(healthDays().filter((d) => d.date >= addDays(today(), -59)), sprints(), logs(), goals()),
  );

  const flow = createMemo(() => dailyFlow(profile()));
  /** Auto-derived steps tick themselves off from real activity (Watch data
   *  included); the rest are one-tap checks that reset each day. */
  const isDone = (id: string): boolean => {
    switch (id) {
      case 'sleep-check': {
        const n = todayHealth()?.sleep;
        return n ? n.asleepMin >= GOOD_NIGHT_MIN : !!checks()[id];
      }
      case 'exercise': {
        const m = todayHealth()?.activity?.exerciseMin;
        return m != null ? m >= goals().exerciseMin : !!checks()[id];
      }
      case 'mits': return mitCount() > 0;
      case 'sprint': return doneSprints() >= 1;
      case 'sprint-evening': return doneSprints() >= 2;
      case 'energy': return todayLogs().length > 0;
      default: return !!checks()[id];
    }
  };
  const autoIds = new Set(['mits', 'sprint', 'sprint-evening', 'energy']);
  const isAuto = (id: string) =>
    autoIds.has(id) ||
    (id === 'sleep-check' && !!todayHealth()?.sleep) ||
    (id === 'exercise' && todayHealth()?.activity?.exerciseMin != null);
  /** What the Watch said, shown under the step. */
  const measured = (id: string): string | null => {
    const h = todayHealth();
    if (id === 'sleep-check' && h?.sleep) {
      const sc = sleepScore(h.sleep, profile().bed);
      return `Last night: ${formatDuration(h.sleep.asleepMin)} · asleep ${h.sleep.onset} · score ${sc.total} ${sc.label}`;
    }
    if (id === 'exercise' && h?.activity?.exerciseMin != null) {
      return `Today: ${h.activity.exerciseMin}/${goals().exerciseMin} min exercise`;
    }
    return null;
  };
  const toggle = (id: string) => {
    if (isAuto(id)) return;
    void setSetting(flowKey(today()), { ...checks(), [id]: !checks()[id] });
  };
  const doneCount = () => flow().filter((s) => isDone(s.id)).length;

  // energy
  const recentLogs = createMemo(() => logs().filter((l) => l.date >= addDays(today(), -13)));
  const analysis = createMemo(() => analyzeEnergy(recentLogs()));
  const hours = createMemo(() => energyByHour(recentLogs()));
  const day = () => trackingDay(logs(), today());
  const [hoverHour, setHoverHour] = createSignal<number | null>(null);

  const setProfile = (patch: Partial<FocusProfile>) => void saveFocusProfile({ ...profile(), ...patch });
  const routineUrl = () => appAssetUrl(`cal/${routineFileName(profile())}`);

  return (
    <ScreenChrome
      title="Daily Focus"
      icon={<Icon name="target" size={28} color="var(--blue)" />}
      subtitle={`${doneCount()} of ${flow().length} steps today · ${focusedMinutesToday(sprints(), today())} min focused`}
    >
      {/* ------------------------------------------------------ Everest */}
      <Card testid="everest-card">
        <div style={{ display: 'flex', gap: '12px', 'align-items': 'flex-start' }}>
          <Icon name="mountain" size={28} color="var(--teal)" />
          <div style={{ flex: '1', 'min-width': '0' }}>
            <div style={{ 'font-size': 'calc(13px * var(--ts))', 'font-weight': 'var(--fw-700)', color: 'var(--text-secondary)', 'text-transform': 'uppercase', 'letter-spacing': '0.4px' }}>
              Your Everest
            </div>
            <Show
              when={editingEverest() || !everest()}
              fallback={
                <button
                  data-testid="everest-text"
                  onClick={() => setEditingEverest(true)}
                  style={{ 'text-align': 'left', 'font-size': 'calc(18px * var(--ts))', 'font-weight': 'var(--fw-600)', color: 'var(--text)', 'line-height': 'calc(1.35 * var(--lh))', padding: '4px 0' }}
                >
                  {everest()}
                </button>
              }
            >
              <textarea
                data-testid="everest-input"
                value={everest()}
                rows={2}
                placeholder="The most important long-term direction in your life"
                onBlur={(e) => {
                  void setSetting('everest', e.currentTarget.value.trim());
                  setEditingEverest(false);
                }}
                style={{ width: '100%', 'font-size': 'calc(17px * var(--ts))', padding: '6px 0', 'line-height': 'calc(1.35 * var(--lh))' }}
              />
              <ul style={{ 'padding-left': '18px', 'font-size': 'calc(13px * var(--ts))', color: 'var(--text-secondary)', 'line-height': 'calc(1.55 * var(--lh))' }}>
                <For each={EVEREST_QUESTIONS}>{(q) => <li>{q}</li>}</For>
              </ul>
            </Show>
            <p style={{ 'font-size': 'calc(13px * var(--ts))', color: 'var(--text-tertiary)', margin: '6px 0 0', 'line-height': 'calc(1.45 * var(--lh))' }}>
              Focus is also what you reject. A good opportunity can still be a distraction if it
              takes you away from this.
            </p>
          </div>
        </div>
      </Card>

      {/* ------------------------------------------- sleep + activity */}
      <HealthCard />

      {/* ---------------------------------------------------- flowchart */}
      <Card title="Today’s flow" testid="daily-flow">
        <div style={{ position: 'relative' }}>
          <For each={flow()}>
            {(step, i) => {
              const prevPhase = () => (i() > 0 ? flow()[i() - 1]!.phase : null);
              const done = () => isDone(step.id);
              const last = () => i() === flow().length - 1;
              return (
                <>
                  <Show when={step.phase !== prevPhase()}>
                    <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', margin: i() === 0 ? '0 0 6px' : '6px 0 6px', 'padding-left': '50px' }}>
                      <span style={{ width: '8px', height: '8px', 'border-radius': '50%', background: PHASE_COLOR[step.phase] }} />
                      <span style={{ 'font-size': 'calc(12px * var(--ts))', 'font-weight': 'var(--fw-700)', color: 'var(--text-secondary)', 'text-transform': 'uppercase', 'letter-spacing': '0.5px' }}>
                        {step.phase}
                      </span>
                    </div>
                  </Show>
                  <div data-testid={`flow-${step.id}`} data-done={done() ? 'true' : 'false'} style={{ display: 'flex', 'align-items': 'stretch', gap: '0' }}>
                    {/* time column */}
                    <div style={{ width: '44px', flex: 'none', 'font-size': 'calc(12px * var(--ts))', 'font-weight': 'var(--fw-600)', color: 'var(--text-secondary)', 'font-variant-numeric': 'tabular-nums', 'padding-top': '13px' }}>
                      {step.time ?? ''}
                    </div>
                    {/* connector rail + node */}
                    <div style={{ width: '28px', flex: 'none', display: 'flex', 'flex-direction': 'column', 'align-items': 'center' }}>
                      <div style={{ height: '10px', width: '2px', background: i() === 0 ? 'transparent' : 'var(--separator)' }} />
                      <div
                        onClick={() => toggle(step.id)}
                        style={{
                          width: '22px', height: '22px', 'border-radius': step.id.startsWith('sprint') ? '7px' : '50%',
                          border: `2px solid ${done() ? 'var(--green)' : PHASE_COLOR[step.phase]}`,
                          background: done() ? 'var(--green)' : 'var(--bg-list)',
                          display: 'flex', 'align-items': 'center', 'justify-content': 'center',
                          cursor: isAuto(step.id) ? 'default' : 'pointer', flex: 'none',
                        }}
                      >
                        <Show when={done()}><Icon name="check" size={13} color="#fff" /></Show>
                      </div>
                      <div style={{ flex: '1', width: '2px', background: last() ? 'transparent' : 'var(--separator)', 'min-height': '10px' }} />
                    </div>
                    {/* content */}
                    <div style={{ flex: '1', 'min-width': '0', padding: '9px 0 12px 8px' }}>
                      <div
                        onClick={() => toggle(step.id)}
                        style={{ display: 'flex', 'align-items': 'baseline', gap: '6px', cursor: isAuto(step.id) ? 'default' : 'pointer' }}
                      >
                        <span style={{
                          'font-size': 'calc(16px * var(--ts))', 'font-weight': 'var(--fw-600)', color: done() ? 'var(--text-secondary)' : 'var(--text)',
                          'text-decoration': done() ? 'line-through' : 'none', 'text-decoration-color': 'var(--text-tertiary)',
                        }}>
                          {step.title}
                        </span>
                        <span style={{ 'font-size': 'calc(10px * var(--ts))', 'font-weight': 'var(--fw-700)', color: 'var(--text-tertiary)' }}>{step.level}</span>
                      </div>
                      <div style={{ 'font-size': 'calc(13px * var(--ts))', color: 'var(--text-secondary)', 'line-height': 'calc(1.4 * var(--lh))', margin: '2px 0 0' }}>{step.hint}</div>
                      <Show when={measured(step.id)}>
                        <div data-testid={`measured-${step.id}`} style={{ 'font-size': 'calc(12px * var(--ts))', 'font-weight': 'var(--fw-600)', color: done() ? 'var(--green)' : 'var(--yellow-deep)', margin: '3px 0 0' }}>
                          ⌚ {measured(step.id)}
                        </div>
                      </Show>

                      <Show when={step.id === 'mits'}>
                        <button data-testid="flow-open-today" onClick={() => push({ name: 'list', list: 'today' })} style={{ ...chip(false), margin: '8px 0 0', display: 'inline-flex', 'align-items': 'center', gap: '6px' }}>
                          <Icon name="star" size={13} color="var(--yellow-deep)" /> {mitCount()}/3 picked · Open Today
                        </button>
                      </Show>

                      <Show when={step.id === 'sprint' || step.id === 'sprint-evening'}>
                        {/* the sprint sub-flow: 1 → 5, with the reset branch */}
                        <div style={{ display: 'flex', 'flex-wrap': 'wrap', 'align-items': 'center', gap: '4px', margin: '8px 0 0' }}>
                          <For each={SPRINT_STEPS}>
                            {(s) => (
                              <>
                                <span style={{ 'font-size': 'calc(12px * var(--ts))', 'font-weight': 'var(--fw-600)', padding: '3px 8px', 'border-radius': '6px', background: 'var(--bg-inset)', color: 'var(--text)' }}>
                                  {s.n} {s.short}
                                </span>
                                <Show when={s.n < 5}><span style={{ color: 'var(--text-tertiary)', 'font-size': 'calc(12px * var(--ts))' }}>→</span></Show>
                              </>
                            )}
                          </For>
                        </div>
                        <div style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-secondary)', margin: '6px 0 0', 'border-left': '2px dashed var(--separator)', 'padding-left': '8px' }}>
                          Stuck at 4? <b>Reset</b>: work deliberately → step away → return fresh.
                        </div>
                        <button
                          data-testid={`flow-start-${step.id}`}
                          onClick={() => openSprint({})}
                          style={{ ...chip(true), margin: '8px 0 0', display: 'inline-flex', 'align-items': 'center', gap: '6px' }}
                        >
                          <Icon name="start" size={12} /> Start sprint
                        </button>
                      </Show>

                      <Show when={step.id === 'energy'}>
                        <div style={{ display: 'flex', gap: '6px', margin: '8px 0 0', 'align-items': 'center' }}>
                          <For each={[1, 2, 3, 4, 5]}>
                            {(n) => (
                              <button
                                data-testid={`flow-energy-${n}`}
                                onClick={() => { void logEnergy(n); showToast(`Energy ${n}/5 logged`); }}
                                style={{ ...chip(false), padding: '5px 11px' }}
                              >
                                {n}
                              </button>
                            )}
                          </For>
                          <span style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)' }}>{todayLogs().length} today</span>
                        </div>
                      </Show>
                    </div>
                  </div>
                </>
              );
            }}
          </For>
        </div>
        <div style={{ background: 'var(--bg-inset)', 'border-radius': '12px', padding: '12px 14px', margin: '6px 0 0', 'font-size': 'calc(13px * var(--ts))', 'line-height': 'calc(1.5 * var(--lh))', color: 'var(--text-secondary)' }}>
          <b style={{ color: 'var(--text)' }}>Start here:</b> sufficient sleep · phone away during one important task ·
          one focused session without switching. Repeat until easy, then build the next layer.
        </div>
      </Card>

      {/* ----------------------------------------------- planned sprints */}
      <Show when={planned().length > 0}>
        <Card title="Scheduled sprints">
          <For each={planned()}>
            {(s) => (
              <div data-testid="planned-sprint" style={{ display: 'flex', 'align-items': 'center', gap: '10px', padding: '8px 0', 'border-bottom': '1px solid var(--separator)' }}>
                <button onClick={() => setEditSprint(s)} style={{ display: 'flex', gap: '10px', flex: '1', 'min-width': '0', 'text-align': 'left', 'align-items': 'baseline' }}>
                  <span style={{ 'font-variant-numeric': 'tabular-nums', 'font-weight': 'var(--fw-600)', color: 'var(--text-secondary)', 'font-size': 'calc(14px * var(--ts))', 'white-space': 'nowrap' }}>
                    {new Date(s.plannedAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span style={{ flex: '1', 'font-size': 'calc(15px * var(--ts))', color: 'var(--text)', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>{s.title}</span>
                  <span style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)' }}>{s.durationMin}m · Edit</span>
                </button>
                <button onClick={() => openSprint({ sprintId: s.id })} style={chip(true)}>Start</button>
                <button aria-label="Remove" onClick={() => void deleteSprint(s.id)} style={{ color: 'var(--text-tertiary)', display: 'flex', padding: '4px' }}>
                  <Icon name="close" size={16} />
                </button>
              </div>
            )}
          </For>
        </Card>
      </Show>

      {/* ------------------------------------------------- sprint log */}
      <Card title="Sprint log" testid="sprint-log" trailing={<span style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)' }}>last 14 days · tap to edit</span>}>
        <Show when={sprintLog().length > 0} fallback={<div style={{ 'font-size': 'calc(14px * var(--ts))', color: 'var(--text-secondary)' }}>Finished sprints show up here. Tap one to fix its time, length or note.</div>}>
          <For each={logExpanded() ? sprintLog() : sprintLog().slice(0, LOG_PREVIEW)}>
            {(s, i) => (
              <>
                <Show when={i() === 0 || sprintLog()[i() - 1]!.date !== s.date}>
                  <div style={{ 'font-size': 'calc(12px * var(--ts))', 'font-weight': 'var(--fw-700)', color: 'var(--text-secondary)', margin: i() === 0 ? '0 0 2px' : '10px 0 2px' }}>
                    {s.date === today() ? 'Today' : s.date === addDays(today(), -1) ? 'Yesterday' : s.date}
                  </div>
                </Show>
                <button
                  data-testid="sprint-log-row"
                  onClick={() => setEditSprint(s)}
                  style={{ display: 'flex', gap: '10px', width: '100%', 'text-align': 'left', padding: '7px 0', 'border-bottom': '1px solid var(--separator)', 'align-items': 'baseline', opacity: s.status === 'abandoned' ? '0.55' : '1' }}
                >
                  <span style={{ 'font-variant-numeric': 'tabular-nums', 'font-size': 'calc(13px * var(--ts))', color: 'var(--text-secondary)', width: '66px', flex: 'none', 'white-space': 'nowrap' }}>
                    {new Date(s.startedAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span style={{ flex: '1', 'min-width': '0' }}>
                    <span style={{ display: 'block', 'font-size': 'calc(15px * var(--ts))', color: 'var(--text)', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>{s.title || 'Deep work'}</span>
                    <Show when={s.completedNote}>
                      <span style={{ display: 'block', 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-secondary)', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>{s.completedNote}</span>
                    </Show>
                  </span>
                  <span data-testid="sprint-log-minutes" style={{ 'font-variant-numeric': 'tabular-nums', 'font-size': 'calc(14px * var(--ts))', 'font-weight': 'var(--fw-600)', color: 'var(--text)' }}>
                    {s.status === 'abandoned' ? 'stopped' : `${Math.round((s.endedAt! - s.startedAt!) / 60_000)} min`}
                  </span>
                </button>
              </>
            )}
          </For>
          <Show when={sprintLog().length > LOG_PREVIEW}>
            <button
              data-testid="sprint-log-toggle"
              onClick={() => setLogExpanded((v) => !v)}
              style={{ color: 'var(--blue)', 'font-size': 'calc(14px * var(--ts))', padding: '10px 0 0' }}
            >
              {logExpanded() ? 'Show less' : `Show all ${sprintLog().length}`}
            </button>
          </Show>
        </Show>
      </Card>

      {/* --------------------------------------------- sleep ↔ focus */}
      <Card title="Sleep, movement & focus" testid="insights-card">
        <Show
          when={insights().length > 0}
          fallback={
            <div style={{ 'font-size': 'calc(14px * var(--ts))', color: 'var(--text-secondary)', 'line-height': 'calc(1.45 * var(--lh))' }}>
              After a few days of synced sleep and sprints (at least 3 nights over and 3 under 7h), you’ll see how sleep and
              exercise line up with your focused minutes and energy.
            </div>
          }
        >
          <For each={insights()}>
            {(c) => {
              const max = Math.max(c.good.focusMin, c.poor.focusMin, 1);
              const bar = (g: typeof c.good, strong: boolean) => (
                <div style={{ display: 'grid', 'grid-template-columns': '128px 1fr 54px', 'align-items': 'center', gap: '8px', margin: '4px 0', 'font-size': 'calc(13px * var(--ts))' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{g.label} <span style={{ color: 'var(--text-tertiary)' }}>({g.days}d)</span></span>
                  <div style={{ height: '10px', background: 'var(--bg-inset)', 'border-radius': '5px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(g.focusMin / max) * 100}%`, background: 'var(--blue)', opacity: strong ? '1' : '0.5', 'border-radius': '5px' }} />
                  </div>
                  <span style={{ 'text-align': 'right', color: 'var(--text)', 'font-variant-numeric': 'tabular-nums' }}>{g.focusMin} min</span>
                </div>
              );
              return (
                <div data-testid={`insight-${c.id}`} style={{ margin: '0 0 12px' }}>
                  <div style={{ 'font-size': 'calc(15px * var(--ts))', color: 'var(--text)', 'margin-bottom': '4px' }}>
                    {c.label}: <b>{c.good.focusMin}</b> focused min/day vs <b>{c.poor.focusMin}</b>
                    <Show when={c.good.energy !== null && c.poor.energy !== null}>
                      {' '}· energy {c.good.energy!.toFixed(1)} vs {c.poor.energy!.toFixed(1)}
                    </Show>
                  </div>
                  {bar(c.good, true)}
                  {bar(c.poor, false)}
                </div>
              );
            }}
          </For>
          <div style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)' }}>Same-day averages over the last 60 days — a pattern to notice, not proof of cause.</div>
        </Show>
      </Card>

      {/* --------------------------------------------------- energy */}
      <Card
        title="Energy pattern"
        testid="energy-card"
        trailing={
          <span style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)' }}>
            {day() === null ? 'not started' : day()! <= TRACK_DAYS ? `day ${day()} of ${TRACK_DAYS}` : `${analysis().logs} check-ins`}
          </span>
        }
      >
        <div style={{ 'font-size': 'calc(15px * var(--ts))', color: 'var(--text)', 'margin-bottom': '8px' }}>How’s your energy right now?</div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <For each={[1, 2, 3, 4, 5]}>
            {(n) => (
              <button
                data-testid={`energy-${n}`}
                onClick={() => { void logEnergy(n); showToast(`Energy ${n}/5 logged`); }}
                style={{ ...chip(false), flex: '1', padding: '10px 0', 'font-size': 'calc(16px * var(--ts))' }}
              >
                {n}
              </button>
            )}
          </For>
        </div>
        <div style={{ display: 'flex', 'justify-content': 'space-between', 'font-size': 'calc(11px * var(--ts))', color: 'var(--text-tertiary)', margin: '4px 2px 12px' }}>
          <span>drained</span><span>sharp</span>
        </div>

        <Show when={hours().length > 0}>
          {/* Average energy by hour of day, last 14 days. One series: no legend. */}
          <figure aria-label="Average energy by hour of day, last 14 days" style={{ margin: '0' }}>
            <div style={{ position: 'relative', height: '96px', display: 'flex', 'align-items': 'flex-end', gap: '2px', 'border-bottom': '1px solid var(--separator)' }}>
              <For each={Array.from({ length: 19 }, (_, k) => k + 5)}>
                {(h) => {
                  const d = () => hours().find((x) => x.hour === h);
                  return (
                    <div
                      onPointerEnter={() => setHoverHour(h)}
                      onPointerLeave={() => setHoverHour(null)}
                      onClick={() => setHoverHour(hoverHour() === h ? null : h)}
                      style={{ flex: '1', height: '100%', display: 'flex', 'align-items': 'flex-end', cursor: d() ? 'pointer' : 'default' }}
                    >
                      <Show when={d()}>
                        <div
                          style={{
                            width: '100%',
                            height: `${(d()!.avg / 5) * 100}%`,
                            background: 'var(--blue)',
                            opacity: hoverHour() === null || hoverHour() === h ? '1' : '0.45',
                            'border-radius': '4px 4px 0 0',
                          }}
                        />
                      </Show>
                    </div>
                  );
                }}
              </For>
              <Show when={hoverHour() !== null && hours().find((x) => x.hour === hoverHour())}>
                {(() => {
                  const d = () => hours().find((x) => x.hour === hoverHour())!;
                  return (
                    <div style={{
                      position: 'absolute', top: '0', left: `${((hoverHour()! - 5) / 19) * 100}%`, transform: 'translateX(-30%)',
                      background: 'var(--bg-elevated)', 'box-shadow': 'var(--shadow-card)', 'border-radius': '8px',
                      padding: '4px 8px', 'font-size': 'calc(12px * var(--ts))', color: 'var(--text)', 'white-space': 'nowrap', 'pointer-events': 'none',
                    }}>
                      {String(hoverHour()).padStart(2, '0')}:00 · avg {d().avg.toFixed(1)} · {d().n} log{d().n === 1 ? '' : 's'}
                    </div>
                  );
                })()}
              </Show>
            </div>
            <div style={{ display: 'flex', 'justify-content': 'space-between', 'font-size': 'calc(11px * var(--ts))', color: 'var(--text-secondary)', margin: '4px 0 0', 'font-variant-numeric': 'tabular-nums' }}>
              <span>05</span><span>09</span><span>13</span><span>17</span><span>21</span><span>23</span>
            </div>
          </figure>
          <div style={{ display: 'flex', gap: '8px', margin: '12px 0 0' }}>
            <For each={[['Morning', analysis().morning], ['Afternoon', analysis().afternoon], ['Evening', analysis().evening]] as const}>
              {([label, v]) => (
                <div style={{ flex: '1', background: 'var(--bg-inset)', 'border-radius': '10px', padding: '8px 10px' }}>
                  <div style={{ 'font-size': 'calc(11px * var(--ts))', color: 'var(--text-secondary)' }}>{label}</div>
                  <div style={{ 'font-size': 'calc(20px * var(--ts))', 'font-weight': 'var(--fw-700)', color: 'var(--text)', 'font-variant-numeric': 'tabular-nums' }}>
                    {v === null ? '–' : v.toFixed(1)}
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
        <p data-testid="chronotype" style={{ 'font-size': 'calc(14px * var(--ts))', color: 'var(--text)', margin: '12px 0 0', 'line-height': 'calc(1.45 * var(--lh))' }}>
          {CHRONOTYPE_TEXT[analysis().kind]}
          <Show when={analysis().peakHour !== null && analysis().kind !== 'insufficient'}>
            {' '}Your best hour so far: <b>{String(analysis().peakHour).padStart(2, '0')}:00</b>.
          </Show>
        </p>
      </Card>

      {/* ------------------------------------------- routine + alarms */}
      <Card title="Routine & calendar alerts" testid="routine-card">
        <div style={{ display: 'grid', 'grid-template-columns': '78px 1fr', gap: '10px 8px', 'align-items': 'center', 'font-size': 'calc(14px * var(--ts))', color: 'var(--text-secondary)' }}>
          <span>Wake</span>
          <div style={{ display: 'flex', gap: '6px', 'flex-wrap': 'wrap' }}>
            <For each={WAKE_CHOICES}>{(w) => <button data-testid={`wake-${w}`} onClick={() => setProfile({ wake: w })} style={chip(profile().wake === w)}>{w}</button>}</For>
          </div>
          <span>Bedtime</span>
          <div style={{ display: 'flex', gap: '6px', 'flex-wrap': 'wrap' }}>
            <For each={BED_CHOICES}>{(b) => <button data-testid={`bed-${b}`} onClick={() => setProfile({ bed: b })} style={chip(profile().bed === b)}>{b}</button>}</For>
          </div>
          <span>Sprint</span>
          <div style={{ display: 'flex', gap: '6px', 'align-items': 'center', 'flex-wrap': 'wrap' }}>
            <For each={SPRINT_CHOICES}>{(m) => <button onClick={() => setProfile({ sprintMinutes: m })} style={chip(profile().sprintMinutes === m)}>{m} min</button>}</For>
            <input
              data-testid="sprint-length"
              type="number" inputmode="numeric" min={String(MIN_SPRINT)} max={String(MAX_SPRINT)}
              value={profile().sprintMinutes}
              onChange={(e) => {
                const v = Math.round(Number(e.currentTarget.value));
                if (v >= MIN_SPRINT && v <= MAX_SPRINT) setProfile({ sprintMinutes: v });
              }}
              aria-label="Sprint length in minutes"
              style={{ width: '64px', padding: '6px 8px', 'border-radius': '9px', background: 'var(--bg-inset)', 'font-size': 'calc(14px * var(--ts))', 'text-align': 'center', color: 'var(--text)' }}
            />
            <span>min</span>
          </div>
          <span>Morning</span>
          <div style={{ display: 'flex', gap: '6px', 'align-items': 'center' }}>
            <input
              data-testid="morning-sprint-time"
              type="time"
              value={morningSprintTime(profile())}
              onChange={(e) => e.currentTarget.value && setProfile({ morningSprintAt: e.currentTarget.value })}
              style={{ padding: '6px 8px', 'border-radius': '9px', background: 'var(--bg-inset)', 'font-size': 'calc(14px * var(--ts))', color: 'var(--text)' }}
            />
            <Show when={profile().morningSprintAt} fallback={<span style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)' }}>auto from wake time</span>}>
              <button onClick={() => setProfile({ morningSprintAt: null })} style={{ color: 'var(--blue)', 'font-size': 'calc(13px * var(--ts))' }}>Auto</button>
            </Show>
          </div>
          <span>Evening</span>
          <div style={{ display: 'flex', gap: '6px', 'align-items': 'center', 'flex-wrap': 'wrap' }}>
            <button data-testid="evening-on" onClick={() => setProfile({ eveningSprint: true })} style={chip(profile().eveningSprint)}>2nd sprint</button>
            <button data-testid="evening-off" onClick={() => setProfile({ eveningSprint: false })} style={chip(!profile().eveningSprint)}>Off</button>
            <Show when={profile().eveningSprint}>
              <input
                data-testid="evening-sprint-time"
                type="time"
                value={eveningSprintTime(profile())}
                onChange={(e) => e.currentTarget.value && setProfile({ eveningSprintAt: e.currentTarget.value })}
                style={{ padding: '6px 8px', 'border-radius': '9px', background: 'var(--bg-inset)', 'font-size': 'calc(14px * var(--ts))', color: 'var(--text)' }}
              />
            </Show>
          </div>
        </div>

        <div style={{ margin: '14px 0 0', 'border-top': '1px solid var(--separator)' }}>
          <For each={routineItems(profile())}>
            {(item) => (
              <div data-testid={`routine-${item.id}`} style={{ display: 'flex', gap: '10px', padding: '8px 0', 'border-bottom': '1px solid var(--separator)', 'font-size': 'calc(14px * var(--ts))' }}>
                <span style={{ width: '44px', 'font-weight': 'var(--fw-600)', 'font-variant-numeric': 'tabular-nums', color: 'var(--text)' }}>{item.time}</span>
                <span style={{ flex: '1', color: 'var(--text)' }}>{item.title}</span>
                <span style={{ color: 'var(--text-tertiary)', 'font-size': 'calc(12px * var(--ts))' }}>
                  {item.alarms.length > 1 ? 'prep + end' : 'alert'}
                </span>
              </div>
            )}
          </For>
        </div>

        <Show
          when={isPresetProfile(profile())}
          fallback={
            <>
              <button
                data-testid="share-routine-calendar"
                onClick={() => void deliverFile('focus-routine.ics', routineCalendar(profile()), 'text/calendar')}
                style={{
                  display: 'flex', 'align-items': 'center', 'justify-content': 'center', gap: '8px', width: '100%',
                  margin: '14px 0 0', padding: '13px', 'border-radius': '12px', background: 'var(--blue)',
                  color: 'var(--text-invert)', 'font-weight': 'var(--fw-600)', 'font-size': 'calc(16px * var(--ts))',
                }}
              >
                <Icon name="calendar" size={18} /> Add routine to Calendar
              </button>
              <p data-testid="custom-routine-note" style={{ 'font-size': 'calc(13px * var(--ts))', color: 'var(--text-secondary)', margin: '8px 0 0', 'line-height': 'calc(1.5 * var(--lh))' }}>
                Custom times use the share sheet: choose <b>Mail</b> (send it to yourself) or <b>Save to Files</b>, then tap the
                file and <b>Add All</b>.
              </p>
            </>
          }
        >
        <a
          data-testid="add-routine-calendar"
          href={routineUrl()}
          target="_blank"
          rel="noopener"
          style={{
            display: 'flex', 'align-items': 'center', 'justify-content': 'center', gap: '8px',
            margin: '14px 0 0', padding: '13px', 'border-radius': '12px', background: 'var(--blue)',
            color: 'var(--text-invert)', 'font-weight': 'var(--fw-600)', 'font-size': 'calc(16px * var(--ts))', 'text-decoration': 'none',
          }}
        >
          <Icon name="calendar" size={18} /> Add routine to Calendar
        </a>
        </Show>
        <ol style={{ 'padding-left': '20px', 'font-size': 'calc(13px * var(--ts))', color: 'var(--text-secondary)', 'line-height': 'calc(1.55 * var(--lh))', margin: '10px 0 0' }}>
          <li>Opens in Safari → tap <b>Add All</b> → pick a calendar (create one named “Focus Routine” so it’s easy to replace).</li>
          <li>iOS Calendar sends the alerts — they work while Clarity is closed and respect your Focus modes.</li>
          <li>Changed a time? Delete the “Focus Routine” calendar and add again.</li>
        </ol>
        <button
          onClick={() => void deliverFile('focus-routine.ics', routineCalendar(profile()), 'text/calendar')}
          style={{ color: 'var(--blue)', 'font-size': 'calc(13px * var(--ts))', margin: '6px 0 0' }}
        >
          Didn’t open? Share the file instead (Mail / Files → tap it → Add All)
        </button>
      </Card>

      {/* --------------------------------------------------- wallpaper */}
      <Card title="Lock-screen wallpaper">
        <div style={{ display: 'flex', gap: '12px' }}>
          <For each={[['dark', '#111114'], ['light', '#f5f5f7']] as const}>
            {([mode, bg]) => (
              <a
                href={appAssetUrl(`wallpapers/focus-flow-${mode}.png`)}
                target="_blank"
                rel="noopener"
                style={{ flex: '1', display: 'block', 'border-radius': '12px', overflow: 'hidden', background: bg, 'text-decoration': 'none', border: '1px solid var(--separator)' }}
              >
                <img src={appAssetUrl(`wallpapers/focus-flow-${mode}-thumb.png`)} alt={`Daily focus flow wallpaper, ${mode}`} style={{ width: '100%', display: 'block' }} loading="lazy" />
                <div style={{ 'text-align': 'center', 'font-size': 'calc(13px * var(--ts))', padding: '6px', color: mode === 'dark' ? '#f2f2f4' : '#1d1d1f' }}>{mode === 'dark' ? 'Dark' : 'Light'}</div>
              </a>
            )}
          </For>
        </div>
        <p style={{ 'font-size': 'calc(13px * var(--ts))', color: 'var(--text-secondary)', margin: '10px 0 0', 'line-height': 'calc(1.5 * var(--lh))' }}>
          Open one → long-press → <b>Save to Photos</b> → Photos → Share → <b>Use as Wallpaper</b>. The flow sits below
          the clock so you see it every time you pick up your phone.
        </p>
      </Card>
      <div style={{ height: '40px' }} />
      <Show when={editSprint()}>
        <SprintEditSheet sprint={editSprint()!} onClose={() => setEditSprint(null)} />
      </Show>
    </ScreenChrome>
  );
}
