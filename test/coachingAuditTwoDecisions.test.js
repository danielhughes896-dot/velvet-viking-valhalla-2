'use strict';
/* COACHING AUDIT II, THE FOUNDER'S DECISIONS (15 November 2026).
 *
 * A1  "a glass sheet every week the load rises, explaining why"
 * A3  a Base block has a destination above where it starts, at the 8% equation
 * A4  under six kilometres a week, the Choose Your Pathway sheet
 * A7  max heart rate on its own sets the zones when threshold is unknown
 * A8  "Agree but give the user the choice With the glass bottom": a
 *     persistent miss pattern proposes a hold
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

function athlete(pin){
  const a = loadApp({ pinnedDate: (pin || '2026-11-16') + 'T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: '10k', volume: 30, weeks: 10, experience: 'experienced',
    startDate: '2026-11-09', schedule: { activeDays: [0, 1, 3, 4, 6], longRunDay: 6 } });
  return a;
}
const runs = (a, w) => a.state.days.filter(d => d.week === w && d.type !== 'rest' && d.km > 0);
const miss = (a, d) => { a.state.unloggedAck = a.state.unloggedAck || {}; a.state.unloggedAck[d.id] = d.date; };

/* ---------------------------------------------------------------- A1 */
test('A1: every week the load rises raises the sheet, and it says why in the plan\'s own terms', () => {
  const a = athlete();
  runs(a, 1).forEach(d => logAsPrescribed(a, d, { quality: 1 }));
  const rv = a.weeklyCoachingReview(2);
  assert.equal(rv.kind, 'progress');
  assert.ok(rv.plannedKm > rv.lastKm + 0.5, 'the fixture\'s week two rises');
  assert.equal(rv.material, true);
  const c = a.weeklyReviewCopy(rv);
  assert.match(c.why, /Your plan builds towards \d/, c.why);
  assert.equal(c.yes, 'Accept Progression');
  assert.equal(c.no, 'Stay at Current Weekly Mileage');
});

test('A1: with too little logged, the sheet still comes, says so plainly and invents nothing', () => {
  const a = athlete();
  logAsPrescribed(a, runs(a, 1)[0], { quality: 1 });
  const rv = a.weeklyCoachingReview(2);
  assert.equal(rv.kind, 'insufficient');
  assert.equal(rv.material, rv.plannedKm > rv.lastKm + 0.5);
  if (!rv.material) return;
  const c = a.weeklyReviewCopy(rv);
  assert.match(c.why, /too little to judge/);
  assert.doesNotMatch(c.why, /recovery|adapting|effort stayed/i, 'no reading is claimed that was not made');
  assert.equal(c.yes, 'Accept Progression');
  assert.equal(c.no, 'Stay at Current Weekly Mileage');
  const planned = rv.plannedKm;
  a.answerWeeklyReview(rv, true);
  assert.equal(a.weekPlannedKm(2), planned, 'accepting keeps the plan\'s own step');
});

test('A1: staying at the current weekly mileage from the too-little-logged sheet holds the week', () => {
  const a = athlete();
  logAsPrescribed(a, runs(a, 1)[0], { quality: 1 });
  const rv = a.weeklyCoachingReview(2);
  if (!rv.material) return;
  a.answerWeeklyReview(rv, false);
  assert.ok(Math.abs(a.weekPlannedKm(2) - a.weekPlannedKm(1)) <= 1.5);
});

/* ---------------------------------------------------------------- A8 */
test('A8: a persistent miss pattern proposes a hold, and the athlete chooses', () => {
  const a = athlete('2026-11-23');
  runs(a, 1).forEach(d => miss(a, d));
  runs(a, 2).forEach(d => logAsPrescribed(a, d, { quality: 1 }));
  const sig = a.weeklyInstrumentSignals();
  assert.equal(sig.missPattern, 'persistent', 'fixture: half the last ten sessions went unrun');
  const rv = a.weeklyCoachingReview(3);
  if (rv.kind === 'planned_reduction') return;
  assert.equal(rv.kind, 'hold');
  assert.ok(rv.reasons.indexOf('miss_pattern') !== -1);
  const c = a.weeklyReviewCopy(rv);
  assert.match(c.why, /You have run \d+ of your last \d+ planned sessions/);
  assert.match(c.no, /Progress as Planned/, 'the athlete can decline the hold');
  const planned = a.weekPlannedKm(3);
  a.answerWeeklyReview(rv, false);
  assert.equal(a.weekPlannedKm(3), planned, 'declining keeps the plan');
});

