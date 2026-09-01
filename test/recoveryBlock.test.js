'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* RECOVERY MUST REDUCE TRAINING STRESS, NOT MERELY STOP PROGRESSION.
 *
 * This file exists because the audit's generated evidence said a recovery
 * block was 55km/week with 13-15km of quality and a 15.4km long run in both
 * weeks -- which would not be recovery at all. It was not what any athlete is
 * prescribed: the evidence generator called buildBlockWeeks() alone, and
 * buildBlockWeeks is only the middle third of a recovery block. The volume
 * comes from developmentBlockSpec(), which multiplies by
 * RECOVERY_PROFILE.volumeFactor; the intensity comes from
 * applyRecoveryCeiling(), which runs after the days are laid out.
 *
 * The lesson is the one that matters for a claim made from a generated
 * number: a measurement taken at the wrong layer is not weaker evidence, it
 * is evidence about something else. So every assertion here drives the whole
 * path -- race block, logged, raced, recovered -- and reads the days the
 * athlete would actually see.
 */

const TODAY = '2026-08-21';
const SCHEDULE = { activeDays: [0, 1, 2, 4, 5], longRunDay: 5 };
const QUALITY = ['tempo', 'threshold', 'interval', 'repetition', 'checkpoint', 'race'];

/* A finished race block, fully logged, with the race yesterday -- then the
   recovery block Valhalla offers next. */
function recoverAfter(distanceKey, volume, opts){
  const o = opts || {};
  const today = o.today || TODAY;
  const a = loadApp({ pinnedDate: today + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey, volume, weeks: 12, startDate: a.addDays(today, -84),
                 benchSec: 45 * 60, schedule: SCHEDULE });
  a.state.athlete = a.makeAthleteRecord();
  a.state.setup.purpose = 'race';
  const blk = a.openBlock({ purpose: 'race', startDate: a.state.setup.startDate, distanceKey,
                            goalDate: a.state.setup.raceDate, hasEvent: false,
                            startVolume: volume, anchorVolume: volume });
  a.state.setup.blockId = blk.id;
  a.state.days.filter(d => d.date < today && d.type !== 'rest')
              .forEach(d => logAsPrescribed(a, d, { quality: 1 }));
  const demonstrated = a.demonstratedSustainableVolume();
  a.state.setup.raceDate = o.raceDate || a.addDays(today, -1);
  const block = a.startDevelopmentBlock('recovery', { raceDistanceKey: distanceKey });
  const days = a.state.days.filter(d => d.type !== 'rest');
  const byWeek = {};
  days.forEach(d => { (byWeek[d.week] = byWeek[d.week] || []).push(d); });
  const weekKm = Object.keys(byWeek).map(w =>
    a.round1(byWeek[w].reduce((s, d) => s + (d.km || 0), 0)));
  return { a, block, days, demonstrated, weekKm,
           prescribed: a.state.setup.currentVolume,
           quality: days.filter(d => QUALITY.indexOf(d.type) !== -1),
           longest: a.round1(Math.max.apply(null, days.map(d => d.km || 0))) };
}

const AFTER = [['5k', 40], ['10k', 45], ['half', 55], ['full', 60]];

test('a recovery block is prescribed well below what the athlete has demonstrated', () => {
  AFTER.forEach(([dk, vol]) => {
    const r = recoverAfter(dk, vol);
    const share = r.prescribed / r.demonstrated;
    assert.ok(share <= 0.6,
      dk + ': recovery prescribed ' + r.prescribed + 'km/week against a demonstrated ' +
      r.demonstrated + ' (' + Math.round(share * 100) + '%)');
    // and not so low it is a layoff dressed as a plan
    assert.ok(share >= 0.2, dk + ': recovery collapsed to ' + Math.round(share * 100) + '%');
  });
});

test('the longer the race, the deeper the reduction', () => {
  /* Not a table lookup restated -- the ORDERING is the coaching claim, and it
     must survive the volumes and the profiles that feed it.

     ORDERING ALONE IS TOO WEAK AN ASSERTION, and a mutation proved it: raising
     the marathon's volumeFactor from 0.40 to 0.55 left the marathon share at
     36% against the half's 37%, still in order, and the test passed. A rule
     that says a marathon needs more recovery than a half is not satisfied by
     one percentage point. So the ordering is asserted where the profiles are
     equal, and a real SEPARATION where they are not. */
  const shares = {};
  AFTER.forEach(([dk, vol]) => {
    const r = recoverAfter(dk, vol);
    shares[dk] = r.prescribed / r.demonstrated;
  });
  const pct = k => Math.round(shares[k] * 100) + '%';
  /* THE ORDERING IS ASSERTED ON WHAT THE ATHLETE RECEIVES, and the SEPARATION
     on the rule that produces it. Both halves of the claim survive; what has
     changed is that they can no longer be read off one number.

     The realised share is prescribed-over-DEMONSTRATED, and the denominator is
     now a property of the race block each distance actually builds. The half's
     is built from its sessions rather than from a multiplier, so it peaks
     lower and its realised share is compressed by the recovery block's own
     floors -- 47% against a 10K's 50% where the rule separates them by five
     points. Requiring five points of the QUOTIENT would make this test a
     measure of the half's peak volume, which is not what it is about.

     The mutation the comment above records is still caught: raising the
     marathon's volumeFactor to 0.55 fails the separation assertion outright,
     whatever the realised shares happen to be. */
  const rp = loadApp({ pinnedDate: '2026-08-24T09:00:00Z' }).RECOVERY_PROFILE;
  assert.ok(shares['10k'] <= shares['5k'] + 0.001,
    '10k ' + pct('10k') + ' vs 5k ' + pct('5k'));
  assert.ok(shares.half <= shares['10k'] + 0.001,
    'a half (' + pct('half') + ') recovers less than a 10K (' + pct('10k') + ')');
  assert.ok(shares.full <= shares.half + 0.001,
    'a marathon (' + pct('full') + ') recovers less than a half (' + pct('half') + ')');
  assert.ok(rp.half.volumeFactor <= rp['10k'].volumeFactor - 0.05,
    'the half and the 10K recover on the same volume factor: ' +
    rp.half.volumeFactor + ' vs ' + rp['10k'].volumeFactor);
  assert.ok(rp.full.volumeFactor <= rp.half.volumeFactor - 0.05,
    'the marathon and the half recover on the same volume factor: ' +
    rp.full.volumeFactor + ' vs ' + rp.half.volumeFactor);
  assert.ok(rp.full.weeks > rp.half.weeks && rp.half.weeks > rp['10k'].weeks,
    'and the longer race no longer recovers for longer');
});

