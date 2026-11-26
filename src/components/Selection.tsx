import { Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { endSelecting, selection, startSelecting } from '../app/uiState';
import { currentDate } from '../app/currentDate';
import { undoable } from '../app/undo';
import { haptic } from '../app/motion';
import { addDays } from '../domain/dates';
import { bulkComplete, bulkPatch, bulkTrash, bulkWhen } from '../db/workflowMutations';
import type { When } from '../db/mutations';

/** The Select button lists put in their header. */
export function SelectButton(): JSX.Element {
  return (
    <button
      data-testid="select-start"
      onClick={() => (selection() ? endSelecting() : startSelecting())}
      style={{ color: 'var(--blue)', padding: '8px 10px', 'font-size': 'calc(15px * var(--ts))', 'font-weight': 'var(--fw-600)' }}
    >
      {selection() ? 'Done' : 'Select'}
    </button>
  );
}

/** Bottom bar while selecting: act on every selected to-do at once, undoable. */
export function SelectionBar(): JSX.Element {
  const ids = () => [...(selection() ?? [])];
  const act = (label: string, toast: string, fn: (ids: string[]) => Promise<void>) => {
    const list = ids();
    if (list.length === 0) return;
    haptic('success');
    void undoable(label, () => fn(list), `${toast} · ${list.length}`);
    endSelecting();
  };
  const when = (w: When, label: string) => () => act('Reschedule', `Moved to ${label}`, (l) => bulkWhen(l, w));
  const btn = (label: string, onClick: () => void, testid: string, color = 'var(--text)') => (
    <button data-testid={testid} onClick={onClick} disabled={ids().length === 0} style={{
      padding: '8px 10px', 'border-radius': '10px', 'font-size': 'calc(13px * var(--ts))', 'font-weight': 'var(--fw-600)', color,
      background: 'var(--bg-inset)', opacity: ids().length === 0 ? '0.4' : '1', 'white-space': 'nowrap',
    }}>
      {label}
    </button>
  );
  return (
    <Show when={selection()}>
      <Portal>
        <div data-testid="selection-bar" style={{
          position: 'fixed', left: '8px', right: '8px', bottom: 'calc(var(--safe-bottom) + 10px)', 'z-index': '110',
          background: 'var(--bg-elevated)', 'box-shadow': 'var(--shadow-sheet)', 'border-radius': '16px', padding: '10px',
          'max-width': '640px', margin: '0 auto',
        }}>
          <div style={{ display: 'flex', 'align-items': 'center', 'padding-bottom': '8px' }}>
            <span data-testid="selection-count" style={{ flex: '1', 'font-weight': 'var(--fw-700)', 'font-size': 'calc(14px * var(--ts))' }}>{ids().length} selected</span>
            <button onClick={endSelecting} style={{ color: 'var(--blue)', 'font-size': 'calc(14px * var(--ts))', 'font-weight': 'var(--fw-600)' }}>Cancel</button>
          </div>
          <div style={{ display: 'flex', gap: '6px', 'overflow-x': 'auto' }}>
            {btn('Today', when({ type: 'today' }, 'Today'), 'sel-today')}
            {btn('Tomorrow', when({ type: 'date', date: addDays(currentDate(), 1) }, 'Tomorrow'), 'sel-tomorrow')}
            {btn('Someday', when({ type: 'someday' }, 'Someday'), 'sel-someday')}
            {btn('In Progress', () => act('Stage', 'In Progress', (l) => bulkPatch(l, { stage: 'doing' })), 'sel-doing')}
            {btn('Waiting', () => act('Stage', 'Waiting', (l) => bulkPatch(l, { stage: 'waiting' })), 'sel-waiting')}
            {btn('Complete', () => act('Complete', 'Completed', bulkComplete), 'sel-complete', 'var(--green)')}
            {btn('Delete', () => act('Delete', 'Moved to Trash', bulkTrash), 'sel-delete', 'var(--red)')}
          </div>
        </div>
      </Portal>
    </Show>
  );
}