/* ---------------------------------------------------------------- A3 */
test('A3: a Base block grows towards the experience build volume at the 8% equation', () => {
  const a = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  a.athleteExperience = () => 'experienced';
  a.baseObjectiveWeeks = 10;
  const obj = a.baseObjectiveFromDeclared(30, 'half', 999);
  const prog = a.pathwayProgressingWeeks('base', 10);
  const zone = a.raceGoalPathway('half', 'experienced');
  const want = Math.round(Math.min(zone.buildVolumeKm, 30 * Math.pow(a.PATHWAY_FEASIBLE_RATE, prog)) * 10) / 10;
  assert.equal(obj, want, 'objective ' + obj + ' against ' + want);
  assert.ok(obj > 30 * a.VOLUME_BLOCK_GROWTH_CAP, 'more than one 10% step');
  /* Already at the build volume: the ordinary one-step growth, never less. */
  assert.equal(a.baseObjectiveFromDeclared(zone.buildVolumeKm + 5, 'half', 999),
    Math.round((zone.buildVolumeKm + 5) * a.VOLUME_BLOCK_GROWTH_CAP * 10) / 10);
});

/* ---------------------------------------------------------------- A7 */
test('A7: max heart rate alone sets the zones, and a known threshold still wins', () => {
  const a = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  a.state.healthConsent = { version: a.HEALTH_CONSENT_VERSION, decision: 'granted', at: '2026-01-01T00:00:00Z' };
  a.state.setup = { lthr: null, maxHR: 190 };
  const z = a.getActiveHRZones();
  const est = Math.round(190 * a.LTHR_FROM_MAX_HR);
  assert.equal(z.T.lo, est, 'threshold zone opens at the estimated threshold');
  assert.equal(z.I.hi, 190);
  assert.match(a.lthrProvenanceSuffix(), /estimated from your max heart rate/);
  a.state.setup = { lthr: 172, maxHR: 190 };
  assert.equal(a.getActiveHRZones().T.lo, 172);
  /* Nothing without consent. */
  a.state.healthConsent = { version: a.HEALTH_CONSENT_VERSION, decision: 'declined', at: '2026-01-01T00:00:00Z' };
  a.state.setup = { lthr: null, maxHR: 190 };
  assert.equal(Object.keys(a.getActiveHRZones()).length, 0);
});

/* ---------------------------------------------------------------- A4 */
test('A4: below the entry, the builder asks the pathway question instead of refusing', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const gp = src.slice(src.indexOf('async function handleGeneratePlan'));
  const body = gp.slice(0, gp.indexOf('\nasync function'));
  const at = body.indexOf('!raceEntry.allowed');
  assert.ok(at > 0, 'the entry boundary is still read');
  const branch = body.slice(at, at + 900);
  assert.match(branch, /pathwayRecommendation\(/);
  assert.match(branch, /openPathwayOfferSheet\(/);
  assert.ok(branch.indexOf('pathwayRecommendation(') < branch.indexOf('openRaceGoalEntryModal('),
    'the old explanation is only the fallback');
  /* The recommendation it asks for: Developing (New) where reachable, Aerobic
     Base where not, and the athlete may keep their choice. */
  const a = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  const low = a.pathwayRecommendation('half', 'experienced', 4, 15);
  assert.ok(low && (low.recommend || low.recommendBase));
  const copy = a.pathwayOfferCopy(low, 'half');
  if (low.recommendBase) assert.match(copy.hint, /You can still keep this plan/);
});
