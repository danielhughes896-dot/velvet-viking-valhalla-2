'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

/* RACE DAY IS NOT PART OF THE WEEK'S TRAINING -- THE DISPLAY SIDE
 * ===========================================================================
 * The engine side of this is test/raceWeekVolumeMethodology.test.js, which
 * fixed largestScheduledWeek() and weeklyCompletedTrainingVolumes() and said,
 * in its own header, that "weekVolume() (the Full Plan week-card display)
 * already made exactly this training/race split for the same reason".
 *
 * weekVolume() DID make the split. The week header printed vol.total anyway.
 * That sentence is how this survived a pass aimed straight at it, and it is
 * why these tests read the rendered markup rather than the returned object.
 *
 * A marathon block used to finish like this:
 *
 *     WEEK 13   RACE WEEK          0/71.7 km
 *     Total includes race day: 29.5 training + 42.2 race = 71.7 km
 *
 * Two things were wrong with that. The number made the smallest, most tapered
 * week of a sixteen-week build read as the biggest week in it -- and the note
 * underneath existed only to explain a sum that should never have been added.
 * And the race itself, the event the entire block was constructed for, was the
 * seventh card in a list of seven.
 *
 * The engine already held this line: largestScheduledWeek() has always
 * excluded race days, and its own comment calls that "the same split
 * weekVolume() already makes". Only the display did not.
 *
 * These tests pin the split in both directions, because both directions are
 * easy to lose. Putting the race back into the header is a one-word change
 * (vol.total), and removing the standalone event is a one-line change. Either
 * would pass every other test in this suite.
 */

const SCHEDULE = { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 };
const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');

/* Source with comments stripped. Several of these assertions are about what
   the CODE does, and this file's own explanatory comments quote the very
   strings being forbidden -- matching prose instead of code has produced a
   false pass in this suite before. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* A real race block through the app's own generator, exactly as
   handleGeneratePlan builds one -- so the race day, its distance and its
   prescription are the engine's and not this file's. */
function racingBlock(opts){
  const o = opts || {};
  const a = loadApp({ pinnedDate: (o.today || '2026-08-27') + 'T09:00:00Z' });
  a.showToast = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  const weeks = o.weeks || 13;
  const distanceKey = o.distanceKey || 'full';
  const volume = o.volume || 45;
  const startDate = a.addDays(a.todayStr(), -(o.back != null ? o.back : 35));
  const startMonday = a.addDays(startDate, -a.isoWeekday(startDate));
  const raceDate = a.addDays(startMonday, weeks * 7 - 1);
  const blockResult = a.buildBlockWeeks(distanceKey, volume, weeks);
  const days = a.buildDaysFromWeeks(blockResult, raceDate, SCHEDULE, startDate, true);
  a.state = a.makeDefaultState();
  a.state.setup = {
    distanceKey, currentVolume: volume, raceDate, hasEvent: true,
    startDate, planWeeks: blockResult.planWeeks, schedule: SCHEDULE,
    benchmark: { distanceKey: '10k', timeSec: a.clockToSec('0:45:00') },
    goals: { A: { timeSec: Math.round(a.clockToSec('3:30:00')) } }, activeGoal: 'A',
    paceOverrides: {}, lthr: 172, maxHR: 190, experience: 'experienced', purpose: 'race'
  };
  a.state.days = days;
  a.state.athlete = { sessions: [], baselines: {}, blocks: [] };
  a.state.healthConsent = { version: a.HEALTH_CONSENT_VERSION, decision: 'granted',
    decidedAt: '2026-01-01T09:00:00.000Z', grantedAt: '2026-01-01T09:00:00.000Z',
    withdrawnAt: null };
  a.migrateAthleteRecord();
  return a;
}

function raceDay(a){
  return a.state.days.filter(d => d.type === 'race')[0];
}
/* The header figure the week accordion prints, read out of the rendered
   markup rather than recomputed -- recomputing it would test the arithmetic
   twice and the display not at all. */
function headerVolume(html, weekNum){
  const week = new RegExp('<div class="week[^"]*" id="week-' + weekNum + '">([\\s\\S]*?)</button>')
    .exec(html);
  assert.ok(week, 'week ' + weekNum + ' did not render');
  const v = /<div class="week-vol"><div class="v font-mono">([^<]*)<\/div>/.exec(week[1]);
  assert.ok(v, 'week ' + weekNum + ' has no volume figure');
  return v[1];
}

