'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* THE JOIN BETWEEN ONE BLOCK AND THE NEXT, RE-TESTED AGAINST FOUR NEW ARCS.
 *
 * Transitions were verified clean before the programme work: nothing from the
 * old block leaks into the new one, and every completed session is archived to
 * the athlete rather than deleted. Each purpose now has its own shape -- base
 * has no taper and no goal effort, speed has one down week instead of two,
 * recovery no longer ramps -- and a shape change is exactly the kind of change
 * that can quietly reopen a settled question about what carries over.
 *
 * So the whole cycle is walked, in the order an athlete actually lives it.
 */

const TODAY = '2026-08-21';
const QUALITY = ['threshold', 'tempo', 'interval', 'repetition', 'checkpoint', 'race'];

function racedAthlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -84), distanceKey: 'half',
                 volume: 55, benchSec: 45 * 60 });
  a.state.athlete = a.makeAthleteRecord();
  a.state.setup.purpose = 'race';
  const b = a.openBlock({ purpose: 'race', startDate: a.state.setup.startDate,
                          distanceKey: 'half', goalDate: a.state.setup.raceDate, hasEvent: false });
  a.state.setup.blockId = b.id;
  a.state.days.filter(d => d.date < TODAY && d.type !== 'rest')
              .forEach(dd => logAsPrescribed(a, dd));
  const race = a.state.days.filter(d => d.type === 'race')[0];
  if (race && race.date < TODAY) { logAsPrescribed(a, race); try { a.recordRaceOutcome('raced'); } catch (e) {} }
  return a;
}

test('every purpose can be entered from a finished race block', () => {
  ['recovery', 'maintain', 'base', 'speed'].forEach(p => {
    const a = racedAthlete();
    assert.ok(a.startDevelopmentBlock(p), p + ' could not be started');
    assert.equal(a.state.setup.purpose, p);
    assert.ok(a.state.days.length > 0, p + ' produced no days');
  });
});

test('not one day of the old block survives into the new one', () => {
  ['recovery', 'maintain', 'base', 'speed'].forEach(p => {
    const a = racedAthlete();
    const before = a.state.days.map(d => d.id);
    a.startDevelopmentBlock(p);
    const carried = a.state.days.filter(d => before.indexOf(d.id) !== -1);
    // .join(), not deepEqual: arrays built inside the VM realm are not
    // deepStrictEqual to host arrays even when both are empty.
    assert.equal(carried.map(d => d.id).join(','), '',
      p + ' carried ' + carried.length + ' days from the previous block');
  });
});

test('and every completed session is archived rather than deleted', () => {
  ['recovery', 'maintain', 'base', 'speed'].forEach(p => {
    const a = racedAthlete();
    const done = a.state.days.filter(d => d.completed).length;
    assert.ok(done > 20, 'the fixture must have real training behind it');
    a.startDevelopmentBlock(p);
    assert.ok(a.state.athlete.sessions.length >= done,
      p + ' archived ' + a.state.athlete.sessions.length + ' of ' + done + ' completed sessions');
  });
});

test('the new block starts no earlier than today', () => {
  /* The history-placement rule: a new block must not open in the past and drag
     the previous block's weeks into its own week one. */
  ['recovery', 'maintain', 'base', 'speed'].forEach(p => {
    const a = racedAthlete();
    a.startDevelopmentBlock(p);
    const earliest = a.state.days.map(d => d.date).sort()[0];
    assert.ok(earliest >= a.addDays(TODAY, -6),
      p + ' opened on ' + earliest + ', which is before the week the athlete is in');
  });
});

test('each new block has the shape its purpose calls for', () => {
  const expectations = {
    recovery: b => {
      assert.equal(b.weeks.filter(w => w.isRace).length, 0, 'recovery ends in a goal effort');
      assert.ok(b.weeks.every(w => w.volume <= b.peakVolume + 0.1), 'recovery climbs');
    },
    maintain: b => {
      assert.ok(b.weeks.every(w => w.phase === 'Maintain'), 'maintenance has an arc');
      assert.equal(b.weeks.filter(w => w.hasGoalSegment).length, 0, 'maintenance carries goal pace');
    },
    base: b => {
      assert.equal(b.taperWeeks, 0, 'the base block tapers');
      assert.equal(b.weeks.filter(w => w.isRace).length, 0, 'the base block ends in a goal effort');
      assert.ok(b.weeks.filter(w => w.phase === 'Base').length >= b.weeks.length * 0.6,
        'the base block is not mostly base weeks');
    },
    speed: b => {
      assert.equal(b.weeks.filter(w => w.isRace).length, 1, 'the speed block lost its benchmark');
      assert.ok(b.buildWeeks >= 4 || b.planWeeks < 6, 'the speed block is back to three development weeks');
    },
  };
  Object.keys(expectations).forEach(p => {
    const a = racedAthlete();
    a.startDevelopmentBlock(p);
    const su = a.state.setup;
    expectations[p](a.buildBlockWeeks(su.distanceKey, su.currentVolume, su.planWeeks,
      { purpose: p, steady: p === 'maintain' }));
  });
});

test('a recovery block still holds no intensity inside its window', () => {
  const a = racedAthlete();
  const raceDate = a.state.days.filter(d => d.type === 'race')[0].date;
  a.startDevelopmentBlock('recovery');
  const until = a.addDays(raceDate, a.recoveryProfileFor('half').noIntensityDays);
  a.state.days.filter(d => d.date <= until).forEach(d =>
    assert.equal(QUALITY.indexOf(d.type), -1,
      'a ' + d.type + ' session sits inside the no-intensity window on ' + d.date));
});

test('the volume ceiling holds across a whole cycle of transitions', () => {
  /* The block-to-block loop the ceiling exists to close, walked end to end
     rather than reasoned about. */
  const a = racedAthlete();
  const ceiling = a.volumeCeilingFor('half');
  ['recovery', 'maintain', 'base', 'speed'].forEach(p => {
    a.startDevelopmentBlock(p);
    const su = a.state.setup;
    assert.ok(su.currentVolume <= ceiling + 0.1,
      p + ' opened at ' + su.currentVolume + 'km/week against a ceiling of ' + ceiling);
    a.state.days.filter(d => d.date < a.addDays(TODAY, 21) && d.type !== 'rest')
                .forEach(dd => logAsPrescribed(a, dd));
  });
});

test('the block ledger records each transition once, with the purpose it went to', () => {
  const a = racedAthlete();
  ['recovery', 'maintain', 'base'].forEach(p => a.startDevelopmentBlock(p));
  const purposes = a.state.athlete.blocks.map(b => b.purpose).join(' ');
  assert.equal(purposes, 'race recovery maintain base');
  const closed = a.state.athlete.blocks.filter(b => b.status === 'closed');
  assert.equal(closed.length, 3, 'a finished block was left open');
  assert.equal(a.state.athlete.blocks.filter(b => b.status === 'active').length, 1);
});

test('and the rotation turns with it, so a second maintenance block is a different one', () => {
  const a = racedAthlete();
  a.startDevelopmentBlock('maintain');
  const first = a.state.days.filter(d => d.type !== 'rest')
                            .map(d => d.title).join('|');
  a.state.days.filter(d => d.date < a.addDays(TODAY, 40) && d.type !== 'rest')
              .forEach(dd => logAsPrescribed(a, dd));
  a.startDevelopmentBlock('maintain');
  const second = a.state.days.filter(d => d.type !== 'rest')
                             .map(d => d.title).join('|');
  assert.notEqual(first, second, 'the second maintenance block is the first one again');
});
