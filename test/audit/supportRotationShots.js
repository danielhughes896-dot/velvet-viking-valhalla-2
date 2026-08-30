'use strict';
/* SUPPORTING-WORK ROTATION — ATHLETE-FACING PROOF.
 * Real cards from renderDayCard() across a real 16-week marathon build, so
 * consecutive supporting sessions can be compared side by side.
 * node test/audit/supportRotationShots.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { loadApp, RUNTIME_RELATIVE } = require(path.join(__dirname, '..', 'harness.js'));
const OUT = process.argv[2] || path.join(__dirname, 'out', 'support-rotation');
fs.mkdirSync(OUT, { recursive: true });
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', RUNTIME_RELATIVE), 'utf8');
const CSS = (SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/g) || [])
  .map(b => b.replace(/^<style[^>]*>/, '').replace(/<\/style>$/, '')).join('\n');

const TODAY = '2026-08-30';
const SCHED = { activeDays: [0, 1, 2, 3, 4, 6], longRunDay: 6 };
const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {}; a.showToast = () => {};
a.state = a.makeDefaultState();
const blk = a.buildBlockWeeks('full', 51, 16, {});
const end = a.addDays(a.addDays(TODAY, -a.isoWeekday(TODAY)), blk.planWeeks * 7 - 1);
a.state.days = a.buildDaysFromWeeks(blk, end, SCHED, TODAY, true);
a.state.setup = { distanceKey:'full', currentVolume:51, planWeeks:blk.planWeeks, schedule:SCHED,
  benchmark:{ distanceKey:'5k', timeSec:1385 }, goals:{ A:{ timeSec:14400 } }, activeGoal:'A',
  paceOverrides:{}, lthr:null, maxHR:null, experience:'experienced',
  startDate:TODAY, raceDate:end, hasEvent:true, purpose:'race', supportWork:'on' };
a.state.healthConsent = { version:a.HEALTH_CONSENT_VERSION, decision:'granted',
  decidedAt:'2026-01-01T09:00:00.000Z', grantedAt:'2026-01-01T09:00:00.000Z', withdrawnAt:null };

const weeks = [...new Set(a.state.days.map(d => d.week))].filter(Boolean).sort((x, y) => x - y);
const items = [];
weeks.forEach(w => (a.supportForWeek(w) || []).forEach(it =>
  items.push(Object.assign({ week: w, phase: a.trainingPhase(w) }, it))));
console.log('supporting sessions in the build: %d', items.length);
const pad = (s, n) => String(s).padEnd(n);
items.forEach(it => console.log('  wk' + pad(it.week, 3) + pad(it.phase, 8) +
  pad(it.kind, 23) + 'routine ' + it.variant + '  ' + it.date));

/* The <details> disclosure is closed by default and the movements live inside
   it, so it is opened the way the athlete opens it. */
function card(it){
  const dd = a.findDay(it.dayId);
  a.handleToggleDay(dd.id);
  return a.renderDayCard(dd).replace(/<details class="fuel-card how-card support-detail">/g,
                                     '<details open class="fuel-card how-card support-detail">');
}
function page(title, body, dark){
  return '<!doctype html><html lang="en" data-theme="' + (dark ? 'dark' : 'light') + '"><head>' +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + '</title><style>' + CSS + '</style>' +
    '<style>body{margin:0;padding:14px;} .shot-label{font-size:11px;letter-spacing:.08em;' +
    'text-transform:uppercase;color:var(--ink-faint);margin:0 0 8px;} ' +
    '.shot-sub{font-size:11px;color:var(--ink-faint);margin:10px 0 2px;}</style>' +
    '</head><body class="app"><div class="wrap"><div class="shot-label">' + title + '</div>' +
    body + '</div></body></html>';
}
/* One scene per kind that repeats: its consecutive prescriptions, in order. */
const byKind = {};
items.forEach(it => (byKind[it.kind] = byKind[it.kind] || []).push(it));
const scenes = [];
Object.keys(byKind).forEach(k => {
  const run = byKind[k];
  if (run.length < 2) return;
  const show = run.slice(0, 3);
  scenes.push({ id: k, title: a.SUPPORT_KINDS[k].label + ' — ' + show.length + ' consecutive weeks',
    html: show.map(it => '<div class="shot-sub">Week ' + it.week + ' · ' + it.phase + '</div>' + card(it)).join('') });
});
scenes.push({ id: 'phases', title: 'Across the block — Base, Build, Peak, Taper',
  html: ['Base','Build','Peak','Taper'].map(ph => {
    const it = items.filter(x => x.phase === ph)[0];
    return it ? '<div class="shot-sub">Week ' + it.week + ' · ' + ph + '</div>' + card(it) : '';
  }).join('') });

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const width of [390]){
    for (const dark of [false, true]){
      const ctx = await browser.newContext({ viewport: { width, height: 900 },
        deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light' });
      const pg = await ctx.newPage();
      for (const sc of scenes){
        await pg.setContent(page(sc.title, sc.html, dark), { waitUntil: 'load' });
        await pg.screenshot({ path: path.join(OUT, sc.id + '-' + width + (dark ? '-dark' : '-light') + '.png'), fullPage: true });
      }
      await ctx.close();
      console.log('  wrote %d scenes at %dpx %s', scenes.length, width, dark ? 'dark' : 'light');
    }
  }
  await browser.close();
  console.log('\nscreenshots in %s', OUT);
})().catch(e => { console.error(e); process.exit(1); });
