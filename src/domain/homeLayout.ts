/** Home is organised into categories, each shown as one tab of the floating
 *  tab bar. Every destination and every Home block is an "item" that lives in
 *  exactly one category, or is hidden. The user can move items between
 *  categories, reorder them, hide them, and add, rename or remove categories.
 *
 *  This module is pure: it only transforms layouts. Persistence and the
 *  signal live in app/homeLayout.ts. */

export const HOME_ITEMS = [
  // Tasks
  'banner', 'widgets', 'inbox', 'today', 'cando', 'upcoming', 'prior', 'anytime', 'someday',
  'projects', 'logbook', 'trash',
  // Plan
  'calendarStrip', 'planner', 'calendar', 'boards', 'note', 'review', 'views',
  // Focus & Habits
  'quote', 'focus', 'target', 'habits', 'myroutine', 'beliefs',
  // Track
  'worklog', 'counters', 'finishDay',
] as const;

export type HomeItemId = (typeof HOME_ITEMS)[number];

/** Icons a category can carry in the tab bar. Kept to names the Icon set has. */
export const CATEGORY_ICONS = [
  'checklist', 'calendar', 'target', 'chart', 'layers', 'star', 'sparkle', 'bolt', 'flame', 'mountain',
] as const;
export type CategoryIcon = (typeof CATEGORY_ICONS)[number];

export interface HomeCategory {
  id: string;
  title: string;
  icon: CategoryIcon;
  items: HomeItemId[];
}

export interface HomeLayout {
  categories: HomeCategory[];
  hidden: HomeItemId[];
}

/** The tab bar holds this many categories plus the + button. */
export const MAX_CATEGORIES = 5;
export const MAX_TITLE = 24;

export const DEFAULT_LAYOUT: HomeLayout = {
  categories: [
    {
      id: 'tasks',
      title: 'Tasks',
      icon: 'checklist',
      items: ['banner', 'widgets', 'inbox', 'today', 'cando', 'upcoming', 'prior', 'anytime', 'someday', 'projects', 'logbook', 'trash'],
    },
    {
      id: 'plan',
      title: 'Plan',
      icon: 'calendar',
      items: ['calendarStrip', 'planner', 'calendar', 'boards', 'note', 'review', 'views'],
    },
    {
      id: 'focus',
      title: 'Focus & Habits',
      icon: 'target',
      items: ['quote', 'focus', 'target', 'habits', 'myroutine', 'beliefs'],
    },
    {
      id: 'track',
      title: 'Track',
      icon: 'chart',
      items: ['worklog', 'counters', 'finishDay'],
    },
  ],
  hidden: [],
};

const ITEM_SET = new Set<string>(HOME_ITEMS);
const ICON_SET = new Set<string>(CATEGORY_ICONS);

function isItem(x: unknown): x is HomeItemId {
  return typeof x === 'string' && ITEM_SET.has(x);
}

function clone(layout: HomeLayout): HomeLayout {
  return {
    categories: layout.categories.map((c) => ({ ...c, items: [...c.items] })),
    hidden: [...layout.hidden],
  };
}

/** Which default category an item belongs to: where it goes back to when a
 *  saved layout predates it. */
export function defaultCategoryOf(item: HomeItemId): string {
  return DEFAULT_LAYOUT.categories.find((c) => c.items.includes(item))!.id;
}

/** Turn anything read from storage into a valid layout: unknown items are
 *  dropped, duplicates keep their first place, and items the saved layout
 *  doesn't mention (new in this version) join their default category, or the
 *  first one if that category was removed. Never throws. */
export function normalizeLayout(raw: unknown): HomeLayout {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<HomeLayout>;
  const seen = new Set<HomeItemId>();
  const ids = new Set<string>();
  const categories: HomeCategory[] = [];

  for (const c of Array.isArray(src.categories) ? src.categories : []) {
    if (!c || typeof c !== 'object' || categories.length >= MAX_CATEGORIES) continue;
    const id = typeof c.id === 'string' && c.id && !ids.has(c.id) ? c.id : uniqueId(ids);
    ids.add(id);
    const title = typeof c.title === 'string' && c.title.trim()
      ? c.title.trim().slice(0, MAX_TITLE)
      : 'Untitled';
    const icon = typeof c.icon === 'string' && ICON_SET.has(c.icon) ? (c.icon as CategoryIcon) : 'layers';
    const items: HomeItemId[] = [];
    for (const it of Array.isArray(c.items) ? c.items : []) {
      if (isItem(it) && !seen.has(it)) {
        seen.add(it);
        items.push(it);
      }
    }
    categories.push({ id, title, icon, items });
  }

  const hidden: HomeItemId[] = [];
  for (const it of Array.isArray(src.hidden) ? src.hidden : []) {
    if (isItem(it) && !seen.has(it)) {
      seen.add(it);
      hidden.push(it);
    }
  }

  if (categories.length === 0) return clone(DEFAULT_LAYOUT);

  for (const it of HOME_ITEMS) {
    if (seen.has(it)) continue;
    const home = categories.find((c) => c.id === defaultCategoryOf(it)) ?? categories[0]!;
    home.items.push(it);
  }
  return { categories, hidden };
}

function uniqueId(taken: Set<string>): string {
  let n = taken.size + 1;
  while (taken.has(`c${n}`)) n++;
  return `c${n}`;
}

/** The category an item is in, or null when hidden. */
export function categoryOf(layout: HomeLayout, item: HomeItemId): HomeCategory | null {
  return layout.categories.find((c) => c.items.includes(item)) ?? null;
}

