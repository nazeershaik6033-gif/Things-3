import { createMemo, createSignal, Show, type JSX } from 'solid-js';
import { FullScreenSheet } from '../ui/FullScreenSheet';
import { Icon } from '../ui/Icon';
import { TagPill } from '../ui/TagPill';
import { AutoTextarea, SyncedInput } from '../ui/TextField';
import { haptic } from '../app/motion';
import { quickEntry, setQuickEntry, type QuickEntryState } from '../app/uiState';
import { createTask, createTag, updateTask, type TaskDestination, type When } from '../db/mutations';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { currentDate } from '../app/currentDate';
import { addDays, formatRelative } from '../domain/dates';
import type { ChecklistItem, DateStr } from '../db/models';
import {
  WhenSheet, DeadlineSheet, DestinationSheet, destinationOptions,
} from './Pickers';
import { ChecklistEditor } from './ChecklistEditor';

type SubSheet = 'when' | 'deadline' | 'dest' | null;

/** The Magic-Plus / toolbar quick entry: a near-full-height compose panel that
 *  tracks the keyboard, so the title, notes and checklist are all visible and
 *  editable at once instead of fighting over ~100px above the keyboard. */
export function QuickEntry(): JSX.Element {
  return (
    <Show when={quickEntry()} keyed>
      {(state) => <QuickEntryInner init={state} />}
    </Show>
  );
}