// ---------------------------------------------------------------------------
// 1. THE HEADLINE: the race distance is out of the race week's training total
// ---------------------------------------------------------------------------

test('the race week header shows training volume only, not training + race', () => {
  const a = racingBlock();
  const race = raceDay(a);
  assert.ok(race, 'the block has no race day at all');
  assert.equal(race.km, 42.2, 'the marathon race day is no longer 42.2 km');

  const vol = a.weekVolume(race.week);
  assert.ok(vol.training > 0, 'race week has no training volume');
  assert.equal(vol.race, 42.2, 'weekVolume no longer reports the race distance');
  /* The whole point, stated as arithmetic. */
  assert.equal(vol.training, a.round1(vol.total - vol.race),
    'training volume still contains the race');
  assert.ok(vol.training < vol.total,
    'the training figure and the all-in figure are the same number');

  const html = a.renderFullPlanView();
  assert.equal(headerVolume(html, race.week), '0/' + a.kmToDisplay(vol.training),
    'the race week header prints a figure that is not the training total');
  assert.ok(headerVolume(html, race.week).indexOf(a.kmToDisplay(vol.total)) === -1,
    'the combined training+race total is still on the week header');
});

test('the taper keeps descending all the way to race week', () => {
  /* THE DEFECT, AS A CURVE. This marathon block tapers 79 -> 59 -> 40, and
     then the header printed 67.2 -- the taper reversed on its final week and
     race week read as a bigger week than nine of the block's twelve
     genuine training weeks. That is the number an athlete looks at when they are deciding
     whether they have done enough resting. */
  const a = racingBlock();
  const rw = raceDay(a).week;
  const training = [];
  for (let w = 1; w <= a.totalWeeksInPlan(); w++) training.push(a.weekVolume(w).training);

  assert.equal(training[rw - 1], Math.min.apply(null, training),
    'race week is not the smallest training week of the block');
  assert.ok(training[rw - 1] < training[rw - 2],
    'race week does not continue the taper down from the week before it');

  /* And the old figure did the opposite, so this fixture genuinely reproduces
     what was wrong rather than passing vacuously. */
  const allIn = a.weekVolume(rw).total;
  assert.ok(allIn > training[rw - 2],
    'this fixture no longer reproduces the original defect, so it proves nothing');
  assert.ok(allIn > training[rw - 1] * 2, 'the race no longer dominates the all-in figure');
});

test('the combined-total explanation is gone from the product', () => {
  const a = racingBlock();
  const html = a.renderFullPlanView();
  assert.ok(!/Total includes/i.test(html),
    'the "Total includes race day: X training + Y race" note is back');
  assert.ok(!/race-split/.test(html), 'the combined-total note element is back');
  assert.ok(!/Total includes/i.test(CODE),
    'the combined-total sentence is still in the runtime source');
});

// ---------------------------------------------------------------------------
// 2. NOTHING WAS TAKEN AWAY: the race session is still the athlete's race
// ---------------------------------------------------------------------------

test('the race session is still in the programme, with its prescription intact', () => {
  const a = racingBlock();
  const race = raceDay(a);
  assert.equal(a.state.days.filter(d => d.type === 'race').length, 1);
  assert.equal(race.km, a.DISTANCE_PROFILES.full.raceKm,
    'the race distance changed');
  assert.equal(race.date, a.state.setup.raceDate, 'the race moved off race day');
  assert.ok(race.week === a.totalWeeksInPlan(), 'the race is no longer in the final week');
  /* It is still a real, gradeable session: the engine still treats it as a
     maximal effort and still gives it a goal pace. */
  assert.deepEqual(a.expectedRPEBand(race).join('-'), '8-10',
    'the race is no longer prescribed as a maximal effort');
  assert.ok(a.getGoalPaceSecPerKm() > 0, 'the race lost its goal pace');
  assert.equal(a.sessionImportance(race), 'KEY',
    'the race is no longer a key session');
});

