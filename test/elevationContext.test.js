'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* MEASURED CLIMBING, AS CONTEXT.

   Founder: "Use measured elevation gain to contextualise session execution,
   accounting for distance, session type and evidence quality. Do not
   automatically excuse poor execution."

   The figure was collected on every log and reached the share card and
   nothing else. These laws hold what it is now allowed to do, and -- more of
   them -- what it is not. */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
const fnBody = name => { const at = SRC.indexOf('\nfunction ' + name + '('); assert.ok(at !== -1, name + ' is gone'); return SRC.slice(at, SRC.indexOf('\n}\n', at)); };
const PIN = '2026-10-20';

function app(){
  const a = loadApp({ pinnedDate: PIN + 'T19:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave', 'replaceCard', 'patchDerivedStats', 'patchExecutionUI', 'patchSplitsTotal']
    .forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: '10k', volume: 45, weeks: 12, lthr: 172, maxHR: 188, startDate: '2026-09-07', healthConsent: true });
  a.state.days.filter(d => d.date < PIN && d.type !== 'rest').forEach(d => logAsPrescribed(a, d, { quality: 1 }));
  return a;
}
/* The last easy run before today, run `gap` seconds per km slower than the
   slow edge of its window, with whatever else `mut` does to it. */
function easy(gap, mut){
  const a = app();
  const dd = a.state.days.filter(d => d.type === 'easy' && d.date < PIN).slice(-1)[0];
  const tr = a.executionPaceTarget(dd);
  if (gap != null){ dd.actual.pace = a.secToPace(Math.round(tr.slow + gap)); dd.actual.paceUnit = 'km'; }
  if (mut) mut(a, dd, tr);
  delete dd.coachReview; a.coachPersistReview(dd);
  return { a, dd, tr, r: dd.coachReview, ctx: a.sessionElevationContext(dd) };
}
const climb = perKm => (a, dd) => { dd.actual.elevationGainM = Math.round(dd.actual.km * perKm); };

// ---------------------------------------------------------------------------
// DISTANCE
// ---------------------------------------------------------------------------

test('the gain is read per kilometre run, never as a total', () => {
  const short = easy(null, (a, dd) => { dd.actual.km = 5; dd.actual.elevationGainM = 150; }).ctx;
  const long = easy(null, (a, dd) => { dd.actual.km = 30; dd.actual.elevationGainM = 150; }).ctx;
  assert.equal(short.perKm, 30); assert.equal(short.band, 'steep');
  assert.equal(long.perKm, 5); assert.equal(long.band, 'flat', '150 m over 30 km was read as a hilly run');
  /* The bands, at their edges. */
  const band = perKm => easy(null, (a, dd) => { dd.actual.km = 10; dd.actual.elevationGainM = perKm * 10; }).ctx.band;
  assert.deepEqual([7.9, 8, 14.9, 15, 29.9, 30].map(band), ['flat', 'rolling', 'rolling', 'hilly', 'hilly', 'steep']);
  /* No distance, no reading: there is nothing to divide by. */
  assert.equal(easy(null, (a, dd) => { dd.actual.elevationGainM = 200; dd.actual.km = null; }).ctx, null);
  assert.equal(easy(null).ctx, null, 'a context was made with no elevation logged');
});

// ---------------------------------------------------------------------------
// IT EXPLAINS, AND ONLY SO FAR
// ---------------------------------------------------------------------------

