# Obsidian planners → Clarity: reverse-engineering analysis

A reverse-engineering analysis (REA) of three Obsidian plugins, done the same
way as [the Super Productivity one](super-productivity-rea.md): read the source,
data models, settings, commands and changelogs; map every feature onto
Clarity; decide what to add, change or skip; rebuild in Clarity's own
architecture. No code was copied.

| Plugin | Version studied | State |
|---|---|---|
| [obsidian-day-planner](https://github.com/ivan-lednev/obsidian-day-planner) (ivan-lednev) | 0.35.1, `9c483b3` (Aug 2026) | Active |
| [tasknotes](https://github.com/callumalpass/tasknotes) (callumalpass) | `e368e52` (Nov 2026) | Very active, large |
| [obsidian-calendar-plugin](https://github.com/liamcain/obsidian-calendar-plugin) (liamcain) | `ef3f269` (Nov 2022) | Finished |

## The finding

Clarity knew **which day** something happens but not **what time**: a to-do
had dates and no start time or length. All three plugins are built around
putting work on the clock and seeing the day and week laid out. That gap is
what made morning planning and mid-day replanning hard.

## Decisions (from the user's answers)

- **Why the app went unused:** all four of morning planning, mid-day
  replanning, no reminders, and slow capture.
- **Reminders:** iOS Calendar alerts, so nothing leaves the phone. No push
  server.
- **Timeline:** both a List / Timeline switch in Today and a Planner screen.
- **Kanban:** a Kanban view of the to-dos themselves, with In progress and
  Waiting statuses. Boards stay as they are.
- **Dependencies:** yes ("waits for" plus a Can do now list).
- **Daily Note and Weekly Review:** both.
- **Devices:** iPhone and desktop. The Planner opens on 3 days on a phone and
  the full week on a wide screen.
- **Order:** phased, one change set per phase.

## Feature inventory and mapping

### obsidian-calendar-plugin

| Feature | Verdict | Phase |
|---|---|---|
| Month grid, jump to any day | Already had (Calendar screen) | — |
| Open or create a note for any day from a template | Add: Daily Note | 4 |
| Activity dots (1 per 250 words, max 5); hollow dot for open tasks | Modify the month dots | 3 |
| Week numbers that open a weekly note | Add: Weekly Review | 4 |
| Week starts on Sunday, Monday or the locale | Modify: make it a setting | 3 |
| Emoji or tag of the day on the grid; long-press preview | Add (small) | 4 |

### obsidian-day-planner

| Feature | Verdict | Phase |
|---|---|---|
| Day timeline with blocks from timed tasks | **Ported** | 1 |
| Multi-day planner (3 days, work week, week) | **Ported** (1/3/7 days) | 1 |
| Drag to create, move, resize from either edge; snap; default and minimum length | **Ported** | 1 |
| Shift mode (push the rest) | **Ported** | 1 |
| Delete or edit from the timeline, with undo | **Ported**: tap opens the full card; undo app-wide | 1 |
| Unscheduled tasks dragged onto the grid | **Ported**: Unscheduled tray | 1 |
| All-day row | **Ported** (all-day events and deadlines) | 1 |
| Now line, Now/Next, mini-timeline | Now line **ported**; Home Now/Next later | 1 / 3 |
| ICS calendars as blocks, with recurrence overrides and EXDATE | Blocks **ported**; EXDATE/overrides and colour per calendar later | 1 / 3 |
| Notification when a block starts | With reminders (calendar alerts) | 2 |
| Planned vs tracked columns; clock edits, resume, cancel; "clock in on anything" | Later: needs tracked intervals | 4 |

### TaskNotes

| Feature | Verdict | Phase |
|---|---|---|
| Scheduled and due dates with an optional time | **Ported**: `startTime`, `durationMin`, `deadlineTime` | 1 |
| Drag tasks on the calendar to reschedule, across days | **Ported** in the Planner | 1 |
| Repeating tasks keep their time | **Ported** (the series takes its time from the card; a timeline drag moves one day) | 1 |
| Undo of check-offs and group moves | **Ported** as app-wide undo | 1 |
| Relative and absolute reminders | Add | 2 |
| Natural-language capture with times and repeats; autocomplete | Modify short syntax | 2 |
| Week/day/year views; deadline flags apart from scheduled; multi-select | Add | 3 |
| Create a task or note from a calendar event | Add | 3 |
| Skip an occurrence; history calendar per series | Add | 3 |
| Custom statuses; Kanban of tasks | Add | 4 |
| Dependencies (blocked by / blocking, Not blocked view) | Add | 4 |
| Saved filtered views; templates; "do again" | Add | 4 |
| Notes as files, Bases, YAML, wikilinks, multiple projects per task, custom fields, attachments, Google/Outlook OAuth sync, HTTP API, i18n | Skip: Obsidian-specific or needs a server | — |

## Phase 1 as built

### Data (schema v10)

- **New task fields.** `startTime` ("HH:mm" on `startDate`), `durationMin`
  (block length; falls back to the estimate, then 30 minutes) and
  `deadlineTime`.
- **Migration.** Additive: the v10 upgrade only backfills the three fields.
  Backups move to schema 10, and older backups import with the fields
  defaulted.
- **Why new fields.** `reminderTime` already meant either a Today slot
  ("morning"/"afternoon") or a reminder clock time, so it wasn't reused.
- **When a time stays and goes.** A time survives a change of *day*. It's
  dropped when the to-do loses its day (Someday, Anytime, Inbox) or a vague
  slot (Morning/Afternoon/Tonight) is picked. Setting a time takes a to-do out
  of the Inbox and out of those slots.
- **Repeats.** Repeat templates carry the time. Setting a time from a
  repeating to-do's card updates the series and future occurrences that still
  had the old time. Dragging on the timeline moves that one day (TaskNotes'
  flexible scheduling).

### Timeline maths (`src/domain/timeline.ts`)

- **Units.** Everything is in minutes since local midnight, using wall-clock
  fields so DST never skews the grid.
- **What's on a day.** Blocks come from timed to-dos (completed ones stay,
  ticked), calendar events clipped to the day, and Focus Sprints (planned
  where scheduled, done where they happened).
- **Overlaps.** Overlapping blocks share the width in clustered columns.
- **Push the rest** follows Day Planner's propagate rule:
  - a later to-do is pushed only if the edited block now runs into it, and
    the push cascades;
  - gaps absorb the delay;
  - blocks that overlapped before the edit, and events, never move.
- **Running late** shifts every open to-do still ahead by 15 or 30 minutes,
  keeping the gaps.

### Undo (`src/db/undo.ts`, `src/app/undo.ts`)

- **Recording.** `mutations.ts` always kept before and after images of every
  op. `recordUndo` collects the ops an action writes.
- **Replay is safe.** Undo puts a row back only if it still looks exactly as
  the action left it. Otherwise it skips that row and says the undo was
  partial.
- **Toasts.** An Undo button is bound to its own action, so a stale toast
  can't undo something newer.
- **Keyboard.** Cmd/Ctrl+Z works outside text fields.
- **Coverage.** Timeline moves, resizes, pushes, shifts and placements;
  Schedule; Move; Delete; setting or removing a time.
- **Not covered.** Ticking a to-do is not recorded: the time tracker's
  in-memory state would drift. Untick (with the grace period) covers it.
  A backup import clears the history.

### Interaction (`src/components/Timeline.tsx`)

- **Touch** follows iOS Calendar:
  - hold a block to lift it and drag it, across days in the Planner;
  - it then stays selected, with handles on both edges to resize;
  - hold empty space and drag to draw a block, which opens Quick Entry
    pre-filled with that slot;
  - drag a to-do from the Unscheduled tray, or tap it and then tap a time;
  - a plain tap never changes anything, so scrolling is always safe.
- **Mouse.** All of the above work on a plain drag. Arrow keys move the
  selected block (Shift+arrows resize), Enter opens it and Esc deselects.
- **The pinned header.** The toolbar, tray, day headers and all-day row stay
  pinned while the hours scroll. Auto-scroll starts below that header, after
  a short dwell. A tray drag only auto-scrolls once it has been over the
  hours, because it starts inside the header.
- **Robustness.** Blocks are keyed by identity, so a re-layout mid-drag never
  removes the element under the finger. An active drag listens on the window.
- **Snap step.** 5, 10, 15 or 30 minutes, set in Settings → Planner.

### Tests

- `tests/unit/timeline.test.ts`: clock text, block placement (including DST
  and midnight), sprints, the tray, layout, edits, push the rest, running
  late, now/next.
- `tests/unit/undo.test.ts`: undo semantics, including the "changed since"
  guard, undo by id and nested actions; the time mutations; repeats keeping
  their time; the v10 backup round-trip.
- `tests/e2e/planner.spec.ts`: in the production build on the iPhone profile,
  place from the tray, hold-drag, undo, push the rest, the task sheet, Planner
  day counts, and setting a time from the card.
