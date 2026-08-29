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
 * THE FIELD IS NOW OCCUPIED. This file used to assert that Valhalla called no
 * AI service at all -- the strongest form of compliance with 5.3 being not to
 * have the capability -- and that was the right assertion for a product with
 * no conversational surface. The Today Voice Coach gives it one.
 *
 * SO THE CLAIM CHANGES SHAPE, AND GETS STRONGER RATHER THAN WEAKER. "No model
 * exists" is replaced by "exactly one model call site exists, and Strava Data
 * provably cannot reach it" -- which is the claim 5.3 actually turns on. The
 * tests below hold it at four independent points: the context is built only
 * from aiEligibleDays(), the server refuses a payload carrying a Strava marker,
 * the Today card offers nothing for a Strava-derived day, and no second call
 * site may appear anywhere in the runtime or the other server functions.
 *
 * WHAT IS NOT CLAIMED HERE. Whether operating a conversational coach at all
 * makes Valhalla an "AI Application" for the purposes of 5.3 -- such that
 * connecting Strava becomes a question even with this fence intact -- is a
 * legal reading, not a property of the code, and it is reported to the founder
 * rather than answered by a test.
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
test('there is exactly ONE model call site, and it is server-side', () => {
  /* The browser must never hold a model endpoint or a key. Everything the
     athlete's device does with voice -- composing the briefing, composing the
     debrief, speaking either aloud -- is local; only Ask Coach leaves, and it
     leaves through the server, which is where the credential lives. */
  const ENDPOINT = /api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis|\/v1\/chat\/completions/i;
  assert.ok(!ENDPOINT.test(RUNTIME),
    'the shipped runtime names a model endpoint -- the browser must never call one directly');
  assert.ok(!/ANTHROPIC_API_KEY|x-api-key/i.test(RUNTIME),
    'a model credential appears in the file served to the browser');

  const callers = fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js'))
    .filter(f => ENDPOINT.test(fs.readFileSync(path.join(ROOT, 'api', f), 'utf8')));
  assert.deepEqual(callers, ['_voice-ask.js'],
    'a second model call site appeared: ' + callers.join(', '));
});

test('the model call site reads no database and no service-role key', () => {
  /* It cannot write a plan because it cannot reach one. The blast radius of a
     hallucinating or compromised model is bounded by what this file can touch,
     and what it can touch is one outbound request. */
  const src = fs.readFileSync(path.join(ROOT, 'api', '_voice-ask.js'), 'utf8');
  assert.ok(!/serviceKey|service_role|rest\/v1/.test(src),
    'the model call site can reach the database');
});

test('the Ask Coach context is built ONLY from AI-eligible days', () => {
  /* The fence, at the point the context is assembled. Not a filter applied
     afterwards -- aiEligibleDays() is the only source the builder reads. */
  const a = athlete();
  const manual = a.state.days.filter(d => d.type === 'easy' && d.date < TODAY)[0];
  manual.completed = true;
  manual.actual = Object.assign(a.emptyActual(), { km: manual.km, pace: '5:30', rpe: 6 });
  const strava = a.state.days.filter(d => d.type === 'easy' && d.date < TODAY)[1];
  importedDay(a, strava);

  const ctx = a.voiceCoachContext();
  const json = JSON.stringify(ctx);
  /* `excluded` became `withheld` when the context started declaring WHY things
     are absent, not merely that they are -- see test/voiceStravaProvenance.js. */
  assert.equal(ctx.withheld.stravaDerivedDays >= 1, true, 'the Strava day was not counted as withheld');
  assert.ok(!/stravaActivityId/.test(json), 'a Strava marker reached the context');
  assert.ok(!json.includes(String(strava.date)) || !ctx.recent.some(r => r.date === strava.date),
    'the Strava-derived day itself reached the context');
  assert.ok(ctx.recent.some(r => r.date === manual.date) || manual.date < a.addDays(TODAY, -14),
    'the athlete\'s own manual day should remain available');
});

test('a poisoned field cannot ride into the context on a day object', () => {
  /* THE WHITELIST PROPERTY. The builder names and copies every field it emits,
     so something added to a day tomorrow is absent by default rather than
     present by accident. A filter would have the opposite failure mode. */
  const a = athlete();
  const d = a.state.days.filter(x => x.type === 'easy' && x.date < TODAY)[0];
  d.completed = true;
  d.actual = Object.assign(a.emptyActual(), { km: d.km, pace: '5:30' });
  d.secretProviderPayload = 'STRAVA-SECRET-MARKER';
  d.actual.providerRaw = 'STRAVA-SECRET-MARKER';
  const json = JSON.stringify(a.voiceCoachContext());
  assert.ok(!/STRAVA-SECRET-MARKER/.test(json),
    'an unknown field was copied into model context -- the builder is filtering, not whitelisting');
});

