import { For, Show, type JSX } from 'solid-js';
import { Icon } from '../ui/Icon';
import { currentDate } from '../app/currentDate';
import { formatDeadline } from '../domain/dates';
import type { Card, BoardLabel } from '../db/models';

/** Compact Kanban card shown inside a column. The root carries the drag
 *  contract attributes (data-board-card / data-card-id / data-list-id). */
export function BoardCard(props: {
  card: Card;
  labels: BoardLabel[];
  onOpen: () => void;
}): JSX.Element {
  const cardLabels = () => props.labels.filter((l) => props.card.labelIds.includes(l.id));
  const checklistDone = () => props.card.checklist.filter((i) => i.completed).length;
  const overdue = () => props.card.due !== null && props.card.due < currentDate() && !props.card.completed;

  return (
    <div
      data-board-card
      data-card-id={props.card.id}
      data-list-id={props.card.listId}
      onClick={props.onOpen}
      class="no-select pressable-card"
      style={{
        background: 'var(--bg-card)',
        'border-radius': '10px',
        'box-shadow': '0 1px 2px rgba(0,0,0,0.12)',
        margin: '0 0 8px',
        overflow: 'hidden',
        opacity: props.card.completed ? '0.6' : '1',
        cursor: 'pointer',
      }}
    >
      <Show when={props.card.cover}>
        <div style={{ height: '30px', background: props.card.cover! }} />
      </Show>
      <div style={{ padding: '9px 11px' }}>
        <Show when={cardLabels().length > 0}>
          <div style={{ display: 'flex', gap: '5px', 'flex-wrap': 'wrap', 'margin-bottom': '7px' }}>
            <For each={cardLabels()}>
              {(label) => (
                <span
                  title={label.title}
                  style={{
                    height: '8px',
                    'min-width': '34px',
                    'border-radius': '4px',
                    background: label.color,
                  }}
                />
              )}
            </For>
          </div>
        </Show>
        <div
          style={{
            'font-size': '15px',
            color: 'var(--text)',
            'text-decoration': props.card.completed ? 'line-through' : 'none',
            'line-height': '1.3',
            'white-space': 'pre-wrap',
            'word-break': 'break-word',
          }}
        >
          {props.card.title || 'Untitled'}
        </div>

        <Show
          when={
            props.card.due ||
            props.card.checklist.length > 0 ||
            props.card.comments.length > 0 ||
            props.card.description.trim()
          }
        >
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: '10px',
              'margin-top': '8px',
              color: 'var(--text-secondary)',
              'font-size': '12px',
            }}
          >
            <Show when={props.card.due}>
              <span
                style={{
                  display: 'flex',
                  'align-items': 'center',
                  gap: '4px',
                  padding: '2px 6px',
                  'border-radius': '5px',
                  background: overdue() ? 'var(--red)' : 'var(--bg-inset)',
                  color: overdue() ? '#fff' : 'var(--text-secondary)',
                }}
              >
                <Icon name="clock" size={12} />
                {formatDeadline(props.card.due!, currentDate())}
              </span>
            </Show>
            <Show when={props.card.description.trim()}>
              <Icon name="notes" size={13} />
            </Show>
            <Show when={props.card.checklist.length > 0}>
              <span style={{ display: 'flex', 'align-items': 'center', gap: '4px' }}>
                <Icon name="checklist" size={13} />
                {checklistDone()}/{props.card.checklist.length}
              </span>
            </Show>
            <Show when={props.card.comments.length > 0}>
              <span style={{ display: 'flex', 'align-items': 'center', gap: '4px' }}>
                <Icon name="comment" size={13} />
                {props.card.comments.length}
              </span>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
