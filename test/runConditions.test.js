'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* HILLY, WINDY AND WATCH DATA OFF ARE UNDERSTOOD, NOT DISPLAYED.

   Asked whether those three tiles should be shown on the card, the founder:
   "Don't think so. I just think the app should understand that learn from it
   and use the data."

   Before this, Hilly and Windy only explained a slow pace on the review, and
   a hilly run's raised heart rate, a windy run's slow pace and a GPS-wrecked
   pace all reached the baselines, the trends and the graphs as facts about
   the athlete. sessionConditions() is the one answer every reader that
   learns from a run now asks. */

const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const fnBody = name => { const at = SRC.indexOf('\nfunction ' + name + '('); assert.ok(at !== -1, name + ' is gone'); return SRC.slice(at, SRC.indexOf('\n}\n', at)); };
const PIN = '2026-10-21';

function app(){
  const a = loadApp({ pinnedDate: PIN + 'T07:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave', 'replaceCard', 'patchDerivedStats', 'patchExecutionUI', 'patchSplitsTotal']
    .forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: '10k', volume: 45, weeks: 12, lthr: 172, maxHR: 188, startDate: '2026-09-07', healthConsent: true });
  a.state.days.filter(d => d.date <= PIN && d.type !== 'rest').forEach(d => {
    logAsPrescribed(a, d, { quality: 1, extra: d.type === 'easy' ? { hr: 140 } : {} });
  });
  return a;
}
const plain = o => JSON.parse(JSON.stringify(o));
const easyDays = a => a.state.days.filter(d => d.completed && d.type === 'easy').sort((x, y) => (x.date < y.date ? -1 : 1));
const tap = (a, d, v) => a.handleLogPick(d.id, 'conditions', v);

test('each tile is read for what it does to the numbers, and nothing else', () => {
  const a = app();
  const [d1, d2, d3, d4] = easyDays(a).slice(-4);
  tap(a, d1, 'hilly'); tap(a, d2, 'windy'); tap(a, d3, 'watch');
  const hilly = plain(a.sessionConditions(d1)), windy = plain(a.sessionConditions(d2)), off = plain(a.sessionConditions(d3));
  assert.deepEqual(hilly, { hills: true, wind: false, gpsDoubt: false, measuredClimb: null, pace: false, hr: false });
  assert.deepEqual(windy, { hills: false, wind: true, gpsDoubt: false, measuredClimb: null, pace: false, hr: false });
  /* Founder: "unreliable GPS does not necessarily invalidate reliable
     heart-rate readings". */
  assert.deepEqual(off, { hills: false, wind: false, gpsDoubt: true, measuredClimb: null, pace: false, hr: true });
  assert.deepEqual(plain(a.sessionConditions(d4)), { hills: false, wind: false, gpsDoubt: false, measuredClimb: null, pace: true, hr: true });
  /* Said in the notes is the same as tapped. */
  d4.actual.notes = 'Blowing a gale on the seafront.';
  assert.equal(a.sessionConditions(d4).wind, true);
  d4.actual.notes = 'No wind at all, lovely.';
  assert.equal(a.sessionConditions(d4).wind, false, 'a note saying there was no wind was read as wind');
  d4.actual.notes = 'GPS was all over the place under the trees.';
  assert.equal(a.sessionConditions(d4).gpsDoubt, true, 'GPS trouble written in the notes was not read');
  assert.equal(a.sessionConditions(d4).pace, false);
  assert.equal(a.sessionConditions(d4).hr, true);
});

test('measured climbing counts, unless the athlete doubted the watch or the hills were the session', () => {
  const a = app();
  const d = easyDays(a).slice(-1)[0];
  d.actual.elevationGainM = Math.round(d.actual.km * 20);
  const c = a.sessionConditions(d);
  assert.equal(c.measuredClimb, 'hilly');
  assert.equal(c.hills, false, 'a measurement was taken as the athlete’s word');
  assert.equal(c.pace, false); assert.equal(c.hr, false);
  d.actual.elevationGainM = Math.round(d.actual.km * 10);
  assert.equal(a.sessionConditions(d).measuredClimb, null, 'rolling ground was read as a hilly route');
  d.actual.elevationGainM = Math.round(d.actual.km * 20);
  tap(a, d, 'watch');
  assert.equal(a.sessionConditions(d).measuredClimb, null, 'a climb the athlete marked unreliable was believed');
  const hillReps = a.state.days.filter(x => x.completed && a.isHillRepeats(x))[0];
  if (hillReps){
    hillReps.actual.elevationGainM = Math.round(hillReps.actual.km * 40);
    assert.equal(a.sessionConditions(hillReps).measuredClimb, null, 'the climbing of a hill session was read as a hilly route');
  }
});

