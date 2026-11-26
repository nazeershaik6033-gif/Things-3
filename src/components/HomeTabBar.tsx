import { createEffect, createSignal, For, on, onMount, Show, type JSX } from 'solid-js';
import { Icon } from '../ui/Icon';
import { haptic } from '../app/motion';
import { tabLabel, type HomeCategory } from '../domain/homeLayout';

/** The floating tab bar at the bottom of Home: one tab per category with the
 *  + button in the middle. A highlight glides to the selected tab (with a
 *  little squash-and-stretch on the "rich" motion level), the selected icon
 *  pops, and the + spins into × while its menu is open. All of it is CSS
 *  (base.css → "Floating tab bar"), keyed off <html data-motion>. */
export function HomeTabBar(props: {
  categories: HomeCategory[];
  selected: string;
  onSelect: (id: string) => void;
  addOpen: boolean;
  onAdd: () => void;
}): JSX.Element {
  let barEl!: HTMLDivElement;
  let glideEl!: HTMLDivElement;
  const [ready, setReady] = createSignal(false);

  const leftCount = () => Math.ceil(props.categories.length / 2);
  const left = () => props.categories.slice(0, leftCount());
  const right = () => props.categories.slice(leftCount());
  const tabWidth = () => (props.categories.length >= 5 ? 52 : 58);

  /** Slide the highlight under the selected tab. Measured from the DOM, so it
   *  stays right whatever the number of tabs or their order. */
  const place = () => {
    const tab = barEl.querySelector<HTMLElement>(`[data-tab="${CSS.escape(props.selected)}"]`);
    if (!tab) return;
    glideEl.style.transform = `translate3d(${tab.offsetLeft}px, 0, 0)`;
  };

  onMount(() => {
    // First placement without the glide, so the pill doesn't fly in from 0
    glideEl.style.transition = 'none';
    place();
    void glideEl.offsetWidth;
    glideEl.style.transition = '';
    setReady(true);
  });
  createEffect(on(() => [props.selected, props.categories.map((c) => c.id).join()], place, { defer: true }));

  const tab = (c: HomeCategory) => (
    <button
      role="tab"
      data-tab={c.id}
      data-testid={`home-tab-${c.id}`}
      aria-selected={props.selected === c.id}
      aria-label={c.title}
      class="tabbar-tab no-select"
      onClick={() => {
        if (props.selected !== c.id) haptic('select');
        props.onSelect(c.id);
      }}
    >
      <span class="tabbar-icon" style={{ display: 'flex' }}>
        <Icon name={c.icon} size={20} />
      </span>
      <span class="tabbar-tab-label">{tabLabel(c.title)}</span>
    </button>
  );

  return (
    <div
      ref={barEl}
      class="tabbar"
      role="tablist"
      aria-label="Home categories"
      data-testid="home-tabbar"
      style={{ '--tab-w': `${tabWidth()}px` }}
    >
      <div ref={glideEl} class="tabbar-glide" aria-hidden="true" style={{ visibility: ready() ? 'visible' : 'hidden' }}>
        {/* Re-created on every change so the squash-and-stretch replays */}
        <Show when={props.selected} keyed>
          {(_id) => <span class="tabbar-pill goo" />}
        </Show>
      </div>
      <For each={left()}>{tab}</For>
      <button
        class="tabbar-plus no-select"
        data-testid="home-add"
        aria-label={props.addOpen ? 'Close create menu' : 'Create new'}
        aria-expanded={props.addOpen}
        onClick={() => {
          haptic('tick');
          props.onAdd();
        }}
      >
        <span class="tabbar-plus-glyph">
          <Icon name="plus" size={24} />
        </span>
      </button>
      <For each={right()}>{tab}</For>
    </div>
  );
}
