'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* OFFLINE VOICE ASK — THE COACH THAT STILL WORKS WITH NO SIGNAL
 * ===========================================================================
 * WHAT IS BEING PROTECTED. Ask Coach is Claude. With no network it used to say
 * "Your coach is not responding", which is true and useless: the athlete is
 * standing at the start of a session whose pace, structure and purpose are
 * already on the device. The local layer reads those out. It is deterministic,
 * it writes no coaching of its own, and it is not a model.
 *
 * THE THREE THINGS THAT MUST NOT DRIFT, all of which fail quietly:
 *
 *   1. A CONFIGURATION FAULT IS NOT AN OUTAGE. A missing API key, a 401, a
 *      429, a 502 from the model -- every one of those reached a server, and
 *      relabelling any of them "offline" hides a real fault behind a
 *      reassuring sentence and sends whoever is diagnosing it to the wrong
 *      continent. Only a request that never connected is offline.
 *
 *   2. A LOCAL ANSWER CANNOT TOUCH THE PLAN. It never sets needsPlanChange and
 *      never reaches coachProposedChangeDayId(). Both are asserted, because
 *      the first is a property of one function and the second is the thing
 *      that actually matters.
 *
 *   3. THE ATHLETE IS NEVER MISLED. An offline answer says so, quietly, and
 *      the card does not become an error state while useful guidance is on it.
 */

const TODAY = '2026-09-03';

/* An athlete with a real plan, signed in, coach switched on -- the state every
   test below varies exactly one thing from. Speech and rendering are stubbed
   because neither exists in the sandbox and neither is what is under test;
   where speech IS under test the stub is replaced. */
function app(opts){
  const o = opts || {};
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  buildPlan(a, { startDate: a.addDays(a.todayStr(), -35), weeks: 12 });
  a.voiceCoachAvailable = true;
  a.cloudSession = { access_token:'t', refresh_token:'r',
                     expires_at: Date.now() + 3600000, user_id:'u', email:'a@b.c' };
  a.patchVoiceCard = () => {};
  a.setTimeout = (fn) => { fn(); return 0; };
  a.navigator.onLine = o.onLine !== false;
  a.spoken = [];
  /* Kept so the real dispatcher can still be exercised where it is the thing
     under test, rather than only its stub. */
  a.realVoiceSpeak = a.voiceSpeak;
  a.voiceSpeak = (text, sopts) => { a.spoken.push({ text, opts: sopts || {} }); return true; };
  a.askAnnounceAnswer = (t) => { a.announced = t; };
  a.coachCalls = [];
  return a;
}
const ask = (a, q) => a.askSend(q);

/* WHAT "OPENED NO REQUEST" ACTUALLY MEANS, and it is narrower than it first
   looks. The app refreshes its Supabase session on its own schedule, and that
   keeps happening offline -- it is not Ask Coach and it is not this pass's to
   change. A first version of these tests counted every fetch and failed on
   that background refresh, which would have been a test measuring the wrong
   thing rather than a defect. What must be true is that the COACH is not
   called: no /api/voice-ask request is opened when there is nothing to carry
   it. Everything else is answered inertly so a stray call cannot masquerade as
   the coach's reply. */
function stubFetch(a, coach){
  a.fetch = (url, init) => {
    const u = String(url || '');
    if (u.indexOf('/api/voice-ask') !== -1){
      a.coachCalls.push(init && init.body);
      return coach ? coach(u, init) : Promise.reject(new TypeError('Failed to fetch'));
    }
    /* The session refresh is answered with a VALID token rather than an empty
       object. An empty 200 reads as a refresh that failed, the app signs the
       athlete out, and every test after it fails with "Sign in to talk to your
       coach" -- a fixture artefact that looks exactly like a real regression in
       the code under test. */
    if (u.indexOf('grant_type=refresh_token') !== -1){
      return Promise.resolve({
        ok:true, status:200, headers:{ get: () => 'application/json' },
        json: () => Promise.resolve({ access_token:'t2', refresh_token:'r2', expires_in:3600 })
      });
    }
    return Promise.resolve({
      ok:true, status:200, headers:{ get: () => 'application/json' },
      json: () => Promise.resolve({}), text: () => Promise.resolve('')
    });
  };
}
const jsonCoach = (status, body) => () => Promise.resolve({
  ok: status >= 200 && status < 300, status: status,
  headers:{ get: () => 'application/json' },
  json: () => Promise.resolve(body)
});

// ---------------------------------------------------------------------------
// 1. CONNECTIVITY — WHICH FAILURES ARE OFFLINE, AND WHICH ARE NOT
// ---------------------------------------------------------------------------

