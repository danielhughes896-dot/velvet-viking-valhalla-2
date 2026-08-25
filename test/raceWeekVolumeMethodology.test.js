'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// C5 -- A RACE DAY IS NOT A TRAINING WEEK, ON EITHER SIDE OF THE GATE.
//
// Investigation: largestScheduledWeek() (the figure written to a block's
// ledger as its peakVolume, and the figure progressionJustification()'s
// "did the athlete reach the top of the last block" gate is judged against)
// summed every non-rest day in a week including a 'race' typed day. A
// marathon or half marathon's race distance is a single tapered, maximal
// effort -- not a training load -- and for a short or lower-volume block,
// the race week (a couple of easy shakeout days plus the race itself) can
// outscore every genuine training week the block scheduled. Reproduced
// concretely below: an 8-12 week, 30-35km/week full-marathon block reports
// its RACE WEEK as the block's peak, not its actual highest training week.
//
// This is inconsistent with the codebase's own documented design: the
// adjacent demonstratedSustainableVolume() was deliberately built to require
// three sustained weeks specifically so one big week could never pass for
// capacity ("one big week is a week, three is a capacity"). The scheduled
// and completed peak-week figures had no equivalent protection and were
// therefore inconsistent with that stated methodology, not a considered
// exception to it -- so this is a fix, not a deferral. weekVolume() (the
// Full Plan week-card display) already made exactly this training/race
// split for the same reason; the peak-comparison gate now makes it too.
//
// Scope: only largestScheduledWeek() and the new
// weeklyCompletedTrainingVolumes() (used solely by progressionJustification
// ()'s peak-reached comparison) changed. weeklyCompletedVolumes() itself,
// demonstratedSustainableVolume() and the safety ceiling are untouched --
// they were not the site of the inconsistency, and widening the fix to them
// was out of scope for what was actually found broken.

const SCHEDULE = { activeDays: [1, 2, 3, 4, 6], longRunDay: 6 };

function appWithFullBlock(weeks, volume){
  const a = loadApp({ pinnedDate: '2026-01-01T09:00:00Z' });
  buildPlan(a, { distanceKey: 'full', volume, weeks, schedule: SCHEDULE });
  return a;
}

test('reproduction: an unprotected peak reads the race week as the block\'s peak', () => {
  // This is the ORIGINAL behaviour reproduced by hand (not calling the now-
  // fixed largestScheduledWeek()), to prove the bug was real before proving
  // the fix closes it.
  const a = appWithFullBlock(10, 30);
  const byWeekIncludingRace = {};
  a.state.days.forEach((dd) => {
    if (!dd || dd.type === 'rest') return;
    byWeekIncludingRace[dd.week] = (byWeekIncludingRace[dd.week] || 0) + (dd.km || 0);
  });
  const raceWeekNum = a.state.days.find((dd) => dd.type === 'race').week;
  const naiveMax = Math.max(...Object.values(byWeekIncludingRace));
  assert.equal(byWeekIncludingRace[raceWeekNum], naiveMax,
    'fixture does not reproduce the bug: race week is not the naive maximum');
});

test('largestScheduledWeek() no longer reports the race week as the peak', () => {
  [8, 10, 12].forEach((weeks) => {
    [30, 35].forEach((volume) => {
      const a = appWithFullBlock(weeks, volume);
      const raceDay = a.state.days.find((dd) => dd.type === 'race');
      const raceWeekTotal = a.state.days
        .filter((dd) => dd.week === raceDay.week && dd.type !== 'rest')
        .reduce((sum, dd) => sum + (dd.km || 0), 0);
      const fixed = a.largestScheduledWeek(a.state.days);
      assert.ok(fixed < raceWeekTotal - 1,
        `weeks=${weeks} vol=${volume}: largestScheduledWeek=${fixed} still reads as the ` +
        `race week (${raceWeekTotal}km including the race)`);
    });
  });
});

test('largestScheduledWeek() still finds a genuine training peak elsewhere in the block', () => {
  const a = appWithFullBlock(10, 35);
  const raceDay = a.state.days.find((dd) => dd.type === 'race');
  let genuineMax = 0;
  const byWeek = {};
  a.state.days.forEach((dd) => {
    if (!dd || dd.type === 'rest' || dd.type === 'race') return;
    byWeek[dd.week] = (byWeek[dd.week] || 0) + (dd.km || 0);
  });
  Object.keys(byWeek).forEach((w) => { if (byWeek[w] > genuineMax) genuineMax = byWeek[w]; });
  assert.equal(a.largestScheduledWeek(a.state.days), Math.round(genuineMax * 10) / 10);
});

test('largestScheduledWeek() behaves exactly as before when a block has no race day', () => {
  // Every buildPlan() fixture ends in a goal-effort/'race' day regardless of
  // distance, so this exercises the raw function directly (the same style
  // test/progressionJustification.test.js's own coverage already uses) to
  // isolate the "no race day at all" case from the fixture's own shape.
  const a = loadApp({ pinnedDate: '2026-01-01T09:00:00Z' });
  const days = [
    { week: 1, type: 'easy', km: 10 }, { week: 1, type: 'rest', km: 0 },
    { week: 1, type: 'long', km: 15 },
    { week: 2, type: 'easy', km: 8 }, { week: 2, type: 'long', km: 12 }
  ];
  assert.equal(a.largestScheduledWeek(days), 25);
});

test('weeklyCompletedTrainingVolumes() excludes a completed race day from its week\'s total', () => {
  const a = loadApp({ pinnedDate: '2026-06-01T09:00:00Z' });
  buildPlan(a, { distanceKey: 'full', volume: 40, weeks: 4,
    startDate: a.addDays(a.todayStr(), -21), schedule: SCHEDULE });
  const raceDay = a.state.days.find((dd) => dd.type === 'race');
  assert.ok(raceDay, 'fixture must contain a race day');
  raceDay.completed = true;
  raceDay.actual = Object.assign(a.emptyActual(), { km: raceDay.km, pace: '5:00', paceUnit: 'km', rpe: 9 });

  const withRace = a.weeklyCompletedVolumes().find((w) => {
    const monday = a.addDays(raceDay.date, -a.isoWeekday(raceDay.date));
    return w.week === monday;
  });
  const withoutRace = a.weeklyCompletedTrainingVolumes().find((w) => {
    const monday = a.addDays(raceDay.date, -a.isoWeekday(raceDay.date));
    return w.week === monday;
  });
  assert.ok(withRace, 'the ordinary (unfiltered) weekly total must include the race week');
  assert.ok(!withoutRace || withoutRace.km < withRace.km - raceDay.km + 0.5,
    'the training-only weekly total must not carry the race day\'s distance');
});

test('progressionJustification() compares like with like: both sides of the peak gate exclude race days', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'protected/velvet-viking-valhalla.html'), 'utf8');
  const fnStart = src.indexOf('function progressionJustification()');
  const fn = src.slice(fnStart, fnStart + 3000);
  assert.match(fn, /var best = weeklyCompletedTrainingVolumes\(\)/,
    'the peak-reached gate must read the race-excluded completed volumes, not the raw ones');
});

test('demonstratedSustainableVolume() and the safety ceiling were left untouched (out of scope, already protected)', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'protected/velvet-viking-valhalla.html'), 'utf8');
  const fnStart = src.indexOf('function demonstratedSustainableVolume()');
  const fn = src.slice(fnStart, fnStart + 400);
  assert.match(fn, /weeklyCompletedVolumes\(\)/,
    'demonstratedSustainableVolume must still read the unfiltered weekly volumes -- its own 3-of-52-week rule is its protection, not a race-day filter');
});
