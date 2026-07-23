import { createLongPress } from '../gestures/createLongPress';
import { createSpring, Spring, SPRING } from '../gestures/springs';
import { release, tryClaim, closeOpenRow } from '../gestures/arbiter';
import { setExpandedTaskId } from '../app/uiState';

/** Long-press drag for Kanban cards across columns. Built on the same
 *  primitives as ReorderGroup (createLongPress + springs + the gesture
 *  arbiter), but a board is a horizontal row of independently-scrolling
 *  columns, so instead of shifting every sibling we drop a placeholder gap
 *  into the hovered column and hit-test the pointer to find list + index.
 *
 *  DOM contract (set by BoardScreen):
 *   - board scroll container: passed via opts.boardScroll (horizontal)
 *   - each column:            [data-board-list][data-list-id]
 *   - each column's card box:  [data-list-cards]  (vertical scroll)
 *   - each card wrapper:       [data-board-card][data-card-id]
 */
export interface BoardDragOpts {
  boardScroll: () => HTMLElement | null;
  onDrop: (cardId: string, listId: string, index: number) => void;
  disabled?: () => boolean;
}

export function createBoardDrag(group: HTMLElement, opts: BoardDragOpts): () => void {
  let dragged: HTMLElement | null = null;
  let cardId = '';
  let clone: HTMLElement | null = null;
  let cloneSpringX!: Spring;
  let cloneSpringY!: Spring;
  let offsetX = 0;
  let offsetY = 0;
  let pointerX = 0;
  let pointerY = 0;
  let placeholder: HTMLElement | null = null;
  let targetListId = '';
  let targetIndex = 0;
  let autoRaf = 0;

  function columns(): { listId: string; el: HTMLElement; cards: HTMLElement }[] {
    return Array.from(group.querySelectorAll<HTMLElement>('[data-board-list]')).map((el) => ({
      listId: el.dataset.listId!,
      el,
      cards: el.querySelector<HTMLElement>('[data-list-cards]')!,
    }));
  }

  function makePlaceholder(height: number): HTMLElement {
    const ph = document.createElement('div');
    ph.dataset.cardPlaceholder = '';
    Object.assign(ph.style, {
      height: `${height}px`,
      margin: '0 0 8px',
      borderRadius: '10px',
      border: '2px dashed var(--text-tertiary)',
      background: 'var(--bg-inset)',
      boxSizing: 'border-box',
    } satisfies Partial<CSSStyleDeclaration>);
    return ph;
  }

  /** Place the gap in the column under the pointer, at the right index. */
  function updateTarget(): void {
    if (!dragged || !placeholder) return;
    const cols = columns();
    if (cols.length === 0) return;
    // Nearest column by horizontal position of the pointer.
    let col = cols[0]!;
    for (const c of cols) {
      const r = c.el.getBoundingClientRect();
      if (pointerX >= r.left && pointerX <= r.right) { col = c; break; }
      // otherwise keep the closest one as a fallback
      const cr = col.el.getBoundingClientRect();
      const dist = Math.min(Math.abs(pointerX - r.left), Math.abs(pointerX - r.right));
      const curDist = Math.min(Math.abs(pointerX - cr.left), Math.abs(pointerX - cr.right));
      if (dist < curDist) col = c;
    }
    targetListId = col.listId;

    const cards = Array.from(col.cards.querySelectorAll<HTMLElement>('[data-board-card]'))
      .filter((el) => el !== dragged);
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i]!.getBoundingClientRect();
      if (pointerY < r.top + r.height / 2) { index = i; break; }
    }
    targetIndex = index;

    // Reposition the placeholder node in the DOM.
    if (placeholder.parentElement !== col.cards) col.cards.appendChild(placeholder);
    const ref = cards[index] ?? null;
    if (placeholder.nextSibling !== ref) col.cards.insertBefore(placeholder, ref);
  }

  function autoScroll(): void {
    const board = opts.boardScroll();
    const zone = 56;
    if (board) {
      const r = board.getBoundingClientRect();
      if (pointerX < r.left + zone) board.scrollLeft -= Math.min(16, (r.left + zone - pointerX) / 3);
      else if (pointerX > r.right - zone) board.scrollLeft += Math.min(16, (pointerX - (r.right - zone)) / 3);
    }
    // Vertical scroll within the hovered column.
    const col = columns().find((c) => {
      const r = c.el.getBoundingClientRect();
      return pointerX >= r.left && pointerX <= r.right;
    });
    if (col) {
      const r = col.cards.getBoundingClientRect();
      if (pointerY < r.top + zone) col.cards.scrollTop -= Math.min(14, (r.top + zone - pointerY) / 3);
      else if (pointerY > r.bottom - zone) col.cards.scrollTop += Math.min(14, (pointerY - (r.bottom - zone)) / 3);
    }
    updateTarget();
    autoRaf = requestAnimationFrame(autoScroll);
  }

  function endDrag(commit: boolean): void {
    cancelAnimationFrame(autoRaf);
    release('reorder');
    const d = dragged;
    const ph = placeholder;
    const cloneEl = clone;
    const id = cardId;
    const listId = targetListId;
    const index = targetIndex;

    const settle = () => {
      ph?.remove();
      cloneEl?.remove();
      if (d) { d.style.display = ''; d.style.visibility = ''; }
      dragged = null; clone = null; placeholder = null;
      if (commit && d) opts.onDrop(id, listId, index);
    };

    if (cloneEl && ph) {
      const target = ph.getBoundingClientRect();
      cloneSpringX.to(target.left);
      cloneSpringY.to(target.top, { onRest: settle });
    } else {
      settle();
    }
  }

  const cleanup = createLongPress(group, {
    canStart: (e) => {
      if (opts.disabled?.()) return false;
      const t = e.target as HTMLElement;
      if (t.closest('textarea, input, button')) return false;
      return !!t.closest('[data-board-card]') && tryClaim('reorder');
    },
    onPress: (e) => {
      const cardEl = (e.target as HTMLElement).closest<HTMLElement>('[data-board-card]');
      if (!cardEl) { release('reorder'); return null; }
      closeOpenRow();
      setExpandedTaskId(null);
      dragged = cardEl;
      cardId = cardEl.dataset.cardId!;
      const rect = cardEl.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      pointerX = e.clientX;
      pointerY = e.clientY;

      clone = cardEl.cloneNode(true) as HTMLElement;
      Object.assign(clone.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: `${rect.width}px`,
        margin: '0',
        zIndex: '60',
        pointerEvents: 'none',
        boxShadow: 'var(--shadow-drag)',
        borderRadius: '10px',
        background: 'var(--bg-elevated)',
        willChange: 'transform',
      } satisfies Partial<CSSStyleDeclaration>);
      document.body.appendChild(clone);
      cloneSpringX = createSpring(rect.left, () => applyClone(), SPRING.flip);
      cloneSpringY = createSpring(rect.top, () => applyClone(), SPRING.flip);
      cloneSpringX.set(rect.left);
      cloneSpringY.set(rect.top);

      placeholder = makePlaceholder(rect.height);
      // Hide the source; the placeholder now stands in for it.
      cardEl.style.display = 'none';
      targetListId = cardEl.dataset.listId!;
      updateTarget();
      autoRaf = requestAnimationFrame(autoScroll);

      return {
        onMove: (ev: PointerEvent) => {
          pointerX = ev.clientX;
          pointerY = ev.clientY;
          cloneSpringX.set(ev.clientX - offsetX);
          cloneSpringY.set(ev.clientY - offsetY);
          updateTarget();
        },
        onEnd: () => endDrag(true),
        onCancel: () => endDrag(false),
      };
    },
  });

  function applyClone(): void {
    if (clone) clone.style.transform = `translate3d(${cloneSpringX.value}px, ${cloneSpringY.value}px, 0) scale(1.03)`;
  }

  return () => {
    cancelAnimationFrame(autoRaf);
    cleanup();
  };
}
