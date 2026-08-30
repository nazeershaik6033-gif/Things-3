import { Show, For, createMemo, type JSX } from 'solid-js';
import type { FeedEntry, SourceKind } from '../db/models';
import { formatAge, withAlpha } from '../domain/myRoutine';
import { Icon, type IconName } from '../ui/Icon';

/** Pieces shared by the routine list and its History section, so a group and a
 *  catch-up day read as the same kind of object: one stack of accented blocks. */

/** The card every group and every history day sits inside. The accent stripe
 *  down the left is what tells them apart at a glance. */
export function RoutineBlock(props: {
  accent: string;
  dim?: boolean;
  dropTarget?: boolean;
  children: JSX.Element;
  testid?: string;
}): JSX.Element {
  return (
    <div
      data-testid={props.testid}
      style={{
        'border-radius': 'var(--radius-card)',
        background: 'var(--bg-card)',
        border: '1px solid var(--separator)',
        'border-left': `4px solid ${props.accent}`,
        margin: '0 16px 12px',
        padding: '10px 14px',
        'box-shadow': '0 1px 2px rgba(0, 0, 0, 0.04)',
        opacity: props.dim ? '0.4' : '1',
        transition: 'opacity 120ms',
        outline: props.dropTarget ? '2px solid var(--blue)' : 'none',
        'outline-offset': '2px',
      }}
    >
      {props.children}
    </div>
  );
}

const KIND_ICON: Record<SourceKind, IconName> = {
  youtube: 'play',
  telegram: 'send',
  rss: 'rss',
  link: 'link',
};

export function kindIcon(kind: SourceKind): IconName {
  return KIND_ICON[kind];
}

/** One update from a source: thumbnail, title, and how long ago. A routine is
 *  about recency, so the stamp is always relative. */
export function RoutineEntryCard(props: {
  entry: FeedEntry;
  kind: SourceKind;
  sourceName?: string;
  compact?: boolean;
  now: number;
  onOpen: () => void;
}): JSX.Element {
  return (
    <button
      class="pressable"
      onClick={props.onOpen}
      data-testid="routine-entry"
      style={{
        display: 'flex',
        gap: '10px',
        width: '100%',
        'text-align': 'left',
        padding: '6px 0',
        'align-items': props.compact ? 'center' : 'flex-start',
      }}
    >
      <Show
        when={props.entry.thumb}
        fallback={
          <span
            style={{
              width: props.compact ? '30px' : '38px',
              height: props.compact ? '30px' : '38px',
              'border-radius': '8px',
              background: 'var(--bg-inset)',
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              flex: 'none',
              color: 'var(--text-tertiary)',
            }}
          >
            <Icon name={kindIcon(props.kind)} size={15} />
          </span>
        }
      >
        <img
          src={props.entry.thumb}
          alt=""
          loading="lazy"
          style={{
            width: props.compact ? '44px' : '64px',
            height: props.compact ? '30px' : '40px',
            'border-radius': '8px',
            'object-fit': 'cover',
            flex: 'none',
            background: 'var(--bg-inset)',
          }}
        />
      </Show>
      <span style={{ 'min-width': '0', flex: '1' }}>
        <span
          style={{
            display: '-webkit-box',
            '-webkit-line-clamp': props.compact ? '2' : '3',
            '-webkit-box-orient': 'vertical',
            overflow: 'hidden',
            'font-size': props.compact ? '13px' : '14px',
            'line-height': '1.35',
            color: 'var(--text)',
          }}
        >
          {props.entry.title}
        </span>
        <span
          style={{
            display: 'block',
            'font-size': '11.5px',
            color: 'var(--text-tertiary)',
            'margin-top': '2px',
          }}
        >
          {formatAge(props.entry.publishedMs, props.now)}
        </span>
      </span>
    </button>
  );
}

