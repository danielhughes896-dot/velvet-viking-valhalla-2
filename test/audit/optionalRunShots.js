'use strict';
/* OPTIONAL RUN — ATHLETE-FACING PROOF.
 * ===========================================================================
 * Builds a real plan through the real generator for an athlete whose
 * demonstrated frequency is below their stated availability, so the week
 * genuinely contains all three kinds of day, then renders the actual day cards
 * with the app's own stylesheet and photographs them.
 *
 * Nothing here is a mock: the cards come from renderDayCard(), the eligibility
 * from optionalRunEligible(), and the CSS from the runtime file.
 *
 * node test/audit/optionalRunShots.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { loadApp, RUNTIME_RELATIVE } = require(path.join(__dirname, '..', 'harness.js'));

const OUT = process.argv[2] || path.join(__dirname, 'out', 'optional-run');
fs.mkdirSync(OUT, { recursive: true });
const RUNTIME = path.join(__dirname, '..', '..', RUNTIME_RELATIVE);
const SRC = fs.readFileSync(RUNTIME, 'utf8');

/* The app's own stylesheet, taken from the runtime rather than rewritten. */
const CSS = (SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/g) || [])
  .map(b => b.replace(/^<style[^>]*>/, '').replace(/<\/style>$/, '')).join('\n');

const TODAY = '2026-03-04';                                  // a Wednesday
function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {}; a.showToast = () => {};
  a.state = a.makeDefaultState();
  /* SIX AVAILABLE DAYS, A DEMONSTRATED THREE. Fifty-two weeks of three runs a
     week is the evidence; the athlete has told the app they can train six. */
  const monday = a.addDays(TODAY, -a.isoWeekday(TODAY));
  const sessions = [];
  for (let i = 0; i < 52; i++){
    const m = a.addDays(monday, -7 * (52 - i));
    for (let d = 0; d < 3; d++)
      sessions.push({ date: a.addDays(m, d), completed: true, actualKm: 9, plannedKm: 9 });
  }
  a.state.athlete = { sessions };
  const schedule = { activeDays: [0, 1, 2, 3, 5, 6], longRunDay: 6 };
  const start = a.addDays(TODAY, -14);
  const end = a.addDays(a.addDays(start, -a.isoWeekday(start)), 14 * 7 - 1);
  const blk = a.buildBlockWeeks('half', 45, 14, {});
  a.state.days = a.buildDaysFromWeeks(blk, end, schedule, start, false);
  a.state.setup = { distanceKey: 'half', currentVolume: 45, planWeeks: 14, schedule: schedule,
    benchmark: { distanceKey: '10k', timeSec: 2700 }, goals: { A: { timeSec: 5400 } },
    activeGoal: 'A', paceOverrides: {}, lthr: 165, maxHR: 190, experience: 'experienced',
    startDate: start, raceDate: end, hasEvent: false, purpose: 'race' };
  a.state.healthConsent = { version: a.HEALTH_CONSENT_VERSION, decision: 'granted',
    decidedAt: '2026-01-01T09:00:00.000Z', grantedAt: '2026-01-01T09:00:00.000Z', withdrawnAt: null };
  return { a, schedule };
}

function classify(a, schedule){
  const out = { optional: [], protectedRest: [], run: [] };
  a.state.days.forEach(d => {
    const weekDays = a.state.days.filter(x => x.week === d.week);
    if (d.km > 0){ out.run.push(d); return; }
    if (d.type !== 'rest') return;
    if (a.optionalRunEligible(d, weekDays)) out.optional.push(d);
    else if (d.availableUnused) out.protectedRest.push(d);
  });
  return out;
}

function page(title, bodyHtml, dark){
  /* The runtime's own theme boot writes data-theme explicitly and defaults to
     light, so a page without it renders neither theme correctly. */
  return '<!doctype html><html lang="en" data-theme="' + (dark ? 'dark' : 'light') + '"><head>' +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + '</title><style>' + CSS + '</style>' +
    '<style>body{margin:0;padding:14px;} .shot-label{font-size:11px;letter-spacing:.08em;' +
    'text-transform:uppercase;color:var(--ink-faint);margin:0 0 8px;}</style>' +
    '</head><body class="app"><div class="wrap"><div class="shot-label">' + title + '</div>' +
    bodyHtml + '</div></body></html>';
}

(async () => {
  const { a, schedule } = athlete();
  const groups = classify(a, schedule);
  console.log('week shape: %d running, %d optional-eligible, %d protected rest',
    groups.run.length, groups.optional.length, groups.protectedRest.length);
  if (!groups.optional.length) throw new Error('fixture produced no optional-run day');
  if (!groups.protectedRest.length) throw new Error('fixture produced no protected rest day');

  /* The card is an accordion and only today's day opens by itself. These
     screenshots are of the companion INSIDE the card, so both are opened the
     same way the athlete would open them -- through the app's own toggle. */
  const optDay = groups.optional[0];
  const restDay = groups.protectedRest[0];
  a.handleToggleDay(optDay.id); a.handleToggleDay(restDay.id);
  const scenes = [];
  scenes.push({ id: 'A-optional', title: 'A — Optional run offered',
                html: a.renderDayCard(optDay) });
  scenes.push({ id: 'B-protected', title: 'B — Protected rest, no invitation',
                html: a.renderDayCard(restDay) });
  a.handleOptionalRunLog(optDay.id);
  scenes.push({ id: 'C-opened', title: 'C — Optional run opened for logging',
                html: a.renderDayCard(optDay) });
  a.handleOptionalRunLog(optDay.id);
  scenes.push({ id: 'D-side-by-side', title: 'D — The two rest days together',
                html: a.renderDayCard(optDay) + a.renderDayCard(restDay) });

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const width of [360, 390, 430]){
    for (const dark of [false, true]){
      const ctx = await browser.newContext({ viewport: { width, height: 900 },
                                             deviceScaleFactor: 2,
                                             colorScheme: dark ? 'dark' : 'light' });
      const pg = await ctx.newPage();
      for (const sc of scenes){
        await pg.setContent(page(sc.title, sc.html, dark), { waitUntil: 'load' });
        const name = sc.id + '-' + width + (dark ? '-dark' : '-light') + '.png';
        await pg.screenshot({ path: path.join(OUT, name), fullPage: true });
        console.log('  wrote %s', name);
      }
      await ctx.close();
    }
  }
  await browser.close();
  console.log('\nscreenshots in %s', OUT);
})().catch(e => { console.error(e); process.exit(1); });
