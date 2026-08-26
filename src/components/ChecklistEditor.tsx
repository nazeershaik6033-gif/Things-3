import { type JSX } from 'solid-js';
import { Key } from '@solid-primitives/keyed';
import { nanoid } from 'nanoid';
import type { ChecklistItem } from '../db/models';
import { SyncedInput } from '../ui/TextField';
import { haptic } from '../ui/haptics';

/** Inline checklist editor inside the expanded task card.
 *
 *  Keyed by item id, NOT by object identity: editing an item necessarily
 *  produces a new object ({...i, ...patch}), and a reference-keyed <For> would
 *  tear down and rebuild that row's <input> on every keystroke — which on iOS
 *  drops focus and dismisses the software keyboard mid-word. <Key> holds the
 *  DOM node steady, and SyncedInput ignores prop echoes while it has focus. */
export function ChecklistEditor(props: {
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
}): JSX.Element {
  const update = (id: string, patch: Partial<ChecklistItem>) => {
    props.onChange(props.items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };
  const remove = (id: string) => {
    props.onChange(props.items.filter((i) => i.id !== id));
  };
  const insertAfter = (id: string | null): string => {
    const item: ChecklistItem = { id: nanoid(), title: '', completed: false };
    const idx = id === null ? props.items.length : props.items.findIndex((i) => i.id === id) + 1;
    const next = [...props.items];
    next.splice(idx, 0, item);
    props.onChange(next);
    return item.id;
  };
  const focusItem = (id: string) => {
    queueMicrotask(() => {
      const el = document.querySelector<HTMLInputElement>(`input[data-checklist-id="${id}"]`);
      el?.focus();
    });
  };

  return (
    <div style={{ padding: '2px 0' }}>
      <Key each={props.items} by={(item) => item.id}>
        {(item) => (
          <div
            class="rise-in"
            style={{ display: 'flex', 'align-items': 'center', gap: '10px', padding: '3px 0' }}
          >
            <button
              class="press-scale"
              // pointerdown + preventDefault keeps focus in whatever field the
              // user is typing in, so ticking an item never closes the keyboard
              onPointerDown={(e) => {
                e.preventDefault();
                haptic('selection');
                update(item().id, { completed: !item().completed });
              }}
              aria-label={item().completed ? 'Uncheck' : 'Check'}
              style={{
                width: '17px',
                height: '17px',
                'border-radius': '50%',
                border: item().completed ? 'none' : '1.5px solid var(--check-border)',
                background: item().completed ? 'var(--blue)' : 'transparent',
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                flex: 'none',
                transition: 'background 140ms ease-out, border-color 140ms ease-out',
              }}
            >
              {item().completed && (
                <svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M2 6.5l2.5 2.5L10 3" />
                </svg>
              )}
            </button>
            <SyncedInput
              attrs={{ 'data-checklist-id': item().id }}
              value={item().title}
              placeholder="Checklist item"
              onInput={(v) => update(item().id, { title: v })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  focusItem(insertAfter(item().id));
                } else if (e.key === 'Backspace' && item().title === '') {
                  e.preventDefault();
                  const idx = props.items.findIndex((i) => i.id === item().id);
                  remove(item().id);
                  const prev = props.items[idx - 1];
                  if (prev) focusItem(prev.id);
                }
              }}
              style={{
                flex: '1',
                'font-size': '15px',
                color: item().completed ? 'var(--text-secondary)' : 'var(--text)',
                'text-decoration': item().completed ? 'line-through' : 'none',
                padding: '2px 0',
              }}
            />
          </div>
        )}
      </Key>
      <button
        class="press-scale"
        // pointerdown (not click): fires before a focused textarea blurs and
        // reflows the card, so the tap can't get lost mid-layout
        onPointerDown={(e) => {
          e.preventDefault();
          focusItem(insertAfter(null));
        }}
        style={{ color: 'var(--text-secondary)', 'font-size': '14px', padding: '4px 0 2px 27px' }}
      >
        + Add item
      </button>
    </div>
  );
}
