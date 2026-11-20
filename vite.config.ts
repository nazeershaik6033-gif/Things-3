import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { VitePWA } from 'vite-plugin-pwa';
import type { Plugin } from 'vite';
import { allProfiles, routineFileName } from './src/domain/focus';
import { routineCalendar } from './src/domain/icsWrite';

import pkg from './package.json' with { type: 'json' };

/** Emits one static routine calendar per settings combination. GitHub Pages
 *  serves .ics as text/calendar, which iOS opens straight into "Add All" to
 *  Calendar — the dependable way for a home-screen web app to get native,
 *  works-while-closed alerts without a push server. */
function routineCalendars(): Plugin {
  return {
    name: 'clarity-routine-calendars',
    generateBundle() {
      for (const p of allProfiles()) {
        this.emitFile({ type: 'asset', fileName: `cal/${routineFileName(p)}`, source: routineCalendar(p) });
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(/\/cal\/(focus-routine-[\w-]+\.ics)$/);
        const profile = m && allProfiles().find((p) => routineFileName(p) === m[1]);
        if (!profile) return next();
        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.end(routineCalendar(profile));
      });
    },
  };
}

export default defineConfig({
  // Served from GitHub Pages at /Things-3/
  base: '/Things-3/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    solid(),
    routineCalendars(),
    VitePWA({
      registerType: 'autoUpdate',
      // Don't list icons here — the manifest icons are already precached via
      // globPatterns below, and duplicating them causes Workbox to choke on
      // duplicate entries which breaks SW installation in Safari.
      includeAssets: [],
      manifest: {
        name: 'Clarity',
        short_name: 'Clarity',
        description: 'A fast, beautiful to-do app that works entirely on your device.',
        start_url: '/Things-3/',
        scope: '/Things-3/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f5f5f7',
        theme_color: '#f5f5f7',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache JS, CSS, HTML, SVG — PNGs are excluded here because the
        // manifest icons array below already adds them; including both causes
        // duplicate entries that break SW installation in Safari.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: 'index.html',
        // Prevent SW from intercepting non-app requests (e.g. GitHub Pages 404)
        // ...and never answer calendar files with the app shell
        navigateFallbackDenylist: [/^\/(?!Things-3)/, /\.ics$/],
        clientsClaim: true,
        skipWaiting: true,
        // Purge outdated caches from old SW versions on activation
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    // Target Safari 14+ / ES2020 for maximum iPhone compatibility
    target: ['es2020', 'safari14'],
    sourcemap: false,
  },
  server: {
    host: true,
  },
});
