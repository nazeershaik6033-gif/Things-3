import { createSignal, For, Show, createMemo, type JSX } from 'solid-js';
import type { RoutineGroup, RoutineSource, RoutineWindow, SourceKind } from '../db/models';
import { Sheet, SheetTitle } from '../ui/Sheet';
import { Icon } from '../ui/Icon';
import { SyncedInput } from '../ui/TextField';
import { MenuRow } from '../screens/common';
import { StatTile, StreakGrid, kindIcon } from './RoutineBlock';
import { formatClock, sortedWindows } from '../domain/routineWindows';
import { colorForGroupId, GROUP_PALETTE, type DayMark, type Streak } from '../domain/myRoutine';

/** Sheets for My Routine: adding and editing a source, editing the windows,
 *  the per-source action menu, and the stats readout. Split out of the screen
 *  so the list itself stays readable. */

const fieldStyle: JSX.CSSProperties = {
  width: '100%',
  padding: '11px 13px',
  'border-radius': 'var(--radius-row)',
  border: '1px solid var(--separator)',
  background: 'var(--bg-inset)',
  color: 'var(--text)',
  'font-size': '16px', // 16px or iOS zooms the page on focus
  outline: 'none',
};

const labelStyle: JSX.CSSProperties = {
  display: 'block',
  'font-size': '12px',
  'font-weight': '600',
  'letter-spacing': '0.04em',
  'text-transform': 'uppercase',
  color: 'var(--text-secondary)',
  margin: '14px 0 6px',
};

function PrimaryButton(props: {
  label: string;
  disabled?: boolean;
  testid?: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      class="pressable"
      onClick={props.onClick}
      disabled={props.disabled}
      data-testid={props.testid}
      style={{
        width: '100%',
        margin: '18px 0 4px',
        padding: '13px',
        'border-radius': 'var(--radius-row)',
        background: 'var(--blue)',
        color: '#fff',
        'font-size': '16px',
        'font-weight': '600',
        opacity: props.disabled ? '0.45' : '1',
      }}
    >
      {props.label}
    </button>
  );
}

const KINDS: Array<[SourceKind, string, string]> = [
  ['youtube', 'YouTube', 'Channel @handle or URL'],
  ['telegram', 'Telegram', 'Public channel @name'],
  ['rss', 'RSS', 'Feed or site URL'],
  ['link', 'Link', 'Any site or app URL'],
];

export interface SourceDraftState {
  id: string | null;
  kind: SourceKind;
  raw: string;
  name: string;
  groupId: string | null;
}

/** Add or edit one source. The kind picker decides whether the source can be
 *  polled at all, which is why it leads the form. */
export function SourceSheet(props: {
  draft: SourceDraftState;
  groups: RoutineGroup[];
  busy: boolean;
  onSave: (draft: SourceDraftState) => void;
  onClose: () => void;
}): JSX.Element {
  const [kind, setKind] = createSignal<SourceKind>(props.draft.kind);
  const [raw, setRaw] = createSignal(props.draft.raw);
  const [name, setName] = createSignal(props.draft.name);
  const [groupId, setGroupId] = createSignal<string | null>(props.draft.groupId);
  const placeholder = () => KINDS.find(([k]) => k === kind())?.[2] ?? '';

  return (
    <Sheet onClose={props.onClose}>
      <SheetTitle>{props.draft.id ? 'Edit source' : 'Add to My Routine'}</SheetTitle>
      <div style={{ padding: '0 20px 20px' }}>
        <span style={labelStyle}>Type</span>
        <div style={{ display: 'flex', gap: '6px' }}>
          <For each={KINDS}>
            {([k, label]) => (
              <button
                class="pressable"
                onClick={() => setKind(k)}
                aria-pressed={kind() === k}
                data-testid={`routine-kind-${k}`}
                style={{
                  flex: '1',
                  display: 'flex',
                  'flex-direction': 'column',
                  'align-items': 'center',
                  gap: '4px',
                  padding: '10px 4px',
                  'border-radius': 'var(--radius-row)',
                  border: `1px solid ${kind() === k ? 'var(--blue)' : 'var(--separator)'}`,
                  background: kind() === k ? 'rgba(47, 124, 246, 0.1)' : 'transparent',
                  color: kind() === k ? 'var(--blue)' : 'var(--text-secondary)',
                  'font-size': '12px',
                  'font-weight': '600',
                }}
              >
                <Icon name={kindIcon(k)} size={17} />
                {label}
              </button>
            )}
          </For>
        </div>

        <span style={labelStyle}>Link or handle</span>
        <SyncedInput
          value={raw()}
          onInput={setRaw}
          placeholder={placeholder()}
          style={fieldStyle}
          attrs={{
            'data-testid': 'routine-source-url',
            autocapitalize: 'none',
            autocorrect: 'off',
            spellcheck: 'false',
          }}
        />

        <span style={labelStyle}>Name</span>
        <SyncedInput
          value={name()}
          onInput={setName}
          placeholder="Optional — we'll guess one"
          style={fieldStyle}
          attrs={{ 'data-testid': 'routine-source-name' }}
        />

        <Show when={props.groups.length > 0}>
          <span style={labelStyle}>Group</span>
          <div style={{ display: 'flex', gap: '6px', 'flex-wrap': 'wrap' }}>
            <For each={[null, ...props.groups.map((g) => g.id)]}>
              {(id) => {
                const group = () => props.groups.find((g) => g.id === id);
                const label = () => group()?.name ?? 'Other';
                return (
                  <button
                    class="pressable"
                    onClick={() => setGroupId(id)}
                    aria-pressed={groupId() === id}
                    style={{
                      padding: '7px 13px',
                      'border-radius': '16px',
                      'font-size': '13px',
                      'font-weight': '600',
                      border: `1px solid ${groupId() === id ? 'var(--text)' : 'var(--separator)'}`,
                      background: groupId() === id ? 'var(--text)' : 'transparent',
                      color: groupId() === id ? 'var(--bg-list)' : 'var(--text-secondary)',
                    }}
                  >
                    {label()}
                  </button>
                );
              }}
            </For>
          </div>
        </Show>

        <PrimaryButton
          label={props.busy ? 'Saving…' : props.draft.id ? 'Save' : 'Add source'}
          disabled={props.busy || !raw().trim()}
          testid="routine-source-save"
          onClick={() =>
            props.onSave({ id: props.draft.id, kind: kind(), raw: raw(), name: name(), groupId: groupId() })
          }
        />
        <p style={{ 'font-size': '12.5px', color: 'var(--text-secondary)', 'line-height': '1.5', margin: '10px 2px 0' }}>
          YouTube, Telegram and RSS sources are checked for new posts. A plain
          link is just something to tick off.
        </p>
      </div>
    </Sheet>
  );
}

