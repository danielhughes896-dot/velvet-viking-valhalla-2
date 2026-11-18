'use strict';
/* METHODOLOGY BATCH 6, THE PLAN GENERATOR (founder decisions, 18 November 2026).
 *
 * THE RUN LIMIT (Frandsen et al. 2025, BJSM, 5,205 runners): no planned run
 * may be longer than the larger of +10% or +1km over the longest run of the
 * previous 30 days (the athlete's logged runs in the window, the longest run
 * they stated in the builder, and the plan's own earlier runs). Exceptions:
 * a run of 5km or less never counts; Half and Marathon long runs step at 15%
 * / 1.5km (Option A) from the plan's second week; the Marathon's culminating
 * long run; race day. Every run type, every week, week one included, and the
 * written figure respects the limit after rounding.
 *
 *   1  Every run type, every week (the sample: about 300 possible athletes
 *      across the five programmes, zero runs over the limit).
 *   2  Easy runs obey it in every programme; what does not fit goes to more
 *      days, then is named on the week.
 *   3  The threshold test's 30 minutes never change: the warm-up (8 min at
 *      least) and the cool-down (5 min at least) shorten, or the test waits.
 *      A Fitness Checkpoint the same.
 *   4  Low starters open on 5 + 5 + 5 and climb a kilometre at a time.
 *   5  Half and Marathon: no catch-up weeks, ordinary steps of at most 8%;
 *      more than 10% short of the destination is the Preparation offer.
 *   6  5K and 10K open on the runner's current week and long run; a long run
 *      above the range settles down about 15% a week (flagged).
 *   7  A12: the Marathon's long run starts climbing earlier.
 *   8  A14: every 5K and 10K taper week keeps a short sharpening session.
 *   9  The validator, planRunLimitViolations(), names every run over the line.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness.js');

const TODAY = '2026-11-16';
function app(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  return a;
}
const DAYSETS = { 2: [1, 6], 3: [1, 3, 6], 4: [1, 3, 5, 6], 5: [0, 1, 3, 4, 6], 6: [0, 1, 2, 3, 4, 6] };
const byWeek = days => days.reduce((m, d) => { (m[d.week] = m[d.week] || []).push(d); return m; }, {});
const runsOf = list => list.filter(d => d.km > 0 && d.type !== 'rest' && d.type !== 'race');
const totOf = list => Math.round(runsOf(list).reduce((t, d) => t + d.km, 0) * 10) / 10;
const QUALITY = ['tempo', 'threshold', 'interval', 'repetition', 'over_under', 'checkpoint', 'calibration'];

/* One athlete, built the way the builder builds them: the declaration
   (weekly km, run days, longest run on its date), any logged history, then
   the block and its days. */
function build(o){
  const a = app();
  a.state.experience = o.exp || 'experienced';
  a.pendingEntryEvidence = { weeklyKm: o.weekly, runDaysPerWeek: o.days, longestRunKm: o.long,
    longestRunDate: o.longDate || '2026-11-06', recordedAt: TODAY + 'T09:00:00Z' };
  if (o.logKm > 0){
    const ss = [], n = Math.max(2, Math.min(o.days, 5));
    for (let w = 1; w <= 4; w++){
      const mon = a.addDays(TODAY, -7 * w);
      for (let k = 0; k < n; k++) ss.push({ date: a.addDays(mon, k), completed: true, actualKm: Math.round(o.logKm / n * 10) / 10,
        plannedKm: Math.round(o.logKm / n * 10) / 10, type: k === n - 1 ? 'long' : 'easy' });
    }
    a.state.athlete = a.state.athlete || {};
    a.state.athlete.sessions = ss;
  }
  const purpose = o.purpose || 'race';
  const schedule = { activeDays: DAYSETS[o.avail || o.days] || DAYSETS[4], longRunDay: 6 };
  const vol = o.weekly < a.WEEK_FIT_MIN_EASY_KM ? a.LOW_START_WEEK_KM : o.weekly;
  const weeks = o.weeks || 12;
  const blockResult = a.buildBlockWeeks(o.dist, vol, weeks, { purpose, availableDays: schedule.activeDays.length, calibrate: true });
  const raceDate = purpose === 'race' ? a.addDays(TODAY, weeks * 7 - 1) : '';
  const days = a.buildDaysFromWeeks(blockResult, raceDate, schedule, TODAY, purpose === 'race', {});
  return { a, blockResult, days, schedule };
}

