import { createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { createSpring, rubberband, Spring, SPRING } from '../gestures/springs';
import { createPan } from '../gestures/createPan';
import { release, tryClaim } from '../gestures/arbiter';
import { createViewport } from './viewport';

/** A near-full-height modal that tracks the software keyboard.
 *
 *  Sized from the *visual* viewport rather than the layout one, so in a
 *  standalone iOS PWA the panel ends exactly where the keyboard begins and a
 *  bottom toolbar stays reachable instead of hiding behind it. The children are
 *  laid out as a flex column: give the scrolling body `flex: 1`. */
export function FullScreenSheet(props: {
  onClose: () => void;
  children: JSX.Element;
  /** Drag-to-dismiss grip; the header registers itself through this ref. */
  gripRef?: (el: HTMLElement) => void;
  label?: string;
}): JSX.Element {
  let panelEl!: HTMLDivElement;
  let backdropEl!: HTMLDivElement;
  let gripEl!: HTMLDivElement;
  let spring!: Spring;
  let closing = false;

  const viewport = createViewport();
  const [mounted, setMounted] = createSignal(false);

  const travel = () => viewport().height || window.innerHeight;

  const apply = (v: number) => {
    panelEl.style.transform = `translate3d(0, ${viewport().offsetTop + v}px, 0)`;
    backdropEl.style.opacity = String(Math.min(1, Math.max(0, 1 - v / (travel() || 1))));
  };

  const close = (velocity = 0) => {
    if (closing) return;
    closing = true;
    spring.to(travel(), { velocity, onRest: () => props.onClose() });
  };

  onMount(() => {
    spring = createSpring(travel(), apply, SPRING.nav);
    apply(travel());
    setMounted(true);
    requestAnimationFrame(() => spring.to(0));

    props.gripRef?.(gripEl);

    const cleanup = createPan(gripEl, {
      axis: 'y',
      canStart: () => !closing && tryClaim('sheet'),
      onStart: () => {},
      onMove: (_dx, dy) => spring.set(dy >= 0 ? dy : rubberband(dy, 80)),
      onEnd: (_vx, vy, _dx, dy) => {
        release('sheet');
        if (vy > 600 || (dy > travel() * 0.28 && vy > -200)) close(vy);
        else spring.to(0, { velocity: vy });
      },
      onCancel: () => {
        release('sheet');
        spring.to(0);
      },
    });
    onCleanup(cleanup);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  // Re-place the panel whenever the keyboard opens, closes or resizes.
  createEffect(() => {
    viewport();
    if (spring && !spring.animating && !closing) apply(spring.value);
  });

  return (
    <Portal>
      <div style={{ position: 'fixed', inset: '0', 'z-index': '90' }} role="dialog" aria-modal="true" aria-label={props.label}>
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
          ref={panelEl}
          style={{
            position: 'absolute',
            left: '0',
            right: '0',
            top: 'calc(var(--safe-top) + 8px)',
            height: `calc(${viewport().height}px - var(--safe-top) - 8px)`,
            margin: '0 auto',
            display: 'flex',
            'flex-direction': 'column',
            background: 'var(--bg-elevated)',
            'border-radius': 'var(--radius-sheet) var(--radius-sheet) 0 0',
            'box-shadow': 'var(--shadow-sheet)',
            transform: 'translate3d(0, 200vh, 0)',
            'will-change': 'transform',
            overflow: 'hidden',
            visibility: mounted() ? 'visible' : 'hidden',
          }}
        >
          <div
            ref={gripEl}
            class="no-select"
            style={{
              padding: '8px 0 0',
              display: 'flex',
              'justify-content': 'center',
              'touch-action': 'none',
              flex: 'none',
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
