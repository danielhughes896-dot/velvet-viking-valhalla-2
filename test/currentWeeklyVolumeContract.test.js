'use strict';
/* §10  CAN CURRENT WEEKLY VOLUME LEAVE THE RACE GOAL BUILDER?
 * ===========================================================================
 * APP is removing the field. This file is the answer, and it is a measurement
 * rather than an assurance: build the same athlete four times with four
 * different typed numbers -- including none at all -- and compare the plans.
 *
 * The field stays where it still has work to do. Aerobic Base, Speed &
 * Threshold and Maintain & Protect are ramp architectures that size themselves
 * from a weekly figure, and legacy plans carry one. What must be true is that
 * nothing in a RACE GOAL reads it.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const path = require('path');
const R = require(path.join(__dirname, 'audit', 'raceGoalReachability.js'));

const TYPED = [null, 5, 30, 90];
const shape = res => crypto.createHash('sha256').update(JSON.stringify(
  res.dd.map(d => [d.week, d.type, d.km, d.title,
                   (d.prescription && d.prescription.archetype) || null]))).digest('hex');

const PATHWAYS = [['half','novice'], ['half','intermediate'], ['half','advanced'],
                  ['full','novice'], ['full','intermediate'], ['full','advanced']];

test('RACE GOAL — an athlete with evidence builds the same plan for any typed volume', () => {
  [].concat(R.CANON, R.CANON_10).forEach(c => {
    const hs = TYPED.map(v => shape(R.build(Object.assign(
      { dist:c.dist, exp:c.exp, days:c.days, weeks:c.weeks, stated:v }, c.ev))));
    assert.equal(new Set(hs).size, 1,
      c.key + ': the plan moved with the typed weekly volume');
  });
});

test('RACE GOAL — an athlete with NO evidence builds the same plan with the field or without it', () => {
  /* The harder case, because the typed figure was the only account of the
     athlete Valhalla had. The pathway answers instead: removing the field
     changes nothing, and typing a figure consistent with the pathway changes
     nothing either. */
  PATHWAYS.forEach(([d, e]) => {
    [15, 10].forEach(W => {
      const hs = [null, 30, 90].map(v => shape(R.build(
        { dist:d, exp:e, days:5, weeks:W, stated:v, tt5kMin:24 })));
      assert.equal(new Set(hs).size, 1,
        d + '/' + e + ' @' + W + 'w with no evidence: the plan moved with the typed volume');
    });
  });
});

test('RACE GOAL — a typed figure below the safety floor still defers the field test', () => {
  /* DELIBERATELY RETAINED, and the one job HQ left the typed number. An
     athlete with no history who tells Valhalla they run five kilometres a week
     is not given a maximal field test in week one on the strength of the
     pathway's assumption. It defers the TEST; it sizes nothing, admits nothing
     and moves no destination -- and once the field is gone there is no such
     figure to read, so this protects only the athletes who still supply
     one.

     HQ NARROW PATHWAY CORRECTION -- moved from Half/Experienced to
     Half/Advanced. Experienced Half's own entry dropped 30 -> 20, close
     enough to what week one already needs to hold the calibration protocol
     that BOTH the deferred and the immediate case now first become viable
     at the same week (2), collapsing the gap this test measures without
     the deferral itself having stopped working (elig.reason still reads
     'insufficient_base' for the low case). Advanced Half's entry (45) did
     not move, so it still shows the same asymmetry the old fixture did. */
  const low  = R.build({ dist:'half', exp:'advanced', days:6, weeks:15, stated:5, tt5kMin:18 });
  const none = R.build({ dist:'half', exp:'advanced', days:6, weeks:15, tt5kMin:18 });
  assert.equal(low.elig.reason, 'insufficient_base');
  assert.equal(none.elig.reason, 'eligible');
  const calLow  = low.dd.filter(d => d.type === 'calibration')[0];
  const calNone = none.dd.filter(d => d.type === 'calibration')[0];
  assert.ok(calLow && calNone, 'one of the two blocks never calibrated');
  assert.ok(calLow.week > calNone.week,
    'a typed 5km week did not defer the field test');
  /* And it moved the TEST only. The week-to-week differences that follow are
     the calibration itself landing in a different week -- it takes over that
     week's quality slot, and a fifty-two minute effort is not the same size as
     the session it replaces. What the typed figure must not touch is what the
     block is FOR: where it opens, where it is going, and what it prepares the
     athlete for. */
  const dest = r => r.blk.weeks[0].bottomUp.longDestKm + '/' +
                    r.blk.weeks[0].bottomUp.buildVolumeDestKm + '/' +
                    r.blk.weeks[0].bottomUp.entryKm;
  assert.equal(dest(low), dest(none),
    'the typed figure moved the block\'s entry or its destination');
  assert.equal(low.a.raceGoalReadiness('half', 'intermediate', low.blk).verdict,
               none.a.raceGoalReadiness('half', 'intermediate', none.blk).verdict,
    'the typed figure changed what the block prepares the athlete for');
  const wk1 = r => r.dd.filter(d => d.week === 1 && d.km > 0).reduce((t, d) => t + d.km, 0);
  assert.ok(Math.abs(wk1(low) - wk1(none)) < 1.6,
    'the typed figure moved the opening week: ' + wk1(low) + ' against ' + wk1(none));
});

