/** Pointer-event pan recognizer with axis locking and velocity tracking.
 *  CSS `touch-action` on the element decides what the browser keeps (we use
 *  pan-y on lists so vertical scroll stays native); once we recognize a pan
 *  we also block touchmove scrolling for the rest of the gesture. */

export interface PanOpts {
  axis?: 'x' | 'y' | 'any';
  slop?: number;
  /** Only start when the pointer goes down within this many px of the left edge. */
  leftEdge?: number;
  canStart?: (e: PointerEvent) => boolean;
  onStart: (e: PointerEvent) => void;
  onMove: (dx: number, dy: number, e: PointerEvent) => void;
  onEnd: (vx: number, vy: number, dx: number, dy: number) => void;
  onCancel?: () => void;
}

interface Sample {
  t: number;
  x: number;
  y: number;
}

export function createPan(el: HTMLElement, opts: PanOpts): () => void {
  const axis = opts.axis ?? 'any';
  const slop = opts.slop ?? 8;

  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let recognized = false;
  let samples: Sample[] = [];

  const blockScroll = (e: TouchEvent) => {
    if (recognized && e.cancelable) e.preventDefault();
  };

  function reset(): void {
    pointerId = null;
    recognized = false;
    samples = [];
    document.removeEventListener('touchmove', blockScroll);
  }

  function velocity(): { vx: number; vy: number } {
    // Average over the last ~80ms of movement
    const now = performance.now();
    const recent = samples.filter((s) => now - s.t < 80);
    if (recent.length < 2) return { vx: 0, vy: 0 };
    const a = recent[0]!;
    const b = recent[recent.length - 1]!;
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) return { vx: 0, vy: 0 };
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
  }

  function onDown(e: PointerEvent): void {
    if (pointerId !== null) return;
    if (!e.isPrimary) return;
    if (opts.leftEdge !== undefined && e.clientX > opts.leftEdge) return;
    if (opts.canStart && !opts.canStart(e)) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    recognized = false;
    samples = [{ t: performance.now(), x: e.clientX, y: e.clientY }];
  }

  function onMove(e: PointerEvent): void {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    samples.push({ t: performance.now(), x: e.clientX, y: e.clientY });
    if (samples.length > 12) samples.shift();

    if (!recognized) {
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      if (adx < slop && ady < slop) return;
      // Axis lock: cede to native scroll when movement is off-axis
      if (axis === 'x' && ady > adx) return reset();
      if (axis === 'y' && adx > ady) return reset();
      recognized = true;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* capture can fail if the pointer is already gone */
      }
      document.addEventListener('touchmove', blockScroll, { passive: false });
      opts.onStart(e);
    }
    opts.onMove(dx, dy, e);
  }

  function onUp(e: PointerEvent): void {
    if (e.pointerId !== pointerId) return;
    const was = recognized;
    const { vx, vy } = velocity();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    reset();
    if (was) opts.onEnd(vx, vy, dx, dy);
  }

  function onCancel(e: PointerEvent): void {
    if (e.pointerId !== pointerId) return;
    const was = recognized;
    reset();
    if (was) (opts.onCancel ?? (() => opts.onEnd(0, 0, 0, 0)))();
  }

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);

  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('touchmove', blockScroll);
  };
}
