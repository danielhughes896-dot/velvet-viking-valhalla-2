'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* THE COACH PAGE'S THREE INSTRUMENTS.

   Founder, with mock-ups: the Confidence gauge as three rings, "1. Execution
   - inner 2. Consistency - middle 3. Race goal - outer", with the three
   labels moved off the Coach page "into its expanded page"; Evolution as four
   glass petals "representative of the length of each phase ... naturally
   ordered", clear glass that fills with the phase colour as the phase
   progresses; Adaptation as the torus. Then: "Build it, and fix the em dash.
   And make the 2 smaller petals slightly bigger."

   Each clause is a law below. */

const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const TODAY = '2026-05-20';

function coach(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  buildPlan(a, { weeks: 16, distanceKey: 'half', startDate: a.addDays(TODAY, -42), lthr: 170, maxHR: 190 });
  a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').forEach((d, i) => {
    if (i % 8 === 5) return;
    logAsPrescribed(a, d, { quality: (i % 4 === 2 ? 0.8 : 1), sections: true });
  });
  return a;
}

test('CONFIDENCE: three rings, race goal outer, consistency middle, execution inner', () => {
  const a = coach();
  const radii = a.CONFIDENCE_RINGS.map(r => [r.key, r.r]);
  assert.equal(JSON.stringify(radii), JSON.stringify([['goal', 46.5], ['consistency', 39.5], ['execution', 32.5]]));
  const g = a.renderConfidenceGauge();
  assert.equal((g.match(/class="gauge-fill"/g) || []).length, 3, 'three filled arcs on the gauge');
  assert.equal((g.match(/class="gauge-track"/g) || []).length, 3, 'three tracks on the gauge');
  assert.doesNotMatch(g, /gauge-inner-rim/, 'the old inner rim is back');
  assert.doesNotMatch(g, /Execution|Consistency|Race goal/, 'the ring labels are back on the Coach page');
});

test('CONFIDENCE: each ring reads its own figure from the last four weeks', () => {
  const a = coach();
  const bd = a.computeConfidenceBreakdown();
  const from = a.addDays(TODAY, -28);
  const set = a.state.days.filter(d => d.type !== 'rest' && d.date >= from && d.date < TODAY);
  const run = set.filter(d => d.completed);
  assert.equal(bd.consistency, Math.round(100 * run.length / set.length));
  const sc = run.map(d => a.computeExecutionScore(d)).filter(v => v != null);
  assert.equal(bd.execution, Math.round(sc.reduce((x, y) => x + y, 0) / sc.length));
  assert.equal(bd.goal, Math.round(Math.max(0, Math.min(100, a.computeConfidenceScore()))));
});

test('CONFIDENCE: with nothing logged a ring is its track alone, never a guess', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  buildPlan(a, { weeks: 16, distanceKey: 'half', startDate: a.addDays(TODAY, -42), lthr: 170, maxHR: 190 });
  const bd = a.computeConfidenceBreakdown();
  assert.equal(bd.execution, null);
  const panel = a.readingPanel('readiness');
  assert.match(panel, /Confidence Breakdown/);
});

test('READINESS PANEL: the breakdown, inner ring first, then goal day and phase, then the note', () => {
  const a = coach();
  const p = a.readingPanel('readiness');
  const at = s => { const i = p.indexOf(s); assert.ok(i !== -1, s + ' is missing'); return i; };
  assert.ok(at('The Evidence') < at('Confidence Breakdown'));
  assert.ok(at('Confidence Breakdown') < at('>Execution<'));
  assert.ok(at('>Execution<') < at('>Consistency<'));
  assert.ok(at('>Consistency<') < at('>Race goal<'));
  assert.ok(at('>Race goal<') < at('Goal day'));
  assert.ok(at('Goal day') < at('>Phase<'));
  assert.ok(at('>Phase<') < at('Confidence reflects how closely'));
  assert.equal((p.match(/class="cb-ring"/g) || []).length, 3, 'one small ring graph per row');
  assert.match(p, /class="rd-rings"/, 'the hero restates the three rings');
});

test('READINESS PANEL: the em dash is gone from the note', () => {
  const a = coach();
  const note = a.readingPanel('readiness').match(/Confidence reflects[^<]*/)[0];
  assert.doesNotMatch(note, /—/);
  assert.match(note, /what was prescribed\. It settles as more sessions are logged/);
  Object.values(a.CONFIDENCE_RING_SAY).forEach(s => assert.doesNotMatch(s, /[—–]/));
});

