'use strict';
/* HQ'S ADMISSION RULING — TEN WEEKS IS A CONTAINER, NOT AN ELIGIBILITY.
 * ===========================================================================
 * Valhalla permits a ten-week Race Goal. It does not promise that every
 * athlete can use one. Before a block is constructed, admission asks whether
 * this athlete can credibly establish the preparation the event requires
 * inside the runway they have -- and where the answer is no, it routes them
 * instead of building a programme it has already calculated will fall short.
 *
 * THE THREE THINGS THESE TESTS EXIST TO HOLD.
 *   1. The projection AGREES with the block. A pre-flight verdict that
 *      disagreed with the readiness verdict of the block it precedes would be
 *      worse than no projection at all.
 *   2. It is not an Experience-label test. Evidence outranks the label in BOTH
 *      directions -- a strong New athlete is admitted, a thin Experienced one
 *      is not -- because a rule that only ever refuses is a rule about the
 *      label after all.
 *   3. Absence of evidence falls back to the pathway, never to a low number
 *      invented for the occasion.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const R = require(path.join(__dirname, 'audit', 'raceGoalReachability.js'));

const ctx = c => ({ availableDays: c.days });

/* The pre-construction projection, asked of the same canonical athlete the
   reachability gate builds. */
function outlook(c){
  const res = R.build(Object.assign({ dist:c.dist, exp:c.exp, days:c.days, weeks:c.weeks }, c.ev));
  const o = res.a.raceGoalPreparationOutlook(c.dist, c.exp, c.weeks,
              { availableDays:c.days, easyPaceSecPerKm:res.pace });
  return { res, o };
}
/* What the block ACTUALLY established, read the way raceGoalReadiness reads
   it: before the taper, off the weeks themselves. */
function delivered(res){
  const wks = res.blk.weeks.filter(w => !w.isRace && !w.isTaper && !w.eventTaperApplied);
  let km = 0, lr = 0;
  wks.forEach(w => { if (w.volume > km) km = w.volume; if (w.longTarget > lr) lr = w.longTarget; });
  return { km, lr };
}

// ---------------------------------------------------------------------------
// 1. THE PROJECTION AND THE BLOCK AGREE
// ---------------------------------------------------------------------------
test('PROJECTION — the long run it projects is the long run the block builds', () => {
  [].concat(R.CANON, R.CANON_10).forEach(c => {
    const { res, o } = outlook(c);
    const d = delivered(res);
    assert.ok(Math.abs(o.reachLongKm - d.lr) < 0.05,
      c.key + ': projected long run ' + o.reachLongKm + 'km, block builds ' + d.lr + 'km');
  });
});

test('PROJECTION — it never promises a week the block does not deliver on a short runway', () => {
  /* Where capacity binds -- which is what a compressed runway means -- the
     projection is the block's own arithmetic and must match it. Where the
     DESTINATION binds instead, the block stops at a destination that already
     clears the requirement, so a projection above the delivered week cannot
     change a verdict; it may not fall BELOW it, which would refuse somebody
     the block would have prepared. */
  R.CANON_10.forEach(c => {
    const { res, o } = outlook(c);
    const d = delivered(res);
    assert.ok(o.reachWeekKm >= d.km - 0.6,
      c.key + ': projected ' + o.reachWeekKm + 'km/week but the block delivers ' + d.km);
  });
});

test('PROJECTION — the pre-flight verdict is the verdict the block earns', () => {
  [].concat(R.CANON, R.CANON_10).forEach(c => {
    const { res, o } = outlook(c);
    const rr = res.a.raceGoalReadiness(c.dist, c.exp, res.blk);
    assert.ok(rr, c.key + ': no readiness verdict');
    assert.equal(o.verdict, rr.verdict,
      c.key + ': projected ' + o.verdict + ' before building, block earned ' + rr.verdict);
  });
});

// ---------------------------------------------------------------------------
// 2. WHAT THE TEN-WEEK WINDOW ACTUALLY ADMITS
// ---------------------------------------------------------------------------
test('TEN WEEKS — every fifteen-week pathway is admitted, and admission says why', () => {
  R.CANON.forEach(c => {
    const res = R.build(Object.assign({ dist:c.dist, exp:c.exp, days:c.days, weeks:15 }, c.ev));
    const adm = res.a.raceGoalAdmission(c.dist, 15, null,
                  { availableDays:c.days, easyPaceSecPerKm:res.pace });
    assert.equal(adm.decision, 'race_goal', c.key + ' at 15w: ' + adm.decision);
    assert.equal(adm.preparation.verdict, 'READY',
      c.key + ' at 15w projected ' + adm.preparation.verdict);
  });
});

