import { motionLevel, haptic } from './motion';

/** A short burst of confetti for finishing something that took the whole day:
 *  every habit ticked, the Daily Target hit, the day finished. Only on the
 *  "rich" motion level. Pieces are plain divs animated by CSS (.confetti in
 *  base.css), transform/opacity only, and remove themselves.
 *
 *  `key` names the moment, so the same moment never celebrates twice in one
 *  session (unticking and re-ticking the last habit doesn't re-fire). */

const COLORS = ['#2f7cf6', '#f7ce46', '#ff3b30', '#53b855', '#b678e0', '#4cc2e8', '#ff9500'];
const celebrated = new Set<string>();

export function celebrate(key: string, pieces = 70): boolean {
  if (celebrated.has(key)) return false;
  celebrated.add(key);
  if (motionLevel() !== 'rich' || typeof document === 'undefined') return false;
  haptic('success');
  const frag = document.createDocumentFragment();
  const nodes: HTMLElement[] = [];
  let longest = 0;
  for (let k = 0; k < pieces; k++) {
    const el = document.createElement('div');
    el.className = 'confetti';
    el.setAttribute('aria-hidden', 'true');
    const duration = 1.3 + Math.random() * 1.2;
    const delay = Math.random() * 0.25;
    longest = Math.max(longest, duration + delay);
    el.style.left = `${Math.random() * 100}vw`;
    el.style.background = COLORS[k % COLORS.length]!;
    el.style.animationDuration = `${duration}s`;
    el.style.animationDelay = `${delay}s`;
    el.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`);
    el.style.setProperty('--rot', `${(Math.random() - 0.5) * 1440}deg`);
    if (k % 3 === 0) el.style.borderRadius = '50%';
    nodes.push(el);
    frag.appendChild(el);
  }
  document.body.appendChild(frag);
  setTimeout(() => nodes.forEach((n) => n.remove()), longest * 1000 + 200);
  return true;
}

/** For tests: forget which moments were celebrated. */
export function resetCelebrations(): void {
  celebrated.clear();
}
