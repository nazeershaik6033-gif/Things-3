/** Tiny interruptible spring engine. One shared rAF loop steps every active
 *  spring; values are timestamp-based so motion is identical at 60 and 120Hz.
 *  Gestures hand off their release velocity for seamless fling-to-settle. */

export interface SpringOpts {
  stiffness?: number;
  damping?: number;
  restDelta?: number;
  restSpeed?: number;
}

const activeSprings = new Set<Spring>();
let rafId = 0;
let lastT = 0;

function loop(t: number): void {
  // Clamp dt: background tabs / long frames must not explode the simulation
  const dt = Math.min((t - lastT) / 1000, 1 / 30);
  lastT = t;
  for (const s of [...activeSprings]) {
    if (s.step(dt)) activeSprings.delete(s);
  }
  if (activeSprings.size > 0) rafId = requestAnimationFrame(loop);
  else rafId = 0;
}

function activate(s: Spring): void {
  activeSprings.add(s);
  if (!rafId) {
    lastT = performance.now();
    rafId = requestAnimationFrame(loop);
  }
}

export class Spring {
  value: number;
  velocity = 0;
  target: number;
  private stiffness: number;
  private damping: number;
  private restDelta: number;
  private restSpeed: number;
  private onFrame: (v: number) => void;
  private onRest: (() => void) | null = null;

  constructor(initial: number, onFrame: (v: number) => void, opts: SpringOpts = {}) {
    this.value = initial;
    this.target = initial;
    this.onFrame = onFrame;
    this.stiffness = opts.stiffness ?? 380;
    this.damping = opts.damping ?? 32;
    this.restDelta = opts.restDelta ?? 0.05;
    this.restSpeed = opts.restSpeed ?? 0.05;
  }

  /** Jump without animating (gesture-driven 1:1 tracking). */
  set(v: number): void {
    this.value = v;
    this.target = v;
    this.velocity = 0;
    activeSprings.delete(this);
    this.onFrame(v);
  }

  /** Animate to target, optionally seeded with the gesture's release velocity (units/s). */
  to(target: number, opts: { velocity?: number; onRest?: () => void } = {}): void {
    this.target = target;
    if (opts.velocity !== undefined) this.velocity = opts.velocity;
    this.onRest = opts.onRest ?? null;
    activate(this);
  }

  stop(): void {
    activeSprings.delete(this);
    this.onRest = null;
  }

  get animating(): boolean {
    return activeSprings.has(this);
  }

  /** @internal returns true when settled */
  step(dt: number): boolean {
    // Semi-implicit Euler in ≤4ms substeps for stability at high stiffness
    let remaining = dt;
    while (remaining > 0) {
      const h = Math.min(remaining, 0.004);
      const force = -this.stiffness * (this.value - this.target) - this.damping * this.velocity;
      this.velocity += force * h;
      this.value += this.velocity * h;
      remaining -= h;
    }
    if (
      Math.abs(this.value - this.target) < this.restDelta &&
      Math.abs(this.velocity) < this.restSpeed
    ) {
      this.value = this.target;
      this.velocity = 0;
      this.onFrame(this.value);
      const rest = this.onRest;
      this.onRest = null;
      rest?.();
      return true;
    }
    this.onFrame(this.value);
    return false;
  }
}

export function createSpring(
  initial: number,
  onFrame: (v: number) => void,
  opts?: SpringOpts,
): Spring {
  return new Spring(initial, onFrame, opts);
}

/** Presets tuned for iOS feel. */
export const SPRING = {
  /** Screens, sheets: brisk but soft landing */
  nav: { stiffness: 680, damping: 52 },
  /** Row snap-back after swipe */
  snappy: { stiffness: 680, damping: 52 },
  /** Drag clone following / FLIP moves */
  flip: { stiffness: 560, damping: 46 },
  /** Bouncy accents (FAB return) */
  bouncy: { stiffness: 480, damping: 30 },
} as const satisfies Record<string, SpringOpts>;

/** Rubber-band resistance past a boundary (iOS overscroll curve). */
export function rubberband(excess: number, dimension = 200): number {
  const sign = excess < 0 ? -1 : 1;
  const x = Math.abs(excess);
  return sign * ((1 - 1 / (x / dimension + 1)) * dimension * 0.55);
}
