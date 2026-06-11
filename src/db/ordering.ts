import { generateKeyBetween } from 'fractional-indexing';

export interface Ordered {
  orderKey: string;
}

/** Key that sorts after every key in `items`. */
export function keyAtEnd(items: readonly Ordered[]): string {
  const last = maxKey(items);
  return generateKeyBetween(last, null);
}

/** Key that sorts before every key in `items`. */
export function keyAtStart(items: readonly Ordered[]): string {
  const first = minKey(items);
  return generateKeyBetween(null, first);
}

/** Key between two neighbors (either may be null at list edges). */
export function keyBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after);
}

/** Key for inserting at `index` into `sorted` (already sorted by orderKey). */
export function keyAtIndex(sorted: readonly Ordered[], index: number): string {
  const before = index > 0 ? sorted[index - 1]!.orderKey : null;
  const after = index < sorted.length ? sorted[index]!.orderKey : null;
  return generateKeyBetween(before, after);
}

export function byOrderKey<T extends Ordered>(a: T, b: T): number {
  return a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0;
}

export function sortByOrderKey<T extends Ordered>(items: T[]): T[] {
  return [...items].sort(byOrderKey);
}

/** Keys grow with adversarial reorders; past this length we renumber the scope. */
export const REBALANCE_THRESHOLD = 40;

export function needsRebalance(items: readonly Ordered[]): boolean {
  return items.some((i) => i.orderKey.length > REBALANCE_THRESHOLD);
}

/** Fresh evenly-spaced keys preserving current order. */
export function rebalancedKeys(count: number): string[] {
  const keys: string[] = [];
  let prev: string | null = null;
  for (let i = 0; i < count; i++) {
    prev = generateKeyBetween(prev, null);
    keys.push(prev);
  }
  return keys;
}

function minKey(items: readonly Ordered[]): string | null {
  let min: string | null = null;
  for (const i of items) if (min === null || i.orderKey < min) min = i.orderKey;
  return min;
}

function maxKey(items: readonly Ordered[]): string | null {
  let max: string | null = null;
  for (const i of items) if (max === null || i.orderKey > max) max = i.orderKey;
  return max;
}