/* THE RULE, WRITTEN OUT INDEPENDENTLY OF THE APP, so the suite does not only
   ask the generator whether it agrees with itself. */
function independentBreaks(r, o){
  const D = s => Date.parse(s + 'T00:00:00Z') / 864e5;
  const hist = [];
  if (o.long > 0) hist.push([D(o.longDate || '2026-11-06'), o.long]);
  if (o.logKm > 0){
    const n = Math.max(2, Math.min(o.days, 5)), km = Math.round(o.logKm / n * 10) / 10;
    for (let w = 1; w <= 4; w++) for (let k = 0; k < n; k++) hist.push([D(TODAY) - 7 * w + k, km]);
  }
  const ds = r.days.filter(d => d.km > 0 && d.type !== 'rest').sort((x, y) => x.date < y.date ? -1 : 1);
  const longMax = Math.max(0, ...ds.filter(d => d.type === 'long').map(d => d.km));
  const firstWeek = Math.min(...r.days.map(d => d.week));
  const hm = (o.purpose || 'race') === 'race' && (o.dist === 'half' || o.dist === 'full');
  const out = [];
  ds.forEach(d => {
    const t = D(d.date);
    if (d.type !== 'race'){
      const prior = hist.filter(h => h[0] >= t - 30 && h[0] < t).map(h => h[1]);
      if (prior.length && d.km > 5){
        const m = Math.max(...prior);
        let lim = Math.max(m * 1.1, m + 1);
        if (d.type === 'long' && hm && d.week !== firstWeek) lim = Math.max(m * 1.15, m + 1.5);
        const exempt = o.dist === 'full' && (o.purpose || 'race') === 'race' && d.type === 'long' && d.km === longMax;
        if (!exempt && d.km > lim + 1e-9) out.push(d.week + ' ' + d.type + ' ' + d.km + 'km over ' + Math.round(lim * 10) / 10 + ' (from ' + m + ')');
      }
    }
    hist.push([t, d.km]);
  });
  return out;
}

