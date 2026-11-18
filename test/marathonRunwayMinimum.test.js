'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

/* THE MARATHON'S OWN RUNWAY MINIMUM
   =========================================================================
   HQ RULING: twelve weeks is the minimum RECOMMENDED proper Marathon
   preparation runway, and it is explicitly NOT an admission gate. Below it
   the athlete is told the runway is short, offered the preparation route,
   and may still continue -- and if they continue they get the safest useful
   Marathon-directed programme the time allows, with no locked standard
   forced and the limitation stated honestly.

   AT TWELVE AND ABOVE NOTHING IS PROMISED EITHER. Clearing the runway
   minimum only means the calendar is no longer the objection; normal C3/C4
   reachability still decides whether the optimal preparation standard can
   safely be reached. */

const TODAY = '2026-11-02';
const r1 = x => Math.round(x * 10) / 10;
const CODE = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');

function athlete(dist, wks, cap){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.state = a.makeDefaultState();
  const act = [1,2,3,5,6];
  a.state.setup = Object.assign({}, a.state.setup || {}, {
    experience:'experienced', distanceKey:dist, purpose:'race', hasEvent:true,
    planWeeks:wks, currentVolume:cap, schedule:{ activeDays:act, longRunDay:6 }, startDate:TODAY });
  a.demonstratedSustainableVolume = () => cap;
  a.demonstratedLongRunKm = () => r1(cap * 0.35);
  a.demonstratedRunningFrequency = () => 4;
  a.currentSustainedRunningFrequency = () => 4;
  return a;
}
const adm = (dist, wks, cap) => athlete(dist, wks, cap)
  .raceGoalAdmission(dist, wks, cap, { availableDays:5, easyPaceSecPerKm:330 });

// ---------------------------------------------------------------------------
test('THE MARATHON FLOOR IS TWELVE, AND IT IS THE MARATHON\'S ALONE', () => {
  const a = athlete('full', 15, 45);
  assert.equal(a.MARATHON_MIN_WEEKS, 12);
  /* Field-by-field, not deepEqual: these objects are built inside the VM
     sandbox, so their prototype is that realm's Object.prototype and a strict
     deep-equal fails on prototype identity alone. */
  const bounds = k => { const b = a.raceGoalRunwayBounds(k); return [b.min, b.max]; };
  assert.deepEqual(bounds('full'), [12, a.RACE_GOAL_MAX_WEEKS]);
  /* HALF IS UNCHANGED -- this is not its ruling and its floor has not moved. */
  assert.deepEqual(bounds('half'), [10, a.RACE_GOAL_MAX_WEEKS]);
  assert.deepEqual(bounds('5k'),
    [a.SHORT_RACE_GOAL_MIN_WEEKS, a.SHORT_RACE_GOAL_MAX_WEEKS]);
  assert.equal(a.RACE_GOAL_MIN_WEEKS, 10, 'the shared admission floor moved');
});

test('ELEVEN WEEKS — the runway is short, and the athlete is told', () => {
  const r = adm('full', 11, 45);
  assert.equal(r.admitted, false);
  assert.equal(r.decision, 'too_short');
  /* A ROUTE, NOT A REFUSAL: the recommendation travels on the result so the
     decision surface can offer it. */
  assert.equal(r.recommend, 'aerobic_base');
  assert.equal(r.minWeeks, 12);
  assert.equal(r.weeksToRace, 11);
});

