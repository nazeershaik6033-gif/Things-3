import { createSignal, For, Show, type JSX } from 'solid-js';
import { Icon } from '../ui/Icon';
import { Sheet, SheetTitle } from '../ui/Sheet';
import { haptic } from '../app/motion';
import { homeLayout, resetHomeLayout, saveHomeLayout } from '../app/homeLayout';
import {
  addCategory, CATEGORY_ICONS, categoryOf, hideItem, ITEM_LABEL, MAX_CATEGORIES, MAX_TITLE, moveItem,
  removeCategory, renameCategory, setCategoryIcon, shiftCategory, shiftItem, showItem,
  type HomeItemId,
} from '../domain/homeLayout';

const rowStyle: JSX.CSSProperties = {
  display: 'flex',
  'align-items': 'center',
  gap: '10px',
  width: '100%',
  padding: '10px 14px',
  'font-size': 'calc(16px * var(--ts))',
  color: 'var(--text)',
  'text-align': 'left',
  'border-bottom': '1px solid var(--separator)',
};

const cardStyle: JSX.CSSProperties = {
  margin: '0 10px 12px',
  background: 'var(--bg-list)',
  'border-radius': '16px',
  border: '1px solid var(--separator)',
  overflow: 'hidden',
};

function Heading(props: { children: JSX.Element }): JSX.Element {
  return (
    <div style={{
      padding: '8px 22px 6px', 'font-size': 'calc(12px * var(--ts))', 'font-weight': 'var(--fw-700)', 'letter-spacing': '0.05em',
      'text-transform': 'uppercase', color: 'var(--text-tertiary)',
    }}>
      {props.children}
    </div>
  );
}

function SmallButton(props: {
  label: string;
  icon: Parameters<typeof Icon>[0]['name'];
  onClick: () => void;
  disabled?: boolean;
  testid?: string;
  color?: string;
  rotate?: number;
}): JSX.Element {
  return (
    <button
      aria-label={props.label}
      title={props.label}
      data-testid={props.testid}
      disabled={props.disabled}
      class="pressable"
      onClick={() => {
        haptic('tick');
        props.onClick();
      }}
      style={{
        width: '34px', height: '34px', 'border-radius': '10px', display: 'grid', 'place-items': 'center',
        background: 'var(--bg-inset)', color: props.color ?? 'var(--text-secondary)',
        opacity: props.disabled ? '0.35' : '1', flex: 'none',
      }}
    >
      <Icon name={props.icon} size={17} style={props.rotate ? { transform: `rotate(${props.rotate}deg)` } : undefined} />
    </button>
  );
}

/** "Move “X” to…" — opened by long-pressing a Home row or by Move in Edit.
 *  Lists the categories (current one ticked), a way to make a new category
 *  on the spot, and Hide. */
export function MoveSheet(props: {
  item: HomeItemId;
  onClose: () => void;
  onMoved?: (categoryId: string | null) => void;
}): JSX.Element {
  const [naming, setNaming] = createSignal(false);
  const [name, setName] = createSignal('');
  const current = () => categoryOf(homeLayout(), props.item)?.id ?? null;
  const full = () => homeLayout().categories.length >= MAX_CATEGORIES;

  const moveTo = (id: string) => {
    haptic('select');
    saveHomeLayout(moveItem(homeLayout(), props.item, id));
    props.onMoved?.(id);
    props.onClose();
  };

  const createAndMove = () => {
    const { layout, id } = addCategory(homeLayout(), name());
    if (!id) return;
    saveHomeLayout(moveItem(layout, props.item, id));
    haptic('success');
    props.onMoved?.(id);
    props.onClose();
  };

  return (
    <Sheet onClose={props.onClose}>
      <SheetTitle>Move “{ITEM_LABEL[props.item]}” to…</SheetTitle>
      <div data-testid="move-sheet" style={{ 'padding-bottom': '10px' }}>
        <For each={homeLayout().categories}>
          {(c) => (
            <button
              data-testid={`move-to-${c.id}`}
              class="pressable"
              style={rowStyle}
              onClick={() => moveTo(c.id)}
            >
              <span style={{ display: 'grid', 'place-items': 'center', width: '30px', height: '30px', 'border-radius': '9px', background: 'var(--bg-inset)' }}>
                <Icon name={c.icon} size={17} color="var(--blue)" />
              </span>
              <span style={{ flex: '1' }}>{c.title}</span>
              <Show when={current() === c.id}>
                <Icon name="check" size={18} color="var(--blue)" />
              </Show>
            </button>
          )}
        </For>
        <Show
          when={naming()}
          fallback={
            <Show when={!full()}>
              <button data-testid="move-new-category" class="pressable" style={{ ...rowStyle, color: 'var(--blue)' }} onClick={() => setNaming(true)}>
                <span style={{ display: 'grid', 'place-items': 'center', width: '30px', height: '30px', 'border-radius': '9px', background: 'var(--bg-inset)' }}>
                  <Icon name="plus" size={17} />
                </span>
                New category…
              </button>
            </Show>
          }
        >
          <form
            style={{ ...rowStyle, gap: '8px' }}
            onSubmit={(e) => {
              e.preventDefault();
              createAndMove();
            }}
          >
            <input
              data-testid="move-new-category-name"
              ref={(el) => queueMicrotask(() => el.focus())}
              value={name()}
              maxLength={MAX_TITLE}
              placeholder="Category name"
              onInput={(e) => setName(e.currentTarget.value)}
              style={{ flex: '1', 'font-size': 'calc(16px * var(--ts))', padding: '6px 0', background: 'transparent', color: 'var(--text)' }}
            />
            <button
              type="submit"
              data-testid="move-new-category-create"
              disabled={!name().trim()}
              style={{ color: 'var(--blue)', 'font-weight': 'var(--fw-600)', opacity: name().trim() ? '1' : '0.4' }}
            >
              Create
            </button>
          </form>
        </Show>
        <Show when={current() !== null}>
          <button
            data-testid="move-hide"
            class="pressable"
            style={{ ...rowStyle, color: 'var(--text-secondary)', 'border-bottom': 'none' }}
            onClick={() => {
              saveHomeLayout(hideItem(homeLayout(), props.item));
              props.onMoved?.(null);
              props.onClose();
            }}
          >
            <span style={{ display: 'grid', 'place-items': 'center', width: '30px', height: '30px', 'border-radius': '9px', background: 'var(--bg-inset)' }}>
              <Icon name="close" size={16} />
            </span>
            Hide from Home
          </button>
        </Show>
      </div>
    </Sheet>
  );
}