/** Rename a group and pick its stripe color. */
export function GroupSheet(props: {
  group: RoutineGroup | null;
  onSave: (name: string, color: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [name, setName] = createSignal(props.group?.name ?? '');
  const [color, setColor] = createSignal(
    props.group ? props.group.color || colorForGroupId(props.group.id) : GROUP_PALETTE[0]!,
  );
  return (
    <Sheet onClose={props.onClose}>
      <SheetTitle>{props.group ? 'Rename group' : 'New group'}</SheetTitle>
      <div style={{ padding: '0 20px 20px' }}>
        <SyncedInput
          value={name()}
          onInput={setName}
          placeholder="Group name"
          style={fieldStyle}
          attrs={{ 'data-testid': 'routine-group-name' }}
        />
        <span style={labelStyle}>Color</span>
        <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
          <For each={GROUP_PALETTE}>
            {(c) => (
              <button
                class="pressable"
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                aria-pressed={color() === c}
                style={{
                  width: '30px',
                  height: '30px',
                  'border-radius': '15px',
                  background: c,
                  border: color() === c ? '3px solid var(--text)' : '3px solid transparent',
                }}
              />
            )}
          </For>
        </div>
        <PrimaryButton
          label="Save"
          disabled={!name().trim()}
          testid="routine-group-save"
          onClick={() => props.onSave(name().trim(), color())}
        />
      </div>
    </Sheet>
  );
}

/** Add, retime, rename and remove routine windows. */
export function WindowsSheet(props: {
  windows: RoutineWindow[];
  onAdd: (name: string, time: string) => void;
  onUpdate: (id: string, patch: { name?: string; time?: string }) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}): JSX.Element {
  const ordered = createMemo(() => sortedWindows(props.windows));
  return (
    <Sheet onClose={props.onClose}>
      <SheetTitle>Routine windows</SheetTitle>
      <div style={{ padding: '0 20px 20px' }}>
        <p style={{ 'font-size': '12.5px', color: 'var(--text-secondary)', 'line-height': '1.5', margin: '0 2px 12px' }}>
          Each window stays open until the next one begins. Updates that land
          inside a window are what "new" means there.
        </p>
        <For each={ordered()}>
          {(w) => (
            <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', padding: '6px 0' }}>
              <SyncedInput
                value={w.name}
                onInput={(v) => props.onUpdate(w.id, { name: v })}
                placeholder="Name"
                style={{ ...fieldStyle, flex: '1' }}
              />
              <input
                type="time"
                value={w.time}
                onInput={(e) => props.onUpdate(w.id, { time: e.currentTarget.value })}
                aria-label={`${w.name} time`}
                style={{ ...fieldStyle, width: '120px' }}
              />
              <Show when={ordered().length > 1}>
                <button
                  class="pressable"
                  onClick={() => props.onDelete(w.id)}
                  aria-label={`Delete ${w.name}`}
                  style={{ display: 'flex', color: 'var(--red)', padding: '6px' }}
                >
                  <Icon name="trash" size={18} />
                </button>
              </Show>
            </div>
          )}
        </For>
        <button
          class="pressable"
          onClick={() => props.onAdd('Routine', '12:00')}
          data-testid="routine-add-window"
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '8px',
            'margin-top': '10px',
            padding: '11px 14px',
            'border-radius': 'var(--radius-row)',
            border: '1px dashed var(--separator)',
            color: 'var(--text)',
            'font-size': '15px',
            'font-weight': '500',
            width: '100%',
          }}
        >
          <Icon name="plus" size={18} />
          Add a window
        </button>
      </div>
    </Sheet>
  );
}

