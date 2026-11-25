import { For, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { createProjectFromTemplate, deleteTemplate } from '../db/workflowMutations';
import { push } from '../app/navigation';
import { haptic } from '../app/motion';
import { Sheet, SheetTitle } from '../ui/Sheet';
import { Icon } from '../ui/Icon';

/** Start a project from a saved plan (a project's menu → Save as Template). */
export function TemplatesSheet(props: { onClose: () => void }): JSX.Element {
  const templates = createLiveQuery(async () => (await db.templates.toArray()).sort((a, b) => b.createdAt - a.createdAt), []);
  return (
    <Sheet onClose={props.onClose} dragAnywhere>
      <SheetTitle>Project from Template</SheetTitle>
      <div data-testid="templates-sheet" style={{ padding: '0 8px 12px' }}>
        <Show when={templates().length > 0} fallback={
          <div style={{ padding: '6px 12px 12px', 'font-size': '14px', color: 'var(--text-secondary)', 'line-height': '1.5' }}>
            No templates yet. Open a project you'd reuse (a build plan, a launch checklist), tap its ••• menu and choose
            <b> Save as Template</b>.
          </div>
        }>
          <For each={templates()}>
            {(t) => (
              <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', padding: '4px 12px' }}>
                <button
                  data-testid="template-use"
                  onClick={() => {
                    haptic('success');
                    props.onClose();
                    void createProjectFromTemplate(t.id).then((id) => id && push({ name: 'project', id }));
                  }}
                  style={{ flex: '1', 'text-align': 'left', padding: '8px 0' }}
                >
                  <div style={{ 'font-size': '16px', 'font-weight': '600' }}>{t.title || 'Untitled'}</div>
                  <div style={{ 'font-size': '12px', color: 'var(--text-tertiary)' }}>
                    {t.tasks.length} to-dos{t.headings.length ? ` · ${t.headings.length} headings` : ''}
                  </div>
                </button>
                <button aria-label="Delete template" onClick={() => void deleteTemplate(t.id)} style={{ color: 'var(--text-tertiary)', padding: '8px', display: 'flex' }}>
                  <Icon name="trash" size={17} />
                </button>
              </div>
            )}
          </For>
        </Show>
      </div>
    </Sheet>
  );
}
