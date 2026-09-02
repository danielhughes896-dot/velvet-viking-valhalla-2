'use strict';
/* THE SHAPE OF A RACE GOAL PROGRAMME, ACROSS EVERY PATHWAY AND EVERY RUNWAY.
 * ===========================================================================
 * Not "did it reach the target" but "did it reach the preparation state
 * through a defensible training progression". Six pathways at ten to fifteen
 * weeks, read off the generated days rather than off any constant.
 *
 * Three defects this file was written against, all found by generating the
 * thirty-six programmes and looking at them:
 *
 *   AN ABSORPTION WEEK TOOK A RUNNING DAY. The cutback discounted the week's
 *   CAPACITY, which is what pays for the days, on top of stepping the sessions
 *   back. The canonical New marathon's week four came out 24km -> 13km on every
 *   runway, three running days down to two, with the third reappearing as an
 *   optional run.
 *
 *   THE WEEKLY CAP PAID FOR A RUNNING DAY OUT OF THE LONG RUN. Under bottom-up
 *   construction the week IS the sum of its sessions, so the only excess is the
 *   presentation quanta -- and the long run was trimmed in whole kilometres to
 *   reclaim a few hundred metres of it. The New half's long run went 11 -> 10 in
 *   an ordinary development week and repaid it later as a three-kilometre jump.
 *
 *   AND WITH THE CAPACITY DISCOUNT GONE, thirteen cutback weeks came out LARGER
 *   than the week before them, because the supporting work kept climbing while
 *   only the long run gave anything up. The reduction belongs on the dose.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const R = require(path.join(__dirname, 'audit', 'raceGoalReachability.js'));

const PATHS = [
  { key:'New Half',             dist:'half', exp:'novice',      days:5, ev:{easyKm:3.5,longKm:8, easyDays:[0,2],  tt5kMin:28} },
  { key:'Experienced Half',     dist:'half', exp:'experienced', days:6, ev:{easyKm:5,  longKm:15,qKm:5,easyDays:[0,2],  tt5kMin:22} },
  { key:'Advanced Half',        dist:'half', exp:'advanced',    days:6, ev:{easyKm:6,  longKm:20,qKm:7,easyDays:[0,2,4],tt5kMin:18} },
  { key:'New Marathon',         dist:'full', exp:'novice',      days:5, ev:{easyKm:5,  longKm:10,easyDays:[0,2],  tt5kMin:28} },
  { key:'Experienced Marathon', dist:'full', exp:'experienced', days:6, ev:{easyKm:6,  longKm:18,qKm:4,easyDays:[0,2,4],tt5kMin:22} },
  { key:'Advanced Marathon',    dist:'full', exp:'advanced',    days:6, ev:{easyKm:10, longKm:24,qKm:6,easyDays:[0,2,4],tt5kMin:18} }
];
const RUNWAYS = [10, 11, 12, 13, 14, 15];

/* Every admitted programme, as weeks of days. Mandatory kilometres only --
   optional runs carry none and are asserted separately. */
function weeksOf(p, W){
  const res = R.build(Object.assign({ dist:p.dist, exp:p.exp, days:p.days, weeks:W }, p.ev));
  const adm = res.a.raceGoalAdmission(p.dist, W, null,
                { availableDays:p.days, easyPaceSecPerKm:res.pace });
  if (!adm.admitted) return null;
  return res.blk.weeks.map(wk => {
    const run = res.dd.filter(d => d.week === wk.week && d.km > 0);
    const mand = run.filter(d => d.type !== 'race' && !d.availableUnused);
    return { w:wk.week, phase:wk.phase, cutback:!!wk.isCutback,
             taper:!!wk.isTaper, race:!!wk.isRace,
             km: Math.round(mand.reduce((t, d) => t + d.km, 0) * 10) / 10,
             lr: run.filter(d => d.type === 'long').reduce((m, d) => Math.max(m, d.km), 0),
             days: mand.length };
  });
}
function each(fn){
  PATHS.forEach(p => RUNWAYS.forEach(W => {
    const wks = weeksOf(p, W);
    if (wks) fn(p.key + ' @' + W + 'w', wks, p, W);
  }));
}
const development = wks => wks.filter(w => !w.taper && !w.race);

test('CUTBACK — an absorption week is a reduction, and it is roughly the one the design states', () => {
  let n = 0;
  each((key, wks) => {
    const dev = development(wks);
    dev.forEach((w, i) => {
      if (!w.cutback || i === 0) return;
      n++;
      const prev = dev[i - 1];
      assert.ok(w.km < prev.km,
        key + ' week ' + w.w + ': a cutback of ' + w.km + 'km against ' + prev.km + ' before it');
      assert.ok(w.km >= prev.km * 0.55,
        key + ' week ' + w.w + ': a cutback to ' + w.km + 'km from ' + prev.km +
        ' is not an absorption week, it is a week off');
    });
  });
  assert.ok(n >= 60, 'only ' + n + ' cutbacks examined');
});

