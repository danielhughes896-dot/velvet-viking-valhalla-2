'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const BUILDER_SPEC = require('../assets/builder-spec.js');
const preview = require('../api/_preview.js');

/* THE MINIMUM RUNNING FOUNDATION FOR A RACE GOAL — SIX KILOMETRES A WEEK.
 * ===========================================================================
 * An ENTRY boundary, not a readiness threshold. It does not say an athlete
 * below it cannot run a marathon, and it never makes anybody READY. It says
 * that below it the athlete has not yet demonstrated enough established
 * running for Race Goal methodology to express differentiated race
 * preparation -- at one to five kilometres a week the generator is working at
 * the granularity of its own session floors, and what comes out is EASY_MIN_KM
 * arithmetic rather than training.
 *
 * The coaching answer is to build the foundation first, so the boundary ROUTES
 * rather than refusing: the immediate programme is Aerobic Base and the race
 * the athlete named stays on record.
 *
 * What these tests hold:
 *   1. ONE NUMBER, shared by the app, /start and the preview endpoint.
 *   2. 0-5 km/week ROUTES; 6 and above is permitted.
 *   3. The units an athlete reads do not move the authority.
 *   4. The pre-auth surface enforces it too, and routes rather than refusing.
 *   5. A race the athlete named survives being routed.
 *   6. Nothing switches them back silently.
 *   7. Valid inputs are untouched.
 *   8. Invalid state that reaches the generator anyway does not corrupt it.
 */

const TODAY = '2026-08-30';
const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');

function app(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {}; a.showToast = () => {};
  a.state = a.makeDefaultState();
  return a;
}
const RACE_REQUEST = {
  distanceKey: 'full', purpose: 'race', hasEvent: true, raceDate: '2027-06-01',
  activeDays: [1, 3, 4, 6], longRunDay: 6, benchmarkSeconds: 1800, benchmarkDistanceKey: '5k'
};

/* ---------- 1. ONE NUMBER ---------- */

test('the entry minimum is six kilometres and lives in the canonical builder spec', () => {
  assert.equal(BUILDER_SPEC.validation.raceGoalMinWeeklyKm, 6);
  const a = app();
  assert.equal(a.raceGoalMinWeeklyKm(), 6,
    'the app reads the spec rather than declaring the number a second time');
  assert.equal(preview.BUILDER_SPEC.validation.raceGoalMinWeeklyKm, 6,
    'and so does the endpoint /start builds through');
});

test('the app reads the number rather than hard-coding it', () => {
  const fn = SRC.slice(SRC.indexOf('function raceGoalMinWeeklyKm'),
                       SRC.indexOf('function raceGoalEntry'));
  assert.ok(/BUILDER_SPEC\.validation\.raceGoalMinWeeklyKm/.test(fn),
    'raceGoalMinWeeklyKm() must read the shared specification');
});

/* ---------- 2. THE BOUNDARY ---------- */

test('a Race Goal below six kilometres a week routes to Aerobic Base', () => {
  const a = app();
  [0, 1, 2, 3, 4, 5].forEach(v => {
    const e = a.raceGoalEntry(v);
    assert.equal(e.allowed, false, v + ' km/week must not enter Race Goal');
    assert.equal(e.purpose, 'base', v + ' km/week must be routed to Aerobic Base');
    assert.equal(e.reason, 'below_race_goal_entry_volume');
    assert.equal(e.shortfallKm, Math.round((6 - v) * 10) / 10);
  });
});

test('six kilometres a week is the first valid Race Goal entry state', () => {
  const a = app();
  const e = a.raceGoalEntry(6);
  assert.equal(e.allowed, true);
  assert.equal(e.purpose, 'race');
  assert.equal(e.shortfallKm, 0);
  assert.equal(e.reason, null);
});

test('above six is permitted and reads exactly as six does', () => {
  const a = app();
  [6.1, 7, 10, 25, 80, 200].forEach(v => {
    const e = a.raceGoalEntry(v);
    assert.equal(e.allowed, true, v + ' km/week must be permitted');
    assert.equal(e.purpose, 'race');
  });
});

test('the boundary is closed at six, and the last refused value is just under it', () => {
  const a = app();
  assert.equal(a.raceGoalEntry(5.9).allowed, false);
  assert.equal(a.raceGoalEntry(6).allowed, true);
});

