'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');
const S = require('../api/_strava.js');

/* STRAVA API POLICY — THE BOUNDARIES THAT ARE CODE
 * ===========================================================================
 * Policy effective 1 June 2026. Two of its clauses are enforceable in software
 * and are enforced here; the rest are retention and deletion decisions that
 * belong to the founder and are reported rather than invented.
 *
 *   5.3  Strava Data may not be used in the development OR OPERATION of an AI
 *        Application, including ingestion into a context window or working
 *        memory.
 *   5.4  The restrictions "apply to data derived from Strava Data and to
 *        output that incorporates or was generated using Strava Data."
 *
 * THE PRACTICAL CONSEQUENCE. Once a run is imported, the athlete's own
 * training record contains Strava-derived numbers. "Is this a Strava activity"
 * is therefore the wrong question; "did any part of this come from Strava" is
 * the right one, and it has to stay answerable after the import.
 *
 * VALHALLA CALLS NO AI SERVICE TODAY. The fence is built before there is
 * anything on the other side of it, because that is the only order in which
 * building it is cheap.
 */

const ROOT = path.join(__dirname, '..');
const RUNTIME = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const TODAY = '2026-08-24';

function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 10, startDate: a.addDays(TODAY, -14), distanceKey: 'half',
                 volume: 45, benchSec: 45 * 60,
                 schedule: { activeDays: [1,2,3,5,6], longRunDay: 6 } });
  return a;
}
const importedDay = (a, dd) => {
  const act = S.normaliseActivity({
    id: 991, type: 'Run', start_date_local: dd.date + 'T07:00:00Z',
    distance: dd.km * 1000, moving_time: Math.round(dd.km * 270),
    has_heartrate: true, average_heartrate: 158, max_heartrate: 175,
    splits_metric: [{ distance: 1000, moving_time: 268, average_heartrate: 150 },
                    { distance: 1000, moving_time: 271, average_heartrate: 155 },
                    { distance: 1000, moving_time: 265, average_heartrate: 159 },
                    { distance: 1000, moving_time: 262, average_heartrate: 163 }]
  });
  a.stravaWriteActivity(dd, act);
  return dd;
};

// ---------------------------------------------------------------------------
// 5.3 — NO AI, AND NOTHING THAT FEEDS ONE
// ---------------------------------------------------------------------------
test('the product calls no AI service at all', () => {
  /* The strongest form of compliance with 5.3 is not having the capability.
     Asserted on the shipped runtime and on every server function, so a model
     call cannot be added without this failing first. */
  const files = [RUNTIME].concat(
    fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js'))
      .map(f => fs.readFileSync(path.join(ROOT, 'api', f), 'utf8')));
  const BANNED = [/api\.openai\.com/i, /api\.anthropic\.com/i,
                  /generativelanguage\.googleapis/i, /\/v1\/chat\/completions/i,
                  /\bopenai\b/i, /\banthropic\b/i];
  files.forEach(src => BANNED.forEach(rx =>
    assert.ok(!rx.test(src), 'a generative-AI call appeared: ' + rx)));
});

test('nothing invites the athlete to paste their training into an AI chat', () => {
  /* A previous pass removed exactly this: a block that rendered the athlete's
     log -- Strava-derived km, pace and heart rate included -- under "Copy this
     into any AI chat assistant". Valhalla calling no model itself would not
     have saved it; the feature existed to put Strava Data in front of one. */
  /* Checked against CODE, not comments. The runtime explains at length why the
     block was removed, and that explanation naturally quotes the string it is
     about -- scanning the raw file would fire on the note recording the fix. */
  const code = RUNTIME.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert.ok(!/copy this into any ai/i.test(code));
  assert.ok(!/ai chat assistant/i.test(code));
});

test('a Strava-derived day is refused by the AI boundary, whole', () => {
  /* REFUSES RATHER THAN REDACTS. A partially-emptied day is still an object
     shaped by a Strava import, and 5.4 reaches output "generated using"
     Strava Data. Deciding how much derivation is little enough is not a
     judgement to make on a hard boundary. */
  const a = athlete();
  const manual = a.state.days.filter(d => d.type === 'easy' && d.date < TODAY)[0];
  manual.completed = true;
  manual.actual = Object.assign(a.emptyActual(), { km: manual.km, pace: '5:30', rpe: 6 });

  const strava = a.state.days.filter(d => d.type === 'easy' && d.date < TODAY)[1];
  importedDay(a, strava);

  assert.equal(a.isStravaDerived(manual), false);
  assert.equal(a.isStravaDerived(strava), true);
  assert.equal(a.aiContextRefusalReason(strava), 'strava_derived');
  assert.equal(a.aiContextRefusalReason(manual), null);

  const eligible = a.aiEligibleDays([manual, strava]);
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0], manual, 'the Strava-derived day must not pass');
});