test('TEN WEEKS — the floor is now the driver, so this entry state is admitted and developed toward it', () => {
  /* HQ RACE GOAL TIGHT METHODOLOGY CORRECTION -- "the floor needs to be the
     main driver... current approved work is making the plans produce too
     low plans." The New marathon pathway's own locked 20km / 10km entry,
     read from this athlete's thin demonstrated evidence (entrySource stays
     'demonstrated' -- the ENTRY point is still honest about where they
     start); ten weeks is six development intervals and 10km to 26km is a
     2.6x jump, which is exactly why this case used to be refused outright.

     THE FLOOR RAISES THE DESTINATION, NOT THE SAFETY RATE. The week volume
     (20km -> 40km) closes inside the Nielsen two-week cap comfortably, so
     it reaches its floor exactly. The long run (10km -> 26km) does not --
     2.6x in six steps needs faster growth than
     sqrt(SESSION_TWO_WEEK_GROWTH_CAP) ever allows, and this architecture
     will not close that gap with a late jump or a catch-up week; that
     invariant is what raceGoalProgressionShape.test.js exists to hold. So
     the long run is genuinely, honestly short at the safety rate's own
     ceiling (10 x 1.14^6 =~ 22km) -- closer than the old ordinary-rate
     curve ever reached, but not force-snapped to the floor. That is a real
     shortfall, correctly named as one, and MARGINAL is the honest verdict
     for it rather than a promised READY the block cannot keep. */
  const c = R.CANON_10.filter(x => x.key.indexOf('New Marathon') === 0)[0];
  const res = R.build(Object.assign({ dist:c.dist, exp:c.exp, days:c.days, weeks:10 }, c.ev));
  const adm = res.a.raceGoalAdmission('full', 10, null,
                { availableDays:c.days, easyPaceSecPerKm:res.pace });
  assert.equal(adm.admitted, true, 'decision: ' + adm.decision);
  assert.equal(adm.decision, 'race_goal');
  assert.equal(adm.preparation.entrySource, 'demonstrated',
    'the entry point itself must still read the athlete\'s thin evidence honestly');
  assert.equal(adm.preparation.entryKm, 20);
  assert.equal(adm.preparation.entryLongKm, 10);
  assert.equal(adm.preparation.verdict, 'MARGINAL');
  assert.equal(adm.preparation.reachWeekKm, 40, 'the week floor, met exactly -- the gap closes inside the safety rate');
  assert.equal(adm.preparation.reachLongKm, 22,
    'the long run reaches the Nielsen safety rate\'s own ceiling from a 10km entry in six steps, honestly short of the 26km floor');
  assert.equal(adm.preparation.shortfall.length, 1);
  assert.equal(adm.preparation.shortfall[0], 'durability');
});

test('TEN WEEKS — a pathway that reaches the standard is admitted normally', () => {
  ['Experienced Marathon', 'Advanced Marathon', 'Advanced Half'].forEach(name => {
    const c = R.CANON_10.filter(x => x.key.indexOf(name) === 0)[0];
    const res = R.build(Object.assign({ dist:c.dist, exp:c.exp, days:c.days, weeks:10 }, c.ev));
    const adm = res.a.raceGoalAdmission(c.dist, 10, null,
                  { availableDays:c.days, easyPaceSecPerKm:res.pace });
    assert.equal(adm.admitted, true, name + ': ' + adm.decision);
    assert.equal(adm.preparation.verdict, 'READY');
  });
});

