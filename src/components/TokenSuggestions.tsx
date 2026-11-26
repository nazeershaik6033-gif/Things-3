import { createMemo, For, Show, type JSX } from 'solid-js';
import type { Project, Tag } from '../db/models';

/** Autocomplete for Quick Entry's short syntax (TaskNotes-style): while the
 *  word being typed starts with # or +, matching tags or projects appear as
 *  chips; a tap completes the word. Buttons keep focus in the text field so
 *  the iOS keyboard stays up. */
export function TokenSuggestions(props: {
  title: string;
  tags: Tag[];
  projects: Project[];
  onPick: (title: string) => void;
}): JSX.Element {
  const current = createMemo(() => {
    const m = /(^|\s)([#+])([^\s#+]*)$/u.exec(props.title);
    return m ? { sigil: m[2]!, query: m[3]!.toLowerCase(), at: props.title.length - m[3]!.length - 1 } : null;
  });
  const items = createMemo(() => {
    const c = current();
    if (!c) return [];
    const pool = c.sigil === '#'
      ? props.tags.map((t) => t.title)
      : props.projects.filter((p) => p.trashedAt === null && p.status === 'open' && p.title).map((p) => p.title);
    return pool
      .filter((t) => t.toLowerCase().replace(/\s+/g, '').startsWith(c.query.replace(/\s+/g, '')) && t.toLowerCase() !== c.query)
      .slice(0, 6);
  });
  const pick = (name: string) => {
    const c = current()!;
    // Projects with spaces are matched by prefix, so the squashed name works
    const token = c.sigil === '#' ? name.replace(/\s+/g, '-') : name.replace(/\s+/g, '');
    props.onPick(`${props.title.slice(0, c.at)}${c.sigil}${token} `);
  };
  return (
    <Show when={items().length > 0}>
      <div data-testid="token-suggestions" style={{ display: 'flex', gap: '6px', 'flex-wrap': 'wrap', padding: '0 0 8px' }}>
        <For each={items()}>
          {(name) => (
            <button
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(name)}
              style={{
                padding: '4px 10px', 'border-radius': '999px', 'font-size': 'calc(13px * var(--ts))', 'font-weight': 'var(--fw-600)',
                background: 'color-mix(in srgb, var(--blue) 12%, transparent)', color: 'var(--blue)',
              }}
            >
              {current()?.sigil}{name}
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}
