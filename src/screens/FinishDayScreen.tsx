import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { celebrate } from '../app/celebrate';
import { createLiveQuery } from '../db/liveQuery';
import { moveToTomorrow, saveDayReview } from '../db/superMutations';
import { currentDate } from '../app/currentDate';
import { back } from '../app/navigation';
import { haptic } from '../app/motion';
import { showToast } from '../app/focusState';
import { stopTracking, trackingTaskId } from '../app/timeTracking';
import { formatTime, monthName, weekdayName, fromDateStr } from '../domain/dates';
import { IMPACT_LABELS, summarizeDay } from '../domain/finishDay';
import { formatDuration } from '../domain/timeTracking';
import { Icon } from '../ui/Icon';
import { AutoTextarea } from '../ui/TextField';
import { ScreenChrome } from './common';
import { Panel, SectionLabel, StatRow, StatTile, primaryButton, softButton } from './superCommon';
import { useSprints } from '../components/TimeControls';

/** Finish Day: Super Productivity's end-of-day ritual. See what you got
 *  done and how long it took, roll what's left to tomorrow, rate the day's
 *  impact and write one line — then close it. The review lands in the
 *  Worklog under the day. */

export function FinishDayScreen(): JSX.Element {
  const tasks = createLiveQuery(() => db.tasks.toArray(), []);
  const reviews = createLiveQuery(() => db.dayReviews.toArray(), []);
  const sprints = useSprints();
  const summary = createMemo(() => summarizeDay(tasks(), sprints(), currentDate()));
  const existing = createMemo(() => reviews().find((r) => r.date === currentDate()) ?? null);
  const [impact, setImpact] = createSignal<number | null>(null);
  const [note, setNote] = createSignal('');

  // Pre-fill once from a saved review so "Update" edits rather than resets
  createEffect(on(existing, (r, prev) => {
    if (r && !prev) {
      setImpact(r.impact);
      setNote(r.note);
    }
  }));

  const dateLabel = () => {
    const d = currentDate();
    return `${weekdayName(d)}, ${monthName(d)} ${fromDateStr(d).getDate()}`;
  };

  const finish = async () => {
    if (trackingTaskId()) await stopTracking();
    await saveDayReview(currentDate(), { impact: impact(), note: note() }, summarizeDay(tasks(), sprints(), currentDate()));
    haptic('success');
    if (!existing()) celebrate(`finish:${currentDate()}`);
    showToast(existing() ? 'Day review updated' : 'Day finished — see you tomorrow');
    back();
  };

  return (
    <ScreenChrome title="Finish Day" subtitle={dateLabel()} icon={<Icon name="moon" size={26} color="var(--purple)" />}>
      <StatRow>
        <StatTile testid="fd-done" label="Done" value={String(summary().completed.length)} tone="var(--green)" />
        <StatTile testid="fd-tracked" label="Tracked" value={formatDuration(summary().trackedSec)} tone="var(--blue)" />
        <StatTile
          testid="fd-estimated"
          label="Estimated"
          value={summary().estimatedMin ? formatDuration(summary().estimatedMin * 60) : '—'}
        />
      </StatRow>

      <SectionLabel>Done today</SectionLabel>
      <Panel testid="fd-done-list">
        <Show
          when={summary().completed.length > 0}
          fallback={<div style={{ padding: '12px 14px', color: 'var(--text-tertiary)', 'font-size': '14px' }}>Nothing ticked off yet today.</div>}
        >
          <For each={summary().completed}>
            {(t) => (
              <div style={{ display: 'flex', 'align-items': 'center', gap: '10px', padding: '9px 14px', 'font-size': '15px' }}>
                <Icon name="check" size={15} color="var(--green)" strokeWidth={2.6} />
                <span style={{ flex: '1', 'min-width': '0', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>
                  {t.title || 'Untitled'}
                </span>
                <span style={{ 'font-size': '13px', color: 'var(--text-secondary)', 'font-variant-numeric': 'tabular-nums' }}>
                  {summary().secByTask.get(t.id) ? formatDuration(summary().secByTask.get(t.id)!) : ''}
                </span>
              </div>
            )}
          </For>
        </Show>
      </Panel>

      <Show when={summary().unfinished.length > 0}>
        <SectionLabel
          trailing={
            <button
              data-testid="fd-move-all"
              onClick={() => {
                const ids = summary().unfinished.map((t) => t.id);
                void moveToTomorrow(ids, currentDate()).then(() => showToast(`${ids.length} moved to tomorrow`));
              }}
              style={{ color: 'var(--blue)', 'text-transform': 'none', 'letter-spacing': '0', 'font-size': '13px', 'font-weight': '600' }}
            >
              Move all to tomorrow
            </button>
          }
        >
          Still open
        </SectionLabel>
        <Panel testid="fd-open-list">
          <For each={summary().unfinished}>
            {(t) => (
              <div style={{ display: 'flex', 'align-items': 'center', gap: '10px', padding: '7px 10px 7px 14px', 'font-size': '15px' }}>
                <span style={{ width: '15px', height: '15px', 'border-radius': '50%', border: '1.5px solid var(--check-border)', flex: 'none' }} />
                <span style={{ flex: '1', 'min-width': '0', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>
                  {t.title || 'Untitled'}
                </span>
                <button
                  data-testid="fd-tomorrow"
                  onClick={() => void moveToTomorrow([t.id], currentDate())}
                  style={{ ...softButton, padding: '4px 10px', 'font-size': '13px' }}
                >
                  Tomorrow
                </button>
              </div>
            )}
          </For>
        </Panel>
      </Show>

      <SectionLabel>How much did today move things forward?</SectionLabel>
      <div style={{ display: 'flex', gap: '6px', padding: '0 12px 12px' }}>
        <For each={[...IMPACT_LABELS]}>
          {(label, i) => (
            <button
              data-testid={`fd-impact-${i() + 1}`}
              aria-pressed={impact() === i() + 1}
              onClick={() => { haptic('tick'); setImpact(impact() === i() + 1 ? null : i() + 1); }}
              style={{
                flex: '1',
                padding: '10px 4px',
                'border-radius': '12px',
                'font-size': '13px',
                'font-weight': '600',
                background: impact() === i() + 1 ? 'var(--purple)' : 'var(--bg-list)',
                color: impact() === i() + 1 ? '#fff' : 'var(--text)',
                border: '1px solid var(--separator)',
              }}
            >
              {label}
            </button>
          )}
        </For>
      </div>
      <Panel>
        <AutoTextarea
          value={note()}
          placeholder="One line about today — what worked, what to change tomorrow"
          rows={2}
          onInput={(v) => setNote(v)}
          style={{ padding: '10px 14px', 'font-size': '15px', 'line-height': '1.45', width: '100%' }}
        />
      </Panel>

      <div style={{ padding: '4px 12px 12px', display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
        <button data-testid="fd-finish" onClick={() => void finish()} style={{ ...primaryButton, width: '100%' }}>
          {existing() ? 'Update review' : 'Finish day'}
        </button>
        <Show when={existing()}>
          <div data-testid="fd-finished-at" style={{ 'text-align': 'center', 'font-size': '12px', color: 'var(--text-tertiary)' }}>
            Finished at {formatTime(existing()!.finishedAt)}
          </div>
        </Show>
      </div>
      <div style={{ height: '100px' }} />
    </ScreenChrome>
  );
}
