'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* THE FOUR RECORD PANELS IN THE SHARED STRUCTURE.
   Founder, with reference pages for Measured Fitness, Progress, Goal and
   Benchmark: "Just the structure. No silly symbols. The words / title does
   the talking. Make sure the details link up to the evidence we collect." */

const TODAY = '2026-05-20';
function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  buildPlan(a, { weeks: 16, distanceKey: 'half', startDate: a.addDays(TODAY, -42), lthr: 170, maxHR: 190 });
  a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').forEach((d, i) => {
    if (i % 8 === 5) return;
    logAsPrescribed(a, d, { quality: 1, sections: true });
  });
  return a;
}
const body = html => html.slice(html.indexOf('<div class="modal-body">'));

test('all four open on the circle, close on SACORO’s Read, and carry no symbol or dash', () => {
  const a = athlete();
  ['fitness', 'progress', 'goal', 'benchmark'].forEach(k => {
    const p = a.RECORD_PANELS[k]();
    assert.match(p, /class="rp-hero"/, k + ' does not open on its circle');
    assert.match(p, /SACORO’s Read/, k + ' has no read');
    assert.doesNotMatch(body(p), /<svg(?![^>]*class="(rd-|cr-|gauge|pt-|outlook))/,
      k + ' carries an icon');
    // the circle's own dash is its empty figure; the words after it carry none
    assert.doesNotMatch(p.slice(p.indexOf('rp-hero-say')).replace(/<[^>]+>/g, ''), /\u2014/, k + ' carries an em dash');
  });
});

test('PROGRESS: the figures are the logged runs and distance', () => {
  const a = athlete();
  const s = a.computeStats();
  const p = a.RECORD_PANELS.progress();
  assert.match(p, new RegExp('Runs Completed</div><div class="rec-stat-v">' + s.completedRuns + '/' + s.totalRuns + '<'));
  assert.match(p, new RegExp('Distance Run</div><div class="rec-stat-v">' + a.kmToDisplay(s.completedKm) + '<'));
});

test('MEASURED FITNESS: the evidence is counted from the performances recorded', () => {
  const a = athlete();
  const chk = a.state.days.filter(d => d.type === 'checkpoint')[0];
  chk.date = a.addDays(TODAY, -1);
  chk.completed = true; chk.actual = { km: chk.km, pace: '4:05', hr: 168, rpe: 9, notes: '' };
  a.recordMeasuredPerformance(chk);
  const n = a.measuredPerformances().filter(x => x.source === 'checkpoint').length;
  assert.ok(n >= 1);
  assert.match(a.RECORD_PANELS.fitness(), new RegExp('Checkpoints</div><div class="rec-stat-v">' + n + '<'));
});

test('BENCHMARK: distance and reference pace come from the benchmark itself', () => {
  const a = athlete();
  a.state.setup.benchmark = { distanceKey: '10k', timeSec: 45 * 60 };
  const p = a.RECORD_PANELS.benchmark();
  assert.match(p, /Distance<\/div><div class="rec-stat-v">10K</);
  assert.match(p, /Reference Pace<\/div><div class="rec-stat-v">4:30<span class="rec-stat-u">\/km/);
  assert.match(p, /Training Calibration/);
  assert.match(p, /data-action="open-recalibrate">Update benchmark &amp; re-calibrate</);
});
