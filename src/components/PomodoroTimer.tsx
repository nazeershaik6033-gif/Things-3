import {
  createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX,
} from 'solid-js';
import {
  focusState, now, overlayOpen, setOverlayOpen, hasActiveSession,
  startSession, finishSession, discardSession, setSessionTag, toggleTheme,
  setPreset, setBreakMin, setLongMin, addTag, removeTag, deleteRecord,
  requestNotifyPermission,
} from '../app/pomodoro';
import {
  MODE_LABEL, PRESET_LABELS, formatDay, formatHrMin, formatMS, plannedMinutes,
  recordsOnDay, sessionClock, sumSeconds, tiltReading,
  type FocusTheme, type Mode, type SessionRecord,
} from '../domain/pomodoro';
import { Icon } from '../ui/Icon';

/** The Focus Timer is a deliberate full-screen takeover with its own identity —
 *  matt-paper themes and a condensed face — so it reads as a distinct "mode",
 *  the way the original TURN timer does. It sits above Clarity's chrome. */

interface Palette {
  bg: string; fg: string; sub: string; hair: string;
  knob: string; card: string; accent: string; label: string;
}

const THEMES: Record<FocusTheme, Palette> = {
  white: {
    bg: '#EAE4D8', fg: '#191913', sub: 'rgba(25,25,19,.5)', hair: 'rgba(25,25,19,.16)',
    knob: '#F3EEE3', card: 'rgba(25,25,19,.06)', accent: '#C64F1E', label: 'Matt White',
  },
  black: {
    bg: '#171715', fg: '#E7E1D5', sub: 'rgba(231,225,213,.48)', hair: 'rgba(231,225,213,.16)',
    knob: '#21211E', card: 'rgba(231,225,213,.07)', accent: '#D5581F', label: 'Matt Black',
  },
};

const FONT = "'Avenir Next Condensed','Arial Narrow','Inter',-apple-system,system-ui,sans-serif";
const MODES: [Mode, string][] = [['focus', 'FOCUS'], ['break', 'BREAK'], ['long', 'LONG BREAK']];

const SAFE_T = 'var(--safe-top)';
const SAFE_B = 'var(--safe-bottom)';

