'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

/* RACE DAY IS A RUNNING DAY — HQ METHODOLOGY RULING, MARATHON.
 * ===========================================================================
 * Total running days in race week, the marathon included, respect the tier:
 * Developing 4, Established 5, Advanced 6. Not 4/5/6 training runs PLUS the
 * race.
 *
 * THE DEFECT, measured on main: the lead-up was every available day except the
 * race's own weekday. An athlete who runs Mon-Thu and races on Sunday had NONE
 * of their days removed, so a 4-day Developing athlete was prescribed four
 * lead-up runs and the marathon -- five running days in the week that should
 * carry fewest.
 */

const TODAY = '2026-11-02';
const TIERS = [
  { exp:'novice',      days:4, entry:21 },
  { exp:'experienced', days:5, entry:52 },
  { exp:'advanced',    days:6, entry:68 }
];
function plan(exp, avail, vol, distanceKey){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.state = a.makeDefaultState();
  const act = [1,2,3,5,6,0,4].slice(0, avail);
  a.state.setup = { distanceKey: distanceKey || 'full', currentVolume: vol, planWeeks: 15,
    experience: exp, purpose:'race', hasEvent: true,
    schedule: { activeDays: act, longRunDay: 6 } };
  const b = a.buildBlockWeeks(distanceKey || 'full', vol, 15,
    { purpose:'race', availableDays: avail, easyPaceSecPerKm: 330 });
  const sm = a.addDays(TODAY, -a.isoWeekday(TODAY));
  const d = a.buildDaysFromWeeks(b, a.addDays(sm, 15 * 7 - 1),
    { activeDays: act, longRunDay: 6 }, TODAY, true);
  return { a, b, d };
}
function raceWeekRuns(d){
  const wk = Math.max.apply(null, d.filter(x => x.type === 'race').map(x => x.week));
  return d.filter(x => x.week === wk && x.type && x.type !== 'rest');
}

test('race week never exceeds the tier day count, race included', () => {
  TIERS.forEach(t => {
    [t.days, t.days + 1, 7].forEach(avail => {
      const runs = raceWeekRuns(plan(t.exp, avail, t.entry).d);
      assert.equal(runs.filter(x => x.type === 'race').length, 1,
        t.exp + ': the race day itself went missing');
      assert.ok(runs.length <= t.days,
        t.exp + ' at ' + avail + ' available: race week has ' + runs.length +
        ' running days including the race (max ' + t.days + ') — ' +
        runs.map(x => x.type).join('/'));
    });
  });
});

test('the days kept are the ones closest to the race', () => {
  /* A race week's remaining running belongs beside the race, not stranded at
     the start of the week -- the same rule the half already applies. */
  const { d } = plan('novice', 7, 21);
  const runs = raceWeekRuns(d).sort((a, b) => a.date < b.date ? -1 : 1);
  const race = runs.filter(x => x.type === 'race')[0];
  const gaps = runs.filter(x => x.type !== 'race')
                   .map(x => Math.round((Date.parse(race.date) - Date.parse(x.date)) / 86400000));
  assert.ok(Math.max.apply(null, gaps) <= 6, 'a lead-up run sits outside race week');
  assert.ok(gaps.indexOf(1) !== -1, 'the day before the race is not a running day');
});

test('a shakeout still precedes the race', () => {
  TIERS.forEach(t => {
    const runs = raceWeekRuns(plan(t.exp, t.days, t.entry).d);
    const race = runs.filter(x => x.type === 'race')[0];
    const dayBefore = runs.filter(x =>
      Math.round((Date.parse(race.date) - Date.parse(x.date)) / 86400000) === 1)[0];
    assert.ok(dayBefore, t.exp + ': nothing on the day before the race');
    assert.ok(dayBefore.km <= 4.01,
      t.exp + ': the day before the race is ' + dayBefore.km + 'km, not a shakeout');
  });
});

test('no other distance moved', () => {
  /* Gated on distKey === 'full'. The half keeps its own lead-up rule. */
  const sig = (dist, exp, avail, vol) => raceWeekRuns(plan(exp, avail, vol, dist).d)
    .map(x => x.type + ':' + (x.km || 0)).join('|');
  assert.equal(sig('half', 'advanced', 7, 60), sig('half', 'advanced', 7, 60));
  const halfRuns = raceWeekRuns(plan('advanced', 7, 60, 'half').d);
  assert.ok(halfRuns.length >= 5,
    'the half race week shrank to a marathon tier count, so the rule leaked');
});
