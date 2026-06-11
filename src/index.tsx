import { render } from 'solid-js/web';
import { registerSW } from 'virtual:pwa-register';
import './styles/tokens.css';
import './styles/base.css';
import { App } from './app/App';
import { seedDemoData } from './app/seed';

registerSW({ immediate: true });

async function start(): Promise<void> {
  // `#seed` in the URL loads demo data (used by e2e tests + previews)
  if (location.hash.includes('seed')) {
    await seedDemoData();
    location.hash = '#/';
  }
  render(() => <App />, document.getElementById('root')!);
}

void start();
