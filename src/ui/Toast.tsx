import { Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { toast } from '../app/focusState';

export function Toast(): JSX.Element {
  return (
    <Show when={toast()}>
      <Portal>
        <div
          role="status"
          data-testid="toast"
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 'calc(var(--safe-bottom) + 96px)',
            transform: 'translateX(-50%)',
            'z-index': '120',
            'max-width': 'calc(100% - 40px)',
            padding: '10px 16px',
            'border-radius': '14px',
            background: 'var(--text)',
            color: 'var(--bg)',
            'font-size': '14px',
            'font-weight': '500',
            'text-align': 'center',
            'box-shadow': 'var(--shadow-card)',
            animation: 'fade-in 160ms ease-out',
            'pointer-events': 'none',
          }}
        >
          {toast()}
        </div>
      </Portal>
    </Show>
  );
}
