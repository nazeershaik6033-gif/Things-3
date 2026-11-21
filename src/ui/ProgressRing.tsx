import { type JSX } from 'solid-js';

/** Stroked completion ring. Unlike ProgressPie (a filled wedge, used as a
 *  project glyph) this is the display form: it sweeps from 12 o'clock and
 *  animates by transitioning stroke-dashoffset, which the compositor handles
 *  without relayout. */
export function ProgressRing(props: {
  progress: number; // 0..1
  size?: number;
  thickness?: number;
  color?: string;
  trackColor?: string;
  children?: JSX.Element;
}): JSX.Element {
  const size = () => props.size ?? 64;
  const thickness = () => props.thickness ?? 6;
  const r = () => (100 - thickness()) / 2;
  const circumference = () => 2 * Math.PI * r();
  const clamped = () => Math.min(1, Math.max(0, props.progress));

  return (
    <div
      style={{
        position: 'relative',
        width: `${size()}px`,
        height: `${size()}px`,
        flex: 'none',
        display: 'grid',
        'place-items': 'center',
      }}
    >
      <svg viewBox="0 0 100 100" width={size()} height={size()} aria-hidden="true">
        <circle
          cx="50"
          cy="50"
          r={r()}
          fill="none"
          stroke={props.trackColor ?? 'var(--bg-inset)'}
          stroke-width={thickness()}
        />
        <circle
          cx="50"
          cy="50"
          r={r()}
          fill="none"
          stroke={props.color ?? 'var(--blue)'}
          stroke-width={thickness()}
          stroke-linecap="round"
          stroke-dasharray={String(circumference())}
          stroke-dashoffset={String(circumference() * (1 - clamped()))}
          transform="rotate(-90 50 50)"
          style={{ transition: 'stroke-dashoffset 420ms cubic-bezier(0.22, 0.9, 0.28, 1)' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: '0', display: 'grid', 'place-items': 'center' }}>
        {props.children}
      </div>
    </div>
  );
}
