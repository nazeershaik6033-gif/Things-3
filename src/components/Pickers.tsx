import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { Sheet, SheetTitle } from '../ui/Sheet';
import { Icon, ListIcon, type IconName } from '../ui/Icon';
import { ProgressPie } from '../ui/ProgressPie';
import { TagPill } from '../ui/TagPill';
import { currentDate } from '../app/currentDate';
import { addDays, fromDateStr, monthName, toDateStr, yearOf } from '../domain/dates';
import type { Area, DateStr, Project, Tag, Task } from '../db/models';
import {
  createTag, moveTask, setTaskWhen, updateTask,
  type TaskDestination, type When,
} from '../db/mutations';
import { projectProgress } from '../domain/smartLists';

function PickerRow(props: {
  icon: JSX.Element;
  label: string;
  selected?: boolean;
  onClick: () => void;
  dim?: boolean;
}): JSX.Element {
  return (
    <button
      onClick={props.onClick}
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '12px',
        width: '100%',
        padding: '11px 20px',
        'font-size': '16px',
        color: props.dim ? 'var(--text-secondary)' : 'var(--text)',
        background: props.selected ? 'var(--bg-inset)' : 'transparent',
        'text-align': 'left',
      }}
    >
      {props.icon}
      <span style={{ flex: '1' }}>{props.label}</span>
      <Show when={props.selected}>
        <Icon name="check" size={18} color="var(--blue)" strokeWidth={2.6} />
      </Show>
    </button>
  );
}

/** One swipeable month grid. Past days are dimmed but selectable. */
export function MonthGrid(props: {
  selected: DateStr | null;
  onSelect: (d: DateStr) => void;
}): JSX.Element {
  const [monthStart, setMonthStart] = createSignal<DateStr>(`${currentDate().slice(0, 7)}-01`);
  const weeks = createMemo(() => {
    const start = fromDateStr(monthStart());
    const firstWeekday = start.getDay();
    const rows: (DateStr | null)[][] = [];
    let cursor = addDays(monthStart(), -firstWeekday);
    for (let w = 0; w < 6; w++) {
      const row: (DateStr | null)[] = [];
      for (let d = 0; d < 7; d++) {
        row.push(cursor.slice(0, 7) === monthStart().slice(0, 7) ? cursor : null);
        cursor = addDays(cursor, 1);
      }
      rows.push(row);
      if (cursor.slice(0, 7) > monthStart().slice(0, 7)) break;
    }
    return rows;
  });
  const shiftMonth = (n: number) => {
    const d = fromDateStr(monthStart());
    d.setMonth(d.getMonth() + n);
    setMonthStart(toDateStr(d).slice(0, 7) + '-01');
  };
  return (
    <div style={{ padding: '4px 20px 8px' }}>
      <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', padding: '4px 0 8px' }}>
        <button onClick={() => shiftMonth(-1)} style={{ padding: '6px 10px', color: 'var(--blue)' }} aria-label="Previous month">
          <Icon name="chevron-left" size={17} />
        </button>
        <span style={{ 'font-weight': '600', 'font-size': '15px' }}>
          {monthName(monthStart())}{' '}
          {yearOf(monthStart()) !== yearOf(currentDate()) ? yearOf(monthStart()) : ''}
        </span>
        <button onClick={() => shiftMonth(1)} style={{ padding: '6px 10px', color: 'var(--blue)' }} aria-label="Next month">
          <Icon name="chevron-right" size={17} />
        </button>
      </div>
      <div style={{ display: 'grid', 'grid-template-columns': 'repeat(7, 1fr)', gap: '2px', 'text-align': 'center' }}>
        <For each={['S', 'M', 'T', 'W', 'T', 'F', 'S']}>
          {(d) => <span style={{ 'font-size': '11px', color: 'var(--text-tertiary)', 'font-weight': '600' }}>{d}</span>}
        </For>
        <For each={weeks().flat()}>
          {(day) => (
            <Show when={day} fallback={<span />}>
              <button
                onClick={() => props.onSelect(day!)}
                style={{
                  padding: '7px 0',
                  'border-radius': '50%',
                  'font-size': '15px',
                  background: props.selected === day ? 'var(--blue)' : 'transparent',
                  color:
                    props.selected === day ? '#fff'
                    : day! < currentDate() ? 'var(--text-tertiary)'
                    : day === currentDate() ? 'var(--blue)'
                    : 'var(--text)',
                  'font-weight': day === currentDate() ? '700' : '400',
                }}
              >
                {Number(day!.slice(8, 10))}
              </button>
            </Show>
          )}
        </For>
      </div>
    </div>
  );
}

