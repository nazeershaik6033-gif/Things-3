import { For, type JSX, Match, Switch } from 'solid-js';
import { parseMarkdown, type Block, type Inline } from '../domain/markdown';

function InlineView(props: { nodes: Inline[] }): JSX.Element {
  return (
    <For each={props.nodes}>
      {(node) => (
        <Switch>
          <Match when={node.type === 'text'}>{(node as { text: string }).text}</Match>
          <Match when={node.type === 'bold'}>
            <strong><InlineView nodes={(node as { children: Inline[] }).children} /></strong>
          </Match>
          <Match when={node.type === 'italic'}>
            <em><InlineView nodes={(node as { children: Inline[] }).children} /></em>
          </Match>
        </Switch>
      )}
    </For>
  );
}

/** Renders note markdown as real elements (never HTML strings). */
export function MarkdownView(props: { source: string }): JSX.Element {
  const blocks = (): Block[] => parseMarkdown(props.source);
  return (
    <div style={{ 'font-size': '15px', 'line-height': '1.45', color: 'var(--text)' }}>
      <For each={blocks()}>
        {(block) => (
          <Switch>
            <Match when={block.type === 'p'}>
              <p style={{ 'min-height': '1.2em', margin: '0' }}>
                <InlineView nodes={(block as { children: Inline[] }).children} />
              </p>
            </Match>
            <Match when={block.type === 'ul'}>
              <ul style={{ margin: '2px 0', 'padding-left': '4px' }}>
                <For each={(block as { items: Inline[][] }).items}>
                  {(item) => (
                    <li style={{ display: 'flex', gap: '8px' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>•</span>
                      <span><InlineView nodes={item} /></span>
                    </li>
                  )}
                </For>
              </ul>
            </Match>
            <Match when={block.type === 'ol'}>
              <ol style={{ margin: '2px 0', 'padding-left': '4px' }}>
                <For each={(block as { start: number; items: Inline[][] }).items}>
                  {(item, i) => (
                    <li style={{ display: 'flex', gap: '8px' }}>
                      <span style={{ color: 'var(--text-secondary)', 'min-width': '14px' }}>
                        {(block as { start: number }).start + i()}.
                      </span>
                      <span><InlineView nodes={item} /></span>
                    </li>
                  )}
                </For>
              </ol>
            </Match>
          </Switch>
        )}
      </For>
    </div>
  );
}
