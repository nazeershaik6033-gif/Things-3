/** One continuous gesture at a time, app-wide. Swipe-rows, drag-reorder,
 *  sheet-drag, Magic Plus and edge-swipe-back all claim here, so they can
 *  never fight over the same pointer. */

export type GestureKind =
  | 'swipe-row'
  | 'reorder'
  | 'sheet'
  | 'magic-plus'
  | 'edge-back';

let active: GestureKind | null = null;

export function tryClaim(kind: GestureKind): boolean {
  if (active !== null && active !== kind) return false;
  active = kind;
  return true;
}

export function release(kind: GestureKind): void {
  if (active === kind) active = null;
}

export function activeGesture(): GestureKind | null {
  return active;
}

/** Rows register how to close themselves; starting any new interaction
 *  closes the previously open swipe-row (Things behavior). */
let openRowCloser: (() => void) | null = null;

export function registerOpenRow(close: () => void): void {
  if (openRowCloser && openRowCloser !== close) openRowCloser();
  openRowCloser = close;
}

export function clearOpenRow(close: () => void): void {
  if (openRowCloser === close) openRowCloser = null;
}

export function closeOpenRow(): void {
  openRowCloser?.();
  openRowCloser = null;
}
