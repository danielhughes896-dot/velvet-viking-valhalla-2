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

/* ---------- FULL PLAN SHOWS ONE PHASE AT A TIME ----------
   Under the phase carousel the screen lists the weeks of the phase the
   athlete is looking at, and opens on the phase holding the CURRENT week.
   racingBlock() pins today five weeks into a thirteen-week build, so that
   is the Build phase -- and a test asking "what does this screen say about
   week 13" has to say which phase it is looking at, exactly as an athlete
   has to swipe to it.
   THROUGH THE REAL HANDLER, not by poking the variable: handlePhasePick()
   is what a dot tap and a swipe both call, so these read the screen the
   athlete actually gets rather than one assembled by the test. */
function planViewOn(a, weekNum){
  const g = a.planPhaseGroups().filter(x => x.weeks.indexOf(weekNum) !== -1)[0];
  assert.ok(g, 'week ' + weekNum + ' belongs to no phase');
  const render = a.renderApp;
  a.renderApp = () => {};
  a.handlePhasePick(g.phase);
  a.renderApp = render;
  return a.renderFullPlanView();
}

/* A real race block through the app's own generator, exactly as
   handleGeneratePlan builds one -- so the race day, its distance and its
   prescription are the engine's and not this file's. */
/* THE GOAL DAY'S OWN STOP. Founder: "I think it should be added to the rail
   at the end. Base -> Build -> Peak -> Taper -> Race Day." The standalone
   event used to be appended to the week list under every phase, so any phase
   view carried it; it has a slide of its own now and only that slide's body
   carries it. Selected the way the athlete selects it -- handlePhasePick on
   the stop's own name -- rather than by reaching into the renderer. */
function planStopView(a){
  const stops = a.planRailStops();
  const last = stops[stops.length - 1];
  assert.ok(last && last.race, 'the rail does not end at the goal day');
  const render = a.renderApp;
  a.renderApp = () => {};
  a.handlePhasePick(last.phase);
  a.renderApp = render;
  return a.renderFullPlanView();
}
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
/* This Week no longer prints the accordion header -- it leads with a week
   hero instead -- but it prints the SAME pair from the same weekVolume()
   call: completed training over planned training. This reads that figure so
   the cross-surface comparison below still compares rendered markup on both
   sides rather than quietly recomputing one of them. */
function heroVolume(html){
  const m = /<div class="wk-hero-vol"><b>([^<]*)<\/b><span> \/ ([^<]*)<\/span><\/div>/.exec(html);
  assert.ok(m, 'This Week did not render its hero volume');
  return [m[1], m[2].replace(/[^0-9.]/g, '')];
}
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

  const html = planViewOn(a, race.week);
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

test('the race day renders exactly once, as a standalone event on its own stop', () => {
  /* ---- THIS LAW MOVED SCREENS, NOT CLAIMS ----
     It used to read the event off the phase holding the race week, because
     renderWeeksList() appended it to every phase's list. That is what the
     founder saw and named: "The goal day card looks like the last version of
     the app" -- it was the old card, printed under Base, Build, Peak and
     Taper alike. The event is on the rail's last stop now. What is asserted
     is unchanged: it renders once, it is introduced as an event rather than
     listed as a session, and the week accordion does not carry it. */
  const a = racingBlock();
  const race = raceDay(a);
  const phase = planViewOn(a, race.week);
  const stop = planStopView(a);

  /* COUNTED ON THE OPENING TAG, NOT ON THE PREFIX. The panel's own class is
     "race-event race-stop" and it contains .race-event-when and
     .race-event-dist, so a prefix count reads 3 for one event. Matched up to
     the character that ends the name. */
  assert.equal((stop.match(/class="race-event[ "]/g) || []).length, 1,
    'the standalone event did not render exactly once on its own stop');
  assert.match(stop, /class="phase-divider race-divider"/,
    'the race day has no divider of its own');
  assert.match(stop, /class="race-event-dist font-mono"><b>42\.2<\/b>/,
    'the race distance is not shown on the standalone event');
  assert.match(stop, /data-action="plan-open-session"/,
    'the standalone event is no longer the way in to the race session');

  /* ---- AND THE WEEK NEVER CARRIES IT ----
     The original claim, and the one that still bites: the race is excluded
     from the week's own session list, so the week's total and the event
     cannot describe the same seven days twice. */
  const cardId = 'id="day-' + race.id + '"';
  assert.equal(phase.indexOf('class="race-event"'), -1,
    'the goal-day card is back under the phase holding race week');
  assert.equal(phase.indexOf(cardId), -1,
    'the race is one of the week accordion\'s day cards again');
  assert.equal(phase.indexOf('data-action="plan-open-session" data-day="' + race.id + '"'), -1,
    'race week lists the race as one of its sessions');

  /* ---- THE HIDDEN CARD IS GONE FROM FULL PLAN, AND THAT IS THE POINT ----
     renderRaceDayEvent() carried renderDayCard(race) and Full Plan hid it in
     CSS (.view-plan > .race-event > .day{display:none}). The stop does not
     build it at all: dead markup on this screen, and a second copy of the
     race's id in a document that already has one on This Week. */
  assert.equal(stop.indexOf(cardId), -1,
    'the stop builds the day card Full Plan then hides, which is markup for nobody');
});

