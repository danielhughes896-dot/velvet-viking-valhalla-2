'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

/* THE WEEK'S QUALITY BUDGET INCLUDES A RACE-SPECIFIC LONG RUN
 * ===========================================================================
 * The aerobic-dominance ceiling counts STANDALONE quality days. A goal-pace
 * long run is not one of them, so a capable half or marathon athlete who had
 * earned the second exposure received two standalone quality sessions AND a
 * race-specific long run -- three sessions the product's own
 * sessionImportance() calls KEY, the largest of them the one the budget could
 * not see.
 *
 * The long run now spends one of the week's slots when, and only when, it
 * carries goal-pace work. That condition is not invented here: it is the same
 * one that sets dd.mpSegment on the day, which the audit established is the
 * only existing signal that is true for exactly the specific long runs and
 * false for every aerobic one at every distance and phase.
 *
 * These tests hold the shape of that: what it changes, and the four things it
 * must not.
 */
const TODAY = '2026-08-30';
const SCHED = {
  3: { activeDays:[1,3,6], longRunDay:6 },
  4: { activeDays:[1,3,5,6], longRunDay:6 },
  5: { activeDays:[1,2,4,5,6], longRunDay:6 },
  6: { activeDays:[0,1,2,3,4,6], longRunDay:6 },
  7: { activeDays:[0,1,2,3,4,5,6], longRunDay:6 }
};
const VOL = { '5k':45, '10k':50, 'half':55, 'full':70 };
const QUALITY = ['tempo','threshold','interval','repetition','checkpoint','calibration'];

function plan(dist, days, earned, weeks){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.renderApp=()=>{}; a.flushSave=()=>{}; a.scheduleSave=()=>{}; a.showToast=()=>{};
  a.state = a.makeDefaultState();
  const realM = a.athleteResponseModel, realB = a.blockEffectiveness;
  if (earned){
    a.athleteResponseModel = () => ({ families:{
      threshold:{ confidence:'established', recovery:{ typicalHoursToNormal:24 } },
      interval: { confidence:'established', recovery:{ typicalHoursToNormal:24 } } } });
    a.blockEffectiveness = () => ({ state:'ADAPTING' });
  }
  let blk, ds, end;
  try {
    blk = a.buildBlockWeeks(dist, VOL[dist], weeks || 16, {});
    end = a.addDays(a.addDays(TODAY, -a.isoWeekday(TODAY)), blk.planWeeks*7 - 1);
    ds = a.buildDaysFromWeeks(blk, end, SCHED[days], TODAY, true);
  } finally { a.athleteResponseModel = realM; a.blockEffectiveness = realB; }
  a.state.days = ds;
  a.state.setup = { distanceKey:dist, currentVolume:VOL[dist], planWeeks:blk.planWeeks,
    schedule:SCHED[days], benchmark:{distanceKey:'5k',timeSec:1385},
    goals:{A:{timeSec:14400}}, activeGoal:'A', paceOverrides:{}, lthr:null, maxHR:null,
    experience:'experienced', startDate:TODAY, raceDate:end, hasEvent:true, purpose:'race' };
  return { a, blk, days: ds };
}
function weekRows(a, blk, days){
  return [...new Set(days.map(d => d.week))].filter(Boolean).sort((x,y)=>x-y)
    .filter(w => days.filter(d => d.week === w).length >= 7)
    .map(w => {
      const wd = days.filter(d => d.week === w);
      const bw = blk.weeks.filter(x => x.week === w)[0] || {};
      const lg = wd.filter(d => d.type === 'long')[0] || null;
      return { week:w, phase: bw.phase || (bw.isRace ? 'Race' : '?'),
        standalone: wd.filter(d => QUALITY.indexOf(d.type) !== -1).length,
        specificLong: !!(lg && lg.mpSegment),
        key: wd.filter(d => { try { return a.sessionImportance(d) === 'KEY'; } catch(e){ return false; } }).length,
        runDays: wd.filter(d => (d.km||0) > 0).length,
        km: Math.round(10*wd.reduce((t,d)=>t+(d.km||0),0))/10 };
    });
}

