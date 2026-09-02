'use strict';
/* TWO THINGS HQ ASKED TO BE PROVED RATHER THAN ASSERTED.
 * ===========================================================================
 *
 * §7  THE RACE IS REAL DISTANCE AND IT IS NOT TRAINING DEVELOPMENT.
 *     A marathon race week totals sixty-odd kilometres because forty-two of
 *     them are the marathon. That is not a defect and the fix is not to
 *     pretend the race did not happen -- it is to prove that no part of the
 *     engine that develops, gates or measures TRAINING can see those
 *     kilometres.
 *
 * §5  THE TAPER SHEDS FATIGUE RATHER THAN RENAMING A WEEK.
 *     Measured over the window HQ anchored it to -- the final ten days for a
 *     half, the final fourteen for a marathon -- against the equivalent span
 *     that precedes it, and with the event's own distance excluded from both.
 *     Measuring by WEEK LABEL instead is what made a wind-down week look
 *     unchanged: the half's taper is a date, not a week boundary.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const R = require(path.join(__dirname, 'audit', 'raceGoalReachability.js'));

const ALL = [].concat(R.CANON, R.CANON_10);
function plan(c){
  return R.build(Object.assign({ dist:c.dist, exp:c.exp, days:c.days, weeks:c.weeks }, c.ev));
}
function offsets(res){
  const race = res.dd.filter(d => d.type === 'race')[0];
  return d => Math.round(
    (new Date(race.date + 'T00:00:00Z') - new Date(d.date + 'T00:00:00Z')) / 86400000);
}
const trainingKm = days => days.filter(d => d.km > 0 && d.type !== 'race')
                               .reduce((t, d) => t + d.km, 0);

// ---------------------------------------------------------------------------
// §7  THE EVENT IS DISTANCE, NOT DEVELOPMENT
// ---------------------------------------------------------------------------
test('RACE WEEK — the event is the difference between the week total and the training', () => {
  /* The number that alarms a reader is real and it is explained by exactly one
     thing. Nothing unattributed hides inside it. */
  ALL.forEach(c => {
    const res = plan(c);
    const rw = res.dd.filter(d => d.week === c.weeks && d.km > 0);
    const ev = rw.filter(d => d.type === 'race').reduce((t, d) => t + d.km, 0);
    const total = rw.reduce((t, d) => t + d.km, 0);
    const expected = res.a.DISTANCE_PROFILES[c.dist].raceKm;
    assert.ok(Math.abs(ev - expected) < 0.05,
      c.key + ': race day is ' + ev + 'km, the event is ' + expected);
    assert.ok(Math.abs((total - ev) - trainingKm(rw)) < 0.05,
      c.key + ': the week total minus the event is not the training it contains');
  });
});

test('RACE WEEK — its training is a fraction of Peak, and the event is what makes it look large', () => {
  ALL.forEach(c => {
    const res = plan(c);
    const peakWk = res.blk.weeks.filter(w => w.phase === 'Peak').slice(-1)[0];
    if (!peakWk) return;
    const peak = trainingKm(res.dd.filter(d => d.week === peakWk.week));
    const raceTrain = trainingKm(res.dd.filter(d => d.week === c.weeks));
    assert.ok(raceTrain < peak * 0.65,
      c.key + ': race-week training ' + raceTrain.toFixed(1) +
      'km against a Peak of ' + peak.toFixed(1));
  });
});

test('RACE WEEK — the event cannot satisfy a preparation destination', () => {
  /* Readiness reads the weeks the block DEVELOPED in. If the race week counted,
     a marathon would satisfy every workload destination it has by definition
     -- forty-two kilometres in the week is more than most pathways ask for. */
  ALL.forEach(c => {
    const res = plan(c);
    const rr = res.a.raceGoalReadiness(c.dist, c.exp, res.blk);
    if (!rr) return;
    const wl = rr.dimensions.filter(d => d.key === 'workload')[0];
    if (!wl) return;
    const raceWkTotal = res.dd.filter(d => d.week === c.weeks && d.km > 0)
                              .reduce((t, d) => t + d.km, 0);
    assert.ok(wl.detail.reachedKm < raceWkTotal || wl.detail.reachedKm >= raceWkTotal,
      'sanity');
    /* The real assertion: what readiness read is a week the block BUILT, and no
       week it built is the race week. */
    const built = res.blk.weeks.filter(w => !w.isRace && !w.isTaper && !w.eventTaperApplied)
                               .map(w => w.volume);
    assert.ok(built.some(v => Math.abs(v - wl.detail.reachedKm) < 0.6),
      c.key + ': readiness read ' + wl.detail.reachedKm +
      'km, which is not any developing week the block wrote');
  });
});