test('the race day renders exactly once, as a standalone event below the last week', () => {
  const a = racingBlock();
  const race = raceDay(a);
  const html = a.renderFullPlanView();

  const cardId = 'id="day-' + race.id + '"';
  const occurrences = html.split(cardId).length - 1;
  assert.equal(occurrences, 1,
    'the race day card rendered ' + occurrences + ' times, not once');

  /* It is introduced as the event, not listed as a session. */
  assert.match(html, /class="phase-divider race-divider"/,
    'the race day has no divider of its own');
  assert.match(html, /class="race-event"/, 'the standalone race event did not render');
  assert.match(html, /class="race-event-dist font-mono"><b>42\.2<\/b>/,
    'the race distance is not shown on the standalone event');

  /* And it sits AFTER the final week accordion, not inside it. */
  const weekIdx = html.indexOf('id="week-' + race.week + '"');
  const eventIdx = html.indexOf('class="race-event"');
  const cardIdx = html.indexOf(cardId);
  assert.ok(weekIdx > -1 && eventIdx > weekIdx, 'the race event is not below its week');
  assert.ok(cardIdx > eventIdx, 'the race card is not inside the standalone event');

  /* The week body itself no longer lists it. */
  const body = html.slice(weekIdx, eventIdx);
  assert.ok(body.indexOf(cardId) === -1,
    'the race is still one of the week accordion\'s day cards');
});

test('every other day of race week is still listed inside the week', () => {
  const a = racingBlock();
  const race = raceDay(a);
  const html = a.renderFullPlanView();
  a.state.days.filter(d => d.week === race.week && d.type !== 'race').forEach(d => {
    assert.ok(html.indexOf('id="day-' + d.id + '"') > -1,
      'day ' + d.date + ' (' + d.type + ') disappeared from race week');
  });
});

// ---------------------------------------------------------------------------
// 3. THE REST OF THE PLAN IS UNTOUCHED
// ---------------------------------------------------------------------------

test('weeks without a race are completely unaffected', () => {
  const a = racingBlock();
  const rw = raceDay(a).week;
  const html = a.renderFullPlanView();
  for (let w = 1; w <= a.totalWeeksInPlan(); w++){
    if (w === rw) continue;
    const vol = a.weekVolume(w);
    assert.equal(vol.race, 0, 'week ' + w + ' reports race kilometres');
    assert.equal(vol.training, vol.total, 'week ' + w + ' training total drifted from its total');
    assert.equal(headerVolume(html, w), a.kmToDisplay(vol.done) + '/' + a.kmToDisplay(vol.total),
      'week ' + w + ' header changed');
  }
  /* Exactly one standalone race event in the whole plan. */
  assert.equal(html.split('class="race-event"').length - 1, 1,
    'more than one standalone race event rendered');
});

test('the all-in figures are still available to callers that want them', () => {
  const a = racingBlock();
  const vol = a.weekVolume(raceDay(a).week);
  /* `total` and `done` are not deprecated -- they are the week's real
     kilometres, race included, and removing them would be a different and
     unasked-for change. */
  assert.equal(vol.total, a.round1(vol.training + vol.race));
  assert.ok(typeof vol.done === 'number' && typeof vol.doneTraining === 'number');
});

test('the programme-level race distance maths is unchanged', () => {
  const a = racingBlock();
  /* largestScheduledWeek() already excluded race days before this pass. It
     must still, and it must still agree with the header's training figure. */
  const largest = a.largestScheduledWeek(a.state.days);
  const trainings = [];
  for (let w = 1; w <= a.totalWeeksInPlan(); w++) trainings.push(a.weekVolume(w).training);
  assert.equal(a.round1(largest), a.round1(Math.max.apply(null, trainings)),
    'largestScheduledWeek and the week headers now disagree about peak volume');
});

// ---------------------------------------------------------------------------
// 4. AFTER THE RACE IS RUN
// ---------------------------------------------------------------------------

test('logging the race does not push the header past its own target', () => {
  const a = racingBlock();
  const race = raceDay(a);
  a.state.days.filter(d => d.week === race.week && d.type !== 'rest').forEach(d => {
    d.completed = true;
    d.actual = Object.assign(a.emptyActual(), { km: d.km, paceUnit: 'km' });
  });
  const vol = a.weekVolume(race.week);
  assert.equal(vol.doneTraining, vol.training,
    'a fully completed race week does not read as complete');
  assert.ok(vol.doneTraining <= vol.training,
    'completed training exceeds prescribed training -- the race got counted');
  /* The failure this guards: doneTraining computed from `done` without
     subtracting the race would print 71.7/29.5. */
  assert.ok(vol.done > vol.doneTraining, 'the completed race was not recorded at all');

  const html = a.renderFullPlanView();
  assert.equal(headerVolume(html, race.week),
    a.kmToDisplay(vol.training) + '/' + a.kmToDisplay(vol.training));
});

