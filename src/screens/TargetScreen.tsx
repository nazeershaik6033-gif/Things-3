import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { currentDate } from '../app/currentDate';
import { haptic, staggerDelay } from '../app/motion';
import { push } from '../app/navigation';
import { formatRelative, weekdayName } from '../domain/dates';
import { inToday } from '../domain/smartLists';
import {
  hitStreak, isReviewed, OUTCOME_COLOR, OUTCOME_LABEL, pastTargets, recentTargets,
  resolveAll, targetFor, targetStats,
} from '../domain/target';
import {
  clearDailyTarget, linkTargetTask, reviewDailyTarget, setDailyTarget,
} from '../db/mutations';
import { Icon } from '../ui/Icon';
import { Sheet, SheetTitle } from '../ui/Sheet';
import { PickerRow } from '../components/Pickers';
import { ScreenChrome, MenuRow } from './common';
import type { TargetOutcome } from '../db/models';

const VERDICTS: { outcome: Exclude<TargetOutcome, 'pending'>; label: string; icon: 'check' | 'moon' | 'close' }[] = [
  { outcome: 'hit', label: 'Hit it', icon: 'check' },
  { outcome: 'partial', label: 'Partly', icon: 'moon' },
  { outcome: 'missed', label: 'Missed', icon: 'close' },
];

/** One target a day: written in the morning, judged at night. Deliberately
 *  separate from the to-do lists — the point is that exactly one thing carries
 *  the day, and a list is the opposite of that. */
