'use strict';
/* T1/T2 (founder, 16 November 2026: "Use them"). The builder asks every
   athlete how many days they run and their longest recent run. A race block
   always read the two answers; Base, Maintain and Speed now read them too:
   the block opens on the stated days and the stated long run.

   The rules that do not move: no run under 5km, the long run is the longest
   run, every kilometre has a named cause, and no answer means the block is
   built exactly as it was. */
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./harness.js');

const TODAY = '2026-11-16';
const SCHED = { activeDays: [0, 1, 2, 3, 4, 6], longRunDay: 6 };

function build(purpose, dk, vol, ev, opts){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  a.state = a.makeDefaultState();
  a.state.setup = Object.assign(a.state.setup || {}, { distanceKey: dk, currentVolume: vol, planWeeks: 12,
    purpose, schedule: SCHED, experience: 'established' });
  a.pendingEntryEvidence = ev ? Object.assign({ weeklyKm: vol, recordedAt: TODAY + 'T09:00:00Z' }, ev) : null;
  const blk = a.buildBlockWeeks(dk, vol, 12, Object.assign({ purpose, availableDays: SCHED.activeDays.length }, opts || {}));
  const days = a.buildDaysFromWeeks(blk, a.addDays(TODAY, 12 * 7 - 1), SCHED, TODAY, false);
  a.pendingEntryEvidence = null;
  return { a, blk, days };
}
const runs = (r, w) => r.days.filter(d => d.week === w && d.km > 0 && d.type !== 'rest');
const shape = (r, w) => runs(r, w).map(d => d.type + d.km).join(',');
const THREE = { runDaysPerWeek: 3, longestRunKm: 12, longestRunDate: '2026-11-08' };
const SIX = { runDaysPerWeek: 6, longestRunKm: 20, longestRunDate: '2026-11-08' };

function rulesHold(r, label){
  r.days.forEach(d => {
    /* The 5km rule is the easy and long runs' (A5); a race-week session and
       a shakeout keep their own sizes, as they do with nothing stated. */
    if (!(d.km > 0) || (d.type !== 'easy' && d.type !== 'long')) return;
    if (/Shakeout/.test(d.title || '')) return;
    assert.ok(d.km >= 5 - 1e-9, label + ': ' + d.date + ' ' + d.type + ' ' + d.km + 'km is under 5km');
  });
  const weeks = [...new Set(r.days.map(d => d.week))];
  weeks.forEach(w => {
    const list = runs(r, w);
    const long = list.filter(d => d.type === 'long').sort((x, y) => y.km - x.km)[0];
    if (!long) return;
    list.forEach(d => assert.ok(d.km <= long.km + 1e-9,
      label + ' week ' + w + ': ' + d.type + ' ' + d.km + 'km is longer than the ' + long.km + 'km long run'));
  });
  (r.a.planVolumeAccounting || []).forEach(acc =>
    assert.ok(acc.reconciled, label + ' week ' + acc.week + ' carries kilometres with no named cause'));
  assert.equal((r.a.planBuildNotes || []).length, 0, label + ': the week was cut and the athlete would be told to add days');
}

for (const purpose of ['base', 'maintain', 'speed']){
  test(purpose + ': no answer, no change (nothing stated is read)', () => {
    const r = build(purpose, 'half', 35, null);
    assert.equal(r.blk.entryOpening, null);
    r.blk.weeks.forEach(wk => {
      assert.equal(wk.entryLongFromKm, null, 'week ' + wk.week + ' moved its long run with nothing stated');
      if (wk.frequencyEvidence) assert.equal(wk.frequencyEvidence.stated, null);
    });
  });

  test(purpose + ': three days and a 12km long run open the block on three days and that long run', () => {
    const r = build(purpose, 'half', 35, THREE);
    assert.deepEqual({ days: r.blk.entryOpening.days, longKm: r.blk.entryOpening.longKm }, { days: 3, longKm: 12 });
    const w1 = runs(r, 1);
    /* Three days, unless the week cannot be carried on three runs no longer
       than the long run: then the day comes back rather than the week being
       cut (and the athlete told to add days they already gave). */
    const need = Math.ceil(r.blk.weeks[0].volume / 12 - 1e-9);
    assert.ok(w1.length >= 3 && w1.length <= Math.max(3, need) + 1, 'week one: ' + shape(r, 1));
    assert.ok(r.blk.weeks[0].runDayCap <= Math.max(3, need), 'week one day cap ' + r.blk.weeks[0].runDayCap);
    const long = w1.filter(d => d.type === 'long')[0];
    assert.ok(long && long.km >= 12, 'week one long run below the stated 12km: ' + shape(r, 1));
    rulesHold(r, purpose + ' 3d/12km');
  });

  test(purpose + ': the answers change week one (3 days / 12km against 6 days / 20km)', () => {
    const three = build(purpose, 'half', 35, THREE), six = build(purpose, 'half', 35, SIX);
    assert.notEqual(shape(three, 1), shape(six, 1));
    assert.ok(runs(three, 1).length < runs(six, 1).length,
      '3 days ' + shape(three, 1) + ' against 6 days ' + shape(six, 1));
    rulesHold(six, purpose + ' 6d/20km');
  });
}