/** Streak, banked days and the 5-week grid. */
export function StatsSheet(props: {
  streak: Streak;
  grid: DayMark[];
  windowsCleared: number;
  onClose: () => void;
}): JSX.Element {
  const last7 = () => props.grid.slice(-7).filter((d) => d.banked).length;
  return (
    <Sheet onClose={props.onClose} dragAnywhere>
      <SheetTitle>Your routine stats</SheetTitle>
      <div style={{ padding: '0 20px 24px' }}>
        <div style={{ display: 'flex', gap: '10px', 'margin-bottom': '20px' }}>
          <StatTile value={`${props.streak.current}`} label="Day streak" accent="var(--red)" />
          <StatTile value={`${props.streak.best}`} label="Best streak" />
          <StatTile value={`${last7()}/7`} label="This week" accent="var(--green)" />
        </div>
        <StreakGrid days={props.grid} />
        <p style={{ 'font-size': '12.5px', color: 'var(--text-secondary)', 'margin-top': '16px', 'line-height': '1.55' }}>
          A square fills in on each day you clear a whole routine window. You
          have cleared {props.windowsCleared} in the last five weeks.
        </p>
      </div>
    </Sheet>
  );
}

/** Per-source long-press menu. */
export function SourceMenu(props: {
  source: RoutineSource;
  groups: RoutineGroup[];
  onEdit: () => void;
  onMove: (groupId: string | null) => void;
  onSnooze: (ms: number) => void;
  onDelete: () => void;
  onClose: () => void;
}): JSX.Element {
  const [moving, setMoving] = createSignal(false);
  return (
    <Sheet onClose={props.onClose} dragAnywhere>
      <SheetTitle>{props.source.name}</SheetTitle>
      <Show
        when={!moving()}
        fallback={
          <>
            <MenuRow icon={<Icon name="close" size={20} />} label="Other" onClick={() => props.onMove(null)} />
            <For each={props.groups}>
              {(g) => (
                <MenuRow
                  icon={<Icon name="tag" size={20} color={g.color || colorForGroupId(g.id)} />}
                  label={g.name}
                  onClick={() => props.onMove(g.id)}
                />
              )}
            </For>
          </>
        }
      >
        <MenuRow icon={<Icon name="pencil" size={20} />} label="Edit source" onClick={props.onEdit} />
        <MenuRow icon={<Icon name="arrow-move" size={20} />} label="Move to group…" onClick={() => setMoving(true)} />
        <MenuRow
          icon={<Icon name="snooze" size={20} />}
          label="Snooze for today"
          onClick={() => props.onSnooze(24 * 60 * 60 * 1000)}
        />
        <MenuRow
          icon={<Icon name="snooze" size={20} />}
          label="Snooze for a week"
          onClick={() => props.onSnooze(7 * 24 * 60 * 60 * 1000)}
        />
        <MenuRow icon={<Icon name="trash" size={20} />} label="Remove" danger onClick={props.onDelete} />
      </Show>
    </Sheet>
  );
}

/** In-app AI digest of what's new: busy, error and result in one place. */
export function DigestSheet(props: {
  busy: boolean;
  status: string;
  text: string;
  error: string;
  providerLabel: string;
  onClose: () => void;
}): JSX.Element {
  return (
    <Sheet onClose={props.onClose} dragAnywhere>
      <SheetTitle>What's new</SheetTitle>
      <div style={{ padding: '0 20px 24px', 'max-height': '60vh', 'overflow-y': 'auto' }}>
        <Show when={props.busy}>
          <p style={{ 'font-size': '14px', color: 'var(--text-secondary)' }}>
            {props.status || `Asking ${props.providerLabel}…`}
          </p>
        </Show>
        <Show when={props.error}>
          <p data-testid="routine-digest-error" style={{ 'font-size': '14px', color: 'var(--red)', 'line-height': '1.5' }}>
            {props.error}
          </p>
        </Show>
        <Show when={props.text}>
          <p
            data-testid="routine-digest-text"
            style={{ 'font-size': '15px', 'line-height': '1.6', color: 'var(--text)', 'white-space': 'pre-wrap' }}
          >
            {props.text}
          </p>
        </Show>
      </div>
    </Sheet>
  );
}

export { formatClock };
