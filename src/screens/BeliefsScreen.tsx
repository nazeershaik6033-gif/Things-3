import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import type { Belief } from '../db/models';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { currentDate } from '../app/currentDate';
import { haptic, staggerDelay } from '../app/motion';
import { formatRelative, weekdayName } from '../domain/dates';
import {
  activeBeliefs, beliefMomentum, beliefStreak, beliefTrend, boardMomentum,
  BELIEF_EXAMPLES, evidenceCounts, evidenceFor, latestScore, MAX_SCORE,
  ratingsOn, recentBeliefDays, scoreColor, scoreLabel, sessionProgress,
} from '../domain/beliefs';
import {
  addEvidence, archiveBelief, createBelief, deleteBelief, deleteEvidence,
  restoreBelief, setConviction, updateBelief,
} from '../db/beliefMutations';
import { quoteForDate, attribution } from '../domain/quotes';
import { BeliefSession } from '../components/BeliefSession';
import { QuoteSheet } from '../components/QuoteCard';
import { Icon } from '../ui/Icon';
import { ProgressRing } from '../ui/ProgressRing';
import { Sheet, SheetTitle } from '../ui/Sheet';
import { ScreenChrome, EmptyState } from './common';

/** The belief board.
 *
 *  Deliberately not a habit list and deliberately not a Kanban of stages: a
 *  belief has a conviction that moves, so the unit is a score per day and the
 *  thing that moves it is evidence. Everything here is in service of one loop —
 *  say it, score it honestly, catch the proof. */

/** Fourteen days of one belief's scores, drawn as bars. Missing days stay
 *  empty rather than being carried forward: seeing the gaps is the point. */
function Sparkline(props: { trend: Array<{ score: number | null }>; color: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', 'align-items': 'flex-end', gap: '2px', height: '22px' }}>
      <For each={props.trend}>
        {(day) => (
          <div
            style={{
              flex: '1',
              height: day.score === null ? '3px' : `${Math.max(12, (day.score / MAX_SCORE) * 100)}%`,
              'min-height': '3px',
              'border-radius': '2px',
              background: day.score === null ? 'var(--bg-row-active)' : props.color,
              opacity: day.score === null ? '1' : '0.85',
            }}
          />
        )}
      </For>
    </div>
  );
}

function MomentumTag(props: { delta: number | null }): JSX.Element {
  return (
    <Show when={props.delta !== null && Math.abs(props.delta) >= 0.5}>
      <span
        style={{
          'font-size': '12px',
          'font-weight': '700',
          'font-variant-numeric': 'tabular-nums',
          color: props.delta! > 0 ? 'var(--green)' : 'var(--red)',
        }}
      >
        {props.delta! > 0 ? '↑' : '↓'} {Math.abs(props.delta!).toFixed(1)}
      </span>
    </Show>
  );
}

