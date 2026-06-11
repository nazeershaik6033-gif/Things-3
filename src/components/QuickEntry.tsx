import { createMemo, createSignal, Show, type JSX } from 'solid-js';
import { nanoid } from 'nanoid';
import { Sheet } from '../ui/Sheet';
import { Icon } from '../ui/Icon';
import { TagPill } from '../ui/TagPill';
import { quickEntry, setQuickEntry } from '../app/uiState';
import { createTask, type TaskDestination, type When } from '../db/mutations';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { currentDate } from '../app/currentDate';
import { formatRelative } from '../domain/dates';
import type { ChecklistItem, DateStr } from '../db/models';
import {
  WhenSheet, DeadlineSheet, DestinationSheet, destinationOptions,
} from './Pickers';
import { ChecklistEditor } from './ChecklistEditor';
import { Sheet as _S } from '../ui/Sheet';
import { createTag, updateTask } from '../db/mutations';

function autosize(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

type SubSheet = 'when' | 'deadline' | 'dest' | null;

/** The Magic-Plus / toolbar quick entry: a white rounded card sliding over a
 *  dimmed backdrop, exactly like Things' iPhone quick entry. */
export function QuickEntry(): JSX.Element {
  const state = quickEntry;
  return (
    <Show when={state()}>
      <QuickEntryInner key={JSON.stringify(state())} />
    </Show>
  );
}

function QuickEntryInner(_props: { key: string }): JSX.Element {
  const init = quickEntry()!;
  const [title, setTitle] = createSignal('');
  const [notes, setNotes] = createSignal('');
  const [showNotes, setShowNotes] = createSignal(false);
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

  const toolbarBtn = (icon: JSX.Element, label: string, active: boolean, onClick: () => void) => (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        padding: '9px',
        color: active ? 'var(--blue)' : 'var(--text-secondary)',
        display: 'flex',
      }}
    >
      {icon}
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

  return (
    <>
      <Sheet onClose={close} trackKeyboard>
        <div style={{ padding: '4px 18px 0' }} data-quick-entry>
          <textarea
            value={title()}
            onInput={(e) => {
              autosize(e.currentTarget);
              setTitle(e.currentTarget.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void save();
              }
            }}
            placeholder="New To-Do"
            rows={1}
            enterkeyhint="done"
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autofocus
            style={{
              width: '100%',
              'font-size': '17px',
              'font-weight': '500',
              overflow: 'hidden',
              padding: '6px 0',
            }}
          />
          <Show when={showNotes()}>
            <textarea
              value={notes()}
              onInput={(e) => {
                autosize(e.currentTarget);
                setNotes(e.currentTarget.value);
              }}
              placeholder="Notes"
              rows={2}
              style={{ width: '100%', 'font-size': '15px', overflow: 'hidden', padding: '2px 0' }}
            />
          </Show>
          <Show when={showChecklist()}>
            <ChecklistEditor items={checklist()} onChange={setChecklist} />
          </Show>
          <Show when={tagIds().length > 0 || whenChip() || deadline()}>
            <div style={{ display: 'flex', gap: '7px', 'flex-wrap': 'wrap', padding: '4px 0 6px' }}>
              <Show when={whenChip()}>
                <button
                  onClick={() => setSub('when')}
                  style={{ display: 'inline-flex', 'align-items': 'center', gap: '5px', padding: '3px 10px', 'border-radius': '999px', background: 'var(--bg-inset)', 'font-size': '13px', 'font-weight': '500', color: 'var(--text)' }}
                >
                  <Show when={whenChip() === 'This Evening'} fallback={<Icon name={whenChip() === 'Someday' ? 'archive' : 'star'} size={13} color={whenChip() === 'Someday' ? 'var(--tan)' : 'var(--yellow)'} />}>
                    <Icon name="moon" size={13} color="var(--purple)" />
                  </Show>
                  {whenChip()}
                </button>
              </Show>
              <Show when={deadline()}>
                <button
                  onClick={() => setSub('deadline')}
                  style={{ display: 'inline-flex', 'align-items': 'center', gap: '5px', padding: '3px 10px', 'border-radius': '999px', background: 'var(--bg-inset)', 'font-size': '13px', 'font-weight': '500', color: 'var(--text)' }}
                >
                  <Icon name="flag" size={13} color="var(--red)" />
                  {formatRelative(deadline()!, currentDate())}
                </button>
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
            <div style={{ display: 'flex', gap: '8px', padding: '2px 0 8px' }}>
              <input
                value={tagDraft()}
                onInput={(e) => setTagDraft(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && void addTag()}
                placeholder="Add tag…"
                style={{ flex: '1', padding: '6px 10px', 'border-radius': '8px', background: 'var(--bg-inset)', 'font-size': '14px' }}
              />
              <button onClick={() => void addTag()} style={{ color: 'var(--blue)', 'font-weight': '600' }}>Add</button>
            </div>
          </Show>

          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              'border-top': '1px solid var(--separator)',
              'margin-top': '2px',
              padding: '2px 0 6px',
            }}
          >
            {toolbarBtn(<Icon name="calendar" size={20} />, 'When', !!whenChip(), () => setSub('when'))}
            {toolbarBtn(<Icon name="flag" size={20} />, 'Deadline', !!deadline(), () => setSub('deadline'))}
            {toolbarBtn(<Icon name="tag" size={20} />, 'Tags', tagIds().length > 0, () => setShowTagInput(!showTagInput()))}
            {toolbarBtn(<Icon name="checklist" size={20} />, 'Checklist', checklist().length > 0, () => setShowChecklist(!showChecklist()))}
            {toolbarBtn(<Icon name="notes" size={20} />, 'Notes', notes() !== '', () => setShowNotes(!showNotes()))}
            <div style={{ flex: '1' }} />
            <button
              onClick={() => setSub('dest')}
              style={{ display: 'inline-flex', 'align-items': 'center', gap: '4px', color: 'var(--text-secondary)', 'font-size': '14px', padding: '6px 8px' }}
            >
              {destLabel()}
              <Icon name="chevron-right" size={12} />
            </button>
            <button
              data-testid="quick-entry-save"
              onClick={() => void save()}
              style={{
                background: 'var(--blue)',
                color: '#fff',
                'font-weight': '600',
                'font-size': '15px',
                padding: '8px 18px',
                'border-radius': '999px',
                'margin-left': '8px',
              }}
            >
              Save
            </button>
          </div>
        </div>
      </Sheet>

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
