'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* RECOVERY MUST REDUCE TRAINING STRESS, NOT MERELY STOP PROGRESSION.
 *
 * This file exists because the audit's generated evidence said a recovery
 * block was 55km/week with 13-15km of quality and a 15.4km long run in both
 * weeks -- which would not be recovery at all. It was not what any athlete is
 * prescribed: the evidence generator called buildBlockWeeks() alone, and
 * buildBlockWeeks is only the middle third of a recovery block. The volume
 * comes from developmentBlockSpec(), which multiplies by
 * RECOVERY_PROFILE.volumeFactor; the intensity comes from
 * applyRecoveryCeiling(), which runs after the days are laid out.
 *
 * The lesson is the one that matters for a claim made from a generated
 * number: a measurement taken at the wrong layer is not weaker evidence, it
 * is evidence about something else. So every assertion here drives the whole
 * path -- race block, logged, raced, recovered -- and reads the days the
 * athlete would actually see.
 */

const TODAY = '2026-08-21';
const SCHEDULE = { activeDays: [0, 1, 2, 4, 5], longRunDay: 5 };
const QUALITY = ['tempo', 'threshold', 'interval', 'repetition', 'checkpoint', 'race'];

/* A finished race block, fully logged, with the race yesterday -- then the
   recovery block Valhalla offers next. */
function recoverAfter(distanceKey, volume, opts){
  const o = opts || {};
  const today = o.today || TODAY;
  const a = loadApp({ pinnedDate: today + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey, volume, weeks: 12, startDate: a.addDays(today, -84),
                 benchSec: 45 * 60, schedule: SCHEDULE });
  a.state.athlete = a.makeAthleteRecord();
  a.state.setup.purpose = 'race';
  const blk = a.openBlock({ purpose: 'race', startDate: a.state.setup.startDate, distanceKey,
                            goalDate: a.state.setup.raceDate, hasEvent: false,
                            startVolume: volume, anchorVolume: volume });
  a.state.setup.blockId = blk.id;
  a.state.days.filter(d => d.date < today && d.type !== 'rest')
              .forEach(d => logAsPrescribed(a, d, { quality: 1 }));
  const demonstrated = a.demonstratedSustainableVolume();
  a.state.setup.raceDate = o.raceDate || a.addDays(today, -1);
  const block = a.startDevelopmentBlock('recovery', { raceDistanceKey: distanceKey });
  const days = a.state.days.filter(d => d.type !== 'rest');
  const byWeek = {};
  days.forEach(d => { (byWeek[d.week] = byWeek[d.week] || []).push(d); });
  const weekKm = Object.keys(byWeek).map(w =>
    a.round1(byWeek[w].reduce((s, d) => s + (d.km || 0), 0)));
  return { a, block, days, demonstrated, weekKm,
           prescribed: a.state.setup.currentVolume,
           quality: days.filter(d => QUALITY.indexOf(d.type) !== -1),
           longest: a.round1(Math.max.apply(null, days.map(d => d.km || 0))) };
}

const AFTER = [['5k', 40], ['10k', 45], ['half', 55], ['full', 60]];

test('a recovery block is prescribed well below what the athlete has demonstrated', () => {
  AFTER.forEach(([dk, vol]) => {
    const r = recoverAfter(dk, vol);
    const share = r.prescribed / r.demonstrated;
    assert.ok(share <= 0.6,
      dk + ': recovery prescribed ' + r.prescribed + 'km/week against a demonstrated ' +
      r.demonstrated + ' (' + Math.round(share * 100) + '%)');
    // and not so low it is a layoff dressed as a plan
    assert.ok(share >= 0.2, dk + ': recovery collapsed to ' + Math.round(share * 100) + '%');
  });
});

test('the longer the race, the deeper the reduction', () => {
  /* Not a table lookup restated -- the ORDERING is the coaching claim, and it
     must survive the volumes and the profiles that feed it. */
  const shares = AFTER.map(([dk, vol]) => {
    const r = recoverAfter(dk, vol);
    return { dk, share: r.prescribed / r.demonstrated };
  });
  for (let i = 1; i < shares.length; i++)
    assert.ok(shares[i].share <= shares[i - 1].share + 0.001,
      shares[i].dk + ' (' + shares[i].share.toFixed(2) + ') reduced less than ' +
      shares[i - 1].dk + ' (' + shares[i - 1].share.toFixed(2) + ')');
});

test('no quality session survives into a recovery block', () => {
  AFTER.forEach(([dk, vol]) => {
    const r = recoverAfter(dk, vol);
    assert.equal(r.quality.length, 0,
      dk + ': ' + r.quality.map(d => d.date + ' ' + d.title).join(', '));
  });
});

test('a recovery block does not climb', () => {
  AFTER.forEach(([dk, vol]) => {
    const r = recoverAfter(dk, vol);
    const full = r.weekKm.slice(1);              // week 1 is a part week by construction
    if (full.length < 2) return;
    assert.ok(Math.max.apply(null, full) <= Math.min.apply(null, full) * 1.15,
      dk + ': recovery weeks ' + r.weekKm.join(', '));
  });
});

test('the long run in a recovery block is a run, not a long run', () => {
  AFTER.forEach(([dk, vol]) => {
    const r = recoverAfter(dk, vol);
    assert.ok(r.longest <= r.demonstrated * 0.2,
      dk + ': longest recovery run ' + r.longest + 'km against a demonstrated week of ' +
      r.demonstrated);
  });
});

/* ------------------------------------------------------------------ *
 * THE WINDOW AND THE BLOCK ARE MEASURED IN DIFFERENT UNITS
 * ------------------------------------------------------------------ */

test('the intensity ceiling covers the whole recovery block, whatever weekday the race fell on', () => {
  /* applyRecoveryCeiling() suppresses quality for noIntensityDays FROM THE
     RACE; the block is a whole number of calendar WEEKS from the Monday after
     it. Those are not the same length, so between one and four days at the end
     of every recovery block sit outside the window. Whether a quality session
     lands on one of them depends on which weekdays the generator picked --
     which is luck, and a coaching guarantee must not rest on luck. */
  const OFFSETS = [0, 1, 2, 3, 4, 5, 6];
  AFTER.forEach(([dk, vol]) => {
    OFFSETS.forEach(off => {
      const raceDate = '2026-08-' + String(17 + off);
      const today = '2026-08-' + String(18 + off);
      const r = recoverAfter(dk, vol, { today, raceDate });
      assert.equal(r.quality.length, 0,
        dk + ', race on ' + raceDate + ': ' +
        r.quality.map(d => d.date + ' ' + d.type + ' ' + d.title).join(', '));
    });
  });
});
