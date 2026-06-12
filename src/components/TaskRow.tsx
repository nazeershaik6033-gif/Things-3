import { createMemo, Show, type JSX } from 'solid-js';
import type { Task, Tag } from '../db/models';
import { Checkbox } from '../ui/Checkbox';
import { TagPill, DeadlineFlag, ChecklistChip } from '../ui/TagPill';
import { Icon } from '../ui/Icon';
import { completeTask, reopenTask, setTaskWhen } from '../db/mutations';
import { addGrace, graceIds, removeGrace, setExpandedTaskId } from '../app/uiState';
import { currentDate } from '../app/currentDate';
import { formatDeadline, formatRelative } from '../domain/dates';
import { isOverdue } from '../domain/smartLists';
import { SwipeableRow } from './SwipeableRow';
import { markdownPreview } from '../domain/markdown';
import { quadrantMeta } from '../domain/eisenhower';

export interface TaskRowContext {
  /** Show the Eisenhower chip and open its picker (Today only). */
  onPriority?: (taskId: string) => void;
  /** Show the start-date chip (hidden in Today where it's redundant). */
  showWhen?: boolean;
  /** Show the evening moon chip (Today's main section shows it). */
  showEveningBadge?: boolean;
  tags: Tag[];
  /** Open the schedule picker for this task (provided by the screen). */
  onSchedule: (taskId: string) => void;
  /** Disable swipe (trash/logbook). */
  noSwipe?: boolean;
}

export function toggleComplete(task: Task): void {
  if (task.status === 'open') {
    void completeTask(task.id);
    addGrace(task.id);
  } else {
    void reopenTask(task.id);
    removeGrace(task.id);
  }
}

export function TaskRow(props: { task: Task; ctx: TaskRowContext }): JSX.Element {
  const t = () => props.task;
  const checked = () => t().status !== 'open';
  const struck = () => checked() && graceIds().has(t().id);
  const tags = createMemo(() =>
    t().tagIds.map((id) => props.ctx.tags.find((x) => x.id === id)).filter((x): x is Tag => !!x),
  );
  const checklistDone = () => t().checklist.filter((c) => c.completed).length;
  const notePreview = createMemo(() => markdownPreview(t().notes));

  const row = (
    <div
      class="task-row no-select"
      data-task-id={t().id}
      onClick={() => setExpandedTaskId(t().id)}
      style={{
        display: 'flex',
        'align-items': 'flex-start',
        gap: '12px',
        padding: '10px 16px',
        'min-height': '44px',
        background: 'var(--bg-list)',
        cursor: 'pointer',
      }}
    >
      <div style={{ 'padding-top': '2px' }}>
        <Checkbox
          checked={checked()}
          canceled={t().status === 'canceled'}
          onToggle={() => toggleComplete(t())}
        />
      </div>
      <div style={{ flex: '1', 'min-width': '0' }}>
        <div
          style={{
            display: 'flex',
            'align-items': 'baseline',
            gap: '8px',
          }}
        >
          <span
            style={{
              flex: '1',
              'min-width': '0',
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
              'white-space': 'nowrap',
              color: checked() ? 'var(--text-secondary)' : 'var(--text)',
              'text-decoration': struck() || checked() ? 'line-through' : 'none',
              'text-decoration-color': 'var(--text-tertiary)',
            }}
          >
            {t().title || <span style={{ color: 'var(--text-tertiary)' }}>New To-Do</span>}
          </span>
          <Show when={props.ctx.onPriority}>
            <button
              data-testid="em-chip"
              aria-label="Set priority"
              onClick={(e) => {
                e.stopPropagation();
                props.ctx.onPriority!(t().id);
              }}
              style={{
                display: 'inline-flex',
                'align-items': 'center',
                gap: '4px',
                padding: '1px 8px',
                'border-radius': '999px',
                'font-size': '11px',
                'font-weight': '700',
                'letter-spacing': '0.3px',
                'flex-shrink': '0',
                ...(t().priority
                  ? {
                      color: '#fff',
                      background: quadrantMeta(t().priority!).color,
                    }
                  : {
                      color: 'var(--text-tertiary)',
                      background: 'transparent',
                      border: '1.5px solid var(--separator)',
                    }),
              }}
            >
              {t().priority ? quadrantMeta(t().priority!).label : 'EM'}
            </button>
          </Show>
          <Show when={t().deadline}>
            <DeadlineFlag
              text={formatDeadline(t().deadline!, currentDate())}
              overdue={isOverdue(t(), currentDate())}
            />
          </Show>
        </div>
        <Show when={notePreview() || t().checklist.length > 0 || tags().length > 0 || (props.ctx.showWhen && t().startDate) || (props.ctx.showEveningBadge && t().evening)}>
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: '8px',
              'margin-top': '3px',
              'flex-wrap': 'wrap',
            }}
          >
            <Show when={props.ctx.showWhen && t().startDate}>
              <span style={{ display: 'inline-flex', 'align-items': 'center', gap: '3px', color: 'var(--text-secondary)', 'font-size': 'var(--fs-chip)' }}>
                <Icon name="calendar" size={11} strokeWidth={2.2} />
                {formatRelative(t().startDate!, currentDate())}
              </span>
            </Show>
            <Show when={props.ctx.showEveningBadge && t().evening}>
              <span style={{ color: 'var(--text-secondary)', display: 'inline-flex' }}>
                <Icon name="moon" size={11} />
              </span>
            </Show>
            <Show when={notePreview()}>
              <span
                style={{
                  color: 'var(--text-secondary)',
                  'font-size': 'var(--fs-chip)',
                  overflow: 'hidden',
                  'text-overflow': 'ellipsis',
                  'white-space': 'nowrap',
                  'max-width': '180px',
                }}
              >
                {notePreview()}
              </span>
            </Show>
            <Show when={t().checklist.length > 0}>
              <ChecklistChip done={checklistDone()} total={t().checklist.length} />
            </Show>
            <Show when={tags().length > 0}>
              {tags().map((tag) => (
                <TagPill title={tag.title} />
              ))}
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );

  return (
    <Show when={!props.ctx.noSwipe} fallback={row}>
      <SwipeableRow
        onComplete={() => {
          if (t().status === 'open') toggleComplete(t());
        }}
        onSchedule={() => props.ctx.onSchedule(t().id)}
      >
        {row}
      </SwipeableRow>
    </Show>
  );
}

export { setTaskWhen };
