'use strict';
/* METHODOLOGY BATCH 5, THE PLAN GENERATOR (founder decisions on Audit IV).
 *
 *  1  After a lighter week, back to the week before it: "Return to the same
 *     as the week before deload. Example. Week 1 - 50, Week 2 - 53, Week 3 -
 *     56, Week 4 - 39, Week 5 - 56. As you say if needed it could have the 8%
 *     as a safety net if needed in some programs." The week after a lighter
 *     week never passes the last full week + 8%, and the week after that
 *     never passes it + 8% either (one 5km run where a run joins).
 *  2  Low starters (0 to 4km a week): no Threshold Calibration in weeks 1 to 3.
 *  3  5K and 10K long runs stay within the level's long-run range.
 *  4  Half and Marathon: at or above the destination the week holds and the
 *     overload moves into the sessions; never more than 5% over.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

function app(){
  const a = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  return a;
}
const runsOf = list => list.filter(d => d.km > 0 && d.type !== 'rest' && d.type !== 'race');
const totOf = list => Math.round(runsOf(list).reduce((t, d) => t + d.km, 0) * 10) / 10;
const byWeek = days => days.reduce((m, d) => { (m[d.week] = m[d.week] || []).push(d); return m; }, {});
const isTest = list => list.some(d => d.type === 'calibration' || d.type === 'checkpoint');

/* Every week after a lighter week, against the last full week before it, and
   the week after that against the returned week. A test week keeps its test
   whole, so it is reported rather than held (none in these fixtures). */
function returns(weeks, days){
  const W = byWeek(days), out = [];
  let lastFull = null, pending = null;
  weeks.forEach((wk, i) => {
    const list = W[wk.week] || [];
    if (wk.isTaper || wk.isRace || !list.length){ pending = null; return; }
    if (wk.isCutback){ if (pending == null && lastFull) pending = lastFull; return; }
    if (pending){
      const next = weeks[i + 1], nList = next && W[next.week];
      out.push({ week: wk.week, last: pending, km: totOf(list), runs: runsOf(list).length, test: isTest(list),
                 next: (next && !next.isCutback && !next.isTaper && !next.isRace && nList) ?
                   { km: totOf(nList), runs: runsOf(nList).length, test: isTest(nList) } : null });
      pending = null;
    }
    lastFull = { km: totOf(list), runs: runsOf(list).length };
  });
  return out;
}
const limit = (fromKm, fromRuns, runs) => Math.max(fromKm * 1.08, runs > fromRuns ? fromKm + 5 : 0) + 0.5;

test('1. the week after a lighter week is never above the last full week + 8%, nor is the week after it', () => {
  [['full', 'experienced', 50], ['half', 'advanced', 50], ['10k', 'advanced', 35], ['5k', 'experienced', 20]].forEach(([dk, exp, vol]) => {
    const a = app();
    const { blockResult } = buildPlan(a, { distanceKey: dk, volume: vol, weeks: 12, experience: exp, startDate: '2026-11-16' });
    const r = returns(blockResult.weeks, a.state.days);
    assert.ok(r.length >= 1, dk + ': the fixture has no lighter week');
    r.forEach(x => {
      if (x.test) return;
      assert.ok(x.km <= limit(x.last.km, x.last.runs, x.runs),
        dk + ' ' + exp + ' ' + vol + 'km, week ' + x.week + ': ' + x.km + 'km after a last full week of ' + x.last.km);
      if (x.next && !x.next.test)
        assert.ok(x.next.km <= limit(x.km, x.runs, x.next.runs),
          dk + ' ' + exp + ' ' + vol + 'km, week ' + (x.week + 1) + ': ' + x.next.km + 'km after the returned ' + x.km);
    });
  });
});