test('a missing, zero or nonsense volume is refused rather than admitted', () => {
  const a = app();
  [null, undefined, 0, -5, NaN, Infinity, 'ten'].forEach(v => {
    const e = a.raceGoalEntry(v);
    assert.equal(e.allowed, false, String(v) + ' must not enter Race Goal');
    assert.equal(e.purpose, 'base');
  });
});

/* ---------- 3. UNITS ---------- */

test('the authority is six kilometres, not six miles, whatever the athlete reads', () => {
  const a = app();
  a.state.units = 'mi';
  assert.equal(a.raceGoalEntry(6).allowed, true,
    'six kilometres is still six kilometres to a runner on miles');
  assert.equal(a.raceGoalEntry(6 * 0.621371).allowed, false,
    'and 3.73km -- what "6" reads as in miles -- is still below the minimum');
  /* WHAT AN ATHLETE TYPING MILES ACTUALLY SUBMITS. The field converts before
     the generator ever sees it -- parseDistInput() -- and it rounds to the
     tenth of a kilometre, which is the app's existing convention and is not
     changed here. So 3.6mi is 5.8km and refused, and 3.7mi is 5.954km which
     the same convention presents and stores as 6.0 and is admitted. The
     boundary is applied to the number the app holds, exactly as every other
     volume rule is; no second threshold exists for miles. */
  assert.equal(a.parseDistInput('3.6'), 5.8);
  assert.equal(a.parseDistInput('3.7'), 6);
  assert.equal(a.raceGoalEntry(a.parseDistInput('3.6')).allowed, false, '3.6mi is 5.8km');
  assert.equal(a.raceGoalEntry(a.parseDistInput('3.7')).allowed, true,  '3.7mi stores as 6.0km');
});

test('the builder shows the minimum in the athlete units without creating a second one', () => {
  const note = SRC.slice(SRC.indexOf('function bldSyncRaceEntryNote'),
                         SRC.indexOf('function bldSyncRaceEntryNote') + 1400);
  assert.ok(/entry\.minKm \* 0\.621371/.test(note),
    'the miles figure must be the kilometre authority converted for display');
  assert.ok(/raceGoalEntry\(km\)/.test(note),
    'and the decision itself must be taken in kilometres');
});

/* ---------- 4. THE PRE-AUTH SURFACE ---------- */

test('the preview endpoint routes a below-minimum race request instead of refusing it', () => {
  [0.5, 1, 2, 3, 4, 5, 5.9].forEach(v => {
    const r = preview.validate(Object.assign({}, RACE_REQUEST, { volume: v }));
    assert.ok(r.ok, v + ' km/week must not be refused -- it must be routed');
    assert.equal(r.input.purpose, 'base', v + ' km/week must preview an Aerobic Base block');
    assert.equal(r.input.routedFrom, 'race');
    assert.equal(r.input.routedReason, 'below_race_goal_entry_volume');
    assert.equal(r.input.hasEvent, false, 'a development block has no event');
    assert.equal(r.input.buildDistance, 'full', 'the distance they are building towards is kept');
    assert.ok(r.input.weeks >= BUILDER_SPEC.validation.weeksRange[0],
      'a routed request that arrived with an event still gets a real block length');
  });
});

test('the preview endpoint leaves a valid race request exactly as it was', () => {
  [6, 6.1, 20, 80].forEach(v => {
    const r = preview.validate(Object.assign({}, RACE_REQUEST, { volume: v }));
    assert.ok(r.ok);
    assert.equal(r.input.purpose, 'race');
    assert.equal(r.input.routedFrom, undefined,
      'a request that was not routed carries no routing fields at all');
    assert.equal(r.input.hasEvent, true);
  });
});

test('the boundary is Race Goal entry, so the other purposes are untouched by it', () => {
  ['base', 'speed', 'maintain'].forEach(p => {
    const r = preview.validate(Object.assign({}, RACE_REQUEST,
      { purpose: p, hasEvent: false, weeks: 8, volume: 2 }));
    assert.ok(r.ok, p + ' must still build at 2km/week');
    assert.equal(r.input.purpose, p);
    assert.equal(r.input.routedFrom, undefined);
  });
});

/* ---------- 5. THE RACE SURVIVES THE ROUTING ---------- */

test('the race the athlete named is recorded before they are routed', () => {
  const gen = SRC.slice(SRC.indexOf('var raceEntry = raceGoalEntry(volume);'),
                        SRC.indexOf('MORE RUNWAY THAN THE RACE PROGRAMME WANTS'));
  assert.ok(/setRaceDestination\(distanceKey, raceDate, goals, activeGoal\)/.test(gen),
    'the destination must be kept, with its goals, before the offer is shown');
  assert.ok(/openRaceGoalEntryModal/.test(gen));
  assert.ok(/return;/.test(gen), 'and nothing may be built past it');
});

