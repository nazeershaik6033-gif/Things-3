import { createSignal, Show, type JSX } from 'solid-js';
import { back } from '../app/navigation';
import { Icon } from '../ui/Icon';
import { setSearchOpen } from '../app/uiState';
import { db } from '../db/db';
import { createReactiveLiveQuery } from '../db/liveQuery';
import { WhenPicker } from '../components/Pickers';

/** Header + large title chrome shared by all pushed screens. */
export function ScreenChrome(props: {
  title: string;
  icon?: JSX.Element;
  children: JSX.Element;
  trailing?: JSX.Element;
  /** Ref to the scrollable content (gestures need it). */
  scrollRef?: (el: HTMLDivElement) => void;
  titleColor?: string;
  subtitle?: string;
  /** Replaces the h1 (e.g. an editable title input). */
  titleEl?: JSX.Element;
}): JSX.Element {
  return (
    <>
      <header
        style={{
          display: 'flex',
          'align-items': 'center',
          padding: `calc(var(--safe-top) + 6px) 6px 6px`,
          'min-height': '44px',
          background: 'var(--bg-list)',
          'z-index': '5',
        }}
      >
        <button
          onClick={back}
          aria-label="Back"
          data-testid="back-button"
          style={{ display: 'flex', 'align-items': 'center', color: 'var(--blue)', padding: '8px 10px', 'font-size': '17px' }}
        >
          <Icon name="chevron-left" size={20} />
        </button>
        <div style={{ flex: '1' }} />
        <button
          onClick={() => setSearchOpen(true)}
          aria-label="Search"
          style={{ color: 'var(--text-secondary)', padding: '8px 10px', display: 'flex' }}
        >
          <Icon name="search" size={19} />
        </button>
        {props.trailing}
      </header>
      <div class="screen-scroll" ref={props.scrollRef}>
        <div
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '10px',
            padding: '2px 16px 10px',
          }}
        >
          {props.icon}
          <div style={{ 'min-width': '0', flex: '1' }}>
            <Show
              when={props.titleEl}
              fallback={
                <h1
                  style={{
                    'font-size': 'var(--fs-title)',
                    'font-weight': '700',
                    color: props.titleColor ?? 'var(--text)',
                    overflow: 'hidden',
                    'text-overflow': 'ellipsis',
                    'white-space': 'nowrap',
                  }}
                >
                  {props.title}
                </h1>
              }
            >
              {props.titleEl}
            </Show>
            <Show when={props.subtitle}>
              <div style={{ color: 'var(--text-secondary)', 'font-size': '14px' }}>{props.subtitle}</div>
            </Show>
          </div>
        </div>
        {props.children}
      </div>
    </>
  );
}

/** Blue section heading used inside projects + group labels in Anytime etc. */
export function SectionHeading(props: {
  label: string;
  color?: string;
  trailing?: JSX.Element;
  small?: boolean;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        'align-items': 'center',
        padding: props.small ? '14px 16px 4px' : '18px 16px 4px',
        'border-bottom': '1px solid var(--separator)',
        margin: '0 0 4px',
      }}
    >
      <span
        style={{
          flex: '1',
          color: props.color ?? 'var(--blue)',
          'font-weight': '600',
          'font-size': props.small ? '14px' : '16px',
        }}
      >
        {props.label}
      </span>
      {props.trailing}
    </div>
  );
}

export function EmptyState(props: { icon: JSX.Element; text: string }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'center',
        gap: '12px',
        padding: '80px 32px',
        color: 'var(--text-tertiary)',
        'text-align': 'center',
      }}
    >
      {props.icon}
      <span style={{ 'font-size': '15px' }}>{props.text}</span>
    </div>
  );
}

/** Hosts the WhenPicker for "swipe left → schedule" on any screen. */
export function createScheduler(): {
  schedule: (taskId: string) => void;
  SchedulerHost: () => JSX.Element;
} {
  const [taskId, setTaskId] = createSignal<string | null>(null);
  const task = createReactiveLiveQuery(
    taskId,
    async (id) => (id ? ((await db.tasks.get(id)) ?? null) : null),
    null,
  );
  const SchedulerHost = (): JSX.Element => (
    <Show when={taskId() && task() && task()!.id === taskId()}>
      <WhenPicker task={task()!} onClose={() => setTaskId(null)} />
    </Show>
  );
  return { schedule: setTaskId, SchedulerHost };
}

/** Simple action menu sheet rows (ellipsis menus). */
export function MenuRow(props: {
  icon: JSX.Element;
  label: string;
  danger?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      onClick={props.onClick}
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '12px',
        width: '100%',
        padding: '12px 20px',
        'font-size': '16px',
        color: props.danger ? 'var(--red)' : 'var(--text)',
        'text-align': 'left',
      }}
    >
      {props.icon}
      {props.label}
    </button>
  );
}
