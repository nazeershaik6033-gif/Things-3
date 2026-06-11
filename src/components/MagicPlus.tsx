import { onCleanup, onMount, type JSX } from 'solid-js';
import { createPan } from '../gestures/createPan';
import { createSpring, Spring, SPRING } from '../gestures/springs';
import { release, tryClaim } from '../gestures/arbiter';
import { Icon } from '../ui/Icon';
import { setQuickEntry, type QuickEntryState } from '../app/uiState';
import type { TaskDestination } from '../db/mutations';

export interface MagicPlusDrop {
  /** Row key the new task should be inserted before (null = end of list). */
  beforeKey: string | null;
  section: string;
}

/** The draggable blue + button. Tap → Quick Entry for the current list.
 *  Drag → an insertion gap follows the finger; drop creates the task there.
 *  Drag to the left edge → Inbox. */
export function MagicPlus(props: {
  defaultEntry: () => QuickEntryState;
  /** Where dropping at a slot should send the task; null = not droppable here. */
  entryForDrop?: (drop: MagicPlusDrop) => QuickEntryState | null;
  /** The scroll container that holds [data-reorder-row] rows. */
  listEl?: () => HTMLElement | null;
}): JSX.Element {
  let fab!: HTMLButtonElement;
  let inboxHint!: HTMLDivElement;

  onMount(() => {
    let sx!: Spring;
    let sy!: Spring;
    let sScale!: Spring;
    let dragging = false;
    let rows: { key: string; section: string; el: HTMLElement; top: number; height: number }[] = [];
    let gapSlot = -1;
    let overInbox = false;
    const shifts = new Map<HTMLElement, Spring>();
    let homeX = 0;
    let homeY = 0;

    const shiftFor = (el: HTMLElement): Spring => {
      let s = shifts.get(el);
      if (!s) {
        s = createSpring(0, (v) => {
          el.style.transform = v === 0 ? '' : `translate3d(0, ${v}px, 0)`;
        }, SPRING.flip);
        shifts.set(el, s);
      }
      return s;
    };

    const applyGap = (slot: number) => {
      const GAP = 52;
      for (let i = 0; i < rows.length; i++) {
        shiftFor(rows[i]!.el).to(slot >= 0 && i >= slot ? GAP : 0);
      }
    };

    const clearGap = () => {
      for (const [el, s] of shifts) {
        s.to(0, { onRest: () => (el.style.transform = '') });
      }
    };

    const cleanup = createPan(fab, {
      canStart: () => !!props.entryForDrop && tryClaim('magic-plus'),
      slop: 6,
      onStart: () => {
        dragging = true;
        const rect = fab.getBoundingClientRect();
        homeX = rect.left;
        homeY = rect.top;
        fab.style.willChange = 'transform';
        sScale.to(1.12);
        rows = [];
        const list = props.listEl?.();
        if (list) {
          for (const el of list.querySelectorAll<HTMLElement>('[data-reorder-row]')) {
            const r = el.getBoundingClientRect();
            rows.push({ key: el.dataset.key!, section: el.dataset.section ?? '', el, top: r.top, height: r.height });
          }
          rows.sort((a, b) => a.top - b.top);
        }
        if (inboxHint) inboxHint.style.opacity = '1';
      },
      onMove: (dx, dy, e) => {
        sx.set(dx);
        sy.set(dy);
        overInbox = e.clientX < 56;
        inboxHint?.style.setProperty('--hint-active', overInbox ? '1' : '0');
        let slot = -1;
        if (!overInbox && rows.length > 0) {
          slot = rows.length;
          for (let i = 0; i < rows.length; i++) {
            if (e.clientY < rows[i]!.top + rows[i]!.height / 2) {
              slot = i;
              break;
            }
          }
        }
        if (slot !== gapSlot) {
          gapSlot = slot;
          applyGap(slot);
        }
      },
      onEnd: () => {
        release('magic-plus');
        dragging = false;
        fab.style.willChange = '';
        if (inboxHint) inboxHint.style.opacity = '0';
        const slot = gapSlot;
        gapSlot = -1;
        clearGap();
        sScale.to(1);
        sx.to(0, SPRING.bouncy.stiffness ? { velocity: 0 } : {});
        sy.to(0);

        if (overInbox) {
          overInbox = false;
          setQuickEntry({ destination: { bucket: 'inbox' } });
          return;
        }
        if (slot >= 0 && props.entryForDrop) {
          const target = slot < rows.length ? rows[slot]! : null;
          const drop: MagicPlusDrop = {
            beforeKey: target?.key ?? null,
            section: target?.section ?? rows[rows.length - 1]?.section ?? '',
          };
          const entry = props.entryForDrop(drop);
          if (entry) setQuickEntry(entry);
        }
      },
      onCancel: () => {
        release('magic-plus');
        dragging = false;
        gapSlot = -1;
        clearGap();
        sScale.to(1);
        sx.to(0);
        sy.to(0);
        if (inboxHint) inboxHint.style.opacity = '0';
      },
    });

    let x = 0;
    let y = 0;
    let scale = 1;
    const apply = () => {
      fab.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    };
    sx = createSpring(0, (v) => { x = v; apply(); }, SPRING.bouncy);
    sy = createSpring(0, (v) => { y = v; apply(); }, SPRING.bouncy);
    sScale = createSpring(1, (v) => { scale = v; apply(); }, SPRING.bouncy);
    void dragging;
    void homeX;
    void homeY;

    onCleanup(cleanup);
  });

  return (
    <>
      <div
        ref={inboxHint}
        style={{
          position: 'fixed',
          left: '10px',
          top: '50%',
          transform: 'translateY(-50%)',
          opacity: '0',
          transition: 'opacity 150ms ease',
          'z-index': '49',
          background: 'var(--blue)',
          color: '#fff',
          'border-radius': '12px',
          padding: '10px 8px',
          display: 'flex',
          'flex-direction': 'column',
          'align-items': 'center',
          gap: '4px',
          'font-size': '11px',
          'font-weight': '600',
          'box-shadow': 'var(--shadow-fab)',
          scale: 'calc(1 + 0.15 * var(--hint-active, 0))',
        }}
        aria-hidden="true"
      >
        <Icon name="inbox" size={18} />
        Inbox
      </div>
      <button
        ref={fab}
        data-testid="magic-plus"
        aria-label="New To-Do"
        onClick={() => setQuickEntry(props.defaultEntry())}
        style={{
          position: 'fixed',
          right: '22px',
          bottom: `calc(24px + var(--safe-bottom))`,
          width: '56px',
          height: '56px',
          'border-radius': '50%',
          background: 'var(--blue)',
          color: '#fff',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          'box-shadow': 'var(--shadow-fab)',
          'z-index': '50',
          'touch-action': 'none',
        }}
      >
        <Icon name="plus" size={26} />
      </button>
    </>
  );
}