test('every other day of race week is still listed inside the week', () => {
  const a = racingBlock();
  const race = raceDay(a);
  const html = planViewOn(a, race.week);
  /* The week lists its sessions as rows now; the race is still excluded from
     that list and emitted separately as its own event. Same claim, read off
     the element the week actually renders. */
  a.state.days.filter(d => d.week === race.week && d.type !== 'race').forEach(d => {
    assert.ok(html.indexOf('data-action="plan-open-session" data-day="' + d.id + '"') > -1,
      'day ' + d.date + ' (' + d.type + ') disappeared from race week');
  });
});

// ---------------------------------------------------------------------------
// 3. THE REST OF THE PLAN IS UNTOUCHED
// ---------------------------------------------------------------------------

test('weeks without a race are completely unaffected', () => {
  const a = racingBlock();
  const rw = raceDay(a).week;
  /* ONE RENDER PER WEEK, because the screen shows one phase at a time -- and
     this is a claim about EVERY week, so every week is actually looked at
     rather than inferred from the one phase that happened to be open. */
  for (let w = 1; w <= a.totalWeeksInPlan(); w++){
    if (w === rw) continue;
    const vol = a.weekVolume(w);
    assert.equal(vol.race, 0, 'week ' + w + ' reports race kilometres');
    assert.equal(vol.training, vol.total, 'week ' + w + ' training total drifted from its total');
    assert.equal(headerVolume(planViewOn(a, w), w),
      a.kmToDisplay(vol.done) + '/' + a.kmToDisplay(vol.total),
      'week ' + w + ' header changed');
  }
  /* ---- AND NO PHASE CARRIES THE EVENT ----
     THIS REVERSES THE LAW THAT WAS HERE, which required exactly one event on
     every phase view on the reasoning that Race Day is not inside a phase
     and is not filtered by one. True of the day; false of the card, which
     was then printed four times over -- once under each phase the athlete
     could swipe to. It is not inside a phase BECAUSE it has a stop of its
     own, which is where the one copy now lives. */
  for (let w = 1; w <= a.totalWeeksInPlan(); w++){
    assert.equal(planViewOn(a, w).split('class="race-event"').length - 1, 0,
      'a phase view carried the standalone race event while looking at week ' + w);
  }
  assert.equal((planStopView(a).match(/class="race-event[ "]/g) || []).length, 1,
    'the goal day\u2019s stop does not carry exactly one standalone event');
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

  const html = planViewOn(a, race.week);
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
  assert.equal(heroVolume(week).join('/'), headerVolume(full, race.week),
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
  assert.deepEqual(heroVolume(html),
    [String(a.kmToDisplay(a.weekVolume(w).done)), String(a.kmToDisplay(a.weekVolume(w).total))]);
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
  /* THE FILTER MOVED WITH THE LIST, AND IS STILL IN EXACTLY ONE PLACE -- a
     stronger position than before. The accordion used to filter the race out
     of its own map, and the week SCREEN filtered it out of its own rows: two
     copies of one rule. Both list through planWeekRowsHtml() now, so the
     exclusion is written once and neither surface can forget it. */
  assert.match(acc[0], /planWeekRowsHtml\(weekNum\)/,
    'the week body no longer lists through the shared row renderer');
  const rows = /function planWeekRowsHtml\([\s\S]*?\n\}/.exec(CODE);
  assert.ok(rows, 'planWeekRowsHtml is gone');
  /* And the rows do not filter for themselves either: they ask
     weekSessionDays(), which is where "the race is not one of the week's
     sessions" is defined once for This Week and Full Plan alike. */
  assert.match(rows[0], /weekSessionDays\(weekNum\)/,
    'the row renderer filters the week for itself instead of asking weekSessionDays()');
  const defn = /function weekSessionDays\([\s\S]*?\n\}/.exec(CODE);
  assert.ok(defn, 'weekSessionDays is gone');
  assert.match(defn[0], /dd\.type!=='race'/,
    'the week body no longer excludes the race from its sessions');
  assert.equal((CODE.match(/dd\.week===weekNum && dd\.type!=='race'/g) || []).length, 1,
    'the race exclusion is written in more than one place again');
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
  const html = planViewOn(a, race.week);
  assert.equal(headerVolume(html, race.week), '0/' + a.kmToDisplay(vol.training));
  /* THE SPLIT, READ WHERE EACH HALF LIVES: the week's header counts training
     only, and the 21.1km it leaves out is on the goal day's own stop. */
  assert.equal(html.indexOf('id="day-' + race.id + '"'), -1,
    'the half-marathon is listed inside its week again');
  assert.match(planStopView(a), /class="race-event-dist font-mono"><b>21\.1<\/b>/,
    'the half-marathon is not on the goal day\u2019s stop either, so it is nowhere');
});

test('the standalone event uses the plan\'s own name for the day', () => {
  /* "Race Day" for a real event, "Goal Day" for a self-set target -- vGoalDay()
     already decides that everywhere else and this must not invent a second
     vocabulary. */
  const a = racingBlock();
  const html = planStopView(a);
  const divider = /<div class="phase-divider race-divider"><span class="l font-head">([^<]*)<\/span>/.exec(html);
  assert.ok(divider, 'the race divider did not render');
  assert.equal(divider[1], a.vGoalDay(),
    'the standalone event names the day something the rest of the app does not');
  /* AND THE SLIDE ABOVE IT AGREES. The stop's own title is the second place
     this day is named; two names for one day on one screen is the thing
     vGoalDay() exists to prevent. */
  assert.ok(html.indexOf('<span class="pp-slide-k">' + a.vGoalDay() + '</span>') > -1,
    'the stop\u2019s slide names the day something other than its own panel does');
});