test('no quality session survives into a recovery block', () => {
  AFTER.forEach(([dk, vol]) => {
    const r = recoverAfter(dk, vol);
    assert.equal(r.quality.length, 0,
      dk + ': ' + r.quality.map(d => d.date + ' ' + d.title).join(', '));
  });
});

test('a recovery block does not climb', () => {
  AFTER.forEach(([dk, vol]) => {
    const r = recoverAfter(dk, vol);
    const full = r.weekKm.slice(1);              // week 1 is a part week by construction
    if (full.length < 2) return;
    assert.ok(Math.max.apply(null, full) <= Math.min.apply(null, full) * 1.15,
      dk + ': recovery weeks ' + r.weekKm.join(', '));
  });
});

test('the long run in a recovery block is a run, not a long run', () => {
  AFTER.forEach(([dk, vol]) => {
    const r = recoverAfter(dk, vol);
    assert.ok(r.longest <= r.demonstrated * 0.2,
      dk + ': longest recovery run ' + r.longest + 'km against a demonstrated week of ' +
      r.demonstrated);
  });
});

test('a recovery block never sizes a session at the top of its range', () => {
  /* DEFENCE IN DEPTH, ASSERTED WHERE IT IS OBSERVABLE. applyRecoveryCeiling()
     turns every one of these into easy running, so nothing an athlete sees
     changes and no test that reads the DAYS can see this rule -- a mutation
     removing it survived the whole suite for exactly that reason. The rule is
     real nonetheless: it is what makes a quality session that escapes the
     ceiling through some future path the smallest version of itself rather than
     the largest, and the one that escaped before this branch was a 25-minute
     steady tempo, the longest the product writes.

     So it is asserted one layer down, on the specs the generator emits, and by
     the property that only holds when the dose is pinned: a block long enough
     to return to a structure must return to the SAME structure at the SAME
     size. With `pos` free it runs 0 to 1 across the block and the second
     visit is bigger; pinned at 0, the two are identical. */
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.state = a.makeDefaultState(); a.state.athlete = a.makeAthleteRecord();
  /* An ULTRA recovery block, because it is four weeks and therefore revisits
     BOTH structures. A three-week block revisits only the fartlek, and at
     recovery volumes shrinkIntervalSpec() floors a fartlek at either end of its
     range to the same rep count -- so the one structure a shorter block
     revisits is the one that cannot show the difference. That is not a reason
     to weaken the property; it is a reason to test it where it is visible. */
  const rec = a.buildBlockWeeks('ultra', 30, 4, { purpose: 'recovery' });
  const seen = {};
  rec.weeks.forEach(w => {
    // structure identity, ignoring the dimensions the dose sets
    const key = Object.keys(w.qSpec).filter(k => k !== 'reps').sort().join(',') + '/' +
                w.tSpec.type;
    const spec = JSON.stringify(w.qSpec) + '|' + JSON.stringify(w.tSpec);
    if (seen[key]) assert.equal(spec, seen[key],
      'a recovery block returned to the same structure at a different size:\n  ' +
      seen[key] + '\n  ' + spec);
    seen[key] = spec;
  });
  assert.equal(Object.keys(seen).length, 2,
    'the fixture must revisit BOTH structures to prove anything: ' +
    Object.keys(seen).join(' / '));
});

/* ------------------------------------------------------------------ *
 * THE WINDOW AND THE BLOCK ARE MEASURED IN DIFFERENT UNITS
 * ------------------------------------------------------------------ */

test('the intensity ceiling covers the whole recovery block, whatever weekday the race fell on', () => {
  /* applyRecoveryCeiling() suppresses quality for noIntensityDays FROM THE
     RACE; the block is a whole number of calendar WEEKS from the Monday after
     it. Those are not the same length, so between one and four days at the end
     of every recovery block sit outside the window. Whether a quality session
     lands on one of them depends on which weekdays the generator picked --
     which is luck, and a coaching guarantee must not rest on luck. */
  const OFFSETS = [0, 1, 2, 3, 4, 5, 6];
  AFTER.forEach(([dk, vol]) => {
    OFFSETS.forEach(off => {
      const raceDate = '2026-08-' + String(17 + off);
      const today = '2026-08-' + String(18 + off);
      const r = recoverAfter(dk, vol, { today, raceDate });
      assert.equal(r.quality.length, 0,
        dk + ', race on ' + raceDate + ': ' +
        r.quality.map(d => d.date + ' ' + d.type + ' ' + d.title).join(', '));
    });
  });
});