test('ELEVEN WEEKS — and Continue Marathon is genuinely available', () => {
  /* THE PART THAT MAKES "NOT AN ADMISSION GATE" TRUE RATHER THAN STATED.
     'too_short' was previously produced by raceGoalAdmission() and consumed
     only by raceProgrammeViability(), which nothing in the app calls -- so a
     short-runway marathon was built in silence. The generator now routes it
     to the same decision surface the reachability shortfall uses, which
     carries both answers. */
  const gen = CODE.slice(CODE.indexOf('function handleGeneratePlan'));
  const body = gen.slice(0, gen.indexOf('\nfunction '));
  /* Every distance with a dedicated window now (founder, on the audit's
     one-week half marathon), so the marathon is no longer named here. */
  assert.match(body, /if \(adm && !adm\.admitted && adm\.decision === 'too_short'\)\{/,
    'a short-runway race is still built in silence');
  assert.match(body, /openRaceGoalPreparationModal\(adm, distanceKey\)/);
  /* And that surface offers the route AND the continue, as it already did. */
  const a = athlete('full', 11, 45);
  const html = a.raceGoalPreparationHtml(adm('full', 11, 45), 'full');
  assert.match(html, /data-action="prep-route"/);
  assert.match(html, /data-action="prep-continue"/);
  assert.match(html, /Continue Full Marathon/);
});

test('ELEVEN WEEKS — continuing builds to the athlete, not to the locked standard', () => {
  /* HQ: a continuing athlete gets the safest useful programme the time allows,
     and the locked pathway destinations (60/28, 80/30, 93/32) are NOT to be
     forced onto a runway that cannot honestly carry them.

     Measured: the short-runway peak tracks the athlete's own demonstrated
     capacity and lands nowhere near a locked figure -- 25km/week peaks at 62,
     35km/week at 80, 45km/week at 86.5. The destination is the athlete's grown
     shape, as it is on a full runway; the runway does not substitute a
     standard for it. */
  const sched = { activeDays:[1,2,3,5,6], longRunDay:6 };
  const peakAt = (wks, cap) => {
    const a = athlete('full', wks, cap);
    const mon = a.addDays(TODAY, -a.isoWeekday(TODAY));
    const b = a.buildBlockWeeks('full', cap, wks);
    const days = a.buildDaysFromWeeks(b, a.addDays(mon, wks*7-1), sched, TODAY, true);
    assert.ok(b && b.weeks && b.weeks.length === wks,
      'no programme was built at ' + wks + ' weeks');
    const byWeek = {};
    (days||[]).forEach(d => { if (d.week == null) return;
      byWeek[d.week] = (byWeek[d.week]||0) + (d.km||d.distanceKm||d.targetKm||0); });
    const dev = b.weeks.map((w,i) => (w.isCutback||w.isTaper||w.isRace) ? 0 : (byWeek[i]||0));
    return r1(Math.max.apply(null, dev));
  };

  /* It builds, and it develops the athlete rather than holding them still. */
  const thin = peakAt(11, 25);
  assert.ok(thin > 25 * 1.5, 'the programme does not develop the athlete: ' + thin);
  /* AND THE LOCKED ESTABLISHED PEAK IS NOT MANUFACTURED. A 25km/week athlete
     on eleven weeks must not be marched at 80. */
  assert.ok(thin < 70, 'the locked standard was forced on a short runway: ' + thin);
  /* The peak answers to capacity, which is what "built to the athlete" means. */
  assert.ok(peakAt(11, 45) > thin,
    'the short-runway peak ignores the athlete\'s capacity');
});

test('ELEVEN WEEKS — compression is spent on recovery weeks, not on the peak', () => {
  /* A MEASUREMENT, DELIBERATELY NOT AN ASSERTION ABOUT WHAT IS RIGHT.
     Pre-existing composer behaviour, unchanged by the runway minimum and
     reported rather than redesigned here: a shorter runway buys its ramp by
     dropping cutback weeks (eleven weeks gets one, fifteen gets three), so for
     a 45km/week athlete the eleven-week peak (86.5) comes in ABOVE the
     fifteen-week peak (84.0). Less time should not mean more load, and this
     test exists so that the day the composer is corrected, the correction is
     visible here rather than silent. */
  const cutbacks = wks => {
    const a = athlete('full', wks, 45);
    return a.buildBlockWeeks('full', 45, wks).weeks.filter(w => w.isCutback).length;
  };
  assert.ok(cutbacks(11) < cutbacks(15),
    'the compressed block no longer drops recovery weeks -- re-measure the peaks');
});

test('ELEVEN WEEKS — the limitation is recorded and stated honestly', () => {
  /* Below the floor there may be no confident projection to price dimensions
     from, so the runway itself is recorded as the reason -- otherwise an
     athlete who continued would be shown nothing at all. */
  const a = athlete('full', 11, 45);
  a.state.setup.preparationLimited = { distanceKey:'full', verdict:'INSUFFICIENT',
    limitedBy:'runway', runwayShort:true, minWeeks:12, weeksToRace:11, dimensions:[] };
  const html = a.renderPreparationLimitedCard();
  assert.ok(html.length > 0, 'a continuing athlete is shown no limitation at all');
  assert.match(html, /11 weeks/);
  assert.match(html, /12/);
  assert.match(html, /safest useful programme the time allows/);
});

test('TWELVE WEEKS — the calendar stops objecting, and nothing else is promised', () => {
  /* Clearing the runway minimum is not a verdict about the athlete. */
  const r = adm('full', 12, 45);
  assert.equal(r.admitted, true);
  assert.equal(r.decision, 'race_goal');
  /* AND REACHABILITY STILL DECIDES. A twelve-week athlete is not automatically
     READY: the same C3/C4 measurement runs, and a capacity that cannot reach
     the locked standard in twelve weeks is still refused on its own terms. */
  const thin = adm('full', 12, 20);
  assert.equal(thin.admitted, false,
    'a 20km/week athlete was admitted at twelve weeks purely for clearing the calendar');
  assert.equal(thin.decision, 'preparation_not_reachable');
});

test('HALF MARATHON IS UNTOUCHED ACROSS THE WHOLE BOUNDARY', () => {
  /* Ten and eleven weeks are a normal half runway and must stay that way. */
  [10, 11, 12].forEach(w => {
    const r = adm('half', w, 45);
    assert.equal(r.admitted, true, 'half @' + w + 'w: ' + r.decision);
    assert.equal(r.decision, 'race_goal');
  });
  /* And the half's own floor still refuses below ten, exactly as before. */
  assert.equal(adm('half', 9, 45).decision, 'too_short');
});
