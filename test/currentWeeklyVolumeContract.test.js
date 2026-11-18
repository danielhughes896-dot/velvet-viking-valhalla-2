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

/* ---- SUPERSEDED 14 NOVEMBER 2026: THE ATHLETE SETS THE STARTING POINT ----
   This file answered "can the typed weekly volume leave the Race Goal
   builder?" by proving no Race Goal read it. The founder has since ruled the
   opposite: "The athlete's declared current sustainable weekly running volume
   is the starting-volume authority. If the athlete says they currently run
   35 km/week, SACORO should build Week 1 around 35 km ... Historical logs and
   incomplete Strava data must not silently override declared capacity." The
   coaching audit measured what the old contract cost: an Established 50km
   athlete opened a 5K block at 25km, and Regenerate gave 46km from the same
   answers. These laws now hold the new contract; the experience pathway is
   still the destination and is asserted unchanged below. */
const wk1 = r => r.dd.filter(d => d.week === 1 && d.km > 0).reduce((t, d) => t + d.km, 0);
const dest = r => r.blk.weeks[0].bottomUp.longDestKm + '/' + r.blk.weeks[0].bottomUp.buildVolumeDestKm;

test('RACE GOAL — the declared week sets week one, and logged evidence does not override it', () => {
  [].concat(R.CANON, R.CANON_10).forEach(c => {
    const lo = R.build(Object.assign({ dist:c.dist, exp:c.exp, days:c.days, weeks:c.weeks, stated:30 }, c.ev));
    const hi = R.build(Object.assign({ dist:c.dist, exp:c.exp, days:c.days, weeks:c.weeks, stated:60 }, c.ev));
    assert.equal(lo.blk.weeks[0].bottomUp.entrySource, 'stated', c.key + ': logged evidence overrode the declaration');
    assert.equal(lo.blk.weeks[0].bottomUp.entryKm, 30, c.key + ': week one did not open from the declaration');
    /* EXCEPT WHERE THE LONG-RUN STEP HOLDS WEEK ONE (founder, 15 November
       2026: a long run at most 10% (Half/Marathon 15%) over the longest of
       the last 30 days). An athlete who has LOGGED a 10km longest run and
       declares 60km a week used to open on a 26km long run; their long run is
       now held to the step, and the week with it. */
    const held = hi.dd.some(d => d.week === 1 && d.type === 'long' && d.stepWantKm > d.km);
    if (!held) assert.ok(wk1(hi) > wk1(lo), c.key + ': 60km declared opened no bigger than 30km');
  });
});

test('RACE GOAL — with no declaration, evidence and then the pathway answer, as before', () => {
  PATHWAYS.forEach(([d, e]) => {
    const none = R.build({ dist:d, exp:e, days:5, weeks:15, tt5kMin:24 });
    assert.equal(none.blk.weeks[0].bottomUp.entrySource, 'pathway', d + '/' + e);
  });
});

test('RACE GOAL — the declaration moves the start, never the destination', () => {
  PATHWAYS.forEach(([d, e]) => {
    const a30 = R.build({ dist:d, exp:e, days:5, weeks:15, stated:30, tt5kMin:24 });
    const a20 = R.build({ dist:d, exp:e, days:5, weeks:15, stated:20, tt5kMin:24 });
    assert.equal(dest(a30), dest(a20), d + '/' + e + ': a smaller declaration lowered the destination');
  });
});

test('RACE GOAL — a declaration below the safety floor still defers the field test, and the pathway question is asked', () => {
  /* Unchanged in purpose: an athlete who says they run five kilometres a
     week is not given a maximal field test in week one. And since the
     declaration now sets the start, SACORO also says when the chosen pathway
     is out of reach from there (pathwayRecommendation()). */
  const low  = R.build({ dist:'half', exp:'advanced', days:6, weeks:15, stated:5, tt5kMin:18 });
  const none = R.build({ dist:'half', exp:'advanced', days:6, weeks:15, tt5kMin:18 });
  assert.equal(low.elig.reason, 'insufficient_base');
  assert.equal(none.elig.reason, 'eligible');
  const rec = low.a.pathwayRecommendation('half', 'advanced', 5, 15);
  assert.equal(rec.chosen.feasible, false, 'an Advanced half from 5km a week was judged reachable');
  assert.ok(rec.recommend || rec.recommendBase, 'neither a lower pathway nor a base block was recommended');
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

test('ENTRY — the declaration answers first; evidence answers when nothing is declared', () => {
  const strong = R.build({ dist:'full', exp:'novice', days:5, weeks:15,
                           easyKm:9, longKm:24, easyDays:[0,2,4], tt5kMin:22 });
  /* Real training of about 51km a week. With nothing declared, it is believed. */
  const e = strong.a.raceGoalEntry(null);
  assert.equal(e.entrySource, 'demonstrated');
  assert.equal(e.allowed, true);
  /* A declaration is the athlete's own account of now, and is believed too. */
  const d = strong.a.raceGoalEntry(40);
  assert.equal(d.entrySource, 'stated');
  assert.equal(d.haveKm, 40);
  /* And with no history the declaration still protects a genuine beginner. */
  const blank = R.build({ dist:'full', exp:'novice', days:5, weeks:15, tt5kMin:24 });
  const b = blank.a.raceGoalEntry(3);
  assert.equal(b.entrySource, 'stated');
  assert.equal(b.allowed, false, 'a declared 3km week entered a Race Goal');
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