test('the long run is held to 45% of the declared week and never under 5km', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.pendingEntryEvidence = { weeklyKm: 35, runDaysPerWeek: 6, longestRunKm: 20, longestRunDate: '2026-11-08', recordedAt: TODAY };
  assert.equal(a.nonRaceEntryOpening('base', 6).longKm, 15.8);
  a.pendingEntryEvidence = { weeklyKm: 8, runDaysPerWeek: 4, longestRunKm: 3, longestRunDate: '2026-11-08', recordedAt: TODAY };
  assert.equal(a.nonRaceEntryOpening('base', 6).longKm, 5);
  /* One or two days: the long run is most of the week by definition. */
  a.pendingEntryEvidence = { weeklyKm: 20, runDaysPerWeek: 2, longestRunKm: 12, longestRunDate: '2026-11-08', recordedAt: TODAY };
  assert.equal(a.nonRaceEntryOpening('maintain', 6).longKm, 12);
  /* And BASE_LONG_CAP_KM bounds it. */
  a.pendingEntryEvidence = { weeklyKm: 100, runDaysPerWeek: 6, longestRunKm: 40, longestRunDate: '2026-11-08', recordedAt: TODAY };
  assert.equal(a.nonRaceEntryOpening('speed', 6).longKm, a.BASE_LONG_CAP_KM);
});

test('a long run older than the evidence window is not read; the days still are', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.pendingEntryEvidence = { weeklyKm: 35, runDaysPerWeek: 4, longestRunKm: 14, longestRunDate: '2026-08-01', recordedAt: TODAY };
  const o = a.nonRaceEntryOpening('base', 6);
  assert.equal(o.longKm, null);
  assert.equal(o.days, 4);
});

test('a race block does not read this (it has its own entry state)', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.pendingEntryEvidence = { weeklyKm: 35, runDaysPerWeek: 3, longestRunKm: 12, longestRunDate: '2026-11-08', recordedAt: TODAY };
  assert.equal(a.nonRaceEntryOpening('race', 6), null);
});

test('stated days never exceed the days made available, and a day returns after each lighter week', () => {
  const r = build('maintain', 'half', 35, THREE);
  assert.ok(r.blk.entryOpening.days <= SCHED.activeDays.length);
  let lighter = 0, prevCap = null;
  r.blk.weeks.forEach(wk => {
    if (wk.isRace || wk.frequencyEvidence == null) return;
    if (wk.frequencyEvidence.stated != null)
      assert.ok(wk.frequencyEvidence.stated >= 3 + lighter, 'week ' + wk.week + ' stated cap ' + wk.frequencyEvidence.stated);
    if (wk.isCutback) lighter++;
    prevCap = wk.runDayCap;
  });
  assert.ok(lighter > 0, 'the block has a lighter week to grow after');
  assert.ok(prevCap > 3, 'the block ends on more days than it opened on');
});

test('a stated long run below the block\'s own grows to it at the long-run step', () => {
  const r = build('base', 'half', 40, { runDaysPerWeek: 6, longestRunKm: 6, longestRunDate: '2026-11-08' });
  const longs = r.blk.weeks.filter(wk => !wk.isRace && !wk.isTaper).map(wk => {
    const l = runs(r, wk.week).filter(d => d.type === 'long')[0];
    return l ? l.km : 0;
  });
  assert.ok(longs[0] < r.blk.weeks[0].entryLongFromKm,
    'week one opens below the block\'s own ' + r.blk.weeks[0].entryLongFromKm + 'km: ' + longs[0]);
  for (let i = 1; i < longs.length; i++){
    const prior = Math.max(6, ...longs.slice(Math.max(0, i - 4), i));
    assert.ok(longs[i] <= Math.round((prior * 1.1 + 1) * 10) / 10 + 0.5 + 1e-9,
      'week ' + (i + 1) + ' long run ' + longs[i] + 'km steps past the cap from ' + prior + 'km');
  }
  rulesHold(r, 'base 6d/6km');
});

test('the real builder path reads the answers for Base (handleGeneratePlan sets them before the block is built)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const gp = src.slice(src.indexOf('async function handleGeneratePlan'));
  const setAt = gp.indexOf('pendingEntryEvidence = readBuilderEntryEvidence()');
  const buildAt = gp.indexOf('buildBlockWeeks(distanceKey, volume, planWeeks');
  assert.ok(setAt > 0 && buildAt > setAt, 'the stated answers must be pending before buildBlockWeeks reads them');
  assert.ok(/nonRaceEntryOpening\(purpose, opts && opts.availableDays\)/.test(src));
});
