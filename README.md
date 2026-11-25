# Clarity

A fast, beautiful to-do app for iPhone — a love letter to [Things 3](https://culturedcode.com/things/), rebuilt as a **free, installable web app**. All premium features, no subscription, and your data never leaves your device.

> Built with SolidJS + Dexie. 75 KB gzipped. Works fully offline.

## Features

- **All the lists**: Inbox, Today (with This Evening), Upcoming, Anytime, Someday, Logbook, Trash
- **Projects** with headings, circular progress pies, and complete/cancel
- **Areas** to group projects and loose to-dos
- To-dos with **markdown notes**, **checklists**, **tags**, start dates ("When") and **deadlines** with red overdue flags
- **Signature interactions**: tap a row to expand it into an editing card in place; swipe right to complete; swipe left to schedule; long-press to drag-reorder (across sections); the draggable **Magic Plus** button — drop it where you want the new to-do
- **Quick Find** search across everything
- **Daily Target**: one thing you name in the morning and judge at night — Hit / Partial / Missed with a line of reflection, a hit streak, and a 14-day history. Optionally link a to-do so finishing it counts the target as hit
- **Beliefs**: a board of the statements you are deliberately installing. Each one is a card with a *conviction* score you set daily, a 14-day sparkline, a momentum arrow and an evidence log — the things that actually happened and argue the belief is true. The daily ritual is a full-screen session: one belief at a time, said **out loud**, scored 0–10, with a line of evidence caught while it is fresh. Your previous score is shown as an outline you are free to ignore rather than pre-selected, because a pre-filled number is a leading question. Retiring a belief keeps its history; the board starts empty and never writes a belief for you
- **Brain Food**: a quote a day about the brain and how to make it better, from Ramón y Cajal, William James, Hebb, Doidge, Merzenich, Dweck, Kahneman, Walker, Ratey, Barrett, Sapolsky, Aurelius and others. The library ships *inside* the app — 131 quotes, so nothing repeats for four months, and it works on a plane. Attributions are conservative: anything popularly pinned to a name without a traceable text is labelled "attributed to" rather than faked. Tap the card on Home for the full quote, keep the ones worth keeping, or **Go deeper** — what the science behind the line actually says plus one thing to try today, either through your own OpenRouter/Gemini key (cached, so it is asked once and read offline afterwards) or handed to the Claude app with no key at all
- **Habits**: a separate list of checks that resets every morning, with a completion ring, a streak counter and a 7-day history strip — habits never become overdue to-dos
- **My Routine**: the apps, sites and channels you go through each day, in colour-coded groups, checked off inside a time *window* (Morning, Night, or any window you add). YouTube channels, Telegram channels and RSS feeds are polled for anything published since the window opened, so a group shows how much is waiting. Filters (All / To-do / New / Completed), search, drag-to-reorder, local window reminders, a streak grid, and an AI digest — either handed off to the Claude app with no key, or summarized in place through your own OpenRouter or Gemini key. **History** keeps two records: how much you cleared on each of the last 14 days, and every update that slipped past an unfinished window, saved for a fortnight
- **Calendar screen**: month grid with event dots, the whole month listed as one agenda, and the day you tap pinned to the top; plus a prefilled "Add event in Google Calendar" link
- **Calendar events** (read-only) in Today and Upcoming via an iCal (.ics) subscription URL or file import
- **Home widgets**: an Up Next card with a live countdown to your next event, an Overdue card, and a week strip that opens the full calendar. The card deck folds itself away on a quiet day — no target, nothing booked, nothing late — leaving a one-line "Overview" summary and a chevron; tap it to open or minimise the deck and your choice sticks
- **Honest completion dates**: ticking a to-do whose day has passed asks when you actually finished it, and files it under that day in the Logbook
- **Dark mode** — automatic with the system, or manual
- **Motion**: spring-driven screen transitions where the covered screen recedes and dims, staggered entrances, and press feedback on every row — all of it respecting `prefers-reduced-motion`
- **Backup**: one-tap JSON export / import
- Day rollover at midnight moves scheduled items into Today automatically — even while the app is open
- **Super Productivity features** (see below): per-to-do **time tracking** and **estimates**, a **break reminder**, **repeating to-dos**, a **Worklog** with CSV timesheets, **Finish Day**, **Counters**, Quick Entry **short syntax**, and **GitHub issue import**
- **Day planner** (see below): times and lengths on to-dos, a timeline in Today and a 1/3/7-day **Planner** — drag to move, resize and draw blocks, push the rest when you run late — and **undo** for every change
- **Focus Framework** (see below): MIT/LIT, a 5-step Focus Sprint with a visible timer, energy tracking, your Everest, a daily flowchart, a lock-screen wallpaper, and native reminders via calendar alerts

## Day planner

Built after a reverse-engineering analysis of [obsidian-day-planner](https://github.com/ivan-lednev/obsidian-day-planner), [TaskNotes](https://github.com/callumalpass/tasknotes) and [obsidian-calendar-plugin](https://github.com/liamcain/obsidian-calendar-plugin) (all MIT). The full mapping, the decisions and the phased plan are in [`docs/obsidian-planners-rea.md`](docs/obsidian-planners-rea.md). Nothing was copied.

- **Times on to-dos.**
  - Tap **Time** on a to-do's card to set a start time and a length.
  - Deadlines can carry a "due by" time.
  - Rows show the time.
  - A time survives a change of day, and goes when the to-do goes to Someday or a vague Morning/Afternoon/Tonight slot.
  - A repeating to-do keeps its time on every occurrence.
- **Timeline.**
  - Today has a **List | Timeline** switch, and **Home → Planner** shows 1, 3 or 7 days. Phones open on 3 days, wide screens on the week.
  - To-dos, calendar events and Focus Sprints are blocks on an hour grid, with a line at the current time.
  - All-day events and deadlines sit in a row on top.
- **Touch, like iOS Calendar.**
  - Press and hold a block to lift it and drag it, across days too.
  - It then stays selected, with handles on both edges to change its length.
  - Press and hold empty space and drag to draw a block; Quick Entry opens for that slot.
  - Drag a to-do from the **Unscheduled** tray onto the grid, or tap it and then tap a time.
  - A plain tap never changes anything.
- **Mouse and keyboard.** Everything works on a plain drag. Arrow keys move the selected block, Shift+arrows resize it, Enter opens it.
- **Replanning.**
  - With **Push rest** on, a block that grows or moves into the next one pushes it, and the push cascades. Gaps absorb the delay.
  - **Running late +15m / +30m** shifts everything still ahead today.
  - Snap to 5, 10, 15 or 30 minutes (Settings → Planner).
- **Undo.**
  - Moves, resizes, pushes, scheduling, moving and deleting show a toast with **Undo**. On a keyboard, ⌘Z or Ctrl+Z works too.
  - An undo never overwrites something you changed since; it says so instead.

### Alerts and plain-words capture (phase 2)

- **Plain words in Quick Entry**, after TaskNotes:
  - `Gym tue thu 7am 1h` → every Tue and Thu, 7–8 AM
  - `Call Anna tomorrow at 3` → tomorrow, 3 PM
  - `Review deck fri 9-10:30` → Friday, 9–10:30 AM
  - `Pay rent every month`, `Standup every weekday 9:30am for 15m`, `Gift dec 24`, `Visa in 2 weeks`
- **What it recognises:**
  - days: today, tonight, tomorrow, weekdays, "next week", "in 3 days", "dec 24";
  - times: "7am", "at 3", "14:00", ranges like "9-10:30";
  - lengths: "1h", "45 min";
  - repeats: "every …", daily/weekly/monthly, "weekdays", or two or more weekdays in a row.
- **Ordinary words are left alone.** Bare numbers stay text, as do "sat" and "sun".
- **You can see and undo the reading.** Quick Entry shows what it read, and **Keep as text** turns the reading off for that entry. The `#tag +project @when !due ~est` short syntax still works and wins where both say something.
- **Suggestions.** Typing `#` or `+` suggests your tags and projects.
- **Alerts through iOS Calendar.** No push server: nothing leaves the phone.
  - A to-do's alerts follow its start time or its deadline: at start, 5/15/30/60 minutes before, or when due, 1 hour or 1 day before.
  - Timed to-dos get a default alert (5 minutes before; change it in Settings → Planner).
  - Tap **Send to Calendar** on a to-do, or **Send N alerts** on the timeline to send the whole day in one file. Open it and tap **Add All**.
  - The app remembers what it sent. A bell turns green once a to-do is in Calendar, and "Changed since sent" tells you to send again.
  - While Clarity is open, alerts also appear in the app.

### Calendars and repeats (phase 3)

- **Moved and cancelled meetings.** Moved and cancelled single meetings in a repeating series now show correctly (`EXDATE`, and `RECURRENCE-ID` overrides). Before, a moved meeting showed at both times and a cancelled one still appeared.
- **Several calendars, each with a colour.** Settings → Google Calendar → *Add another calendar* (work, family…). Every calendar gets a colour, shown on its blocks in the timeline and in Today's event list.
- **Meetings into to-dos.** Tap a meeting on the timeline: **Make it a to-do** at its time, or **Add a prep to-do** for the 30 minutes before it.
- **Skip one occurrence.** A repeating to-do's card has **Skip this one**. It's logged as skipped, not done, and the series moves on. A strip shows the series' recent days (done, skipped, missed, coming) with a done count.
- **Calendar views.**
  - Day / Week / Month / Year. Day and Week open the Planner on the selected day.
  - Year shows twelve small months, each day shaded by how full it was.
  - Month dots grow with how much a day holds (planned plus done, up to three), and a ring marks a day with something still open.
  - In Settings → Planner you can start weeks on Sunday and show ISO week numbers. Tapping a week number opens that week in the Planner.

## Super Productivity features

Ported from [Super Productivity](https://github.com/super-productivity/super-productivity) (MIT) after a feature-by-feature reverse-engineering analysis. The full mapping, including what was left out and why, is in [`docs/super-productivity-rea.md`](docs/super-productivity-rea.md). Nothing was copied: each feature was rebuilt on Clarity's own data model and UI.

- **Time tracking.**
  - Tap **Track** on any to-do; only one runs at a time.
  - A pill at the bottom shows the live clock.
  - It's wall-clock based, so it survives locking the phone or reloading.
  - Time is stored per day, and a timer left running past midnight lands on both days.
  - Finished Focus Sprints count toward their to-do.
- **Estimates.**
  - Set one from the card (`45m`, `1h30m`).
  - Rows show *spent / estimate*.
  - Today shows how much of the plan is left.
- **Break reminder.**
  - After 50 minutes of unbroken tracked work (adjustable in Settings), you get a nudge to step away.
  - Switching to-dos doesn't reset the stretch; a real pause does.
- **Repeating to-dos.**
  - Rules: daily, weekdays, weekly on chosen days, monthly (same date, same weekday such as "2nd Tue", or last day), and yearly.
  - Every *N*, with an optional end date.
  - Optionally counted *from when you finish* ("water plants 3 days after last time").
  - Missed occurrences don't pile up, and the next one always waits in Upcoming.
  - You can pause or stop a series; stopping keeps the to-dos you already have.
- **Worklog.**
  - Months, then weeks, then days, each listing the to-dos you worked on and finished.
  - Tap a time to correct it.
  - Export a CSV timesheet for this week, this month or all time.
- **Finish Day.**
  - What you got done, tracked against estimated time, and what's still open (one tap rolls it to tomorrow).
  - Rate the day's impact and write one line.
  - The review shows under that day in the Worklog.
- **Counters.**
  - A tap counter (glasses of water) or a stopwatch (minutes reading).
  - A daily goal, a streak and a week strip.
- **Short syntax.** Type it all in Quick Entry, for example `Call Anna #work +clarity @tomorrow ~30m !fri`:
  - `#tag` for a tag
  - `+project` for a project
  - `@when` for the start date: today, tonight, mon…sun, 3d, 2w, someday or 2026-12-24
  - `!deadline` for a deadline
  - `~estimate` for a time estimate

  A live preview shows what the tokens will do.
- **GitHub issues.**
  - Settings → GitHub issues imports a repo's open issues into a project; labels become tags.
  - Syncing again adds new issues, ticks off closed ones and reopens reopened ones, without touching your own dates or notes.
  - It talks to api.github.com directly. The optional token stays on the device and is left out of backups.

## Install on your iPhone

1. Open the app URL in **Safari**: `https://nazeershaik6033-gif.github.io/Things-3/`
2. Tap the **Share** button → **Add to Home Screen**
3. Launch it from the home screen — full screen, offline-capable, with protected storage

> The deploy workflow publishes to GitHub Pages on every push to `main`. One-time setup: repository **Settings → Pages → Source: GitHub Actions**.

## Your data

Everything is stored on-device in IndexedDB. There is no server, no account, no tracking. That also means: **export a backup now and then** (Settings → Backup → Export) — especially before clearing Safari website data. Installed home-screen apps are exempt from Safari's 7-day storage cleanup, and the app additionally requests persistent storage.

## Calendar (ICS) notes

Many calendar hosts don't allow direct browser access (CORS). The app first tries a direct fetch and then falls back to a CORS proxy prefix (configurable in Settings, default `corsproxy.io`). Public proxies can see your calendar URL — if that bothers you, either **import the .ics file manually** (works offline, fully private) or deploy your own tiny proxy:

```js
// Cloudflare Worker — deploy as e.g. ics-proxy.yourname.workers.dev
export default {
  async fetch(req) {
    const url = new URL(req.url).searchParams.get('url');
    if (!url || !url.startsWith('https://')) return new Response('bad url', { status: 400 });
    const upstream = await fetch(url);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'Content-Type': 'text/calendar', 'Access-Control-Allow-Origin': '*' },
    });
  },
};
```

Then set the proxy prefix in Settings to `https://ics-proxy.yourname.workers.dev/?url=`.

Recurring events are expanded, including cancelled (`EXDATE`) and moved (`RECURRENCE-ID`) instances.

## Focus Framework

Built on the "How To Train Your Focus" system — build the conditions for focus before demanding more of yourself.

| Level | Technique | Where it lives in Clarity |
|---|---|---|
| 0 Foundation | Protect 7h+ sleep; stop multitasking | Flow steps *Slept 7h+?* and *Lights out*; bedtime + shutdown alerts |
| 1 Digital distractions | Phone away, filter notifications, no endless scrolling | Sprint step 3 checklist; 22:00 *Shutdown: phone away* alert |
| 2 What deserves attention | Your **Everest**; **MITs** (1–3) vs **LITs** | Daily Focus → Everest; tap a to-do → **★ MIT** (capped at 3, pinned to *Most Important* in Today); everything else is batched at 15:00 |
| 3 Biological clock | Track energy for a week; hard work at peaks | 1–5 energy check-ins → hourly chart + morning/evening/mixed verdict; **⚡ High / 🔋 Low energy** tags on to-dos |
| 4 Focus sprint | Schedule → next action → environment → visible timer → recover | **Focus Sprint** (Today bar, task card *Focus*, or Daily Focus). The timer runs on the wall clock, survives locking/reloads, and minimizes to a pill. Recovering writes the next action to the top of the to-do's checklist |
| 5 Reset | Work deliberately → step away → return (incubation) | **Stuck? Reset** during a sprint |

**Daily Focus** (Home → Daily Focus) is the flowchart for the day. Steps tick themselves off from real activity (MITs picked, sprints done, energy logged); the rest are one-tap checks that reset each day.

### Reminders without a push server

An installed iPhone web app only gets closed-app notifications through Web Push, which needs a server. Clarity instead uses **iOS Calendar alerts**: native, reliable, and they respect Focus modes.

- **Daily routine.** At build time, `vite.config.ts` writes one recurring `.ics` file per settings combination (wake × bedtime × sprint length × evening sprint = 64 files) to `dist/cal/`. GitHub Pages serves them as `text/calendar`, so **Daily Focus → Add routine to Calendar** opens Safari's *Add All* sheet. The service worker is told not to intercept `.ics` requests. Default routine: plan 07:30, sprint 09:00 (alerts 5 minutes before and at the end), LIT batch 15:00, sprint 19:00, shutdown 22:00, lights out 23:00.
- **One-off sprints** scheduled for later are generated in the app and handed over through the share sheet (Mail or Files → tap the file → *Add All*). This is needed because iOS standalone apps can't open generated files directly.

### Editing sprints

Every sprint stays editable:

- **While it runs:** tap **Edit** on the timer to switch task, rewrite the next action, or set the minutes left.
- **Scheduled:** tap it in Daily Focus → Scheduled sprints to change the time, length, task or next action, re-send its calendar alert, or cancel it.
- **Finished:** Daily Focus → **Sprint log** (last 14 days) lets you fix the start, the minutes actually focused, the task and the note, or delete it, so "minutes focused" stays honest.
- **Routine:** the morning and evening sprint times and the sprint length are free-form. Presets (25/45 min, auto morning time, 19:00 evening) use the one-tap static calendar file. Custom values are delivered through the share sheet instead.

### Apple Watch sleep & activity

Clarity is a web app, so it can't read HealthKit. An iOS Shortcut does the reading instead:

- **The Shortcut** ("Clarity Health", built once from the in-app guide under Daily Focus → *Shortcut setup*) copies last night's raw sleep samples and today's Move/Exercise/Stand totals to the clipboard.
- **Syncing:** **Sync Watch → Paste** imports them. Sync in the morning for sleep and at the evening shutdown for rings; rings merge upward, so syncing twice is safe.
- **Manual entry:** **Enter by hand** covers anything the Shortcut can't read.
- **The maths** lives in `src/domain/health.ts`, which is unit-tested:
  - Sleep stages are merged across Watch and iPhone samples so they're never double-counted.
  - Naps are split off from the main night.
  - Nights are keyed by the date you wake up.
- **Clarity sleep score:** Apple's Sleep Score has no API, so Clarity computes its own from the same three parts and weights (duration 50, bedtime 30, interruptions 20) against your bedtime target. For a real 5h 28m night it reproduces Apple's 54 "Low" exactly (see `tests/unit/health.test.ts`).
- **Effect on the day:**
  - After a night under 6h or a score ≤ 60, Today and the sprint suggest 1–2 MITs and 25-minute sprints.
  - "Slept 7h+?" and "close the Exercise ring" tick themselves from the data.
  - After enough days, Daily Focus compares focused minutes and energy after 7h+ nights against shorter ones, and on active days against still ones.
- **Privacy:** health data stays on-device and is included in backups (schema 8 and later).

### Lock-screen wallpaper

`npm run gen-wallpaper` renders `public/wallpapers/focus-flow-{dark,light}.png` (1206×2622) from the same `dailyFlow()` the app uses, so the wallpaper can't drift from the app. The flowchart sits below the lock-screen clock. In the app: Daily Focus → open a wallpaper → long-press → *Save to Photos* → *Use as Wallpaper*.

## Development

```bash
npm install
npm run dev          # dev server
npm run typecheck    # strict TS
npm test             # unit tests (Vitest) — domain logic, dates, ICS, ordering
npx playwright test  # e2e against the production build, iPhone profile
npm run gen-icons    # regenerate PWA icons (renders SVG via headless Chromium)
npm run gen-wallpaper # regenerate the Daily Focus lock-screen wallpapers
# Using a preinstalled Chromium instead of Playwright's: PW_CHROMIUM=/path/to/chrome npx playwright test
```

Architecture notes:

- `src/domain/` — pure logic: smart-list membership predicates, date math (local `YYYY-MM-DD` strings, no timezone bugs), markdown parser (AST, no HTML injection surface), ICS parser
- `src/db/` — Dexie schema, the single ops-based write path (`mutations.ts`, undo-ready), fractional-index ordering, export/import
- `src/gestures/` — spring engine (one rAF loop, frame-rate independent), pan/long-press recognizers, gesture arbiter, FLIP helpers. Nav springs carry deliberately loose rest thresholds: the default sub-pixel ones keep a viewport-sized spring "animating" for ~350ms after the motion is visually over, and navigation refuses taps for that whole time
- `src/app/motion.ts` — reduce-motion preference, entrance stagger, haptics
- `src/app/navigation.ts` — custom screen stack with iOS push/pop springs and edge-swipe-back
- All animations are transform/opacity-only (CI guards this), except the single contained expand-card height animation

Two rules the animation code lives by, both learned the hard way and guarded in CI:

- **Never animate a layout property.** `transform` and `opacity` only.
- **Never read layout inside an animation frame.** A single `window.innerWidth` in a per-frame callback forces a synchronous layout after the transform you just wrote.

## Roadmap

The day planner ships in phases (see [`docs/obsidian-planners-rea.md`](docs/obsidian-planners-rea.md)):

1. **Times, timeline, undo.** Shipped.
2. **Alerts through iOS Calendar, and plain-words capture.** Shipped.
3. **Calendar views, calendar-event fixes and colours, events into to-dos, skipping a repeat.** Shipped.
4. Kanban of to-dos with In progress / Waiting statuses, dependencies with a Can do now list, Daily Note and Weekly Review, saved views, templates, multi-select.

### Earlier notes (iteration 2)

Reminders (web push) and undo — the schema already reserves fields for both. Repeating to-dos shipped with the Super Productivity features. Calendar events are still read-only: writing back to Google Calendar needs OAuth and a server, so the app hands you off to Google's own composer instead.

## License

MIT. Not affiliated with or endorsed by Cultured Code. All artwork and code are original.