test('a gap within what the climbing costs is in line with the route; a gap beyond it is said to be beyond it', () => {
  const within = easy(8, climb(20)), beyond = easy(30, climb(20));
  /* The cost is the calibration, on the slow edge of the window. */
  const lo = Math.round(within.tr.slow * 20 * 0.0010), hi = Math.round(within.tr.slow * 20 * 0.0015);
  assert.deepEqual(JSON.parse(JSON.stringify(within.ctx.cost)), { lo, hi });
  assert.ok(8 <= hi && 30 > hi, 'the fixture does not straddle the allowance');
  const route = '180 m of climbing over ' + within.a.fmtDist(within.dd.actual.km);
  const typical = 'Climbing like that typically costs around ' + lo + '–' + hi + 's/km';
  assert.equal(within.r.coachNoticed, 'Pace ran 8s/km outside the window on ' + route + '. ' + typical + ', so the gap is in line with the route.');
  assert.equal(beyond.r.coachNoticed, 'Pace ran 30s/km outside the window on ' + route + '. ' + typical + ': part of the gap, not all of it.');
  assert.ok(within.r.executionVerdict.indexOf(within.r.coachNoticed) !== -1, 'the verdict and the note disagree about the route');
  assert.ok(beyond.r.executionVerdict.indexOf(beyond.r.coachNoticed) !== -1);
  assert.doesNotMatch(beyond.r.executionVerdict, /not read as lost fitness|nothing in the notes/);
  assert.equal(within.a.elevationExplains(within.ctx, 8), true);
  assert.equal(beyond.a.elevationExplains(beyond.ctx, 30), false);
  assert.equal(within.a.elevationExplains(within.ctx, hi), true); assert.equal(within.a.elevationExplains(within.ctx, hi + 1), false);
  /* Only an explained gap changes the advice that follows: it is the advice
     a typed "hilly" has always earned, and the unexplained one gets none. */
  const typed = easy(8, (a, dd) => { dd.actual.notes = 'very hilly route'; });
  const plain = easy(30);
  assert.equal(within.r.nextMove, typed.r.nextMove, 'an explained gap is still chased');
  assert.equal(beyond.r.nextMove, plain.r.nextMove, 'climbing excused a gap it does not account for');
  assert.notEqual(within.r.nextMove, beyond.r.nextMove, 'the fixture cannot tell the two apart');
});

test('it never changes the score, the training signal or Confidence', () => {
  [8, 30].forEach(gap => {
    const none = easy(gap), with_ = easy(gap, climb(20)), steep = easy(gap, climb(45));
    [with_, steep].forEach(c => {
      assert.equal(c.a.computeExecutionScore(c.dd), none.a.computeExecutionScore(none.dd), 'the climb re-marked the session');
      assert.deepEqual(JSON.parse(JSON.stringify(c.a.computeExecutionBreakdown(c.dd).parts)), JSON.parse(JSON.stringify(none.a.computeExecutionBreakdown(none.dd).parts)));
      assert.equal(c.r.trainingSignal, none.r.trainingSignal);
      assert.equal(c.r.recommendPlanAdjustment, none.r.recommendPlanAdjustment);
      assert.equal(c.a.computeConfidenceScore(), none.a.computeConfidenceScore(), 'the climb moved Confidence');
      assert.equal(c.a.coachRecovery().state, none.a.coachRecovery().state);
    });
  });
  /* Nothing that scores or decides reads it. */
  ['computeExecutionBreakdown', 'computeExecutionScore', 'coachRecovery', 'coachDecision', 'coachTrainingSignal', 'computeConfidenceScore']
    .forEach(f => assert.ok(!/sessionElevationContext|elevationGainM|elevationExplains/.test(fnBody(f)), f + ' reads the climb'));
});

test('a flat route explains nothing, and is not held against anyone', () => {
  const flat = easy(30, climb(3)), none = easy(30);
  assert.equal(flat.ctx.band, 'flat'); assert.equal(flat.ctx.cost, null);
  assert.equal(flat.a.elevationPaceSentence(flat.ctx, 30), '');
  assert.equal(flat.r.executionVerdict, none.r.executionVerdict);
  assert.equal(flat.r.coachNoticed, none.r.coachNoticed);
  assert.equal(flat.r.nextMove, none.r.nextMove);
  /* On pace, a hilly route has nothing to explain either. */
  const fine = easy(null, climb(20));
  assert.doesNotMatch(fine.r.executionVerdict + ' ' + fine.r.coachNoticed, /climbing/);
});