test('a race destination survives an Aerobic Base block being built over it', () => {
  const a = app();
  a.setRaceDestination('full', '2027-06-01', { A: { timeSec: 4 * 3600 } }, 'A');
  const before = a.raceDestination();
  assert.ok(before && before.distanceKey === 'full' && before.raceDate === '2027-06-01');
  /* state.setup is replaced wholesale when a block is built; the destination is
     stored top-level precisely so that replacement cannot take it. */
  a.state.setup = { distanceKey: 'full', currentVolume: 4, purpose: 'base' };
  const after = a.raceDestination();
  assert.ok(after, 'the destination must outlive the setup it was recorded beside');
  assert.equal(after.distanceKey, 'full');
  assert.equal(after.raceDate, '2027-06-01');
  assert.equal(after.activeGoal, 'A');
});

/* ---------- 6. NOTHING SWITCHES BACK SILENTLY ---------- */

test('the return to Race Goal is offered, never taken on the athlete behalf', () => {
  const a = app();
  a.setRaceDestination('full', '2027-06-01', {}, null);
  assert.equal(typeof a.raceDestinationDue(), 'boolean',
    'raceDestinationDue() is a question and answers only true or false');
  const fn = SRC.slice(SRC.indexOf('function raceDestinationDue'),
                       SRC.indexOf('function raceDestinationDue') + 400);
  assert.ok(!/handleGeneratePlan|startDevelopmentBlock|buildBlockWeeks/.test(fn),
    'it must not build anything');
});

/* ---------- 7. VALID INPUTS ARE UNTOUCHED ---------- */

test('six kilometres a week builds a real Race Goal block', () => {
  const a = app();
  const blk = a.buildBlockWeeks('full', 6, 15, { purpose: 'race', availableDays: 5 });
  assert.equal(blk.purpose, 'race');
  assert.equal(blk.planWeeks, 15);
  const nonRace = blk.weeks.filter(w => !w.isRace);
  assert.ok(nonRace.length === 14);
  assert.ok(nonRace.every(w => w.volume > 0), 'every week carries running');
  assert.ok(nonRace.every(w => w.longTarget > 0), 'and every week has a long run');
  const peak = Math.max.apply(null, nonRace.map(w => w.volume));
  assert.ok(peak > 6, 'the programme develops from where the athlete is: peak ' + peak);
});

test('the entry boundary changes nothing for a Race Goal at or above it', () => {
  const a = app();
  /* The boundary is asked in the builder, before generation. Nothing inside
     buildBlockWeeks() reads it, so a valid input cannot have been altered by
     it -- asserted directly rather than inferred. */
  const gen = SRC.slice(SRC.indexOf('function buildBlockWeeks'),
                        SRC.indexOf('function buildDaysFromWeeks'));
  assert.ok(!/raceGoalEntry|raceGoalMinWeeklyKm/.test(gen),
    'the generator must not know about the entry boundary');
  assert.ok(a.raceGoalEntry(6).allowed);
});

/* ---------- 8. DEFENSIVE ---------- */

test('a legacy or internal call below the minimum does not corrupt the plan', () => {
  const a = app();
  [0.5, 1, 3, 5].forEach(v => {
    const blk = a.buildBlockWeeks('full', v, 15, { purpose: 'race', availableDays: 5 });
    assert.ok(blk && Array.isArray(blk.weeks) && blk.weeks.length === 15,
      v + ' km/week must still return a well-formed block');
    blk.weeks.forEach(w => {
      assert.ok(isFinite(w.volume) && w.volume >= 0, v + ' km wk' + w.week + ': volume ' + w.volume);
      assert.ok(isFinite(w.longTarget) && w.longTarget >= 0,
        v + ' km wk' + w.week + ': long run ' + w.longTarget);
    });
    const end = a.addDays(a.addDays(TODAY, -a.isoWeekday(TODAY)), blk.planWeeks * 7 - 1);
    const days = a.buildDaysFromWeeks(blk, end, { activeDays: [0, 1, 3, 4, 6], longRunDay: 6 },
                                      TODAY, true, {});
    days.forEach(d => assert.ok(isFinite(d.km) && d.km >= 0,
      v + ' km ' + d.date + ': ' + d.km));
  });
});
