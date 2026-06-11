import { createSignal, onMount, Show, type JSX } from 'solid-js';
import { getSetting, setSetting } from '../db/mutations';
import { Icon } from '../ui/Icon';

declare global {
  interface Navigator {
    standalone?: boolean;
  }
}

/** iOS has no install prompt API: show a one-time hint to Add to Home Screen
 *  when running in the browser tab (not standalone). */
export function InstallCoachMark(): JSX.Element {
  const [show, setShow] = createSignal(false);

  onMount(async () => {
    if (navigator.webdriver) return; // never during automated tests
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (standalone) return;
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (!isIOS) return;
    const dismissed = await getSetting('installHintDismissed', false);
    if (!dismissed) setShow(true);
  });

  const dismiss = () => {
    setShow(false);
    void setSetting('installHintDismissed', true);
  };

  return (
    <Show when={show()}>
      <div
        style={{
          position: 'fixed',
          left: '12px',
          right: '12px',
          bottom: `calc(14px + var(--safe-bottom))`,
          'z-index': '95',
          background: 'var(--bg-elevated)',
          'border-radius': '14px',
          'box-shadow': 'var(--shadow-card)',
          padding: '14px 16px',
          display: 'flex',
          gap: '12px',
          'align-items': 'flex-start',
        }}
      >
        <Icon name="export" size={22} color="var(--blue)" />
        <div style={{ flex: '1', 'font-size': '14px', 'line-height': '1.5' }}>
          <strong>Install Clarity:</strong> tap the Share button in Safari, then{' '}
          <strong>Add to Home Screen</strong>. You’ll get the full-screen app, offline support,
          and protected storage.
        </div>
        <button onClick={dismiss} aria-label="Dismiss" style={{ color: 'var(--text-tertiary)', display: 'flex' }}>
          <Icon name="close" size={18} />
        </button>
      </div>
    </Show>
  );
}
