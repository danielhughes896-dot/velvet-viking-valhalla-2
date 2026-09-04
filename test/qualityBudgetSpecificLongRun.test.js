'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

/* THE WEEK'S QUALITY BUDGET AND THE RACE-SPECIFIC LONG RUN
 * ===========================================================================
 * HQ WORKOUT-STRUCTURE METHODOLOGY RULING -- THIS FILE'S ORIGINAL RULE IS
 * SUPERSEDED FOR HALF AND MARATHON, BY EXPLICIT INSTRUCTION.
 *
 * The file used to hold that a goal-pace long run spent one of the week's two
 * earned quality slots, because a capable half or marathon athlete who had
 * earned the second exposure otherwise received two standalone quality
 * sessions AND a race-specific long run -- three sessions the product's own
 * sessionImportance() calls KEY, the largest of them the one the old budget
 * could not see. That reduction (see the "gates" test below) is still LIVE
 * CODE -- weekSlotCeiling's specificLong reduction and the athlete-evidence
 * gate are untouched -- but for Half and Marathon it is no longer reached at
 * all: HQ's own words were "the marathon/HM-specific long run is separate
 * from the standalone quality-session count. Therefore, for example, an
 * Established Marathon Build week requires 2 standalone quality sessions
 * plus the marathon-specific long run." raceGoalWeekQualitySlots() (see
 * buildBlockWeeks) and the raceGoalTierQuality override (see
 * buildDaysFromWeeks) are the new, tier-driven authority for these two
 * distances: Developing = 1 quality session in every phase; Established and
 * Advanced = 2 in Build specifically, alongside the long run whether or not
 * it carries goal pace, and 1 everywhere else (Base, Peak, Taper, Race
 * Week) -- deliberately including Peak, where the reduction's own original
 * reasoning (two long-run exposures already own the week) still applies and
 * is now expressed as the tier rule's own answer rather than as a live
 * reduction.
 *
 * 5K and 10K are untouched: their long runs never carry goal pace under the
 * current methodology, so this file's original rule never bound them, and it
 * still doesn't -- they still read secondQualityExposurePermission() exactly
 * as before.
 *
 * These tests now hold the NEW shape: two standalone sessions AND the
 * specific long run in Half/Marathon Build, one everywhere else in
 * Half/Marathon, and the untouched 5K/10K behaviour beside it.
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
    /* HQ NARROW PATHWAY CORRECTION -- experience is now passed explicitly,
       as 'advanced'. Half/Marathon's implicit (unnamed) experience default
       resolves to 'experienced', whose own entry HQ's directive dropped
       (Half 30 -> 20km), and at this file's fixed 5-day/55-60km-ish fixture
       that now loses week 6's earned second quality slot alongside a
       specific long run -- a downstream day-count/capacity shift, not the
       quality-budget mechanic this file exists to test. Advanced's own
       entry did not move, so it keeps the shape every test here assumes. */
    blk = a.buildBlockWeeks(dist, VOL[dist], weeks || 16, { experience: 'advanced' });
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

