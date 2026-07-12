import { Show, type JSX } from 'solid-js';
import {
  pomodoroState, pomodoroConfig, overlayOpen, setOverlayOpen, doneToday,
  isActive, isPaused, remainingMs, startPomodoro, pausePomodoro, stopPomodoro, skipPhase,
} from '../app/pomodoro';
import { PHASE_LABEL, formatMs, phaseDurationMs } from '../domain/pomodoro';
import { Icon } from '../ui/Icon';

const PHASE_COLOR: Record<'work' | 'short' | 'long', string> = {
  work: 'var(--red)',
  short: 'var(--green)',
  long: 'var(--blue)',
};

function Ring(props: { fraction: number; color: string }): JSX.Element {
  const R = 110;
  const C = 2 * Math.PI * R;
  return (
    <svg width="260" height="260" viewBox="0 0 260 260">
      <circle cx="130" cy="130" r={R} fill="none" stroke="var(--bg-inset)" stroke-width="10" />
      <circle
        cx="130" cy="130" r={R} fill="none"
        stroke={props.color} stroke-width="10" stroke-linecap="round"
        stroke-dasharray={`${C}`}
        stroke-dashoffset={`${C * (1 - props.fraction)}`}
        transform="rotate(-90 130 130)"
        style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 0.3s' }}
      />
    </svg>
  );
}

/** Slim countdown bar visible on every screen while a pomodoro runs. */
export function PomodoroMiniBar(): JSX.Element {
  return (
    <Show when={isActive() && !overlayOpen()}>
      <button
        data-testid="pomo-minibar"
        onClick={() => setOverlayOpen(true)}
        style={{
          position: 'fixed',
          top: 'calc(var(--safe-top) + 6px)',
          left: '50%',
          transform: 'translateX(-50%)',
          'z-index': '60',
          display: 'flex',
          'align-items': 'center',
          gap: '8px',
          padding: '6px 14px',
          'border-radius': '999px',
          background: 'var(--bg-elevated)',
          'box-shadow': 'var(--shadow-card)',
          color: 'var(--text)',
          'font-size': '13px',
          'font-weight': '600',
          'font-variant-numeric': 'tabular-nums',
        }}
      >
        <span style={{
          width: '8px', height: '8px', 'border-radius': '50%',
          background: PHASE_COLOR[pomodoroState().phase],
          opacity: isPaused() ? '0.4' : '1',
        }} />
        {PHASE_LABEL[pomodoroState().phase]} · {formatMs(remainingMs())}
        {isPaused() ? ' ⏸' : ''}
      </button>
    </Show>
  );
}

/** Full-screen timer. */
export function PomodoroOverlay(): JSX.Element {
  const s = pomodoroState;
  const fraction = () => remainingMs() / phaseDurationMs(s().phase, pomodoroConfig());
  const color = () => PHASE_COLOR[s().phase];

  const ctl = (label: string, onClick: () => void, primary = false, testid?: string) => (
    <button
      onClick={onClick}
      data-testid={testid}
      style={{
        padding: '12px 24px',
        'border-radius': '999px',
        'font-size': '16px',
        'font-weight': '600',
        background: primary ? color() : 'var(--bg-inset)',
        color: primary ? '#fff' : 'var(--text)',
        'min-width': '110px',
      }}
    >
      {label}
    </button>
  );

  return (
    <Show when={overlayOpen()}>
      <div
        data-testid="pomo-overlay"
        style={{
          position: 'fixed',
          inset: '0',
          'z-index': '70',
          background: 'var(--bg)',
          display: 'flex',
          'flex-direction': 'column',
          'align-items': 'center',
          padding: 'calc(var(--safe-top) + 10px) 20px calc(var(--safe-bottom) + 20px)',
        }}
      >
        <div style={{ width: '100%', display: 'flex', 'justify-content': 'flex-end' }}>
          <button
            aria-label="Close timer"
            data-testid="pomo-close"
            onClick={() => setOverlayOpen(false)}
            style={{ padding: '10px', color: 'var(--text-secondary)' }}
          >
            <Icon name="close" size={22} />
          </button>
        </div>

        <div style={{ 'font-size': '20px', 'font-weight': '700', color: color(), 'margin-top': '8px' }}
          data-testid="pomo-phase">
          {PHASE_LABEL[s().phase]}
        </div>
        <div style={{ 'font-size': '14px', color: 'var(--text-secondary)', 'margin-top': '4px' }}>
          Round {s().round} of {pomodoroConfig().rounds} · 🍅 {doneToday()} today
        </div>

        <div style={{ position: 'relative', 'margin-top': '24px' }}>
          <Ring fraction={fraction()} color={color()} />
          <div
            data-testid="pomo-remaining"
            style={{
              position: 'absolute', inset: '0',
              display: 'flex', 'align-items': 'center', 'justify-content': 'center',
              'font-size': '52px', 'font-weight': '700',
              'font-variant-numeric': 'tabular-nums', color: 'var(--text)',
            }}
          >
            {formatMs(remainingMs())}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', 'margin-top': '36px', 'flex-wrap': 'wrap', 'justify-content': 'center' }}>
          <Show
            when={isActive() && !isPaused()}
            fallback={ctl(isActive() ? 'Resume' : 'Start', startPomodoro, true, 'pomo-start')}
          >
            {ctl('Pause', pausePomodoro, true, 'pomo-pause')}
          </Show>
          {ctl('Skip', () => skipPhase(false), false, 'pomo-skip')}
          <Show when={isActive()}>
            {ctl('Stop', stopPomodoro, false, 'pomo-stop')}
          </Show>
        </div>

        <div style={{ 'font-size': '12px', color: 'var(--text-tertiary)', 'margin-top': 'auto', 'text-align': 'center', 'line-height': '1.5' }}>
          The timer keeps correct time even if you leave the app — but iPhone
          only plays the chime while the app is open.
        </div>
      </div>
    </Show>
  );
}