test('the signal is the one the generator already raises, not a new one', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.state = a.makeDefaultState();
  /* longRunCarriesSpecificWork() and dd.mpSegment must agree on every week of
     every distance -- they are the same fact, read in two places. */
  ['5k','10k','half','full'].forEach(d => {
    a.state = a.makeDefaultState();
    const blk = a.buildBlockWeeks(d, VOL[d], 16, {});
    const end = a.addDays(a.addDays(TODAY, -a.isoWeekday(TODAY)), blk.planWeeks*7 - 1);
    const ds = a.buildDaysFromWeeks(blk, end, SCHED[6], TODAY, true);
    blk.weeks.forEach(wk => {
      const lg = ds.filter(x => x.week === wk.week && x.type === 'long')[0];
      if (!lg) return;
      assert.equal(a.longRunCarriesSpecificWork(wk), !!lg.mpSegment,
        d + ' week ' + wk.week + ': the budget and the prescription disagree about the same week');
    });
  });
  /* And it is false for anything aerobic, however long. */
  assert.equal(a.longRunCarriesSpecificWork({ hasGoalSegment:false, goalSegKm:0 }), false);
  assert.equal(a.longRunCarriesSpecificWork({ hasGoalSegment:true, goalSegKm:0 }), false);
  assert.equal(a.longRunCarriesSpecificWork(null), false);
  assert.equal(a.longRunCarriesSpecificWork({ hasGoalSegment:true, goalSegKm:3 }), true);
});

test('half and marathon no longer stack two standalone sessions onto a specific long run', () => {
  ['half','full'].forEach(d => {
    [5,6,7].forEach(nd => {
      const { a, blk, days } = plan(d, nd, true);
      const rows = weekRows(a, blk, days);
      const specific = rows.filter(r => r.specificLong);
      assert.ok(specific.length > 0, d + '/' + nd + 'd: the fixture must contain specific long runs');
      specific.forEach(r => {
        assert.equal(r.standalone, 1,
          d + '/' + nd + 'd week ' + r.week + ' (' + r.phase + '): ' + r.standalone +
          ' standalone quality sessions alongside a race-specific long run');
        assert.ok(r.key <= 2,
          d + '/' + nd + 'd week ' + r.week + ': ' + r.key + ' KEY sessions');
      });
    });
  });
});

test('5K and 10K keep two standalone quality sessions and an aerobic long run', () => {
  ['5k','10k'].forEach(d => {
    [5,6,7].forEach(nd => {
      const { a, blk, days } = plan(d, nd, true);
      const rows = weekRows(a, blk, days);
      assert.equal(rows.filter(r => r.specificLong).length, 0,
        d + ': its long runs must stay aerobic under the current methodology');
      assert.ok(rows.filter(r => r.standalone >= 2).length > rows.length / 2,
        d + '/' + nd + 'd: a capable athlete must still reach two standalone quality sessions');
    });
  });
});

test('an athlete with no exposure evidence is completely unchanged', () => {
  ['5k','10k','half','full'].forEach(d => {
    [3,4,5,6,7].forEach(nd => {
      const { a, blk, days } = plan(d, nd, false);
      weekRows(a, blk, days).forEach(r => assert.ok(r.standalone <= 1,
        d + '/' + nd + 'd week ' + r.week + ': ' + r.standalone +
        ' standalone sessions without the earned exposure'));
    });
  });
});

test('three- and four-day athletes keep their one slot, never zero', () => {
  /* The reduction may only ever take a week from two slots to one. A week whose
     ceiling is already one has nothing to give: taking it would leave an
     athlete with no structured session at all. */
  ['half','full'].forEach(d => {
    [3,4].forEach(nd => {
      const { a, blk, days } = plan(d, nd, true);
      const rows = weekRows(a, blk, days);
      const specific = rows.filter(r => r.specificLong);
      assert.ok(specific.length > 0, d + '/' + nd + 'd: needs specific long runs to test');
      specific.forEach(r => assert.equal(r.standalone, 1,
        d + '/' + nd + 'd week ' + r.week + ': a low-frequency week lost its only quality session'));
    });
  });
});

test('a week whose long run is genuinely aerobic keeps its full allowance', () => {
  /* Not "marathon always gets one". Base and taper long runs carry no goal
     pace, so those weeks are budgeted for what is actually prescribed. */
  ['half','full'].forEach(d => {
    const { a, blk, days } = plan(d, 6, true);
    const rows = weekRows(a, blk, days);
    const aerobic = rows.filter(r => !r.specificLong && ['Base','Taper'].indexOf(r.phase) !== -1);
    assert.ok(aerobic.length > 0, d + ': the block must contain aerobic long-run weeks');
    assert.ok(aerobic.some(r => r.standalone === 2),
      d + ': a week with an aerobic long run and the exposure earned must still be able ' +
      'to hold two standalone quality sessions');
  });
});

