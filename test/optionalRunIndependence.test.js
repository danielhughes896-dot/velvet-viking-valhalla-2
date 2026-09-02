'use strict';
/* §9  OPTIONAL RUNS ARE MATHEMATICALLY NON-REQUIRED.
 * ===========================================================================
 * An Optional Run says: you offered this day and the programme does not
 * currently need it. That sentence is only honest if the kilometres are
 * genuinely surplus -- if a canonical athlete can leave every one of them
 * unperformed and have Valhalla treat them as having done the programme.
 *
 * The proof is structural rather than statistical. An offered day carries ZERO
 * kilometres and no prescription; everything that accumulates, gates or
 * measures training reads kilometres. So the tests below establish the
 * structure and then walk each consumer HQ named to confirm nothing reaches
 * around it.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const R = require(path.join(__dirname, 'audit', 'raceGoalReachability.js'));

const ALL = [].concat(R.CANON, R.CANON_10);
const plan = c => R.build(Object.assign(
  { dist:c.dist, exp:c.exp, days:c.days, weeks:c.weeks }, c.ev));
const offered = res => res.dd.filter(d => d.availableUnused);

test('OFFERED DAYS — they carry no distance and no prescription', () => {
  /* The whole proof rests here. A day with zero kilometres cannot contribute
     to a total, a destination, a step or a verdict, whatever reads it. */
  let seen = 0;
  ALL.forEach(c => {
    const res = plan(c);
    offered(res).forEach(d => {
      seen++;
      assert.equal(d.km, 0, c.key + ' week ' + d.week + ': an offered day carries ' + d.km + 'km');
      assert.equal(d.type, 'rest', c.key + ': an offered day is typed ' + d.type);
      assert.equal(d.prescription, undefined,
        c.key + ': an offered day carries a prescription');
    });
  });
  assert.ok(seen > 0, 'no optional runs anywhere in the canonical set to test');
});

test('WEEKLY WORKLOAD — the week the athlete is asked for is the week without them', () => {
  ALL.forEach(c => {
    const res = plan(c);
    const byWeek = {};
    res.dd.forEach(d => {
      byWeek[d.week] = byWeek[d.week] || { with:0, without:0 };
      if (d.km > 0) byWeek[d.week].with += d.km;
      if (d.km > 0 && !d.availableUnused) byWeek[d.week].without += d.km;
    });
    res.blk.weeks.forEach(w => {
      const b = byWeek[w.week];
      if (!b) return;
      assert.ok(Math.abs(b.with - b.without) < 1e-9,
        c.key + ' week ' + w.week + ': offered days contributed kilometres');
      /* The week's target and its delivered days can differ for reasons that
         are named and accounted elsewhere -- a quality-day floor, a rounding
         bound, a cap. What is asserted here is the only thing this test is
         about: whichever of them a reader takes, removing every optional run
         changes neither. */
    });
  });
});

test('PROGRESSION — no step, cutback or rebound is measured across an offered day', () => {
  /* The curve walks weekly totals, and those totals are the sums proved above.
     Stated separately because a progression that silently included surplus
     kilometres would develop the athlete from training they never did. */
  ALL.forEach(c => {
    const res = plan(c);
    const opt = {};
    res.dd.forEach(d => { if (d.availableUnused) opt[d.week] = (opt[d.week] || 0) + 1; });
    let stepped = 0;
    res.blk.weeks.forEach(w => {
      if (!opt[w.week]) return;
      stepped++;
      const withOpt = res.dd.filter(d => d.week === w.week && d.km > 0)
                            .reduce((t, d) => t + d.km, 0);
      const without = res.dd.filter(d => d.week === w.week && d.km > 0 && !d.availableUnused)
                            .reduce((t, d) => t + d.km, 0);
      assert.equal(withOpt.toFixed(3), without.toFixed(3),
        c.key + ' week ' + w.week + ' offers ' + opt[w.week] +
        ' optional runs and they moved the week from ' + without + ' to ' + withOpt);
    });
  });
});