/** Value-based When sheet, shared by the task card and Quick Entry. */
export function WhenSheet(props: {
  current: { startDate: DateStr | null; evening: boolean; bucket: string };
  onPick: (when: When) => void;
  onClose: () => void;
}): JSX.Element {
  const pick = (when: When) => {
    props.onPick(when);
    props.onClose();
  };
  const isToday = () => props.current.startDate === currentDate() && !props.current.evening;
  const isEvening = () => props.current.startDate === currentDate() && props.current.evening;
  return (
    <Sheet onClose={props.onClose} dragAnywhere>
      <SheetTitle>When</SheetTitle>
      <PickerRow icon={<ListIcon list="today" size={20} />} label="Today" selected={isToday()} onClick={() => pick({ type: 'today' })} />
      <PickerRow icon={<Icon name="moon" size={20} color="var(--purple)" />} label="This Evening" selected={isEvening()} onClick={() => pick({ type: 'evening' })} />
      <MonthGrid
        selected={props.current.startDate && props.current.startDate > currentDate() ? props.current.startDate : null}
        onSelect={(d) => pick(d <= currentDate() ? { type: 'today' } : { type: 'date', date: d })}
      />
      <PickerRow icon={<ListIcon list="someday" size={20} />} label="Someday" selected={props.current.bucket === 'someday'} onClick={() => pick({ type: 'someday' })} />
      <Show when={props.current.startDate || props.current.bucket === 'someday'}>
        <PickerRow icon={<Icon name="close" size={18} color="var(--text-secondary)" />} label="Clear" dim onClick={() => pick(props.current.bucket === 'someday' ? { type: 'anytime' } : { type: 'clear' })} />
      </Show>
      <div style={{ height: '8px' }} />
    </Sheet>
  );
}

export function WhenPicker(props: { task: Task; onClose: () => void }): JSX.Element {
  return (
    <WhenSheet
      current={props.task}
      onPick={(when) => void setTaskWhen(props.task.id, when)}
      onClose={props.onClose}
    />
  );
}

/** Value-based Deadline sheet, shared by the task card and Quick Entry. */
export function DeadlineSheet(props: {
  value: DateStr | null;
  onChange: (d: DateStr | null) => void;
  onClose: () => void;
}): JSX.Element {
  const set = (d: DateStr | null) => {
    props.onChange(d);
    props.onClose();
  };
  return (
    <Sheet onClose={props.onClose} dragAnywhere>
      <SheetTitle>Deadline</SheetTitle>
      <MonthGrid selected={props.value} onSelect={set} />
      <Show when={props.value}>
        <PickerRow icon={<Icon name="close" size={18} color="var(--text-secondary)" />} label="Remove Deadline" dim onClick={() => set(null)} />
      </Show>
      <div style={{ height: '8px' }} />
    </Sheet>
  );
}

export function DeadlinePicker(props: { task: Task; onClose: () => void }): JSX.Element {
  return (
    <DeadlineSheet
      value={props.task.deadline}
      onChange={(d) => void updateTask(props.task.id, { deadline: d })}
      onClose={props.onClose}
    />
  );
}

