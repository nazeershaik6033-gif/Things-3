import { createSignal } from 'solid-js';
import { createSpring, SPRING } from '../gestures/springs';
import { release, tryClaim } from '../gestures/arbiter';

/** Custom navigation stack: screens stay mounted during iOS-style push/pop
 *  slides, and the left-edge swipe scrubs the same spring the buttons use.
 *  Hash URLs keep GitHub Pages + browser/PWA back behavior consistent. */

export type BuiltinList =
  | 'inbox' | 'today' | 'upcoming' | 'anytime' | 'someday' | 'logbook' | 'trash';

export type Route =
  | { name: 'home' }
  | { name: 'list'; list: BuiltinList }
  | { name: 'project'; id: string }
  | { name: 'area'; id: string }
  | { name: 'tag'; id: string }
  | { name: 'calendar' }
  | { name: 'settings' };

export interface StackEntry {
  route: Route;
  key: number;
}

const BUILTINS: BuiltinList[] = ['inbox', 'today', 'upcoming', 'anytime', 'someday', 'logbook', 'trash'];

export function hashFor(route: Route): string {
  switch (route.name) {
    case 'home': return '#/';
    case 'list': return `#/${route.list}`;
    case 'project': return `#/project/${route.id}`;
    case 'area': return `#/area/${route.id}`;
    case 'tag': return `#/tag/${route.id}`;
    case 'calendar': return '#/calendar';
    case 'settings': return '#/settings';
  }
}

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const head = parts[0];
  if (!head) return { name: 'home' };
  if ((BUILTINS as string[]).includes(head)) return { name: 'list', list: head as BuiltinList };
  if (head === 'calendar') return { name: 'calendar' };
  if (head === 'settings') return { name: 'settings' };
  if (head === 'project' && parts[1]) return { name: 'project', id: parts[1] };
  if (head === 'area' && parts[1]) return { name: 'area', id: parts[1] };
  if (head === 'tag' && parts[1]) return { name: 'tag', id: parts[1] };
  return { name: 'home' };
}

let nextKey = 1;

function initialStack(): StackEntry[] {
  const route = parseHash(location.hash);
  const stack: StackEntry[] = [{ route: { name: 'home' }, key: nextKey++ }];
  if (route.name !== 'home') stack.push({ route, key: nextKey++ });
  return stack;
}

const [stack, setStack] = createSignal<StackEntry[]>(initialStack());
export { stack };

export function topRoute(): Route {
  const s = stack();
  return s[s.length - 1]!.route;
}

/** Wrapper elements register themselves so navigation can animate them. */
const screenEls = new Map<number, HTMLElement>();

export function registerScreen(key: number, el: HTMLElement): void {
  screenEls.set(key, el);
}

export function unregisterScreen(key: number): void {
  screenEls.delete(key);
}

let transitioning = false;
/** Set when an edge-swipe already moved the screen off; popstate then skips animation. */
let pendingGesturePop = false;
/** Set while we adjust history ourselves (replaceState etc.). */
let suppressPopstate = false;

const PARALLAX = 0.3;

function screenWidth(): number {
  return window.innerWidth;
}

function setX(el: HTMLElement | undefined, x: number): void {
  if (el) el.style.transform = x === 0 ? '' : `translate3d(${x}px, 0, 0)`;
}

function animate(
  from: number,
  to: number,
  apply: (v: number) => void,
  onRest: () => void,
  velocity = 0,
): void {
  const spring = createSpring(from, apply, SPRING.nav);
  spring.to(to, { velocity, onRest });
}

export function push(route: Route): void {
  if (transitioning) return;
  const entry: StackEntry = { route, key: nextKey++ };
  const prev = stack()[stack().length - 1];
  transitioning = true;
  setStack((s) => [...s, entry]);
  history.pushState(null, '', hashFor(route));

  requestAnimationFrame(() => {
    const el = screenEls.get(entry.key);
    const prevEl = prev ? screenEls.get(prev.key) : undefined;
    const w = screenWidth();
    if (!el) {
      transitioning = false;
      return;
    }
    el.style.boxShadow = '0 0 24px rgba(0,0,0,0.18)';
    setX(el, w);
    animate(w, 0, (v) => {
      setX(el, v);
      setX(prevEl, -PARALLAX * (w - v));
    }, () => {
      el.style.boxShadow = '';
      setX(prevEl, 0);
      transitioning = false;
    });
  });
}