test('ENTRY — no field and no evidence is not a shortfall', () => {
  /* The old gate compared the typed number to six kilometres a week. Handed
     nothing it would have refused everybody: no number is not a small number. */
  const res = R.build({ dist:'full', exp:'novice', days:5, weeks:15, tt5kMin:24 });
  const a = res.a;
  const none = a.raceGoalEntry(null);
  assert.equal(none.allowed, true, 'a missing field refused a Race Goal');
  assert.equal(none.entrySource, 'pathway');
  assert.equal(none.shortfallKm, 0);
});

test('ENTRY — evidence outranks the typed figure in both directions', () => {
  const strong = R.build({ dist:'full', exp:'novice', days:5, weeks:15,
                           easyKm:9, longKm:24, easyDays:[0,2,4], tt5kMin:22 });
  /* Real training of 51km a week, and a typed 2. The evidence is believed. */
  const e = strong.a.raceGoalEntry(2);
  assert.equal(e.entrySource, 'demonstrated');
  assert.equal(e.allowed, true, 'a typed 2 overrode a demonstrated 51km week');
  /* And with no history the typed figure still protects a genuine beginner. */
  const blank = R.build({ dist:'full', exp:'novice', days:5, weeks:15, tt5kMin:24 });
  const b = blank.a.raceGoalEntry(3);
  assert.equal(b.entrySource, 'stated');
  assert.equal(b.allowed, false, 'a typed 3km week entered a Race Goal');
});

test('ADMISSION — the projection is independent of the typed figure', () => {
  PATHWAYS.forEach(([d, e]) => {
    const res = R.build({ dist:d, exp:e, days:5, weeks:12, tt5kMin:24 });
    const seen = TYPED.map(v => {
      const o = res.a.raceGoalPreparationOutlook(d, e, 12,
                  { availableDays:5, easyPaceSecPerKm:res.pace });
      return o.verdict + '/' + o.reachLongKm + '/' + o.reachWeekKm;
    });
    assert.equal(new Set(seen).size, 1,
      d + '/' + e + ': the admission projection moved with the typed volume');
  });
});

test('CALIBRATION — a test the block could not place is declared, not dropped', () => {
  /* A fixed fifty-two minute effort inside a short-runway week is most of
     the athlete's training, and a week that thin still refuses it. What
     changes is that the refusal is now visible: the block says the zones it
     ran on were estimated rather than measured. (Ten weeks was the original
     example here; the safety floor now legitimately develops that runway
     past the point where the test can't fit, so a shorter runway is what
     still exercises the "could not place it" path. HQ DAY-COUNT/START-VOLUME
     CORRECTION -- moved from seven weeks to six for the same reason: New
     Half's own entry rose again, so the floor now develops past the fitting
     point at seven weeks too.) */
  const small = R.build({ dist:'half', exp:'novice', days:5, weeks:6, tt5kMin:24 });
  assert.equal(small.blk.calibrationRequested, true);
  assert.equal(small.blk.calibrationPlaced, false);
  assert.equal(small.blk.calibrationUnplaced, true,
    'the calibration vanished without the block saying so');
  const big = R.build({ dist:'full', exp:'advanced', days:5, weeks:15, tt5kMin:24 });
  assert.equal(big.blk.calibrationPlaced, true);
  assert.equal(big.blk.calibrationUnplaced, false);
});

test('OTHER PRODUCTS — the field still sizes the ramp architectures', () => {
  /* The removal is scoped to the Race Goal builder. Aerobic Base, Speed &
     Threshold and Maintain & Protect are ramps from a weekly figure and they
     must keep moving with it, or this change has reached further than HQ
     asked. */
  const res = R.build({ dist:'full', exp:'intermediate', days:5, weeks:12, tt5kMin:24 });
  const a = res.a;
  ['base', 'speed', 'maintain'].forEach(purpose => {
    const lo = a.buildBlockWeeks('full', 20, 8, { purpose:purpose, availableDays:5 });
    const hi = a.buildBlockWeeks('full', 60, 8, { purpose:purpose, availableDays:5 });
    const loKm = lo.weeks.map(w => w.volume).join(',');
    const hiKm = hi.weeks.map(w => w.volume).join(',');
    assert.notEqual(loKm, hiKm,
      purpose + ': the block no longer moves with the weekly volume it is built from');
  });
});
