import { createSpring, Spring, SPRING } from './springs';

/** FLIP helpers: measure before a DOM change, then animate the visual delta
 *  back to zero with transforms only — the layout itself never animates. */

const flipSprings = new WeakMap<HTMLElement, Spring>();

export function captureRects(els: Iterable<HTMLElement>): Map<HTMLElement, DOMRect> {
  const map = new Map<HTMLElement, DOMRect>();
  for (const el of els) map.set(el, el.getBoundingClientRect());
  return map;
}

/** After the DOM change, slide each element from its old position to its new
 *  one. Elements not in `before` (newly inserted) are left alone. */
export function flipMove(before: Map<HTMLElement, DOMRect>): void {
  // Read phase: all rects first (no interleaved writes → no layout thrash)
  const deltas: [HTMLElement, number][] = [];
  for (const [el, rect] of before) {
    if (!el.isConnected) continue;
    const now = el.getBoundingClientRect();
    const dy = rect.top - now.top;
    if (Math.abs(dy) > 0.5) deltas.push([el, dy]);
  }
  // Write phase
  for (const [el, dy] of deltas) {
    let spring = flipSprings.get(el);
    if (!spring) {
      spring = createSpring(0, (v) => {
        el.style.transform = v === 0 ? '' : `translate3d(0, ${v}px, 0)`;
      }, SPRING.flip);
      flipSprings.set(el, spring);
    }
    spring.set(spring.value + dy);
    spring.to(0);
  }
}

/** Animate one element's transform Y from `from` to 0 (used for insertions). */
export function flipIn(el: HTMLElement, from: number): void {
  const spring = createSpring(from, (v) => {
    el.style.transform = v === 0 ? '' : `translate3d(0, ${v}px, 0)`;
  }, SPRING.flip);
  el.style.transform = `translate3d(0, ${from}px, 0)`;
  spring.to(0);
}
