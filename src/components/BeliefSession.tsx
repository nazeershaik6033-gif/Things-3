import {
  createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX,
} from 'solid-js';
import type { Belief, BeliefRating, DateStr } from '../db/models';
import { createPan } from '../gestures/createPan';
import { createSpring, rubberband, SPRING, type Spring } from '../gestures/springs';
import { release, tryClaim } from '../gestures/arbiter';
import { haptic, reduceMotion } from '../app/motion';
import {
  beliefsOnDate, latestScore, MAX_SCORE, ratingsOn, scoreColor, scoreLabel,
  sessionProgress,
} from '../domain/beliefs';
import { addEvidence, setConviction } from '../db/beliefMutations';
import { attribution, quoteForDate } from '../domain/quotes';
import { FullScreenSheet } from '../ui/FullScreenSheet';
import { Icon } from '../ui/Icon';

/** The daily session: one belief at a time, full screen, said out loud.
 *
 *  Reading a list silently is rehearsal; saying one sentence aloud and then
 *  putting a number on how much of you actually believes it is retrieval plus
 *  honesty, which is the part that moves. So the card shows exactly one
 *  statement, asks for it out loud, takes a conviction score, and offers to
 *  catch the evidence while it is still fresh. */

const DOTS = Array.from({ length: MAX_SCORE + 1 }, (_, i) => i);

function ConvictionDots(props: {
  value: number | null;
  ghost: number | null;
  onPick: (score: number) => void;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: '6px', 'justify-content': 'space-between' }}>
      <For each={DOTS}>
        {(n) => {
          const selected = (): boolean => props.value === n;
          const filled = (): boolean => props.value !== null && n <= props.value;
          const isGhost = (): boolean => props.value === null && props.ghost === n;
          return (
            <button
              aria-label={`Conviction ${n} of ${MAX_SCORE}`}
              data-testid={`conviction-${n}`}
              class="no-select"
              onClick={() => props.onPick(n)}
              style={{
                flex: '1',
                'min-width': '0',
                height: '42px',
                'border-radius': '11px',
                'font-size': '14px',
                'font-weight': selected() ? '700' : '600',
                'font-variant-numeric': 'tabular-nums',
                color: filled() ? 'var(--text-invert)' : 'var(--text-secondary)',
                background: filled()
                  ? props.value !== null ? scoreColor(props.value) : 'var(--bg-inset)'
                  : 'var(--bg-inset)',
                opacity: filled() && !selected() ? '0.55' : '1',
                border: isGhost() ? '2px dashed var(--text-tertiary)' : '2px solid transparent',
                transition: reduceMotion() ? 'none' : 'background 140ms, opacity 140ms',
              }}
            >
              {n}
            </button>
          );
        }}
      </For>
    </div>
  );
}

