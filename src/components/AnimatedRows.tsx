import { createEffect, on, type JSX, createSignal, untrack } from 'solid-js';
import { Key } from '@solid-primitives/keyed';
import { captureRects, flipMove } from '../gestures/flip';

/** Keyed list whose reorders/removals/insertions animate via FLIP: rows slide
 *  with transform-only springs, departing rows fade out as absolute clones.
 *  Rows are keyed by id (NOT object identity), so a DB write that replaces
 *  the array updates row contents in place without remounting components. */
export function AnimatedRows<T>(props: {
  items: T[];
  key: (item: T) => string;
  children: (item: () => T) => JSX.Element;
  /** Disable animations (e.g., during an active drag that does its own FLIP). */
  suspend?: () => boolean;
}): JSX.Element {
  const [displayed, setDisplayed] = createSignal<T[]>(props.items);
  let container!: HTMLDivElement;
  const rowEls = new Map<string, HTMLElement>();

  createEffect(
    on(
      () => props.items,
      (items) => {
        const oldItems = untrack(displayed);
        const oldKeys = new Set(oldItems.map(props.key));
        const newKeys = new Set(items.map(props.key));
        const structuralChange =
          oldKeys.size !== newKeys.size ||
          oldItems.some((it, i) => props.key(it) !== (items[i] !== undefined ? props.key(items[i]!) : ''));

        if (!structuralChange || (untrack(() => props.suspend?.() ?? false))) {
          setDisplayed(() => items);
          return;
        }

        const liveEls = [...rowEls.entries()].filter(([, el]) => el.isConnected);
        const before = captureRects(liveEls.map(([, el]) => el));
        const removedClones: { el: HTMLElement; rect: DOMRect }[] = [];
        for (const [key, el] of liveEls) {
          if (!newKeys.has(key) && before.has(el)) {
            removedClones.push({ el: el.cloneNode(true) as HTMLElement, rect: before.get(el)! });
          }
        }

        setDisplayed(() => items); // Solid updates the DOM synchronously here

        flipMove(before);
        // Departing rows: absolute clone fades out in place
        const containerRect = container.getBoundingClientRect();
        for (const { el, rect } of removedClones) {
          el.style.position = 'absolute';
          el.style.top = `${rect.top - containerRect.top}px`;
          el.style.left = `${rect.left - containerRect.left}px`;
          el.style.width = `${rect.width}px`;
          el.style.pointerEvents = 'none';
          el.style.transition = 'opacity 220ms ease-out, transform 220ms ease-out';
          container.appendChild(el);
          requestAnimationFrame(() => {
            el.style.opacity = '0';
            el.style.transform = 'scale(0.98)';
          });
          setTimeout(() => el.remove(), 260);
        }
        // Entering rows: gentle fade-in
        for (const item of items) {
          const key = props.key(item);
          if (!oldKeys.has(key)) {
            const el = rowEls.get(key);
            if (el?.isConnected) {
              el.style.animation = 'fade-in 200ms ease-out';
              setTimeout(() => (el.style.animation = ''), 220);
            }
          }
        }
        for (const key of [...rowEls.keys()]) {
          if (!newKeys.has(key)) rowEls.delete(key);
        }
      },
      { defer: true },
    ),
  );

  return (
    <div ref={container} style={{ position: 'relative' }}>
      <Key each={displayed()} by={(item) => props.key(item)}>
        {(item) => (
          <div
            ref={(el) => rowEls.set(props.key(item()), el)}
            data-row-key={props.key(item())}
          >
            {props.children(item)}
          </div>
        )}
      </Key>
    </div>
  );
}
