import {
  createEffect, createMemo, createSignal, on, onCleanup, onMount, Show, type JSX,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import type { Task } from '../db/models';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { trashTask, updateTask, completeTask, reopenTask } from '../db/mutations';
import { expandedTaskId, setExpandedTaskId, addGrace, removeGrace } from '../app/uiState';
import { currentDate } from '../app/currentDate';
import { formatDeadline, formatRelative } from '../domain/dates';
import { Checkbox } from '../ui/Checkbox';
import { Icon } from '../ui/Icon';
import { TagPill } from '../ui/TagPill';
import { MarkdownView } from './MarkdownView';
import { ChecklistEditor } from './ChecklistEditor';
import { WhenPicker, DeadlinePicker, TagPicker, MovePicker } from './Pickers';
import { TaskRow, type TaskRowContext } from './TaskRow';

function autosize(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

type PickerKind = 'when' | 'deadline' | 'tags' | 'move' | null;

/** The expanded inline editor — Things' signature interaction. */
function TaskCard(props: { task: Task }): JSX.Element {
  const t = () => props.task;
  const [picker, setPicker] = createSignal<PickerKind>(null);
  const [editingNotes, setEditingNotes] = createSignal(false);
  let titleEl!: HTMLTextAreaElement;
  let notesEl: HTMLTextAreaElement | undefined;

  const tags = createLiveQuery(() => db.tags.toArray(), []);
  const projects = createLiveQuery(() => db.projects.toArray(), []);
  const areas = createLiveQuery(() => db.areas.toArray(), []);
  const allTasks = createLiveQuery(() => db.tasks.toArray(), []);

  // Debounced writes: title/notes buffer locally, flush on pause or collapse
  let pendingPatch: Partial<Task> = {};
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  const queueWrite = (patch: Partial<Task>) => {
    pendingPatch = { ...pendingPatch, ...patch };
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 300);
  };
  const flush = () => {
    clearTimeout(flushTimer);
    if (Object.keys(pendingPatch).length === 0) return;
    const patch = pendingPatch;
    pendingPatch = {};
    void updateTask(t().id, patch);
  };
  onCleanup(flush);

  const collapse = () => {
    flush();
    setExpandedTaskId(null);
  };

  onMount(() => {
    autosize(titleEl);
    if (t().title === '') titleEl.focus();
  });

  const taskTags = createMemo(() =>
    t().tagIds.map((id) => tags().find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x),
  );

  const whenLabel = () => {
    if (t().startDate && t().startDate! <= currentDate()) return t().evening ? 'This Evening' : 'Today';
    if (t().startDate) return formatRelative(t().startDate!, currentDate());
    if (t().bucket === 'someday') return 'Someday';
    return null;
  };

  const actionButton = (icon: JSX.Element, label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        padding: '10px',
        color: 'var(--text-secondary)',
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
      }}
    >
      {icon}
    </button>
  );

  return (
    <div
      data-task-card={t().id}
      style={{
        position: 'relative',
        'z-index': '30',
        background: 'var(--bg-card)',
        'border-radius': 'var(--radius-card)',
        'box-shadow': 'var(--shadow-card)',
        margin: '6px 8px',
        padding: '12px 14px 4px',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', gap: '12px', 'align-items': 'flex-start' }}>
        <div style={{ 'padding-top': '4px' }}>
          <Checkbox
            checked={t().status !== 'open'}
            canceled={t().status === 'canceled'}
            onToggle={() => {
              if (t().status === 'open') {
                void completeTask(t().id);
                addGrace(t().id);
              } else {
                void reopenTask(t().id);
                removeGrace(t().id);
              }
            }}
          />
        </div>
        <textarea
          ref={titleEl}
          value={t().title}
          placeholder="New To-Do"
          rows={1}
          enterkeyhint="done"
          onInput={(e) => {
            autosize(e.currentTarget);
            queueWrite({ title: e.currentTarget.value });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              collapse();
            }
          }}
          style={{
            flex: '1',
            'font-size': '17px',
            'font-weight': '500',
            'line-height': '1.35',
            overflow: 'hidden',
          }}
        />
      </div>

      <div style={{ 'padding-left': '31px' }}>
        <Show
          when={editingNotes()}
          fallback={
            <div
              onClick={() => {
                setEditingNotes(true);
                queueMicrotask(() => {
                  if (notesEl) {
                    autosize(notesEl);
                    notesEl.focus();
                    notesEl.setSelectionRange(notesEl.value.length, notesEl.value.length);
                  }
                });
              }}
              style={{ 'min-height': t().notes ? 'auto' : '24px', padding: '4px 0', cursor: 'text' }}
            >
              <Show
                when={t().notes}
                fallback={<span style={{ color: 'var(--text-tertiary)', 'font-size': '15px' }}>Notes</span>}
              >
                <MarkdownView source={t().notes} />
              </Show>
            </div>
          }
        >
          <textarea
            ref={notesEl}
            value={t().notes}
            placeholder="Notes"
            rows={2}
            onInput={(e) => {
              autosize(e.currentTarget);
              queueWrite({ notes: e.currentTarget.value });
            }}
            onBlur={() => {
              flush();
              setEditingNotes(false);
            }}
            style={{
              width: '100%',
              'font-size': '15px',
              'line-height': '1.45',
              overflow: 'hidden',
              padding: '4px 0',
            }}
          />
        </Show>

        <Show when={t().checklist.length > 0 || expandedTaskId() === t().id}>
          <ChecklistEditor
            items={t().checklist}
            onChange={(items) => void updateTask(t().id, { checklist: items })}
          />
        </Show>

        <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap', padding: '8px 0 4px' }}>
          <Show when={whenLabel()}>
            <button
              onClick={() => setPicker('when')}
              style={{
                display: 'inline-flex',
                'align-items': 'center',
                gap: '5px',
                padding: '3px 10px',
                'border-radius': '999px',
                background: 'var(--bg-inset)',
                color: 'var(--text)',
                'font-size': '13px',
                'font-weight': '500',
              }}
            >
              <Show
                when={whenLabel() === 'This Evening'}
                fallback={<Icon name={whenLabel() === 'Someday' ? 'archive' : 'star'} size={13} color={whenLabel() === 'Someday' ? 'var(--tan)' : 'var(--yellow)'} />}
              >
                <Icon name="moon" size={13} color="var(--purple)" />
              </Show>
              {whenLabel()}
            </button>
          </Show>
          <Show when={t().deadline}>
            <button
              onClick={() => setPicker('deadline')}
              style={{
                display: 'inline-flex',
                'align-items': 'center',
                gap: '5px',
                padding: '3px 10px',
                'border-radius': '999px',
                background: 'var(--bg-inset)',
                color: t().deadline! < currentDate() ? 'var(--red)' : 'var(--text)',
                'font-size': '13px',
                'font-weight': '500',
              }}
            >
              <Icon name="flag" size={13} color="var(--red)" />
              {formatDeadline(t().deadline!, currentDate())}
            </button>
          </Show>
          {taskTags().map((tag) => (
            <span onClick={() => setPicker('tags')}>
              <TagPill title={tag.title} />
            </span>
          ))}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          'justify-content': 'space-between',
          'border-top': '1px solid var(--separator)',
          'margin-top': '4px',
        }}
      >
        {actionButton(<Icon name="calendar" size={20} />, 'Schedule', () => setPicker('when'))}
        {actionButton(<Icon name="flag" size={20} />, 'Deadline', () => setPicker('deadline'))}
        {actionButton(<Icon name="tag" size={20} />, 'Tags', () => setPicker('tags'))}
        {actionButton(<Icon name="arrow-move" size={20} />, 'Move', () => setPicker('move'))}
        {actionButton(<Icon name="trash" size={20} />, 'Delete', () => {
          void trashTask(t().id);
          collapse();
        })}
      </div>

      <Show when={picker() === 'when'}>
        <WhenPicker task={t()} onClose={() => setPicker(null)} />
      </Show>
      <Show when={picker() === 'deadline'}>
        <DeadlinePicker task={t()} onClose={() => setPicker(null)} />
      </Show>
      <Show when={picker() === 'tags'}>
        <TagPicker task={t()} tags={tags()} onClose={() => setPicker(null)} />
      </Show>
      <Show when={picker() === 'move'}>
        <MovePicker task={t()} projects={projects()} areas={areas()} allTasks={allTasks()} onClose={() => setPicker(null)} />
      </Show>
    </div>
  );
}

