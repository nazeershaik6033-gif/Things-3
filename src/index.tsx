import { render } from 'solid-js/web';
import { registerSW } from 'virtual:pwa-register';
import './styles/tokens.css';
import './styles/base.css';
import { App } from './app/App';
import { hasExistingData, seedDemoData } from './app/seed';

registerSW({ immediate: true });

/** iOS only applies `:active` styles to non-anchor elements once the document
 *  carries a touch listener. Without this, every button and row in a standalone
 *  PWA feels dead on press. */
function attachActiveStateFix(): void {
  document.addEventListener('touchstart', () => {}, { passive: true });
}

function hideSplash(): void {
  const splash = document.getElementById('splash');
  if (!splash) return;
  splash.style.opacity = '0';
  setTimeout(() => splash.remove(), 350);
}

/** Only these exact hashes load the demo data. A substring match would fire on
 *  any route that merely contains the word — e.g. `#/project/<id>` where the
 *  generated id happens to contain "seed" — and silently destroy real data. */
const SEED_HASHES = new Set(['#seed', '#/seed']);

/** Load the demo dataset, but never lose someone's to-dos doing it.
 *  The trigger is stripped from the URL *before* any write and the history
 *  entry is replaced, so a later reload or tab restore can't re-fire it. */
async function maybeSeed(): Promise<void> {
  if (!SEED_HASHES.has(location.hash)) return;
  history.replaceState(null, '', `${location.pathname}${location.search}#/`);
  if (await hasExistingData()) {
    const ok = window.confirm(
      'Replace everything in this app with the demo data?\n\n' +
        'Your to-dos, projects and Logbook will be permanently deleted.',
    );
    if (!ok) return;
  }
  await seedDemoData();
}

async function start(): Promise<void> {
  try {
    await maybeSeed();
    attachActiveStateFix();
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