test('the completed race is still recorded as a measured performance', () => {
  const a = racingBlock();
  const race = raceDay(a);
  race.completed = true;
  race.actual = Object.assign(a.emptyActual(), { km: race.km, pace: '4:58', paceUnit: 'km' });
  const p = a.recordMeasuredPerformance(race);
  assert.ok(p, 'the race no longer produces a measured performance');
  assert.equal(p.source, 'race');
  assert.equal(p.date, race.date);
  assert.ok(p.vdot > 0, 'the race performance carries no VDOT');
  assert.equal(a.measuredPerformances().filter(x => x.date === race.date).length, 1,
    'the race performance is not in the athlete record exactly once');
});

test('the race is still kept out of completed weekly training load', () => {
  /* Pre-existing behaviour, pinned here because this pass is about weekly
     volume and a later reader will reasonably ask whether it changed the
     numbers the progression engine judges. It did not: the load side already
     excluded races, which is why the display was the only thing out of step. */
  const a = racingBlock();
  const race = raceDay(a);
  const before = a.weeklyCompletedTrainingVolumes().map(x => x.week + ':' + x.km).join('|');
  race.completed = true;
  race.actual = Object.assign(a.emptyActual(), { km: race.km, paceUnit: 'km' });
  assert.equal(a.weeklyCompletedTrainingVolumes().map(x => x.week + ':' + x.km).join('|'), before,
    'logging the race changed completed weekly training load');
});

test('rendering the plan never mutates the schedule', () => {
  const a = racingBlock();
  const before = JSON.stringify(a.state.days);
  a.renderFullPlanView();
  a.renderFullPlanView();
  assert.equal(JSON.stringify(a.state.days), before,
    'rendering Full Plan changed the athlete\'s days');
});

// ---------------------------------------------------------------------------
// 5. THE TWO SURFACES MUST NOT DISAGREE
// ---------------------------------------------------------------------------

test('This Week shows the same split as Full Plan during race week', () => {
  /* Pinned inside race week: renderWeekView() renders the current week, and
     before this pass it shared renderWeekAccordion() with Full Plan but not
     the standalone event -- so the same seven days would have shown two
     different weekly totals depending on which screen you were on. */
  const a = racingBlock({ back: 12 * 7 + 1 });
  const race = raceDay(a);
  assert.equal(a.currentWeekNum(), race.week, 'the fixture is not in race week');

  const week = a.renderWeekView();
  const full = a.renderFullPlanView();
  assert.equal(headerVolume(week, race.week), headerVolume(full, race.week),
    'This Week and Full Plan print different totals for the same week');
  assert.equal(week.split('id="day-' + race.id + '"').length - 1, 1,
    'the race renders more or less than once on This Week');
  assert.match(week, /class="race-event"/,
    'This Week lost the standalone race event');
  assert.ok(!/Total includes/i.test(week), 'the combined-total note survives on This Week');
});

test('a non-race week on This Week is unchanged and carries no race event', () => {
  const a = racingBlock({ back: 35 });
  const w = a.currentWeekNum();
  assert.ok(w && w < a.totalWeeksInPlan(), 'the fixture is not mid-block');
  const html = a.renderWeekView();
  assert.ok(!/class="race-event"/.test(html),
    'a mid-block week renders a race event');
  assert.equal(headerVolume(html, w),
    a.kmToDisplay(a.weekVolume(w).done) + '/' + a.kmToDisplay(a.weekVolume(w).total));
});

// ---------------------------------------------------------------------------
// 6. THE LIVE PATCH PATH
// ---------------------------------------------------------------------------

