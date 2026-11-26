import { createSignal, For, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import type { EMQuadrant, Energy, SavedView, StageFilter, ViewFilter } from '../db/models';
import { QUADRANTS } from '../domain/eisenhower';
import { emptyFilter, STAGES } from '../domain/workflow';
import { Sheet, SheetTitle } from '../ui/Sheet';

/** Build a saved view (TaskNotes' saved Bases views, as a form): pick the
 *  conditions, how to group, and a name. */
export function ViewEditor(props: {
  initial?: SavedView;
  onSave: (title: string, filter: ViewFilter, groupBy: SavedView['groupBy']) => void;
  onClose: () => void;
}): JSX.Element {
  const tags = createLiveQuery(() => db.tags.toArray(), []);
  const projects = createLiveQuery(async () => (await db.projects.toArray()).filter((p) => p.trashedAt === null && p.status === 'open'), []);
  const areas = createLiveQuery(() => db.areas.toArray(), []);
  const [title, setTitle] = createSignal(props.initial?.title ?? '');
  const [f, setF] = createSignal<ViewFilter>(props.initial?.filter ?? emptyFilter());
  const [groupBy, setGroupBy] = createSignal<SavedView['groupBy']>(props.initial?.groupBy ?? 'home');
  const patch = (p: Partial<ViewFilter>) => setF({ ...f(), ...p });
  const toggleIn = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const chip = (on: boolean, label: string, onClick: () => void, testid?: string) => (
    <button
      data-testid={testid}
      aria-pressed={on}
      onClick={onClick}
      style={{
        padding: '5px 10px', 'border-radius': '999px', 'font-size': 'calc(13px * var(--ts))', 'font-weight': 'var(--fw-600)',
        background: on ? 'var(--blue)' : 'var(--bg-inset)', color: on ? 'var(--text-invert)' : 'var(--text)',
      }}
    >
      {label}
    </button>
  );
  const row = (label: string, body: JSX.Element) => (
    <div style={{ padding: '6px 0' }}>
      <div style={{ 'font-size': 'calc(12px * var(--ts))', 'font-weight': 'var(--fw-700)', color: 'var(--text-secondary)', 'padding-bottom': '5px' }}>{label}</div>
      <div style={{ display: 'flex', gap: '6px', 'flex-wrap': 'wrap' }}>{body}</div>
    </div>
  );
  const select = {
    padding: '8px 10px', 'border-radius': '10px', background: 'var(--bg-inset)', color: 'var(--text)', 'font-size': 'calc(15px * var(--ts))', border: 'none',
  } as const;

  return (
    <Sheet onClose={props.onClose}>
      <SheetTitle>{props.initial ? 'Edit View' : 'New View'}</SheetTitle>
      <div data-testid="view-editor" style={{ padding: '0 20px 16px', 'max-height': '75vh', 'overflow-y': 'auto' }}>
        <input
          data-testid="view-title"
          value={title()}
          onInput={(e) => setTitle(e.currentTarget.value)}
          placeholder="Name (e.g. Deep work, This week's deadlines)"
          style={{ ...select, width: '100%', 'margin-bottom': '6px' }}
        />
        {row('Tags (all of)', <For each={tags()}>{(t) => chip(f().tagIds.includes(t.id), `#${t.title}`, () => patch({ tagIds: toggleIn(f().tagIds, t.id) }), `view-tag-${t.title}`)}</For>)}
        {row('In', (
          <select data-testid="view-home" value={f().home ?? ''} onChange={(e) => patch({ home: e.currentTarget.value || null })} style={select}>
            <option value="">Anywhere</option>
            <For each={areas()}>{(a) => <option value={`a:${a.id}`}>Area: {a.title || 'Area'}</option>}</For>
            <For each={projects()}>{(p) => <option value={`p:${p.id}`}>Project: {p.title || 'Project'}</option>}</For>
          </select>
        ))}
        {row('Stage', <For each={STAGES}>{(s) => chip(f().stages.includes(s.id), s.label, () => patch({ stages: toggleIn<StageFilter>(f().stages, s.id) }), `view-stage-${s.id}`)}</For>)}
        {row('Priority', <For each={QUADRANTS}>{(q) => chip(f().quadrants.includes(q.id), q.label, () => patch({ quadrants: toggleIn<EMQuadrant>(f().quadrants, q.id) }))}</For>)}
        {row('Energy', <>{(['high', 'low'] as Energy[]).map((e) => chip(f().energy === e, e === 'high' ? 'High' : 'Low', () => patch({ energy: f().energy === e ? null : e })))}</>)}
        {row('Due', <>{[null, 0, 3, 7, 14].map((d) => chip(f().dueWithinDays === d, d === null ? 'Any' : d === 0 ? 'Today or late' : `Within ${d}d`, () => patch({ dueWithinDays: d }), `view-due-${d ?? 'any'}`))}</>)}
        {row('When', <>{(['any', 'today', 'scheduled', 'unscheduled', 'someday'] as ViewFilter['when'][]).map((w) => chip(f().when === w, w[0]!.toUpperCase() + w.slice(1), () => patch({ when: w }), `view-when-${w}`))}</>)}
        {row('Dependencies', chip(f().unblockedOnly, 'Not blocked only', () => patch({ unblockedOnly: !f().unblockedOnly }), 'view-unblocked'))}
        {row('Text contains', (
          <input value={f().search} onInput={(e) => patch({ search: e.currentTarget.value })} placeholder="any word in title or notes" style={{ ...select, flex: '1' }} />
        ))}
        {row('Group by', <>{(['home', 'stage', 'quadrant', 'when', 'none'] as SavedView['groupBy'][]).map((g) => chip(groupBy() === g, g === 'home' ? 'Project' : g === 'quadrant' ? 'Priority' : g[0]!.toUpperCase() + g.slice(1), () => setGroupBy(g)))}</>)}
        <button
          data-testid="view-save"
          onClick={() => {
            props.onSave(title(), f(), groupBy());
            props.onClose();
          }}
          style={{ width: '100%', 'margin-top': '10px', padding: '12px', 'border-radius': '12px', background: 'var(--blue)', color: '#fff', 'font-size': 'calc(16px * var(--ts))', 'font-weight': 'var(--fw-600)' }}
        >
          Save View
        </button>
      </div>
    </Sheet>
  );
}