function detach(layout: HomeLayout, item: HomeItemId): void {
  for (const c of layout.categories) c.items = c.items.filter((x) => x !== item);
  layout.hidden = layout.hidden.filter((x) => x !== item);
}

/** Move an item to a category (at the end, or at `index`). Also un-hides it. */
export function moveItem(layout: HomeLayout, item: HomeItemId, categoryId: string, index?: number): HomeLayout {
  const next = clone(layout);
  const target = next.categories.find((c) => c.id === categoryId);
  if (!target) return layout;
  detach(next, item);
  const at = index === undefined ? target.items.length : Math.max(0, Math.min(index, target.items.length));
  target.items.splice(at, 0, item);
  return next;
}

/** Shift an item one place up (-1) or down (+1) inside its category. */
export function shiftItem(layout: HomeLayout, item: HomeItemId, dir: -1 | 1): HomeLayout {
  const cat = categoryOf(layout, item);
  if (!cat) return layout;
  const i = cat.items.indexOf(item);
  const j = i + dir;
  if (j < 0 || j >= cat.items.length) return layout;
  const next = clone(layout);
  const items = next.categories.find((c) => c.id === cat.id)!.items;
  [items[i], items[j]] = [items[j]!, items[i]!];
  return next;
}

export function hideItem(layout: HomeLayout, item: HomeItemId): HomeLayout {
  if (layout.hidden.includes(item)) return layout;
  const next = clone(layout);
  detach(next, item);
  next.hidden.push(item);
  return next;
}

/** Bring a hidden item back, into its default category when that still exists. */
export function showItem(layout: HomeLayout, item: HomeItemId, categoryId?: string): HomeLayout {
  const want = categoryId ?? defaultCategoryOf(item);
  const target = layout.categories.find((c) => c.id === want) ?? layout.categories[0]!;
  return moveItem(layout, item, target.id);
}

/** Add an empty category. Returns the layout unchanged when the bar is full
 *  or the title is blank; `id` lets the caller know which tab to open. */
export function addCategory(
  layout: HomeLayout,
  title: string,
  icon?: CategoryIcon,
): { layout: HomeLayout; id: string | null } {
  const clean = title.trim().slice(0, MAX_TITLE);
  if (!clean || layout.categories.length >= MAX_CATEGORIES) return { layout, id: null };
  const next = clone(layout);
  const id = uniqueId(new Set(next.categories.map((c) => c.id)));
  const used = new Set(next.categories.map((c) => c.icon));
  const pick = icon ?? CATEGORY_ICONS.find((i) => !used.has(i)) ?? 'layers';
  next.categories.push({ id, title: clean, icon: pick, items: [] });
  return { layout: next, id };
}

export function renameCategory(layout: HomeLayout, id: string, title: string): HomeLayout {
  const clean = title.trim().slice(0, MAX_TITLE);
  if (!clean) return layout;
  const next = clone(layout);
  const cat = next.categories.find((c) => c.id === id);
  if (!cat) return layout;
  cat.title = clean;
  return next;
}

export function setCategoryIcon(layout: HomeLayout, id: string, icon: CategoryIcon): HomeLayout {
  const next = clone(layout);
  const cat = next.categories.find((c) => c.id === id);
  if (!cat) return layout;
  cat.icon = icon;
  return next;
}

/** Remove a category. Its items are not lost: they move to the end of the
 *  first remaining category. The last category can't be removed. */
export function removeCategory(layout: HomeLayout, id: string): HomeLayout {
  if (layout.categories.length <= 1) return layout;
  const gone = layout.categories.find((c) => c.id === id);
  if (!gone) return layout;
  const next = clone(layout);
  next.categories = next.categories.filter((c) => c.id !== id);
  next.categories[0]!.items.push(...gone.items);
  return next;
}

/** Shift a category one place left (-1) or right (+1) in the tab bar. */
export function shiftCategory(layout: HomeLayout, id: string, dir: -1 | 1): HomeLayout {
  const i = layout.categories.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= layout.categories.length) return layout;
  const next = clone(layout);
  [next.categories[i], next.categories[j]] = [next.categories[j]!, next.categories[i]!];
  return next;
}

/** The word shown under a tab icon: the title if short, else its first word. */
export function tabLabel(title: string): string {
  if (title.length <= 8) return title;
  const first = title.split(/[\s&/,+-]+/).find(Boolean) ?? title;
  return first.length <= 9 ? first : `${first.slice(0, 8)}…`;
}

/** Human names for the edit screens and the Move sheet. */
export const ITEM_LABEL: Record<HomeItemId, string> = {
  banner: 'Today banner',
  widgets: 'Widgets (Up Next, Overdue)',
  inbox: 'Inbox',
  today: 'Today',
  cando: 'Can Do Now',
  upcoming: 'Upcoming',
  prior: 'Prior',
  anytime: 'Anytime',
  someday: 'Someday',
  projects: 'Projects & Areas',
  logbook: 'Logbook',
  trash: 'Trash',
  calendarStrip: 'Week strip',
  planner: 'Planner',
  calendar: 'Calendar',
  boards: 'Boards',
  note: 'Daily Note',
  review: 'Weekly Review',
  views: 'Views',
  quote: 'Brain Food',
  focus: 'Daily Focus',
  target: "Today's Target",
  habits: 'Habits',
  myroutine: 'My Routine',
  beliefs: 'Beliefs',
  worklog: 'Worklog',
  counters: 'Counters',
  finishDay: 'Finish Day',
};

/** Items drawn as a block (card, strip, list of projects) rather than a single row. */
export const BLOCK_ITEMS = new Set<HomeItemId>(['banner', 'widgets', 'calendarStrip', 'quote', 'projects', 'views']);
