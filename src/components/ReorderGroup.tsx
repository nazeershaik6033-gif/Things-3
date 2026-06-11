import { onCleanup, onMount, type JSX } from 'solid-js';
import { createLongPress } from '../gestures/createLongPress';
import { createSpring, Spring, SPRING } from '../gestures/springs';
import { release, tryClaim, closeOpenRow } from '../gestures/arbiter';
import { setExpandedTaskId } from '../app/uiState';

export interface DropInfo {
  key: string;
  /** Section the row was dropped into (rows carry data-section). */
  section: string;
  /** Index within that section, computed with the dragged row removed. */
  index: number;
}

interface RowMeasure {
  key: string;
  section: string;
  el: HTMLElement;
  top: number;
  height: number;
}

/** Long-press drag-to-reorder across all rows inside this group (sections
 *  included). Rows must carry data-reorder-row, data-key and data-section.
 *  The dragged row becomes a fixed clone; siblings shift with translate-only
 *  springs; drop reports {key, section, index} for a single orderKey write. */
export function ReorderGroup(props: {
  children: JSX.Element;
  onDrop: (info: DropInfo) => void;
  /** The scrollable ancestor (defaults to the group element itself). */
  scrollParent?: () => HTMLElement | null;
  disabled?: boolean;
}): JSX.Element {
  let group!: HTMLDivElement;

  onMount(() => {
    let rows: RowMeasure[] = [];
    let dragged: RowMeasure | null = null;
    let clone: HTMLElement | null = null;
    let cloneSpringY!: Spring;
    let cloneX = 0;
    let pointerY = 0;
    let startScrollTop = 0;
    let scrollEl: HTMLElement | null = null;
    let targetSlot = 0; // insertion slot among `others`
    let others: RowMeasure[] = [];
    let shiftSprings = new Map<HTMLElement, Spring>();
    let autoScrollRaf = 0;
    let startPointerOffset = 0;

    const shiftFor = (el: HTMLElement): Spring => {
      let s = shiftSprings.get(el);
      if (!s) {
        s = createSpring(0, (v) => {
          el.style.transform = v === 0 ? '' : `translate3d(0, ${v}px, 0)`;
        }, SPRING.flip);
        shiftSprings.set(el, s);
      }
      return s;
    };

    function measure(): void {
      rows = [];
      const els = group.querySelectorAll<HTMLElement>('[data-reorder-row]');
      const scrollAdjust = (scrollEl?.scrollTop ?? 0) - startScrollTop;
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        rows.push({
          key: el.dataset.key!,
          section: el.dataset.section ?? '',
          el,
          // store document-ish coordinates stable under scrolling
          top: rect.top + (scrollEl?.scrollTop ?? 0),
          height: rect.height,
        });
      }
      rows.sort((a, b) => a.top - b.top);
      void scrollAdjust;
    }

    /** Insertion slot from the clone's center against others' midpoints. */
    function slotFromPointer(): number {
      const centerY = pointerY - startPointerOffset + (dragged?.height ?? 0) / 2 + (scrollEl?.scrollTop ?? 0);
      let slot = others.length;
      for (let i = 0; i < others.length; i++) {
        const o = others[i]!;
        if (centerY < o.top + o.height / 2) {
          slot = i;
          break;
        }
      }
      return slot;
    }

    function applyShifts(animated = true): void {
      if (!dragged) return;
      const h = dragged.height;
      for (let i = 0; i < others.length; i++) {
        const o = others[i]!;
        const wasBefore = o.top < dragged.top;
        let shift = 0;
        // Rows after the (removed) dragged row moved up by h already in our
        // virtual layout; we keep the visual gap at targetSlot instead.
        if (wasBefore) {
          if (i >= targetSlot) shift = h;
        } else {
          if (i < targetSlot) shift = -h;
        }
        const s = shiftFor(o.el);
        if (animated) s.to(shift);
        else s.set(shift);
      }
    }

    function autoScroll(): void {
      if (!scrollEl || !dragged) return;
      const rect = scrollEl.getBoundingClientRect();
      const zone = 64;
      let dy = 0;
      if (pointerY < rect.top + zone) dy = -Math.min(14, (rect.top + zone - pointerY) / 4);
      else if (pointerY > rect.bottom - zone) dy = Math.min(14, (pointerY - (rect.bottom - zone)) / 4);
      if (dy !== 0) {
        scrollEl.scrollTop += dy;
        const slot = slotFromPointer();
        if (slot !== targetSlot) {
          targetSlot = slot;
          applyShifts();
        }
      }
      autoScrollRaf = requestAnimationFrame(autoScroll);
    }

    function endDrag(commit: boolean): void {
      cancelAnimationFrame(autoScrollRaf);
      release('reorder');
      if (!dragged) return;
      const d = dragged;
      const finalSlot = targetSlot;
      const cloneEl = clone;

      // Where does the gap sit on screen?
      const scrollDelta = (scrollEl?.scrollTop ?? 0) - startScrollTop;
      let gapTop: number;
      if (finalSlot < others.length) {
        const o = others[finalSlot]!;
        const shifted = o.top < d.top ? d.height : 0;
        gapTop = o.top + shifted - d.height - (scrollEl?.scrollTop ?? 0);
        if (o.top >= d.top) gapTop = o.top - (scrollEl?.scrollTop ?? 0) - d.height + d.height;
      }
      // Simpler: derive from neighbor springs after layout settles; we just
      // spring the clone toward the computed slot position:
      const slotTopDoc =
        finalSlot === 0
          ? (others[0] ? virtualTop(others[0]!, d) : d.top)
          : virtualBottom(others[finalSlot - 1]!, d);
      gapTop = slotTopDoc - (scrollEl?.scrollTop ?? 0);
      void scrollDelta;

      const settle = () => {
        // Restore everything; the data write re-renders the real order
        for (const [el, s] of shiftSprings) {
          s.stop();
          el.style.transform = '';
        }
        shiftSprings.clear();
        d.el.style.visibility = '';
        d.el.style.opacity = '';
        cloneEl?.remove();
        clone = null;
        dragged = null;
        if (commit) {
          const section = finalSlot < others.length
            ? sectionForSlot(finalSlot, d)
            : (others.length ? sectionForSlot(finalSlot, d) : d.section);
          const index = others
            .slice(0, finalSlot)
            .filter((o) => o.section === section).length;
          props.onDrop({ key: d.key, section, index });
        }
      };

      if (cloneEl) {
        const current = cloneEl.getBoundingClientRect().top;
        cloneSpringY.to(cloneSpringY.value + (gapTop - current), { onRest: settle });
      } else {
        settle();
      }
    }

    /** Section a drop in `slot` lands in: the section of the row before the
     *  gap, else of the row after, else the dragged row's own. */
    function sectionForSlot(slot: number, d: RowMeasure): string {
      if (slot > 0) return others[slot - 1]!.section;
      if (others.length > 0) return others[0]!.section;
      return d.section;
    }

    function virtualTop(o: RowMeasure, d: RowMeasure): number {
      return o.top < d.top ? o.top : o.top - d.height;
    }
    function virtualBottom(o: RowMeasure, d: RowMeasure): number {
      return virtualTop(o, d) + o.height;
    }

    const cleanup = createLongPress(group, {
      canStart: (e) => {
        if (props.disabled) return false;
        const target = e.target as HTMLElement;
        if (target.closest('textarea, input, button, [data-task-card]')) return false;
        return !!target.closest('[data-reorder-row]') && tryClaim('reorder');
      },
      onPress: (e) => {
        const rowEl = (e.target as HTMLElement).closest<HTMLElement>('[data-reorder-row]');
        if (!rowEl) {
          release('reorder');
          return null;
        }
        closeOpenRow();
        setExpandedTaskId(null);
        scrollEl = props.scrollParent?.() ?? group.closest('.screen-scroll') as HTMLElement | null;
        startScrollTop = scrollEl?.scrollTop ?? 0;
        measure();
        dragged = rows.find((r) => r.el === rowEl) ?? null;
        if (!dragged) {
          release('reorder');
          return null;
        }
        others = rows.filter((r) => r !== dragged);
        const rect = rowEl.getBoundingClientRect();
        pointerY = e.clientY;
        startPointerOffset = e.clientY - rect.top;
        cloneX = rect.left;

        clone = rowEl.cloneNode(true) as HTMLElement;
        Object.assign(clone.style, {
          position: 'fixed',
          top: '0',
          left: `${cloneX}px`,
          width: `${rect.width}px`,
          zIndex: '60',
          pointerEvents: 'none',
          boxShadow: 'var(--shadow-drag)',
          borderRadius: '10px',
          background: 'var(--bg-elevated)',
          overflow: 'hidden',
          willChange: 'transform',
        } satisfies Partial<CSSStyleDeclaration>);
        document.body.appendChild(clone);
        cloneSpringY = createSpring(rect.top, (v) => {
          clone!.style.transform = `translate3d(0, ${v}px, 0) scale(1.04)`;
        }, SPRING.flip);
        cloneSpringY.set(rect.top);

        rowEl.style.visibility = 'hidden';
        // initial slot = own position
        targetSlot = others.filter((o) => o.top < dragged!.top).length;
        applyShifts(false);
        autoScrollRaf = requestAnimationFrame(autoScroll);

        return {
          onMove: (ev: PointerEvent) => {
            pointerY = ev.clientY;
            cloneSpringY.set(ev.clientY - startPointerOffset);
            const slot = slotFromPointer();
            if (slot !== targetSlot) {
              targetSlot = slot;
              applyShifts();
            }
          },
          onEnd: () => endDrag(true),
          onCancel: () => endDrag(false),
        };
      },
    });
    onCleanup(() => {
      cancelAnimationFrame(autoScrollRaf);
      cleanup();
    });
  });

  return (
    <div ref={group} data-reorder-group>
      {props.children}
    </div>
  );
}
