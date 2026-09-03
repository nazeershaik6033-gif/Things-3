import { createMemo, createSignal, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import type { DateStr, Task } from '../db/models';
import { createReactiveLiveQuery } from '../db/liveQuery';
import { Sheet, SheetTitle } from '../ui/Sheet';
import { Icon, ListIcon } from '../ui/Icon';
import { MonthGrid, PickerRow } from './Pickers';
import { currentDate } from '../app/currentDate';
import { completionPrompt, setCompletionPrompt } from '../app/uiState';
import { completeOn, suggestedCompletionDate } from '../app/completion';
import { setAskCompletionDate } from '../app/settings';
import { addDays, formatRelative, weekdayName } from '../domain/dates';

/** "When did you finish this?" — shown when a late to-do is ticked, before any
 *  write happens. Whichever day is chosen becomes the completion stamp, so the
 *  entry lands in that day's Logbook section rather than today's. */
function PromptSheet(props: { task: Task; onClose: () => void }): JSX.Element {
  const [picking, setPicking] = createSignal(false);
  const today = () => currentDate();
  const yesterday = () => addDays(today(), -1);
  const due = createMemo(() => suggestedCompletionDate(props.task, today()));
  /** The due date is only worth its own row when it isn't already offered. */
  const showDueRow = createMemo(() => due() !== today() && due() !== yesterday());

  const finish = (date: DateStr) => {
    completeOn(props.task.id, date);
    props.onClose();
  };

  return (
    <Sheet onClose={props.onClose} dragAnywhere>
      <SheetTitle>When did you finish this?</SheetTitle>
      <div
        style={{
          padding: '0 20px 10px',
          color: 'var(--text-secondary)',
          'font-size': '14px',
          'text-align': 'center',
          'line-height': '1.4',
        }}
      >
        “{props.task.title || 'New To-Do'}” was due {formatRelative(due(), today())}. It
        goes into that day’s Logbook.
      </div>

      <Show when={!picking()}>
        <PickerRow
          icon={<ListIcon list="today" size={20} />}
          label="Today"
          onClick={() => finish(today())}
        />
        <PickerRow
          icon={<Icon name="clock" size={20} color="var(--text-secondary)" />}
          label="Yesterday"
          onClick={() => finish(yesterday())}
        />
        <Show when={showDueRow()}>
          <PickerRow
            icon={<Icon name="flag" size={20} color="var(--red)" />}
            label={`On its due date — ${weekdayName(due()).slice(0, 3)}, ${formatRelative(due(), today())}`}
            onClick={() => finish(due())}
          />
        </Show>
        <PickerRow
          icon={<Icon name="calendar" size={20} color="var(--blue)" />}
          label="Pick another day…"
          onClick={() => setPicking(true)}
        />
      </Show>

      <Show when={picking()}>
        <MonthGrid
          selected={null}
          disableAfter={today()}
          initialMonth={due().slice(0, 7)}
          onSelect={finish}
        />
      </Show>

      <button
        data-testid="completion-never-ask"
        onClick={() => {
          void setAskCompletionDate(false);
          finish(today());
        }}
        style={{
          display: 'block',
          width: '100%',
          padding: '12px 20px 16px',
          color: 'var(--text-secondary)',
          'font-size': '14px',
        }}
      >
        Always use today — don’t ask again
      </button>
    </Sheet>
  );
}

/** Mounted once by App; opens whenever a late to-do is ticked anywhere. */
export function CompletionPromptHost(): JSX.Element {
  const task = createReactiveLiveQuery(
    completionPrompt,
    async (prompt) => (prompt ? ((await db.tasks.get(prompt.taskId)) ?? null) : null),
    null,
  );
  return (
    <Show when={completionPrompt() && task() && task()!.id === completionPrompt()!.taskId}>
      <PromptSheet task={task()!} onClose={() => setCompletionPrompt(null)} />
    </Show>
  );
}