test('1. Aerobic Base comes back to the week before the lighter week, then climbs at the ordinary step', () => {
  /* The founder's own shape: 50, 53, 56, 39, 56. */
  const a = app();
  a.state.experience = 'experienced';
  const blk = a.buildBlockWeeks('10k', 30, 12, { purpose: 'base', availableDays: 5 });
  const days = a.buildDaysFromWeeks(blk, '', { activeDays: [0, 1, 3, 4, 6], longRunDay: 6 }, '2026-11-16', false, {});
  const W = byWeek(days);
  assert.ok(blk.weeks[3].isCutback, 'week 4 is the lighter week');
  const w3 = totOf(W[3]), w5 = totOf(W[5]), w6 = totOf(W[6]);
  assert.ok(Math.abs(w5 - w3) <= 0.5, 'week 5 is ' + w5 + 'km against ' + w3 + ' before the lighter week');
  assert.ok(w6 <= w5 * 1.08 + 0.5, 'week 6 jumps to ' + w6 + 'km from ' + w5);
  /* Every kilometre held is named on the week. */
  assert.equal(blk.weeks[4].reshapeCause, 'return_after_lighter');
  (a.planVolumeAccounting || []).forEach(acc => assert.ok(acc.reconciled, 'week ' + acc.week + ' does not reconcile'));
});

test('1. the taper is still never bigger than the week before it, and the lighter weeks stay lighter', () => {
  ['half', 'full'].forEach(dk => {
    const a = app();
    const { blockResult } = buildPlan(a, { distanceKey: dk, volume: 35, weeks: 14, experience: 'experienced', startDate: '2026-11-16' });
    const W = byWeek(a.state.days);
    blockResult.weeks.forEach((wk, i) => {
      if (!i || !W[wk.week] || !W[blockResult.weeks[i - 1].week]) return;
      const prev = totOf(W[blockResult.weeks[i - 1].week]), now = totOf(W[wk.week]);
      if (wk.isTaper && !wk.isRace) assert.ok(now <= prev + 1e-9, dk + ' taper week ' + wk.week + ': ' + now + ' after ' + prev);
      if (wk.isCutback && !wk.isTaper) assert.ok(now < prev, dk + ' lighter week ' + wk.week + ': ' + now + ' after ' + prev);
    });
  });
});

test('2. a 0 to 4km starter meets no Threshold Calibration before week 4, in Aerobic Base or a race', () => {
  [['base', '10k'], ['race', 'half'], ['race', '5k']].forEach(([purpose, dk]) => {
    const a = app();
    a.pendingEntryEvidence = { weeklyKm: 2, runDaysPerWeek: 2, recordedAt: '2026-11-16T09:00:00Z' };
    const blk = a.buildBlockWeeks(dk, 17, 12, { purpose, availableDays: 4, calibrate: true });
    const cal = blk.weeks.filter(w => w.isCalibration).map(w => w.week);
    cal.forEach(w => assert.ok(w >= 4, purpose + ' ' + dk + ': a Threshold Calibration in week ' + w));
    if (purpose === 'base') assert.ok(cal.length && cal[0] <= 6, 'the calibration was dropped rather than moved: ' + cal);
  });
  /* And the 17km three-run start is kept. */
  const a = app();
  a.pendingEntryEvidence = { weeklyKm: 2, runDaysPerWeek: 2, recordedAt: '2026-11-16T09:00:00Z' };
  assert.equal(a.statedEntryEvidence().weeklyKm, a.LOW_START_WEEK_KM);
  /* An athlete who is not a low starter still opens on the test. */
  const b = app();
  const blk = b.buildBlockWeeks('10k', 30, 12, { purpose: 'base', availableDays: 4, calibrate: true });
  assert.equal(blk.weeks[0].isCalibration, true);
});

