import { Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { hideToast, toast, toastAction } from '../app/focusState';

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
            padding: toastAction() ? '6px 6px 6px 16px' : '10px 16px',
            'border-radius': '14px',
            background: 'var(--text)',
            color: 'var(--bg)',
            'font-size': 'calc(14px * var(--ts))',
            'font-weight': 'var(--fw-500)',
            'text-align': 'center',
            'box-shadow': 'var(--shadow-card)',
            animation: 'fade-in 160ms ease-out',
            // Only an actionable toast takes taps; a plain one never blocks
            // whatever is underneath it.
            'pointer-events': toastAction() ? 'auto' : 'none',
            display: 'flex',
            'align-items': 'center',
            gap: '12px',
          }}
        >
          <span data-testid="toast-text">{toast()}</span>
          <Show when={toastAction()}>
            <button
              data-testid="toast-action"
              onClick={() => {
                const a = toastAction();
                hideToast();
                a?.run();
              }}
              style={{
                padding: '6px 12px',
                'border-radius': '10px',
                background: 'color-mix(in srgb, var(--bg) 16%, transparent)',
                color: 'var(--yellow)',
                'font-size': 'calc(14px * var(--ts))',
                'font-weight': 'var(--fw-700)',
              }}
            >
              {toastAction()!.label}
            </button>
          </Show>
        </div>
      </Portal>
    </Show>
  );
}