test('the server refuses a context carrying a Strava marker, rather than cleaning it', () => {
  /* Defence in depth, and deliberately a refusal. If a marker arrives, the
     browser-side fence has failed, and the compliant answer to a failed fence
     is to send nothing -- not to strip what was noticed and forward the rest. */
  const src = fs.readFileSync(path.join(ROOT, 'api', '_voice-ask.js'), 'utf8');
  assert.match(src, /stravaActivityId/, 'the server does not check for a Strava marker');
  assert.match(src, /STRAVA_DERIVED_CONTEXT/, 'there is no explicit refusal code');
  /* ANCHORED ON THE OUTBOUND CALL ITSELF, not on the word "fetch". This used to
     look for `await fetch(`, which stopped existing the moment the request was
     extracted into postModel() so a second caller could reuse the one model
     call site. The invariant never changed -- only the spelling did -- so it is
     now pinned to the thing that actually leaves the building: the fetch that
     names the model endpoint. */
  const refuseAt = src.indexOf('STRAVA_DERIVED_CONTEXT');
  const fetchAt = src.indexOf('fetch(ANTHROPIC_URL');
  assert.ok(refuseAt > 0 && fetchAt > refuseAt,
    'the refusal must happen BEFORE the request leaves');
  /* And the control-flow half, which position alone cannot prove: the refusal
     returns before anything hands the context to the model. */
  const sendAt = src.indexOf('return askUpstream(');
  assert.ok(sendAt > refuseAt,
    'the context reaches the model before the Strava marker is checked');
});

test('a Strava-derived day is never the subject of anything the coach says', () => {
  /* REFUSES RATHER THAN REDACTS, AT THE SURFACE TOO -- and the refusal is
     about the DAY, not about the athlete's whole afternoon.

     WHAT THIS TEST USED TO ASSERT, AND WHY IT CHANGED. It required that no
     control at all was drawn once an activity had been imported, which is
     stronger than the policy needs and was measured on a real device as a
     defect: Ask Coach disappeared, and with it the athlete's own future
     prescription -- Sunday's intervals, their pace, their purpose -- none of
     which came from Strava. 5.4 reaches output generated USING Strava Data. It
     does not reach a session Valhalla wrote before the import existed.

     SO THE CLAIM IS NARROWED WHERE IT WAS TOO WIDE AND TIGHTENED WHERE IT
     MATTERS. The imported day is still refused whole -- it is never the
     subject of a briefing and never enters a context -- and that is now
     asserted positively, by checking WHICH day the control points at, rather
     than negatively by the control's absence. test/askCoachStravaScope.test.js
     holds the rest of the boundary this rests on. */
  const a = athlete();
  a.state.view = 'today';
  const today = a.findDayByDate(TODAY) ||
                a.state.days.filter(d => d.type !== 'rest' && d.km > 0)[0];
  today.date = TODAY;
  importedDay(a, today);
  a.voiceSetAvailable(true);
  const html = a.renderVoiceCard(today);

  /* No briefing, no debrief, nothing spoken ABOUT the imported day. */
  assert.ok(html.indexOf('data-day="' + today.id + '"') === -1,
    'the imported day is the subject of a voice control');
  const m = /data-action="voice-listen" data-day="([^"]+)"/.exec(html);
  if (m){
    const subject = a.state.days.filter(d => d.id === m[1])[0];
    assert.ok(subject && !a.isStravaDerived(subject),
      'the briefing was pointed at another Strava-derived day');
    assert.ok(subject.date > TODAY, 'the briefing was pointed at a completed session');
  }
  /* Pressing the briefing for the imported day is refused by the handler too,
     so the surface is not the only thing holding this. */
  const boom = (what) => () => { throw new Error('the imported day was ' + what); };
  a.voiceSetStatus = boom('given a briefing status');
  a.voiceSpeak = boom('spoken aloud');
  a.handleVoiceListen(today.id);

  assert.match(html, /came from Strava|came in from Strava/,
    'the athlete is not told why the run is off limits');
  assert.equal(a.voiceTodayIsStravaDerived(), true);
  /* And the boundary that actually carries the policy claim is untouched. */
  assert.equal(a.aiContextRefusalReason(today), 'strava_derived');
  assert.equal(a.aiEligibleDays([today]).length, 0);
  assert.equal(a.voiceCoachContext().todaySession, null);
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
