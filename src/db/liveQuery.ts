import { liveQuery } from 'dexie';
import { createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';

/** Bridge a Dexie liveQuery into a Solid signal. The querier may read other
 *  signals (e.g. currentDate()) — we re-subscribe when they change by reading
 *  them inside a wrapper effect via the queryDeps callback. */
export function createLiveQuery<T>(
  querier: () => T | Promise<T>,
  initial: T,
): Accessor<T> {
  const [value, setValue] = createSignal<T>(initial);
  const sub = liveQuery(querier).subscribe({
    next: (v) => setValue(() => v),
    error: (e) => console.error('liveQuery error', e),
  });
  onCleanup(() => sub.unsubscribe());
  return value;
}

/** Like createLiveQuery but re-creates the subscription whenever the reactive
 *  values read by `deps` change (Dexie can't see Solid signals). */
export function createReactiveLiveQuery<T, D>(
  deps: Accessor<D>,
  querier: (deps: D) => T | Promise<T>,
  initial: T,
): Accessor<T> {
  const [value, setValue] = createSignal<T>(initial);
  createMemo(() => {
    const d = deps();
    const sub = liveQuery(() => querier(d)).subscribe({
      next: (v) => setValue(() => v),
      error: (e) => console.error('liveQuery error', e),
    });
    onCleanup(() => sub.unsubscribe());
  });
  return value;
}