/** Renders the row, morphing into the editing card when expanded. The
 *  height change is animated with WAAPI (one isolated, contained layout
 *  animation — everything else in the app is transform-only). */
export function ExpandableTask(props: { task: Task; ctx: TaskRowContext }): JSX.Element {
  let wrap!: HTMLDivElement;
  let lastH = 0;
  const expanded = () => expandedTaskId() === props.task.id;

  onMount(() => {
    lastH = wrap.offsetHeight;
    const ro = new ResizeObserver(() => {
      if (wrap.getAnimations().length === 0) lastH = wrap.offsetHeight;
    });
    ro.observe(wrap);
    onCleanup(() => ro.disconnect());
  });

  createEffect(
    on(expanded, (_now, prev) => {
      if (prev === undefined) return;
      const newH = wrap.offsetHeight;
      if (lastH !== newH) {
        wrap.style.overflow = 'hidden';
        const anim = wrap.animate(
          [{ height: `${lastH}px` }, { height: `${newH}px` }],
          { duration: 300, easing: 'cubic-bezier(0.32, 0.72, 0.2, 1)' },
        );
        anim.onfinish = () => {
          wrap.style.overflow = '';
          lastH = wrap.offsetHeight;
        };
      }
      lastH = newH;
    }, { defer: true }),
  );

  return (
    <>
      <Show when={expanded()}>
        <Portal>
          <div
            onClick={() => setExpandedTaskId(null)}
            style={{
              position: 'fixed',
              inset: '0',
              'z-index': '20',
              background: 'var(--backdrop)',
              animation: 'fade-in 200ms ease-out',
            }}
          />
        </Portal>
      </Show>
      <div ref={wrap} style={{ position: 'relative', 'z-index': expanded() ? 30 : 'auto' }}>
        <Show when={expanded()} fallback={<TaskRow task={props.task} ctx={props.ctx} />}>
          <TaskCard task={props.task} />
        </Show>
      </div>
    </>
  );
}
