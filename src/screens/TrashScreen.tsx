import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { trashItems } from '../domain/smartLists';
import { emptyTrash, restoreProject, restoreTask } from '../db/mutations';
import { ListIcon, Icon } from '../ui/Icon';
import { ScreenChrome, EmptyState } from './common';
import { Sheet, SheetTitle, } from '../ui/Sheet';
import { MenuRow } from './common';

export function TrashScreen(): JSX.Element {
  const tasks = createLiveQuery(() => db.tasks.toArray(), []);
  const projects = createLiveQuery(() => db.projects.toArray(), []);
  const [confirmOpen, setConfirmOpen] = createSignal(false);

  const items = createMemo(() => trashItems(tasks(), projects()));
  const isProject = (item: { id: string }) => projects().some((p) => p.id === item.id);

  return (
    <>
      <ScreenChrome
        title="Trash"
        icon={<ListIcon list="trash" size={30} />}
        trailing={
          <Show when={items().length > 0}>
            <button
              data-testid="empty-trash"
              onClick={() => setConfirmOpen(true)}
              style={{ color: 'var(--red)', padding: '8px 10px', 'font-size': '15px', 'font-weight': '500' }}
            >
              Empty
            </button>
          </Show>
        }
      >
        <Show
          when={items().length > 0}
          fallback={<EmptyState icon={<ListIcon list="trash" size={44} />} text="The Trash is empty." />}
        >
          <For each={items()}>
            {(item) => (
              <div style={{ display: 'flex', 'align-items': 'center', gap: '12px', padding: '10px 16px' }}>
                <Icon
                  name={isProject(item) ? 'pie' : 'trash'}
                  size={18}
                  color="var(--text-tertiary)"
                />
                <span style={{ flex: '1', color: 'var(--text-secondary)', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>
                  {item.title || '—'}
                </span>
                <button
                  aria-label="Restore"
                  onClick={() => {
                    if (isProject(item)) void restoreProject(item.id);
                    else void restoreTask(item.id);
                  }}
                  style={{ color: 'var(--blue)', display: 'flex', padding: '6px' }}
                >
                  <Icon name="restore" size={18} />
                </button>
              </div>
            )}
          </For>
        </Show>
      </ScreenChrome>

      <Show when={confirmOpen()}>
        <Sheet onClose={() => setConfirmOpen(false)} dragAnywhere>
          <SheetTitle>Permanently delete everything in the Trash?</SheetTitle>
          <MenuRow
            icon={<Icon name="trash" size={20} />}
            danger
            label="Empty Trash"
            onClick={() => {
              void emptyTrash();
              setConfirmOpen(false);
            }}
          />
          <MenuRow icon={<Icon name="close" size={20} />} label="Cancel" onClick={() => setConfirmOpen(false)} />
          <div style={{ height: '10px' }} />
        </Sheet>
      </Show>
    </>
  );
}