test('half and marathon now stack two standalone Build sessions onto a specific long run, by tier -- and Peak still does not', () => {
  /* HQ WORKOUT-STRUCTURE METHODOLOGY RULING. This fixture is 'advanced', so
     RACE_GOAL_BUILD_QUALITY_SLOTS grants it two in Build regardless of the
     long run's own specificity -- the tier rule, not the old reduction,
     decides now. Peak is the one phase HQ's own spec still caps at a single
     quality session even though its long run is equally specific: "Peak: 1
     quality session... alongside race-specific long-run development." So a
     Build week may legitimately carry three KEY sessions (two standalone
     plus the specific long run) and a Peak week may not -- the exact
     asymmetry the old reduction used to erase uniformly. */
  ['half','full'].forEach(d => {
    [5,6,7].forEach(nd => {
      const { a, blk, days } = plan(d, nd, true);
      const rows = weekRows(a, blk, days);
      const specific = rows.filter(r => r.specificLong);
      assert.ok(specific.length > 0, d + '/' + nd + 'd: the fixture must contain specific long runs');
      specific.forEach(r => {
        const want = r.phase === 'Build' ? 2 : 1;
        assert.equal(r.standalone, want,
          d + '/' + nd + 'd week ' + r.week + ' (' + r.phase + '): ' + r.standalone +
          ' standalone quality sessions alongside a race-specific long run, wanted ' + want);
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

test('5K/10K with no exposure evidence are completely unchanged', () => {
  ['5k','10k'].forEach(d => {
    [3,4,5,6,7].forEach(nd => {
      const { a, blk, days } = plan(d, nd, false);
      weekRows(a, blk, days).forEach(r => assert.ok(r.standalone <= 1,
        d + '/' + nd + 'd week ' + r.week + ': ' + r.standalone +
        ' standalone sessions without the earned exposure'));
    });
  });
});

test('half/marathon Build no longer reads exposure evidence at all -- the tier rule decides, earned or not', () => {
  /* HQ WORKOUT-STRUCTURE METHODOLOGY RULING. secondQualityExposurePermission()
     is bypassed entirely for these two distances (see raceGoalTierQuality in
     buildDaysFromWeeks), so an 'advanced' athlete's Build weeks carry two
     standalone sessions whether or not the stubbed evidence says they earned
     it -- that is the whole point of replacing an earned gate with a tier
     rule. Base, Peak and Taper are untouched by evidence either way: they
     were already reading the phase, not the athlete's response model, and
     still are. */
  ['half','full'].forEach(d => {
    [5,6,7].forEach(nd => {
      const { a, blk, days } = plan(d, nd, false);
      const rows = weekRows(a, blk, days);
      const build = rows.filter(r => r.phase === 'Build');
      assert.ok(build.length > 0, d + '/' + nd + 'd: needs Build weeks to test');
      build.forEach(r => assert.equal(r.standalone, 2,
        d + '/' + nd + 'd week ' + r.week + ': ' + r.standalone +
        ' standalone sessions in Build with no exposure evidence -- the tier rule should not care'));
      rows.filter(r => r.phase !== 'Build').forEach(r => assert.equal(r.standalone, 1,
        d + '/' + nd + 'd week ' + r.week + ' (' + r.phase + '): ' + r.standalone + ' standalone sessions'));
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

test('the aerobic long run does not change what the phase itself gives Base and Taper', () => {
  /* HQ WORKOUT-STRUCTURE METHODOLOGY RULING -- Base and Taper are now capped
     at ONE standalone quality session by the tier rule itself ("Base: 1
     quality session"; "Taper: reduced volume + reduced-cost quality"), not
     by whether the long run happens to be aerobic. The old test here asked
     whether an aerobic long run could still afford two -- under the earned
     evidence gate it sometimes could. The tier rule answers a different
     question: not "can this week afford two", but "does this phase ever
     carry two", and Base/Taper's answer is no, regardless of exposure
     evidence, exactly as Peak's is (see the Peak test above).

     NEVER TWO, BUT SOMETIMES ZERO -- and that second number is not this
     rule's business. A week whose own capacity cannot yet afford its single
     quality session gives it back entirely (marathonQualityEligible(), see
     buildBlockWeeks) -- a pre-existing affordability floor this correction
     does not touch. So the bound asserted here is the CEILING the tier rule
     sets (never 2), not the exact count every week delivers. */
  ['half','full'].forEach(d => {
    const { a, blk, days } = plan(d, 6, true);
    const rows = weekRows(a, blk, days);
    const aerobic = rows.filter(r => !r.specificLong && ['Base','Taper'].indexOf(r.phase) !== -1);
    assert.ok(aerobic.length > 0, d + ': the block must contain aerobic long-run weeks');
    aerobic.forEach(r => assert.ok(r.standalone <= 1,
      d + ' week ' + r.week + ' (' + r.phase + '): ' + r.standalone +
      ' standalone quality sessions, the phase\'s own ceiling is one'));
  });
});

test('the freed day stays a running day', () => {
  /* The week is spending its quality budget differently, not running less.
     Compared against the same plan built with the long run held aerobic. */
  /* ---- THE CONTROL IS INSIDE THE SAME BLOCK ----
     This asserted a flat six running days, which was the same statement while
     the block filled every available day. It no longer does: the architecture
     prescribes the fewest days the work actually needs, so a marathon week
     legitimately runs on five and its neighbour on six. The property is not a
     number, it is that specificity does not COST the week a running day, and
     the only clean control for that is the same athlete in the same block
     before specificity arrived -- not a second plan, which differs in the
     quality frequency it earned rather than in the long run.

     Measured: the aerobic-long weeks and the specific-long weeks of the same
     marathon block run on the same numbers of days, 5 and 6 in both, so the day
     count is following the week's own arithmetic and not being spent on the
     goal segment. That is what "the freed day stays a running day" means. */
  ['half','full'].forEach(d => {
    const { a, blk, days } = plan(d, 6, true);
    const rows = weekRows(a, blk, days);
    const before = rows.filter(r => !r.specificLong && !r.isTaper && !r.isRace);
    const after  = rows.filter(r =>  r.specificLong);
    assert.ok(before.length && after.length, d + ' needs both kinds of week');
    const floor = Math.min.apply(null, before.map(r => r.runDays));
    after.forEach(r => assert.ok(r.runDays >= floor,
      d + ' week ' + r.week + ': ' + r.runDays + ' running days, below the ' +
      floor + ' the same block runs on before its long run became specific'));
  });
});

test('the OLD gates still exist and still decide for everyone the tier rule does not cover', () => {
  /* Every gate this file originally proved still runs, in the same order,
     for the same callers -- it is simply no longer consulted for Half/
     Marathon Build, per the HQ ruling at the top of this file. Proved
     directly against the raw functions, which are untouched. */
  const { a } = plan('full', 6, false);
  /* 1. No evidence -> the exposure gate still refuses, whatever the long run.
     Still the live authority for 5K/10K, and for Half/Marathon outside Build. */
  const p = a.secondQualityExposurePermission(3);
  assert.equal(p.permitted, false);
  assert.ok(['no_evidence','response_not_established'].indexOf(p.reason) !== -1, p.reason);
  /* 2. The day-count ceiling is untouched: this rule reads it, never replaces it. */
  assert.equal(a.qualitySlotCeilingForDayCount(2), 0);
  assert.equal(a.qualitySlotCeilingForDayCount(3), 1);
  assert.equal(a.qualitySlotCeilingForDayCount(4), 1);
  assert.equal(a.qualitySlotCeilingForDayCount(5), 2);
  assert.equal(a.qualitySlotCeilingForDayCount(7), 2);
  /* 3. And the week still records the decision, so it is inspectable rather
     than inferred -- specificLongRun is still read and still true on exactly
     these weeks; prescribed now follows the tier rule (2 in Build, 1 in
     Peak) rather than the old reduction (always 1). */
  const { blk } = plan('full', 6, true);
  const specific = blk.weeks.filter(w => a.longRunCarriesSpecificWork(w));
  assert.ok(specific.length > 0);
  specific.forEach(w => {
    assert.ok(w.qualityBudget, 'week ' + w.week + ' records no budget');
    assert.equal(w.qualityBudget.specificLongRun, true);
    const want = w.phase === 'Build' ? 2 : 1;
    assert.equal(w.qualityBudget.prescribed, want,
      'week ' + w.week + ' (' + w.phase + '): prescribed ' + w.qualityBudget.prescribed + ', wanted ' + want);
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
    /* ---- WHICH WEEKS CARRY IT IS NOW A COACHING DECISION, AND IT MOVES ----
       This asserted the carrying weeks were identical either way. HQ's
       experience-and-absorption ruling deliberately changed that: an experienced
       athlete whose evidence says they are absorbing their training, with a
       demonstrated quality family behind them, meets race-specific work in the
       last week of Base rather than the first week of Build. The `earned`
       fixture stubs exactly that evidence -- an ADAPTING block and established
       families -- so its specificity beginning EARLIER is the ruling working,
       not the budget rewriting anything.

       What must hold, and is asserted instead, is the direction and the end: an
       athlete with the evidence never meets it LATER than one without, and the
       block stops asking for it in the same week either way. */
    const carryWeeks = p => p.blk.weeks.filter(w => w.hasGoalSegment).map(w => w.week);
    const wa = carryWeeks(after), wb = carryWeeks(before);
    assert.ok(wa.length && wb.length, d + ': both athletes must meet race pace');
    assert.ok(wa[0] <= wb[0],
      d + ': the absorbing athlete met race-specific work in week ' + wa[0] +
      ', later than week ' + wb[0] + ' for the athlete without the evidence');
    assert.equal(wa[wa.length - 1], wb[wb.length - 1],
      d + ': the block must stop asking for it in the same week either way');
    /* AND THE SHARE STAYS THE SHARE, within the one step the segment's own
       three-kilometre floor can introduce: the segment is a proportion of the
       long run bounded below by 3km, so where the long run differs the floor
       binds at a marginally different fraction. That is the floor doing its
       job, not the budget rewriting the session. */
    const frac = p => p.blk.weeks.map(w => Math.round(100 * (w.goalSegFrac || 0)));
    const fa = frac(after), fb = frac(before);
    /* On the weeks BOTH athletes carry it, which is what "the same session" can
       mean once the week it starts in is allowed to differ. */
    fa.forEach((v, i) => { if (!(fa[i] > 0 && fb[i] > 0)) return;
      assert.ok(Math.abs(v - fb[i]) <= 2,
        d + ' week ' + (i + 1) + ': the specific share moved from ' + fb[i] + '% to ' + v + '%'); });
  });
});
