import { describe, expect, it } from 'vitest';
import {
  addCategory, categoryOf, DEFAULT_LAYOUT, HOME_ITEMS, hideItem, MAX_CATEGORIES, moveItem, normalizeLayout,
  removeCategory, renameCategory, shiftCategory, shiftItem, showItem, tabLabel, type HomeLayout,
} from '../../src/domain/homeLayout';
import { searchSettings, SETTINGS_GROUPS, SECTION_TITLE, groupOfSection } from '../../src/domain/settingsGroups';

/** Every item appears exactly once across the categories and the hidden list. */
function expectComplete(layout: HomeLayout): void {
  const all = [...layout.categories.flatMap((c) => c.items), ...layout.hidden];
  expect(all.sort()).toEqual([...HOME_ITEMS].sort());
}

describe('home layout: defaults', () => {
  it('puts every item in exactly one of four categories', () => {
    expect(DEFAULT_LAYOUT.categories.map((c) => c.title)).toEqual(['Tasks', 'Plan', 'Focus & Habits', 'Track']);
    expectComplete(DEFAULT_LAYOUT);
    expect(DEFAULT_LAYOUT.hidden).toEqual([]);
  });

  it('groups the destinations as agreed', () => {
    const where = (id: (typeof HOME_ITEMS)[number]) => categoryOf(DEFAULT_LAYOUT, id)?.id;
    expect(['inbox', 'today', 'cando', 'upcoming', 'prior', 'anytime', 'someday', 'logbook', 'trash'].map((i) => where(i as never)))
      .toEqual(Array(9).fill('tasks'));
    expect(['planner', 'calendar', 'boards', 'note', 'review'].map((i) => where(i as never))).toEqual(Array(5).fill('plan'));
    expect(['focus', 'target', 'habits', 'myroutine', 'beliefs'].map((i) => where(i as never))).toEqual(Array(5).fill('focus'));
    expect(['worklog', 'counters', 'finishDay'].map((i) => where(i as never))).toEqual(Array(3).fill('track'));
  });
});

describe('home layout: normalizeLayout', () => {
  it('falls back to the default for garbage', () => {
    for (const bad of [null, undefined, 42, 'x', {}, { categories: [] }, { categories: 'nope' }]) {
      expect(normalizeLayout(bad)).toEqual(DEFAULT_LAYOUT);
    }
  });

  it('does not share arrays with the default', () => {
    const a = normalizeLayout(null);
    a.categories[0]!.items.pop();
    expect(DEFAULT_LAYOUT.categories[0]!.items).toContain('trash');
  });

  it('drops unknown items and duplicates, keeping the first place', () => {
    const l = normalizeLayout({
      categories: [
        { id: 'a', title: 'A', icon: 'star', items: ['inbox', 'bogus', 'today', 'inbox'] },
        { id: 'b', title: 'B', icon: 'star', items: ['today', 'planner'] },
      ],
      hidden: ['planner', 'trash', 'nope'],
    });
    expect(l.categories[0]!.items.slice(0, 2)).toEqual(['inbox', 'today']);
    expect(l.categories[1]!.items[0]).toBe('planner');
    expect(l.hidden).toEqual(['trash']);
    expectComplete(l);
  });

  it('adds items a saved layout does not know to their default category, or the first', () => {
    const l = normalizeLayout({
      categories: [
        { id: 'mine', title: 'Mine', icon: 'star', items: ['inbox'] },
        { id: 'track', title: 'Track', icon: 'chart', items: ['worklog'] },
      ],
      hidden: [],
    });
    expect(l.categories[1]!.items).toEqual(['worklog', 'counters', 'finishDay']);
    expect(l.categories[0]!.items).toContain('planner'); // "plan" is gone → first category
    expectComplete(l);
  });

  it('repairs titles, icons, ids, and caps the number of categories', () => {
    const cats = Array.from({ length: 8 }, (_, i) => ({ id: 'same', title: i === 0 ? '   ' : `T${i}`, icon: 'nope', items: [] }));
    const l = normalizeLayout({ categories: cats, hidden: [] });
    expect(l.categories).toHaveLength(MAX_CATEGORIES);
    expect(new Set(l.categories.map((c) => c.id)).size).toBe(MAX_CATEGORIES);
    expect(l.categories[0]!.title).toBe('Untitled');
    expect(l.categories.every((c) => c.icon === 'layers')).toBe(true);
    expectComplete(l);
  });
});