test('the memory carries the answer, and pace and heart rate are learned only where they mean fitness', () => {
  const a = app();
  const [hilly, windy, off, clean] = easyDays(a).slice(-4);
  tap(a, hilly, 'hilly'); tap(a, windy, 'windy'); tap(a, off, 'watch');
  const rec = d => a.athleteMemory(400).filter(r => r.date === d.date)[0];
  assert.equal(a.paceIsReadable(rec(hilly)), false);
  assert.equal(a.paceIsReadable(rec(windy)), false);
  assert.equal(a.paceIsReadable(rec(off)), false);
  assert.equal(a.paceIsReadable(rec(clean)), true);
  assert.equal(a.hrIsReadable(rec(hilly)), false);
  assert.equal(a.hrIsReadable(rec(windy)), false);
  assert.equal(a.hrIsReadable(rec(off)), true, 'Watch data off threw away the heart rate');
  assert.equal(a.hrIsReadable(rec(clean)), true);
  /* An archive written before the answer existed is read as it always was. */
  const old = Object.assign({}, plain(rec(clean)));
  delete old.runConditions;
  assert.equal(a.paceIsReadable(old), true);
  assert.equal(a.hrIsReadable(old), true);
});

test('slow hilly runs do not drag the easy pace baseline; the same runs on the flat do', () => {
  const a = app();
  const before = a.athleteBaselines(42).easy.pace;
  const inWindow = easyDays(a).filter(d => d.date > a.addDays(PIN, -42));
  const keep = 4;                                            // BASELINE_MIN_SAMPLES left clean
  const slowed = inWindow.slice(keep);
  assert.ok(slowed.length > inWindow.length / 2, 'the fixture cannot move a median');
  slowed.forEach(d => { d.actual.pace = a.secToClock(a.actualPaceSecPerKm(d) + 90); });
  const flat = a.athleteBaselines(42).easy.pace;
  assert.ok(flat > before + 30, 'the baseline no longer learns from flat running at all');
  slowed.forEach(d => tap(a, d, 'hilly'));
  assert.equal(a.athleteBaselines(42).easy.pace, before, 'hilly runs moved what SACORO thinks your easy pace is');
});

test('the efficiency graph and the threshold reading leave out what the route or the watch moved', () => {
  const a = app();
  const n = () => a.coachGraphEasyRuns().length;
  const all = n();
  assert.ok(all >= 4, 'the fixture has too few easy runs with heart rate');
  const [h, w, o] = easyDays(a).slice(-3);
  tap(a, h, 'hilly'); assert.equal(n(), all - 1, 'a hilly run is still on the efficiency graph');
  tap(a, w, 'windy'); assert.equal(n(), all - 2, 'a windy run is still on the efficiency graph');
  tap(a, o, 'watch'); assert.equal(n(), all - 3, 'a run with the watch in doubt is still on the efficiency graph');
  /* The ones that stay are untouched. */
  const kept = plain(a.coachGraphEasyRuns()).map(r => r.date);
  [h, w, o].forEach(d => assert.ok(kept.indexOf(d.date) === -1));

});

