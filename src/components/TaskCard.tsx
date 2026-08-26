import {
  createEffect, createMemo, createSignal, on, onCleanup, onMount, Show, type JSX,
} from 'solid-js';
import type { ChecklistItem, Task } from '../db/models';
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
import { AutoTextarea, autosize } from '../ui/TextField';
import { haptic } from '../ui/haptics';
import { createSpring, SPRING } from '../gestures/springs';

type PickerKind = 'when' | 'deadline' | 'tags' | 'move' | null;

/** The expanded inline editor — Things' signature interaction. */
function TaskCard(props: { task: Task }): JSX.Element {
  const t = () => props.task;
  const [picker, setPicker] = createSignal<PickerKind>(null);
  const [editingNotes, setEditingNotes] = createSignal(false);
  // The card owns the checklist while it is open, exactly as it already
  // buffers title and notes. Routing every keystroke through Dexie and back
  // meant a new row only existed a round-trip later — too late for the focus
  // call to land inside the tap that created it, so iOS never raised the
  // keyboard and the caret went nowhere.
  const [checklist, setChecklist] = createSignal<ChecklistItem[]>(props.task.checklist);
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
      class="press-scale"
      onClick={() => {
        haptic('selection');
        onClick();
      }}
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
                haptic('success');
                void completeTask(t().id);
                addGrace(t().id);
              } else {
                void reopenTask(t().id);
                removeGrace(t().id);
              }
            }}
          />
        </div>
        <AutoTextarea
          ref={(el) => (titleEl = el)}
          value={t().title}
          placeholder="New To-Do"
          enterkeyhint="done"
          onInput={(v) => queueWrite({ title: v })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              collapse();
            }
          }}
          style={{
            flex: '1',
            'min-width': '0',
            'font-size': '17px',
            'font-weight': '500',
            'line-height': '1.35',
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
          <AutoTextarea
            ref={(el) => (notesEl = el)}
            value={t().notes}
            placeholder="Notes"
            rows={2}
            onInput={(v) => queueWrite({ notes: v })}
            onBlur={() => {
              flush();
              setEditingNotes(false);
            }}
            style={{
              'font-size': '15px',
              'line-height': '1.45',
              padding: '4px 0',
            }}
          />
        </Show>

        <Show when={checklist().length > 0 || expandedTaskId() === t().id}>
          <ChecklistEditor
            items={checklist()}
            onChange={(items) => {
              setChecklist(items);
              queueWrite({ checklist: items });
            }}
          />
        </Show>

        <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap', padding: '8px 0 4px' }}>
          <Show when={whenLabel()}>
            <button
              class="press-scale"
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
              class="press-scale"
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
  let heightSpring: ReturnType<typeof createSpring> | undefined;
  let animatingHeight = false;
  const expanded = () => expandedTaskId() === props.task.id;

  // If the row leaves this list while expanded (scheduled away, moved),
  // clear the expanded state so no stale backdrop lingers.
  onCleanup(() => {
    if (expandedTaskId() === props.task.id) setExpandedTaskId(null);
  });

  onMount(() => {
    lastH = wrap.offsetHeight;
    const ro = new ResizeObserver(() => {
      if (!animatingHeight) lastH = wrap.offsetHeight;
    });
    ro.observe(wrap);
    onCleanup(() => ro.disconnect());
  });

  // Expand/collapse rides the same spring as every other surface in the app,
  // so an expand interrupted by a collapse inherits its velocity instead of
  // restarting a fixed-duration curve.
  createEffect(
    on(expanded, (_now, prev) => {
      if (prev === undefined) return;
      const newH = wrap.offsetHeight;
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (lastH !== newH && !reduced) {
        if (!heightSpring) {
          heightSpring = createSpring(lastH, (v) => (wrap.style.height = `${v}px`), SPRING.nav);
        }
        if (!animatingHeight) heightSpring.set(lastH);
        animatingHeight = true;
        wrap.style.overflow = 'hidden';
        heightSpring.to(newH, {
          onRest: () => {
            animatingHeight = false;
            wrap.style.height = '';
            wrap.style.overflow = '';
            lastH = wrap.offsetHeight;
          },
        });
      }
      lastH = newH;
    }, { defer: true }),
  );

  onCleanup(() => heightSpring?.stop());

  return (
    <>
      <Show when={expanded()}>
        {/* Inside the screen's stacking context so the card (z 30) stays above */}
        <div
          data-testid="card-backdrop"
          onClick={() => setExpandedTaskId(null)}
          style={{
            position: 'fixed',
            inset: '0',
            'z-index': '20',
            background: 'var(--backdrop)',
            animation: 'fade-in 200ms ease-out',
          }}
        />
      </Show>
      <div ref={wrap} style={{ position: 'relative', 'z-index': expanded() ? 30 : 'auto' }}>
        <Show when={expanded()} fallback={<TaskRow task={props.task} ctx={props.ctx} />}>
          <TaskCard task={props.task} />
        </Show>
      </div>
    </>
  );
}
