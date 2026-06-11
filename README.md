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
- `src/gestures/` — spring engine (one rAF loop, frame-rate independent), pan/long-press recognizers, gesture arbiter, FLIP helpers
- `src/app/navigation.ts` — custom screen stack with iOS push/pop springs and edge-swipe-back
- All animations are transform/opacity-only (CI guards this), except the single contained expand-card height animation

## Roadmap (iteration 2)

Reminders (web push), repeating to-dos, undo — the schema already reserves fields for all three.

## License

MIT. Not affiliated with or endorsed by Cultured Code. All artwork and code are original.
