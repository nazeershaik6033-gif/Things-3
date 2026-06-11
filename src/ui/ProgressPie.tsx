import { type JSX } from 'solid-js';

/** Circular progress pie: thin ring outline + solid wedge (Things' project icon). */
export function ProgressPie(props: {
  progress: number; // 0..1
  size?: number;
  color?: string;
}): JSX.Element {
  const size = () => props.size ?? 20;
  const r = 8;
  const c = 12;
  const wedge = () => {
    const p = Math.min(1, Math.max(0, props.progress));
    if (p <= 0) return '';
    if (p >= 1) return ''; // full circle drawn separately
    const angle = p * 2 * Math.PI - Math.PI / 2;
    const x = c + r * Math.cos(angle);
    const y = c + r * Math.sin(angle);
    const large = p > 0.5 ? 1 : 0;
    return `M ${c} ${c} L ${c} ${c - r} A ${r} ${r} 0 ${large} 1 ${x} ${y} Z`;
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width={size()}
      height={size()}
      style={{ color: props.color ?? 'var(--blue)', flex: 'none' }}
      aria-hidden="true"
    >
      <circle cx={c} cy={c} r={r + 1.5} fill="none" stroke="currentColor" stroke-width="1.6" />
      {props.progress >= 1 ? (
        <circle cx={c} cy={c} r={r} fill="currentColor" />
      ) : (
        <path d={wedge()} fill="currentColor" />
      )}
    </svg>
  );
}