export function BeliefsScreen(): JSX.Element {
  const beliefs = createLiveQuery(() => db.beliefs.toArray(), []);
  const ratings = createLiveQuery(() => db.beliefRatings.toArray(), []);
  const evidence = createLiveQuery(() => db.beliefEvidence.toArray(), []);
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [sessionOpen, setSessionOpen] = createSignal(false);
  const [detailId, setDetailId] = createSignal<string | null>(null);
  const [quoteOpen, setQuoteOpen] = createSignal(false);

  const today = (): string => currentDate();
  const listed = createMemo(() => activeBeliefs(beliefs()));
  const retired = createMemo(() => beliefs().filter((b) => !b.active));
  const progress = createMemo(() => sessionProgress(beliefs(), ratings(), today()));
  const streak = createMemo(() => beliefStreak(beliefs(), ratings(), today()));
  const history = createMemo(() => recentBeliefDays(beliefs(), ratings(), today(), 14));
  const momentum = createMemo(() => boardMomentum(beliefs(), ratings(), today(), 14));
  const todaysScores = createMemo(() => ratingsOn(ratings(), today()));
  const counts = createMemo(() => evidenceCounts(evidence()));
  const quote = createMemo(() => quoteForDate(today()));
  const detail = createMemo(() => beliefs().find((b) => b.id === detailId()) ?? null);

  const addBelief = (): void => {
    const text = draft().trim();
    if (!text) return;
    setDraft('');
    void createBelief(text);
  };

  return (
    <ScreenChrome
      title="Beliefs"
      icon={<Icon name="sparkle" size={28} color="var(--purple)" />}
      subtitle={`${weekdayName(today())} · ${formatRelative(today(), today())}`}
      trailing={
        <button
          data-testid="beliefs-edit"
          onClick={() => setEditing(!editing())}
          style={{
            color: 'var(--blue)',
            padding: '8px 10px',
            'font-size': '16px',
            'font-weight': editing() ? '600' : '400',
          }}
        >
          {editing() ? 'Done' : 'Edit'}
        </button>
      }
    >
      <Show when={listed().length > 0}>
        <div
          class="rise"
          data-testid="beliefs-hero"
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '16px',
            margin: '2px 16px 12px',
            padding: '16px',
            'border-radius': 'var(--radius-card)',
            background: 'var(--bg-inset)',
          }}
        >
          <ProgressRing
            progress={progress().ratio}
            size={72}
            thickness={7}
            color={progress().complete ? 'var(--green)' : 'var(--purple)'}
          >
            <span style={{ 'font-size': '17px', 'font-weight': '700', 'font-variant-numeric': 'tabular-nums' }}>
              {progress().average === null ? '—' : progress().average!.toFixed(1)}
            </span>
          </ProgressRing>
          <div style={{ flex: '1', 'min-width': '0' }}>
            <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
              <span style={{ 'font-size': '17px', 'font-weight': '600' }}>
                {progress().complete
                  ? 'All spoken today'
                  : progress().rated === 0
                    ? 'Not spoken yet today'
                    : `${progress().total - progress().rated} left today`}
              </span>
              <MomentumTag delta={momentum()} />
            </div>
            <div
              data-testid="beliefs-streak"
              style={{
                display: 'flex',
                'align-items': 'center',
                gap: '5px',
                'margin-top': '4px',
                color: 'var(--text-secondary)',
                'font-size': '14px',
              }}
            >
              <Icon name="flame" size={15} color={streak() > 0 ? 'var(--red)' : 'var(--text-tertiary)'} />
              {streak() === 0 ? 'No streak yet' : `${streak()}-day streak`}
            </div>
            <div style={{ display: 'flex', gap: '3px', 'margin-top': '10px' }}>
              <For each={history()}>
                {(day) => (
                  <div
                    title={`${day.date}${day.average === null ? '' : ` · ${day.average.toFixed(1)}`}`}
                    style={{
                      flex: '1',
                      height: '6px',
                      'border-radius': '3px',
                      background:
                        day.average === null
                          ? 'var(--bg-row-active)'
                          : scoreColor(day.average),
                      opacity: day.complete || day.average === null ? '1' : '0.45',
                    }}
                  />
                )}
              </For>
            </div>
          </div>
        </div>

        <div style={{ padding: '0 16px 14px' }}>
          <button
            data-testid="beliefs-start"
            class="pressable"
            onClick={() => {
              haptic('select');
              setSessionOpen(true);
            }}
            style={{
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              gap: '8px',
              width: '100%',
              padding: '13px',
              'border-radius': '13px',
              background: progress().complete ? 'var(--bg-inset)' : 'var(--blue)',
              color: progress().complete ? 'var(--text)' : 'var(--text-invert)',
              'font-size': '16px',
              'font-weight': '600',
            }}
          >
            <Icon name="send" size={17} color={progress().complete ? 'var(--text)' : 'var(--text-invert)'} />
            {progress().complete
              ? 'Say them again'
              : progress().rated > 0
                ? 'Continue the session'
                : 'Say them out loud'}
          </button>
        </div>
      </Show>

      <Show
        when={listed().length > 0}
        fallback={
          <>
            <EmptyState
              icon={<Icon name="sparkle" size={44} color="var(--text-tertiary)" />}
              text="A belief here is a sentence you are deliberately installing. Write it in the first person, present tense — then say it out loud each day and score how much of you actually believes it."
            />
            <div style={{ padding: '0 20px 10px' }}>
              <div
                style={{
                  'font-size': '12px',
                  'font-weight': '700',
                  'letter-spacing': '0.05em',
                  'text-transform': 'uppercase',
                  color: 'var(--text-tertiary)',
                  'padding-bottom': '8px',
                }}
              >
                The shape of one
              </div>
              <For each={BELIEF_EXAMPLES.slice(0, 3)}>
                {(example) => (
                  <div
                    style={{
                      'font-size': '15px',
                      'line-height': '1.5',
                      color: 'var(--text-tertiary)',
                      'font-style': 'italic',
                      'padding-bottom': '4px',
                    }}
                  >
                    “{example}”
                  </div>
                )}
              </For>
              <p style={{ 'margin-top': '10px', 'font-size': '13px', color: 'var(--text-tertiary)', 'line-height': '1.45' }}>
                Yours, not these. Write the first one below.
              </p>
            </div>
          </>
        }
      >
        <div style={{ margin: '0 10px' }}>
          <For each={listed()}>
            {(belief, i) => {
              const score = (): number | null => {
                const s = todaysScores().get(belief.id);
                return s === undefined ? null : s;
              };
              const carried = (): number | null => latestScore(ratings(), belief.id, today());
              const trend = createMemo(() => beliefTrend(ratings(), belief.id, today(), 14));
              const delta = createMemo(() => beliefMomentum(ratings(), belief.id, today(), 14));
              return (
                <div
                  class="rise pressable-card"
                  data-testid="belief-card"
                  onClick={() => !editing() && setDetailId(belief.id)}
                  style={{
                    'margin-bottom': '10px',
                    padding: '14px',
                    'border-radius': '16px',
                    background: 'var(--bg-list)',
                    border: '1px solid var(--separator)',
                    'border-left': `3px solid ${belief.color}`,
                    'animation-delay': staggerDelay(i()),
                    cursor: editing() ? 'default' : 'pointer',
                  }}
                >
                  <Show
                    when={!editing()}
                    fallback={
                      <div style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
                        <input
                          value={belief.text}
                          onInput={(e) => void updateBelief(belief.id, { text: e.currentTarget.value })}
                          placeholder="Belief"
                          style={{ flex: '1', 'font-size': '15px' }}
                        />
                        <button
                          aria-label={`Retire ${belief.text}`}
                          onClick={() => void archiveBelief(belief.id)}
                          style={{ color: 'var(--text-secondary)', padding: '6px', display: 'flex' }}
                        >
                          <Icon name="archive" size={18} />
                        </button>
                        <button
                          aria-label={`Delete ${belief.text}`}
                          onClick={() => void deleteBelief(belief.id)}
                          style={{ color: 'var(--red)', padding: '6px', display: 'flex' }}
                        >
                          <Icon name="trash" size={18} />
                        </button>
                      </div>
                    }
                  >
                    <div style={{ 'font-size': '16px', 'font-weight': '600', 'line-height': '1.35' }}>
                      {belief.text || 'Untitled belief'}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        'align-items': 'center',
                        gap: '10px',
                        'margin-top': '10px',
                      }}
                    >
                      <span
                        data-testid="belief-score"
                        style={{
                          'font-size': '15px',
                          'font-weight': '700',
                          'font-variant-numeric': 'tabular-nums',
                          color: carried() === null ? 'var(--text-tertiary)' : scoreColor(carried()!),
                        }}
                      >
                        {carried() === null ? '—' : `${carried()}/${MAX_SCORE}`}
                      </span>
                      <span style={{ 'font-size': '13px', color: 'var(--text-secondary)', flex: '1', 'min-width': '0', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>
                        {carried() === null ? 'Not rated yet' : scoreLabel(carried()!)}
                      </span>
                      <MomentumTag delta={delta()} />
                    </div>
                    <div style={{ 'margin-top': '10px' }}>
                      <Sparkline trend={trend()} color={belief.color} />
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        'align-items': 'center',
                        gap: '12px',
                        'margin-top': '10px',
                        'font-size': '12px',
                        color: 'var(--text-tertiary)',
                      }}
                    >
                      <span style={{ display: 'flex', 'align-items': 'center', gap: '4px' }}>
                        <Icon name="checklist" size={12} color="var(--text-tertiary)" />
                        {counts().get(belief.id) ?? 0} evidence
                      </span>
                      <Show when={score() !== null}>
                        <span style={{ color: 'var(--green)', 'font-weight': '600' }}>Spoken today</span>
                      </Show>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </Show>

      <Show when={editing()}>
        <div style={{ display: 'flex', gap: '8px', margin: '4px 16px 0' }}>
          <input
            data-testid="belief-new"
            value={draft()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && addBelief()}
            placeholder="I am the kind of person who…"
            style={{ flex: '1', padding: '10px 12px', 'border-radius': '11px', background: 'var(--bg-inset)' }}
          />
          <button onClick={addBelief} style={{ color: 'var(--blue)', 'font-weight': '600', padding: '8px 6px' }}>
            Add
          </button>
        </div>
        <p style={{ padding: '12px 18px 0', color: 'var(--text-secondary)', 'font-size': '13px', 'line-height': '1.45' }}>
          Retiring a belief takes it out of the daily session but keeps every rating and piece of
          evidence it gathered. Deleting throws both away.
        </p>
        <Show when={retired().length > 0}>
          <div style={{ padding: '16px 18px 0' }}>
            <div
              style={{
                'font-size': '12px',
                'font-weight': '700',
                'letter-spacing': '0.05em',
                'text-transform': 'uppercase',
                color: 'var(--text-tertiary)',
                'padding-bottom': '8px',
              }}
            >
              Retired
            </div>
            <For each={retired()}>
              {(belief) => (
                <div style={{ display: 'flex', 'align-items': 'center', gap: '10px', padding: '6px 0' }}>
                  <span style={{ flex: '1', 'font-size': '15px', color: 'var(--text-secondary)' }}>
                    {belief.text || 'Untitled belief'}
                  </span>
                  <button
                    aria-label={`Restore ${belief.text}`}
                    onClick={() => void restoreBelief(belief.id)}
                    style={{ color: 'var(--blue)', padding: '6px', display: 'flex' }}
                  >
                    <Icon name="restore" size={18} />
                  </button>
                  <button
                    aria-label={`Delete ${belief.text}`}
                    onClick={() => void deleteBelief(belief.id)}
                    style={{ color: 'var(--red)', padding: '6px', display: 'flex' }}
                  >
                    <Icon name="trash" size={18} />
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>

      <Show when={quote() && !editing()}>
        <button
          data-testid="beliefs-quote"
          class="pressable-card no-select"
          onClick={() => setQuoteOpen(true)}
          style={{
            display: 'block',
            width: 'calc(100% - 32px)',
            margin: '18px 16px calc(var(--safe-bottom) + 24px)',
            padding: '14px',
            'border-radius': '16px',
            background: 'var(--bg-inset)',
            'text-align': 'left',
          }}
        >
          <div
            style={{
              'font-size': '12px',
              'font-weight': '700',
              'letter-spacing': '0.05em',
              'text-transform': 'uppercase',
              color: 'var(--text-tertiary)',
              'padding-bottom': '7px',
            }}
          >
            Today’s brain food
          </div>
          <div style={{ 'font-size': '15px', 'line-height': '1.45' }}>{quote()!.text}</div>
          <div style={{ 'margin-top': '7px', 'font-size': '13px', color: 'var(--text-secondary)' }}>
            — {attribution(quote()!)}
          </div>
        </button>
      </Show>

      <Show when={sessionOpen()}>
        <BeliefSession
          beliefs={beliefs()}
          ratings={ratings()}
          today={today()}
          onClose={() => setSessionOpen(false)}
        />
      </Show>

      <Show when={quoteOpen() && quote()}>
        <QuoteSheet quote={quote()!} onClose={() => setQuoteOpen(false)} />
      </Show>

      <Show when={detail()}>
        <BeliefDetail belief={detail()!} onClose={() => setDetailId(null)} />
      </Show>
    </ScreenChrome>
  );
}

/** One belief up close: what it is, where its conviction has been, and every
 *  piece of evidence you have caught for it. */
function BeliefDetail(props: { belief: Belief; onClose: () => void }): JSX.Element {
  const ratings = createLiveQuery(() => db.beliefRatings.toArray(), []);
  const evidence = createLiveQuery(() => db.beliefEvidence.toArray(), []);
  const [draft, setDraft] = createSignal('');
  const today = (): string => currentDate();

  const trend = createMemo(() => beliefTrend(ratings(), props.belief.id, today(), 14));
  const delta = createMemo(() => beliefMomentum(ratings(), props.belief.id, today(), 14));
  const score = createMemo(() => latestScore(ratings(), props.belief.id, today()));
  const rows = createMemo(() => evidenceFor(evidence(), props.belief.id));

  const add = (): void => {
    const text = draft().trim();
    if (!text) return;
    setDraft('');
    haptic('success');
    void addEvidence(props.belief.id, today(), text);
  };

  return (
    <Sheet onClose={props.onClose} maxWidth={520}>
      <SheetTitle>{props.belief.text || 'Untitled belief'}</SheetTitle>
      <div style={{ padding: '0 20px 22px' }}>
        <div style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
          <span
            style={{
              'font-size': '22px',
              'font-weight': '700',
              'font-variant-numeric': 'tabular-nums',
              color: score() === null ? 'var(--text-tertiary)' : scoreColor(score()!),
            }}
          >
            {score() === null ? '—' : `${score()}/${MAX_SCORE}`}
          </span>
          <span style={{ flex: '1', 'font-size': '14px', color: 'var(--text-secondary)' }}>
            {score() === null ? 'Not rated yet' : scoreLabel(score()!)}
          </span>
          <MomentumTag delta={delta()} />
        </div>

        <div style={{ 'margin-top': '14px' }}>
          <Sparkline trend={trend()} color={props.belief.color} />
          <div style={{ 'margin-top': '6px', 'font-size': '12px', color: 'var(--text-tertiary)' }}>
            Last 14 days
          </div>
        </div>

        <div style={{ 'margin-top': '18px' }}>
          <label
            for="belief-why"
            style={{ 'font-size': '13px', 'font-weight': '600', color: 'var(--text-secondary)' }}
          >
            Why it matters
          </label>
          <input
            id="belief-why"
            data-testid="belief-why"
            value={props.belief.why}
            onInput={(e) => void updateBelief(props.belief.id, { why: e.currentTarget.value })}
            placeholder="The story this replaces…"
            style={{
              width: '100%',
              'margin-top': '8px',
              padding: '11px 12px',
              'border-radius': '12px',
              background: 'var(--bg-inset)',
              'font-size': '15px',
            }}
          />
        </div>

        <div style={{ 'margin-top': '20px' }}>
          <div style={{ 'font-size': '13px', 'font-weight': '600', color: 'var(--text-secondary)' }}>
            Evidence ({rows().length})
          </div>
          <div style={{ display: 'flex', gap: '8px', 'margin-top': '8px' }}>
            <input
              data-testid="belief-evidence-new"
              value={draft()}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="What happened that argues this is true?"
              style={{
                flex: '1',
                padding: '11px 12px',
                'border-radius': '12px',
                background: 'var(--bg-inset)',
                'font-size': '15px',
              }}
            />
            <button onClick={add} style={{ color: 'var(--blue)', 'font-weight': '600', padding: '8px 6px' }}>
              Add
            </button>
          </div>
          <Show
            when={rows().length > 0}
            fallback={
              <p style={{ 'margin-top': '12px', 'font-size': '13px', color: 'var(--text-tertiary)', 'line-height': '1.45' }}>
                Nothing yet. Conviction moves on evidence — one line a day is enough.
              </p>
            }
          >
            <div style={{ 'margin-top': '12px' }}>
              <For each={rows()}>
                {(row) => (
                  <div
                    style={{
                      display: 'flex',
                      'align-items': 'flex-start',
                      gap: '10px',
                      padding: '9px 0',
                      'border-bottom': '1px solid var(--separator)',
                    }}
                  >
                    <div style={{ flex: '1', 'min-width': '0' }}>
                      <div style={{ 'font-size': '15px', 'line-height': '1.4' }}>{row.text}</div>
                      <div style={{ 'margin-top': '3px', 'font-size': '12px', color: 'var(--text-tertiary)' }}>
                        {formatRelative(row.date, today())}
                      </div>
                    </div>
                    <button
                      aria-label="Delete evidence"
                      onClick={() => void deleteEvidence(row.id)}
                      style={{ color: 'var(--text-tertiary)', padding: '4px', display: 'flex' }}
                    >
                      <Icon name="close" size={15} />
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        <div style={{ 'margin-top': '20px' }}>
          <div style={{ 'font-size': '13px', 'font-weight': '600', color: 'var(--text-secondary)', 'padding-bottom': '8px' }}>
            Rate it now
          </div>
          <div style={{ display: 'flex', gap: '5px' }}>
            <For each={Array.from({ length: MAX_SCORE + 1 }, (_, i) => i)}>
              {(n) => (
                <button
                  aria-label={`Set conviction ${n}`}
                  data-testid={`detail-conviction-${n}`}
                  onClick={() => {
                    haptic('tick');
                    void setConviction(props.belief.id, today(), n);
                  }}
                  style={{
                    flex: '1',
                    'min-width': '0',
                    height: '36px',
                    'border-radius': '10px',
                    'font-size': '13px',
                    'font-weight': '600',
                    'font-variant-numeric': 'tabular-nums',
                    background: 'var(--bg-inset)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {n}
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