test('RACE WEEK — it is Final Week, so it can satisfy no phase exit and extend no phase', () => {
  ALL.forEach(c => {
    const res = plan(c);
    const last = res.blk.weeks[res.blk.weeks.length - 1];
    assert.equal(last.isRace, true, c.key + ': the last week is not the race week');
    assert.equal(last.phase, 'Final Week', c.key + ': race week phase is ' + last.phase);
    res.blk.weeks.forEach(w => {
      if (w.isRace) return;
      assert.notEqual(w.phase, 'Final Week',
        c.key + ': week ' + w.week + ' claims Final Week without being the race');
    });
  });
});

test('RACE WEEK — it takes no development step, so nothing progresses from it', () => {
  /* The step count runs to the durability exposure and stops. A race week that
     handed out a step would leave the curve one advance higher than the block
     ever trained, and the next block would progress from a marathon. */
  ALL.forEach(c => {
    const res = plan(c);
    const steps = res.a.raceGoalStepCount(c.dist, c.weeks, c.exp);
    const alloc = res.a.raceGoalPhaseAllocation(c.dist, c.weeks, c.exp);
    const development = alloc.base + alloc.build + alloc.peak;
    assert.ok(steps <= development,
      c.key + ': ' + steps + ' steps across ' + development + ' developing weeks');
    const last = res.blk.weeks[res.blk.weeks.length - 1];
    const prev = res.blk.weeks[res.blk.weeks.length - 2];
    if (last.bottomUp && prev && prev.lastStep != null)
      assert.ok(last.stepIdx == null || last.stepIdx <= prev.stepIdx + 1,
        c.key + ': the race week advanced the curve');
  });
});

test('RACE WEEK — the event is not evidence of a training week the athlete held', () => {
  /* The evidence accessors are what a NEXT block would progress from. A
     completed marathon must not read as a sustainable weekly volume or as a
     demonstrated long run, or the athlete's next programme opens on top of
     their race. */
  const res = plan(R.CANON[3]);                      // New Marathon, 15w
  const a = res.a;
  const race = res.dd.filter(d => d.type === 'race')[0];
  const t = a.todayStr();
  a.state.athlete = { sessions: [
    { date:a.addDays(t, -7), completed:true, type:'race', actualKm:42.2, plannedKm:42.2,
      actual:{ km:42.2, rpe:9, pace:340, hr:170 } },
    { date:a.addDays(t, -8), completed:true, type:'easy', actualKm:5, plannedKm:5,
      actual:{ km:5, rpe:3, pace:400, hr:130 } }
  ]};
  const vol = a.demonstratedSustainableVolume();
  const lr  = a.demonstratedLongRunKm();
  assert.ok(vol == null || vol < 42,
    'a race week read as a sustainable weekly volume of ' + vol);
  assert.ok(lr == null || lr < 42,
    'the race read as a demonstrated long run of ' + lr);
  assert.ok(race.km > 42, 'sanity: the race really is 42km');
});

test('RACE WEEK — the projection that admits the block never sees a race day', () => {
  /* raceGoalPreparationOutlook is a function of the athlete's entry state and
     the runway. It takes no days, builds no week and cannot be reached by an
     event distance -- which is what makes it safe to ask before construction. */
  ALL.forEach(c => {
    const res = plan(c);
    const o = res.a.raceGoalPreparationOutlook(c.dist, c.exp, c.weeks,
                { availableDays:c.days, easyPaceSecPerKm:res.pace });
    const raceKm = res.a.DISTANCE_PROFILES[c.dist].raceKm;
    assert.ok(o.reachWeekKm !== raceKm && o.reachLongKm !== raceKm,
      c.key + ': the projection is carrying the event distance');
    assert.ok(o.reachLongKm < raceKm,
      c.key + ': projected long run ' + o.reachLongKm + ' is the race itself');
  });
});

// ---------------------------------------------------------------------------
// §5  THE TAPER SHEDS FATIGUE
// ---------------------------------------------------------------------------
test('TAPER — the anchored window carries meaningfully less training than the span before it', () => {
  /* HQ's anchors: half D-10, marathon D-14. Compared against the equivalent
     span immediately before, with the event excluded from both, because a
     taper measured by week label on a date-anchored wind-down measures the
     wrong days. */
  ALL.forEach(c => {
    const res = plan(c);
    const off = offsets(res);
    const T = c.dist === 'half' ? 10 : 14;
    /* THE ANCHOR DAY BELONGS TO PEAK, NOT TO THE TAPER. HQ places the
       marathon's longest run at D-14 and the half's wind-down at D-10, and the
       half's own day factor is exactly 1 at the anchor: the taper begins the
       day after and deepens from there. So the window is strictly inside it. */
    let inWin = 0, before = 0;
    res.dd.forEach(d => {
      if (!(d.km > 0) || d.type === 'race') return;
      const o = off(d);
      if (o >= 0 && o < T) inWin += d.km;
      else if (o >= T && o < 2 * T) before += d.km;
    });
    assert.ok(before > 0, c.key + ': nothing to taper from');
    assert.ok(inWin < before * 0.9,
      c.key + ': the final ' + T + ' days carry ' + inWin.toFixed(1) +
      'km against ' + before.toFixed(1) + ' in the ' + T + ' before them');
  });
});

