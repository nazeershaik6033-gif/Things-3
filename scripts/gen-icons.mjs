// Generates PWA icons by rendering an original SVG mark in headless Chromium.
// Usage: node scripts/gen-icons.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');

// Original mark: blue gradient rounded square, white rounded-square checkbox
const svg = (size, { maskable = false } = {}) => {
  const pad = maskable ? size * 0.12 : 0;
  const inner = size - pad * 2;
  const radius = maskable ? 0 : inner * 0.225;
  return `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:${maskable ? '#2f7cf6' : 'transparent'}}</style>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4a90f7"/>
      <stop offset="1" stop-color="#1d6ae5"/>
    </linearGradient>
  </defs>
  <rect x="${pad}" y="${pad}" width="${inner}" height="${inner}" rx="${radius}" fill="url(#bg)"/>
  <rect x="${size * 0.27}" y="${size * 0.27}" width="${size * 0.46}" height="${size * 0.46}"
        rx="${size * 0.115}" fill="none" stroke="#fff" stroke-width="${size * 0.052}"/>
  <path d="M ${size * 0.385} ${size * 0.50} L ${size * 0.475} ${size * 0.59} L ${size * 0.635} ${size * 0.40}"
        fill="none" stroke="#fff" stroke-width="${size * 0.062}"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
};

const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: true }, // iOS wants opaque
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(svg(t.size, { maskable: t.maskable }));
  const png = await page.screenshot({
    clip: { x: 0, y: 0, width: t.size, height: t.size },
    omitBackground: !t.maskable,
  });
  await writeFile(join(outDir, t.file), png);
  console.log('wrote', t.file);
}
await browser.close();
