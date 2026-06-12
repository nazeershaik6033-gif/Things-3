import { render } from 'solid-js/web';
import { registerSW } from 'virtual:pwa-register';
import './styles/tokens.css';
import './styles/base.css';
import { App } from './app/App';
import { seedDemoData } from './app/seed';

registerSW({ immediate: true });

function hideSplash(): void {
  const splash = document.getElementById('splash');
  if (!splash) return;
  splash.style.opacity = '0';
  setTimeout(() => splash.remove(), 350);
}

async function start(): Promise<void> {
  try {
    if (location.hash.includes('seed')) {
      await seedDemoData();
      location.hash = '#/';
    }
    render(() => <App />, document.getElementById('root')!);
    // Mark the app as started so the global error handler backs off
    (window as Window & { __appStarted?: boolean }).__appStarted = true;
    // Successful boot: re-arm the one-shot auto-recovery in index.html
    try {
      sessionStorage.removeItem('clarity-recovered');
    } catch {
      /* private mode */
    }
    hideSplash();
  } catch (err) {
    const e = err as Error;
    const errEl = document.getElementById('err');
    const msgEl = document.getElementById('err-msg');
    const stackEl = document.getElementById('err-stack');
    if (errEl) errEl.style.display = 'block';
    if (msgEl) msgEl.textContent = e?.message ?? String(err);
    if (stackEl) stackEl.textContent = e?.stack ?? '';
  }
}

void start();