export function TagPicker(props: {
  task: Task;
  tags: Tag[];
  onClose: () => void;
}): JSX.Element {
  const [draft, setDraft] = createSignal('');
  const toggle = (tagId: string) => {
    const has = props.task.tagIds.includes(tagId);
    void updateTask(props.task.id, {
      tagIds: has ? props.task.tagIds.filter((x) => x !== tagId) : [...props.task.tagIds, tagId],
    });
  };
  const addNew = async () => {
    const title = draft().trim();
    if (!title) return;
    setDraft('');
    const existing = props.tags.find((t) => t.title.toLowerCase() === title.toLowerCase());
    const id = existing ? existing.id : await createTag(title);
    if (!props.task.tagIds.includes(id)) {
      void updateTask(props.task.id, { tagIds: [...props.task.tagIds, id] });
    }
  };
  return (
    <Sheet onClose={props.onClose}>
      <SheetTitle>Tags</SheetTitle>
      <div style={{ display: 'flex', gap: '8px', padding: '0 20px 12px', 'flex-wrap': 'wrap' }}>
        <For each={props.tags}>
          {(tag) => (
            <TagPill title={tag.title} selected={props.task.tagIds.includes(tag.id)} onClick={() => toggle(tag.id)} />
          )}
        </For>
        <Show when={props.tags.length === 0}>
          <span style={{ color: 'var(--text-secondary)', 'font-size': '14px' }}>No tags yet — create one below.</span>
        </Show>
      </div>
      <div style={{ display: 'flex', gap: '8px', padding: '0 20px 16px' }}>
        <input
          value={draft()}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && void addNew()}
          placeholder="New tag…"
          style={{
            flex: '1',
            padding: '8px 12px',
            'border-radius': '9px',
            background: 'var(--bg-inset)',
          }}
        />
        <button onClick={() => void addNew()} style={{ color: 'var(--blue)', 'font-weight': '600', padding: '8px 6px' }}>
          Add
        </button>
      </div>
    </Sheet>
  );
}

export interface DestinationOption {
  label: string;
  icon: JSX.Element;
  indent?: boolean;
  dest: TaskDestination;
}

export function destinationOptions(
  projects: Project[],
  areas: Area[],
  allTasks: Task[],
): DestinationOption[] {
  const live = (p: Project) => p.trashedAt === null && p.status === 'open';
  const list: DestinationOption[] = [
    { label: 'Inbox', icon: <ListIcon list="inbox" size={20} />, dest: { bucket: 'inbox' } },
    { label: 'No Project / Area', icon: <Icon name="layers" size={20} color="var(--text-secondary)" />, dest: {} },
  ];
  for (const p of projects.filter((p) => live(p) && !p.areaId)) {
    list.push({
      label: p.title,
      icon: <ProgressPie progress={projectProgress(allTasks, p.id)} size={19} />,
      dest: { projectId: p.id },
    });
  }
  for (const a of [...areas].sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1))) {
    list.push({
      label: a.title,
      icon: <Icon name="hexagon" size={19} color="var(--teal)" />,
      dest: { areaId: a.id },
    });
    for (const p of projects.filter((p) => live(p) && p.areaId === a.id)) {
      list.push({
        label: p.title,
        icon: <ProgressPie progress={projectProgress(allTasks, p.id)} size={19} />,
        indent: true,
        dest: { projectId: p.id },
      });
    }
  }
  return list;
}

function destMatchesTask(dest: TaskDestination, t: Task): boolean {
  if (dest.bucket === 'inbox') return t.bucket === 'inbox';
  if (dest.projectId) return t.projectId === dest.projectId;
  if (dest.areaId) return !t.projectId && t.areaId === dest.areaId;
  return t.bucket !== 'inbox' && !t.projectId && !t.areaId;
}

/** Value-based destination sheet (Quick Entry + Move). */
export function DestinationSheet(props: {
  title: string;
  options: DestinationOption[];
  isSelected: (dest: TaskDestination) => boolean;
  onPick: (dest: TaskDestination) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <Sheet onClose={props.onClose} dragAnywhere>
      <SheetTitle>{props.title}</SheetTitle>
      <div style={{ 'max-height': '55dvh', 'overflow-y': 'auto' }}>
        <For each={props.options}>
          {(opt) => (
            <div style={{ 'padding-left': opt.indent ? '24px' : '0' }}>
              <PickerRow
                icon={opt.icon}
                label={opt.label}
                selected={props.isSelected(opt.dest)}
                onClick={() => {
                  props.onPick(opt.dest);
                  props.onClose();
                }}
              />
            </div>
          )}
        </For>
      </div>
      <div style={{ height: '8px' }} />
    </Sheet>
  );
}

export function MovePicker(props: {
  task: Task;
  projects: Project[];
  areas: Area[];
  allTasks: Task[];
  onClose: () => void;
}): JSX.Element {
  const options = createMemo(() => destinationOptions(props.projects, props.areas, props.allTasks));
  return (
    <DestinationSheet
      title="Move to"
      options={options()}
      isSelected={(dest) => destMatchesTask(dest, props.task)}
      onPick={(dest) => void moveTask(props.task.id, dest)}
      onClose={props.onClose}
    />
  );
}

export { PickerRow };
export type { IconName };