export function BeliefSession(props: {
  beliefs: Belief[];
  ratings: BeliefRating[];
  today: DateStr;
  onClose: () => void;
}): JSX.Element {
  const due = createMemo(() => beliefsOnDate(props.beliefs, props.today));
  const [index, setIndex] = createSignal(0);
  const [draft, setDraft] = createSignal('');
  const quote = createMemo(() => quoteForDate(props.today));

  let cardEl!: HTMLDivElement;
  let spring: Spring | undefined;

  const total = (): number => due().length;
  const onSummary = (): boolean => index() >= total();
  const belief = (): Belief | null => due()[index()] ?? null;

  const todaysScores = createMemo(() => ratingsOn(props.ratings, props.today));
  const score = (): number | null => {
    const b = belief();
    if (!b) return null;
    const s = todaysScores().get(b.id);
    return s === undefined ? null : s;
  };
  /** What you said last time, shown as an outline you are free to ignore.
   *  Pre-selecting it would be a leading question. */
  const ghost = (): number | null => {
    const b = belief();
    if (!b) return null;
    return latestScore(props.ratings.filter((r) => r.date < props.today), b.id, props.today);
  };

  const progress = createMemo(() => sessionProgress(props.beliefs, props.ratings, props.today));

  /** Flush whatever evidence was typed before the card leaves. */
  const commitDraft = (): void => {
    const b = belief();
    const text = draft().trim();
    if (b && text) void addEvidence(b.id, props.today, text);
    setDraft('');
  };

  const settle = (from: number): void => {
    if (!spring) return;
    spring.set(from);
    spring.to(0);
  };

  const go = (delta: number): void => {
    const next = Math.min(total(), Math.max(0, index() + delta));
    if (next === index()) {
      settle(0);
      return;
    }
    commitDraft();
    haptic('select');
    setIndex(next);
    settle(delta > 0 ? width() : -width());
  };

  const width = (): number => cardEl?.getBoundingClientRect().width || window.innerWidth;

  const pick = (n: number): void => {
    const b = belief();
    if (!b) return;
    haptic('tick');
    void setConviction(b.id, props.today, n);
  };

  onMount(() => {
    spring = createSpring(0, (v) => {
      cardEl.style.transform = v === 0 ? '' : `translate3d(${v}px, 0, 0)`;
      // Fade with distance so a half-swipe reads as "this card is leaving",
      // not as a card that got stuck mid-slide.
      cardEl.style.opacity = String(Math.max(0.25, 1 - Math.abs(v) / (width() || 1)));
    }, SPRING.nav);

    const cleanup = createPan(cardEl, {
      axis: 'x',
      canStart: () => tryClaim('belief-card'),
      onStart: () => {},
      onMove: (dx) => {
        const atStart = index() === 0 && dx > 0;
        const atEnd = onSummary() && dx < 0;
        spring?.set(atStart || atEnd ? rubberband(dx, 120) : dx);
      },
      onEnd: (vx, _vy, dx) => {
        release('belief-card');
        const w = width();
        if ((dx < -w * 0.25 || vx < -450) && !onSummary()) go(1);
        else if ((dx > w * 0.25 || vx > 450) && index() > 0) go(-1);
        else spring?.to(0, { velocity: vx });
      },
      onCancel: () => {
        release('belief-card');
        spring?.to(0);
      },
    });
    onCleanup(cleanup);

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  // A belief deleted from under the session (or an empty board) must not leave
  // the flow pointing past the end with nothing to show.
  createEffect(() => {
    if (total() === 0) props.onClose();
  });

  return (
    <FullScreenSheet onClose={props.onClose} label="Belief session">
      <div style={{ display: 'flex', 'align-items': 'center', gap: '10px', padding: '6px 16px 2px' }}>
        <span
          data-testid="session-position"
          style={{
            'font-size': '12px',
            'font-weight': '700',
            'letter-spacing': '0.05em',
            'text-transform': 'uppercase',
            color: 'var(--text-tertiary)',
          }}
        >
          {onSummary() ? 'Done for today' : `${index() + 1} of ${total()}`}
        </span>
        <span style={{ flex: '1' }} />
        <button
          onClick={() => {
            commitDraft();
            props.onClose();
          }}
          aria-label="Close session"
          data-testid="session-close"
          style={{ color: 'var(--text-secondary)', padding: '6px', display: 'flex' }}
        >
          <Icon name="close" size={20} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: '4px', padding: '4px 16px 0' }}>
        <For each={due()}>
          {(b, i) => (
            <div
              style={{
                flex: '1',
                height: '3px',
                'border-radius': '2px',
                background:
                  todaysScores().has(b.id)
                    ? 'var(--green)'
                    : i() === index()
                      ? 'var(--text-secondary)'
                      : 'var(--bg-inset)',
              }}
            />
          )}
        </For>
      </div>

      <div
        ref={cardEl}
        class="no-select"
        style={{
          flex: '1',
          'min-height': '0',
          'overflow-y': 'auto',
          padding: '10px 20px 20px',
          'touch-action': 'pan-y',
          'will-change': 'transform',
        }}
      >
        <Show
          when={!onSummary() && belief()}
          fallback={
            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '16px', 'padding-top': '18px' }}>
              <div style={{ 'font-size': '24px', 'font-weight': '700' }}>
                {progress().complete ? 'Every belief spoken.' : 'Session ended.'}
              </div>
              <div data-testid="session-summary" style={{ 'font-size': '16px', color: 'var(--text-secondary)', 'line-height': '1.5' }}>
                {progress().rated} of {progress().total} rated
                <Show when={progress().average !== null}>
                  {' · '}average conviction{' '}
                  <span style={{ color: scoreColor(progress().average!), 'font-weight': '700' }}>
                    {progress().average!.toFixed(1)}
                  </span>
                </Show>
              </div>
              <Show when={quote()}>
                <div
                  style={{
                    'margin-top': '4px',
                    padding: '16px',
                    'border-radius': '14px',
                    background: 'var(--bg-inset)',
                  }}
                >
                  <div style={{ 'font-size': '16px', 'line-height': '1.45', 'font-weight': '500' }}>
                    {quote()!.text}
                  </div>
                  <div style={{ 'margin-top': '8px', 'font-size': '13px', color: 'var(--text-secondary)' }}>
                    — {attribution(quote()!)}
                  </div>
                </div>
              </Show>
              <p style={{ 'font-size': '14px', color: 'var(--text-tertiary)', 'line-height': '1.5' }}>
                Conviction moves on evidence, not repetition. Come back tonight and add the one thing
                that happened today which argues the belief is true.
              </p>
            </div>
          }
        >
          <div style={{ 'padding-top': '12px' }}>
            <div
              style={{
                display: 'flex',
                'align-items': 'center',
                gap: '7px',
                'font-size': '13px',
                'font-weight': '600',
                color: belief()!.color,
              }}
            >
              <Icon name="send" size={14} color={belief()!.color} />
              Say it out loud
            </div>
            <div
              data-testid="session-belief"
              style={{
                'margin-top': '14px',
                'font-size': '26px',
                'line-height': '1.28',
                'font-weight': '700',
                'letter-spacing': '-0.01em',
              }}
            >
              {belief()!.text}
            </div>
            <Show when={belief()!.why}>
              <div style={{ 'margin-top': '12px', 'font-size': '15px', 'line-height': '1.5', color: 'var(--text-secondary)' }}>
                {belief()!.why}
              </div>
            </Show>

            <div style={{ 'margin-top': '26px' }}>
              <div style={{ display: 'flex', 'align-items': 'baseline', gap: '8px', 'padding-bottom': '10px' }}>
                <span style={{ 'font-size': '15px', 'font-weight': '600' }}>
                  How much of you believes it, right now?
                </span>
              </div>
              <ConvictionDots value={score()} ghost={ghost()} onPick={pick} />
              <div
                data-testid="session-score-label"
                style={{
                  'margin-top': '10px',
                  'font-size': '14px',
                  'font-weight': '600',
                  color: score() === null ? 'var(--text-tertiary)' : scoreColor(score()!),
                }}
              >
                {score() === null
                  ? ghost() === null
                    ? 'Pick a number — 0 is “not yet”, 10 is “I live from it”'
                    : `Last time you said ${ghost()}`
                  : scoreLabel(score()!)}
              </div>
            </div>

            <div style={{ 'margin-top': '24px' }}>
              <label
                for="belief-evidence"
                style={{ 'font-size': '13px', 'font-weight': '600', color: 'var(--text-secondary)' }}
              >
                Evidence from today (optional)
              </label>
              <input
                id="belief-evidence"
                data-testid="session-evidence"
                value={draft()}
                onInput={(e) => setDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitDraft();
                    haptic('success');
                  }
                }}
                placeholder="Something that happened that argues this is true…"
                style={{
                  width: '100%',
                  'margin-top': '8px',
                  padding: '12px',
                  'border-radius': '12px',
                  background: 'var(--bg-inset)',
                  'font-size': '15px',
                }}
              />
            </div>
          </div>
        </Show>
      </div>

      <div
        style={{
          display: 'flex',
          gap: '10px',
          padding: '10px 20px calc(var(--safe-bottom) + 14px)',
          flex: 'none',
        }}
      >
        <Show when={index() > 0}>
          <button
            data-testid="session-back"
            onClick={() => go(-1)}
            style={{
              padding: '13px 18px',
              'border-radius': '13px',
              background: 'var(--bg-inset)',
              'font-size': '16px',
              'font-weight': '600',
            }}
          >
            Back
          </button>
        </Show>
        <button
          data-testid="session-next"
          onClick={() => {
            if (onSummary()) {
              commitDraft();
              haptic('success');
              props.onClose();
            } else {
              go(1);
            }
          }}
          style={{
            flex: '1',
            padding: '13px 18px',
            'border-radius': '13px',
            background: 'var(--blue)',
            color: 'var(--text-invert)',
            'font-size': '16px',
            'font-weight': '600',
          }}
        >
          {onSummary() ? 'Done' : index() === total() - 1 ? 'Finish' : 'Next'}
        </button>
      </div>
    </FullScreenSheet>
  );
}