export function TargetScreen(): JSX.Element {
  const targets = createLiveQuery(() => db.dailyTargets.toArray(), []);
  const tasks = createLiveQuery(() => db.tasks.toArray(), []);

  const [draft, setDraft] = createSignal('');
  const [editing, setEditing] = createSignal(false);
  const [reflection, setReflection] = createSignal('');
  const [linkOpen, setLinkOpen] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);

  const today = () => currentDate();
  const resolved = createMemo(() => resolveAll(targets(), tasks()));
  const todays = createMemo(() => targetFor(resolved(), today()));
  /** The stored row, for fields the resolver doesn't touch. */
  const stored = createMemo(() => targetFor(targets(), today()));
  const streak = createMemo(() => hitStreak(resolved(), today()));
  const history = createMemo(() => recentTargets(resolved(), today(), 14));
  const stats = createMemo(() => targetStats(resolved(), today(), 30));
  const past = createMemo(() => pastTargets(resolved(), today()));

  const linkedTask = createMemo(() => {
    const id = stored()?.taskId;
    return id ? (tasks().find((t) => t.id === id) ?? null) : null;
  });
  const todaysTasks = createMemo(() =>
    tasks().filter((t) => inToday(t, today())).slice(0, 40),
  );

  // Keep the reflection box in step with whichever day is loaded
  createEffect(on(stored, (t) => setReflection(t?.reflection ?? '')));

  const save = () => {
    const text = draft().trim();
    if (!text) return;
    haptic('success');
    void setDailyTarget(today(), text, stored()?.taskId ?? null);
    setDraft('');
    setEditing(false);
  };

  const judge = (outcome: TargetOutcome) => {
    haptic(outcome === 'hit' ? 'success' : 'tick');
    void reviewDailyTarget(today(), outcome, reflection());
  };

  const composer = (
    <div
      class="rise"
      style={{
        margin: '2px 16px 14px',
        padding: '16px',
        'border-radius': 'var(--radius-card)',
        background: 'var(--bg-inset)',
      }}
    >
      <div style={{ 'font-size': '15px', 'font-weight': '600', 'margin-bottom': '4px' }}>
        What would make today count?
      </div>
      <div style={{ 'font-size': '13px', color: 'var(--text-secondary)', 'line-height': '1.45', 'margin-bottom': '12px' }}>
        One thing. If you did only this, the day would still be a good one.
      </div>
      <textarea
        data-testid="target-input"
        value={draft()}
        rows={2}
        placeholder="Today's one target…"
        onInput={(e) => {
          setDraft(e.currentTarget.value);
          e.currentTarget.style.height = 'auto';
          e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            save();
          }
        }}
        style={{
          width: '100%',
          background: 'var(--bg-list)',
          'border-radius': '11px',
          padding: '11px 13px',
          'font-size': '16px',
          'line-height': '1.4',
          overflow: 'hidden',
        }}
      />
      <div style={{ display: 'flex', gap: '10px', 'margin-top': '10px', 'align-items': 'center' }}>
        <button
          data-testid="target-save"
          class="pressable"
          onClick={save}
          style={{
            background: 'var(--blue)', color: 'var(--text-invert)', padding: '9px 18px',
            'border-radius': '10px', 'font-weight': '600', 'font-size': '15px',
          }}
        >
          Set target
        </button>
        <Show when={editing()}>
          <button class="pressable" onClick={() => { setEditing(false); setDraft(''); }} style={{ color: 'var(--text-secondary)', padding: '8px' }}>
            Cancel
          </button>
        </Show>
      </div>
    </div>
  );

  return (
    <ScreenChrome
      title="Today's Target"
      icon={<Icon name="flag" size={28} color="var(--blue)" />}
      subtitle={`${weekdayName(today())} · ${formatRelative(today(), today())}`}
      trailing={
        <Show when={todays()}>
          <button
            aria-label="Target menu"
            data-testid="target-menu"
            class="pressable"
            onClick={() => setMenuOpen(true)}
            style={{ color: 'var(--text-secondary)', padding: '8px 10px', display: 'flex' }}
          >
            <Icon name="ellipsis" size={20} />
          </button>
        </Show>
      }
    >
      <Show when={todays() && !editing()} fallback={composer}>
        {/* The target itself, stated plainly */}
        <div
          class="rise"
          data-testid="target-hero"
          style={{
            margin: '2px 16px 12px',
            padding: '18px',
            'border-radius': 'var(--radius-card)',
            background: 'var(--bg-inset)',
            'border-left': `4px solid ${OUTCOME_COLOR[todays()!.outcome]}`,
          }}
        >
          <div
            style={{
              'font-size': '12px',
              'font-weight': '700',
              'letter-spacing': '0.05em',
              'text-transform': 'uppercase',
              color: OUTCOME_COLOR[todays()!.outcome],
              'margin-bottom': '8px',
            }}
          >
            {todays()!.outcome === 'pending' ? 'Today’s target' : OUTCOME_LABEL[todays()!.outcome]}
          </div>
          <div
            data-testid="target-text"
            style={{ 'font-size': '21px', 'font-weight': '600', 'line-height': '1.3', 'white-space': 'pre-wrap' }}
          >
            {todays()!.text}
          </div>

          <Show when={linkedTask()}>
            <button
              class="pressable"
              data-testid="target-linked"
              onClick={() => push({ name: 'list', list: 'today' })}
              style={{
                display: 'flex', 'align-items': 'center', gap: '7px', 'margin-top': '12px',
                padding: '6px 10px', 'border-radius': '9px', background: 'var(--bg-list)',
                'font-size': '13px', color: 'var(--text-secondary)', 'max-width': '100%',
              }}
            >
              <Icon
                name={linkedTask()!.status === 'completed' ? 'check' : 'checklist'}
                size={13}
                color={linkedTask()!.status === 'completed' ? 'var(--green)' : 'var(--text-tertiary)'}
              />
              <span style={{ overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>
                {linkedTask()!.title || 'Untitled to-do'}
              </span>
            </button>
          </Show>

          <div style={{ display: 'flex', 'align-items': 'center', gap: '6px', 'margin-top': '12px', color: 'var(--text-secondary)', 'font-size': '14px' }}>
            <Icon name="flame" size={15} color={streak() > 0 ? 'var(--red)' : 'var(--text-tertiary)'} />
            <span data-testid="target-streak">
              {streak() === 0 ? 'No streak yet' : `${streak()}-day streak`}
            </span>
          </div>
        </div>

        {/* The night half: judge it */}
        <div class="rise" style={{ margin: '0 16px 6px', 'animation-delay': staggerDelay(1) }}>
          <div style={{ 'font-size': '13px', 'font-weight': '600', color: 'var(--text-secondary)', 'text-transform': 'uppercase', 'letter-spacing': '0.04em', 'margin-bottom': '8px' }}>
            {todays()!.outcome === 'pending' ? 'How did it go?' : 'How it went'}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <For each={VERDICTS}>
              {(v) => {
                const on = () => todays()!.outcome === v.outcome;
                return (
                  <button
                    data-testid={`target-${v.outcome}`}
                    class="pressable"
                    onClick={() => judge(v.outcome)}
                    style={{
                      flex: '1',
                      display: 'flex',
                      'flex-direction': 'column',
                      'align-items': 'center',
                      gap: '5px',
                      padding: '12px 6px',
                      'border-radius': '12px',
                      background: on() ? OUTCOME_COLOR[v.outcome] : 'var(--bg-inset)',
                      color: on() ? 'var(--text-invert)' : 'var(--text)',
                      'font-size': '14px',
                      'font-weight': '600',
                    }}
                  >
                    <Icon name={v.icon} size={18} />
                    {v.label}
                  </button>
                );
              }}
            </For>
          </div>

          <textarea
            data-testid="target-reflection"
            value={reflection()}
            rows={2}
            placeholder="A line about how it went (optional)…"
            onInput={(e) => {
              setReflection(e.currentTarget.value);
              e.currentTarget.style.height = 'auto';
              e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
            }}
            onBlur={() => {
              if (stored() && isReviewed(stored()!)) {
                void reviewDailyTarget(today(), todays()!.outcome, reflection());
              }
            }}
            style={{
              width: '100%',
              'margin-top': '10px',
              background: 'var(--bg-inset)',
              'border-radius': '11px',
              padding: '10px 12px',
              'font-size': '15px',
              overflow: 'hidden',
            }}
          />
          <Show when={!isReviewed(stored()!)}>
            <div style={{ 'font-size': '12px', color: 'var(--text-tertiary)', padding: '6px 2px 0', 'line-height': '1.45' }}>
              The note saves with your verdict — pick one above when the day is done.
            </div>
          </Show>
        </div>
      </Show>

      {/* Fourteen-day history */}
      <div class="rise" style={{ margin: '16px 16px 4px', 'animation-delay': staggerDelay(2) }}>
        <div style={{ display: 'flex', 'align-items': 'baseline', gap: '8px', 'margin-bottom': '8px' }}>
          <span style={{ 'font-size': '13px', 'font-weight': '600', color: 'var(--text-secondary)', 'text-transform': 'uppercase', 'letter-spacing': '0.04em' }}>
            Last 14 days
          </span>
          <span style={{ flex: '1' }} />
          <Show when={stats().set > 0}>
            <span data-testid="target-hitrate" style={{ 'font-size': '13px', color: 'var(--text-tertiary)' }}>
              {Math.round(stats().hitRate * 100)}% hit · 30 days
            </span>
          </Show>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <For each={history()}>
            {(day) => (
              <div
                title={`${day.date} — ${day.unset ? 'no target' : OUTCOME_LABEL[day.outcome]}`}
                style={{
                  flex: '1',
                  height: '26px',
                  'border-radius': '5px',
                  background: day.unset ? 'var(--bg-inset)' : OUTCOME_COLOR[day.outcome],
                  opacity: day.unset ? '0.6' : day.outcome === 'pending' ? '0.35' : '1',
                }}
              />
            )}
          </For>
        </div>
      </div>

      {/* Past targets */}
      <Show when={past().length > 0}>
        <div style={{ padding: '18px 16px 4px', 'font-size': '13px', 'font-weight': '600', color: 'var(--text-secondary)', 'text-transform': 'uppercase', 'letter-spacing': '0.04em' }}>
          Earlier
        </div>
        <For each={past().slice(0, 60)}>
          {(t, i) => (
            <div
              class="rise"
              data-testid="past-target"
              data-date={t.date}
              style={{
                margin: '0 10px 8px',
                padding: '11px 14px',
                'border-radius': '12px',
                background: 'var(--bg-list)',
                border: '1px solid var(--separator)',
                'animation-delay': staggerDelay(i()),
              }}
            >
              <div style={{ display: 'flex', 'align-items': 'baseline', gap: '8px' }}>
                <span style={{ 'font-size': '12px', 'font-weight': '700', color: OUTCOME_COLOR[t.outcome] }}>
                  {OUTCOME_LABEL[t.outcome]}
                </span>
                <span style={{ flex: '1' }} />
                <span style={{ 'font-size': '12px', color: 'var(--text-tertiary)' }}>
                  {formatRelative(t.date, today())}
                </span>
              </div>
              <div style={{ 'font-size': '15px', 'margin-top': '3px', 'white-space': 'pre-wrap' }}>{t.text}</div>
              <Show when={t.reflection}>
                <div style={{ 'font-size': '13px', color: 'var(--text-secondary)', 'margin-top': '4px', 'font-style': 'italic' }}>
                  {t.reflection}
                </div>
              </Show>
            </div>
          )}
        </For>
      </Show>

      {/* Target menu */}
      <Show when={menuOpen() && todays()}>
        <Sheet onClose={() => setMenuOpen(false)} dragAnywhere>
          <SheetTitle>Today’s Target</SheetTitle>
          <MenuRow
            icon={<Icon name="notes" size={20} color="var(--blue)" />}
            label="Edit target"
            onClick={() => { setDraft(todays()!.text); setEditing(true); setMenuOpen(false); }}
          />
          <MenuRow
            icon={<Icon name="checklist" size={20} color="var(--blue)" />}
            label={stored()?.taskId ? 'Change linked to-do' : 'Link a to-do'}
            onClick={() => { setMenuOpen(false); setLinkOpen(true); }}
          />
          <Show when={stored()?.taskId}>
            <MenuRow
              icon={<Icon name="close" size={20} color="var(--text-secondary)" />}
              label="Unlink to-do"
              onClick={() => { void linkTargetTask(today(), null); setMenuOpen(false); }}
            />
          </Show>
          <Show when={isReviewed(stored()!)}>
            <MenuRow
              icon={<Icon name="restore" size={20} color="var(--text-secondary)" />}
              label="Undo verdict"
              onClick={() => { void reviewDailyTarget(today(), 'pending'); setMenuOpen(false); }}
            />
          </Show>
          <MenuRow
            icon={<Icon name="trash" size={20} />}
            danger
            label="Clear today's target"
            onClick={() => { void clearDailyTarget(today()); setMenuOpen(false); }}
          />
          <div style={{ height: '10px' }} />
        </Sheet>
      </Show>

      {/* Link a to-do */}
      <Show when={linkOpen()}>
        <Sheet onClose={() => setLinkOpen(false)} dragAnywhere>
          <SheetTitle>Link a to-do</SheetTitle>
          <div style={{ 'max-height': '55dvh', 'overflow-y': 'auto' }}>
            <Show
              when={todaysTasks().length > 0}
              fallback={
                <div style={{ padding: '10px 20px 18px', color: 'var(--text-secondary)', 'font-size': '15px' }}>
                  Nothing is scheduled for today yet.
                </div>
              }
            >
              <For each={todaysTasks()}>
                {(t) => (
                  <PickerRow
                    icon={<Icon name="checklist" size={19} color="var(--text-secondary)" />}
                    label={t.title || 'New To-Do'}
                    selected={stored()?.taskId === t.id}
                    onClick={() => { void linkTargetTask(today(), t.id); setLinkOpen(false); }}
                  />
                )}
              </For>
            </Show>
          </div>
          <div style={{ padding: '4px 20px 16px', 'font-size': '12px', color: 'var(--text-tertiary)', 'line-height': '1.45' }}>
            Finishing the linked to-do counts the target as hit. Your own verdict
            always wins over it.
          </div>
        </Sheet>
      </Show>
    </ScreenChrome>
  );
}