/** Small pill for a count, tinted red when it represents unread updates. */
export function CountPill(props: { label: string; tone?: 'new' | 'muted' }): JSX.Element {
  const isNew = () => props.tone === 'new';
  return (
    <span
      style={{
        'font-size': isNew() ? '10px' : '11px',
        'font-weight': isNew() ? '700' : '500',
        color: isNew() ? '#fff' : 'var(--text-tertiary)',
        background: isNew() ? 'var(--red)' : 'transparent',
        'border-radius': '999px',
        padding: isNew() ? '2px 7px' : '0',
        flex: 'none',
      }}
    >
      {props.label}
    </span>
  );
}

/** The 5-week filled-square grid in the stats sheet. */
export function StreakGrid(props: {
  days: Array<{ date: string; banked: boolean }>;
  accent?: string;
}): JSX.Element {
  const accent = () => props.accent ?? 'var(--green)';
  const weeks = createMemo(() => {
    const out: Array<Array<{ date: string; banked: boolean }>> = [];
    for (let i = 0; i < props.days.length; i += 7) out.push(props.days.slice(i, i + 7));
    return out;
  });
  return (
    <div style={{ display: 'flex', gap: '5px', 'justify-content': 'center' }}>
      <For each={weeks()}>
        {(week) => (
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '5px' }}>
            <For each={week}>
              {(day) => (
                <span
                  title={day.date}
                  style={{
                    width: '15px',
                    height: '15px',
                    'border-radius': '4px',
                    background: day.banked ? accent() : 'var(--bg-inset)',
                    border: day.banked ? 'none' : '1px solid var(--separator)',
                  }}
                />
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}

/** Big number over a caption, used for the streak stats row. */
export function StatTile(props: { value: string; label: string; accent?: string }): JSX.Element {
  return (
    <div
      style={{
        flex: '1',
        'text-align': 'center',
        padding: '14px 4px',
        background: 'var(--bg-inset)',
        'border-radius': 'var(--radius-card)',
      }}
    >
      <div
        style={{
          'font-size': '24px',
          'font-weight': '700',
          'font-variant-numeric': 'tabular-nums',
          color: props.accent ?? 'var(--text)',
        }}
      >
        {props.value}
      </div>
      <div style={{ 'font-size': '12px', color: 'var(--text-secondary)', 'margin-top': '2px' }}>
        {props.label}
      </div>
    </div>
  );
}

/** Toolbar button above the window tabs. */
export function ToolbarButton(props: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  badge?: string;
  testid?: string;
  onClick: () => void;
  children: JSX.Element;
}): JSX.Element {
  return (
    <span style={{ position: 'relative', flex: 'none' }}>
      <button
        class="pressable"
        onClick={props.onClick}
        disabled={props.disabled}
        aria-label={props.label}
        aria-pressed={props.active}
        data-testid={props.testid}
        style={{
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          padding: '9px 12px',
          'border-radius': '10px',
          background: props.active ? 'var(--blue)' : 'transparent',
          color: props.active ? '#fff' : 'var(--text-secondary)',
          border: `1px solid ${props.active ? 'var(--blue)' : 'var(--separator)'}`,
          opacity: props.disabled ? '0.5' : '1',
        }}
      >
        {props.children}
      </button>
      <Show when={props.badge}>
        <span
          style={{
            position: 'absolute',
            top: '-4px',
            right: '-4px',
            'min-width': '16px',
            height: '16px',
            padding: '0 4px',
            'border-radius': '8px',
            background: 'var(--red)',
            color: '#fff',
            'font-size': '9.5px',
            'font-weight': '700',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'pointer-events': 'none',
          }}
        >
          {props.badge}
        </span>
      </Show>
    </span>
  );
}

/** Group-colored dot used beside a group name. */
export function GroupDot(props: { color: string }): JSX.Element {
  return (
    <span
      style={{
        width: '8px',
        height: '8px',
        'border-radius': '4px',
        flex: 'none',
        background: props.color,
        'box-shadow': `0 0 0 3px ${withAlpha(props.color, 0.16)}`,
      }}
    />
  );
}
