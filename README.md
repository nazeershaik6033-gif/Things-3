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

Recurring events are not expanded yet (v1 limitation).

## Development

```bash
npm install
npm run dev          # dev server
npm run typecheck    # strict TS
npm test             # unit tests (Vitest) — domain logic, dates, ICS, ordering
npx playwright test  # e2e against the production build, iPhone profile
npm run gen-icons    # regenerate PWA icons (renders SVG via headless Chromium)
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

## Roadmap (iteration 2)

Reminders (web push), repeating to-dos, undo — the schema already reserves fields for all three. Calendar events are still read-only: writing back to Google Calendar needs OAuth and a server, so the app hands you off to Google's own composer instead.

## License

MIT. Not affiliated with or endorsed by Cultured Code. All artwork and code are original.
