import type { IconName } from '../ui/Icon';

/** Settings opens on five groups instead of one long page. Each group is its
 *  own page holding a few sections; a search on the landing page finds a
 *  section by its title or by the words of the settings inside it. */

export type SettingsSectionId =
  | 'appearance' | 'text' | 'completing'
  | 'planner' | 'focus-timer' | 'time-tracking' | 'short-syntax'
  | 'google-calendar' | 'github' | 'my-routine' | 'boards'
  | 'ai'
  | 'backup' | 'about';

export type SettingsGroupId = 'general' | 'planning' | 'integrations' | 'ai' | 'data';

export interface SettingsGroup {
  id: SettingsGroupId;
  title: string;
  icon: IconName;
  /** Solid colour behind the white icon on the landing page. */
  tint: string;
  sections: SettingsSectionId[];
  /** Line under the title on the landing page; defaults to the section names. */
  blurb?: string;
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  { id: 'general', title: 'General', icon: 'settings', tint: '#8e8e93', sections: ['appearance', 'text', 'completing'] },
  { id: 'planning', title: 'Planner & Time', icon: 'clock', tint: '#2f7cf6', sections: ['planner', 'focus-timer', 'time-tracking', 'short-syntax'] },
  { id: 'integrations', title: 'Integrations', icon: 'link', tint: '#53b855', sections: ['google-calendar', 'github', 'my-routine', 'boards'] },
  { id: 'ai', title: 'AI', icon: 'sparkle', tint: '#b678e0', sections: ['ai'], blurb: 'Provider, key and model for summaries' },
  { id: 'data', title: 'Data', icon: 'export', tint: '#ff9500', sections: ['backup', 'about'] },
];

export const SECTION_TITLE: Record<SettingsSectionId, string> = {
  appearance: 'Appearance',
  text: 'Text',
  completing: 'Completing to-dos',
  planner: 'Planner',
  'focus-timer': 'Focus Timer',
  'time-tracking': 'Time tracking & breaks',
  'short-syntax': 'Quick Entry short syntax',
  'google-calendar': 'Google Calendar',
  github: 'GitHub issues',
  'my-routine': 'My Routine',
  boards: 'Boards',
  ai: 'AI',
  backup: 'Backup',
  about: 'About',
};

/** Words people might type for what's inside each section. */
const SECTION_KEYWORDS: Record<SettingsSectionId, string> = {
  appearance: 'theme dark light mode colour color palette snow parchment slate midnight motion animation reduce transitions confetti',
  text: 'font typeface style text size bigger larger smaller bold weight line spacing notes reading serif rounded mono accessibility',
  completing: 'complete completion date ask finished done logbook',
  planner: 'timeline snap minutes week start week numbers alerts reminder default alert calendar view',
  'focus-timer': 'pomodoro timer focus sprint minutes',
  'time-tracking': 'time tracking break reminder estimate idle worklog',
  'short-syntax': 'quick entry syntax tags project when due estimate shortcut',
  'google-calendar': 'calendar ics ical subscription url proxy events import file google',
  github: 'github issues import token repository',
  'my-routine': 'routine window reminders notifications feeds youtube telegram rss',
  boards: 'boards kanban trello cards',
  ai: 'ai openrouter gemini claude key model provider digest summary',
  backup: 'backup export import json restore data',
  about: 'version storage about',
};

export function groupOfSection(section: SettingsSectionId): SettingsGroupId {
  return SETTINGS_GROUPS.find((g) => g.sections.includes(section))!.id;
}

export function groupTitle(group: SettingsGroupId): string {
  return SETTINGS_GROUPS.find((g) => g.id === group)?.title ?? 'Settings';
}

export function groupIcon(group: SettingsGroupId): IconName {
  return SETTINGS_GROUPS.find((g) => g.id === group)?.icon ?? 'settings';
}

export function isSettingsGroup(x: string | undefined): x is SettingsGroupId {
  return SETTINGS_GROUPS.some((g) => g.id === x);
}

export function isSettingsSection(x: string | undefined): x is SettingsSectionId {
  return x !== undefined && Object.prototype.hasOwnProperty.call(SECTION_TITLE, x);
}

/** Sections matching every word of the query, title matches first, in the
 *  order the groups list them. */
export function searchSettings(query: string): { section: SettingsSectionId; group: SettingsGroupId }[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: { section: SettingsSectionId; group: SettingsGroupId; score: number; order: number }[] = [];
  let order = 0;
  for (const g of SETTINGS_GROUPS) {
    for (const section of g.sections) {
      order++;
      const title = SECTION_TITLE[section].toLowerCase();
      const hay = `${title} ${g.title.toLowerCase()} ${SECTION_KEYWORDS[section]}`;
      if (!words.every((w) => hay.includes(w))) continue;
      const score = words.every((w) => title.includes(w)) ? 0 : 1;
      scored.push({ section, group: g.id, score, order });
    }
  }
  return scored
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .map(({ section, group }) => ({ section, group }));
}
