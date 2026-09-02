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

test('TEN WEEKS — a structurally unreachable entry state is refused, not built', () => {
  /* The New marathon pathway from its own locked 20km / 10km entry. Ten weeks
     is six development intervals; 10km to 26km is 2.6x and needs ten. The
     arithmetic does not close and the athlete is routed to the block that
     builds what is missing. */
  const c = R.CANON_10.filter(x => x.key.indexOf('New Marathon') === 0)[0];
  const res = R.build(Object.assign({ dist:c.dist, exp:c.exp, days:c.days, weeks:10 }, c.ev));
  const adm = res.a.raceGoalAdmission('full', 10, null,
                { availableDays:c.days, easyPaceSecPerKm:res.pace });
  assert.equal(adm.admitted, false);
  assert.equal(adm.decision, 'preparation_not_reachable');
  assert.equal(adm.limitedBy, 'durability');
  assert.equal(adm.recommend, 'base',
    'a durability shortfall is aerobic development, not speed work');
  assert.equal(adm.preparation.verdict, 'INSUFFICIENT');
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

test('TEN WEEKS — a shortfall within reach is admitted and declared, not refused', () => {
  /* MARGINAL is a real programme. The athlete arrives having done most of what
     the event asks and Valhalla names the part that is missing. Refusing it
     would be refusing the merely hard rather than the structurally
     impossible. */
  ['New Half', 'Experienced Half'].forEach(name => {
    const c = R.CANON_10.filter(x => x.key.indexOf(name) === 0)[0];
    const res = R.build(Object.assign({ dist:c.dist, exp:c.exp, days:c.days, weeks:10 }, c.ev));
    const adm = res.a.raceGoalAdmission('half', 10, null,
                  { availableDays:c.days, easyPaceSecPerKm:res.pace });
    assert.equal(adm.admitted, true, name + ': ' + adm.decision);
    assert.equal(adm.preparation.verdict, 'MARGINAL');
    assert.ok(adm.preparation.shortfall.length > 0,
      name + ': admitted MARGINAL but named nothing as short');
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

test('EVIDENCE OVER LABEL — a thin Experienced athlete is refused a ten-week marathon', () => {
  /* Nominally Experienced. Their recent training is 18km a week and an 8km
     long run. The pathway would have opened them at 40km; the evidence says
     otherwise, and it is the evidence that is believed. */
  const res = R.build({ dist:'full', exp:'intermediate', days:4, weeks:10,
                        easyKm:4, longKm:8, easyDays:[0,2], tt5kMin:26 });
  const adm = res.a.raceGoalAdmission('full', 10, null,
                { availableDays:4, easyPaceSecPerKm:res.pace });
  assert.equal(adm.admitted, false,
    'an Experienced label carried an athlete their evidence cannot carry');
  assert.equal(adm.decision, 'preparation_not_reachable');
  assert.equal(adm.preparation.entrySource, 'demonstrated');
  assert.ok(adm.preparation.entryKm < 30,
    'the pathway assumption overrode the evidence: entry read as ' + adm.preparation.entryKm);
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
  /* The solve prices sessions in time. Asked without an easy pace it has no
     cost bound and no cost-driven frequency, and it comes out BELOW what the
     same block actually builds -- measured, an 8km long run projected against
     the 9.9km delivered. Absence of information is not evidence of incapacity,
     so a projection made in that state is marked unconfident and admission
     will not refuse on it. */
  const res = R.build({ dist:'half', exp:'novice', days:5, weeks:10,
                        easyKm:3.5, longKm:8, easyDays:[0,2], tt5kMin:28 });
  const blind = res.a.raceGoalPreparationOutlook('half', 'novice', 10, null);
  assert.equal(blind.confident, false, 'a priceless projection claimed confidence');
  const priced = res.a.raceGoalPreparationOutlook('half', 'novice', 10,
                   { availableDays:5, easyPaceSecPerKm:res.pace });
  assert.equal(priced.confident, true);
  assert.ok(blind.reachLongKm < priced.reachLongKm,
    'the unpriced projection was not the pessimistic one this guard exists for');
  /* And the guard is load-bearing: the blind projection is INSUFFICIENT, and
     admission still admits. */
  assert.equal(blind.verdict, 'INSUFFICIENT');
  assert.equal(res.a.raceGoalAdmission('half', 10, null, null).admitted, true);
});