describe('home layout: edits', () => {
  const base = () => normalizeLayout(DEFAULT_LAYOUT);

  it('moves an item to another category, at the end or at an index', () => {
    let l = moveItem(base(), 'note', 'tasks');
    expect(categoryOf(l, 'note')?.id).toBe('tasks');
    expect(l.categories[0]!.items.at(-1)).toBe('note');
    expect(l.categories[1]!.items).not.toContain('note');
    l = moveItem(l, 'note', 'tasks', 0);
    expect(l.categories[0]!.items[0]).toBe('note');
    expectComplete(l);
  });

  it('ignores a move to a category that does not exist', () => {
    const l = base();
    expect(moveItem(l, 'note', 'nope')).toBe(l);
  });

  it('reorders within a category and stops at the ends', () => {
    const l = base();
    const first = l.categories[3]!.items[0]!;
    expect(shiftItem(l, first, -1)).toBe(l);
    const down = shiftItem(l, first, 1);
    expect(down.categories[3]!.items).toEqual(['counters', 'worklog', 'finishDay']);
    expect(l.categories[3]!.items).toEqual(['worklog', 'counters', 'finishDay']); // untouched
  });

  it('hides and shows items; show goes home to the default category', () => {
    let l = hideItem(base(), 'trash');
    expect(categoryOf(l, 'trash')).toBeNull();
    expect(l.hidden).toEqual(['trash']);
    expect(hideItem(l, 'trash')).toBe(l);
    l = showItem(l, 'trash');
    expect(categoryOf(l, 'trash')?.id).toBe('tasks');
    l = showItem(hideItem(l, 'trash'), 'trash', 'track');
    expect(categoryOf(l, 'trash')?.id).toBe('track');
    expectComplete(l);
  });

  it('adds categories up to the limit, picking unused icons', () => {
    let l = base();
    const r = addCategory(l, '  Reading  ');
    expect(r.id).not.toBeNull();
    l = r.layout;
    expect(l.categories.at(-1)).toMatchObject({ title: 'Reading', items: [] });
    expect(new Set(l.categories.map((c) => c.icon)).size).toBe(l.categories.length);
    expect(addCategory(l, 'Sixth').id).toBeNull(); // full at five
    expect(addCategory(base(), '   ').id).toBeNull();
  });

  it('renames, ignoring blank names', () => {
    const l = renameCategory(base(), 'plan', ' Schedule ');
    expect(l.categories[1]!.title).toBe('Schedule');
    expect(renameCategory(l, 'plan', '  ')).toBe(l);
  });

  it('removes a category without losing its items, but never the last one', () => {
    let l = removeCategory(base(), 'plan');
    expect(l.categories.map((c) => c.id)).toEqual(['tasks', 'focus', 'track']);
    expect(categoryOf(l, 'planner')?.id).toBe('tasks');
    expectComplete(l);
    l = removeCategory(removeCategory(removeCategory(l, 'track'), 'focus'), 'tasks');
    expect(l.categories).toHaveLength(1);
    expectComplete(l);
  });

  it('shifts categories left and right', () => {
    const l = shiftCategory(base(), 'track', -1);
    expect(l.categories.map((c) => c.id)).toEqual(['tasks', 'plan', 'track', 'focus']);
    expect(shiftCategory(l, 'tasks', -1)).toBe(l);
  });

  it('makes short tab labels', () => {
    expect(tabLabel('Tasks')).toBe('Tasks');
    expect(tabLabel('Focus & Habits')).toBe('Focus');
    expect(tabLabel('Extraordinarily long')).toBe('Extraord…');
  });
});

describe('settings groups', () => {
  it('puts every section in exactly one group', () => {
    const all = SETTINGS_GROUPS.flatMap((g) => g.sections);
    expect(all.sort()).toEqual(Object.keys(SECTION_TITLE).sort());
    expect(groupOfSection('google-calendar')).toBe('integrations');
    expect(groupOfSection('appearance')).toBe('general');
  });

  it('searches titles first, then keywords', () => {
    expect(searchSettings('')).toEqual([]);
    expect(searchSettings('backup')[0]).toEqual({ section: 'backup', group: 'data' });
    expect(searchSettings('dark mode')[0]?.section).toBe('appearance');
    expect(searchSettings('motion')[0]?.section).toBe('appearance');
    expect(searchSettings('ics').map((r) => r.section)).toEqual(['google-calendar']);
    expect(searchSettings('timer')[0]?.section).toBe('focus-timer');
    expect(searchSettings('zzzz')).toEqual([]);
  });
});
