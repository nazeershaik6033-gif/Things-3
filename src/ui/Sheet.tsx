import { createEffect, createSignal, onCleanup, onMount, type JSX, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { createSpring, rubberband, Spring, SPRING } from '../gestures/springs';
import { createPan } from '../gestures/createPan';
import { release, tryClaim } from '../gestures/arbiter';

/** Keyboard inset in standalone iOS PWAs: the visual viewport shrinks but
 *  fixed elements don't move, so sheets translate up by the occluded delta. */
export function createKeyboardInset(): () => number {
  const [inset, setInset] = createSignal(0);
  const vv = window.visualViewport;
  if (!vv) return inset;
  const update = () => {
    setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  onCleanup(() => {
    vv.removeEventListener('resize', update);
    vv.removeEventListener('scroll', update);
  });
  return inset;
}

/** Generic spring bottom sheet: slides up on mount, 1:1 drag with rubber-band
 *  above the rest point, velocity-aware settle-or-dismiss. */
export function Sheet(props: {
  onClose: () => void;
  children: JSX.Element;
  /** Drag-to-dismiss from anywhere (pickers) vs. header only (forms with inputs). */
  dragAnywhere?: boolean;
  /** Follow the keyboard (quick entry). */
  trackKeyboard?: boolean;
  maxWidth?: number;
}): JSX.Element {
  let sheetEl!: HTMLDivElement;
  let backdropEl!: HTMLDivElement;
  let handleEl!: HTMLDivElement;
  let height = 0;
  let spring!: Spring; // 0 = open, height = offscreen
  let closing = false;
  const keyboard = props.trackKeyboard ? createKeyboardInset() : () => 0;
  const [mounted, setMounted] = createSignal(false);

  const apply = (v: number) => {
    const y = v - keyboard();
    sheetEl.style.transform = `translate3d(0, ${y}px, 0)`;
    backdropEl.style.opacity = String(Math.min(1, Math.max(0, 1 - v / (height || 1))));
  };

  function close(velocity = 0): void {
    if (closing) return;
    closing = true;
    spring.to(height, {
      velocity,
      onRest: () => props.onClose(),
    });
  }

  onMount(() => {
    height = sheetEl.offsetHeight + 40;
    spring = createSpring(height, apply, SPRING.nav);
    apply(height);
    setMounted(true);
    requestAnimationFrame(() => spring.to(0));

    const dragTarget = props.dragAnywhere ? sheetEl : handleEl;
    const cleanup = createPan(dragTarget, {
      axis: 'y',
      canStart: () => !closing && tryClaim('sheet'),
      onStart: () => {},
      onMove: (_dx, dy) => {
        spring.set(dy >= 0 ? dy : rubberband(dy, 80));
      },
      onEnd: (_vx, vy, _dx, dy) => {
        release('sheet');
        const shouldClose = vy > 600 || (dy > height * 0.4 && vy > -200);
        if (shouldClose) close(vy);
        else spring.to(0, { velocity: vy });
      },
      onCancel: () => {
        release('sheet');
        spring.to(0);
      },
    });
    onCleanup(cleanup);
  });

  createEffect(() => {
    keyboard(); // re-apply when the keyboard moves
    if (spring && !spring.animating && !closing) apply(spring.value);
  });

  return (
    <Portal>
      <div style={{ position: 'fixed', inset: '0', 'z-index': '100' }}>
        <div
          ref={backdropEl}
          onClick={() => close()}
          style={{
            position: 'absolute',
            inset: '0',
            background: 'var(--backdrop)',
            opacity: '0',
            'will-change': 'opacity',
          }}
        />
        <div
          ref={sheetEl}
          class="no-select"
          style={{
            position: 'absolute',
            left: '0',
            right: '0',
            bottom: '0',
            margin: '0 auto',
            'max-width': `${props.maxWidth ?? 560}px`,
            transform: 'translate3d(0, 200vh, 0)',
            background: 'var(--bg-elevated)',
            'border-radius': 'var(--radius-sheet) var(--radius-sheet) 0 0',
            'box-shadow': 'var(--shadow-sheet)',
            'padding-bottom': 'var(--safe-bottom)',
            'will-change': 'transform',
            visibility: mounted() ? 'visible' : 'hidden',
          }}
        >
          <div
            ref={handleEl}
            style={{
              padding: '8px 0 2px',
              display: 'flex',
              'justify-content': 'center',
              'touch-action': 'none',
            }}
          >
            <div
              style={{
                width: '38px',
                height: '5px',
                'border-radius': '3px',
                background: 'var(--text-tertiary)',
                opacity: '0.6',
              }}
            />
          </div>
          {props.children}
        </div>
      </div>
    </Portal>
  );
}

export function SheetTitle(props: { children: JSX.Element }): JSX.Element {
  return (
    <div
      style={{
        'text-align': 'center',
        'font-weight': '600',
        'font-size': '15px',
        padding: '6px 16px 10px',
        color: 'var(--text)',
      }}
    >
      {props.children}
    </div>
  );
}
