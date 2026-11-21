// Renders the Daily Focus flowchart as iPhone lock-screen wallpapers
// (1206×2622, dark + light) from the SAME flow definition the app uses
// (src/domain/focus.ts), so the wallpaper never drifts from the app.
// Usage: node scripts/gen-wallpaper.mjs   (PW_CHROMIUM=/path/to/chrome optional)
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'wallpapers');

// Load the domain module (TypeScript) via esbuild
const bundled = await build({
  entryPoints: [join(root, 'src/domain/focus.ts')],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'neutral',
});
const focus = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const profile = focus.DEFAULT_PROFILE;
const flow = focus.dailyFlow(profile);
const steps = focus.SPRINT_STEPS;

const THEMES = {
  dark: {
    bg: 'radial-gradient(120% 70% at 50% 0%, #1d2440 0%, #101219 55%, #0b0c10 100%)',
    text: '#f2f2f4', sub: '#a4a6b0', faint: '#5e616c', rail: 'rgba(255,255,255,0.16)',
    card: 'rgba(255,255,255,0.07)', cardBorder: 'rgba(255,255,255,0.10)', chip: 'rgba(255,255,255,0.10)',
  },
  light: {
    bg: 'radial-gradient(120% 70% at 50% 0%, #dfe8fb 0%, #f3f4f8 55%, #f7f7f9 100%)',
    text: '#17181c', sub: '#5b5e68', faint: '#9a9ca5', rail: 'rgba(20,20,40,0.16)',
    card: 'rgba(255,255,255,0.75)', cardBorder: 'rgba(20,20,40,0.08)', chip: 'rgba(20,20,40,0.07)',
  },
};
const PHASE = { Morning: '#f0b429', 'Focus sprint': '#4a90f7', Afternoon: '#3fb6dc', Evening: '#b07be0' };

// Short, glanceable copy for the lock screen (full hints live in the app)
const SHORT = {
  'sleep-check': 'Slept 7h+? No phone in bed',
  everest: 'Look at your Everest',
  mits: 'Pick 1–3 MITs · rest are LITs',
  match: 'MITs at peaks, LITs in the dip',
  sprint: `Focus Sprint · ${profile.sprintMinutes} min`,
  lits: 'Batch LITs: email, errands, admin',
  energy: 'Log energy 1–5',
  exercise: 'Move · close the Exercise ring',
  'sprint-evening': `Evening Sprint · ${profile.sprintMinutes} min`,
  shutdown: 'Shutdown · phone out of reach',
  'lights-out': 'Lights out · protect 7h+',
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function html(t) {
  const rows = flow.map((s, i) => {
    const isSprint = s.id.startsWith('sprint');
    const color = PHASE[s.phase];
    const sub = isSprint
      ? `<div class="mini">${steps.map((x) => `<span>${x.n} ${x.short}</span>`).join('<i>→</i>')}</div>
         <div class="reset">Stuck? Reset: deliberate → step away → return</div>`
      : '';
    return `
      <div class="row ${isSprint ? 'sprint' : ''}">
        <div class="time">${s.time ?? ''}</div>
        <div class="railcol">
          <div class="seg" style="opacity:${i === 0 ? 0 : 1}"></div>
          <div class="node ${isSprint ? 'sq' : ''}" style="border-color:${color};${isSprint ? `background:${color}` : ''}"></div>
          <div class="seg grow" style="opacity:${i === flow.length - 1 ? 0 : 1}"></div>
        </div>
        <div class="body">
          <div class="title">${esc(SHORT[s.id] ?? s.title)}</div>
          ${sub}
        </div>
      </div>`;
  }).join('');

  return `<!doctype html><meta charset="utf-8">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:402px;height:874px}
  body{background:${t.bg};font-family:Inter,system-ui,sans-serif;color:${t.text};-webkit-font-smoothing:antialiased;position:relative;overflow:hidden}
  /* lock-screen safe zone: below the clock (~0–285pt), above the flashlight/camera row */
  .wrap{position:absolute;left:26px;right:26px;top:300px}
  .head{display:flex;align-items:baseline;justify-content:space-between;margin:0 0 10px 2px}
  .head b{font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:${t.sub};font-weight:700}
  .head span{font-size:11px;color:${t.faint};font-weight:500}
  .panel{background:${t.card};border:1px solid ${t.cardBorder};border-radius:22px;padding:12px 14px 10px;backdrop-filter:blur(20px)}
  .row{display:flex;align-items:stretch}
  .time{width:40px;flex:none;font-size:11.5px;font-weight:600;color:${t.sub};font-variant-numeric:tabular-nums;padding-top:6px}
  .railcol{width:20px;flex:none;display:flex;flex-direction:column;align-items:center}
  .seg{width:2px;height:7px;background:${t.rail}}
  .seg.grow{flex:1;min-height:4px}
  .node{width:12px;height:12px;border-radius:50%;border:2.5px solid;flex:none}
  .node.sq{border-radius:4px}
  .body{flex:1;min-width:0;padding:3px 0 5px 8px}
  .title{font-size:14.5px;font-weight:600;letter-spacing:-0.1px;line-height:1.25}
  .sprint .title{font-weight:700}
  .mini{display:flex;flex-wrap:wrap;align-items:center;gap:3px;margin-top:4px}
  .mini span{font-size:10.5px;font-weight:600;padding:2px 6px;border-radius:6px;background:${t.chip}}
  .mini i{font-style:normal;font-size:10px;color:${t.faint}}
  .reset{font-size:10.5px;color:${t.sub};margin-top:4px;padding-left:7px;border-left:2px dashed ${t.rail}}
  .foot{display:flex;justify-content:center;gap:16px;margin-top:10px;font-size:11.5px;font-weight:600;color:${t.sub}}
  .foot em{font-style:normal;color:${t.faint};font-weight:500}
</style>
<div class="wrap">
  <div class="head"><b>Daily Focus</b><span>Everest → MITs → Sprint → Recover</span></div>
  <div class="panel">${rows}</div>
  <div class="foot"><span>Sleep</span><em>·</em><span>Phone away</span><em>·</em><span>One focus</span></div>
</div>`;
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
for (const [name, theme] of Object.entries(THEMES)) {
  const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3 });
  await page.setContent(html(theme));
  const bottom = await page.evaluate(() => document.querySelector('.wrap').getBoundingClientRect().bottom);
  if (bottom > 800) throw new Error(`Wallpaper content overflows the lock-screen safe zone (bottom ${bottom}pt)`);
  const png = await page.screenshot({ type: 'png' });
  await writeFile(join(outDir, `focus-flow-${name}.png`), png);
  // small preview for the in-app picker
  const thumb = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 0.5 });
  await thumb.setContent(html(theme));
  await writeFile(join(outDir, `focus-flow-${name}-thumb.png`), await thumb.screenshot({ type: 'png' }));
  console.log(`wrote focus-flow-${name}.png (content bottom ${Math.round(bottom)}pt)`);
}
await browser.close();
