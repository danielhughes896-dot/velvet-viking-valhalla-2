'use strict';
/* Audit III, founder: "Go ahead, all of them in that order" -- L7, C1 with
   the run-join step (C4), C5, C2, C3. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');

function app(){
  const a = loadApp({ pinnedDate: '2026-11-16T08:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  return a;
}
function plan(a, o, ev){
  a.state = a.makeDefaultState();
  a.pendingEntryEvidence = ev || null;
  try { return buildPlan(a, Object.assign({ startDate: '2026-11-16', hasEvent: true,
    schedule: { activeDays: [0, 1, 3, 4, 6], longRunDay: 6 } }, o)); }
  finally { a.pendingEntryEvidence = null; }
}
const weekRuns = (r, w) => r.days.filter(d => d.week === w && d.km > 0 && d.type !== 'race');
const weekKm = (r, w) => weekRuns(r, w).reduce((t, d) => t + d.km, 0);
const longKm = (r, w) => Math.max(0, ...weekRuns(r, w).filter(d => d.type === 'long').map(d => d.km));
const ev = (km, days, longest) => Object.assign({ weeklyKm: km, runDaysPerWeek: days, recordedAt: '2026-11-16T08:00:00Z' },
  longest ? { longestRunKm: longest, longestRunDate: '2026-11-08' } : {});

/* ---- L7 ---- */
test('L7: a first-time athlete’s answer on an offer sheet builds from the builder it put away', () => {
  assert.match(SRC, /async function handleGeneratePlan\(\)\{\n  bldUnparkForBuild\(\);/,
    'Continue reads the builder’s fields, so the builder is put back first');
  const fn = SRC.slice(SRC.indexOf('function handleStartBlock('));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /if \(!planHasContent\(\) && purpose !== 'recovery' && bldUnparkForBuild\(\)\)\{\s*builderSwitchToPurpose\(purpose, weeks\);/,
    'Build Aerobic Base with no plan yet goes through the builder, not startDevelopmentBlock()');
  const a = app();
  const el = a.document.createElement ? a.document.createElement('div') : null;
  if (el){
    /* No plan, nothing parked: nothing to put back, and nothing breaks. */
    assert.equal(a.bldUnparkForBuild(), !!a.document.getElementById('su-distance'));
  }
});

/* ---- C1 ---- */
for (const [dk, longest] of [['5k', 18], ['10k', 22]]){
  test('C1: a 0 to 3km ' + dk + ' starter opens on the approved three runs, whatever longest run was typed', () => {
    const a = app();
    const r = plan(a, { distanceKey: dk, volume: 0, weeks: 12, experience: 'novice' }, ev(0, 5, longest));
    const w1 = weekRuns(r, 1).map(d => d.km).sort((x, y) => x - y);
    assert.equal(w1.length, 3, 'week one is ' + w1.join('+'));
    assert.ok(longKm(r, 1) <= 6, 'the long run is ' + longKm(r, 1));
    assert.ok(weekKm(r, 1) <= 17.5, 'week one is ' + weekKm(r, 1));
  });
}
test('C1: a stated long run is held to the share of the stated week', () => {
  const a = app();
  const r = plan(a, { distanceKey: '5k', volume: 20, weeks: 12, experience: 'novice' }, ev(20, 5, 22));
  assert.ok(longKm(r, 1) <= weekKm(r, 1) * 0.5, 'week one: long ' + longKm(r, 1) + ' of ' + weekKm(r, 1));
  assert.ok(longKm(r, 1) < 16, 'a typed 22km reached week one');
});

/* ---- C4: the run-join step ---- */
test('C4: a week a run joins may rise 25%, or by that one 5km run; the easy runs give way first', () => {
  const a = app();
  /* Full calendar weeks: a short first week is not a baseline. */
  const mk = (week, list) => { const l = list.slice(); while (l.length < 7) l.push(['rest', 0]);
    return l.map(([type, km], i) => ({ week, date: a.addDays('2026-11-16', (week - 1) * 7 + i), type, km, title: type, desc: '' })); };
  const days = mk(1, [['easy', 8], ['easy', 8], ['long', 10]]).concat(mk(2, [['easy', 10], ['easy', 10], ['easy', 6], ['long', 12]]));
  const weeks = [{ week: 1, volume: 26 }, { week: 2, volume: 38 }];
  a.applyRunJoinStep(days, weeks, { purpose: 'race', distKey: '10k' });
  const w2 = days.filter(d => d.week === 2 && d.km > 0).reduce((t, d) => t + d.km, 0);
  assert.ok(w2 <= 26 * 1.25 + 0.25, 'week two is ' + w2);
  assert.ok(days.every(d => d.type !== 'easy' || d.km >= 5), 'an easy run went under 5km');
  assert.equal(weeks[1].reshapeCause, 'run_join_step');
  assert.ok(weeks[1].runJoinHeldKm > 0, 'the held kilometres are not booked');
});

/* ---- C2 ---- */
test('C2: a recovery week is about a fifth lighter than the full week before it, never heavier', () => {
  const a = app();
  const r = plan(a, { distanceKey: 'half', volume: 50, weeks: 12, experience: 'experienced' });
  const W = r.blockResult.weeks;
  let seen = 0;
  W.forEach((m, i) => {
    if (!m.isCutback || m.isTaper || m.isRace) return;
    let j = i - 1; while (j >= 0 && W[j].isCutback) j--;
    if (j < 0) return;
    seen++;
    const share = weekKm(r, m.week) / weekKm(r, W[j].week);
    assert.ok(share >= 0.68 && share <= 0.90, 'recovery week ' + m.week + ' is ' + Math.round(share * 100) + '% of the full week before');
  });
  assert.ok(seen >= 2);
  /* The Half's own case: 29.5km after 50 before (59%). */
  assert.ok(weekKm(r, 4) >= 34.5, 'week 4 is ' + weekKm(r, 4));
});

/* ---- C5 ---- */
function baseDays(a, dk, vol, longest, weeks){
  a.state = a.makeDefaultState(); a.state.experience = 'advanced';
  a.pendingEntryEvidence = ev(vol, 6, longest);
  try {
    const br = a.buildBlockWeeks(dk, vol, weeks, { purpose: 'base' });
    const days = a.buildDaysFromWeeks(br, a.addDays('2026-11-16', weeks * 7 - 1), { activeDays: [0, 1, 2, 3, 4, 6], longRunDay: 6 }, '2026-11-16', false);
    return { br, days };
  } finally { a.pendingEntryEvidence = null; }
}
for (const [dk, vol, longest] of [['full', 120, 30], ['half', 90, 14], ['10k', 90, 14]]){
  test('C5: Aerobic Base (' + dk + ' ' + vol + 'km) holds 32km, steps 10%, and never lengthens the long run in a lighter week', () => {
    const a = app();
    const { br, days } = baseDays(a, dk, vol, longest, 12);
    const L = br.weeks.map(m => Math.max(0, ...days.filter(d => d.week === m.week && d.type === 'long').map(d => d.km)));
    L.forEach((km, i) => {
      assert.ok(km <= 32, 'week ' + br.weeks[i].week + ' long run ' + km);
      if (i && br.weeks[i].isCutback && L[i - 1] > 0) assert.ok(km <= L[i - 1], 'lighter week ' + br.weeks[i].week + ': ' + L[i - 1] + ' -> ' + km);
      const prior = Math.max(0, ...L.slice(Math.max(0, i - 4), i));
      if (i && prior > 0) assert.ok(km <= Math.max(Math.floor(prior * 1.10 + 1e-9), prior + 1), 'week ' + br.weeks[i].week + ' steps ' + prior + ' -> ' + km);
    });
  });
}

/* ---- C3 ---- */
for (const [lvl, vol, share] of [['novice', 35, 0.78], ['experienced', 50, 0.72], ['advanced', 65, 0.72]]){
  test('C3: the ' + lvl + ' Half’s last full week is a taper week (about 70% of peak)', () => {
    const a = app();
    const r = plan(a, { distanceKey: 'half', volume: vol, weeks: 14, experience: lvl });
    const W = r.blockResult.weeks;
    const ri = W.findIndex(m => m.isRace);
    const tw = W[ri - 1];
    const peak = Math.max(...W.filter(m => !m.isTaper && !m.isRace && !m.isCutback).map(m => weekKm(r, m.week)));
    assert.ok(tw.isTaper);
    assert.ok(weekKm(r, tw.week) <= peak * share, 'taper week ' + weekKm(r, tw.week) + ' of peak ' + peak);
    assert.ok(weekRuns(r, tw.week).some(d => !['easy', 'long'].includes(d.type)), 'the taper week lost its quality session');
  });
}
