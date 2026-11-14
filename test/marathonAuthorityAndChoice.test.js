'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

/* MARATHON AUTHORITY, AND WHAT AN UNREACHABLE STANDARD MEANS
   =========================================================================
   TWO HQ RULINGS, HELD HERE.

   AUTHORITY. Experience/pathway determines the destination architecture;
   demonstrated frequency determines the safe starting ROUTE into it. A
   frequency the athlete happens to arrive with must never suppress the
   destination -- and 80 is a MINIMUM, so removing that dependency must not
   converge capable athletes onto the floor either.

   CHOICE. An INSUFFICIENT reachability verdict says the optimal preparation
   standard is not safely reachable. It does not say Sacoro refuses to build
   a Marathon. The athlete is given a recommendation and a real alternative,
   and if they continue they get the safest useful programme their capacity and
   runway allow, with the limitation carried by the plan from day one. */

const TODAY = '2026-11-02';
const r1 = x => Math.round(x * 10) / 10;
const LOCK = { novice:{v:60,l:28,d:4}, experienced:{v:80,l:30,d:5}, advanced:{v:93,l:32,d:6} };

function athlete(exp, cap, demF){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.state = a.makeDefaultState();
  const act = [1,2,3,5,6,0,4].slice(0, LOCK[exp].d);
  a.state.setup = Object.assign({}, a.state.setup || {}, {
    experience: exp, distanceKey:'full', purpose:'race', hasEvent:true, planWeeks:15,
    currentVolume: cap, schedule:{ activeDays:act, longRunDay:6 }, startDate: TODAY });
  a.demonstratedSustainableVolume = () => cap;
  a.demonstratedLongRunKm = () => r1(cap * 0.35);
  a.demonstratedRunningFrequency = () => demF;
  a.currentSustainedRunningFrequency = () => demF;
  return a;
}
function solve(exp, cap, demF){
  const a = athlete(exp, cap, demF);
  return a.raceGoalDestinationSolve('full', exp, null, 15,
    { availableDays: LOCK[exp].d, easyPaceSecPerKm: 330 });
}
function outlook(exp, cap, demF){
  const a = athlete(exp, cap, demF);
  return a.raceGoalPreparationOutlook('full', null, 15, { easyPaceSecPerKm: 330 });
}

// ---------------------------------------------------------------------------
// 1. THE AUTHORITY SPLIT
// ---------------------------------------------------------------------------
test('ESTABLISHED — the destination is invariant across demonstrated frequency', () => {
  /* The defect: `grown` carried the athlete's shape forward as startSupportKm x
     startDays -- the share of their week LABELLED support at entry -- and
     measured it against a long run marathonSessionStart() had raised to make
     the week expressible in few sessions. Both move with the start day count
     while the athlete does not. Measured before the fix, 12.5 / 12.5 / 13.9
     for one athlete; the delivered week 79.5 / 79.5 / 84. */
  [30, 40, 52, 60, 70].forEach(cap => {
    const dests = [3, 4, 5].map(f => solve('experienced', cap, f).supportDestKm);
    assert.equal(new Set(dests).size, 1,
      cap + 'km/week: the destination moved with demonstrated frequency — ' + dests.join(' / '));
  });
});

test('ESTABLISHED — the starting route still reads demonstrated evidence', () => {
  /* The other half of the ruling, and the one a careless fix would break:
     removing frequency from the DESTINATION must not remove it from the ROUTE.
     An athlete demonstrating three running days still starts on fewer
     supporting days than one demonstrating five. */
  const starts = [3, 4, 5].map(f => solve('experienced', 40, f).startDays);
  assert.deepEqual(starts, [1, 2, 3],
    'the start no longer reflects demonstrated frequency: ' + starts.join(' / '));
  for (let i = 1; i < starts.length; i++)
    assert.ok(starts[i] > starts[i - 1], 'start days must rise with demonstrated frequency');
});

test('ADVANCED — starting frequency cannot alter destination authority', () => {
  /* Advanced needed no methodology change: byCoherence (longDest x
     SUPPORT_SHARE_MIN) dominates `grown` at every frequency. It is protected
     only INCIDENTALLY by that, which is exactly why it is asserted rather
     than assumed -- a future change to the coherence band would otherwise
     expose it silently. */
  [30, 40, 52, 60, 70].forEach(cap => {
    const dests = [3, 4, 6].map(f => solve('advanced', cap, f).supportDestKm);
    assert.equal(new Set(dests).size, 1,
      cap + 'km/week: Advanced destination moved with demonstrated frequency — ' + dests.join(' / '));
  });
});

