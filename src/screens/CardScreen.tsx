import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery, createReactiveLiveQuery } from '../db/liveQuery';
import { back } from '../app/navigation';
import { haptic, staggerDelay } from '../app/motion';
import { currentDate } from '../app/currentDate';
import { formatRelative, formatTime } from '../domain/dates';
import { sortByOrderKey } from '../db/ordering';
import {
  updateCard, deleteCard, archiveCard, moveCard, toggleCardLabel,
  setCardChecklist, addComment, deleteComment, listCards, keyAtIndex, LABEL_COLORS,
} from '../db/boardMutations';
import { requestReminderPermission } from '../app/reminders';
import { Icon } from '../ui/Icon';
import { Sheet, SheetTitle } from '../ui/Sheet';
import { MonthGrid, PickerRow } from '../components/Pickers';
import { ChecklistEditor } from '../components/ChecklistEditor';
import { ScreenChrome, MenuRow } from './common';
import type { DateStr } from '../db/models';

/** Cover options: null (none) + the shared label palette. */
const COVER_COLORS = [null, ...LABEL_COLORS] as const;

export function CardScreen(props: { id: string }): JSX.Element {
  const card = createLiveQuery(async () => (await db.cards.get(props.id)) ?? null, null);
  const boardId = () => card()?.boardId ?? null;
  const board = createReactiveLiveQuery(boardId, async (id) => (id ? ((await db.boards.get(id)) ?? null) : null), null);
  const lists = createReactiveLiveQuery(
    boardId,
    async (id) => (id ? db.boardLists.where('boardId').equals(id).toArray() : []),
    [],
  );
  const labels = createReactiveLiveQuery(
    boardId,
    async (id) => (id ? db.boardLabels.where('boardId').equals(id).toArray() : []),
    [],
  );

  const [dueOpen, setDueOpen] = createSignal(false);
  const [moveOpen, setMoveOpen] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [coverOpen, setCoverOpen] = createSignal(false);
  const [comment, setComment] = createSignal('');

  const sortedLists = createMemo(() => sortByOrderKey(lists().filter((l) => !l.archived)));
  const listName = createMemo(() => sortedLists().find((l) => l.id === card()?.listId)?.title || 'List');
  const comments = createMemo(() => [...(card()?.comments ?? [])].reverse());

  const setDue = (d: DateStr | null) => {
    void updateCard(props.id, { due: d });
    setDueOpen(false);
  };
  const moveTo = async (listId: string) => {
    const target = (await listCards(listId)).filter((c) => c.id !== props.id);
    await moveCard(props.id, listId, keyAtIndex(target, target.length));
    setMoveOpen(false);
  };
  const postComment = () => {
    void addComment(props.id, comment());
    setComment('');
  };

  return (
    <Show when={card()}>
      <ScreenChrome
        title={card()!.title || 'Card'}
        icon={<span style={{ width: '18px', height: '18px', 'border-radius': '5px', background: board()?.color ?? 'var(--blue)', flex: 'none' }} />}
        titleEl={
          <input
            value={card()!.title}
            placeholder="Card title"
            data-testid="card-title"
            onInput={(e) => void updateCard(props.id, { title: e.currentTarget.value })}
            style={{ width: '100%', 'font-size': 'var(--fs-title)', 'font-weight': '700' }}
          />
        }
        subtitle={`in ${listName()}`}
        trailing={
          <button aria-label="Card menu" data-testid="card-menu" class="pressable" onClick={() => setMenuOpen(true)} style={{ color: 'var(--text-secondary)', padding: '8px 10px', display: 'flex' }}>
            <Icon name="ellipsis" size={20} />
          </button>
        }
      >
        <Show when={card()!.cover}>
          <div
            class="rise"
            data-testid="card-cover"
            style={{ height: '52px', background: card()!.cover!, margin: '0 16px 12px', 'border-radius': '12px' }}
          />
        </Show>

        {/* Quick actions */}
        <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap', padding: '0 16px 12px' }}>
          <ActionChip icon="clock" label={card()!.due ? formatRelative(card()!.due!, currentDate()) : 'Due date'} active={!!card()!.due} onClick={() => { void requestReminderPermission(); setDueOpen(true); }} testid="card-due" />
          <ActionChip icon="board" label="Cover" active={!!card()!.cover} onClick={() => setCoverOpen(true)} />
          <ActionChip icon="check" label={card()!.completed ? 'Completed' : 'Mark done'} active={card()!.completed} onClick={() => void updateCard(props.id, { completed: !card()!.completed })} testid="card-complete" />
        </div>

        {/* Labels */}
        <Show when={labels().length > 0}>
          <Section title="Labels" index={1}>
            <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
              <For each={labels()}>
                {(label) => {
                  const on = () => card()!.labelIds.includes(label.id);
                  return (
                    <button
                      class="pressable"
                      onClick={() => {
                        haptic('tick');
                        void toggleCardLabel(props.id, label.id);
                      }}
                      style={{
                        padding: '6px 12px',
                        'border-radius': '7px',
                        background: label.color,
                        color: '#fff',
                        'font-size': '13px',
                        'font-weight': '600',
                        opacity: on() ? '1' : '0.4',
                        'box-shadow': on() ? '0 1px 4px rgba(0,0,0,0.2)' : 'none',
                      }}
                    >
                      {label.title || '—'}
                    </button>
                  );
                }}
              </For>
            </div>
          </Section>
        </Show>

        {/* Description */}
        <Section title="Description" index={2}>
          <textarea
            value={card()!.description}
            placeholder="Add a more detailed description…"
            data-testid="card-description"
            rows={2}
            onInput={(e) => {
              e.currentTarget.style.height = 'auto';
              e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
              void updateCard(props.id, { description: e.currentTarget.value });
            }}
            style={{ width: '100%', 'font-size': '15px', color: 'var(--text)', overflow: 'hidden', 'min-height': '44px' }}
          />
        </Section>

        {/* Checklist */}
        <Section title="Checklist" index={3}>
          <ChecklistEditor items={card()!.checklist} onChange={(items) => void setCardChecklist(props.id, items)} />
        </Section>

        {/* Comments */}
        <Section title="Activity" index={4}>
          <div style={{ display: 'flex', gap: '8px', 'margin-bottom': '10px' }}>
            <input
              value={comment()}
              onInput={(e) => setComment(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && postComment()}
              placeholder="Write a comment…"
              data-testid="comment-input"
              style={{ flex: '1', padding: '9px 12px', 'border-radius': '9px', background: 'var(--bg-inset)' }}
            />
            <button onClick={postComment} style={{ color: 'var(--blue)', 'font-weight': '600', padding: '8px 6px' }}>Post</button>
          </div>
          <For each={comments()}>
            {(c) => (
              <div style={{ display: 'flex', 'align-items': 'flex-start', gap: '8px', padding: '6px 0', 'border-top': '1px solid var(--separator)' }}>
                <div style={{ flex: '1' }}>
                  <div style={{ 'font-size': '15px', 'white-space': 'pre-wrap', 'word-break': 'break-word' }}>{c.text}</div>
                  <div style={{ 'font-size': '12px', color: 'var(--text-tertiary)', 'margin-top': '2px' }}>{formatTime(c.createdAt)}</div>
                </div>
                <button aria-label="Delete comment" onClick={() => void deleteComment(props.id, c.id)} style={{ color: 'var(--text-tertiary)', padding: '4px', display: 'flex' }}>
                  <Icon name="close" size={15} />
                </button>
              </div>
            )}
          </For>
        </Section>
      </ScreenChrome>

      {/* Due date sheet */}
      <Show when={dueOpen()}>
        <Sheet onClose={() => setDueOpen(false)} dragAnywhere>
          <SheetTitle>Due Date</SheetTitle>
          <MonthGrid selected={card()!.due} onSelect={setDue} />
          <div style={{ display: 'flex', 'align-items': 'center', gap: '10px', padding: '4px 20px 8px' }}>
            <Icon name="clock" size={18} color="var(--text-secondary)" />
            <input
              type="time"
              value={card()!.dueTime ?? ''}
              onInput={(e) => void updateCard(props.id, { dueTime: e.currentTarget.value || null })}
              style={{ flex: '1', 'font-size': '16px' }}
            />
          </div>
          <Show when={card()!.due}>
            <PickerRow icon={<Icon name="close" size={18} color="var(--text-secondary)" />} label="Remove Due Date" dim onClick={() => setDue(null)} />
          </Show>
          <div style={{ height: '8px' }} />
        </Sheet>
      </Show>

      {/* Cover sheet */}
      <Show when={coverOpen()}>
        <Sheet onClose={() => setCoverOpen(false)} dragAnywhere>
          <SheetTitle>Cover</SheetTitle>
          <div style={{ display: 'flex', gap: '10px', 'flex-wrap': 'wrap', padding: '4px 20px 16px' }}>
            <For each={COVER_COLORS}>
              {(c) => (
                <button
                  aria-label={c ? 'Cover color' : 'No cover'}
                  onClick={() => { void updateCard(props.id, { cover: c }); setCoverOpen(false); }}
                  style={{
                    width: '42px', height: '30px', 'border-radius': '7px',
                    background: c ?? 'var(--bg-inset)',
                    display: 'flex', 'align-items': 'center', 'justify-content': 'center',
                    border: card()!.cover === c ? '3px solid var(--text)' : '3px solid transparent',
                  }}
                >
                  {!c && <Icon name="close" size={16} color="var(--text-secondary)" />}
                </button>
              )}
            </For>
          </div>
        </Sheet>
      </Show>

      {/* Move sheet */}
      <Show when={moveOpen()}>
        <Sheet onClose={() => setMoveOpen(false)} dragAnywhere>
          <SheetTitle>Move to List</SheetTitle>
          <div style={{ 'max-height': '55dvh', 'overflow-y': 'auto' }}>
            <For each={sortedLists()}>
              {(l) => (
                <PickerRow
                  icon={<Icon name="board" size={20} color="var(--text-secondary)" />}
                  label={l.title || 'List'}
                  selected={l.id === card()!.listId}
                  onClick={() => void moveTo(l.id)}
                />
              )}
            </For>
          </div>
          <div style={{ height: '8px' }} />
        </Sheet>
      </Show>

      {/* Card menu */}
      <Show when={menuOpen()}>
        <Sheet onClose={() => setMenuOpen(false)} dragAnywhere>
          <SheetTitle>{card()!.title || 'Card'}</SheetTitle>
          <MenuRow icon={<Icon name="arrow-move" size={20} color="var(--blue)" />} label="Move to List" onClick={() => { setMenuOpen(false); setMoveOpen(true); }} />
          <MenuRow icon={<Icon name="archive" size={20} color="var(--text-secondary)" />} label="Archive Card" onClick={() => { void archiveCard(props.id); setMenuOpen(false); back(); }} />
          <MenuRow icon={<Icon name="trash" size={20} />} danger label="Delete Card" onClick={() => { void deleteCard(props.id); setMenuOpen(false); back(); }} />
          <div style={{ height: '10px' }} />
        </Sheet>
      </Show>
    </Show>
  );
}

function Section(props: { title: string; children: JSX.Element; index?: number }): JSX.Element {
  return (
    <div class="rise" style={{ padding: '10px 16px', 'animation-delay': staggerDelay(props.index ?? 0) }}>
      <div style={{ 'font-size': '13px', 'font-weight': '600', color: 'var(--text-secondary)', 'text-transform': 'uppercase', 'letter-spacing': '0.03em', 'margin-bottom': '6px' }}>
        {props.title}
      </div>
      {props.children}
    </div>
  );
}

function ActionChip(props: { icon: 'clock' | 'board' | 'check'; label: string; active?: boolean; onClick: () => void; testid?: string }): JSX.Element {
  return (
    <button
      data-testid={props.testid}
      class="pressable"
      onClick={() => {
        haptic('tick');
        props.onClick();
      }}
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '6px',
        padding: '7px 12px',
        'border-radius': '9px',
        background: props.active ? 'var(--blue)' : 'var(--bg-inset)',
        color: props.active ? '#fff' : 'var(--text)',
        'font-size': '14px',
        'font-weight': '500',
      }}
    >
      <Icon name={props.icon} size={15} />
      {props.label}
    </button>
  );
}