function QuickEntryInner(props: { init: QuickEntryState }): JSX.Element {
  const init = props.init;
  const [title, setTitle] = createSignal('');
  const [notes, setNotes] = createSignal('');
  const [checklist, setChecklist] = createSignal<ChecklistItem[]>([]);
  const [showChecklist, setShowChecklist] = createSignal(false);
  const [tagDraft, setTagDraft] = createSignal('');
  const [showTagInput, setShowTagInput] = createSignal(false);
  const [tagIds, setTagIds] = createSignal<string[]>([]);
  const [startDate, setStartDate] = createSignal<DateStr | null>(init.startDate ?? null);
  const [evening, setEvening] = createSignal(init.evening ?? false);
  const [bucket, setBucket] = createSignal<'inbox' | 'anytime' | 'someday'>(
    init.destination.bucket ?? (init.destination.projectId || init.destination.areaId ? 'anytime' : 'inbox'),
  );
  const [deadline, setDeadline] = createSignal<DateStr | null>(null);
  const [dest, setDest] = createSignal<TaskDestination>(init.destination);
  const [sub, setSub] = createSignal<SubSheet>(null);

  let notesEl: HTMLTextAreaElement | undefined;

  const tags = createLiveQuery(() => db.tags.toArray(), []);
  const projects = createLiveQuery(() => db.projects.toArray(), []);
  const areas = createLiveQuery(() => db.areas.toArray(), []);
  const allTasks = createLiveQuery(() => db.tasks.toArray(), []);

  let closeRequested = false;
  const close = () => {
    if (closeRequested) return;
    closeRequested = true;
    setQuickEntry(null);
  };

  const applyWhen = (when: When) => {
    switch (when.type) {
      case 'today': setStartDate(currentDate()); setEvening(false); if (bucket() !== 'anytime') setBucket('anytime'); break;
      case 'evening': setStartDate(currentDate()); setEvening(true); if (bucket() !== 'anytime') setBucket('anytime'); break;
      case 'date': setStartDate(when.date); setEvening(false); setBucket('anytime'); break;
      case 'someday': setStartDate(null); setEvening(false); setBucket('someday'); break;
      case 'anytime': setStartDate(null); setEvening(false); setBucket('anytime'); break;
      case 'clear': setStartDate(null); setEvening(false); break;
    }
  };

  const save = async () => {
    if (!title().trim() && !notes().trim() && checklist().length === 0) {
      close();
      return;
    }
    const d = dest();
    haptic('success');
    await createTask({
      title: title().trim(),
      notes: notes(),
      checklist: checklist().filter((c) => c.title.trim() !== ''),
      tagIds: tagIds(),
      startDate: startDate(),
      evening: evening(),
      deadline: deadline(),
      bucket: bucket(),
      projectId: d.projectId ?? null,
      headingId: d.headingId ?? null,
      areaId: d.areaId ?? null,
      ...(init.orderKey ? { orderKey: init.orderKey } : {}),
    });
    close();
  };

  const destLabel = createMemo(() => {
    const d = dest();
    if (d.projectId) return projects().find((p) => p.id === d.projectId)?.title ?? 'Project';
    if (d.areaId) return areas().find((a) => a.id === d.areaId)?.title ?? 'Area';
    if (bucket() === 'someday') return 'Someday';
    if (d.bucket === 'inbox' || bucket() === 'inbox') return 'Inbox';
    return 'Anytime';
  });

  const whenChip = createMemo(() => {
    if (startDate() && startDate()! <= currentDate()) return evening() ? 'This Evening' : 'Today';
    if (startDate()) return formatRelative(startDate()!, currentDate());
    if (bucket() === 'someday') return 'Someday';
    return null;
  });

  /** Toolbar buttons act on pointerdown-prevented taps: the default would move
   *  focus off the textarea, and on iOS that collapses the keyboard mid-entry. */
  const toolbarBtn = (icon: JSX.Element, label: string, active: boolean, onTap: () => void) => (
    <button
      class="pressable"
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => {
        haptic('tick');
        onTap();
      }}
      aria-label={label}
      style={{
        padding: '10px 11px',
        color: active ? 'var(--blue)' : 'var(--text-secondary)',
        display: 'flex',
        transition: 'color 160ms ease-out',
      }}
    >
      {icon}
    </button>
  );

  const chip = (onClick: () => void, children: JSX.Element, color?: string) => (
    <button
      class="pressable"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        'align-items': 'center',
        gap: '5px',
        padding: '4px 11px',
        'border-radius': '999px',
        background: 'var(--bg-inset)',
        'font-size': '13px',
        'font-weight': '500',
        color: color ?? 'var(--text)',
      }}
    >
      {children}
    </button>
  );

  const addTag = async () => {
    const t = tagDraft().trim();
    if (!t) return;
    setTagDraft('');
    const existing = tags().find((x) => x.title.toLowerCase() === t.toLowerCase());
    const id = existing ? existing.id : await createTag(t);
    if (!tagIds().includes(id)) setTagIds([...tagIds(), id]);
  };

  const revealChecklist = () => {
    setShowChecklist(true);
    queueMicrotask(() => {
      document.querySelector<HTMLElement>('[data-quick-entry] input[data-checklist-id]')?.focus();
    });
  };

  return (
    <>
      <FullScreenSheet onClose={close} label="New To-Do">
        {/* Header ---------------------------------------------------------- */}
        <div
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '8px',
            padding: '6px 12px 8px',
            'border-bottom': '1px solid var(--separator)',
            flex: 'none',
          }}
        >
          <button
            class="pressable"
            onClick={close}
            style={{ color: 'var(--text-secondary)', 'font-size': '16px', padding: '8px 6px' }}
          >
            Cancel
          </button>
          <div style={{ flex: '1' }} />
          <button
            class="pressable"
            data-testid="quick-entry-save"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => void save()}
            style={{
              background: 'var(--blue)',
              color: '#fff',
              'font-weight': '600',
              'font-size': '15px',
              padding: '8px 18px',
              'border-radius': '999px',
            }}
          >
            Save
          </button>
        </div>

        {/* Body ------------------------------------------------------------ */}
        <div
          data-quick-entry
          style={{
            flex: '1',
            'min-height': '0',
            'overflow-y': 'auto',
            'overscroll-behavior': 'contain',
            '-webkit-overflow-scrolling': 'touch',
            padding: '14px 18px 18px',
          }}
        >
          <AutoTextarea
            value={title()}
            onInput={setTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void save();
              }
            }}
            placeholder="New To-Do"
            enterkeyhint="done"
            autofocus
            style={{
              'font-size': '20px',
              'font-weight': '600',
              'line-height': '1.3',
              padding: '2px 0 10px',
            }}
          />

          <Show when={tagIds().length > 0 || whenChip() || deadline()}>
            <div class="rise" style={{ display: 'flex', gap: '7px', 'flex-wrap': 'wrap', padding: '2px 0 10px' }}>
              <Show when={whenChip()}>
                {chip(() => setSub('when'), (
                  <>
                    <Show
                      when={whenChip() === 'This Evening'}
                      fallback={<Icon name={whenChip() === 'Someday' ? 'archive' : 'star'} size={13} color={whenChip() === 'Someday' ? 'var(--tan)' : 'var(--yellow)'} />}
                    >
                      <Icon name="moon" size={13} color="var(--purple)" />
                    </Show>
                    {whenChip()}
                  </>
                ))}
              </Show>
              <Show when={whenChip() === 'Today'}>
                <button
                  onClick={() => applyWhen({ type: 'date', date: addDays(currentDate(), 1) })}
                  style={{ display: 'inline-flex', 'align-items': 'center', gap: '5px', padding: '3px 10px', 'border-radius': '999px', background: 'var(--bg-inset)', 'font-size': '13px', 'font-weight': '500', color: 'var(--text-secondary)' }}
                >
                  Tomorrow
                </button>
              </Show>
              <Show when={deadline()}>
                {chip(() => setSub('deadline'), (
                  <>
                    <Icon name="flag" size={13} color="var(--red)" />
                    {formatRelative(deadline()!, currentDate())}
                  </>
                ))}
              </Show>
              {tagIds().map((id) => {
                const tag = tags().find((t) => t.id === id);
                return tag ? (
                  <TagPill title={tag.title} onClick={() => setTagIds(tagIds().filter((x) => x !== id))} />
                ) : null;
              })}
            </div>
          </Show>

          <Show when={showTagInput()}>
            <div class="rise" style={{ display: 'flex', gap: '8px', padding: '0 0 10px' }}>
              <SyncedInput
                value={tagDraft()}
                onInput={setTagDraft}
                onKeyDown={(e) => e.key === 'Enter' && void addTag()}
                placeholder="Add tag…"
                style={{ flex: '1', padding: '8px 12px', 'border-radius': '10px', background: 'var(--bg-inset)', 'font-size': '15px' }}
              />
              <button class="pressable" onClick={() => void addTag()} style={{ color: 'var(--blue)', 'font-weight': '600' }}>
                Add
              </button>
            </div>
          </Show>

          {/* Notes is always present — the whole point of the taller panel. */}
          <AutoTextarea
            ref={(el) => (notesEl = el)}
            value={notes()}
            onInput={setNotes}
            placeholder="Notes"
            rows={3}
            style={{ 'font-size': '16px', 'line-height': '1.5', 'min-height': '88px', padding: '2px 0' }}
          />

          <Show when={showChecklist() || checklist().length > 0}>
            <div class="rise" style={{ 'padding-top': '8px', 'border-top': '1px solid var(--separator)', 'margin-top': '10px' }}>
              <ChecklistEditor items={checklist()} onChange={setChecklist} />
            </div>
          </Show>
        </div>

        {/* Destination + toolbar ------------------------------------------- */}
        <div style={{ flex: 'none', 'border-top': '1px solid var(--separator)' }}>
          <button
            class="pressable"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => setSub('dest')}
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: '8px',
              width: '100%',
              padding: '11px 18px',
              'font-size': '15px',
              'text-align': 'left',
              color: 'var(--text-secondary)',
            }}
          >
            <span style={{ flex: '1' }}>List</span>
            <span style={{ color: 'var(--text)', 'font-weight': '500' }}>{destLabel()}</span>
            <Icon name="chevron-right" size={13} />
          </button>

          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'space-around',
              'border-top': '1px solid var(--separator)',
              padding: '2px 6px',
              'padding-bottom': 'calc(2px + var(--safe-bottom))',
            }}
          >
            {toolbarBtn(<Icon name="calendar" size={21} />, 'When', !!whenChip(), () => setSub('when'))}
            {toolbarBtn(<Icon name="flag" size={21} />, 'Deadline', !!deadline(), () => setSub('deadline'))}
            {toolbarBtn(<Icon name="tag" size={21} />, 'Tags', tagIds().length > 0, () => setShowTagInput(!showTagInput()))}
            {toolbarBtn(<Icon name="checklist" size={21} />, 'Checklist', checklist().length > 0, revealChecklist)}
            {toolbarBtn(<Icon name="notes" size={21} />, 'Notes', notes() !== '', () => notesEl?.focus())}
          </div>
        </div>
      </FullScreenSheet>

      <Show when={sub() === 'when'}>
        <WhenSheet
          current={{ startDate: startDate(), evening: evening(), bucket: bucket() }}
          onPick={applyWhen}
          onClose={() => setSub(null)}
        />
      </Show>
      <Show when={sub() === 'deadline'}>
        <DeadlineSheet value={deadline()} onChange={setDeadline} onClose={() => setSub(null)} />
      </Show>
      <Show when={sub() === 'dest'}>
        <DestinationSheet
          title="List"
          options={destinationOptions(projects(), areas(), allTasks())}
          isSelected={(d) =>
            d.projectId ? d.projectId === dest().projectId
            : d.areaId ? d.areaId === dest().areaId
            : d.bucket === 'inbox' ? bucket() === 'inbox' && !dest().projectId && !dest().areaId
            : !dest().projectId && !dest().areaId && bucket() !== 'inbox'}
          onPick={(d) => {
            setDest(d);
            if (d.bucket === 'inbox') setBucket('inbox');
            else if (bucket() === 'inbox') setBucket('anytime');
          }}
          onClose={() => setSub(null)}
        />
      </Show>
    </>
  );
}

export { updateTask };