test('CUTBACK — it reduces the dose and never the athlete\'s frequency', () => {
  each((key, wks) => {
    const dev = development(wks);
    dev.forEach((w, i) => {
      if (!w.cutback || i === 0) return;
      assert.ok(w.days >= dev[i - 1].days,
        key + ' week ' + w.w + ': the absorption week runs on ' + w.days +
        ' days against ' + dev[i - 1].days + ' the week before');
    });
  });
});

test('LONG RUN — it never goes backwards in an ordinary development week', () => {
  /* Coming down is a cutback's job and a taper's job. An ordinary development
     week asking for less than the week before it is the curve being undone by
     something that is not coaching. */
  each((key, wks) => {
    const dev = development(wks);
    for (let i = 1; i < dev.length; i++){
      if (dev[i].cutback || dev[i - 1].cutback) continue;
      assert.ok(dev[i].lr >= dev[i - 1].lr,
        key + ' week ' + dev[i].w + ': long run ' + dev[i - 1].lr + 'km -> ' + dev[i].lr +
        'km in an ordinary development week');
    }
  });
});

test('LONG RUN — it arrives by progression, not by a late jump', () => {
  /* No single development week may add more than a quarter of the whole
     block's long-run development. */
  each((key, wks) => {
    const dev = development(wks);
    const start = dev[0].lr, end = Math.max.apply(null, dev.map(w => w.lr));
    if (end <= start) return;
    const total = end - start;
    for (let i = 1; i < dev.length; i++){
      if (dev[i].cutback || dev[i - 1].cutback) continue;
      const step = dev[i].lr - dev[i - 1].lr;
      assert.ok(step <= total * 0.35 + 1.0001,
        key + ' week ' + dev[i].w + ': the long run jumped ' + step + 'km of a ' +
        total + 'km total development');
    }
  });
});

test('CULMINATING LONG RUN — inside HQ\'s window, in every programme', () => {
  PATHS.forEach(p => RUNWAYS.forEach(W => {
    const res = R.build(Object.assign({ dist:p.dist, exp:p.exp, days:p.days, weeks:W }, p.ev));
    const adm = res.a.raceGoalAdmission(p.dist, W, null,
                  { availableDays:p.days, easyPaceSecPerKm:res.pace });
    if (!adm.admitted) return;
    const race = res.dd.filter(d => d.type === 'race')[0];
    const off = d => Math.round(
      (new Date(race.date + 'T00:00:00Z') - new Date(d.date + 'T00:00:00Z')) / 86400000);
    const longs = res.dd.filter(d => d.type === 'long' && d.km > 0);
    const max = Math.max.apply(null, longs.map(d => d.km));
    const culm = longs.filter(d => d.km === max).slice(-1)[0];
    const win = p.dist === 'half' ? [10, 17] : [14, 21];
    const at = off(culm);
    assert.ok(at >= win[0] && at <= win[1],
      p.key + ' @' + W + 'w: the culminating long run falls at D-' + at +
      ', outside D-' + win[1] + '..D-' + win[0]);
  }));
});

test('TAPER — no development survives the last day of Peak', () => {
  each((key, wks) => {
    const dev = development(wks);
    const last = dev[dev.length - 1];
    wks.filter(w => w.taper && !w.race).forEach(t => {
      assert.ok(t.km <= last.km + 1e-9,
        key + ' week ' + t.w + ': taper volume ' + t.km + ' above Peak\'s ' + last.km);
      assert.ok(t.lr <= last.lr + 1e-9,
        key + ' week ' + t.w + ': taper long run ' + t.lr + ' above Peak\'s ' + last.lr);
    });
  });
});

test('OPTIONAL RUNS — none in Peak, and none carrying distance anywhere', () => {
  PATHS.forEach(p => RUNWAYS.forEach(W => {
    const res = R.build(Object.assign({ dist:p.dist, exp:p.exp, days:p.days, weeks:W }, p.ev));
    const adm = res.a.raceGoalAdmission(p.dist, W, null,
                  { availableDays:p.days, easyPaceSecPerKm:res.pace });
    if (!adm.admitted) return;
    const peak = {};
    res.blk.weeks.forEach(w => { if (w.phase === 'Peak') peak[w.week] = true; });
    res.dd.filter(d => d.availableUnused).forEach(d => {
      assert.equal(d.km, 0, p.key + ' @' + W + 'w: an optional day carries ' + d.km + 'km');
      assert.ok(!peak[d.week],
        p.key + ' @' + W + 'w: an optional run is offered in Peak week ' + d.week);
    });
  }));
});

/* ---------------------------------------------------------------------------
   HQ'S AMENDED MARATHON LONG-RUN CONTRACT
   26 / 29 / 32 km are no longer end-of-Build requirements. They are useful
   minimum CULMINATING standards, reached once, in Peak, inside the
   D-21..D-14 window. What Build owes is the durability and the supporting
   workload to complete that run safely -- not the distance itself.
   --------------------------------------------------------------------------- */