test('a device that knows it is offline answers locally and opens no request', async () => {
  const a = app({ onLine: false });
  stubFetch(a, null);
  const r = await ask(a, 'What am I doing today?');
  assert.equal(a.coachCalls.length, 0, 'a doomed request to the coach was made before the local answer');
  assert.equal(r.source, 'offline-local');
  assert.ok(r.answer.length > 0);
  assert.equal(a.askState.status, 'answered');
});

test('apparent connectivity that turns out to be none falls back to the local answer', async () => {
  /* navigator.onLine is famously optimistic: a captive portal, a wifi network
     with no route out and a dead DNS server all report true. The fetch is what
     finds out. */
  const a = app({ onLine: true });
  stubFetch(a, null);
  const r = await ask(a, 'What pace should I run?');
  assert.equal(a.coachCalls.length, 1, 'the request should be attempted exactly once');
  assert.equal(r.source, 'offline-local');
  assert.equal(a.askState.status, 'answered');
});

test('one failed request, not a retry loop, before the local answer appears', async () => {
  const a = app({ onLine: true });
  stubFetch(a, null);
  await ask(a, 'What am I doing today?');
  assert.equal(a.coachCalls.length, 1,
    'repeated automatic retries put a long delay in front of an answer that was always available');
});

test('a configuration fault is NOT turned into offline mode', async () => {
  /* The whole point of the classification. A 503 from a deployment that was
     never given an API key must keep saying so. */
  const a = app({ onLine: true });
  stubFetch(a, jsonCoach(503, { error:'voice_not_configured', code:'VOICE_NOT_CONFIGURED' }));
  const r = await ask(a, 'What am I doing today?');
  assert.equal(r, null, 'a config fault produced an answer instead of an error');
  assert.equal(a.askState.status, 'error');
  assert.equal(a.askState.message, a.VOICE_ERROR_COPY.voice_not_configured);
  assert.notEqual(a.askState.source, 'offline-local');
});

test('an authentication fault is NOT turned into offline mode', async () => {
  const a = app({ onLine: true });
  stubFetch(a, jsonCoach(401, { error:'not_signed_in' }));
  const r = await ask(a, 'What pace should I run?');
  assert.equal(r, null);
  assert.equal(a.askState.status, 'error');
  assert.equal(a.askState.message, a.VOICE_ERROR_COPY.not_signed_in);
});

test('a model or rate-limit fault is NOT turned into offline mode', async () => {
  for (const c of [['coach_unavailable', 502], ['coach_busy', 429]]){
    const a = app({ onLine: true });
    stubFetch(a, jsonCoach(c[1], { error:c[0] }));
    await ask(a, 'What am I doing today?');
    assert.equal(a.askState.status, 'error', c[0] + ' became something other than an error');
    assert.equal(a.askState.message, a.VOICE_ERROR_COPY[c[0]]);
  }
});

test('the classifier itself: only a request that never connected counts as offline', () => {
  const a = app({});
  assert.equal(a.askTransportUnreachable(new TypeError('Failed to fetch')), true);
  assert.equal(a.askTransportUnreachable({ code:'voice_not_configured' }), false);
  assert.equal(a.askTransportUnreachable({ code:'not_signed_in' }), false);
  assert.equal(a.askTransportUnreachable({ status:502 }), false);
  assert.equal(a.askTransportUnreachable(new Error('something else')), false);
  assert.equal(a.askTransportUnreachable(null), false);
});

test('a deployment with no coach still says so, offline or not', () => {
  /* Configuration outranks connectivity: telling this athlete there is no
     signal would be a lie about a feature that was never switched on. */
  const a = app({ onLine: false });
  a.voiceCoachAvailable = false;
  stubFetch(a, null);
  return ask(a, 'What am I doing today?').then(r => {
    assert.equal(r, null);
    assert.equal(a.askState.status, 'error');
    assert.equal(a.askState.message, a.VOICE_ERROR_COPY.voice_disabled);
    assert.equal(a.coachCalls.length, 0);
  });
});

test('online, the normal cloud path is used and is unchanged', async () => {
  const a = app({ onLine: true });
  stubFetch(a, jsonCoach(200, { answer:'Cloud coaching.', needsPlanChange:false, complete:true }));
  const r = await ask(a, 'How am I progressing?');
  assert.equal(a.coachCalls.length, 1);
  assert.equal(r.answer, 'Cloud coaching.');
  assert.notEqual(a.askState.source, 'offline-local');
});