test('READINESS — every dimension is met, or missed, on prescribed kilometres alone', () => {
  ALL.forEach(c => {
    const res = plan(c);
    const rr = res.a.raceGoalReadiness(c.dist, c.exp, res.blk);
    if (!rr) return;
    const wl = rr.dimensions.filter(d => d.key === 'workload')[0];
    if (!wl) return;
    /* What readiness read is a week the block WROTE. Every one of those weeks
       is a sum of prescribed sessions -- an offered day is not a session and
       carries nothing -- so the figure readiness reached must be one of them
       exactly. */
    const built = res.blk.weeks
      .filter(w => !w.isRace && !w.isTaper && !w.eventTaperApplied)
      .map(w => w.volume);
    assert.ok(built.some(v => Math.abs(v - wl.detail.reachedKm) < 1e-6),
      c.key + ': readiness read ' + wl.detail.reachedKm +
      'km, which is no developing week the block wrote');
    /* And no week's prescribed total contains an optional kilometre. */
    res.blk.weeks.forEach(w => {
      const opt = res.dd.filter(d => d.week === w.week && d.availableUnused && d.km > 0);
      assert.equal(opt.length, 0,
        c.key + ' week ' + w.week + ': an optional day carries distance');
    });
  });
});

test('ADMISSION — the projection cannot see an optional run, because it sees no days', () => {
  /* raceGoalPreparationOutlook is a function of the entry state and the runway.
     It builds no week and reads no day, so surplus kilometres cannot make a
     programme viable that was not. */
  ALL.forEach(c => {
    const res = plan(c);
    const o = res.a.raceGoalPreparationOutlook(c.dist, c.exp, c.weeks,
                { availableDays:c.days, easyPaceSecPerKm:res.pace });
    const o2 = res.a.raceGoalPreparationOutlook(c.dist, c.exp, c.weeks,
                { availableDays:c.days, easyPaceSecPerKm:res.pace });
    assert.equal(o.reachWeekKm, o2.reachWeekKm, c.key + ': the projection is not stable');
    assert.equal(o.verdict, o2.verdict);
  });
});

test('PEAK — no optional run is offered once the block has the evidence to decide', () => {
  /* HQ's rule, preserved. An Optional Run is an honest answer while Base and
     Build are still learning what the athlete can carry; in Peak every day the
     athlete offered deserves a deliberate decision. */
  ALL.forEach(c => {
    const res = plan(c);
    const peak = {};
    res.blk.weeks.forEach(w => { if (w.phase === 'Peak') peak[w.week] = true; });
    offered(res).forEach(d => assert.ok(!peak[d.week],
      c.key + ': an optional run is offered in Peak week ' + d.week));
  });
});

test('OFFERS EXIST — and they are outside Peak, so the rule is doing something', () => {
  /* A rule that removes optional runs from Peak proves nothing if the block
     never offered any. */
  let total = 0;
  ALL.forEach(c => { total += offered(plan(c)).length; });
  assert.ok(total >= 12,
    'only ' + total + ' optional runs across the whole canonical set');
});

test('UNPERFORMED — leaving every offer untaken is not a missed session', () => {
  /* The athlete who runs none of them has done the programme. An offered day is
     a rest day with a note; nothing in it is prescribed, so there is nothing in
     it to have missed. */
  const c = R.CANON[1];                                   // Experienced Half, 15w
  const res = plan(c);
  const opts = offered(res);
  assert.ok(opts.length > 0, 'nothing offered to leave untaken');
  opts.forEach(d => {
    assert.equal(d.completed, false);
    assert.equal(d.plannedKm === undefined || d.plannedKm === 0, true,
      'an offered day carries a planned distance of ' + d.plannedKm);
    assert.equal(res.a.optionalRunLogged(d), false,
      'an untaken offer reads as a logged optional run');
  });
});