test('a tapped "Hilly" still stands where there is no figure, and is measured where there is', () => {
  const tapped = easy(30, (a, dd) => { a.handleLogPick(dd.id, 'conditions', 'hilly'); });
  assert.match(tapped.r.executionVerdict, /The notes put that down to hilly terrain, so it is not read as lost fitness\./);
  assert.equal(tapped.r.coachNoticed, 'Hilly terrain in the notes. Pace is read in that context rather than as lost fitness.');
  assert.notEqual(tapped.r.nextMove, easy(30).r.nextMove, 'with no figure to measure it by, the athlete\'s word no longer stands');
  /* The same tap, with the route's own figure: the hills get their share and no more. */
  const both = easy(30, (a, dd) => { a.handleLogPick(dd.id, 'conditions', 'hilly'); climb(20)(a, dd); });
  assert.match(both.r.coachNoticed, /: part of the gap, not all of it\.$/);
  assert.doesNotMatch(both.r.executionVerdict, /not read as lost fitness/, 'a tapped Hilly covered a gap the route\'s own figure does not');
  assert.equal(both.r.nextMove, easy(30).r.nextMove);
  /* A flat figure does not overrule the athlete's word: it simply has nothing to add. */
  const flatTap = easy(30, (a, dd) => { a.handleLogPick(dd.id, 'conditions', 'hilly'); climb(3)(a, dd); });
  assert.equal(flatTap.r.coachNoticed, tapped.r.coachNoticed);
  /* Anything else the athlete reported keeps the line it always had. */
  const wind = easy(8, (a, dd) => { climb(20)(a, dd); dd.actual.notes = 'brutal headwind all the way'; });
  assert.equal(wind.r.coachNoticed, 'Wind in the notes. Pace is read in that context rather than as lost fitness.');
  assert.match(wind.r.executionVerdict, /The notes put that down to wind, so it is not read as lost fitness\./, 'the climb spoke over what the athlete reported');
  assert.doesNotMatch(wind.r.executionVerdict, /climbing/);
});

// ---------------------------------------------------------------------------
// SESSION TYPE
// ---------------------------------------------------------------------------

test('what the figure can speak to depends on the session', () => {
  const a = app();
  const of = pred => a.state.days.filter(d => d.completed && pred(d, a.logShape(d))).slice(-1)[0];
  const use = (dd, gain) => { dd.actual.elevationGainM = gain; return a.sessionElevationContext(dd); };
  /* An easy run and a long run: the gain and the pace describe the same kilometres. */
  assert.equal(use(of(d => d.type === 'easy'), 200).use, 'whole');
  assert.equal(use(of(d => d.type === 'long'), 300).use, 'whole');
  /* Reps: the gain is the whole outing's, so it is stated and explains nothing. */
  const reps = of((d, s) => s.reps && !s.hills && !s.light);
  const rc = use(reps, 150);
  assert.equal(rc.use, 'context'); assert.equal(rc.cost, null);
  assert.equal(a.elevationExplains(rc, 1), false);
  assert.equal(a.elevationPaceSentence(rc, 12), 'The run carried 150 m of climbing over ' + a.fmtDist(reps.actual.km) +
    '. How much of that fell in the main set is not recorded, so it is context for the pace, not an explanation of it.');
  /* Hill repeats: climbing is the session, not a circumstance. */
  const hills = of((d, s) => s.hills);
  const hc = use(hills, 250);
  assert.equal(hc.use, 'prescribed');
  assert.equal(a.elevationPaceSentence(hc, 20), '');
  assert.equal(a.elevationExplains(hc, 1), false);
  /* A session judged on its main set's own pace is context too: the pace
     being read is the main set's, and the gain is the whole outing's. */
  const whole = of(d => d.type === 'long');
  const real = a.coachPaceEvidence;
  a.coachPaceEvidence = d => Object.assign({}, real(d), { sectioned: true });
  const sc = use(whole, 300);
  a.coachPaceEvidence = real;
  assert.equal(sc.use, 'context', 'a main-set pace was explained by the whole run\'s climbing');
  assert.equal(sc.cost, null);
  assert.equal(use(whole, 300).use, 'whole');
  /* A treadmill has no route at all. */
  const tm = of(d => d.type === 'easy');
  a.handleLogPick(tm.id, 'conditions', 'treadmill');
  assert.equal(use(tm, 200), null);
});