test('connectivity restored: the very next question goes back to the cloud', async () => {
  const a = app({ onLine: false });
  stubFetch(a, jsonCoach(200, { answer:'Cloud coaching.', needsPlanChange:false, complete:true }));
  const first = await ask(a, 'What am I doing today?');
  assert.equal(first.source, 'offline-local');
  assert.equal(a.coachCalls.length, 0);
  /* No switch, no setting, no reload: the next question simply asks again. */
  a.navigator.onLine = true;
  const second = await ask(a, 'How am I progressing?');
  assert.equal(a.coachCalls.length, 1);
  assert.equal(second.answer, 'Cloud coaching.');
  assert.notEqual(a.askState.source, 'offline-local');
});

test('nothing is queued and nothing is re-sent when the network comes back', async () => {
  const a = app({ onLine: false });
  stubFetch(a, jsonCoach(200, { answer:'Cloud.', complete:true }));
  await ask(a, 'What am I doing today?');
  a.navigator.onLine = true;
  /* Coming back online is not an event this layer listens to. The athlete's
     offline question stays answered and stays theirs; nothing is replayed to
     the model behind their back. */
  assert.equal(a.coachCalls.length, 0, 'an offline question was submitted later without the athlete asking');
});

// ---------------------------------------------------------------------------
// 2. THE INTENTS
// ---------------------------------------------------------------------------

const local = (q) => app({ onLine:false }).askLocalResolve(q);

test("today's session is answered from the prescription", () => {
  const a = app({});
  const dd = a.findDayByDate(TODAY);
  const r = a.askLocalResolve('What am I doing today?');
  assert.equal(r.source, 'offline-local');
  assert.ok(r.answer.indexOf(dd.title) !== -1,
    'the answer did not name the session on the card: ' + r.answer);
  assert.equal(r.limited, false);
});

test('the pace question returns the range the card already shows', () => {
  const a = app({});
  const targets = a.getDayTargets(a.findDayByDate(TODAY));
  assert.ok(targets.pace, 'fixture has no pace target, so this proves nothing');
  const r = a.askLocalResolve('What pace should I run?');
  assert.ok(r.answer.indexOf(targets.pace) !== -1,
    'the answer did not carry the prescribed range: ' + r.answer);
});

test('the workout-step question reads back the structured session', () => {
  const a = app({});
  const steps = a.workoutSteps(a.findDayByDate(TODAY));
  assert.ok(steps && steps.length, 'fixture day has no steps, so this proves nothing');
  const r = a.askLocalResolve('What are the intervals?');
  const qty = a.renderStepQty(steps[0]);
  assert.ok(r.answer.indexOf(qty) !== -1,
    'the first step was not in the answer: ' + r.answer);
});

test('the rationale question uses the plan’s own purpose copy, not a new sentence', () => {
  const a = app({});
  const dd = a.findDayByDate(TODAY);
  const purpose = a.coachIntentLine(dd);
  assert.ok(purpose, 'fixture day has no intent line, so this proves nothing');
  const r = a.askLocalResolve('Why am I doing this session?');
  assert.ok(r.answer.indexOf(purpose) !== -1,
    'the answer invented a purpose instead of reading the plan’s: ' + r.answer);
});

test('the next session is named and dated from the plan', () => {
  const a = app({});
  const next = a.askLocalNextSession();
  assert.ok(next, 'fixture has no next session');
  const r = a.askLocalResolve("What's tomorrow's session?");
  assert.ok(r.answer.indexOf(next.title) !== -1, r.answer);
});

test('the long run, the phase and the rest-day question all answer from local state', () => {
  const a = app({});
  const lr = a.askLocalResolve('What is my long run this week?');
  assert.ok(/long run this week is on/i.test(lr.answer), lr.answer);
  const ph = a.askLocalResolve('What phase am I in?');
  assert.ok(ph.answer.indexOf(a.trainingPhase(a.currentWeekNum())) !== -1, ph.answer);
  const rest = a.askLocalResolve('Is today a recovery day?');
  assert.ok(/rest day/i.test(rest.answer), rest.answer);
});

test('a term is explained with the app’s own authored copy', () => {
  const a = app({});
  const r = a.askLocalResolve('What does threshold mean?');
  assert.ok(r.answer.indexOf(a.VOICE_SPOKEN.threshold.purpose) !== -1,
    'the explanation was not the authored one: ' + r.answer);
});

test('"how long" asks about distance and is not read as the long run', () => {
  /* One phrase table, so a near-collision like this is worth pinning. */
  const a = app({});
  const r = a.askLocalResolve('How long is my run today?');
  assert.ok(/6\.5km|6\.5mi/.test(r.answer) || r.answer.indexOf(a.fmtDist(a.findDayByDate(TODAY).km)) !== -1,
    'the distance question did not answer with the distance: ' + r.answer);
});

