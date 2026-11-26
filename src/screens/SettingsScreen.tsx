import { createContext, createMemo, createSignal, For, onMount, Show, useContext, type JSX } from 'solid-js';
import { db } from '../db/db';
import { getSetting, setSetting } from '../db/mutations';
import { exportData, importData, validateExport } from '../db/exportImport';
import { DEFAULT_PROXY, extraCalendars, importIcsText, loadCalendarPrefs, refreshCalendar } from '../app/calendar';
import { CalendarSources } from '../components/CalendarSources';
import { setThemePref, themePref, resolvedTheme, PALETTES, type ThemePref, type Palette } from '../app/theme';
import { aiConfig, askCompletionDate, setAskCompletionDate, updateAiConfig } from '../app/settings';
import {
  DEFAULT_ALERT_CHOICES, SNAP_CHOICES, defaultAlert, setDefaultAlert, setShowWeekNumbers, setSnapStep, setWeekStart,
  showWeekNumbers, snapStep, weekStart,
} from '../app/planner';
import { GEMINI_MODELS, OPENROUTER_MODELS, type AiProvider } from '../net/ai';
import { doneTodaySec, setOverlayOpen } from '../app/pomodoro';
import { formatHrMin } from '../domain/pomodoro';
import { push } from '../app/navigation';
import { startHomeLayout } from '../app/homeLayout';
import { startTextPrefs } from '../app/textPrefs';
import { TextSettings } from '../components/TextSettings';
import { motionLevel, motionPref, setMotionPref, type MotionPref } from '../app/motion';
import {
  SECTION_TITLE, SETTINGS_GROUPS, groupIcon, groupOfSection, groupTitle, searchSettings,
  type SettingsGroupId, type SettingsSectionId,
} from '../domain/settingsGroups';
import { Icon } from '../ui/Icon';
import { ScreenChrome } from './common';
import { GitHubSettings, ShortSyntaxHelp, TimeTrackingSettings } from './SuperSettings';


const MOTION_CHOICES: { id: MotionPref; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'rich', label: 'Rich' },
  { id: 'subtle', label: 'Subtle' },
  { id: 'off', label: 'Off' },
];

const MOTION_HINT: Record<MotionPref, string> = {
  auto: 'Follows your iPhone: Rich, or Off when Reduce Motion is on.',
  rich: 'Springy sheets and tabs, pages that rise in, cards that spring back, and confetti when you finish your habits, hit your target or finish the day.',
  subtle: 'The same moves, calmer: no overshoot, quicker fades, no confetti.',
  off: 'No animation. Screens and sheets appear at once.',
};

/** Settings → Appearance → Motion. */
function MotionPicker(): JSX.Element {
  return (
    <div style={{ 'border-top': '1px solid var(--separator)', padding: '10px 0' }}>
      <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', 'padding-bottom': '8px' }}>
        <span style={{ 'font-size': 'calc(15px * var(--ts))', color: 'var(--text)' }}>Motion</span>
        <Show when={motionPref() === 'auto'}>
          <span style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)' }}>Now: {motionLevel() === 'off' ? 'Off' : 'Rich'}</span>
        </Show>
      </div>
      <div role="radiogroup" aria-label="Motion" style={{ display: 'flex', gap: '4px', padding: '3px', 'border-radius': '10px', background: 'var(--bg-list)' }}>
        <For each={MOTION_CHOICES}>
          {(c) => (
            <button
              role="radio"
              aria-checked={motionPref() === c.id}
              data-testid={`motion-${c.id}`}
              onClick={() => void setMotionPref(c.id)}
              style={{
                flex: '1', padding: '7px 0', 'border-radius': '8px', 'font-size': 'calc(14px * var(--ts))',
                'font-weight': motionPref() === c.id ? 'var(--fw-600)' : 'var(--fw-400)',
                background: motionPref() === c.id ? 'var(--blue)' : 'transparent',
                color: motionPref() === c.id ? '#fff' : 'var(--text-secondary)',
                transition: 'background-color 160ms, color 160ms',
              }}
            >
              {c.label}
            </button>
          )}
        </For>
      </div>
      <div data-testid="motion-hint" style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)', padding: '8px 2px 0', 'line-height': 'calc(1.45 * var(--lh))' }}>
        {MOTION_HINT[motionPref()]}
      </div>
    </div>
  );
}

