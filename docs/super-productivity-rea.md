# Super Productivity → Clarity: reverse-engineering analysis

This is a reverse-engineering analysis (REA) of
[Super Productivity](https://github.com/super-productivity/super-productivity)
(v20.1.0, commit `81b962a`, MIT), done to decide which of its features belong
in Clarity and how to rebuild them in Clarity's own architecture. No code was
copied. Super Productivity is Angular + NgRx; Clarity is SolidJS + Dexie, so
every feature was rebuilt from its data model and behaviour.

## Method

1. Inventory. Walk `src/app/features/*` and list every feature module.
2. Data models. Read each feature's `*.model.ts` (for example `task.model.ts`,
   `task-repeat-cfg.model.ts`, `simple-counter.model.ts`, `metric.model.ts`,
   `worklog.model.ts`), because the model says what the feature really stores.
3. Behaviour. Read the services and reducers for the rules that aren't in the
   model: overdue repeats, how time is attributed to days, when a break is due.
4. Map. Find each feature's equivalent in Clarity. Classify it as already
   there, ported, adapted, or not ported, with a reason.
5. Rebuild. Write the pure logic in `src/domain/` (unit-tested), the writes in
   `src/db/`, and the UI in Clarity's own idiom (chips, inline panels, cards).

## Feature inventory

| Super Productivity feature | SP module | Status in Clarity |
|---|---|---|
| Projects, tags, sub-tasks | `project`, `tag`, `tasks` | **Already had**: projects, areas, headings, tags, checklists |
| Kanban boards, Eisenhower matrix | `boards` | **Already had**: Boards; Eisenhower chips in Today |
| Pomodoro / countdown focus mode | `focus-mode` | **Already had**: Focus Timer + Focus Sprints |
| Calendar events next to tasks | `calendar-integration`, `schedule` | **Already had**: ICS subscription, Calendar screen |
| Notes on tasks/projects | `note` | **Already had**: markdown notes |
| Habit tracking | `simple-counter/habit-tracker` | **Already had** (yes/no Habits). Quantity counters are **ported** below |
| **Time tracking per task** (`timeSpentOnDay`) | `time-tracking`, `tasks` | **Ported**: Track chip, live clock, tracker bar, per-day seconds |
| **Time estimates** (`timeEstimate`) | `tasks` | **Ported**: estimate chip/picker, spent / estimate in rows, "time left" in Today |
| **Take-a-break reminder** | `take-a-break` | **Ported**: fires after N minutes of continuous tracked work |
| **Repeating tasks** | `task-repeat-cfg` | **Ported**: daily / weekly on weekdays / monthly (date, Nth weekday, last day) / yearly, every N, until, after completion |
| **Worklog / timesheet export** | `worklog` | **Ported**: Worklog screen (months → weeks → days), editable time, CSV timesheet |
| **Finish day / daily summary** | `before-finish-day`, `finish-day-before-close` | **Ported**: Finish Day screen |
| **Evaluation metrics** (impact of work, reflection) | `metric` | **Ported** (adapted): impact 1–4 and a reflection note inside Finish Day, shown in the Worklog |
| **Simple counters** (click + stopwatch, streaks) | `simple-counter` | **Ported**: Counters screen |
| **Short syntax** in the add-task bar | `tasks/add-task-bar` | **Ported**: `#tag +project @when !deadline ~estimate` in Quick Entry |
| **Issue provider import** (GitHub) | `issue/providers/github` | **Ported**: GitHub issues → project; re-sync closes/reopens/retitles |
| Jira, GitLab, Linear, OpenProject, Redmine… | `issue/providers/*` | Not ported. These APIs need CORS-proxied auth or OAuth, which a serverless PWA can't hold safely. GitHub's API allows direct browser calls |
| Sync (WebDAV, Dropbox, SuperSync) | `imex/sync` | Not ported. Needs a server or OAuth app. Clarity keeps one-tap JSON backup |
| Idle detection | `idle` | Not ported. Needs OS idle APIs (Electron). A PWA can't see system idle |
| Tracking reminder ("you're not tracking") | `tracking-reminder` | Not ported. It would nag in a phone app; the tracker bar makes running state visible instead |
| Plugins, custom themes | `plugins`, theming | Not ported (out of scope). Clarity already has palettes and dark mode |
| Attachments / bookmarks | `tasks/task-attachment` | Not ported. Links in markdown notes cover the common case |
| Planner drag-to-day view | `planner` | Not ported. Upcoming + Calendar + "When" already cover it on a phone screen |

## How each port maps onto Clarity

### Time tracking and estimates

- **SP model.** `Task.timeSpentOnDay: { [YYYY-MM-DD]: ms }`, plus
  `timeEstimate` and `timeSpent`.
- **Clarity.** `Task.timeSpent: Record<DateStr, seconds>` and
  `Task.timeEstimateMin`, added in schema v9 with an upgrade backfill.
- **Tracker.** The tracker (`src/app/timeTracking.ts`) persists only *when*
  tracking started. That's the same wall-clock rule as Clarity's Focus Timer,
  so it survives reloads and a suspended iOS PWA.
- **Midnight.** When it stops, the span is split across local days
  (`splitAcrossDays`), so a timer left running past midnight is credited to
  both days.
- **Focus Sprints.** A finished Sprint counts toward its to-do. Its time is
  *read* from the sprint (`taskTimeByDay`), not copied into the task, so a
  correction in the Sprint log also corrects the Worklog. Starting a sprint
  stops the tracker, so the same time is never counted twice.