test('TEN WEEKS — a shortfall within reach is admitted and now closed, not merely declared', () => {
  /* HQ RACE GOAL TIGHT METHODOLOGY CORRECTION -- these two used to be
     admitted MARGINAL, with the gap between the destination-led curve and
     the pathway floor named as a shortfall rather than closed, because the
     old architecture reported what was safely reachable rather than
     guaranteeing the floor. The floor is now the driver: both are admitted
     and both now reach their pathway's own floor exactly, so there is
     nothing left to declare short. What this test still holds is that
     neither is REFUSED for being merely hard -- that boundary still exists,
     just with no MARGINAL programme sitting inside it any more. */
  ['New Half', 'Experienced Half'].forEach(name => {
    const c = R.CANON_10.filter(x => x.key.indexOf(name) === 0)[0];
    const res = R.build(Object.assign({ dist:c.dist, exp:c.exp, days:c.days, weeks:10 }, c.ev));
    const adm = res.a.raceGoalAdmission('half', 10, null,
                  { availableDays:c.days, easyPaceSecPerKm:res.pace });
    assert.equal(adm.admitted, true, name + ': ' + adm.decision);
    assert.equal(adm.preparation.verdict, 'READY');
    assert.equal(adm.preparation.shortfall.length, 0,
      name + ': admitted READY but still named a shortfall');
    /* reachWeekKm is floored at the pathway's PEAK figure (what the block
       is actually built to), which for a half is stated separately from
       and above requiredWeekKm (the Build figure the dims/verdict are
       measured against) -- so this is >=, not ==. */
    assert.ok(adm.preparation.reachWeekKm >= adm.preparation.requiredWeekKm,
      name + ': the floor, met exactly rather than approached');
    /* Same Peak-vs-Build distinction as the week figure above. */
    assert.ok(adm.preparation.reachLongKm >= adm.preparation.requiredLongKm,
      name + ': the floor, met exactly rather than approached');
  });
});

// ---------------------------------------------------------------------------
// 3. IT IS EVIDENCE, NOT THE EXPERIENCE LABEL
// ---------------------------------------------------------------------------
test('EVIDENCE OVER LABEL — a strong New athlete is admitted to a ten-week marathon', () => {
  /* Nominally New. Their logged training is not: 55km weeks and a 26km long
     run, sustained. The label chooses the pathway; the evidence says what they
     can do, and refusing them because of the word would be exactly the
     hard-coded NEW_10_WEEK = REFUSE that HQ ruled out. */
  const res = R.build({ dist:'full', exp:'novice', days:5, weeks:10,
                        easyKm:9, longKm:26, qKm:10, easyDays:[0,2,4], tt5kMin:22 });
  const adm = res.a.raceGoalAdmission('full', 10, null,
                { availableDays:5, easyPaceSecPerKm:res.pace });
  assert.equal(adm.admitted, true,
    'a New athlete with real evidence was refused on the label: ' + adm.decision);
  assert.equal(adm.preparation.entrySource, 'demonstrated');
  assert.ok(adm.preparation.entryKm > 40,
    'the projection ignored the evidence: entry read as ' + adm.preparation.entryKm);
});

test('EVIDENCE OVER LABEL — a thin Experienced athlete is admitted and developed to the floor', () => {
  /* HQ RACE GOAL TIGHT METHODOLOGY CORRECTION -- "the floor needs to be the
     main driver." Nominally Experienced; their recent training is 22km a
     week and a 14km long run -- well below the pathway's own 40km/18km
     assumed entry, so this is still a thin-evidence case, not a strong one.
     The ENTRY point still believes the evidence over the label --
     entrySource stays 'demonstrated' and entryKm stays the athlete's own
     thin figure. The DESTINATION is the pathway's floor regardless of how
     far below it the entry sits, and here the gap (14km -> 29km over six
     intervals) closes inside the Nielsen safety rate, so the block reaches
     it exactly rather than the athlete being routed away from Race Goal
     for arriving honest. (A still-thinner entry, e.g. an 8km long run, is
     a materially different case -- the safety rate genuinely cannot close
     that gap in six steps without a late jump, and is refused rather than
     oversold; see the marathon reachability tests for that boundary.) */
  const res = R.build({ dist:'full', exp:'intermediate', days:4, weeks:10,
                        easyKm:4, longKm:14, easyDays:[0,2], tt5kMin:26 });
  const adm = res.a.raceGoalAdmission('full', 10, null,
                { availableDays:4, easyPaceSecPerKm:res.pace });
  assert.equal(adm.admitted, true, 'decision: ' + adm.decision);
  assert.equal(adm.decision, 'race_goal');
  assert.equal(adm.preparation.entrySource, 'demonstrated');
  assert.ok(adm.preparation.entryKm < 30,
    'the pathway assumption overrode the evidence: entry read as ' + adm.preparation.entryKm);
  assert.equal(adm.preparation.verdict, 'READY');
  assert.equal(adm.preparation.reachWeekKm, 55, 'the Experienced marathon floor');
  assert.equal(adm.preparation.reachLongKm, 29, 'the Experienced marathon floor');
});

