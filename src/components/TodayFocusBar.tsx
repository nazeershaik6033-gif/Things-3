import { createMemo, Show, type JSX } from 'solid-js';
import { push } from '../app/navigation';
import { openSprint } from '../app/focusState';
import { useEverest, useFocusProfile } from '../app/focusProfile';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import type { HealthDay } from '../db/models';
import { currentDate } from '../app/currentDate';
import { adviseDay, formatDuration } from '../domain/health';
import { MIT_LIMIT } from '../domain/focus';
import { Icon } from '../ui/Icon';

/** Compact Focus Framework strip at the top of Today: your Everest, how many
 *  MITs are picked, and a one-tap Focus Sprint. */
export function TodayFocusBar(props: { mitCount: number }): JSX.Element {
  const everest = useEverest();
  const profile = useFocusProfile();
  const health = createLiveQuery(() => db.healthDays.get(currentDate()), undefined as HealthDay | undefined);
  const advice = createMemo(() => adviseDay(health()?.sleep ?? null, profile().bed, profile().sprintMinutes));
  const morning = () => new Date().getHours() < 12;
  return (
    <div
      data-testid="today-focus-bar"
      style={{ margin: '0 12px 8px', padding: '10px 12px', 'border-radius': '12px', background: 'var(--bg-inset)' }}
    >
      <button
        onClick={() => push({ name: 'focus' })}
        style={{ display: 'flex', 'align-items': 'center', gap: '8px', width: '100%', 'text-align': 'left', 'font-size': '14px', color: 'var(--text)' }}
      >
        <Icon name="mountain" size={17} color="var(--teal)" />
        <span style={{ flex: '1', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap', color: everest() ? 'var(--text)' : 'var(--text-secondary)' }}>
          {everest() || 'Set your Everest — your long-term direction'}
        </span>
        <Icon name="chevron-right" size={14} color="var(--text-tertiary)" />
      </button>
      <Show when={advice()?.shortNight}>
        <button
          data-testid="today-short-night"
          onClick={() => push({ name: 'focus' })}
          style={{ display: 'block', width: '100%', 'text-align': 'left', 'margin-top': '8px', 'font-size': '13px', 'line-height': '1.4', color: 'var(--text)', padding: '7px 9px', 'border-radius': '9px', background: 'color-mix(in srgb, var(--yellow) 22%, transparent)' }}
        >
          ⌚ {formatDuration(health()!.sleep!.asleepMin)} sleep — aim for {advice()!.mitSuggest} MITs and {advice()!.sprintMinutes}-min sprints today.
        </button>
      </Show>
      <Show when={!health()?.sleep && morning()}>
        <button
          data-testid="today-sync-nudge"
          onClick={() => push({ name: 'focus' })}
          style={{ display: 'block', 'margin-top': '6px', 'font-size': '13px', color: 'var(--blue)' }}
        >
          ⌚ Sync last night’s sleep ›
        </button>
      </Show>
      <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'margin-top': '8px' }}>
        <span
          data-testid="mit-count"
          style={{ display: 'inline-flex', 'align-items': 'center', gap: '5px', 'font-size': '13px', 'font-weight': '600', color: 'var(--text-secondary)', flex: '1' }}
        >
          <Icon name="star" size={13} color="var(--yellow-deep)" />
          <Show when={props.mitCount > 0} fallback={'Tap a to-do → ★ MIT (1–3)'}>
            {props.mitCount}/{advice()?.shortNight ? `${advice()!.mitSuggest} suggested` : MIT_LIMIT} MITs
          </Show>
        </span>
        <button
          data-testid="today-start-sprint"
          onClick={() => openSprint({})}
          style={{
            display: 'inline-flex', 'align-items': 'center', gap: '6px', padding: '6px 12px', 'border-radius': '999px',
            background: 'var(--blue)', color: 'var(--text-invert)', 'font-size': '13px', 'font-weight': '600',
          }}
        >
          <Icon name="start" size={11} /> Focus Sprint
        </button>
      </div>
    </div>
  );
}