// ---------------------------------------------------------------------------
// EVIDENCE QUALITY
// ---------------------------------------------------------------------------

test('a figure that cannot be trusted is stated, and never used as an allowance', () => {
  /* Marked unreliable by the athlete. */
  const off = easy(8, (a, dd) => { climb(20)(a, dd); a.handleLogPick(dd.id, 'conditions', 'watch'); });
  assert.equal(off.ctx.use, 'context'); assert.equal(off.ctx.doubt, 'watch'); assert.equal(off.ctx.cost, null);
  assert.equal(off.a.elevationExplains(off.ctx, 8), false);
  assert.match(off.a.elevationPaceSentence(off.ctx, 8), /With the watch data marked unreliable, that is context for the pace, not an explanation of it\.$/);
  assert.match(off.r.executionVerdict, /With the watch data marked unreliable/);
  /* Too short a run for a per-kilometre figure to mean anything. */
  const short = easy(8, (a, dd) => { dd.actual.km = 2.5; dd.actual.elevationGainM = 60; });
  assert.equal(short.ctx.doubt, 'short'); assert.equal(short.ctx.use, 'context');
  assert.match(short.a.elevationPaceSentence(short.ctx, 8), /Over a run this short the figure is too coarse to explain the pace\.$/);
  assert.equal(easy(8, (a, dd) => { dd.actual.km = 3; dd.actual.elevationGainM = 60; }).ctx.use, 'whole');
  /* Beyond any running route: an entry error, and not read. */
  assert.equal(easy(8, (a, dd) => { dd.actual.km = 10; dd.actual.elevationGainM = 1201; }).ctx, null);
  assert.ok(easy(8, (a, dd) => { dd.actual.km = 10; dd.actual.elevationGainM = 1200; }).ctx);
  assert.equal(easy(8, (a, dd) => { dd.actual.elevationGainM = -5; }).ctx, null);
  assert.equal(easy(8, (a, dd) => { dd.actual.elevationGainM = 'abc'; }).ctx, null);
  /* Where it came from is kept. */
  assert.equal(easy(8, climb(20)).ctx.source, 'entered');
  assert.equal(easy(8, (a, dd) => { climb(20)(a, dd); dd.actual.deviceLapSource = 'watch'; }).ctx.source, 'device');
});

// ---------------------------------------------------------------------------
// WHERE IT GOES
// ---------------------------------------------------------------------------

test('it is kept with the review and the memory, and printed on the card', () => {
  const c = easy(30, climb(20));
  assert.deepEqual(JSON.parse(JSON.stringify(c.r.elevation)), JSON.parse(JSON.stringify(c.ctx)));
  const mem = Array.from(c.a.athleteMemory(40)).filter(m => m.date === c.dd.date)[0];
  assert.deepEqual(JSON.parse(JSON.stringify(mem.elevation)), { gainM: 180, perKm: 20, band: 'hilly', use: 'whole', source: 'entered' });
  assert.match(c.a.sessionReadoutHtml(c.dd), /180 m of climbing/);
  const flat = easy(30, climb(3));
  assert.doesNotMatch(flat.a.sessionReadoutHtml(flat.dd), /climbing/, 'a flat route is printed as a climb');
  assert.equal(Array.from(easy(30).a.athleteMemory(40)).filter(m => m.date === c.dd.date)[0].elevation, null);
});

test('a miles athlete is told the gap and the cost per mile', () => {
  const c = easy(8, climb(20));
  c.a.state.units = 'mi';
  const said = c.a.elevationPaceSentence(c.ctx, 8);
  assert.match(said, new RegExp('^Pace ran ' + Math.round(8 * 1.60934) + 's/mi outside the window'));
  assert.match(said, new RegExp('around ' + Math.round(c.ctx.cost.lo * 1.60934) + '–' + Math.round(c.ctx.cost.hi * 1.60934) + 's/mi'));
});
