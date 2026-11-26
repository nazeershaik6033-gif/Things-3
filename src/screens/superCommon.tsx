import { Show, type JSX } from 'solid-js';

/** Small building blocks shared by the Worklog, Finish Day and Counters
 *  screens, in the same rounded-card language as Home. */

export function Panel(props: { children: JSX.Element; testid?: string; pad?: boolean }): JSX.Element {
  return (
    <div
      data-testid={props.testid}
      style={{
        margin: '0 12px 12px',
        background: 'var(--bg-list)',
        'border-radius': '16px',
        border: '1px solid var(--separator)',
        padding: props.pad === false ? '0' : '4px 0',
        overflow: 'hidden',
      }}
    >
      {props.children}
    </div>
  );
}

export function SectionLabel(props: { children: JSX.Element; trailing?: JSX.Element }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        'align-items': 'center',
        padding: '10px 22px 6px',
        'font-size': 'calc(12px * var(--ts))',
        'font-weight': 'var(--fw-700)',
        'letter-spacing': '0.05em',
        'text-transform': 'uppercase',
        color: 'var(--text-tertiary)',
      }}
    >
      <span style={{ flex: '1' }}>{props.children}</span>
      {props.trailing}
    </div>
  );
}

export function StatTile(props: { label: string; value: string; testid?: string; tone?: string; hint?: string }): JSX.Element {
  return (
    <div
      data-testid={props.testid}
      style={{
        flex: '1',
        'min-width': '0',
        padding: '12px 12px 10px',
        'border-radius': '14px',
        background: 'var(--bg-list)',
        border: '1px solid var(--separator)',
      }}
    >
      <div style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-secondary)', 'font-weight': 'var(--fw-600)' }}>{props.label}</div>
      <div
        data-testid={props.testid ? `${props.testid}-value` : undefined}
        style={{
          'font-size': 'calc(22px * var(--ts))',
          'font-weight': 'var(--fw-700)',
          'font-variant-numeric': 'tabular-nums',
          color: props.tone ?? 'var(--text)',
          'margin-top': '2px',
          overflow: 'hidden',
          'text-overflow': 'ellipsis',
          'white-space': 'nowrap',
        }}
      >
        {props.value}
      </div>
      <Show when={props.hint}>
        <div style={{ 'font-size': 'calc(11px * var(--ts))', color: 'var(--text-tertiary)', 'margin-top': '2px' }}>{props.hint}</div>
      </Show>
    </div>
  );
}

export function StatRow(props: { children: JSX.Element }): JSX.Element {
  return <div style={{ display: 'flex', gap: '8px', padding: '0 12px 12px' }}>{props.children}</div>;
}

export const primaryButton = {
  padding: '11px 18px',
  'border-radius': '12px',
  background: 'var(--blue)',
  color: 'var(--text-invert)',
  'font-size': 'calc(16px * var(--ts))',
  'font-weight': 'var(--fw-600)',
} as const;

export const softButton = {
  padding: '7px 12px',
  'border-radius': '10px',
  background: 'var(--bg-inset)',
  color: 'var(--text)',
  'font-size': 'calc(14px * var(--ts))',
  'font-weight': 'var(--fw-600)',
} as const;

export const fieldStyle = {
  padding: '10px 12px',
  'border-radius': '10px',
  background: 'var(--bg-inset)',
  color: 'var(--text)',
  'font-size': 'calc(16px * var(--ts))',
  border: 'none',
  'color-scheme': 'inherit',
} as const;