test('NO EVIDENCE — the pathway supplies the entry, and nothing invents a low one', () => {
  /* Somebody who has logged nothing is not a six-kilometre-a-week beginner.
     They are somebody who chose this pathway, and absent anything
     contradicting it the pathway's own designed entry stands. */
  const res = R.build({ dist:'full', exp:'intermediate', days:4, weeks:10, tt5kMin:24 });
  const o = res.a.raceGoalPreparationOutlook('full', 'intermediate', 10,
              { availableDays:4, easyPaceSecPerKm:res.pace });
  assert.equal(o.entrySource, 'pathway');
  assert.equal(o.entryKm, 40, 'the Experienced marathon pathway opens at 40km');
  assert.equal(o.verdict, 'READY');
});

// ---------------------------------------------------------------------------
// 4. CONTINUITY — NO CLIFF FROM A TYPED NUMBER
// ---------------------------------------------------------------------------
test('CONTINUITY — the projection moves smoothly with the evidence, with no typed-volume cliff', () => {
  /* The verdict boundary is a decision and it is allowed to be a step. What
     may not happen is the PROJECTION jumping: one extra kilometre a week of
     logged training must not move the reachable long run by a stride. */
  let prev = null;
  for (let easy = 4; easy <= 9; easy += 0.5){
    const res = R.build({ dist:'full', exp:'novice', days:5, weeks:12,
                          easyKm:easy, longKm:easy * 2, easyDays:[0,2,4], tt5kMin:24 });
    const o = res.a.raceGoalPreparationOutlook('full', 'novice', 12,
                { availableDays:5, easyPaceSecPerKm:res.pace });
    if (prev){
      const jump = Math.abs(o.reachLongKm - prev.lr);
      assert.ok(jump <= 3.5,
        'a 0.5km/day change moved the reachable long run by ' + jump.toFixed(1) +
        'km (' + prev.lr + ' -> ' + o.reachLongKm + ')');
    }
    prev = { lr:o.reachLongKm };
  }
});

test('CONTINUITY — the typed weekly volume changes no admission decision', () => {
  /* HQ is removing Current Weekly Volume from the Race Goal builder. Admission
     must already be independent of it: the same athlete, the same evidence,
     four different typed numbers, one answer. */
  const seen = {};
  [null, 5, 30, 90].forEach(v => {
    const res = R.build({ dist:'half', exp:'novice', days:5, weeks:12, stated:v,
                          easyKm:3.5, longKm:8, easyDays:[0,2], tt5kMin:28 });
    const adm = res.a.raceGoalAdmission('half', 12, v,
                  { availableDays:5, easyPaceSecPerKm:res.pace });
    seen[String(v)] = adm.decision + '/' + adm.preparation.verdict + '/' +
                      adm.preparation.reachLongKm;
  });
  const vals = Object.keys(seen).map(k => seen[k]);
  assert.equal(new Set(vals).size, 1,
    'the typed volume changed the admission answer: ' + JSON.stringify(seen));
});

test('NO PRICE, NO REFUSAL — a missing pace cannot manufacture an unreachable verdict', () => {
  /* HQ RACE GOAL TIGHT METHODOLOGY CORRECTION -- the solve still prices
     sessions in time, and asked without an easy pace it still has no cost
     bound and no cost-driven frequency; what changed is that the reach
     figure this used to depress is now floored at the pathway's own
     destination regardless of pricing, so an unpriced projection can no
     longer read BELOW what the same block actually builds -- it reads
     exactly the floor, the same as a priced one. `confident` still
     distinguishes the two honestly (a caller can still tell whether a real
     price was used), and it is still true that admission will not refuse on
     an unpriced projection, because there is nothing for a missing price to
     depress any more. */
  const res = R.build({ dist:'half', exp:'novice', days:5, weeks:10,
                        easyKm:3.5, longKm:8, easyDays:[0,2], tt5kMin:28 });
  const blind = res.a.raceGoalPreparationOutlook('half', 'novice', 10, null);
  assert.equal(blind.confident, false, 'a priceless projection claimed confidence');
  const priced = res.a.raceGoalPreparationOutlook('half', 'novice', 10,
                   { availableDays:5, easyPaceSecPerKm:res.pace });
  assert.equal(priced.confident, true);
  assert.equal(blind.reachLongKm, priced.reachLongKm,
    'both are floored at the same pathway destination regardless of pricing');
  assert.equal(blind.verdict, 'READY');
  assert.equal(res.a.raceGoalAdmission('half', 10, null, null).admitted, true);
});

