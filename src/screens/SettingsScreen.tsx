import { createSignal, onMount, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { getSetting, setSetting } from '../db/mutations';
import { exportData, importData, validateExport } from '../db/exportImport';
import { DEFAULT_PROXY, importIcsText, refreshCalendar } from '../app/calendar';
import { setThemePref, themePref, resolvedTheme, PALETTES, type ThemePref, type Palette } from '../app/theme';
import { askCompletionDate, setAskCompletionDate } from '../app/settings';
import { doneTodaySec, setOverlayOpen } from '../app/pomodoro';
import { formatHrMin } from '../domain/pomodoro';
import { push } from '../app/navigation';
import { Icon } from '../ui/Icon';
import { ScreenChrome } from './common';

function Section(props: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <div style={{ padding: '14px 16px 4px' }}>
      <div style={{ 'font-size': '13px', 'font-weight': '600', color: 'var(--text-secondary)', 'text-transform': 'uppercase', 'letter-spacing': '0.4px', padding: '0 0 8px' }}>
        {props.title}
      </div>
      <div style={{ background: 'var(--bg-inset)', 'border-radius': '12px', padding: '4px 14px' }}>
        {props.children}
      </div>
    </div>
  );
}

export function SettingsScreen(): JSX.Element {
  const [icsUrl, setIcsUrl] = createSignal('');
  const [icsProxy, setIcsProxy] = createSignal(DEFAULT_PROXY);
  const [calStatus, setCalStatus] = createSignal('');
  const [importStatus, setImportStatus] = createSignal('');
  const [storageInfo, setStorageInfo] = createSignal('');
  let fileInput!: HTMLInputElement;
  let icsFileInput!: HTMLInputElement;

  onMount(async () => {
    setIcsUrl(await getSetting('icsUrl', ''));
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
    await setSetting('icsProxy', proxy);
    await setSetting('lastIcsFetch', 0);
    if (!icsUrl().trim()) {
      await db.calendarEvents.clear();
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
        'font-size': '12px',
        'font-weight': paletteSelected(p.id) ? '600' : '400',
        color: paletteSelected(p.id) ? 'var(--text)' : 'var(--text-secondary)',
        'letter-spacing': '-0.1px',
      }}>{p.label}</span>
    </button>
  );

  const inputStyle = {
    width: '100%',
    padding: '10px 0',
    'font-size': '15px',
    'border-bottom': '1px solid var(--separator)',
  } as const;

  return (
    <ScreenChrome title="Settings" icon={<Icon name="settings" size={28} color="var(--text-secondary)" />}>
      <Section title="Appearance">
        <div style={{ display: 'flex', gap: '8px', padding: '8px 0' }}>
          {PALETTES.map(themeSwatch)}
        </div>
        <div style={{ display: 'flex', 'justify-content': 'flex-end', padding: '0 0 8px' }}>
          <button
            onClick={() => void setThemePref('auto')}
            data-testid="theme-auto"
            style={{
              'font-size': '12px',
              color: themePref() === 'auto' ? 'var(--blue)' : 'var(--text-tertiary)',
              'font-weight': themePref() === 'auto' ? '600' : '400',
            }}
          >
            {themePref() === 'auto' ? '✓ ' : ''}Follow system
          </button>
        </div>
      </Section>

      <Section title="Completing to-dos">
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
          <span style={{ flex: '1', 'font-size': '15px' }}>Ask when a late to-do was finished</span>
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
        <div style={{ 'font-size': '12px', color: 'var(--text-tertiary)', padding: '0 0 10px', 'line-height': '1.5' }}>
          Ticking a to-do whose date has already passed asks which day you
          actually finished it, and files it under that day in the Logbook. Turn
          this off to always log the moment you tick.
        </div>
      </Section>

      <Section title="Focus Timer">
        <div style={{ padding: '10px 0' }}>
          <button
            data-testid="open-focus-timer"
            onClick={() => setOverlayOpen(true)}
            style={{ color: 'var(--blue)', 'font-size': '15px', 'font-weight': '600' }}
          >
            Open Focus Timer
          </button>
          <div style={{ 'font-size': '12px', color: 'var(--text-tertiary)', padding: '10px 0 8px', 'line-height': '1.5' }}>
            Tilt to choose, tap to begin. A session ends when you tap Done — the clock keeps
            running into overtime, so you're never cut off mid-thought. Finished focus sessions
            are logged automatically. Presets, tags and theme all live inside the timer (open it
            with the 🎯 button in Today). Focused today: {formatHrMin(doneTodaySec())}.
          </div>
        </div>
      </Section>

      <Section title="Boards">
        <div style={{ padding: '10px 0' }}>
          <button
            data-testid="open-boards"
            onClick={() => push({ name: 'boards' })}
            style={{ color: 'var(--blue)', 'font-size': '15px', 'font-weight': '600' }}
          >
            Open Boards
          </button>
          <div style={{ 'font-size': '12px', color: 'var(--text-tertiary)', padding: '10px 0 8px', 'line-height': '1.6' }}>
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

      <Section title="Google Calendar">
        <div style={{ 'font-size': '12px', color: 'var(--text-tertiary)', padding: '10px 0 6px', 'line-height': '1.5' }}>
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
          <button onClick={() => void saveCalendar()} data-testid="save-calendar" style={{ color: 'var(--blue)', 'font-weight': '600', 'font-size': '15px' }}>
            Save &amp; Update
          </button>
          <button onClick={() => icsFileInput.click()} style={{ color: 'var(--blue)', 'font-size': '15px' }}>
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
          <div style={{ 'font-size': '13px', color: 'var(--text-secondary)', padding: '0 0 10px' }}>{calStatus()}</div>
        </Show>
        <div style={{ 'font-size': '12px', color: 'var(--text-tertiary)', padding: '0 0 10px', 'line-height': '1.5' }}>
          Events appear in the Calendar screen and in Today / Upcoming, read-only. They refresh
          automatically when you open the app (hourly at most) — use the refresh button in the
          Calendar screen for an instant update. Google blocks direct browser access (CORS), so
          the proxy prefix is used; public proxies can see your calendar URL — for privacy, host
          your own tiny proxy (see the project README) or import a .ics file instead.
        </div>
      </Section>

      <Section title="Backup">
        <div style={{ display: 'flex', gap: '14px', padding: '10px 0' }}>
          <button onClick={() => void doExport()} data-testid="export-data" style={{ display: 'flex', 'align-items': 'center', gap: '6px', color: 'var(--blue)', 'font-size': '15px', 'font-weight': '500' }}>
            <Icon name="export" size={17} /> Export
          </button>
          <button onClick={() => fileInput.click()} data-testid="import-data" style={{ display: 'flex', 'align-items': 'center', gap: '6px', color: 'var(--blue)', 'font-size': '15px' }}>
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
          <div style={{ 'font-size': '13px', color: 'var(--text-secondary)', padding: '0 0 10px' }}>{importStatus()}</div>
        </Show>
        <div style={{ 'font-size': '12px', color: 'var(--text-tertiary)', padding: '0 0 10px' }}>
          All data lives on this device. Export a backup now and then — especially before
          clearing Safari website data.
        </div>
      </Section>

      <Section title="About">
        <div style={{ 'font-size': '13px', color: 'var(--text-secondary)', padding: '10px 0', 'line-height': '1.6' }}>
          Clarity {__APP_VERSION__}
          <Show when={storageInfo()}>
            <br />
            {storageInfo()}
          </Show>
        </div>
      </Section>
    </ScreenChrome>
  );
}