test('EVOLUTION: four petals, Base Build Peak Taper clockwise from top left, sized by phase length', () => {
  const a = coach();
  const ph = a.blockPhaseProgress();
  assert.equal(ph.map(p => p.name).join(), 'Base,Build,Peak,Taper');
  assert.equal(ph.reduce((s, p) => s + p.weeks, 0), a.totalWeeksInPlan());
  const svg = a.evolutionPetalsHtml(ph);
  const radii = [...svg.matchAll(/<clipPath[^>]*><path d="M([\d.]+),([\d.]+) L([\d.]+),/g)]
    .map(m => Math.abs(+m[3] - +m[1]));
  const most = Math.max(...ph.map(p => p.weeks));
  ph.forEach((p, i) => {
    const want = 44 * (a.PETAL_MIN_SHARE + (1 - a.PETAL_MIN_SHARE) * p.weeks / most);
    assert.ok(Math.abs(radii[i] - want) < 0.02, p.name + ' petal is not sized by its length');
  });
  // the smaller petals were made slightly bigger: never below the floor share
  assert.ok(a.PETAL_MIN_SHARE > 0 && a.PETAL_MIN_SHARE <= 0.25);
  // top-left first, then clockwise
  const q = [...svg.matchAll(/<clipPath[^>]*><path d="M([\d.]+),([\d.]+) L([\d.]+),[\d.]+ A[\d., ]+ [01] ([\d.]+),([\d.]+)/g)]
    .map(m => [Math.sign(+m[3] - +m[1]), Math.sign(+m[5] - +m[2])]);
  assert.deepEqual(q, [[-1, -1], [1, -1], [1, 1], [-1, 1]]);
});

test('EVOLUTION: clear glass fills with the phase colour as the phase passes', () => {
  const a = coach();
  const ph = a.blockPhaseProgress();
  const now = ph.find(p => p.state === 'now');
  assert.ok(now, 'no current phase');
  assert.equal(now.frac, now.week / now.weeks);
  ph.filter(p => p.state === 'done').forEach(p => assert.equal(p.frac, 1));
  ph.filter(p => p.state === 'next').forEach(p => assert.equal(p.frac, 0));
  const fills = (a.evolutionPetalsHtml(ph).match(/clip-path="url\(/g) || []).length;
  assert.equal(fills, ph.filter(p => p.frac > 0).length, 'an unstarted petal is filled, or a started one is empty');
});

test('EVOLUTION PANEL: current phase, week of the phase, its ring, and the plain note', () => {
  const a = coach();
  const fut = a.state.days.filter(d => d.date > TODAY && d.type !== 'rest');
  a.state.evolutionHistory = [{ date: a.addDays(TODAY, -2), accepted: true, changes: [{ dayId: fut[1].id }] }];
  const p = a.readingPanel('evolution');
  const now = a.blockPhaseProgress().find(x => x.state === 'now');
  assert.match(p, new RegExp('Current Phase: ' + now.name));
  assert.match(p, new RegExp('Week ' + now.week + ' of ' + now.weeks));
  const pct = Math.round(now.frac * 100);
  assert.match(p, new RegExp(pct + '% of the scheduled phase elapsed, not a fitness score\\.'));
  assert.ok(p.indexOf('Current Phase') < p.indexOf('The Evidence'), 'the phase sits before the evidence');
  assert.match(p, /Recently evolved/i, 'Recently evolved is gone');
});

test('ADAPTATION: the torus, quieter while it is still learning', () => {
  const a = coach();
  assert.match(a.torusRingHtml('var(--z-mp)', false), /class="rd-torus"/);
  assert.match(a.torusRingHtml('var(--z-mp)', true), /class="rd-torus is-learning"/);
  assert.match(SRC, /k === 'adaptation' \? torusRingHtml\(/);
  assert.match(SRC, /k === 'evolution' \? evolutionPetalsHtml\(blockPhaseProgress\(\)\)/);
});

test('one style block still', () => {
  assert.equal((SRC.match(/<style[\s>]/g) || []).length, 1);
});

test('the same page renders the same string twice: the shapes name their gradients once', () => {
  const a = coach();
  assert.equal(a.renderSacoroInstruments(), a.renderSacoroInstruments());
  assert.equal(a.readingPanel('readiness'), a.readingPanel('readiness'));
});