function buzz(pattern: number | number[]): void {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

const needsTiltPermission = (): boolean =>
  typeof DeviceOrientationEvent !== 'undefined' &&
  typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission === 'function';

// ---------------------------------------------------------------- mini bar ---

/** Compact countdown, in Clarity's own chrome, shown while a session runs and
 *  the overlay is minimized. Tap to jump back into the timer. */
export function FocusTimerMiniBar(): JSX.Element {
  const session = () => focusState().session;
  return (
    <Show when={session() && !overlayOpen()}>
      {(() => {
        const clock = () => sessionClock(session()!, now());
        return (
          <button
            data-testid="pomo-minibar"
            onClick={() => setOverlayOpen(true)}
            style={{
              position: 'fixed',
              top: `calc(${SAFE_T} + 6px)`,
              left: '50%',
              transform: 'translateX(-50%)',
              'z-index': '60',
              display: 'flex',
              'align-items': 'center',
              gap: '8px',
              padding: '6px 14px',
              'border-radius': '999px',
              background: 'var(--bg-elevated)',
              'box-shadow': 'var(--shadow-card)',
              color: 'var(--text)',
              'font-size': '13px',
              'font-weight': '600',
              'font-variant-numeric': 'tabular-nums',
            }}
          >
            <span style={{
              width: '8px', height: '8px', 'border-radius': '50%',
              background: THEMES[focusState().theme].accent,
            }} />
            {MODE_LABEL[session()!.mode]} · {clock().over ? '+' : ''}{formatMS(clock().shown)}
          </button>
        );
      })()}
    </Show>
  );
}

// ------------------------------------------------------------- top bar/util ---

function topBtn(K: Palette, active = false): JSX.CSSProperties {
  return {
    width: '44px', height: '44px', display: 'flex', 'align-items': 'center',
    'justify-content': 'center', color: active ? K.accent : K.fg, 'border-radius': '12px',
  };
}

const labelStyle = (K: Palette): JSX.CSSProperties => ({
  'font-size': '11px', 'font-weight': '700', 'letter-spacing': '.22em', color: K.sub,
});

function TopBar(props: {
  K: Palette; title: string;
  onBack: () => void; view: 'dial' | 'records' | 'settings';
  onRecords: () => void; onSettings: () => void; onTheme: () => void;
}): JSX.Element {
  return (
    <div style={{ 'flex-shrink': '0', display: 'flex', 'align-items': 'center', padding: '8px 10px', gap: '2px' }}>
      <button data-testid="pomo-back" aria-label="Back" onClick={props.onBack} style={topBtn(props.K)}>
        <Icon name="chevron-left" size={22} />
      </button>
      <div style={{ flex: '1', 'text-align': 'center', 'font-size': '16px', 'font-weight': '700', 'letter-spacing': '.42em', 'padding-left': '6px' }}>
        {props.title}
      </div>
      <button data-testid="pomo-records" aria-label="Records" onClick={props.onRecords} style={topBtn(props.K, props.view === 'records')}>
        <Icon name="logbook" size={21} />
      </button>
      <button data-testid="pomo-settings" aria-label="Timer settings" onClick={props.onSettings} style={topBtn(props.K, props.view === 'settings')}>
        <Icon name="settings" size={21} />
      </button>
      <button data-testid="pomo-theme" aria-label="Toggle theme" onClick={props.onTheme} style={topBtn(props.K)}>
        <Icon name="moon" size={21} />
      </button>
    </div>
  );
}

// ------------------------------------------------------------- running view ---

function RunningView(props: { K: Palette }): JSX.Element {
  const K = props.K;
  const [ctl, setCtl] = createSignal(false);
  const session = () => focusState().session!;
  const clock = createMemo(() => sessionClock(session(), now()));

  return (
    <>
      <div style={{
        position: 'absolute', left: '0', right: '0', top: '0',
        height: `${clock().fill * 100}%`, background: K.accent,
        transition: 'height 600ms linear', opacity: clock().over ? '.94' : '1',
      }} />
      <Show when={clock().over}>
        <div style={{ position: 'absolute', inset: '0', background: K.accent, animation: 'pomo-flash 1.6s ease-in-out infinite alternate', opacity: '.12' }} />
      </Show>

      <div
        data-testid="pomo-face"
        onClick={() => setCtl((v) => !v)}
        style={{ position: 'relative', flex: '1', display: 'flex', 'flex-direction': 'column', 'align-items': 'center', 'justify-content': 'center', cursor: 'pointer' }}
      >
        <div style={{
          'font-size': 'clamp(88px,30vw,150px)', 'font-weight': '700', 'line-height': '.92',
          'letter-spacing': '-.01em', 'text-align': 'center', 'font-variant-numeric': 'tabular-nums',
          'mix-blend-mode': focusState().theme === 'black' ? 'normal' : 'multiply',
        }}>
          <Show when={clock().over}>
            <div style={{ 'font-size': 'clamp(20px,6vw,28px)', 'letter-spacing': '.28em', 'margin-bottom': '14px', opacity: '.85' }}>OVERTIME +</div>
          </Show>
          <div data-testid="pomo-remaining">{formatMS(clock().shown)}</div>
        </div>
        <div data-testid="pomo-runmode" style={{ 'margin-top': '30px', 'font-size': '13px', 'font-weight': '700', 'letter-spacing': '.34em' }}>
          {MODE_LABEL[session().mode]}{session().tag ? ` · ${session().tag.toUpperCase()}` : ''}
        </div>
        <Show when={!ctl()}>
          <div style={{ position: 'absolute', bottom: `calc(26px + ${SAFE_B})`, 'font-size': '10.5px', 'font-weight': '600', 'letter-spacing': '.24em', opacity: '.55' }}>
            TAP FOR CONTROLS
          </div>
        </Show>
      </div>

      <Show when={ctl()}>
        <div style={{
          position: 'relative', 'flex-shrink': '0', padding: `18px 22px calc(22px + ${SAFE_B})`,
          display: 'flex', 'flex-direction': 'column', gap: '14px', background: K.bg, 'border-top': `1px solid ${K.hair}`,
        }}>
          <Show when={session().mode === 'focus'}>
            <div style={{ display: 'flex', gap: '8px', 'overflow-x': 'auto' }}>
              <For each={['', ...focusState().tags]}>
                {(tg) => {
                  const on = () => (session().tag || '') === tg;
                  return (
                    <button
                      onClick={() => setSessionTag(tg)}
                      style={{
                        'flex-shrink': '0', padding: '8px 14px', 'border-radius': '999px', 'font-family': FONT,
                        'font-size': '12px', 'font-weight': '700', 'letter-spacing': '.14em',
                        border: `1.5px solid ${on() ? K.fg : K.hair}`,
                        background: on() ? K.fg : 'transparent', color: on() ? K.bg : K.fg,
                      }}
                    >
                      {tg ? tg.toUpperCase() : 'NO TAG'}
                    </button>
                  );
                }}
              </For>
            </div>
          </Show>
          <button
            data-testid="pomo-done"
            onClick={finishSession}
            style={{ width: '100%', padding: '17px', 'border-radius': '14px', background: K.fg, color: K.bg, 'font-family': FONT, 'font-size': '16px', 'font-weight': '700', 'letter-spacing': '.3em' }}
          >
            DONE
          </button>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              data-testid="pomo-minimize"
              onClick={() => setOverlayOpen(false)}
              style={{ flex: '1', padding: '10px', 'font-family': FONT, 'font-size': '12px', 'font-weight': '700', 'letter-spacing': '.22em', color: K.sub }}
            >
              MINIMIZE
            </button>
            <button
              data-testid="pomo-discard"
              onClick={discardSession}
              style={{ flex: '1', padding: '10px', 'font-family': FONT, 'font-size': '12px', 'font-weight': '700', 'letter-spacing': '.22em', color: K.sub }}
            >
              DISCARD SESSION
            </button>
          </div>
        </div>
      </Show>
    </>
  );
}

// ---------------------------------------------------------------- dial view ---

function DialView(props: { K: Palette; mode: Mode; setMode: (m: Mode) => void; sel: number; setSel: (i: number) => void }): JSX.Element {
  const K = props.K;
  const [tiltOn, setTiltOn] = createSignal(!needsTiltPermission());

  // Keep the selected index in a ref so the tilt listener doesn't re-subscribe
  // on every pick.
  let selRef = props.sel;
  createEffect(() => { selRef = props.sel; });

  createEffect(() => {
    if (!tiltOn() || hasActiveSession() || props.mode !== 'focus') return;
    let angle = 0;
    const onOri = (e: DeviceOrientationEvent): void => {
      if (e.beta == null || e.gamma == null) return;
      const r = tiltReading(angle, e.beta, e.gamma);
      angle = r.angle;
      if (r.index !== null && r.index !== selRef) { buzz(8); props.setSel(r.index); }
    };
    window.addEventListener('deviceorientation', onOri);
    onCleanup(() => window.removeEventListener('deviceorientation', onOri));
  });

  const enableTilt = async (): Promise<void> => {
    try {
      const req = (DeviceOrientationEvent as unknown as { requestPermission(): Promise<string> }).requestPermission;
      const r = await req();
      if (r === 'granted') setTiltOn(true);
    } catch { /* denied */ }
  };

  const start = (): void => {
    requestNotifyPermission();
    const s = focusState();
    const planned = plannedMinutes(s, props.mode, props.sel);
    const tag = props.mode === 'focus' ? s.lastTag : '';
    buzz(15);
    startSession(props.mode, planned, tag);
  };

  const mins = (i: number): number => {
    if (props.mode === 'break') return focusState().breakMin;
    if (props.mode === 'long') return focusState().longMin;
    return focusState().presets[i] ?? 0;
  };
  const activeSel = () => (props.mode === 'focus' ? props.sel : 0);
  const slots = () => (props.mode === 'focus' ? [0, 1, 2, 3] : [0]);
  const D = 'min(78vw,330px)';
  const pos: JSX.CSSProperties[] = [
    { top: '0', left: '50%', transform: 'translateX(-50%)' },
    { right: '0', top: '50%', transform: 'translateY(-50%) rotate(90deg)' },
    { bottom: '0', left: '50%', transform: 'translateX(-50%) rotate(180deg)' },
    { left: '0', top: '50%', transform: 'translateY(-50%) rotate(270deg)' },
  ];

  return (
    <>
      <div style={{ 'flex-shrink': '0', display: 'flex', 'justify-content': 'center', gap: '8px', padding: '10px 16px 0' }}>
        <For each={MODES}>
          {([id, l]) => {
            const on = () => props.mode === id;
            return (
              <button
                data-testid={`pomo-mode-${id}`}
                onClick={() => props.setMode(id)}
                style={{
                  padding: '9px 15px', 'border-radius': '999px', 'font-family': FONT, 'font-size': '11.5px',
                  'font-weight': '700', 'letter-spacing': '.18em', border: `1.5px solid ${on() ? K.fg : K.hair}`,
                  background: on() ? K.fg : 'transparent', color: on() ? K.bg : K.sub,
                  transition: 'background-color 160ms,color 160ms',
                }}
              >
                {l}
              </button>
            );
          }}
        </For>
      </div>

      <div style={{ flex: '1', display: 'flex', 'align-items': 'center', 'justify-content': 'center' }}>
        <div style={{ position: 'relative', width: D, height: D }}>
          <For each={slots()}>
            {(i) => {
              const on = () => i === activeSel();
              return (
                <button
                  data-testid={`pomo-slot-${i}`}
                  onClick={() => props.mode === 'focus' && props.setSel(i)}
                  style={{
                    position: 'absolute', 'font-family': FONT, 'font-variant-numeric': 'tabular-nums',
                    'line-height': '1', padding: '6px', 'font-size': on() ? '62px' : '46px', 'font-weight': '700',
                    'letter-spacing': '-.02em', color: K.fg, opacity: on() ? '1' : '.72',
                    transition: 'font-size 200ms,opacity 200ms', ...pos[i],
                  }}
                >
                  {String(Math.max(0, mins(i))).padStart(2, '0')}
                </button>
              );
            }}
          </For>

          <button
            data-testid="pomo-start"
            onClick={start}
            style={{
              position: 'absolute', top: '50%', left: '50%', width: '96px', height: '116px',
              'margin-left': '-48px', 'margin-top': '-58px', 'border-radius': '50%', background: K.knob,
              border: `1px solid ${K.hair}`,
              'box-shadow': `0 10px 30px rgba(0,0,0,${focusState().theme === 'black' ? '0.5' : '0.16'}), inset 0 1px 0 rgba(255,255,255,${focusState().theme === 'black' ? '.05' : '.7'})`,
              display: 'flex', 'align-items': 'center', 'justify-content': 'center',
              transform: `rotate(${activeSel() * 90}deg)`, transition: 'transform 260ms cubic-bezier(.3,.9,.3,1)',
            }}
          >
            <div style={{ position: 'absolute', top: '11px', left: '50%', 'margin-left': '-3.5px', width: '7px', height: '7px', 'border-radius': '50%', background: K.accent }} />
            <div style={{
              'font-family': FONT, 'font-size': '8.5px', 'font-weight': '700', 'letter-spacing': '.3em', color: K.sub,
              transform: `rotate(${-activeSel() * 90}deg)`, transition: 'transform 260ms cubic-bezier(.3,.9,.3,1)',
            }}>
              START
            </div>
          </button>
        </div>
      </div>

      <div style={{ 'flex-shrink': '0', 'text-align': 'center', padding: `0 24px calc(24px + ${SAFE_B})`, display: 'flex', 'flex-direction': 'column', gap: '10px', 'align-items': 'center' }}>
        <Show when={needsTiltPermission() && !tiltOn()}>
          <button
            onClick={() => void enableTilt()}
            style={{ padding: '10px 18px', 'border-radius': '999px', border: `1.5px solid ${K.fg}`, 'font-family': FONT, 'font-size': '11.5px', 'font-weight': '700', 'letter-spacing': '.2em', color: K.fg }}
          >
            ENABLE TILT
          </button>
        </Show>
        <div style={{ ...labelStyle(K), 'line-height': '1.7' }}>
          {props.mode === 'focus'
            ? (tiltOn() ? 'TILT TO CHOOSE · TAP TO BEGIN' : 'TAP A TIME · TAP THE DIAL TO BEGIN')
            : 'TAP THE DIAL TO BEGIN'}
        </div>
        <div style={{ 'font-size': '10px', 'font-weight': '600', 'letter-spacing': '.14em', color: K.sub, opacity: '.7' }}>
          ENDS WHEN YOU SAY DONE — NOT WHEN THE CLOCK DOES
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------- records view ---

function RecordsView(props: { K: Palette }): JSX.Element {
  const K = props.K;
  const [tagFilter, setTagFilter] = createSignal('');
  const focusRecords = () => focusState().records.filter((r) => r.mode === 'focus');
  const allTags = createMemo(() => {
    const s = new Set(focusState().tags);
    focusRecords().forEach((r) => { if (r.tag) s.add(r.tag); });
    return [...s];
  });
  const list = createMemo(() => {
    const f = tagFilter();
    return f ? focusRecords().filter((r) => r.tag === f) : focusRecords();
  });
  const todaySec = () => sumSeconds(recordsOnDay(list(), now()));
  const weekSec = () => {
    const cutoff = now() - 6 * 86_400_000;
    return sumSeconds(list().filter((r) => r.endedAt >= cutoff));
  };
  const groups = createMemo(() => {
    const m = new Map<string, SessionRecord[]>();
    list().forEach((r) => {
      const k = formatDay(r.endedAt);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    });
    return [...m.entries()];
  });

  const del = (id: string): void => {
    if (window.confirm('Delete this record?')) deleteRecord(id);
  };

  const stat = (t: string, v: string): JSX.Element => (
    <div style={{ flex: '1', background: K.card, 'border-radius': '12px', padding: '12px 14px' }}>
      <div style={{ ...labelStyle(K), 'font-size': '9.5px', 'margin-bottom': '5px' }}>{t}</div>
      <div style={{ 'font-size': '19px', 'font-weight': '700', 'font-variant-numeric': 'tabular-nums' }}>{v}</div>
    </div>
  );

  return (
    <>
      <div style={{ 'flex-shrink': '0', display: 'flex', gap: '8px', 'overflow-x': 'auto', padding: '10px 18px 4px' }}>
        <For each={['', ...allTags()]}>
          {(tg) => {
            const on = () => tagFilter() === tg;
            return (
              <button
                onClick={() => setTagFilter(tg)}
                style={{
                  'flex-shrink': '0', padding: '8px 14px', 'border-radius': '999px', 'font-family': FONT, 'font-size': '11.5px',
                  'font-weight': '700', 'letter-spacing': '.14em', border: `1.5px solid ${on() ? K.fg : K.hair}`,
                  background: on() ? K.fg : 'transparent', color: on() ? K.bg : K.fg,
                }}
              >
                {tg ? tg.toUpperCase() : 'ALL'}
              </button>
            );
          }}
        </For>
      </div>

      <div style={{ 'flex-shrink': '0', display: 'flex', gap: '10px', padding: '10px 18px' }}>
        {stat('TODAY TOTAL', formatHrMin(todaySec()))}
        {stat('LAST 7 DAYS', formatHrMin(weekSec()))}
      </div>

      <div style={{ flex: '1', 'overflow-y': 'auto', padding: `0 18px calc(30px + ${SAFE_B})` }}>
        <Show
          when={list().length}
          fallback={
            <div style={{ padding: '50px 20px', 'text-align': 'center', color: K.sub, 'font-size': '12.5px', 'font-weight': '600', 'letter-spacing': '.14em', 'line-height': '2' }}>
              NO SESSIONS YET
              <div style={{ 'letter-spacing': '.06em', 'font-weight': '500', 'margin-top': '6px' }}>
                Finished focus sessions are logged here automatically.
              </div>
            </div>
          }
        >
          <For each={groups()}>
            {([day, rows]) => (
              <div>
                <div style={{ ...labelStyle(K), padding: '14px 0 8px', 'border-bottom': `1px solid ${K.hair}` }}>{day.toUpperCase()}</div>
                <For each={rows}>
                  {(r) => (
                    <div
                      data-testid="pomo-record"
                      style={{ display: 'flex', 'align-items': 'center', gap: '12px', padding: '13px 0', 'border-bottom': `1px solid ${K.hair}` }}
                    >
                      <div style={{ 'font-size': '19px', 'font-weight': '700', 'font-variant-numeric': 'tabular-nums' }}>{formatMS(r.sec)}</div>
                      <div style={{ flex: '1', 'font-size': '11px', 'font-weight': '700', 'letter-spacing': '.16em', color: K.accent, 'text-align': 'right' }}>
                        {(r.tag || 'FOCUS').toUpperCase()}
                      </div>
                      <button aria-label="Delete record" onClick={() => del(r.id)} style={{ color: K.sub, padding: '6px', display: 'flex' }}>
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </Show>
      </div>
    </>
  );
}

// ------------------------------------------------------------ settings view ---

function SettingsView(props: { K: Palette }): JSX.Element {
  const K = props.K;
  const [newTag, setNewTag] = createSignal('');

  const numIn = (testid: string, value: () => number, set: (v: number) => void): JSX.Element => (
    <input
      type="number" inputmode="numeric" min="1" max="999" value={value()}
      data-testid={testid}
      onChange={(e) => set(Number(e.currentTarget.value))}
      style={{ width: '64px', padding: '8px 4px', 'text-align': 'center', background: 'transparent', border: 'none', 'border-bottom': `2px solid ${K.hair}`, color: K.fg, 'font-family': FONT, 'font-size': '22px', 'font-weight': '700', 'font-variant-numeric': 'tabular-nums' }}
    />
  );
  const row = (l: string, input: JSX.Element): JSX.Element => (
    <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', padding: '13px 0', 'border-bottom': `1px solid ${K.hair}` }}>
      <div style={{ ...labelStyle(K), color: K.fg, opacity: '.85' }}>{l}</div>
      {input}
    </div>
  );
  const sect = (t: string): JSX.Element => <div style={{ ...labelStyle(K), padding: '22px 0 4px', color: K.accent }}>{t}</div>;

  const doAddTag = (): void => { addTag(newTag()); setNewTag(''); };

  return (
    <div style={{ flex: '1', 'overflow-y': 'auto', padding: `4px 20px calc(30px + ${SAFE_B})` }}>
      {sect('COMPASS PRESETS · MINUTES')}
      <For each={PRESET_LABELS}>
        {(d, i) => row(d, numIn(`pomo-preset-${i()}`, () => focusState().presets[i()] ?? 0, (v) => setPreset(i(), v)))}
      </For>

      {sect('BREAKS · MINUTES')}
      {row('BREAK', numIn('pomo-break', () => focusState().breakMin, setBreakMin))}
      {row('LONG BREAK', numIn('pomo-long', () => focusState().longMin, setLongMin))}

      {sect('TAGS')}
      <For each={focusState().tags}>
        {(tg) => (
          <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', padding: '11px 0', 'border-bottom': `1px solid ${K.hair}` }}>
            <div style={{ 'font-size': '13px', 'font-weight': '700', 'letter-spacing': '.16em' }}>{tg}</div>
            <button aria-label={`Remove ${tg}`} onClick={() => removeTag(tg)} style={{ color: K.sub, padding: '6px', display: 'flex' }}>
              <Icon name="close" size={15} />
            </button>
          </div>
        )}
      </For>
      <div style={{ display: 'flex', gap: '10px', 'align-items': 'center', padding: '13px 0' }}>
        <input
          value={newTag()}
          placeholder="New tag"
          data-testid="pomo-newtag"
          onInput={(e) => setNewTag(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') doAddTag(); }}
          style={{ flex: '1', padding: '9px 2px', background: 'transparent', border: 'none', 'border-bottom': `2px solid ${K.hair}`, color: K.fg, 'font-family': FONT, 'font-size': '15px', 'font-weight': '600', 'letter-spacing': '.08em' }}
        />
        <button data-testid="pomo-addtag" onClick={doAddTag} style={{ padding: '9px 16px', 'border-radius': '999px', border: `1.5px solid ${K.fg}`, 'font-family': FONT, 'font-size': '11px', 'font-weight': '700', 'letter-spacing': '.18em', color: K.fg }}>
          ADD
        </button>
      </div>

      {sect('THEME')}
      <div style={{ display: 'flex', gap: '10px', padding: '10px 0' }}>
        <For each={Object.entries(THEMES) as [FocusTheme, Palette][]}>
          {([id, t]) => {
            const on = () => focusState().theme === id;
            return (
              <button
                onClick={() => { if (!on()) toggleTheme(); }}
                style={{ flex: '1', padding: '14px', 'border-radius': '12px', background: t.bg, color: t.fg, border: `2px solid ${on() ? K.accent : K.hair}`, 'font-family': FONT, 'font-size': '11px', 'font-weight': '700', 'letter-spacing': '.18em' }}
              >
                {t.label.toUpperCase()}
              </button>
            );
          }}
        </For>
      </div>

      <div style={{ padding: '30px 0 6px', 'text-align': 'center', 'font-size': '10px', 'font-weight': '600', 'letter-spacing': '.18em', color: K.sub, 'line-height': '2' }}>
        NO ACCOUNTS · NO TRACKING · NO ADS<br />
        FOCUS TIMER — ADAPTED FROM TURN FOR CLARITY
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ overlay ---

export function FocusTimerOverlay(): JSX.Element {
  const [view, setView] = createSignal<'dial' | 'records' | 'settings'>('dial');
  const [mode, setMode] = createSignal<Mode>('focus');
  const [sel, setSel] = createSignal(0);
  const K = () => THEMES[focusState().theme];

  const title = () => (view() === 'records' ? 'RECORDS' : view() === 'settings' ? 'PRESETS' : 'TURN');

  return (
    <Show when={overlayOpen()}>
      <div
        data-testid="pomo-overlay"
        style={{
          position: 'fixed', inset: '0', 'z-index': '70', background: K().bg, color: K().fg,
          'font-family': FONT, display: 'flex', 'flex-direction': 'column', 'padding-top': SAFE_T,
          transition: 'background-color 220ms,color 220ms', overflow: 'hidden',
        }}
      >
        <Show
          when={!hasActiveSession()}
          fallback={<RunningView K={K()} />}
        >
          <TopBar
            K={K()}
            title={title()}
            view={view()}
            onBack={() => (view() === 'dial' ? setOverlayOpen(false) : setView('dial'))}
            onRecords={() => setView((v) => (v === 'records' ? 'dial' : 'records'))}
            onSettings={() => setView((v) => (v === 'settings' ? 'dial' : 'settings'))}
            onTheme={toggleTheme}
          />
          <Show when={view() === 'dial'}>
            <DialView K={K()} mode={mode()} setMode={setMode} sel={sel()} setSel={setSel} />
          </Show>
          <Show when={view() === 'records'}>
            <RecordsView K={K()} />
          </Show>
          <Show when={view() === 'settings'}>
            <SettingsView K={K()} />
          </Show>
        </Show>
      </div>
    </Show>
  );
}