- **Completion.** Completing the tracked to-do stops the tracker, through a
  completion hook in `mutations.ts`.

### Break reminder

SP's `take-a-break` tracks a continuous stretch of work. Clarity does the same:

- Switching to-dos within 5 minutes keeps the stretch going.
- After *N* minutes (default 50, set in Settings) you get one toast, plus a
  notification if the app is in the background and has permission.
- **Break** on the tracker bar stops tracking and starts the stretch over.

### Repeating to-dos

- **SP model.** `TaskRepeatCfg` holds the cycle, interval, weekday flags,
  Nth-weekday or last-day monthly anchors, `repeatFromCompletionDate`,
  `repeatUntilDay` and `skipOverdue`.
- **Clarity.** `RepeatCfg { rule, template, lastDate, paused }`, with each
  occurrence an ordinary task whose `repeatTemplateId` points to it. That
  field was reserved in Clarity's v1 schema and always null until now.
- **Engine.** `src/domain/repeat.ts` is pure date-string maths: it clamps the
  31st to short months and Feb 29 to Feb 28, and keeps the phase for every-N
  rules. `planOccurrences` keeps two invariants:
  - No pile-up. Of the occurrences you missed, only the latest is created
    (SP's `skipOverdue`).
  - Exactly one occurrence ahead of today exists, so Upcoming shows the next
    one, like Things.
- **After completion.** These rules create the next occurrence when the
  current one is completed.
- **When it runs.** At boot and at every midnight rollover. Runs are
  serialized, so overlapping triggers can't create duplicates.

### Worklog and timesheet

- **Layout.** SP's worklog groups by month, then week, then day, and exports
  a CSV. Clarity's `src/domain/worklog.ts` builds the same tree from task time
  plus finished sprints, using ISO (Monday-start) weeks.
- **Editing.** Tap a time to correct it ("I forgot to start the timer"). The
  correction adjusts the tracker part, so the shown total matches what you
  typed even when a sprint also counted.
- **Export.** The CSV has one row per (day, to-do) and is delivered through
  the share sheet on iOS.

### Finish Day and metrics

SP shows a daily summary before you close the app, and separately rates
"impact of work". Clarity folds both into one **Finish Day** screen:

- what you finished, and the time per to-do;
- tracked time against estimated time;
- what's still open, with **Tomorrow** per row or **Move all**;
- impact on a 1–4 scale and a one-line reflection.

The review is saved as a `DayReview` with a snapshot of the numbers and shown
under that day in the Worklog.

### Counters

SP's `SimpleCounter` has `ClickCounter` and `StopWatch` types with
`countOnDay`. Clarity has `Counter` plus `CounterDay` (id
`${date}:${counterId}`, the same shape as Habits' `RoutineLog`):

- the value is taps, or seconds for a stopwatch;
- a daily goal turns into a streak, and an unfinished today doesn't break it;
- each counter shows a 7-day strip.

Counters are kept separate from Habits on purpose: habits are yes/no,
counters are "how much".

### Short syntax

SP parses `#tag`, `+project`, `@date` and time tokens in its add-task bar.
Clarity's parser (`src/domain/shortSyntax.ts`) handles:

| Token | Sets | Examples |
|---|---|---|
| `#tag` | tag, created if new | `#work` (must start with a letter, so `#2` stays text) |
| `+project` | project | `+clarity` matches by prefix, ignoring case and punctuation |
| `@when` | start date | `@today`, `@tonight`, `@tomorrow`, `@mon`…`@sun` (the next one), `@3d`, `@2w`, `@someday`, `@2026-12-24` |
| `!deadline` | deadline | the same date words as `@` |
| `~estimate` | estimate | `~30m`, `~1h30m`, `~1.5h` |

Tokens only count at the start of a word, so `a@b.com` and `C#` are left
alone. A token that doesn't resolve stays in the title. Quick Entry shows a
live preview of what the tokens will do.

### GitHub issue import

SP imports issues assigned to you and re-syncs them. Clarity does this for
GitHub:

- `api.github.com` allows browser requests (CORS), so no proxy sees the
  token, and the token is left out of backups.
- Issues become to-dos with `issueRef = "github:owner/repo#N"`, labels become
  tags, and they go into a project named after the repo (or one you pick).
- Re-sync (`planIssueSync`) creates new open issues, completes ones closed
  upstream, reopens reopened ones and refreshes titles. It never overwrites
  your local dates, notes or checklists. Pull requests are skipped.

## Schema and backup

- **Schema v9.** Adds `repeatCfgs`, `counters`, `counterDays` and
  `dayReviews`, plus three task fields (`timeEstimateMin`, `timeSpent`,
  `issueRef`) and indexes on `repeatTemplateId` and `issueRef`. The upgrade
  backfills the task fields, and the change is additive like every earlier
  migration.
- **Backups.** The backup format moves to schema 9. Older backups import
  cleanly, with the new fields given defaults.

## Tests

- `tests/unit/repeat.test.ts` covers the recurrence engine, including month
  clamping, leap days, Nth weekday, until dates and no-pile-up planning.
- `tests/unit/timeTracking.test.ts` covers midnight splitting, sprint
  attribution, duration parsing and break timing.
- `tests/unit/superDomain.test.ts` covers the worklog and CSV, short syntax,
  counters and streaks, issue sync planning and the Finish Day summary.
- `tests/unit/superMutations.test.ts` covers the DB writes: repeats end to
  end, counters, reviews, issue import and the v9 backup round-trip.
- `tests/e2e/superProductivity.spec.ts` runs every ported feature in the
  production build on the iPhone profile.
