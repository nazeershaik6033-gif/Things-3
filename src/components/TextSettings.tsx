import { For, Show, type JSX } from 'solid-js';
import { resetTextPrefs, textPrefs, updateTextPrefs } from '../app/textPrefs';
import {
  DEFAULT_TEXT, FONTS, LINE_SPACING, NOTES_SCALE_MAX, NOTES_SCALE_MIN, SCALE_MAX, SCALE_MIN, SCALE_STEP,
  percent, type FontId,
} from '../domain/textPrefs';

/** Settings → General → Text: font style, text size, Bold Text and line
 *  spacing for the app, and a font and size of their own for notes. A live
 *  preview at the top shows a to-do row and a note as they will look. */

const label: JSX.CSSProperties = {
  'font-size': 'calc(15px * var(--ts))',
  color: 'var(--text)',
};
const hint: JSX.CSSProperties = {
  'font-size': 'calc(12px * var(--ts))',
  color: 'var(--text-tertiary)',
};
const row: JSX.CSSProperties = {
  padding: '10px 0',
  'border-top': '1px solid var(--separator)',
};

function FontChips(props: {
  value: FontId | null;
  onPick: (id: FontId | null) => void;
  /** Offer "Same as app" first (notes). */
  withSame?: boolean;
  testid: string;
}): JSX.Element {
  const chip = (id: FontId | null, text: string, family: string) => {
    const on = () => props.value === id;
    return (
      <button
        role="radio"
        aria-checked={on()}
        data-testid={`${props.testid}-${id ?? 'same'}`}
        class="pressable"
        onClick={() => props.onPick(id)}
        style={{
          flex: '1 1 0',
          'min-width': '0',
          display: 'flex',
          'flex-direction': 'column',
          'align-items': 'center',
          gap: '2px',
          padding: '8px 2px 7px',
          'border-radius': '10px',
          background: on() ? 'var(--blue)' : 'var(--bg-list)',
          color: on() ? '#fff' : 'var(--text)',
        }}
      >
        <span style={{ 'font-family': family, 'font-size': '20px', 'font-weight': 'var(--fw-500)', 'line-height': '1.1' }}>Aa</span>
        <span style={{ 'font-size': '11px', 'font-weight': on() ? 'var(--fw-600)' : 'var(--fw-400)', opacity: on() ? '1' : '0.75', 'white-space': 'nowrap' }}>
          {text}
        </span>
      </button>
    );
  };
  return (
    <div role="radiogroup" style={{ display: 'flex', gap: '5px' }}>
      <Show when={props.withSame}>{chip(null, 'Same', 'var(--font)')}</Show>
      <For each={FONTS}>{(f) => chip(f.id, f.label, f.stack)}</For>
    </div>
  );
}

function SizeSlider(props: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  testid: string;
  name: string;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
      <span aria-hidden="true" style={{ 'font-size': '13px', color: 'var(--text-secondary)' }}>A</span>
      <input
        type="range"
        aria-label={props.name}
        data-testid={props.testid}
        min={props.min}
        max={props.max}
        step={SCALE_STEP}
        value={props.value}
        onInput={(e) => props.onChange(Number(e.currentTarget.value))}
        style={{ flex: '1', 'accent-color': 'var(--blue)', height: '28px' }}
      />
      <span aria-hidden="true" style={{ 'font-size': '21px', color: 'var(--text-secondary)' }}>A</span>
      <span
        data-testid={`${props.testid}-value`}
        style={{ width: '44px', 'text-align': 'right', 'font-size': '14px', 'font-variant-numeric': 'tabular-nums', color: 'var(--text-secondary)' }}
      >
        {percent(props.value)}
      </span>
    </div>
  );
}

