import { createMemo, createSignal, Show, type JSX } from 'solid-js';
import type { DateStr } from '../db/models';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { haptic, staggerDelay } from '../app/motion';
import { aiConfig } from '../app/settings';
import { aiChat, digestReady, openInClaude, providerLabel } from '../net/ai';
import {
  attribution, deeperPrompt, quoteForDate, TOPIC_COLOR, TOPIC_LABEL, type BrainQuote,
} from '../domain/quotes';
import { saveQuoteNote, toggleQuoteFavorite } from '../db/beliefMutations';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';
import { MarkdownView } from './MarkdownView';

/** Today's line about the brain, and the sheet behind it.
 *
 *  The library ships with the app, so this card is the same offline as on
 *  wifi. The only thing that ever reaches the network is "Go deeper", and only
 *  when you tap it: either a hand-off to the Claude app, or a call to your own
 *  provider whose answer is cached so it is asked once and read forever. */

export function todaysQuote(date: DateStr): BrainQuote | null {
  return quoteForDate(date);
}

function QuoteMark(props: { color: string }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{
        'font-size': '34px',
        'line-height': '0.8',
        'font-weight': '700',
        color: props.color,
        opacity: '0.35',
        'font-family': 'Georgia, serif',
      }}
    >
      “
    </span>
  );
}

/** The full-width card on Home. */
export function QuoteCard(props: { today: DateStr; delayIndex?: number }): JSX.Element {
  const quote = createMemo(() => todaysQuote(props.today));
  const [open, setOpen] = createSignal(false);
  const favorites = createLiveQuery(() => db.quoteFavorites.toArray(), []);
  const saved = createMemo(() => {
    const q = quote();
    return !!q && favorites().some((f) => f.id === q.id);
  });

  return (
    <Show when={quote()}>
      <button
        class="pressable-card rise no-select"
        data-testid="home-quote"
        onClick={() => {
          haptic('select');
          setOpen(true);
        }}
        style={{
          display: 'block',
          width: 'calc(100% - 32px)',
          margin: '10px 16px 4px',
          padding: '13px 14px 12px',
          'border-radius': '16px',
          background: 'var(--bg-list)',
          border: '1px solid var(--separator)',
          'text-align': 'left',
          'animation-delay': staggerDelay(props.delayIndex ?? 3),
        }}
      >
        <div style={{ display: 'flex', 'align-items': 'center', gap: '7px', 'padding-bottom': '7px' }}>
          <Icon name="sparkle" size={14} color={TOPIC_COLOR[quote()!.topic]} />
          <span
            style={{
              'font-size': '12px',
              'font-weight': '700',
              'letter-spacing': '0.05em',
              'text-transform': 'uppercase',
              color: 'var(--text-tertiary)',
            }}
          >
            Brain Food · {TOPIC_LABEL[quote()!.topic]}
          </span>
          <span style={{ flex: '1' }} />
          <Show when={saved()}>
            <Icon name="star" size={13} color="var(--yellow-deep)" />
          </Show>
          <Icon name="chevron-right" size={14} color="var(--text-tertiary)" />
        </div>
        <div
          data-testid="home-quote-text"
          style={{
            'font-size': '16px',
            'line-height': '1.4',
            'font-weight': '500',
            display: '-webkit-box',
            '-webkit-line-clamp': '3',
            '-webkit-box-orient': 'vertical',
            overflow: 'hidden',
          }}
        >
          {quote()!.text}
        </div>
        <div
          style={{
            'margin-top': '6px',
            'font-size': '13px',
            color: 'var(--text-secondary)',
            overflow: 'hidden',
            'text-overflow': 'ellipsis',
            'white-space': 'nowrap',
          }}
        >
          — {attribution(quote()!)}
        </div>
      </button>

      <Show when={open()}>
        <QuoteSheet quote={quote()!} onClose={() => setOpen(false)} />
      </Show>
    </Show>
  );
}

