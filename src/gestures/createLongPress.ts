export interface LongPressOpts {
  duration?: number;
  moveTolerance?: number;
  canStart?: (e: PointerEvent) => boolean;
  /** Fires once when the press matures. Return handlers to receive the rest
   *  of the gesture (move/up) — the pointer is captured for you. */
  onPress: (e: PointerEvent) => {
    onMove: (e: PointerEvent) => void;
    onEnd: (e: PointerEvent) => void;
    onCancel?: () => void;
  } | null;
}

export function createLongPress(el: HTMLElement, opts: LongPressOpts): () => void {
  const duration = opts.duration ?? 350;
  const tolerance = opts.moveTolerance ?? 8;

  let pointerId: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let startX = 0;
  let startY = 0;
  let handlers: ReturnType<LongPressOpts['onPress']> = null;
  let suppressClick = false;

  const blockScroll = (e: TouchEvent) => {
    if (handlers && e.cancelable) e.preventDefault();
  };
  const blockContextMenu = (e: Event) => {
    if (pointerId !== null) e.preventDefault();
  };

  function reset(): void {
    clearTimeout(timer);
    pointerId = null;
    handlers = null;
    document.removeEventListener('touchmove', blockScroll);
  }

  function onDown(e: PointerEvent): void {
    if (pointerId !== null || !e.isPrimary) return;
    if (opts.canStart && !opts.canStart(e)) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    const downEvent = e;
    timer = setTimeout(() => {
      // Pressed long enough without moving: mature into a drag
      document.addEventListener('touchmove', blockScroll, { passive: false });
      handlers = opts.onPress(downEvent);
      if (handlers) {
        suppressClick = true;
        try {
          el.setPointerCapture(downEvent.pointerId);
        } catch {
          /* ignore */
        }
      } else {
        reset();
      }
    }, duration);
  }

  function onMove(e: PointerEvent): void {
    if (e.pointerId !== pointerId) return;
    if (handlers) {
      handlers.onMove(e);
      return;
    }
    if (
      Math.abs(e.clientX - startX) > tolerance ||
      Math.abs(e.clientY - startY) > tolerance
    ) {
      reset(); // moved too early: it's a scroll/swipe, not a long-press
    }
  }

  function onUp(e: PointerEvent): void {
    if (e.pointerId !== pointerId) return;
    const h = handlers;
    reset();
    h?.onEnd(e);
    if (suppressClick) {
      // Swallow the click that follows pointer release after a drag
      setTimeout(() => (suppressClick = false), 0);
    }
  }

  function onCancelEvt(e: PointerEvent): void {
    if (e.pointerId !== pointerId) return;
    const h = handlers;
    reset();
    h?.onCancel?.();
  }

  function onClick(e: MouseEvent): void {
    if (suppressClick) {
      e.stopPropagation();
      e.preventDefault();
    }
  }

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancelEvt);
  el.addEventListener('click', onClick, true);
  el.addEventListener('contextmenu', blockContextMenu);

  return () => {
    reset();
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancelEvt);
    el.removeEventListener('click', onClick, true);
    el.removeEventListener('contextmenu', blockContextMenu);
  };
}
