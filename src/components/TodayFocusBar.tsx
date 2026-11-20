import { Show, type JSX } from 'solid-js';
import { push } from '../app/navigation';
import { openSprint } from '../app/focusState';
import { useEverest } from '../app/focusProfile';
import { MIT_LIMIT } from '../domain/focus';
import { Icon } from '../ui/Icon';

/** Compact Focus Framework strip at the top of Today: your Everest, how many
 *  MITs are picked, and a one-tap Focus Sprint. */
export function TodayFocusBar(props: { mitCount: number }): JSX.Element {
  const everest = useEverest();
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
      <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'margin-top': '8px' }}>
        <span
          data-testid="mit-count"
          style={{ display: 'inline-flex', 'align-items': 'center', gap: '5px', 'font-size': '13px', 'font-weight': '600', color: 'var(--text-secondary)', flex: '1' }}
        >
          <Icon name="star" size={13} color="var(--yellow-deep)" />
          <Show when={props.mitCount > 0} fallback={'Tap a to-do → ★ MIT (1–3)'}>
            {props.mitCount}/{MIT_LIMIT} MITs
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
          <Icon name="play" size={11} /> Focus Sprint
        </button>
      </div>
    </div>
  );
}