/** The expanded quote: full text, where it comes from, keep it, go deeper. */
export function QuoteSheet(props: { quote: BrainQuote; onClose: () => void }): JSX.Element {
  const favorites = createLiveQuery(() => db.quoteFavorites.toArray(), []);
  const notes = createLiveQuery(() => db.quoteNotes.toArray(), []);
  const saved = createMemo(() => favorites().some((f) => f.id === props.quote.id));
  const note = createMemo(() => notes().find((n) => n.quoteId === props.quote.id) ?? null);
  const [busy, setBusy] = createSignal('');
  const [error, setError] = createSignal('');

  const goDeeper = async (): Promise<void> => {
    const config = aiConfig();
    setError('');
    if (!digestReady(config)) {
      // No key configured: hand the same prompt to the Claude app instead of
      // failing. The keyless path is the default provider, not a fallback.
      await openInClaude(deeperPrompt(props.quote));
      setBusy('');
      return;
    }
    setBusy(`Asking ${providerLabel(config)}…`);
    try {
      const text = await aiChat(
        config,
        [
          {
            role: 'system',
            content:
              'You explain what neuroscience and psychology actually say about a quote, plainly and without hype. You say so when the evidence is thin or contested.',
          },
          { role: 'user', content: deeperPrompt(props.quote) },
        ],
        700,
        (status) => setBusy(status),
      );
      await saveQuoteNote(props.quote.id, text, providerLabel(config));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the model right now');
    } finally {
      setBusy('');
    }
  };

  return (
    <Sheet onClose={props.onClose} maxWidth={520}>
      <div style={{ padding: '4px 20px 22px' }}>
        <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'padding-bottom': '10px' }}>
          <Icon name="sparkle" size={15} color={TOPIC_COLOR[props.quote.topic]} />
          <span
            style={{
              'font-size': '12px',
              'font-weight': '700',
              'letter-spacing': '0.05em',
              'text-transform': 'uppercase',
              color: 'var(--text-tertiary)',
            }}
          >
            {TOPIC_LABEL[props.quote.topic]}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <QuoteMark color={TOPIC_COLOR[props.quote.topic]} />
          <div>
            <div data-testid="quote-sheet-text" style={{ 'font-size': '19px', 'line-height': '1.4', 'font-weight': '500' }}>
              {props.quote.text}
            </div>
            <div style={{ 'margin-top': '10px', 'font-size': '14px', color: 'var(--text-secondary)' }}>
              — {attribution(props.quote)}
            </div>
            <Show when={props.quote.attributed}>
              <div style={{ 'margin-top': '6px', 'font-size': '12px', color: 'var(--text-tertiary)', 'line-height': '1.4' }}>
                Widely repeated under this name, but it can’t be traced to a primary text — treat the
                attribution, not the line, with suspicion.
              </div>
            </Show>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', 'margin-top': '18px' }}>
          <button
            data-testid="quote-save"
            onClick={() => {
              haptic('tick');
              void toggleQuoteFavorite(props.quote.id);
            }}
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: '7px',
              padding: '10px 14px',
              'border-radius': '11px',
              background: 'var(--bg-inset)',
              color: saved() ? 'var(--yellow-deep)' : 'var(--text)',
              'font-size': '15px',
              'font-weight': '600',
            }}
          >
            <Icon name="star" size={15} color={saved() ? 'var(--yellow-deep)' : 'var(--text-secondary)'} />
            {saved() ? 'Kept' : 'Keep'}
          </button>
          <button
            data-testid="quote-deeper"
            disabled={!!busy()}
            onClick={() => void goDeeper()}
            style={{
              flex: '1',
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              gap: '7px',
              padding: '10px 14px',
              'border-radius': '11px',
              background: 'var(--blue)',
              color: 'var(--text-invert)',
              'font-size': '15px',
              'font-weight': '600',
              opacity: busy() ? '0.6' : '1',
            }}
          >
            <Icon name="sparkle" size={15} />
            {busy() ? busy() : note() ? 'Ask again' : 'Go deeper'}
          </button>
        </div>

        <Show when={error()}>
          <div style={{ 'margin-top': '12px', 'font-size': '13px', color: 'var(--red)', 'line-height': '1.45' }}>
            {error()}
          </div>
        </Show>

        <Show when={note()}>
          <div
            data-testid="quote-note"
            style={{
              'margin-top': '16px',
              padding: '14px',
              'border-radius': '13px',
              background: 'var(--bg-inset)',
            }}
          >
            <MarkdownView source={note()!.text} />
            <div style={{ 'margin-top': '10px', 'font-size': '12px', color: 'var(--text-tertiary)' }}>
              Written by {note()!.provider} · kept on this device
            </div>
          </div>
        </Show>

        <Show when={!note() && !busy()}>
          <p style={{ 'margin-top': '14px', 'font-size': '13px', color: 'var(--text-secondary)', 'line-height': '1.45' }}>
            “Go deeper” asks what the science behind the line actually says and gives you one thing to
            try today. With an OpenRouter or Gemini key (Settings → AI) the answer appears here and is
            kept for later; without one, the prompt is handed to the Claude app.
          </p>
        </Show>
      </div>
    </Sheet>
  );
}
