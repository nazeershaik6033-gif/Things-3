import { describe, expect, it } from 'vitest';
import { groupByQuadrant, QUADRANTS, quadrantMeta } from '../../src/domain/eisenhower';
import { newTask } from '../../src/db/mutations';

describe('eisenhower', () => {
  it('defines the four quadrants in matrix priority order', () => {
    expect(QUADRANTS.map((q) => q.id)).toEqual(['do', 'schedule', 'delegate', 'eliminate']);
  });

  it('groups tasks by quadrant, unlabeled first, preserving order', () => {
    const a = newTask({ title: 'a', priority: 'do' });
    const b = newTask({ title: 'b' });
    const c = newTask({ title: 'c', priority: 'do' });
    const d = newTask({ title: 'd', priority: 'eliminate' });
    const { unlabeled, groups } = groupByQuadrant([a, b, c, d]);
    expect(unlabeled.map((t) => t.title)).toEqual(['b']);
    expect(groups.map((g) => g.meta.id)).toEqual(['do', 'eliminate']); // empty quadrants omitted
    expect(groups[0]!.tasks.map((t) => t.title)).toEqual(['a', 'c']);
  });

  it('treats legacy tasks without the priority field as unlabeled', () => {
    const legacy = { ...newTask({ title: 'old' }) } as Record<string, unknown>;
    delete legacy.priority;
    const { unlabeled } = groupByQuadrant([legacy as never]);
    expect(unlabeled).toHaveLength(1);
  });

  it('quadrantMeta resolves labels', () => {
    expect(quadrantMeta('do').label).toBe('Do');
    expect(quadrantMeta('eliminate').label).toBe('Eliminate');
  });
});