test('a windy or watch-doubted threshold session does not set the threshold reading', () => {
  /* The same fixture as the dashboard's own threshold law: main-set paces typed in. */
  const TODAY = '2026-12-04';
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave', 'replaceCard', 'patchDerivedStats', 'patchExecutionUI', 'patchSplitsTotal']
    .forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: 'full', volume: 45, weeks: 12, lthr: 172, maxHR: 188, startDate: '2026-10-06' });
  const th = a.state.days.filter(d => d.type !== 'rest' && d.date < TODAY && a.assessPlan(d).work.some(x => x.intensity === 'threshold'));
  const band = a.getActivePaces().T, mid = Math.round((band.fast + band.slow) / 2);
  th.slice(0, 3).forEach(d => {
    logAsPrescribed(a, d, { quality: 1 });
    Array.from(a.loggingModeFor(d).plan.rows).filter(r => r.role === 'work')
      .forEach(r => a.handleStructuredSplitChange(d.id, r.segId, 'pace', a.secToPace(mid)));
  });
  const read = () => plain(a.coachGraphThresholdSessions());
  const base = read();
  assert.equal(base.rows.length, 3, 'the fixture has no threshold reading');
  tap(a, th[2], 'windy');
  let r = read();
  assert.equal(r.rows.length, 2, 'a windy threshold session still sets the threshold reading');
  assert.equal(r.conditioned, 1);
  tap(a, th[1], 'watch');
  r = read();
  assert.equal(r.rows.length, 1, 'a threshold session with the watch in doubt still sets the threshold reading');
  assert.equal(r.conditioned, 2);
});

test('the athlete’s Hilly or Windy means a hard run there is not counted as strain; a measured climb does not', () => {
  const a = app();
  const d = easyDays(a).slice(-1)[0];
  assert.equal(a.effortIsReadable(d), true);
  tap(a, d, 'hilly'); assert.equal(a.effortIsReadable(d), false, 'a hilly run’s effort was held against recovery');
  tap(a, d, 'hilly'); tap(a, d, 'windy'); assert.equal(a.effortIsReadable(d), false, 'a windy run’s effort was held against recovery');
  tap(a, d, 'windy'); tap(a, d, 'watch'); assert.equal(a.effortIsReadable(d), true, 'a doubted watch excused the athlete’s own effort');
  tap(a, d, 'watch');
  /* The standing ruling on measured climbing: context, never Recovery. */
  d.actual.elevationGainM = Math.round(d.actual.km * 25);
  assert.equal(a.effortIsReadable(d), true, 'a measured climb reached Recovery');
  /* And the usual-response reading treats them as conditions, not the athlete. */
  const dev = fnBody('personalDeviation');
  assert.match(dev, /rc\.hills \|\| rc\.wind/);
  assert.match(dev, /f\.baselineExecution!=null && !rc\.gpsDoubt/);
  const cmp = fnBody('comparabilityOf');
  assert.match(cmp, /!!rc\.hills \|\| !!rc\.wind/);
});

test('with the watch in doubt, the rep paces cannot say a set faded; the athlete still can', () => {
  const a = app();
  const reps = a.state.days.filter(d => d.completed && a.fadeFamilyOf(d) === 'reps' && d.type !== 'checkpoint').slice(-1)[0];
  assert.ok(reps, 'the fixture has no rep session');
  a.structuredRepFadePct = () => 12;
  assert.equal(a.sessionFadeReading(reps).basis, 'measured');
  tap(a, reps, 'watch');
  assert.equal(a.sessionFadeReading(reps), null, 'a fade was read from paces the athlete said were wrong');
  a.handleLogAnswer(reps.id, 'mainSetHeld', '5');
  const r = plain(a.sessionFadeReading(reps));
  assert.equal(r.basis, 'reported'); assert.equal(r.faded, true);
});

test('none of it reaches a score, a prescription or the card', () => {
  const a = app();
  const d = easyDays(a).slice(-1)[0];
  const score = a.computeExecutionScore(d);
  const card = a.renderDayCard(d);
  const plan = plain(a.state.days.filter(x => x.date > PIN).map(x => [x.date, x.type, x.km]));
  tap(a, d, 'hilly'); tap(a, d, 'windy');
  assert.equal(a.computeExecutionScore(d), score, 'a tile re-marked the session');
  assert.deepEqual(plain(a.state.days.filter(x => x.date > PIN).map(x => [x.date, x.type, x.km])), plan, 'a tile changed the plan');
  /* Founder: "Don't think so" to showing them. The card says what it said. */
  assert.doesNotMatch(a.renderDayCard(d).replace(card, ''), /Hilly|Windy|Watch data off/);
  ['computeExecutionScore', 'computeExecutionBreakdown', 'computeConfidenceScore']
    .forEach(f => assert.ok(!/sessionConditions|paceIsReadable/.test(fnBody(f)), f + ' reads the conditions'));
});