test('the live stats patch writes the training split, not the all-in total', () => {
  /* patchDerivedStats() rewrites the week header in place after a log without
     a full re-render. If it kept printing vol.done/vol.total the race would
     silently reappear in the header the moment anything was logged -- the
     defect would come back only for athletes who use the app. */
  const fn = /function patchDerivedStats\(\)\{[\s\S]*?\n\}/.exec(CODE);
  assert.ok(fn, 'patchDerivedStats is gone');
  assert.match(fn[0], /\.week-vol \.v/, 'it no longer patches the week header');
  assert.match(fn[0], /kmToDisplay\(vol\.doneTraining\)\+'\/'\+kmToDisplay\(vol\.training\)/,
    'the live patch prints something other than the training split');
  assert.ok(!/kmToDisplay\(vol\.done\)\+'\/'\+kmToDisplay\(vol\.total\)/.test(fn[0]),
    'the live patch still writes the combined total');
});

test('the week accordion filters the race out exactly once, in one place', () => {
  const acc = /function renderWeekAccordion\([\s\S]*?\n\}/.exec(CODE);
  assert.ok(acc, 'renderWeekAccordion is gone');
  assert.match(acc[0], /wdays\.filter\(function\(dd\)\{ return dd\.type!=='race'; \}\)\.map\(renderDayCard\)/,
    'the week body no longer excludes the race from its day cards');
  assert.match(acc[0], /kmToDisplay\(vol\.doneTraining\)\+'\/'\+kmToDisplay\(vol\.training\)/,
    'the week header no longer prints the training split');
});

// ---------------------------------------------------------------------------
// 7. THE WEEK'S OTHER AGGREGATE
// ---------------------------------------------------------------------------

test('the weekly zone breakdown describes the sessions the week actually lists', () => {
  /* The zone chart sits inside the week body, under the day cards. With the
     race no longer among them, counting its 42.2 km of goal-pace running here
     would have made race week's chart read as a 60% marathon-pace block built
     from sessions not shown above it. */
  const a = racingBlock();
  const race = raceDay(a);
  const withRace = a.computeWeekZoneBreakdown(race.week);
  const listed = a.state.days.filter(d => d.week === race.week && d.type !== 'race');
  assert.ok(listed.length > 0);

  /* Same week with the race deleted: the chart must be identical, which is
     only true if the race contributes nothing to it. */
  const b = racingBlock();
  b.state.days = b.state.days.filter(d => d.type !== 'race');
  const without = b.computeWeekZoneBreakdown(race.week);
  ['easy', 'mp', 'threshold', 'interval'].forEach(k => {
    assert.equal(Math.round(withRace.zones[k]), Math.round(without.zones[k]),
      'the race still contributes ' + k + ' time to race week\'s zone chart');
  });
  assert.ok(withRace.totalSec > 0, 'race week has no zone time at all');
});

test('non-race weeks zone breakdown is untouched', () => {
  const a = racingBlock();
  const rw = raceDay(a).week;
  for (let w = 1; w <= a.totalWeeksInPlan(); w++){
    if (w === rw) continue;
    const zb = a.computeWeekZoneBreakdown(w);
    const days = a.state.days.filter(d => d.week === w && d.type !== 'rest' && d.km);
    assert.equal(zb.structuredDays + zb.approximatedDays, days.length,
      'week ' + w + ' lost sessions from its zone chart');
  }
});

// ---------------------------------------------------------------------------
// 8. THE OTHER PURPOSES
// ---------------------------------------------------------------------------

test('a half-marathon block splits the same way', () => {
  const a = racingBlock({ distanceKey: 'half', weeks: 12 });
  const race = raceDay(a);
  assert.equal(race.km, 21.1);
  const vol = a.weekVolume(race.week);
  assert.equal(vol.training, a.round1(vol.total - 21.1));
  const html = a.renderFullPlanView();
  assert.equal(headerVolume(html, race.week), '0/' + a.kmToDisplay(vol.training));
  assert.equal(html.split('id="day-' + race.id + '"').length - 1, 1);
});

test('the standalone event uses the plan\'s own name for the day', () => {
  /* "Race Day" for a real event, "Goal Day" for a self-set target -- vGoalDay()
     already decides that everywhere else and this must not invent a second
     vocabulary. */
  const a = racingBlock();
  const html = a.renderFullPlanView();
  const divider = /<div class="phase-divider race-divider"><span class="l font-head">([^<]*)<\/span>/.exec(html);
  assert.ok(divider, 'the race divider did not render');
  assert.equal(divider[1], a.vGoalDay(),
    'the standalone event names the day something the rest of the app does not');
});
