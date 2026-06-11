import { onCleanup, onMount, type JSX } from 'solid-js';
import { createPan } from '../gestures/createPan';
import { createSpring, rubberband, Spring, SPRING } from '../gestures/springs';
import { release, tryClaim, closeOpenRow } from '../gestures/arbiter';
import { Icon } from '../ui/Icon';

const ACTION_WIDTH = 76;

/** Swipe right → complete (green underlay), swipe left → schedule (yellow).
 *  Axis-locked so vertical list scrolling always stays native. */
export function SwipeableRow(props: {
  children: JSX.Element;
  onComplete: () => void;
  onSchedule: () => void;
  disabled?: boolean;
}): JSX.Element {
  let root!: HTMLDivElement;
  let content!: HTMLDivElement;
  let leftIcon!: HTMLDivElement;
  let rightIcon!: HTMLDivElement;
  let spring!: Spring;
  let pastThreshold: 'none' | 'left' | 'right' = 'none';
  let iconSpringL!: Spring;
  let iconSpringR!: Spring;

  const apply = (x: number) => {
    content.style.transform = x === 0 ? '' : `translate3d(${x}px, 0, 0)`;
    root.style.setProperty('--reveal-l', x > 0 ? '1' : '0');
    root.style.setProperty('--reveal-r', x < 0 ? '1' : '0');
  };

  onMount(() => {
    spring = createSpring(0, apply, SPRING.snappy);
    iconSpringL = createSpring(1, (v) => (leftIcon.style.transform = `scale(${v})`), SPRING.bouncy);
    iconSpringR = createSpring(1, (v) => (rightIcon.style.transform = `scale(${v})`), SPRING.bouncy);

    const cleanup = createPan(root, {
      axis: 'x',
      canStart: () => !props.disabled && tryClaim('swipe-row'),
      onStart: () => {
        closeOpenRow();
        spring.stop();
        content.style.willChange = 'transform';
        pastThreshold = 'none';
      },
      onMove: (dx) => {
        const x = Math.abs(dx) > ACTION_WIDTH
          ? Math.sign(dx) * (ACTION_WIDTH + rubberband(Math.abs(dx) - ACTION_WIDTH, 220))
          : dx;
        spring.set(x);
        const zone: typeof pastThreshold = dx > ACTION_WIDTH * 0.85 ? 'right' : dx < -ACTION_WIDTH * 0.85 ? 'left' : 'none';
        if (zone !== pastThreshold) {
          // Icon "tick" when crossing the commit threshold
          if (zone === 'right') { iconSpringL.set(0.82); iconSpringL.to(1.18, { onRest: () => iconSpringL.to(1) }); }
          if (zone === 'left') { iconSpringR.set(0.82); iconSpringR.to(1.18, { onRest: () => iconSpringR.to(1) }); }
          pastThreshold = zone;
        }
      },
      onEnd: (vx, _vy, dx) => {
        release('swipe-row');
        content.style.willChange = '';
        const commitRight = dx > ACTION_WIDTH * 0.85 || (dx > 40 && vx > 800);
        const commitLeft = dx < -ACTION_WIDTH * 0.85 || (dx < -40 && vx < -800);
        spring.to(0, { velocity: vx });
        if (commitRight) props.onComplete();
        else if (commitLeft) props.onSchedule();
      },
      onCancel: () => {
        release('swipe-row');
        content.style.willChange = '';
        spring.to(0);
      },
    });
    onCleanup(cleanup);
  });

  return (
    <div
      ref={root}
      style={{ position: 'relative', overflow: 'hidden', 'touch-action': 'pan-y' }}
    >
      <div
        style={{
          position: 'absolute',
          inset: '0',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'flex-start',
          'padding-left': '26px',
          background: 'var(--green)',
          opacity: 'var(--reveal-l, 0)',
        }}
      >
        <div ref={leftIcon} style={{ color: '#fff' }}>
          <Icon name="check" size={24} />
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          inset: '0',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'flex-end',
          'padding-right': '26px',
          background: 'var(--yellow-deep)',
          opacity: 'var(--reveal-r, 0)',
        }}
      >
        <div ref={rightIcon} style={{ color: '#fff' }}>
          <Icon name="calendar" size={24} />
        </div>
      </div>
      <div ref={content} style={{ position: 'relative', background: 'var(--bg-list)' }}>
        {props.children}
      </div>
    </div>
  );
}