export function back(): void {
  if (transitioning || stack().length < 2) return;
  history.back();
}

/** Pop the top entry with (or without) animation. Called from popstate only. */
function performPop(animated: boolean, fromX?: number, velocity?: number): void {
  const s = stack();
  if (s.length < 2) return;
  const top = s[s.length - 1]!;
  const under = s[s.length - 2]!;
  const el = screenEls.get(top.key);
  const underEl = screenEls.get(under.key);
  const w = screenWidth();

  if (!animated || !el) {
    setX(underEl, 0);
    setStack((x) => x.slice(0, -1));
    return;
  }
  transitioning = true;
  el.style.boxShadow = '0 0 24px rgba(0,0,0,0.18)';
  const start = fromX ?? 0;
  setX(underEl, -PARALLAX * (w - start));
  animate(start, w, (v) => {
    setX(el, v);
    setX(underEl, -PARALLAX * (w - v));
  }, () => {
    setX(underEl, 0);
    setStack((x) => x.slice(0, -1));
    transitioning = false;
  }, velocity);
}

export function startNavigation(): void {
  window.addEventListener('popstate', () => {
    if (suppressPopstate) {
      suppressPopstate = false;
      return;
    }
    const route = parseHash(location.hash);
    const s = stack();
    const under = s[s.length - 2];
    if (under && hashFor(under.route) === hashFor(route)) {
      // Normal back: pop with animation (or instantly after an edge swipe)
      const gesture = pendingGesturePop;
      pendingGesturePop = false;
      performPop(!gesture);
    } else if (hashFor(topRoute()) !== hashFor(route)) {
      // Forward button / manual hash edit: rebuild without animation
      const fresh: StackEntry[] = [{ route: { name: 'home' }, key: nextKey++ }];
      if (route.name !== 'home') fresh.push({ route, key: nextKey++ });
      setStack(fresh);
    }
  });

  // Make sure the address bar reflects the initial stack
  const want = hashFor(topRoute());
  if (location.hash !== want && !(want === '#/' && location.hash === '')) {
    suppressPopstate = true;
    history.replaceState(null, '', want);
  }
}

/** Edge-swipe-back scrubbing, driven by App's pan recognizer. */
export const edgeBack = {
  canStart(): boolean {
    return !transitioning && stack().length >= 2 && tryClaim('edge-back');
  },
  move(dx: number): void {
    const s = stack();
    const top = s[s.length - 1]!;
    const under = s[s.length - 2]!;
    const el = screenEls.get(top.key);
    const underEl = screenEls.get(under.key);
    const x = Math.max(0, dx);
    if (el) el.style.boxShadow = '0 0 24px rgba(0,0,0,0.18)';
    setX(el, x);
    setX(underEl, -PARALLAX * (screenWidth() - x));
  },
  end(dx: number, vx: number): void {
    release('edge-back');
    const s = stack();
    const top = s[s.length - 1]!;
    const el = screenEls.get(top.key);
    const w = screenWidth();
    const x = Math.max(0, dx);
    const shouldPop = vx > 500 || (x > w * 0.35 && vx > -200);
    if (!shouldPop) {
      const under = s[s.length - 2]!;
      const underEl = screenEls.get(under.key);
      transitioning = true;
      animate(x, 0, (v) => {
        setX(el, v);
        setX(underEl, -PARALLAX * (w - v));
      }, () => {
        if (el) el.style.boxShadow = '';
        transitioning = false;
      }, vx);
      return;
    }
    // Finish the slide, then let history drive the actual pop
    transitioning = true;
    const under = s[s.length - 2]!;
    const underEl = screenEls.get(under.key);
    animate(x, w, (v) => {
      setX(el, v);
      setX(underEl, -PARALLAX * (w - v));
    }, () => {
      transitioning = false;
      pendingGesturePop = true;
      history.back();
    }, vx);
  },
};