test('3. a 5K or 10K long run stays inside the level\'s range, whatever longest run was stated', () => {
  [['5k', 'experienced', 12], ['10k', 'novice', 12], ['10k', 'experienced', 15]].forEach(([dk, exp, top]) => {
    const a = app();
    a.pendingEntryEvidence = { weeklyKm: 50, runDaysPerWeek: 5, longestRunKm: 18, longestRunDate: '2026-11-10',
                               recordedAt: '2026-11-16T09:00:00Z' };
    assert.equal(a.raceGoalLongCapKm(dk, 'race', exp), top, dk + ' ' + exp + ': the cap is the range top');
    buildPlan(a, { distanceKey: dk, volume: 50, weeks: 12, experience: exp, startDate: '2026-11-16' });
    a.state.days.filter(d => d.type === 'long').forEach(d =>
      assert.ok(d.km <= top + 1e-9, dk + ' ' + exp + ' week ' + d.week + ': a ' + d.km + 'km long run, range top ' + top));
  });
});

test('4. at or above the destination a Half or Marathon week holds, never more than 5% over it', () => {
  [['half', 'experienced', 70], ['full', 'experienced', 90]].forEach(([dk, exp, vol]) => {
    const a = app();
    const { blockResult } = buildPlan(a, { distanceKey: dk, volume: vol, weeks: 14, experience: exp, startDate: '2026-11-16' });
    assert.equal(blockResult.holdAtOwnWeek, true, dk + ': the hold was not decided');
    assert.equal(blockResult.peakCapBy, 'own_week');
    assert.equal(blockResult.peakCapKm, vol, dk + ': the cap is the athlete\'s own week, not a step above it');
    const W = byWeek(a.state.days);
    blockResult.weeks.forEach(wk => {
      if (wk.isRace || !W[wk.week]) return;
      assert.ok(totOf(W[wk.week]) <= vol * 1.05 + 0.5, dk + ' week ' + wk.week + ': ' + totOf(W[wk.week]) + 'km against ' + vol);
    });
  });
});

test('4. below the destination a Half never peaks more than 5% over it, even with a long run held long', () => {
  const a = app();
  a.pendingEntryEvidence = { weeklyKm: 32, runDaysPerWeek: 6, longestRunKm: 26, longestRunDate: '2026-11-10',
                             recordedAt: '2026-11-16T09:00:00Z' };
  const { blockResult } = buildPlan(a, { distanceKey: 'half', volume: 32, weeks: 11, experience: 'novice', startDate: '2026-11-16',
                                         schedule: { activeDays: [0, 1, 2, 3, 4, 5], longRunDay: 5 } });
  const dest = a.raceGoalPathway('half', 'novice').peakVolumeKm;
  const W = byWeek(a.state.days);
  blockResult.weeks.forEach(wk => {
    if (wk.isRace || !W[wk.week]) return;
    assert.ok(totOf(W[wk.week]) <= dest * 1.05 + 0.5,
      'week ' + wk.week + ': ' + totOf(W[wk.week]) + 'km against a destination of ' + dest);
  });
});

test('4. the held block moves its overload into the long run\'s goal-pace work', () => {
  const gp = gain => {
    const a = app();
    if (gain != null) a.AT_DESTINATION_SPECIFICITY_GAIN = gain;
    buildPlan(a, { distanceKey: 'half', volume: 70, weeks: 14, experience: 'experienced', startDate: '2026-11-16' });
    return a.state.days.filter(d => d.type === 'long' && d.prescription && d.prescription.params).reduce((t, d) => {
      const q = d.prescription.params;
      return t + (q.insertKm || 0) + (q.finishKm || 0) + (q.gpKm || 0) + (q.segments || 0) * (q.segKm || 0);
    }, 0);
  };
  const held = gp(null), plain = gp(1);
  assert.ok(held > plain + 1, 'goal-pace work in the long runs: ' + held + 'km held against ' + plain + 'km');
});

test('every rule is deterministic: the same inputs build the same plan', () => {
  const once = () => {
    const a = app();
    buildPlan(a, { distanceKey: 'full', volume: 50, weeks: 12, experience: 'experienced', startDate: '2026-11-16' });
    return JSON.stringify(a.state.days.map(d => [d.date, d.type, d.km, d.title]));
  };
  assert.equal(once(), once());
});
