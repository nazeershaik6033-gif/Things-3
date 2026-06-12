import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { VitePWA } from 'vite-plugin-pwa';

import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  // Served from GitHub Pages at /Things-3/
  base: '/Things-3/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    solid(),
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
        navigateFallbackDenylist: [/^\/(?!Things-3)/],
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
