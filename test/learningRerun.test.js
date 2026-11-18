'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* THE LEARNING AUDIT, RE-RUN (16 November 2026). Each of these was a red or
   amber row in the re-run: the sheet said something the week did not
   support, or did something other than what it said. */

const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const NOW = '2026-11-16';

function athlete(log){
  const a = loadApp({ pinnedDate: NOW + 'T08:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: '10k', volume: 45, weeks: 12, startDate: '2026-10-12', healthConsent: true,
                 schedule: { activeDays: [0, 1, 3, 4, 6], longRunDay: 6 } });
  a.state.days.filter(d => d.date < NOW && d.type !== 'rest' && d.km > 0).forEach(d => log(a, d));
  return a;
}
const sheet = a => { const rv = a.weeklyCoachingReview(a.currentWeekNum()); return rv ? a.weeklyReviewCopy(rv) : null; };

test('a week logged as distances only claims no recovery readings and no reported effort', () => {
  const a = athlete((a2, d) => { d.completed = true; d.actual = Object.assign(a2.emptyActual(), { km: d.km }); });
  const c = sheet(a);
  assert.ok(c, 'no sheet');
  assert.doesNotMatch(c.why, /recovery readings are fresh/, c.why);
  assert.doesNotMatch(c.why, /reported effort stayed/, c.why);
  if (/ready to progress/.test(c.head)) assert.match(c.why, /no recovery readings to go on/);
  /* Fully logged, the same sheet still says both. */
  const full = sheet(athlete((a2, d) => logAsPrescribed(a2, d, { sections: true })));
  assert.match(full.why, /recovery readings are fresh/);
  assert.match(full.why, /reported effort stayed/);
});

test('a load spike Today reads makes the sheet’s fresh week one to watch, and it says why', () => {
  const a = athlete((a2, d) => logAsPrescribed(a2, d, { sections: true }));
  a.coachLoad = () => ({ enough: true, band: 'spike', ratio: 1.64, provisional: false });
  const s = a.weeklyInstrumentSignals();
  assert.equal(s.recovery, 'watch');
  assert.match(s.loadSpike, /^This week is 1\.64x your four-week average$/);
  const c = sheet(a);
  assert.doesNotMatch(c.why, /recovery readings are fresh/);
});

test('keeping the runs spreads the dropped run across the easy runs, as the sheet says', () => {
  const a = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: 'half', volume: 55, weeks: 14, experience: 'advanced', startDate: '2026-11-16',
                 schedule: { activeDays: [0, 1, 2, 3, 4, 6], longRunDay: 6 } });
  const W = a.state.days.map(d => d.week).filter((w, i, all) => all.indexOf(w) === i)
    .find(w => w > 1 && a.state.days.filter(d => d.week === w && d.type === 'easy' && d.km > 0).length >= 3);
  assert.ok(W, 'no week with three easy runs');
  a.todayStr = () => a.state.days.filter(d => d.week === W).map(d => d.date).sort()[0];
  const easy = a.state.days.filter(d => d.week === W && d.type === 'easy' && d.km > 0).sort((x, y) => y.km - x.km);
  const gone = easy[0], before = new Map(easy.map(d => [d.id, d.km]));
  const longKm = a.state.days.find(d => d.week === W && d.type === 'long').km;
  a.answerWeeklyReview({ kind: 'new_run', week: W, newRunId: gone.id, reasons: ['new_run'], plannedKm: 0, recommendedKm: 0, lastKm: 0 }, false);
  assert.equal(gone.km, 0);
  const rest = easy.slice(1);
  const share = Math.ceil(before.get(gone.id) / rest.length * 2) / 2 + 1;
  rest.forEach(d => {
    assert.ok(d.km - before.get(d.id) <= share, 'one easy run took ' + (d.km - before.get(d.id)) + 'km of a ' + before.get(gone.id) + 'km run');
    assert.ok(d.km <= Math.max(5, longKm * 0.75) + 0.5, 'an easy run of ' + d.km + 'km beside a ' + longKm + 'km long run');
  });
});

test('the Playbook\'s "below par" sentence carries no double-hyphen dash', () => {
  assert.doesNotMatch(SRC, /still below par --/);
  assert.match(SRC, /still below par, which is a return toward your/);
});