// ---------------------------------------------------------------------------
// 5. THE CALIBRATION MAY NOT INFLATE A LOCKED OPENING WEEK
// ---------------------------------------------------------------------------
test('CALIBRATION — no pathway opens more than a rounding above its locked entry', () => {
  /* The protocol is a FIXED fifty-two minutes, the same session for everybody,
     because a test that scaled with the athlete would measure something
     different for each of them. Where the opening week was too small to hold
     it, the week simply came out bigger by the difference: HQ's locked 20km
     New marathon entry delivered as a 22.5km week, thirteen per cent above the
     pathway's own start, against two per cent for the other five.

     HQ RACE GOAL TIGHT METHODOLOGY CORRECTION -- a SECOND, larger and
     deliberate source of the same class of inflation now exists alongside
     the calibration protocol's own, smaller one, and it is not a defect:
     "selected training days are training days" means Half's own opening
     week must use all of the athlete's selected days from week one rather
     than growing into them, and the week-one workload at New/Experienced
     Half's locked entry (15km/30km, 3-4 selected days including a quality
     slot the pathway table has not yet unlocked) cannot fill that many days
     without distributeWeekVolume()'s own EASY_MIN_KM floor-excess rule
     inflating the week to reach them -- exactly the trade-off HQ named
     explicitly and chose the other side of ("do not let the solver reduce
     the number of training days merely because it can fit the required
     mileage into fewer sessions"). Measured: New Half and Experienced Half
     open at +13.3%/+11.7% against a 2-3% baseline everywhere the day-count
     contract has enough workload to fill its days without inflating (both
     Advanced Half pathways, all three Marathon pathways). The ceiling below
     is raised to hold that measured, accepted figure -- not loosened
     generically -- so a THIRD source of inflation would still be caught. */
  [].concat(R.CANON, R.CANON_10).forEach(c => {
    const res = R.build(Object.assign({ dist:c.dist, exp:c.exp, days:c.days, weeks:c.weeks }, c.ev));
    const path = res.a.raceGoalPathway(c.dist, c.exp);
    const wk1 = res.dd.filter(d => d.week === 1 && d.km > 0).reduce((t, d) => t + d.km, 0);
    const over = (wk1 / path.entryVolumeKm) - 1;
    assert.ok(over <= 0.14,
      c.key + ': opens at ' + wk1.toFixed(1) + 'km against a locked entry of ' +
      path.entryVolumeKm + ' (+' + (over * 100).toFixed(0) + '%)');
  });
});

test('CALIBRATION — at most once, and a withheld one says why', () => {
  /* Deferral is not discard, and it is not a ceremony either. A calibration is
     taken where it can inform the training that follows it; where the first
     week that could safely hold the protocol is the LAST development week,
     nothing it measures can improve any week of training, and the test is
     withheld with a declared reason rather than paid for anyway. */
  [].concat(R.CANON, R.CANON_10).forEach(c => {
    const res = R.build(Object.assign({ dist:c.dist, exp:c.exp, days:c.days, weeks:c.weeks }, c.ev));
    const cals = res.dd.filter(d => d.type === 'calibration');
    assert.ok(cals.length <= 1, c.key + ': ' + cals.length + ' calibrations in the block');
    if (cals.length){
      assert.ok(cals[0].week < c.weeks, c.key + ': calibrated in the race week');
      assert.equal(res.blk.calibrationPlaced, true);
      assert.equal(res.blk.calibrationWithheldReason, null);
    } else {
      assert.equal(res.blk.calibrationUnplaced, true,
        c.key + ': the calibration vanished without the block saying so');
      assert.ok(['too_late_to_inform', 'no_safe_placement']
                  .indexOf(res.blk.calibrationWithheldReason) !== -1,
        c.key + ': withheld with reason ' + res.blk.calibrationWithheldReason);
    }
  });
});