// ---------------------------------------------------------------------------
// 3. WHAT IT WILL NOT DO
// ---------------------------------------------------------------------------

test('an unsupported question says so plainly and offers what it does have', () => {
  const r = local('Who won the 1996 Olympic marathon?');
  assert.equal(r.limited, true);
  assert.match(r.answer, /offline/i);
  assert.match(r.answer, /today’s session/i);
  /* No blame, and no technical vocabulary. */
  assert.doesNotMatch(r.answer, /error|failed|fetch|network|api|claude|anthropic|exception/i);
});

test('a supported question with no data behind it says the data is missing, not that the question was wrong', () => {
  const a = app({});
  a.state.days = a.state.days.filter(d => d.date !== TODAY);   // today's prescription gone
  const r = a.askLocalResolve('What pace should I run?');
  assert.equal(r.limited, true);
  assert.match(r.answer, /don’t have that on the device/i);
});

test('with no plan at all the local layer offers nothing it cannot support', () => {
  const a = app({});
  a.state.days = [];
  const r = a.askLocalResolve('What am I doing today?');
  assert.equal(r.limited, true);
  assert.match(r.answer, /don’t have that on the device/i);
});

test('a health question gets the same boundary the coach has, without a local diagnosis', () => {
  const a = app({});
  const r = a.askLocalResolve('My knee hurts, should I still run today?');
  assert.equal(r.limited, true);
  assert.match(r.answer, /not a doctor/i);
  /* It must not have answered with a session instead. */
  assert.ok(r.answer.indexOf(a.findDayByDate(TODAY).title) === -1,
    'a symptom was answered with a training prescription: ' + r.answer);
});

test('a remote-data question does not imply it has reached anything', () => {
  const r = local('Has my Strava run synced yet?');
  assert.equal(r.limited, true);
  assert.match(r.answer, /can’t reach Strava/i);
});

test('a Strava-derived day is not discussed offline either', () => {
  /* The same provenance boundary the cloud coach enforces, read here rather
     than decided again. */
  const a = app({});
  const dd = a.findDayByDate(TODAY);
  dd.stravaActivityId = 12345;
  assert.equal(a.isStravaDerived(dd), true, 'fixture did not become Strava-derived');
  const r = a.askLocalResolve('What am I doing today?');
  assert.equal(r.limited, true, 'a Strava-derived session was described offline: ' + r.answer);
});

// ---------------------------------------------------------------------------
// 4. THE PLAN IS UNTOUCHABLE
// ---------------------------------------------------------------------------

test('every local answer carries needsPlanChange false and no change reason', () => {
  const a = app({});
  ['What am I doing today?', 'Why am I doing this session?', 'What pace should I run?',
   'Should I change tomorrow to an easy run?', 'My calf hurts', 'Anything at all'].forEach(q => {
    const r = a.askLocalResolve(q);
    assert.equal(r.needsPlanChange, false, q);
    assert.equal(r.changeReason, null, q);
    assert.equal(r.source, 'offline-local', q);
  });
});

test('askResult forces the plan fields for a local answer even when handed the opposite', () => {
  /* The line where "a local answer cannot propose a change" stops being a
     convention and becomes impossible. */
  const a = app({});
  const r = a.askResult({ answer:'x', source:'offline-local',
                          needsPlanChange:true, changeReason:'because' });
  assert.equal(r.needsPlanChange, false);
  assert.equal(r.changeReason, null);
});

test('an offline answer never reaches coachProposedChangeDayId()', async () => {
  const a = app({ onLine:false });
  let consulted = 0;
  a.coachProposedChangeDayId = () => { consulted++; return 'some-day-id'; };
  stubFetch(a, null);
  await ask(a, 'Should I back off tomorrow?');
  assert.equal(consulted, 0, 'the offline path entered the plan-change pipeline');
  assert.equal(a.askState.proposalDayId, null);
});

test('the proposal gate refuses a local source even if one arrived with the flag set', async () => {
  const a = app({ onLine:true });
  let consulted = 0;
  a.coachProposedChangeDayId = () => { consulted++; return 'd1'; };
  stubFetch(a, jsonCoach(200, { answer:'x', source:'offline-local',
                                needsPlanChange:true, complete:true }));
  await ask(a, 'Should I back off?');
  assert.equal(consulted, 0, 'the source test in the proposal gate is not doing its job');
  assert.equal(a.askState.proposalDayId, null);
});

// ---------------------------------------------------------------------------
// 5. STALENESS
// ---------------------------------------------------------------------------