/** The section a settings page is showing, provided by SettingsGroupPage. A
 *  section renders only on its own group's page; its children are created
 *  lazily, so hidden sections cost nothing. */
const GroupContext = createContext<SettingsGroupId | null>(null);

function Section(props: { id: SettingsSectionId; title: string; children: JSX.Element }): JSX.Element {
  const group = useContext(GroupContext);
  return (
    <Show when={group === groupOfSection(props.id)}>
      <div data-section={props.id} data-testid={`settings-section-${props.id}`} style={{ padding: '14px 16px 4px' }}>
        <div style={{ 'font-size': 'calc(13px * var(--ts))', 'font-weight': 'var(--fw-600)', color: 'var(--text-secondary)', 'text-transform': 'uppercase', 'letter-spacing': '0.4px', padding: '0 0 8px' }}>
          {props.title}
        </div>
        <div style={{ background: 'var(--bg-inset)', 'border-radius': '12px', padding: '4px 14px' }}>
          {props.children}
        </div>
      </div>
    </Show>
  );
}

/** Settings landing page: a search box and the five groups. Searching lists
 *  the matching sections across every group; tapping one opens its page and
 *  scrolls to it. */
function SettingsLanding(): JSX.Element {
  const [query, setQuery] = createSignal('');
  const results = createMemo(() => searchSettings(query()));
  return (
    <ScreenChrome title="Settings" icon={<Icon name="settings" size={28} color="var(--text-secondary)" />}>
      <div style={{ padding: '0 16px 12px' }}>
        <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', padding: '9px 12px', 'border-radius': '12px', background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}>
          <Icon name="search" size={16} />
          <input
            data-testid="settings-search"
            type="search"
            placeholder="Search settings"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            style={{ flex: '1', 'font-size': 'calc(16px * var(--ts))', background: 'transparent', color: 'var(--text)' }}
          />
        </div>
      </div>
      <Show
        when={query().trim()}
        fallback={
          <div class="rise" style={{ margin: '0 16px', background: 'var(--bg-inset)', 'border-radius': '14px', overflow: 'hidden' }}>
            <For each={SETTINGS_GROUPS}>
              {(g, i) => (
                <button
                  data-testid={`settings-group-${g.id}`}
                  class="pressable"
                  onClick={() => push({ name: 'settings', group: g.id })}
                  style={{
                    display: 'flex', 'align-items': 'center', gap: '12px', width: '100%', padding: '12px 14px', 'text-align': 'left',
                    'border-top': i() === 0 ? 'none' : '1px solid var(--separator)',
                  }}
                >
                  <span style={{ width: '32px', height: '32px', 'border-radius': '9px', display: 'grid', 'place-items': 'center', background: g.tint, flex: 'none' }}>
                    <Icon name={g.icon} size={18} color="#fff" />
                  </span>
                  <span style={{ flex: '1', 'min-width': '0' }}>
                    <span style={{ display: 'block', 'font-size': 'calc(17px * var(--ts))', color: 'var(--text)' }}>{g.title}</span>
                    <span style={{ display: 'block', 'font-size': 'calc(13px * var(--ts))', color: 'var(--text-secondary)', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>
                      {g.blurb ?? g.sections.map((sec) => SECTION_TITLE[sec]).join(' · ')}
                    </span>
                  </span>
                  <Icon name="chevron-right" size={16} color="var(--text-tertiary)" />
                </button>
              )}
            </For>
          </div>
        }
      >
        <Show
          when={results().length > 0}
          fallback={<div style={{ padding: '24px 16px', 'text-align': 'center', color: 'var(--text-secondary)' }}>No settings match “{query().trim()}”.</div>}
        >
          <div style={{ margin: '0 16px', background: 'var(--bg-inset)', 'border-radius': '14px', overflow: 'hidden' }}>
            <For each={results()}>
              {(r, i) => (
                <button
                  data-testid={`settings-result-${r.section}`}
                  class="pressable"
                  onClick={() => push({ name: 'settings', group: r.group, section: r.section })}
                  style={{
                    display: 'flex', 'align-items': 'center', gap: '10px', width: '100%', padding: '12px 14px', 'text-align': 'left',
                    'border-top': i() === 0 ? 'none' : '1px solid var(--separator)',
                  }}
                >
                  <span style={{ flex: '1' }}>
                    <span style={{ display: 'block', 'font-size': 'calc(16px * var(--ts))', color: 'var(--text)' }}>{SECTION_TITLE[r.section]}</span>
                    <span style={{ display: 'block', 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-secondary)' }}>{groupTitle(r.group)}</span>
                  </span>
                  <Icon name="chevron-right" size={16} color="var(--text-tertiary)" />
                </button>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </ScreenChrome>
  );
}

/** Settings: the landing page, or one group's page. */
export function SettingsScreen(props: { group?: SettingsGroupId; section?: SettingsSectionId }): JSX.Element {
  return (
    <Show when={props.group} fallback={<SettingsLanding />}>
      {(group) => <SettingsGroupPage group={group()} section={props.section} />}
    </Show>
  );
}

function SettingsGroupPage(props: { group: SettingsGroupId; section?: SettingsSectionId }): JSX.Element {
  const [icsUrl, setIcsUrl] = createSignal('');
  /** The main link as saved (the field above may hold unsaved edits). */
  const [savedIcsUrl, setSavedIcsUrl] = createSignal('');
  const [icsProxy, setIcsProxy] = createSignal(DEFAULT_PROXY);
  const [calStatus, setCalStatus] = createSignal('');
  const [importStatus, setImportStatus] = createSignal('');
  const [storageInfo, setStorageInfo] = createSignal('');
  let fileInput!: HTMLInputElement;
  let icsFileInput!: HTMLInputElement;
  let scrollEl: HTMLDivElement | undefined;

  onMount(() => {
    // Opened from a search result: bring that section into view
    if (!props.section || !scrollEl) return;
    const target = scrollEl.querySelector<HTMLElement>(`[data-section="${props.section}"]`);
    if (!target) return;
    const offset = target.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top;
    scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop + offset - 8);
  });

  onMount(async () => {
    setIcsUrl(await getSetting('icsUrl', ''));
    setSavedIcsUrl(icsUrl());
    // Show the default if a previous save left the proxy empty
    setIcsProxy((await getSetting('icsProxy', DEFAULT_PROXY)).trim() || DEFAULT_PROXY);
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      const used = ((est.usage ?? 0) / 1024 / 1024).toFixed(1);
      const persisted = (await navigator.storage.persisted?.()) ? 'protected' : 'best-effort';
      setStorageInfo(`${used} MB used · storage ${persisted}`);
    }
  });

  const saveCalendar = async () => {
    // Never persist an empty proxy — sync would silently break (CORS)
    const proxy = icsProxy().trim() || DEFAULT_PROXY;
    setIcsProxy(proxy);
    await setSetting('icsUrl', icsUrl().trim());
    setSavedIcsUrl(icsUrl().trim());
    await setSetting('icsProxy', proxy);
    await setSetting('lastIcsFetch', 0);
    // Drop events of a main link that was removed or replaced — but keep the
    // extra calendars' events and imported files
    const keep = new Set([icsUrl().trim(), 'file', ...extraCalendars().map((c) => c.url)]);
    await db.calendarEvents.filter((e) => !keep.has(e.calendarUrl)).delete();
    await loadCalendarPrefs();
    if (!icsUrl().trim()) {
      setCalStatus('Calendar removed.');
      return;
    }
    setCalStatus('Updating…');
    const result = await refreshCalendar(true);
    setCalStatus(result?.message ?? '');
  };

  const doExport = async () => {
    const data = await exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `clarity-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doImport = async (file: File) => {
    try {
      const json = JSON.parse(await file.text()) as unknown;
      const valid = validateExport(json);
      if (!window.confirm('Importing replaces ALL current data with the backup. Continue?')) return;
      await importData(valid);
      await startHomeLayout();
      await startTextPrefs();
      setImportStatus(`Imported ${valid.data.tasks.length} to-dos.`);
    } catch (e) {
      setImportStatus(e instanceof Error ? e.message : 'Import failed.');
    }
  };

  const doImportIcsFile = async (file: File) => {
    try {
      const count = await importIcsText(await file.text(), 'file');
      setCalStatus(`Imported ${count} events from file.`);
    } catch {
      setCalStatus('Could not read that calendar file.');
    }
  };

  const paletteSelected = (id: Palette) =>
    themePref() === id || (themePref() === 'auto' && resolvedTheme() === id);

  const themeSwatch = (p: typeof PALETTES[number]) => (
    <button
      onClick={() => void setThemePref(p.id as ThemePref)}
      data-testid={`theme-${p.id}`}
      title={p.label}
      style={{
        flex: '1',
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'center',
        gap: '6px',
        padding: '6px 0 10px',
        background: 'transparent',
      }}
    >
      <span style={{
        display: 'block',
        width: '100%',
        height: '44px',
        'border-radius': '10px',
        background: p.bg,
        border: paletteSelected(p.id)
          ? '2.5px solid var(--blue)'
          : '1.5px solid rgba(128,128,128,0.25)',
        'box-shadow': paletteSelected(p.id)
          ? '0 0 0 2px var(--blue)'
          : 'none',
        transition: 'box-shadow 0.15s, border-color 0.15s',
      }} />
      <span style={{
        'font-size': 'calc(12px * var(--ts))',
        'font-weight': paletteSelected(p.id) ? 'var(--fw-600)' : 'var(--fw-400)',
        color: paletteSelected(p.id) ? 'var(--text)' : 'var(--text-secondary)',
        'letter-spacing': '-0.1px',
      }}>{p.label}</span>
    </button>
  );

  const inputStyle = {
    width: '100%',
    padding: '10px 0',
    'font-size': 'calc(15px * var(--ts))',
    'border-bottom': '1px solid var(--separator)',
  } as const;

  return (
    <ScreenChrome
      title={groupTitle(props.group)}
      icon={<Icon name={groupIcon(props.group)} size={26} color="var(--text-secondary)" />}
      scrollRef={(el) => (scrollEl = el)}
    >
      <GroupContext.Provider value={props.group}>
      <Section id="appearance" title="Appearance">
        <div style={{ display: 'flex', gap: '8px', padding: '8px 0' }}>
          {PALETTES.map(themeSwatch)}
        </div>
        <div style={{ display: 'flex', 'justify-content': 'flex-end', padding: '0 0 8px' }}>
          <button
            onClick={() => void setThemePref('auto')}
            data-testid="theme-auto"
            style={{
              'font-size': 'calc(12px * var(--ts))',
              color: themePref() === 'auto' ? 'var(--blue)' : 'var(--text-tertiary)',
              'font-weight': themePref() === 'auto' ? 'var(--fw-600)' : 'var(--fw-400)',
            }}
          >
            {themePref() === 'auto' ? '✓ ' : ''}Follow system
          </button>
        </div>
        <MotionPicker />
      </Section>

      <Section id="text" title="Text">
        <TextSettings />
      </Section>

      <Section id="completing" title="Completing to-dos">
        <button
          data-testid="toggle-ask-completion"
          onClick={() => void setAskCompletionDate(!askCompletionDate())}
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '12px',
            width: '100%',
            padding: '11px 0',
            'text-align': 'left',
          }}
        >
          <span style={{ flex: '1', 'font-size': 'calc(15px * var(--ts))' }}>Ask when a late to-do was finished</span>
          <span
            style={{
              width: '46px',
              height: '28px',
              'border-radius': '999px',
              background: askCompletionDate() ? 'var(--green)' : 'var(--check-border)',
              position: 'relative',
              flex: 'none',
              transition: 'background 160ms ease',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: '2px',
                left: '2px',
                width: '24px',
                height: '24px',
                'border-radius': '50%',
                background: '#fff',
                'box-shadow': '0 1px 3px rgba(0,0,0,0.3)',
                // transform, not `left`: the knob must not trigger layout
                transform: askCompletionDate() ? 'translateX(18px)' : 'none',
                transition: 'transform 160ms cubic-bezier(0.22, 0.9, 0.28, 1)',
              }}
            />
          </span>
        </button>
        <div style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)', padding: '0 0 10px', 'line-height': 'calc(1.5 * var(--lh))' }}>
          Ticking a to-do whose date has already passed asks which day you
          actually finished it, and files it under that day in the Logbook. Turn
          this off to always log the moment you tick.
        </div>
      </Section>

      <Section id="planner" title="Planner">
        <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', padding: '10px 0 6px' }}>
          <span style={{ flex: '1', 'font-size': 'calc(15px * var(--ts))' }}>Snap blocks to</span>
          {SNAP_CHOICES.map((m) => (
            <button
              data-testid={`snap-${m}`}
              aria-pressed={snapStep() === m}
              onClick={() => void setSnapStep(m)}
              style={{
                padding: '5px 10px', 'border-radius': '999px', 'font-size': 'calc(13px * var(--ts))', 'font-weight': 'var(--fw-600)',
                background: snapStep() === m ? 'var(--blue)' : 'var(--bg-inset)',
                color: snapStep() === m ? 'var(--text-invert)' : 'var(--text)',
              }}
            >
              {m}m
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', 'align-items': 'center', gap: '6px', padding: '6px 0' }}>
          <span style={{ flex: '1', 'font-size': 'calc(15px * var(--ts))' }}>Week starts on</span>
          {([1, 0] as const).map((d) => (
            <button
              data-testid={`week-start-${d}`}
              aria-pressed={weekStart() === d}
              onClick={() => void setWeekStart(d)}
              style={{
                padding: '5px 10px', 'border-radius': '999px', 'font-size': 'calc(13px * var(--ts))', 'font-weight': 'var(--fw-600)',
                background: weekStart() === d ? 'var(--blue)' : 'var(--bg-inset)',
                color: weekStart() === d ? 'var(--text-invert)' : 'var(--text)',
              }}
            >
              {d === 1 ? 'Monday' : 'Sunday'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', 'align-items': 'center', gap: '6px', padding: '6px 0' }}>
          <span style={{ flex: '1', 'font-size': 'calc(15px * var(--ts))' }}>Week numbers in the calendar</span>
          <button
            data-testid="toggle-week-numbers"
            aria-pressed={showWeekNumbers()}
            onClick={() => void setShowWeekNumbers(!showWeekNumbers())}
            style={{
              padding: '5px 12px', 'border-radius': '999px', 'font-size': 'calc(13px * var(--ts))', 'font-weight': 'var(--fw-600)',
              background: showWeekNumbers() ? 'var(--blue)' : 'var(--bg-inset)',
              color: showWeekNumbers() ? 'var(--text-invert)' : 'var(--text)',
            }}
          >
            {showWeekNumbers() ? 'On' : 'Off'}
          </button>
        </div>
        <div style={{ display: 'flex', 'align-items': 'center', gap: '6px', padding: '6px 0', 'flex-wrap': 'wrap' }}>
          <span style={{ flex: '1', 'font-size': 'calc(15px * var(--ts))', 'min-width': '140px' }}>Default alert</span>
          {DEFAULT_ALERT_CHOICES.map((m) => (
            <button
              data-testid={`default-alert-${m ?? 'none'}`}
              aria-pressed={defaultAlert() === m}
              onClick={() => void setDefaultAlert(m)}
              style={{
                padding: '5px 10px', 'border-radius': '999px', 'font-size': 'calc(13px * var(--ts))', 'font-weight': 'var(--fw-600)',
                background: defaultAlert() === m ? 'var(--blue)' : 'var(--bg-inset)',
                color: defaultAlert() === m ? 'var(--text-invert)' : 'var(--text)',
              }}
            >
              {m === null ? 'None' : m === 0 ? 'At start' : `${m}m`}
            </button>
          ))}
        </div>
        <div style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)', padding: '0 0 6px', 'line-height': 'calc(1.5 * var(--lh))' }}>
          Timed to-dos get this alert unless you set their own (the bell on a
          to-do). Alerts reach your phone through iOS Calendar: tap Send alerts
          on the timeline, open the file and tap Add All. If you change a time,
          send again; if the old alert still shows in Calendar, delete it there.
          While Clarity is open, alerts also show here.
        </div>
        <div style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)', padding: '0 0 10px', 'line-height': 'calc(1.5 * var(--lh))' }}>
          On the timeline, press and hold a to-do to drag it; it stays selected
          with handles to change its length. Press and hold empty space to draw a
          new block. Turn on Push rest to have a block that grows push the ones
          after it, and use Running late to shift the rest of today. Every change
          can be undone from its toast, or with ⌘Z / Ctrl+Z on a keyboard.
        </div>
      </Section>

      <Section id="focus-timer" title="Focus Timer">
        <div style={{ padding: '10px 0' }}>
          <button
            data-testid="open-focus-timer"
            onClick={() => setOverlayOpen(true)}
            style={{ color: 'var(--blue)', 'font-size': 'calc(15px * var(--ts))', 'font-weight': 'var(--fw-600)' }}
          >
            Open Focus Timer
          </button>
          <div style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)', padding: '10px 0 8px', 'line-height': 'calc(1.5 * var(--lh))' }}>
            Tilt to choose, tap to begin. A session ends when you tap Done — the clock keeps
            running into overtime, so you're never cut off mid-thought. Finished focus sessions
            are logged automatically. Presets, tags and theme all live inside the timer (open it
            with the 🎯 button in Today). Focused today: {formatHrMin(doneTodaySec())}.
          </div>
        </div>
      </Section>

      <Section id="time-tracking" title="Time tracking & breaks">
        <TimeTrackingSettings />
      </Section>

      <Section id="short-syntax" title="Quick Entry short syntax">
        <ShortSyntaxHelp />
      </Section>

      <Section id="github" title="GitHub issues">
        <GitHubSettings />
      </Section>

      <Section id="my-routine" title="My Routine">
        <div style={{ padding: '10px 0' }}>
          <button
            data-testid="open-myroutine"
            onClick={() => push({ name: 'myroutine' })}
            style={{ color: 'var(--blue)', 'font-size': 'calc(15px * var(--ts))', 'font-weight': 'var(--fw-600)' }}
          >
            Open My Routine
          </button>
          <div style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)', padding: '10px 0 8px', 'line-height': 'calc(1.6 * var(--lh))' }}>
            The apps, sites and channels you go through each day, grouped and checked off
            inside a <b>window</b> — Morning, Night, or any window you add. A window stays open
            until the next one starts, so anything a YouTube channel, Telegram channel or RSS
            feed published in that stretch shows up as <b>new</b>.
            <br /><br />
            <b>Get started:</b> from Home tap <b>My Routine</b>, then <b>+</b> in the toolbar to
            make a group, and <b>+</b> on the group to add a source.
            <br /><br />
            <b>History</b> keeps two records: how much you cleared on each of the last 14 days,
            and every update that slipped past an unfinished window, saved for 14 days.
            <br /><br />
            Feeds are read through public CORS proxies, since this app has no server of its
            own — a feed that can't be read still works as something to tick off. Window
            reminders (the bell) are local notifications shown while the app is open.
          </div>
        </div>
      </Section>

      <Section id="ai" title="AI">
        <div style={{ padding: '10px 0' }}>
          <div style={{ display: 'flex', gap: '6px', 'margin-bottom': '10px' }}>
            {(
              [
                ['claude', 'Claude app'],
                ['openrouter', 'OpenRouter'],
                ['gemini', 'Gemini'],
              ] as Array<[AiProvider, string]>
            ).map(([id, label]) => (
              <button
                onClick={() => void updateAiConfig({ provider: id })}
                aria-pressed={aiConfig().provider === id}
                data-testid={`ai-provider-${id}`}
                style={{
                  flex: '1',
                  padding: '9px 4px',
                  'border-radius': '10px',
                  'font-size': 'calc(13px * var(--ts))',
                  'font-weight': 'var(--fw-600)',
                  border: `1px solid ${aiConfig().provider === id ? 'var(--blue)' : 'var(--separator)'}`,
                  background: aiConfig().provider === id ? 'rgba(47, 124, 246, 0.1)' : 'transparent',
                  color: aiConfig().provider === id ? 'var(--blue)' : 'var(--text-secondary)',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <Show when={aiConfig().provider === 'claude'}>
            <div style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)', 'line-height': 'calc(1.5 * var(--lh))', padding: '2px 0 8px' }}>
              No key needed. The <b>send</b> button in My Routine builds a prompt from what's
              new, copies it, and opens claude.ai with it prefilled. Pick OpenRouter or Gemini
              instead if you'd rather the summary appear inside the app.
            </div>
          </Show>

          <Show when={aiConfig().provider === 'openrouter'}>
            <input
              value={aiConfig().openRouterKey}
              onInput={(e) => void updateAiConfig({ openRouterKey: e.currentTarget.value })}
              placeholder="OpenRouter API key (sk-or-…)"
              type="password"
              autocapitalize="none"
              autocorrect="off"
              spellcheck={false}
              data-testid="ai-openrouter-key"
              style={{ width: '100%', padding: '10px 0', border: 'none', background: 'transparent', color: 'var(--text)', 'font-size': 'calc(16px * var(--ts))', outline: 'none' }}
            />
            <select
              value={aiConfig().openRouterModel}
              onChange={(e) => void updateAiConfig({ openRouterModel: e.currentTarget.value })}
              aria-label="OpenRouter model"
              style={{ width: '100%', padding: '10px 0', border: 'none', background: 'transparent', color: 'var(--text)', 'font-size': 'calc(15px * var(--ts))' }}
            >
              {OPENROUTER_MODELS.map(([id, label]) => <option value={id}>{label}</option>)}
            </select>
            <div style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)', 'line-height': 'calc(1.5 * var(--lh))', padding: '4px 0 8px' }}>
              Free keys from openrouter.ai/keys. The key is stored on this device only and sent
              straight to OpenRouter — there is no server in between. Free models are rate
              limited to roughly 20 requests a minute.
            </div>
          </Show>

          <Show when={aiConfig().provider === 'gemini'}>
            <input
              value={aiConfig().geminiKey}
              onInput={(e) => void updateAiConfig({ geminiKey: e.currentTarget.value })}
              placeholder="Gemini API key"
              type="password"
              autocapitalize="none"
              autocorrect="off"
              spellcheck={false}
              data-testid="ai-gemini-key"
              style={{ width: '100%', padding: '10px 0', border: 'none', background: 'transparent', color: 'var(--text)', 'font-size': 'calc(16px * var(--ts))', outline: 'none' }}
            />
            <select
              value={aiConfig().geminiModel}
              onChange={(e) => void updateAiConfig({ geminiModel: e.currentTarget.value })}
              aria-label="Gemini model"
              style={{ width: '100%', padding: '10px 0', border: 'none', background: 'transparent', color: 'var(--text)', 'font-size': 'calc(15px * var(--ts))' }}
            >
              {GEMINI_MODELS.map(([id, label]) => <option value={id}>{label}</option>)}
            </select>
            <div style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)', 'line-height': 'calc(1.5 * var(--lh))', padding: '4px 0 8px' }}>
              Free keys from aistudio.google.com/apikey. Stored on this device only and sent
              straight to Google.
            </div>
          </Show>
        </div>
      </Section>

      <Section id="boards" title="Boards">
        <div style={{ padding: '10px 0' }}>
          <button
            data-testid="open-boards"
            onClick={() => push({ name: 'boards' })}
            style={{ color: 'var(--blue)', 'font-size': 'calc(15px * var(--ts))', 'font-weight': 'var(--fw-600)' }}
          >
            Open Boards
          </button>
          <div style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)', padding: '10px 0 8px', 'line-height': 'calc(1.6 * var(--lh))' }}>
            A Trello-style board for projects that work better as columns than a checklist —
            each <b>board</b> holds <b>lists</b> (its columns, like To Do / Doing / Done), and
            each list holds <b>cards</b>.
            <br /><br />
            <b>Get started:</b> from Home, tap <b>Boards</b> → <b>New Board</b>, then <b>Add
            list</b> to create a column and <b>+ Add a card</b> inside it.
            <br /><br />
            <b>Organize:</b> long-press a card to drag it up/down within a list or across to
            another list — it drops where you release. To reorder a whole list instead, use its
            <b>⋯</b> menu → Move Left/Right.
            <br /><br />
            <b>Card details:</b> tap a card to open it full-screen — add a description,
            checklist, colored labels, a cover color, a due date (with an optional time), and
            comments. The board's <b>⋯</b> menu manages labels for the whole board.
            <br /><br />
            <b>Calendar view:</b> the calendar icon in a board's header shows every card with a
            due date as an agenda, grouped by day.
            <br /><br />
            Due-date reminders are local notifications shown while the app is open — there's no
            push server, so they won't arrive if the app or tab is fully closed.
          </div>
        </div>
      </Section>

      <Section id="google-calendar" title="Google Calendar">
        <div style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)', padding: '10px 0 6px', 'line-height': 'calc(1.5 * var(--lh))' }}>
          In Google Calendar (web): Settings → your calendar → <b>Integrate calendar</b> →
          copy the <b>Secret address in iCal format</b> (it ends in <b>.ics</b>), then paste it
          here. Not the “Embed” or “Public URL” link — those won’t work for private calendars.
        </div>
        <input
          value={icsUrl()}
          onInput={(e) => setIcsUrl(e.currentTarget.value)}
          placeholder="Paste Google Calendar link (.ics)"
          inputmode="url"
          autocapitalize="off"
          data-testid="ics-url"
          style={inputStyle}
        />
        <input
          value={icsProxy()}
          onInput={(e) => setIcsProxy(e.currentTarget.value)}
          placeholder="CORS proxy prefix (optional)"
          autocapitalize="off"
          style={inputStyle}
        />
        <div style={{ display: 'flex', gap: '14px', padding: '10px 0' }}>
          <button onClick={() => void saveCalendar()} data-testid="save-calendar" style={{ color: 'var(--blue)', 'font-weight': 'var(--fw-600)', 'font-size': 'calc(15px * var(--ts))' }}>
            Save &amp; Update
          </button>
          <button onClick={() => icsFileInput.click()} style={{ color: 'var(--blue)', 'font-size': 'calc(15px * var(--ts))' }}>
            Import .ics file…
          </button>
          <input
            ref={icsFileInput}
            type="file"
            accept=".ics,text/calendar"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) void doImportIcsFile(f);
              e.currentTarget.value = '';
            }}
          />
        </div>
        <Show when={calStatus()}>
          <div style={{ 'font-size': 'calc(13px * var(--ts))', color: 'var(--text-secondary)', padding: '0 0 10px' }}>{calStatus()}</div>
        </Show>
        <CalendarSources mainUrl={savedIcsUrl()} />
        <div style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)', padding: '0 0 10px', 'line-height': 'calc(1.5 * var(--lh))' }}>
          Events appear in the Calendar screen and in Today / Upcoming, read-only. They refresh
          automatically when you open the app (hourly at most) — use the refresh button in the
          Calendar screen for an instant update. Google blocks direct browser access (CORS), so
          the proxy prefix is used; public proxies can see your calendar URL — for privacy, host
          your own tiny proxy (see the project README) or import a .ics file instead.
        </div>
      </Section>

      <Section id="backup" title="Backup">
        <div style={{ display: 'flex', gap: '14px', padding: '10px 0' }}>
          <button onClick={() => void doExport()} data-testid="export-data" style={{ display: 'flex', 'align-items': 'center', gap: '6px', color: 'var(--blue)', 'font-size': 'calc(15px * var(--ts))', 'font-weight': 'var(--fw-500)' }}>
            <Icon name="export" size={17} /> Export
          </button>
          <button onClick={() => fileInput.click()} data-testid="import-data" style={{ display: 'flex', 'align-items': 'center', gap: '6px', color: 'var(--blue)', 'font-size': 'calc(15px * var(--ts))' }}>
            <Icon name="import" size={17} /> Import
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) void doImport(f);
              e.currentTarget.value = '';
            }}
          />
        </div>
        <Show when={importStatus()}>
          <div style={{ 'font-size': 'calc(13px * var(--ts))', color: 'var(--text-secondary)', padding: '0 0 10px' }}>{importStatus()}</div>
        </Show>
        <div style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)', padding: '0 0 10px' }}>
          All data lives on this device. Export a backup now and then — especially before
          clearing Safari website data.
        </div>
      </Section>

      <Section id="about" title="About">
        <div style={{ 'font-size': 'calc(13px * var(--ts))', color: 'var(--text-secondary)', padding: '10px 0', 'line-height': 'calc(1.6 * var(--lh))' }}>
          Clarity {__APP_VERSION__}
          <Show when={storageInfo()}>
            <br />
            {storageInfo()}
          </Show>
        </div>
      </Section>
      </GroupContext.Provider>
    </ScreenChrome>
  );
}