test('an athlete who never connected Strava keeps their whole record available', () => {
  /* The boundary must cost nothing to the common case. */
  const a = athlete();
  a.state.days.filter(d => d.type !== 'rest' && d.date < TODAY).forEach(dd => {
    dd.completed = true;
    dd.actual = Object.assign(a.emptyActual(), { km: dd.km, pace: '5:30', rpe: 6 });
  });
  const days = a.state.days.filter(d => d.completed);
  assert.ok(days.length > 5);
  assert.equal(a.aiEligibleDays(days).length, days.length);
});

// ---------------------------------------------------------------------------
// PROVENANCE SURVIVES THE IMPORT
// ---------------------------------------------------------------------------
test('the marker survives into the athlete\'s own training record', () => {
  /* This is the point. Once imported, the numbers live on the day, not in the
     staging table -- so a boundary that only knew about staged rows would be
     answering the wrong question. */
  const a = athlete();
  const dd = importedDay(a, a.state.days.filter(d => d.type === 'easy' && d.date < TODAY)[0]);
  assert.equal(dd.stravaActivityId, '991');

  const round = JSON.parse(JSON.stringify(dd));
  assert.equal(a.isStravaDerived(round), true, 'the marker must survive a reload');
});

test('the tainted-field list names exactly what Strava wrote', () => {
  const a = athlete();
  const dd = importedDay(a, a.state.days.filter(d => d.type === 'easy' && d.date < TODAY)[0]);
  const tainted = a.stravaDerivedFields(dd);

  /* What this fixture actually carries. elapsedTimeSec is deliberately not
     asserted: the fixture omits elapsed_time, so it is absent rather than
     Strava-derived -- and listing an absent field would be the zero-for-unknown
     mistake the whole contract exists to avoid. */
  ['km','pace','hr','maxHR','movingTimeSec','splits']
    .forEach(k => assert.ok(tainted.indexOf(k) !== -1, k + ' is Strava-derived and unlisted'));

  /* And what the athlete said themselves is NOT Strava Data. Strava has no
     opinion about how a run felt, and never writes these. */
  dd.actual.rpe = 7; dd.actual.feel = 'good'; dd.actual.notes = 'legs heavy';
  const after = a.stravaDerivedFields(dd);
  ['rpe','feel','notes'].forEach(k =>
    assert.equal(after.indexOf(k), -1, k + ' is the athlete\'s own and must not be marked Strava'));
});

test('the field list cannot drift from the writer it describes', () => {
  /* A field added to stravaWriteActivity() without being added to
     STRAVA_WRITTEN_FIELDS would be Strava-derived data this boundary does not
     know about -- which is worse than no boundary, because it looks like one. */
  const a = athlete();
  const fn = /function stravaWriteActivity\([^]*?\n\}/.exec(RUNTIME)[0];
  const assigned = (fn.match(/\bA\.([A-Za-z]+)\s*=/g) || [])
    .map(m => m.replace(/^A\./, '').replace(/\s*=$/, ''));
  const unique = Array.from(new Set(assigned));
  assert.ok(unique.length > 0, 'the writer assigns nothing — the regex is wrong');
  unique.forEach(k => assert.ok(a.STRAVA_WRITTEN_FIELDS.indexOf(k) !== -1,
    'stravaWriteActivity writes ' + k + ' but STRAVA_WRITTEN_FIELDS omits it'));
});

test('a day the athlete logged by hand is never marked Strava-derived', () => {
  const a = athlete();
  const dd = a.state.days.filter(d => d.type === 'easy' && d.date < TODAY)[0];
  dd.completed = true;
  dd.actual = Object.assign(a.emptyActual(), { km: dd.km, pace: '5:10', hr: 150, rpe: 6 });
  assert.equal(a.isStravaDerived(dd), false);
  assert.equal(a.stravaDerivedFields(dd).length, 0);
});