function rng(seed){ return function(){ seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

test('1 + 9. about 300 possible athletes across the five programmes: no run over the limit, in any week', () => {
  const PROGS = [['base', '10k'], ['race', '5k'], ['race', '10k'], ['race', 'half'], ['race', 'full']];
  const LONGS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 30, 32];
  let built = 0;
  const breaks = [];
  PROGS.forEach(([purpose, dist], pi) => {
    const r = rng(0x6A11 + pi * 104729);
    let made = 0, guard = 0;
    while (made < 60 && guard++ < 2000){
      const days = 3 + Math.floor(r() * 4);
      const weekly = Math.round(r() * 90);
      const long = LONGS[Math.floor(r() * LONGS.length)];
      /* POSSIBLE answers only: a longest run given, and no more running a
         week than that run on every running day. */
      if (!(long > 0) || weekly > long * days) continue;
      const exp = ['novice', 'experienced', 'advanced'][Math.floor(r() * 3)];
      const hr = r();
      const logKm = hr < 0.6 ? 0 : Math.round(weekly * (0.4 + r() * 0.9));
      const o = { purpose, dist, weekly, days, avail: Math.min(6, days + Math.floor(r() * 2)), long, exp, logKm,
                  weeks: purpose === 'base' ? 8 + Math.floor(r() * 9) : (dist === 'full' ? 12 + Math.floor(r() * 5) : dist === 'half' ? 10 + Math.floor(r() * 6) : 8 + Math.floor(r() * 5)) };
      made++;
      let res;
      try { res = build(o); } catch(e){ breaks.push(dist + ' ' + JSON.stringify(o) + ' threw ' + e.message); continue; }
      built++;
      assert.equal((res.blockResult.runLimitViolations || []).length, 0, dist + ': the generator\'s own final check found ' +
        JSON.stringify(res.blockResult.runLimitViolations));
      const own = res.a.planRunLimitViolations(res.days, { weeks: res.blockResult.weeks, blockResult: res.blockResult, schedule: res.schedule });
      own.forEach(v => breaks.push(dist + ' ' + JSON.stringify(o) + ': ' + v.reason));
      independentBreaks(res, o).forEach(b => breaks.push(dist + ' ' + JSON.stringify(o) + ': week ' + b));
      (res.a.planVolumeAccounting || []).forEach(acc => {
        if (!acc.reconciled) breaks.push(dist + ' ' + JSON.stringify(o) + ': week ' + acc.week + ' does not reconcile');
      });
    }
  });
  assert.ok(built >= 290, 'only ' + built + ' athletes built');
  assert.deepEqual(breaks.slice(0, 12), [], breaks.length + ' breaks');
});

test('2. a Half or Marathon easy run obeys the limit too: 35km on two days with a 14km longest run', () => {
  ['half', 'full'].forEach(dist => {
    const o = { dist, weekly: 35, days: 2, avail: 2, long: 14, exp: 'experienced', weeks: 14 };
    const r = build(o);
    const W = byWeek(r.days);
    /* The first run of the plan is measured against the 14km stated run
       (15.4km at most, written 15); the long run after it against that 15. */
    const first = runsOf(W[1]).sort((x, y) => x.date < y.date ? -1 : 1);
    assert.ok(first[0].km <= 15, dist + ': a ' + first[0].km + 'km ' + first[0].type + ' run opens the plan against a 14km longest run');
    assert.ok(first[1].km <= Math.max(first[0].km, 14) * 1.1 + 1e-9, dist + ': then a ' + first[1].km + 'km ' + first[1].type + ' run');
    /* What two days cannot hold is named on the week, never written oversized. */
    const wk1 = r.blockResult.weeks[0];
    const placed = totOf(W[1]);
    assert.ok(placed < 35, dist + ': week one wrote ' + placed + 'km on two days');
    assert.equal(independentBreaks(r, o).length, 0, dist + ': ' + independentBreaks(r, o)[0]);
    (r.a.planVolumeAccounting || []).forEach(acc => assert.ok(acc.reconciled, dist + ' week ' + acc.week + ' does not reconcile'));
    assert.ok(wk1.runLimitHeldKm > 0 || wk1.longRunStepDroppedKm > 0, dist + ': the kilometres two days cannot hold are named');
  });
  /* With more days offered, the kilometres go to them first. */
  const more = build({ dist: 'half', weekly: 35, days: 2, avail: 4, long: 14, exp: 'experienced', weeks: 14 });
  const moreW1 = runsOf(byWeek(more.days)[1]);
  assert.ok(moreW1.length >= 3, 'four days offered and week one still runs on ' + moreW1.length);
  assert.equal(independentBreaks(more, { dist: 'half', weekly: 35, days: 2, long: 14 }).length, 0);
});

test('3. the threshold test: the 30 minutes stay, the warm-up and cool-down shorten, or the test waits', () => {
  const a = app();
  assert.equal(a.calibrationKmFor(12, 10), 9.5, 'the full protocol is 52 minutes, 9.5km at the pricing pace');
  assert.equal(a.calibrationKmFor(8, 5), 7.8, 'the shortest is 43 minutes, 7.8km');
  const fl = a.calibrationFlanksFor(8.8);
  assert.ok(fl && fl.km <= 8.8 && fl.warmupMin >= 8 && fl.cooldownMin >= 5, JSON.stringify(fl));
  assert.ok(fl.cooldownMin < 10, 'the cool-down gives way first');
  assert.equal(a.calibrationFlanksFor(7.5), null, 'under 7.8km the test cannot be written');
  /* The text says the minutes it asks for, and the test itself is unchanged. */
  const t = a.thresholdCalibrationText(9, 5);
  assert.match(t.desc, /^9 min easy warm-up, then ONE continuous 30-minute time trial/);
  assert.match(t.desc, /5 min easy cool-down/);
  /* In a plan: a 10K runner whose longest run is 7km. */
  const o = { dist: '10k', weekly: 21, days: 3, avail: 3, long: 7, exp: 'experienced', weeks: 10 };
  const r = build(o);
  const cal = r.days.filter(d => d.type === 'calibration');
  assert.equal(independentBreaks(r, o).length, 0, independentBreaks(r, o)[0]);
  cal.forEach(d => {
    const p = d.prescription.params;
    assert.equal(p.settleMin + p.measuredMin, 30, 'the test is always 30 minutes');
    assert.ok(p.warmupMin >= 8 && p.cooldownMin >= 5, JSON.stringify(p));
    assert.ok(new RegExp('^' + p.warmupMin + ' min easy warm-up').test(d.desc), d.desc);
    assert.ok(d.desc.indexOf(p.cooldownMin + ' min easy cool-down') !== -1, d.desc);
  });
  /* A test that cannot fit in week one waits for a week where it does. */
  const w = build({ dist: '10k', weekly: 15, days: 3, avail: 3, long: 5, exp: 'experienced', weeks: 10 });
  const wcal = w.days.filter(d => d.type === 'calibration');
  wcal.forEach(d => assert.ok(d.week > 1, 'a calibration in week ' + d.week + ' after a 5km longest run'));
  assert.equal(independentBreaks(w, { dist: '10k', weekly: 15, days: 3, long: 5 }).length, 0);
});

test('3. a Fitness Checkpoint keeps its time trial; its flanks shorten or it waits', () => {
  const a = app();
  const cf = a.checkpointFlanksFor(5, 2, 2, 8);
  assert.ok(cf && cf.km <= 8 && cf.wuKm >= 1.5 && cf.cdKm >= 1, JSON.stringify(cf));
  assert.equal(a.checkpointFlanksFor(5, 2, 2, 7), null, 'a 5km trial needs at least 7.5km with its shortest flanks');
  const tt = a.timeTrialText(5, 1.5, 1);
  assert.match(tt.desc, /1\.5@@ warm-up, @@D:5@@ at hard, honest effort, @@D:1@@ cool-down/);
  const segs = a.segmentsFor({ archetype: 'time_trial', params: { ttKm: 5, flankKm: 1.5, cooldownKm: 1 } });
  assert.equal(Math.round(segs.reduce((t, g) => t + g.km, 0) * 10) / 10, 7.5);
});

test('4. a low starter opens on 5 + 5 + 5 and climbs a kilometre at a time', () => {
  const a0 = app();
  assert.equal(a0.LOW_START_WEEK_KM, 15);
  assert.equal(a0.LOW_START_LONG_KM, 5);
  [['race', '5k'], ['race', '10k'], ['race', 'half'], ['race', 'full'], ['base', '10k']].forEach(([purpose, dist]) => {
    const o = { purpose, dist, weekly: 2, days: 3, avail: 3, long: 3, exp: 'novice', weeks: 12 };
    const r = build(o);
    const W = byWeek(r.days);
    const w1 = runsOf(W[1]).map(d => d.km).sort();
    assert.deepEqual(w1, [5, 5, 5], purpose + ' ' + dist + ': week one is ' + w1.join(' + '));
    assert.equal(independentBreaks(r, o).length, 0, purpose + ' ' + dist + ': ' + independentBreaks(r, o)[0]);
    (r.a.planVolumeAccounting || []).filter(x => x.week <= 4).forEach(x =>
      assert.ok(x.reconciled, purpose + ' ' + dist + ' week ' + x.week + ' carries kilometres nobody named'));
  });
});

test('5. Half and Marathon: no catch-up weeks, every ordinary step at most 8%', () => {
  [['full', 'experienced', 40, 16, 16], ['full', 'novice', 30, 14, 16], ['half', 'experienced', 35, 14, 14], ['half', 'advanced', 50, 18, 12]].forEach(([dist, exp, weekly, long, weeks]) => {
    const r = build({ dist, weekly, days: 5, avail: 5, long, exp, weeks });
    const W = byWeek(r.days), wks = r.blockResult.weeks;
    let lastFull = null, prev = null;
    wks.forEach(wk => {
      const list = W[wk.week] || [];
      if (!list.length || wk.isTaper || wk.isRace || list.some(d => d.type === 'race')){ prev = null; return; }
      if (wk.isCutback){ prev = { lighter: true }; return; }
      const ref = prev && prev.lighter ? lastFull : prev;
      const km = totOf(list), n = runsOf(list).length;
      if (ref && list.length === 7){
        const cap = Math.max(ref.km * 1.08, n > ref.runs ? ref.km + 5 : 0);
        assert.ok(km <= cap + 1e-9, dist + ' ' + exp + ' week ' + wk.week + ': ' + km + 'km after ' + ref.km);
      }
      prev = lastFull = { km: list.length === 7 ? km : Math.max(km, wk.volume), runs: n };
    });
  });
  /* More than 10% short of the destination is the Preparation offer, asked
     before anything is written; within 10% the peak is simply lower. */
  const a = app();
  const src = fs.readFileSync(path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  assert.match(src, /climbShort = steadyClimbShortfall\(days, blockResult\.weeks, blockResult\)/);
  const weeks = [{ week: 1 }, { week: 2 }, { week: 3, isTaper: true }];
  const mk = (w, km, type) => ({ week: w, date: '2026-11-1' + w, type: type || 'easy', km });
  const blk = { purpose: 'race', distKey: 'full', experience: 'experienced' };
  const short = a.steadyClimbShortfall([mk(1, 40), mk(1, 30, 'long'), mk(2, 41), mk(2, 30, 'long')], weeks, blk);
  assert.ok(short && short.verdict === 'INSUFFICIENT', 'a 71km peak against 80 is more than 10% short');
  assert.equal(short.dimensions.find(d => d.key === 'workload').met, false);
  assert.equal(a.steadyClimbShortfall([mk(1, 45), mk(1, 30, 'long'), mk(2, 44), mk(2, 30, 'long')], weeks, blk), null,
    'a 75km peak against 80 is within 10%: it simply peaks lower');
  const lowLong = a.steadyClimbShortfall([mk(1, 52), mk(1, 28, 'long')], weeks, blk);
  assert.ok(lowLong && lowLong.dimensions.find(d => d.key === 'durability').met === false, 'a 28km peak long run against 30');
});

test('6. 5K and 10K open on the runner\'s current week and long run, and settle the long run into the range', () => {
  [['5k', 'experienced', 69, 16, 5, 12], ['10k', 'novice', 45, 18, 4, 12]].forEach(([dist, exp, weekly, long, days, top]) => {
    const o = { dist, weekly, days, avail: days, long, exp, weeks: 12 };
    const r = build(o);
    const W = byWeek(r.days), wks = r.blockResult.weeks;
    assert.ok(Math.abs(totOf(W[1]) - weekly) <= 1, dist + ': week one is ' + totOf(W[1]) + 'km against ' + weekly);
    const longOf = w => Math.max(0, ...runsOf(W[w] || []).filter(d => d.type === 'long').map(d => d.km));
    assert.equal(longOf(1), long, dist + ': week one\'s long run is the athlete\'s own');
    assert.equal(wks[0].longRunSettling, true, dist + ': the settling week is flagged');
    let prev = longOf(1), settled = false;
    wks.forEach(wk => {
      if (wk.isTaper || wk.isRace || !W[wk.week]) return;
      const l = longOf(wk.week);
      if (wk.longRunSettling){
        assert.ok(!settled, dist + ': settling resumed in week ' + wk.week);
        assert.ok(l <= prev + 1e-9 && l >= Math.floor(prev * 0.8), dist + ' week ' + wk.week + ': ' + l + 'km after ' + prev);
      } else {
        settled = true;
        assert.ok(l <= top + 1e-9, dist + ' week ' + wk.week + ': a ' + l + 'km long run after settling, range top ' + top);
      }
      prev = l;
    });
    assert.ok(wks.filter(w => w.longRunSettling).length <= 4, dist + ': settling takes ' + wks.filter(w => w.longRunSettling).length + ' weeks');
    assert.equal(independentBreaks(r, o).length, 0, dist + ': ' + independentBreaks(r, o)[0]);
    (r.a.planVolumeAccounting || []).forEach(acc => assert.ok(acc.reconciled, dist + ' week ' + acc.week + ' does not reconcile'));
  });
});

test('7. A12: the Marathon long run climbs earlier and reaches the level\'s target', () => {
  [['novice', 62, 16, 28], ['experienced', 75, 18, 30]].forEach(([exp, weekly, long, target]) => {
    const o = { dist: 'full', weekly, days: 5, avail: 5, long, exp, weeks: 18 };
    const r = build(o);
    const peak = Math.max(...r.days.filter(d => d.type === 'long').map(d => d.km));
    assert.ok(peak >= target, exp + ': the peak long run is ' + peak + 'km against ' + target);
    assert.equal(independentBreaks(r, o).length, 0, exp + ': ' + independentBreaks(r, o)[0]);
  });
});

test('8. A14: every 5K and 10K taper week keeps a short sharpening session', () => {
  [['5k', 'novice', 26, 10, 5, 12], ['5k', 'advanced', 17, 10, 3, 9], ['10k', 'experienced', 30, 12, 4, 10]].forEach(([dist, exp, weekly, long, days, weeks]) => {
    const r = build({ dist, weekly, days, avail: days, long, exp, weeks });
    const W = byWeek(r.days);
    r.blockResult.weeks.filter(wk => wk.isTaper && !wk.isRace && W[wk.week] && !W[wk.week].some(d => d.type === 'race')).forEach(wk => {
      assert.ok(W[wk.week].some(d => QUALITY.indexOf(d.type) !== -1 && d.km > 0),
        dist + ' ' + exp + ' taper week ' + wk.week + ' has no quality: ' + runsOf(W[wk.week]).map(d => d.type + ' ' + d.km).join(', '));
    });
  });
});

test('9. the validator names a run over the line, with the reason, and leaves exempt runs alone', () => {
  const a = app();
  a.pendingEntryEvidence = { weeklyKm: 30, runDaysPerWeek: 4, longestRunKm: 12, longestRunDate: '2026-11-10', recordedAt: TODAY + 'T09:00:00Z' };
  const weeks = [{ week: 1, longTarget: 13 }, { week: 2, longTarget: 20 }, { week: 3, isRace: true }];
  const blk = { purpose: 'race', distKey: '10k' };
  const days = [
    { date: '2026-11-17', week: 1, type: 'easy', km: 13.5 },
    { date: '2026-11-22', week: 1, type: 'long', km: 13 },
    { date: '2026-11-24', week: 2, type: 'easy', km: 5 },
    { date: '2026-11-29', week: 2, type: 'long', km: 16 },
    { date: '2026-12-06', week: 3, type: 'race', km: 42.2 }
  ];
  const v = a.planRunLimitViolations(days, { weeks, blockResult: blk });
  assert.equal(v.length, 2, JSON.stringify(v));
  assert.equal(v[0].date, '2026-11-17');
  assert.equal(v[0].limitKm, 13.2);
  assert.match(v[0].reason, /13\.5km easy run in week 1 is over the 13\.2km limit set by a 12km run/);
  assert.equal(v[1].type, 'long');
  /* A Half's long run from week two steps at 15% (Option A), a 10K's at 10%;
     the race is exempt. With nothing stated or logged, week one is the
     reference rather than measured. */
  a.pendingEntryEvidence = null;
  const step = [{ date: '2026-11-22', week: 1, type: 'long', km: 20 }, { date: '2026-11-29', week: 2, type: 'long', km: 23 },
                { date: '2026-12-06', week: 3, type: 'race', km: 42.2 }];
  assert.equal(a.planRunLimitViolations(step, { weeks, blockResult: { purpose: 'race', distKey: 'half' } }).length, 0);
  assert.equal(a.planRunLimitViolations(step, { weeks, blockResult: blk }).length, 1);
  a.pendingEntryEvidence = { weeklyKm: 30, runDaysPerWeek: 4, longestRunKm: 12, longestRunDate: '2026-11-10', recordedAt: TODAY + 'T09:00:00Z' };
  /* The Marathon's culminating long run is exempt. */
  const full = [{ date: '2026-11-22', week: 1, type: 'long', km: 13 }, { date: '2026-11-29', week: 2, type: 'long', km: 20 }];
  assert.equal(a.planRunLimitViolations(full, { weeks, blockResult: { purpose: 'race', distKey: 'full' } }).length, 0);
  /* And a run of 5km never counts. */
  a.pendingEntryEvidence = { weeklyKm: 4, runDaysPerWeek: 2, longestRunKm: 2, longestRunDate: '2026-11-10', recordedAt: TODAY + 'T09:00:00Z' };
  assert.equal(a.planRunLimitViolations([{ date: '2026-11-17', week: 1, type: 'easy', km: 5 }], { weeks, blockResult: blk }).length, 0);
});

/* WEEK 1 RESPECTS THE LIMIT EVEN WHEN THE STATED RUN IS OLDER THAN 30 DAYS
   (founder, 18 November 2026). The audit's second population found a runner
   who said 13km, dated six weeks back, opening on a 23km long run: outside
   the window the stated run counted for nothing and week 1 went unchecked. */
test('10. a stated longest run older than the window still bounds week 1', () => {
  /* The audit's own cases: 71km on 6 days, 13km longest dated 146 days back;
     57km on 5 days, 17km dated 105 days back; 25km on 7 days, 7km 67 days back. */
  for (const [dist, purpose, weekly, days, long, longDate] of [['half', 'base', 71, 6, 13, '2026-06-23'], ['half', 'base', 57, 5, 17, '2026-08-03'],
       ['5k', 'race', 25, 5, 7, '2026-09-10'], ['half', 'race', 50, 5, 13, '2026-10-06']]){
    const o = { dist, purpose, weekly, days, long, longDate, weeks: 12 };
    const r = build(o);
    const w1 = Math.min(...r.days.map(d => d.week));
    const top = Math.max(...r.days.filter(d => d.week === w1 && d.type !== 'race').map(d => d.km));
    assert.ok(top <= Math.max(long * 1.1, long + 1) + 1e-9, dist + ' ' + purpose + ': week 1 has a ' + top + 'km run against a stated ' + long + 'km');
  }
});
