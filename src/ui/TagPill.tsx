import { type JSX } from 'solid-js';

export function TagPill(props: { title: string; selected?: boolean; onClick?: () => void }): JSX.Element {
  return (
    <span
      onClick={props.onClick}
      style={{
        display: 'inline-flex',
        'align-items': 'center',
        padding: '2px 10px',
        'border-radius': '999px',
        background: props.selected ? 'var(--green)' : 'var(--tag-bg)',
        color: props.selected ? '#fff' : 'var(--tag-text)',
        border: `1px solid ${props.selected ? 'var(--green)' : 'var(--tag-border)'}`,
        'font-size': 'var(--fs-chip)',
        'font-weight': '500',
        'line-height': '1.5',
        'white-space': 'nowrap',
      }}
    >
      {props.title}
    </span>
  );
}

export function DeadlineFlag(props: { text: string; overdue?: boolean }): JSX.Element {
  return (
    <span
      style={{
        display: 'inline-flex',
        'align-items': 'center',
        gap: '3px',
        color: props.overdue ? 'var(--red)' : 'var(--text-secondary)',
        'font-size': 'var(--fs-chip)',
        'font-weight': '600',
        'white-space': 'nowrap',
      }}
    >
      <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
        <path d="M5.5 21V4.2c0-.4.3-.8.7-.9C7.5 3 9 2.8 10.5 3.4c2.2.9 4 1 6.9.2.5-.2 1.1.2 1.1.8v8.3c0 .4-.3.8-.7.9-2.6.7-4.6.5-6.6-.3-1.7-.7-3.5-.4-5.7.3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" />
      </svg>
      {props.text}
    </span>
  );
}

/** "3/12" checklist progress chip shown on task rows. */
export function ChecklistChip(props: { done: number; total: number }): JSX.Element {
  return (
    <span
      style={{
        display: 'inline-flex',
        'align-items': 'center',
        gap: '3px',
        color: 'var(--text-secondary)',
        'font-size': 'var(--fs-chip)',
        'white-space': 'nowrap',
      }}
    >
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m3.5 6.5 2 2L9 4.5M3.5 14.5l2 2L9 12.5" />
        <path d="M12.5 7h8M12.5 15h8" />
      </svg>
      {props.done}/{props.total}
    </span>
  );
}