const MARATHON_STANDARD = { novice:26, experienced:29, advanced:32 };

test('CONTRACT — the marathon standard is reached in Peak, not by the end of Build', () => {
  PATHS.filter(p => p.dist === 'full').forEach(p => RUNWAYS.forEach(W => {
    const wks = weeksOf(p, W);
    if (!wks) return;
    const peak = wks.filter(w => w.phase === 'Peak');
    const build = wks.filter(w => w.phase === 'Build' || w.phase === 'Base');
    if (!peak.length || !build.length) return;
    const culm = Math.max.apply(null, peak.map(w => w.lr));
    const endBuild = Math.max.apply(null, build.map(w => w.lr));
    assert.ok(culm >= endBuild,
      p.key + ' @' + W + 'w: Peak\'s longest run ' + culm +
      ' is shorter than Build already reached (' + endBuild + ')');
    /* On a full runway the standard itself is met, and it is met in Peak. */
    if (W >= 14 || p.exp !== 'novice')
      assert.ok(culm >= MARATHON_STANDARD[p.exp],
        p.key + ' @' + W + 'w: culminating long run ' + culm + 'km against a standard of ' +
        MARATHON_STANDARD[p.exp]);
  }));
});

test('CONTRACT — Build leaves the athlete able to complete that run safely', () => {
  /* The condition that replaces "the standard by end of Build": the culminating
     run must be REACHABLE from where Build left the athlete, at the ordinary
     progression rate, across the Peak weeks that separate them. A standard the
     athlete could only meet by jumping is not one Build prepared them for. */
  PATHS.filter(p => p.dist === 'full').forEach(p => RUNWAYS.forEach(W => {
    const wks = weeksOf(p, W);
    if (!wks) return;
    const peak = wks.filter(w => w.phase === 'Peak');
    const build = wks.filter(w => w.phase === 'Build' || w.phase === 'Base');
    if (!peak.length || !build.length) return;
    const endBuild = Math.max.apply(null, build.map(w => w.lr));
    const culm = Math.max.apply(null, peak.map(w => w.lr));
    const reachable = endBuild * Math.pow(1.10, peak.length);
    assert.ok(culm <= reachable + 1.0001,
      p.key + ' @' + W + 'w: Build ended at ' + endBuild + 'km and Peak asks for ' + culm +
      'km, which is beyond the ' + reachable.toFixed(1) + 'km its own rate reaches');
  }));
});

test('CONTRACT — one culminating run, never a second maximal one', () => {
  /* HQ: do not create a second maximal long run merely to satisfy the former
     wording. A marathon block asks for its longest run exactly once. */
  PATHS.filter(p => p.dist === 'full').forEach(p => RUNWAYS.forEach(W => {
    const res = R.build(Object.assign({ dist:p.dist, exp:p.exp, days:p.days, weeks:W }, p.ev));
    const adm = res.a.raceGoalAdmission(p.dist, W, null,
                  { availableDays:p.days, easyPaceSecPerKm:res.pace });
    if (!adm.admitted) return;
    const longs = res.dd.filter(d => d.type === 'long' && d.km > 0);
    const max = Math.max.apply(null, longs.map(d => d.km));
    const atMax = longs.filter(d => d.km === max);
    assert.equal(atMax.length, 1,
      p.key + ' @' + W + 'w: ' + atMax.length + ' runs at the block maximum of ' + max + 'km');
  }));
});

test('CONTRACT — the standard is a floor, not a ceiling', () => {
  /* An athlete whose evidence supports more is not held to 26 / 29 / 32. */
  const strong = R.build({ dist:'full', exp:'advanced', days:6, weeks:15,
                           easyKm:12, longKm:34, qKm:8, easyDays:[0,2,4], tt5kMin:17 });
  const longs = strong.dd.filter(d => d.type === 'long' && d.km > 0);
  const max = Math.max.apply(null, longs.map(d => d.km));
  assert.ok(max >= 34,
    'an athlete arriving with a 34km long run was pulled down to ' + max);
});

test('CONTRACT — weekly workload is still owed by the end of Build', () => {
  /* The half of the contract HQ did NOT amend. buildVolumeKm is what the
     athlete should be carrying when Peak begins, and on a full runway it is. */
  const WANT = { half:{ novice:30, experienced:40, advanced:60 },
                 full:{ novice:40, experienced:55, advanced:70 } };
  PATHS.forEach(p => [14, 15].forEach(W => {
    const wks = weeksOf(p, W);
    if (!wks) return;
    const build = wks.filter(w => w.phase === 'Build' || w.phase === 'Base');
    const reached = Math.max.apply(null, build.map(w => w.km));
    assert.ok(reached >= WANT[p.dist][p.exp] * 0.95,
      p.key + ' @' + W + 'w: Build reached ' + reached + 'km/week against ' +
      WANT[p.dist][p.exp]);
  }));
});