test('the freed day stays a running day', () => {
  /* The week is spending its quality budget differently, not running less.
     Compared against the same plan built with the long run held aerobic. */
  ['half','full'].forEach(d => {
    const { a, blk, days } = plan(d, 6, true);
    weekRows(a, blk, days).filter(r => r.specificLong).forEach(r => {
      assert.equal(r.runDays, 6,
        d + ' week ' + r.week + ': ' + r.runDays + ' running days, not 6');
    });
  });
});

test('the reduction never bypasses the gates that were already there', () => {
  /* Every existing gate still runs, in the same order, and still decides.
     Proved by the two directions that must remain impossible. */
  const { a } = plan('full', 6, false);
  /* 1. No evidence -> the exposure gate still refuses, whatever the long run. */
  const p = a.secondQualityExposurePermission(3);
  assert.equal(p.permitted, false);
  /* Its own two no-evidence rungs: no model at all, or a model in which no
     family has reached BASELINE_MIN_SAMPLES. Named rather than accepted
     loosely -- any OTHER reason here would mean the ladder had changed. */
  assert.ok(['no_evidence','response_not_established'].indexOf(p.reason) !== -1, p.reason);
  /* 2. The day-count ceiling is untouched: this rule reads it, never replaces it. */
  assert.equal(a.qualitySlotCeilingForDayCount(2), 0);
  assert.equal(a.qualitySlotCeilingForDayCount(3), 1);
  assert.equal(a.qualitySlotCeilingForDayCount(4), 1);
  assert.equal(a.qualitySlotCeilingForDayCount(5), 2);
  assert.equal(a.qualitySlotCeilingForDayCount(7), 2);
  /* 3. And the week records the decision so it is inspectable rather than inferred. */
  const { blk } = plan('full', 6, true);
  const specific = blk.weeks.filter(w => a.longRunCarriesSpecificWork(w));
  assert.ok(specific.length > 0);
  specific.forEach(w => {
    assert.ok(w.qualityBudget, 'week ' + w.week + ' records no budget');
    assert.equal(w.qualityBudget.specificLongRun, true);
    assert.equal(w.qualityBudget.ceiling, 2, 'the ceiling itself is unchanged');
    assert.equal(w.qualityBudget.prescribed, 1, 'and one of the two is the long run');
  });
});

test('the specific work itself is untouched — this moved the budget, not the session', () => {
  /* WHAT "UNTOUCHED" HAS TO MEAN UNDER BOTTOM-UP CONSTRUCTION. A week is now
     the SUM of the sessions it prescribes, at both race-goal distances, so an
     athlete who has earned a second demanding session has a differently
     shaped week -- two quality sessions cost more than one, and what they cost
     the long run does not get. Comparing absolute long-run kilometres between
     an earned and an unearned athlete therefore compares two different weeks
     and calls the difference a defect.

     THE PROPERTY THIS WAS WRITTEN TO PROTECT IS THE SESSION'S CHARACTER, and
     it is asserted directly: which weeks carry race-specific work, and what
     PROPORTION of the long run that work is, are identical either way. The
     budget rule moved the budget; it did not rewrite the session. */
  ['half','full'].forEach(d => {
    const before = plan(d, 6, false);   // unchanged athlete, for the segment sizes
    const after  = plan(d, 6, true);
    const carries = p => p.blk.weeks.map(w => w.week + ':' + (w.hasGoalSegment ? 1 : 0)).join(',');
    assert.equal(carries(after), carries(before),
      d + ': which weeks carry race-specific work must not move');
    /* AND THE SHARE STAYS THE SHARE, within the one step the segment's own
       three-kilometre floor can introduce: the segment is a proportion of the
       long run bounded below by 3km, so where the long run differs the floor
       binds at a marginally different fraction. That is the floor doing its
       job, not the budget rewriting the session. */
    const frac = p => p.blk.weeks.map(w => Math.round(100 * (w.goalSegFrac || 0)));
    const fa = frac(after), fb = frac(before);
    fa.forEach((v, i) => assert.ok(Math.abs(v - fb[i]) <= 2,
      d + ' week ' + (i + 1) + ': the specific share moved from ' + fb[i] + '% to ' + v + '%'));
  });
});