test('CALIBRATION — a placement is followed by development it can actually inform', () => {
  /* The rule, stated as the thing it is: a calibration writes a measured
     threshold pace and heart rate, both read at render time, so what it
     improves is the pace every SUBSEQUENT session is run at. A placement with
     no development week after it improves no training at all. */
  [].concat(R.CANON, R.CANON_10).forEach(c => {
    const res = R.build(Object.assign({ dist:c.dist, exp:c.exp, days:c.days, weeks:c.weeks }, c.ev));
    const cal = res.dd.filter(d => d.type === 'calibration')[0];
    if (!cal) return;
    const after = res.blk.weeks.filter(w => w.week > cal.week && !w.isRace && !w.isTaper);
    assert.ok(after.length >= 1,
      c.key + ': calibrated in week ' + cal.week + ' with no development week after it');
  });
});

test('CALIBRATION — the rule is general, not a case carved out for one pathway', () => {
  /* Asserted by walking every pathway across every admitted runway. The rule
     is "at least one development week follows", and it either holds for all of
     them or it is a special case wearing a rule's clothes. */
  const PATHS = [['half','novice'], ['half','experienced'], ['half','advanced'],
                 ['full','novice'], ['full','experienced'], ['full','advanced']];
  let placed = 0, withheld = 0;
  PATHS.forEach(([d, e]) => {
    const c = R.CANON.filter(x => x.dist === d && x.exp === e)[0];
    for (let W = 10; W <= 15; W++){
      const res = R.build(Object.assign({ dist:d, exp:e, days:c.days, weeks:W }, c.ev));
      const cal = res.dd.filter(x => x.type === 'calibration')[0];
      if (cal){
        placed++;
        const after = res.blk.weeks.filter(w => w.week > cal.week && !w.isRace && !w.isTaper);
        assert.ok(after.length >= 1,
          d + '/' + e + ' @' + W + 'w: calibrated in the last development week');
      } else {
        withheld++;
        assert.ok(res.blk.calibrationWithheldReason,
          d + '/' + e + ' @' + W + 'w: withheld with no reason');
      }
    }
  });
  assert.ok(placed >= 30, 'only ' + placed + ' of 36 cases calibrated at all');
  assert.ok(withheld >= 1, 'no case exercised the withholding rule');
});

test('CALIBRATION — the protocol is never shrunk to fit the week it lands in', () => {
  /* The alternative to deferring is a smaller test, and a smaller test is a
     different measurement. The session is the same distance wherever it goes. */
  [].concat(R.CANON, R.CANON_10).forEach(c => {
    const res = R.build(Object.assign({ dist:c.dist, exp:c.exp, days:c.days, weeks:c.weeks }, c.ev));
    const cal = res.dd.filter(d => d.type === 'calibration')[0];
    if (!cal) return;                       // withheld -- see the rule above
    assert.ok(cal.km >= res.a.calibrationSessionKm() - 1e-9,
      c.key + ': the calibration was written at ' + cal.km + 'km against a protocol of ' +
      res.a.calibrationSessionKm());
    assert.equal(cal.prescription.archetype, 'threshold_calibration',
      c.key + ': the calibration is not the calibration protocol');
  });
});

test('CALIBRATION — a test week does not teach the taper a family the athlete never ran', () => {
  /* A calibration takes the week's quality slot, so the structure the pools
     chose for that week is selected and then not delivered. Seeding the
     taper's family hold from it hands the wind-down week a session the block
     never once prescribed. */
  [].concat(R.CANON, R.CANON_10).forEach(c => {
    const res = R.build(Object.assign({ dist:c.dist, exp:c.exp, days:c.days, weeks:c.weeks }, c.ev));
    const arche = d => (d.prescription && d.prescription.archetype) || null;
    const isQ = d => d.km > 0 && d.type !== 'easy' && d.type !== 'long' && d.type !== 'race';
    const taperWk = res.blk.weeks.filter(w => w.isTaper && !w.isRace).map(w => w.week);
    const seen = {};
    res.dd.forEach(d => {
      if (!isQ(d) || taperWk.indexOf(d.week) !== -1) return;
      if (arche(d)) seen[arche(d)] = true;
    });
    res.dd.forEach(d => {
      if (!isQ(d) || taperWk.indexOf(d.week) === -1) return;
      if (!arche(d)) return;
      assert.ok(seen[arche(d)],
        c.key + ' week ' + d.week + ': the taper introduced ' + arche(d) +
        ', which the block never prescribed');
    });
  });
});
