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
- **Calendar events** (read-only) in Today and Upcoming via an iCal (.ics) subscription URL or file import
- **Dark mode** — automatic with the system, or manual
- **Backup**: one-tap JSON export / import
- Day rollover at midnight moves scheduled items into Today automatically — even while the app is open
- **Focus Framework** (see below): MIT/LIT, a 5-step Focus Sprint with a visible timer, energy tracking, your Everest, a daily flowchart, a lock-screen wallpaper, and native reminders via calendar alerts

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
- `src/gestures/` — spring engine (one rAF loop, frame-rate independent), pan/long-press recognizers, gesture arbiter, FLIP helpers
- `src/app/navigation.ts` — custom screen stack with iOS push/pop springs and edge-swipe-back
- All animations are transform/opacity-only (CI guards this), except the single contained expand-card height animation

## Roadmap (iteration 2)

Per-task reminders (Web Push), repeating to-dos, undo — the schema already reserves fields for all three.

## License

MIT. Not affiliated with or endorsed by Cultured Code. All artwork and code are original.