test('a plan the app already knows may be behind the server is answered with a caveat', () => {
  const a = app({});
  const clean = a.askLocalResolve('What am I doing today?');
  assert.doesNotMatch(clean.answer, /last saved on this device/i);
  a.state.cloudDirty = true;
  const stale = a.askLocalResolve('What am I doing today?');
  assert.match(stale.answer, /last saved on this device/i,
    'a plan known to be unsynced was presented as unquestionably current');
  /* The answer itself survives the caveat -- this is a note, not a refusal. */
  assert.ok(stale.answer.indexOf(a.findDayByDate(TODAY).title) !== -1);
});

// ---------------------------------------------------------------------------
// 6. SPEECH AND THE SURFACE
// ---------------------------------------------------------------------------

test('an offline answer is spoken through the device, never through the cloud voice', async () => {
  const a = app({ onLine:false });
  stubFetch(a, null);
  await ask(a, 'What am I doing today?');
  assert.equal(a.spoken.length, 1, 'the answer was not offered to the speech path');
  assert.equal(a.spoken[0].opts.localOnly, true,
    'offline speech would have opened a network request for its audio');
});

test('voiceSpeak honours localOnly by going straight to the device engine', () => {
  const a = app({});
  let cloud = 0, native = 0;
  a.voiceCloudEligible = () => true;
  a.voiceCloudSpeak = () => { cloud++; return true; };
  a.voiceSpeakNative = () => { native++; return true; };
  a.realVoiceSpeak('hello', { localOnly:true });
  assert.equal(cloud, 0);
  assert.equal(native, 1);
  a.realVoiceSpeak('hello', {});
  assert.equal(cloud, 1, 'the ordinary path stopped preferring the cloud voice');
});

test('the text answer survives a speech path that throws', async () => {
  const a = app({ onLine:false });
  a.voiceSpeak = () => { throw new Error('no tts on this device'); };
  stubFetch(a, null);
  const r = await ask(a, 'What pace should I run?');
  assert.equal(r.source, 'offline-local');
  assert.ok(r.answer.length > 0, 'a TTS failure took the text answer with it');
  assert.equal(a.askState.status, 'answered');
});

test('the card shows a quiet source note and does not become an error state', () => {
  const a = app({});
  a.patchVoiceCard = () => {};
  a.askSet('answered', { heard:'What pace?', answer:'Your prescribed range is 4:47–5:05/km.',
                         source:'offline-local' });
  const html = a.renderAskPanel(a.findDayByDate(TODAY));
  assert.ok(html.indexOf('Offline guidance') !== -1, 'the athlete is not told where this came from');
  assert.ok(html.indexOf('ask-error') === -1, 'useful guidance was rendered as an error');
  assert.ok(html.indexOf('4:47') !== -1);
  /* No technical vocabulary anywhere on the surface. */
  assert.doesNotMatch(html.replace(/<!--[\s\S]*?-->/g, ''),
    /fetch failed|network exception|api failure|model offline|anthropic|claude unavailable/i);
});

test('a cloud answer carries no source note', () => {
  const a = app({});
  a.askSet('answered', { answer:'Cloud coaching.', source:'cloud' });
  assert.ok(a.renderAskPanel(a.findDayByDate(TODAY)).indexOf('Offline guidance') === -1);
});

test('the source note cannot outlive the answer it described', () => {
  const a = app({});
  a.askSet('answered', { answer:'Local.', source:'offline-local' });
  a.askSet('thinking', { heard:'next question' });
  assert.equal(a.askState.source, 'cloud',
    'a stale offline note would be shown beside the next cloud answer');
});

test('accessibility: the answer is announced once and the note is not a second live region', () => {
  const a = app({});
  a.askSet('answered', { answer:'Local answer.', source:'offline-local' });
  const html = a.renderAskPanel(a.findDayByDate(TODAY));
  /* Exactly one polite announcement region for the answer, as on the cloud
     path -- a second one beside it reads the provenance over the coaching. */
  assert.equal((html.match(/id="ask-answer-announce"/g) || []).length, 1);
  const note = html.slice(html.indexOf('ask-source'));
  assert.ok(note.indexOf('aria-live') === -1, 'the source note became a live region');
  assert.ok(note.indexOf('role="alert"') === -1, 'the source note announces itself as an alert');
});

test('the offline answer is announced to assistive technology exactly as a cloud one is', async () => {
  const a = app({ onLine:false });
  stubFetch(a, null);
  const r = await ask(a, 'What am I doing today?');
  assert.equal(a.announced, r.answer, 'the offline answer was never announced');
});
