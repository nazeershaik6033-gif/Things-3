import { createSignal, onCleanup, type Accessor } from 'solid-js';

export interface Viewport {
  /** Height of the area not covered by the software keyboard. */
  height: number;
  /** How far the visual viewport has been scrolled down inside the layout one. */
  offsetTop: number;
  /** Pixels of the layout viewport occluded from the bottom (keyboard height). */
  inset: number;
}

/** Live visual-viewport metrics.
 *
 *  In a standalone iOS PWA the software keyboard shrinks the *visual* viewport
 *  while `position: fixed` elements stay pinned to the unchanged *layout*
 *  viewport — so a full-screen editor renders half of itself behind the
 *  keyboard unless it sizes and offsets itself from these numbers. */
export function createViewport(): Accessor<Viewport> {
  const measure = (): Viewport => {
    const vv = window.visualViewport;
    if (!vv) return { height: window.innerHeight, offsetTop: 0, inset: 0 };
    return {
      height: vv.height,
      offsetTop: vv.offsetTop,
      inset: Math.max(0, window.innerHeight - vv.height - vv.offsetTop),
    };
  };

  const [viewport, setViewport] = createSignal<Viewport>(measure());
  const vv = window.visualViewport;
  if (!vv) return viewport;

  const update = () => setViewport(measure());
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  window.addEventListener('orientationchange', update);
  onCleanup(() => {
    vv.removeEventListener('resize', update);
    vv.removeEventListener('scroll', update);
    window.removeEventListener('orientationchange', update);
  });
  return viewport;
}
