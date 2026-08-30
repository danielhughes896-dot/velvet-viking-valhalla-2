'use strict';
/* OPTIONAL RUN — ATHLETE-FACING PROOF.
 * ===========================================================================
 * Builds a real plan through the real generator for an athlete whose
 * demonstrated frequency is below their stated availability, so the week
 * genuinely contains all three kinds of day, then renders the actual day cards
 * with the app's own stylesheet and photographs them.
 *
 * Nothing here is a mock: the cards come from renderDayCard(), the eligibility
 * from optionalRunEligible(), the logging from the app's own handlers, and the
 * CSS from the runtime file.
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

/* FIXED plan dates, so "today" can be moved onto whichever day the engine
   makes optional without the plan itself moving underneath it. */
const START = '2026-02-18';
const SCHEDULE = { activeDays: [0, 1, 2, 3, 5, 6], longRunDay: 6 };

function athlete(pinnedDate){
  const a = loadApp({ pinnedDate: pinnedDate + 'T09:00:00Z' });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {}; a.showToast = () => {};
  a.state = a.makeDefaultState();
  /* SIX AVAILABLE DAYS, A DEMONSTRATED THREE. Fifty-two weeks of three runs a
     week is the evidence; the athlete has told the app they can train six. */
  const monday = a.addDays(pinnedDate, -a.isoWeekday(pinnedDate));
  const sessions = [];
  for (let i = 0; i < 52; i++){
    const m = a.addDays(monday, -7 * (52 - i));
    for (let d = 0; d < 3; d++)
      sessions.push({ date: a.addDays(m, d), completed: true, actualKm: 9, plannedKm: 9 });
  }
  a.state.athlete = { sessions };
  const end = a.addDays(a.addDays(START, -a.isoWeekday(START)), 14 * 7 - 1);
  const blk = a.buildBlockWeeks('half', 45, 14, {});
  a.state.days = a.buildDaysFromWeeks(blk, end, SCHEDULE, START, false);
  a.state.setup = { distanceKey: 'half', currentVolume: 45, planWeeks: 14, schedule: SCHEDULE,
    benchmark: { distanceKey: '10k', timeSec: 2700 }, goals: { A: { timeSec: 5400 } },
    activeGoal: 'A', paceOverrides: {}, lthr: 165, maxHR: 190, experience: 'experienced',
    startDate: START, raceDate: end, hasEvent: false, purpose: 'race', supportWork: 'on' };
  a.state.healthConsent = { version: a.HEALTH_CONSENT_VERSION, decision: 'granted',
    decidedAt: '2026-01-01T09:00:00.000Z', grantedAt: '2026-01-01T09:00:00.000Z', withdrawnAt: null };
  return a;
}

function classify(a){
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
  /* Find the day the engine makes optional, then stand the athlete on it --
     the invitation and the logging form both exist only on the day the run
     could actually have happened. */
  const probe = athlete(START);
  const probeGroups = classify(probe);
  if (!probeGroups.optional.length) throw new Error('fixture produced no optional-run day');
  const TODAY = probeGroups.optional.filter(d => d.date > START)[1].date;

  const a = athlete(TODAY);
  const groups = classify(a);
  console.log('today %s — week shape: %d running, %d optional-eligible, %d protected rest',
    TODAY, groups.run.length, groups.optional.length, groups.protectedRest.length);

  const optDay = groups.optional.filter(d => d.date === TODAY)[0];
  if (!optDay) throw new Error('today is not the optional day');
  const week = optDay.week;
  const restDay = groups.protectedRest.filter(d => d.week === week)[0] || groups.protectedRest[0];
  /* A session still ahead, so scene E shows a prescription rather than a
     day the fixture never ran and the card correctly labels Missed. */
  const runDay = groups.run.filter(d => d.week === week && d.date > TODAY)[0]
    || groups.run.filter(d => d.week === week)[0];
  /* A day the engine actually put supporting work on, so coexistence is shown
     rather than asserted. */
  const support = (a.supportForWeek(week) || [])[0]
    || (a.supportForWeek(week + 1) || [])[0];
  const supportDay = support ? a.state.days.filter(d => d.id === support.dayId)[0] : null;

  /* The card is an accordion and only today's day opens by itself. These
     screenshots are of what sits INSIDE the card, so each is opened the same
     way the athlete would open it -- through the app's own toggle. */
  [optDay, restDay, runDay, supportDay].forEach(d => {
    if (d && d.date !== TODAY) a.handleToggleDay(d.id);
  });

  const scenes = [];
  scenes.push({ id: 'A-collapsed', title: 'A — Optional run offered',
                html: a.renderDayCard(optDay) });

  a.handleOptionalRunLog(optDay.id);                      // open the form
  scenes.push({ id: 'B-form', title: 'B — Logging form open',
                html: a.renderDayCard(optDay) });

  a.handleActualFieldChange(optDay.id, 'km', '5.2');
  a.handleActualFieldChange(optDay.id, 'pace', '5:34');
  scenes.push({ id: 'B2-form-filled', title: 'B2 — Form filled, save enabled',
                html: a.renderDayCard(optDay) });

  a.handleOptionalRunSave(optDay.id);
  scenes.push({ id: 'C-logged', title: 'C — Optional run logged',
                html: a.renderDayCard(optDay) });

  scenes.push({ id: 'D-rest', title: 'D — Protected rest, no invitation',
                html: a.renderDayCard(restDay) });
  scenes.push({ id: 'E-prescribed', title: 'E — Prescribed session',
                html: a.renderDayCard(runDay) });

  /* F — the three identities side by side, with the optional run put back to
     the state the athlete meets it in. */
  a.handleOptionalRunRemove(optDay.id);
  scenes.push({ id: 'F-three-states', title: 'F — Prescribed / Optional / Rest',
                html: a.renderDayCard(runDay) + a.renderDayCard(optDay) + a.renderDayCard(restDay) });

  if (supportDay){
    scenes.push({ id: 'G-support', title: 'G — Supporting work coexistence',
      html: a.renderDayCard(supportDay) + (supportDay.id === optDay.id ? '' : a.renderDayCard(optDay)) });
  } else console.log('  (no supporting work in this week — G skipped)');

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
      }
      await ctx.close();
      console.log('  wrote %d scenes at %dpx %s', scenes.length, width, dark ? 'dark' : 'light');
    }
  }
  await browser.close();
  console.log('\nscreenshots in %s', OUT);
})().catch(e => { console.error(e); process.exit(1); });