/** Edit mode for one Home tab: rename it and pick its icon, reorder, move or
 *  hide its items, bring hidden items back, and add, move or remove tabs. */
export function HomeEditor(props: {
  categoryId: string;
  onSelectTab: (id: string) => void;
  onDone: () => void;
}): JSX.Element {
  const [moving, setMoving] = createSignal<HomeItemId | null>(null);
  const [newTabName, setNewTabName] = createSignal('');
  const layout = homeLayout;
  const category = () => layout().categories.find((c) => c.id === props.categoryId) ?? layout().categories[0]!;
  const index = () => layout().categories.findIndex((c) => c.id === category().id);
  const canAdd = () => layout().categories.length < MAX_CATEGORIES;

  const addTab = () => {
    const { layout: next, id } = addCategory(layout(), newTabName());
    if (!id) return;
    saveHomeLayout(next);
    setNewTabName('');
    haptic('success');
    props.onSelectTab(id);
  };

  return (
    <div data-testid="home-editor">
      <Heading>Tab</Heading>
      <div style={{ ...cardStyle, padding: '4px 14px 12px' }}>
        <input
          data-testid="category-title-input"
          aria-label="Tab name"
          value={category().title}
          maxLength={MAX_TITLE}
          onChange={(e) => saveHomeLayout(renameCategory(layout(), category().id, e.currentTarget.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          style={{
            width: '100%', padding: '10px 0', 'font-size': 'calc(18px * var(--ts))', 'font-weight': 'var(--fw-600)', background: 'transparent',
            color: 'var(--text)', 'border-bottom': '1px solid var(--separator)',
          }}
        />
        <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '6px', 'padding-top': '10px' }}>
          <For each={CATEGORY_ICONS}>
            {(icon) => (
              <button
                aria-label={`Icon ${icon}`}
                aria-pressed={category().icon === icon}
                class="pressable"
                onClick={() => saveHomeLayout(setCategoryIcon(layout(), category().id, icon))}
                style={{
                  width: '38px', height: '38px', 'border-radius': '11px', display: 'grid', 'place-items': 'center',
                  background: category().icon === icon ? 'var(--blue)' : 'var(--bg-inset)',
                  color: category().icon === icon ? '#fff' : 'var(--text-secondary)',
                }}
              >
                <Icon name={icon} size={19} />
              </button>
            )}
          </For>
        </div>
      </div>

      <Heading>In this tab</Heading>
      <div style={cardStyle}>
        <Show
          when={category().items.length > 0}
          fallback={<div style={{ padding: '14px', color: 'var(--text-secondary)', 'font-size': 'calc(14px * var(--ts))' }}>Empty. Bring items here with Move on another tab, or from Hidden below.</div>}
        >
          <For each={category().items}>
            {(item, i) => (
              <div data-testid={`edit-item-${item}`} style={{ ...rowStyle, padding: '8px 10px 8px 14px' }}>
                <span style={{ flex: '1', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>{ITEM_LABEL[item]}</span>
                <SmallButton label="Move up" icon="chevron-down" rotate={180} disabled={i() === 0} testid={`edit-up-${item}`}
                  onClick={() => saveHomeLayout(shiftItem(layout(), item, -1))} />
                <SmallButton label="Move down" icon="chevron-down" disabled={i() === category().items.length - 1} testid={`edit-down-${item}`}
                  onClick={() => saveHomeLayout(shiftItem(layout(), item, 1))} />
                <SmallButton label="Move to another tab" icon="arrow-move" color="var(--blue)" testid={`edit-move-${item}`}
                  onClick={() => setMoving(item)} />
                <SmallButton label="Hide" icon="close" testid={`edit-hide-${item}`}
                  onClick={() => saveHomeLayout(hideItem(layout(), item))} />
              </div>
            )}
          </For>
        </Show>
      </div>

      <Show when={layout().hidden.length > 0}>
        <Heading>Hidden</Heading>
        <div style={cardStyle}>
          <For each={layout().hidden}>
            {(item) => (
              <div style={{ ...rowStyle, color: 'var(--text-secondary)' }}>
                <span style={{ flex: '1' }}>{ITEM_LABEL[item]}</span>
                <button
                  data-testid={`edit-show-${item}`}
                  class="pressable"
                  onClick={() => saveHomeLayout(showItem(layout(), item, category().id))}
                  style={{ color: 'var(--blue)', 'font-weight': 'var(--fw-600)', 'font-size': 'calc(15px * var(--ts))' }}
                >
                  Show here
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Heading>Tabs</Heading>
      <div style={cardStyle}>
        <div style={{ ...rowStyle, gap: '8px' }}>
          <span style={{ flex: '1' }}>Position in the bar</span>
          <SmallButton label="Move tab left" icon="chevron-left" disabled={index() === 0} testid="tab-left"
            onClick={() => saveHomeLayout(shiftCategory(layout(), category().id, -1))} />
          <SmallButton label="Move tab right" icon="chevron-right" disabled={index() === layout().categories.length - 1} testid="tab-right"
            onClick={() => saveHomeLayout(shiftCategory(layout(), category().id, 1))} />
        </div>
        <Show
          when={canAdd()}
          fallback={<div style={{ ...rowStyle, color: 'var(--text-secondary)', 'font-size': 'calc(14px * var(--ts))' }}>The bar holds {MAX_CATEGORIES} tabs. Remove one to add another.</div>}
        >
          <form
            style={{ ...rowStyle, gap: '8px' }}
            onSubmit={(e) => {
              e.preventDefault();
              addTab();
            }}
          >
            <Icon name="plus" size={18} color="var(--blue)" />
            <input
              data-testid="new-tab-name"
              value={newTabName()}
              maxLength={MAX_TITLE}
              placeholder="New tab"
              onInput={(e) => setNewTabName(e.currentTarget.value)}
              style={{ flex: '1', 'font-size': 'calc(16px * var(--ts))', padding: '2px 0', background: 'transparent', color: 'var(--text)' }}
            />
            <button type="submit" data-testid="new-tab-create" disabled={!newTabName().trim()}
              style={{ color: 'var(--blue)', 'font-weight': 'var(--fw-600)', opacity: newTabName().trim() ? '1' : '0.4' }}>
              Add
            </button>
          </form>
        </Show>
        <Show when={layout().categories.length > 1}>
          <button
            data-testid="tab-delete"
            class="pressable"
            style={{ ...rowStyle, color: 'var(--red)' }}
            onClick={() => {
              const first = layout().categories.find((c) => c.id !== category().id)!;
              const msg = category().items.length
                ? `Remove the “${category().title}” tab? Its items move to “${first.title}”.`
                : `Remove the “${category().title}” tab?`;
              if (!window.confirm(msg)) return;
              const next = removeCategory(layout(), category().id);
              saveHomeLayout(next);
              props.onSelectTab(next.categories[0]!.id);
            }}
          >
            <Icon name="trash" size={18} />
            Remove this tab
          </button>
        </Show>
        <button
          data-testid="home-reset"
          class="pressable"
          style={{ ...rowStyle, color: 'var(--text-secondary)', 'border-bottom': 'none' }}
          onClick={() => {
            if (!window.confirm('Put every item back in its original tab and show hidden items?')) return;
            resetHomeLayout();
            props.onSelectTab(homeLayout().categories[0]!.id);
          }}
        >
          <Icon name="restore" size={18} />
          Reset Home to default
        </button>
      </div>

      <div style={{ display: 'flex', 'justify-content': 'center', padding: '4px 0 12px' }}>
        <button
          data-testid="home-edit-done"
          class="pressable"
          onClick={props.onDone}
          style={{ padding: '10px 28px', 'border-radius': '999px', background: 'var(--blue)', color: '#fff', 'font-weight': 'var(--fw-600)', 'font-size': 'calc(16px * var(--ts))' }}
        >
          Done
        </button>
      </div>

      <Show when={moving()}>
        {(item) => <MoveSheet item={item()} onClose={() => setMoving(null)} />}
      </Show>
    </div>
  );
}