test('80 IS A MINIMUM AND NOT A CEILING — capacity still delivers above it', () => {
  /* The failure mode of a careless invariance fix is convergence on the
     pathway floor. Capacity, not frequency, is the legitimate channel for
     exceeding it, and it must survive. */
  const high = outlook('experienced', 70, 5);
  assert.ok(high.reachWeekKm > 80,
    '70km/week Established delivers ' + high.reachWeekKm + ', not above the locked 80');
  const mid = outlook('experienced', 60, 4);
  assert.ok(mid.reachWeekKm > 80,
    '60km/week Established delivers ' + mid.reachWeekKm + ', not above the locked 80');
});

test('A REACHABLE LOCKED STANDARD IS NEVER DELIVERED SHORT', () => {
  /* The D2 condition, asserted as the guard it is. byDestination still budgets
     quality at the supporting run's size while the block prescribes a
     structure-derived session, so a residual can in principle be stranded --
     see the Stage 3 note. No REACHABLE case demonstrates it: where the athlete
     reaches the standard at all, the delivered week closes on it or above. If
     this ever fails, the latent arithmetic has become real and that is the
     demonstrated defect to fix. */
  ['novice', 'experienced', 'advanced'].forEach(exp => {
    const L = LOCK[exp];
    [30, 40, 52, 60, 70].forEach(cap => {
      [3, 4, L.d].forEach(f => {
        const o = outlook(exp, cap, f);
        if (o.verdict === 'INSUFFICIENT') return;          // not reachable; nothing to close
        assert.ok(o.reachWeekKm + 1e-9 >= L.v,
          exp + ' @' + cap + 'km demF' + f + ': READY but delivers ' +
          o.reachWeekKm + ' against a locked ' + L.v);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// 2. INSUFFICIENT IS A CHOICE, NOT A REJECTION
// ---------------------------------------------------------------------------
function modalApp(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.state = a.makeDefaultState();
  return a;
}
const ADM = { weeksToRace:12, recommend:'base', preparation:{ verdict:'INSUFFICIENT',
  limitedBy:'workload', dimensions:[
    { key:'workload', reachedKm:73, requiredKm:80, shortfallKm:7, met:false },
    { key:'durability', reachedKm:30, requiredKm:30, shortfallKm:0, met:true }] } };

test('THE RECOMMENDATION IS EIGHT WEEKS, AND ONLY HERE', () => {
  const a = modalApp();
  assert.equal(a.MARATHON_PREP_BASE_WEEKS, 8);
  const html = a.raceGoalPreparationHtml(ADM, 'full');
  assert.match(html, /8 weeks to develop aerobic durability/);
  assert.match(html, /data-weeks="8"/);
  /* THE GLOBAL DEFAULT IS NOT TOUCHED. Every other way into an Aerobic Base
     block -- the runway offer, Settings, startDevelopmentBlock() itself --
     keeps the ten weeks it had. */
  assert.equal(a.builderDefaultWeeks('base'), 10,
    'the global Aerobic Base default moved; it must stay 10');
});

test('BOTH ANSWERS ARE REAL, AND CONTINUE IS NOT AN APOLOGY', () => {
  const html = modalApp().raceGoalPreparationHtml(ADM, 'full');
  assert.match(html, /Your Full Marathon preparation/);
  assert.match(html, /Recommended: Build Aerobic Base/);
  assert.match(html, /data-action="prep-route"/);
  assert.match(html, /data-action="prep-continue"/);
  assert.match(html, /safest useful Full Marathon programme/);
  assert.match(html, /as far toward the standard as can safely be achieved/);
  /* The old obstacle framing is gone: this is a coaching decision about the
     athlete's preparation, not a report that something is not enough yet. */
  assert.doesNotMatch(html, /is not enough yet/);
  assert.doesNotMatch(html, /anyway/);
});

test('THE DECISION SURFACE IS ISOLATED AND PHOTOGRAPHIC', () => {
  const a = modalApp();
  const html = a.raceGoalPreparationHtml(ADM, 'full');
  assert.match(html, /modal-decision-hero/);
  const SRC = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  /* A PHOTOGRAPH, not vector artwork, and both delivery densities. */
  assert.ok(SRC.indexOf('valhalla-mountains-820.jpg') !== -1, 'the 2x hero is not referenced');
  assert.ok(SRC.indexOf('valhalla-mountains-420.jpg') !== -1, 'the 1x hero is not referenced');
  /* PINNED DARK IN BOTH THEMES -- the one surface in the app that does. */
  assert.match(SRC, /\.modal-card\.modal-decision\{[^}]*color-scheme:dark/);
});

// ---------------------------------------------------------------------------
// 3. THE LIMITATION THE PLAN CARRIES
// ---------------------------------------------------------------------------
function limitedSetup(a, over){
  a.state.setup = Object.assign({ purpose:'race', distanceKey:'full',
    preparationLimited: { distanceKey:'full', verdict:'INSUFFICIENT', limitedBy:'workload',
      weeksToRace:12, sig:'SIG-A', dimensions:[
        { key:'workload', reachedKm:73, requiredKm:80, shortfallKm:7, met:false },
        { key:'durability', reachedKm:30, requiredKm:30, shortfallKm:0, met:true }] } }, over || {});
  return a;
}

test('THE LIMITATION IS VISIBLE FROM DAY ONE, not only at the checkpoint', () => {
  const a = limitedSetup(modalApp());
  const html = a.renderPreparationLimitedCard();
  assert.ok(html.length > 0, 'nothing is shown on day one');
  assert.match(html, /Preparation standard/);
  /* IT STATES WHAT IS SHORT, in the athlete's own units, and names only the
     dimension that actually fell short -- the long run met its 30km here. */
  assert.match(html, /73km/);
  assert.match(html, /80km/);
  assert.doesNotMatch(html, /long run reaches/);
  /* AND IT CLAIMS NOTHING ABOUT THE ATHLETE. The programme is still the
     safest useful one their capacity and runway allow. */
  assert.match(html, /safest useful programme/);
});

test('THE LIMITATION DOES NOT OUTLIVE THE PLAN IT DESCRIBES', () => {
  /* Keyed to admissionInputsSignature() at the point it is written, so a
     regeneration on different inputs writes null. Guarded again on read for a
     stored plan whose distance or purpose was changed by another path. */
  const a = limitedSetup(modalApp());
  assert.ok(a.raceGoalPreparationLimited(), 'a valid limitation should read back');
  a.state.setup.distanceKey = 'half';
  assert.equal(a.raceGoalPreparationLimited(), null, 'it survived a distance change');
  a.state.setup.distanceKey = 'full';
  a.state.setup.purpose = 'base';
  assert.equal(a.raceGoalPreparationLimited(), null, 'it survived a purpose change');
  a.state.setup.purpose = 'race';
  a.state.setup.preparationLimited = null;
  assert.equal(a.raceGoalPreparationLimited(), null);
  assert.equal(a.renderPreparationLimitedCard(), '');
});

test('A PLAN THAT REACHED THE STANDARD SAYS NOTHING', () => {
  /* The card is for a measured shortfall, not a standing disclaimer. */
  const a = limitedSetup(modalApp(), { preparationLimited: {
    distanceKey:'full', verdict:'MARGINAL', limitedBy:null, dimensions:[
      { key:'workload', reachedKm:80, requiredKm:80, shortfallKm:0, met:true },
      { key:'durability', reachedKm:30, requiredKm:30, shortfallKm:0, met:true }] } });
  assert.equal(a.renderPreparationLimitedCard(), '',
    'a plan with nothing short still showed a limitation');
});

test('CONTINUE MARATHON BUILDS THE SAFEST USEFUL PROGRAMME', () => {
  /* The athlete who continues is not handed a token block and is not forced
     to the locked standard either: they get what their capacity and runway
     safely allow, progressed under the same gate as everybody else. */
  /* A GENUINELY UNREACHABLE CASE, chosen by measurement rather than assumed:
     20km/week Established across a twelve-week runway projects 61.5 against
     the locked 80 and is refused by admission, which is precisely the athlete
     this ruling is about. (30km/week at twelve weeks DOES reach 80 and is
     therefore not a Continue case at all.) */
  const a = athlete('experienced', 20, 4);
  const o = a.raceGoalPreparationOutlook('full', null, 12, { easyPaceSecPerKm:330 });
  assert.equal(o.verdict, 'INSUFFICIENT',
    'the fixture is reachable after all, so it tests nothing: ' + o.reachWeekKm);
  const b = a.buildBlockWeeks('full', 20, 12,
    { purpose:'race', availableDays:5, easyPaceSecPerKm:330 });
  assert.ok(b && b.weeks && b.weeks.length === 12, 'no programme was built');
  const dev = b.weeks.filter(w => !w.isCutback && !w.isTaper && !w.isRace);
  assert.ok(dev.length > 0, 'the block has no developing weeks');
  const peak = Math.max(...dev.map(w => w.volume || 0));
  /* BUILT, AND GENUINELY DEVELOPING. Not a token block. */
  assert.ok(peak > 20 * 1.5,
    'the programme barely develops the athlete: peak ' + peak + ' from 20km/week');
  /* AND NOT FORCED. The locked standard is never manufactured for an athlete
     who cannot safely reach it -- they are taken as far as is safe and the
     shortfall is reported, which is what the day-one card is for. */
  assert.ok(peak < LOCK.experienced.v,
    'the locked standard was forced on an athlete who cannot safely reach it: ' + peak);
});