test('TAPER — no session in the window exceeds its own kind at the end of Peak', () => {
  /* Development ended on the last day of Peak. A wind-down that contained a
     bigger long run, or a bigger easy run, than the block's own Peak would be
     development after the boundary whatever the week total said. */
  ALL.forEach(c => {
    const res = plan(c);
    const off = offsets(res);
    const T = c.dist === 'half' ? 10 : 14;
    const peakOf = {}, winOf = {};
    res.dd.forEach(d => {
      if (!(d.km > 0) || d.type === 'race') return;
      const o = off(d), k = d.type;
      if (o >= 0 && o < T) winOf[k] = Math.max(winOf[k] || 0, d.km);
      else peakOf[k] = Math.max(peakOf[k] || 0, d.km);
    });
    ['easy', 'long'].forEach(k => {
      if (winOf[k] == null || peakOf[k] == null) return;
      assert.ok(winOf[k] <= peakOf[k] + 1e-9,
        c.key + ': a ' + k + ' run of ' + winOf[k] + 'km inside the taper window, ' +
        'against ' + peakOf[k] + 'km at its largest before it');
    });
  });
});

test('TAPER — the identity rule cannot undo the reduction it follows', () => {
  /* A tapered long run is held above the week's aerobic runs so it stays the
     long run. Held above the QUALITY day as well, it was raised back past the
     figure the taper had just prescribed: measured on the New Half at ten
     weeks, 10km tapered to 8km and restored to 10km by a 9.5km tempo. */
  const c = R.CANON_10.filter(x => x.key.indexOf('New Half') === 0)[0];
  const res = plan(c);
  const off = offsets(res);
  const longs = res.dd.filter(d => d.type === 'long' && d.km > 0);
  const inWin = longs.filter(d => off(d) < 10);
  const before = longs.filter(d => off(d) >= 10);
  assert.ok(inWin.length && before.length, 'no long runs either side of the anchor');
  const biggestBefore = Math.max.apply(null, before.map(d => d.km));
  inWin.forEach(d => assert.ok(d.km < biggestBefore,
    'a long run of ' + d.km + 'km at D-' + off(d) +
    ' against ' + biggestBefore + 'km before the taper'));
});

// ---------------------------------------------------------------------------
// §8  THE PEAK SPLIT IS ONE SESSION, NOT A PROHIBITION
// ---------------------------------------------------------------------------
test('SPECIFICITY — a longest run may carry goal-pace work, and across the set it does', () => {
  /* HQ warned against the split hardening into "the athlete's longest run may
     never contain event-specific work". It has not: across the twelve
     canonical programmes, runs at the block's own maximum distance carry
     goal-pace segments in six of them. */
  let atMax = 0, specific = 0;
  ALL.forEach(c => {
    const res = plan(c);
    const longs = res.dd.filter(d => d.type === 'long' && d.km > 0);
    const max = Math.max.apply(null, longs.map(d => d.km));
    longs.filter(d => Math.abs(d.km - max) < 1e-9).forEach(d => {
      atMax++; if (d.mpSegment) specific++;
    });
  });
  assert.ok(specific > 0,
    'no long run at the block maximum carries specific work anywhere in the set — ' +
    'the split has become a blanket prohibition');
  assert.ok(specific >= 5,
    'only ' + specific + ' of ' + atMax + ' maximum-distance long runs carry specific work');
});

test('SPECIFICITY — what is suppressed is the culminating exposure, and only that', () => {
  /* The last long run before development stops. Every other maximum-length run
     has an absorption or development week behind it; this one has a taper. */
  ALL.forEach(c => {
    const res = plan(c);
    const dev = res.blk.weeks.filter(w => !w.isRace && !w.isTaper);
    const last = dev[dev.length - 1];
    assert.equal(last.hasGoalSegment, false,
      c.key + ': the culminating long run in week ' + last.week +
      ' carries a ' + last.goalSegKm + 'km goal-pace segment');
    /* And the block did prescribe specificity somewhere, or the suppression is
       hiding an absence rather than separating two demands. */
    const anySpec = res.blk.weeks.some(w => w.hasGoalSegment);
    const path = res.a.raceGoalPathway(c.dist, c.exp);
    if (path && res.a.raceGoalReadiness(c.dist, c.exp, res.blk))
      assert.ok(anySpec || c.exp === 'novice',
        c.key + ': no event-specific work anywhere in the block');
  });
});
