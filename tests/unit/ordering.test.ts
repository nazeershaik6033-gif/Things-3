import { describe, expect, it } from 'vitest';
import {
  keyAtEnd, keyAtStart, keyAtIndex, keyBetween, sortByOrderKey,
  needsRebalance, rebalancedKeys, REBALANCE_THRESHOLD,
} from '../../src/db/ordering';

const items = (...keys: string[]) => keys.map((orderKey) => ({ orderKey }));

describe('fractional ordering', () => {
  it('keyAtEnd / keyAtStart', () => {
    expect(keyAtEnd([])).toBeTruthy();
    const list = items('a1', 'a2');
    expect(keyAtEnd(list) > 'a2').toBe(true);
    expect(keyAtStart(list) < 'a1').toBe(true);
  });

  it('keyAtIndex inserts between neighbors', () => {
    const list = items('a1', 'a3');
    const mid = keyAtIndex(list, 1);
    expect(mid > 'a1' && mid < 'a3').toBe(true);
    expect(keyAtIndex(list, 0) < 'a1').toBe(true);
    expect(keyAtIndex(list, 2) > 'a3').toBe(true);
  });

  it('fuzz: 1000 random inserts/moves stay strictly sorted', () => {
    let keys: string[] = [keyBetween(null, null)];
    let rnd = 42;
    const random = () => {
      rnd = (rnd * 1103515245 + 12345) % 2147483648;
      return rnd / 2147483648;
    };
    for (let i = 0; i < 1000; i++) {
      const pos = Math.floor(random() * (keys.length + 1));
      const before = pos > 0 ? keys[pos - 1]! : null;
      const after = pos < keys.length ? keys[pos]! : null;
      keys.splice(pos, 0, keyBetween(before, after));
      // occasionally simulate a move (remove + reinsert)
      if (i % 7 === 0 && keys.length > 2) {
        const from = Math.floor(random() * keys.length);
        keys.splice(from, 1);
        const to = Math.floor(random() * (keys.length + 1));
        const b = to > 0 ? keys[to - 1]! : null;
        const a = to < keys.length ? keys[to]! : null;
        keys.splice(to, 0, keyBetween(b, a));
      }
    }
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
    expect(new Set(keys).size).toBe(keys.length); // all unique
  });

  it('adversarial midpoint-inserts grow keys, rebalance detects and fixes', () => {
    const keys: string[] = [keyBetween(null, null)];
    keys.push(keyBetween(keys[0]!, null));
    // Repeatedly inserting between two adjacent keys lengthens them ~1 char/insert
    for (let i = 0; i < 500; i++) {
      keys.splice(1, 0, keyBetween(keys[0]!, keys[1]!));
    }
    expect(needsRebalance(items(...keys))).toBe(true);
    const fresh = rebalancedKeys(keys.length);
    expect(fresh).toHaveLength(keys.length);
    expect([...fresh].sort()).toEqual(fresh);
    expect(fresh.every((k) => k.length <= REBALANCE_THRESHOLD)).toBe(true);
  });

  it('sortByOrderKey does not mutate input', () => {
    const list = items('b', 'a');
    const sorted = sortByOrderKey(list);
    expect(sorted.map((i) => i.orderKey)).toEqual(['a', 'b']);
    expect(list.map((i) => i.orderKey)).toEqual(['b', 'a']);
  });
});