export function TextSettings(): JSX.Element {
  const p = textPrefs;
  const isDefault = () => JSON.stringify(p()) === JSON.stringify(DEFAULT_TEXT);

  return (
    <div>
      {/* Live preview: a to-do row in the app's text, and a note in the notes' text */}
      <div
        data-testid="text-preview"
        style={{ margin: '10px 0', padding: '12px 14px', 'border-radius': '12px', background: 'var(--bg-list)', border: '1px solid var(--separator)' }}
      >
        <div style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
          <span style={{ width: '18px', height: '18px', 'border-radius': '5px', border: '1.5px solid var(--check-border)', flex: 'none' }} />
          <span style={{ flex: '1', 'font-size': 'calc(17px * var(--ts))', 'line-height': 'calc(1.3 * var(--lh))' }}>Plan the week ahead</span>
          <span style={{ 'font-size': 'calc(12px * var(--ts))', 'font-weight': 'var(--fw-600)', color: 'var(--red)' }}>Fri</span>
        </div>
        <div
          class="notes-type"
          style={{
            margin: '8px 0 0 28px', 'font-size': 'calc(15px * var(--ts))', 'line-height': 'calc(1.45 * var(--lh))',
            color: 'var(--text-secondary)',
          }}
        >
          Notes read like this: pick the three things that would make the week a success.
        </div>
      </div>

      <div style={row}>
        <div style={{ ...label, 'padding-bottom': '8px' }}>Font</div>
        <FontChips testid="font" value={p().font} onPick={(id) => void updateTextPrefs({ font: id ?? 'system' })} />
      </div>

      <div style={row}>
        <div style={{ ...label, 'padding-bottom': '4px' }}>Text size</div>
        <SizeSlider
          name="Text size"
          testid="text-size"
          value={p().scale}
          min={SCALE_MIN}
          max={SCALE_MAX}
          onChange={(v) => void updateTextPrefs({ scale: v })}
        />
      </div>

      <button
        data-testid="toggle-bold-text"
        aria-pressed={p().bold}
        onClick={() => void updateTextPrefs({ bold: !p().bold })}
        style={{ ...row, display: 'flex', 'align-items': 'center', gap: '12px', width: '100%', 'text-align': 'left' }}
      >
        <span style={{ ...label, flex: '1' }}>Bold text</span>
        <span
          style={{
            width: '46px', height: '28px', 'border-radius': '999px', position: 'relative', flex: 'none',
            background: p().bold ? 'var(--green)' : 'var(--check-border)', transition: 'background 160ms ease',
          }}
        >
          <span
            style={{
              position: 'absolute', top: '2px', left: p().bold ? '20px' : '2px', width: '24px', height: '24px',
              'border-radius': '50%', background: '#fff', 'box-shadow': '0 1px 3px rgba(0,0,0,0.25)', transition: 'left 160ms ease',
            }}
          />
        </span>
      </button>

      <div style={row}>
        <div style={{ ...label, 'padding-bottom': '8px' }}>Line spacing</div>
        <div role="radiogroup" aria-label="Line spacing" style={{ display: 'flex', gap: '4px', padding: '3px', 'border-radius': '10px', background: 'var(--bg-list)' }}>
          <For each={LINE_SPACING}>
            {(l) => (
              <button
                role="radio"
                aria-checked={p().lines === l.id}
                data-testid={`lines-${l.id}`}
                onClick={() => void updateTextPrefs({ lines: l.id })}
                style={{
                  flex: '1', padding: '7px 0', 'border-radius': '8px', 'font-size': '14px',
                  'font-weight': p().lines === l.id ? 'var(--fw-600)' : 'var(--fw-400)',
                  background: p().lines === l.id ? 'var(--blue)' : 'transparent',
                  color: p().lines === l.id ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {l.label}
              </button>
            )}
          </For>
        </div>
      </div>

      <div style={row}>
        <div style={{ ...label, 'padding-bottom': '2px' }}>Notes</div>
        <div style={{ ...hint, 'padding-bottom': '8px' }}>To-do and project notes, the Daily Note and card descriptions.</div>
        <FontChips
          testid="notes-font"
          withSame
          value={p().notesFont}
          onPick={(id) => void updateTextPrefs({ notesFont: id })}
        />
        <div style={{ 'padding-top': '8px' }}>
          <SizeSlider
            name="Notes text size"
            testid="notes-size"
            value={p().notesScale}
            min={NOTES_SCALE_MIN}
            max={NOTES_SCALE_MAX}
            onChange={(v) => void updateTextPrefs({ notesScale: v })}
          />
        </div>
      </div>

      <Show when={!isDefault()}>
        <div style={{ ...row, display: 'flex', 'justify-content': 'flex-end' }}>
          <button
            data-testid="text-reset"
            onClick={() => void resetTextPrefs()}
            style={{ 'font-size': '14px', color: 'var(--blue)', 'font-weight': 'var(--fw-600)' }}
          >
            Reset text settings
          </button>
        </div>
      </Show>
    </div>
  );
}
