'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');
const S = require('../api/_strava.js');

/* ASK COACH AFTER A STRAVA SYNC — SCOPE, NOT SILENCE
 * ===========================================================================
 * WHAT CHANGED, AND WHAT DELIBERATELY DID NOT.
 *
 * The Strava boundary is unchanged. A day whose numbers came in from Strava is
 * still refused WHOLE: it is removed from the model context before a context
 * object exists, its debrief is never spoken, and the server refuses any
 * payload carrying a Strava marker. Nothing in this file relaxes any of that,
 * and several tests below exist only to prove it did not move.
 *
 * WHAT WAS WRONG was the SCOPE of the consequence. Because today's completed
 * session had been imported, the whole voice surface was withdrawn -- taking
 * Ask Coach with it, and with Ask Coach the athlete's own future prescription:
 * Sunday's intervals, their pace, their purpose, the phase of the block. None
 * of that came from Strava. Refusing to discuss it was withholding Valhalla's
 * coaching from the athlete for a reason that was not theirs.
 *
 * SO THE RESTRICTION MOVED FROM THE DAY TO THE QUESTION. Two mechanisms, and
 * it matters which is which:
 *
 *   THE BOUNDARY is voiceCoachContext(). It is the thing that makes the
 *   privacy claim true, it never sends an imported day, and it is unchanged.
 *
 *   THE GATE is askRequiresStravaSession(). It is a QUALITY mechanism: a
 *   retrospective question would otherwise reach a model holding nothing that
 *   could answer it and come back as an apology. It is deliberately NARROW,
 *   because a question it misses costs one slow refusal while a question it
 *   wrongly catches costs the athlete coaching they were entitled to.
 *
 * The tests are grouped by which of those two they hold.
 */

const TODAY = '2026-09-03';

/* An athlete mid-block, signed in, coach switched on. Today's session is a
   real prescribed session so that importing an activity onto it is the case
   the founder actually hit on the device. */
function app(opts){
  const o = opts || {};
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { startDate: a.addDays(TODAY, -35), weeks: 12 });
  a.state.view = 'today';
  a.voiceCoachAvailable = true;
  a.cloudSession = { access_token:'t', refresh_token:'r',
                     expires_at: Date.now() + 3600000, user_id:'u', email:'a@b.c' };
  a.patchVoiceCard = () => {};
  a.setTimeout = (fn) => { fn(); return 0; };
  a.navigator.onLine = o.onLine !== false;
  a.spoken = [];
  a.voiceSpeak = (text, sopts) => { a.spoken.push({ text, opts: sopts || {} }); return true; };
  a.askAnnounceAnswer = (t) => { a.announced = t; };
  a.coachCalls = [];
  return a;
}

/* Today's day, whatever the generator put there. */
const todayDay = (a) => a.findDayByDate(TODAY);

/* THE NUMBERS THAT MUST NEVER TRAVEL. Distinctive on purpose: a heart rate of
   158 or a 4:28 kilometre could plausibly appear in a plan, but 163/174 as a
   pair with these exact splits could only have come from this import. */
const IMPORT = {
  id: 4242, type: 'Run', distance: 12000, moving_time: 3216,
  has_heartrate: true, average_heartrate: 163, max_heartrate: 174,
  total_elevation_gain: 88, average_cadence: 89,
  splits_metric: [{ distance: 1000, moving_time: 271, average_heartrate: 158 },
                  { distance: 1000, moving_time: 264, average_heartrate: 161 },
                  { distance: 1000, moving_time: 259, average_heartrate: 167 }]
};

/* Import an activity onto a day, through the real writer, so the record under
   test is the one the app itself would have produced. */
function importOnto(a, dd){
  const act = S.normaliseActivity(Object.assign(
    { start_date_local: dd.date + 'T07:00:00Z' }, IMPORT));
  a.stravaWriteActivity(dd, act);
  return dd;
}

/* The athlete's own words about the run, and their own RPE. These are NOT
   Strava's -- Strava has no opinion about how a run felt -- but they belong to
   a day the import touched, and the boundary refuses that day whole rather
   than deciding how much derivation is little enough. */
function athleteWroteAbout(dd){
  dd.actual = dd.actual || {};
  dd.actual.rpe = 8;
  dd.actual.feel = 'rough';
  dd.notes = 'Legs were flat from the start, ZORBLAX pacing all over the place.';
  return dd;
}

/* A day the athlete logged THEMSELVES, complete enough to be scored -- which is
   what a debrief needs. Deliberately the same shape voiceCoach.test.js uses,
   so "a manual day is unaffected" is measured against the existing fixture
   rather than against a weaker one invented here. */
function completeManually(a, dd){
  a.applyCompletion(dd, true);
  dd.actual = Object.assign(a.emptyActual(), { km: dd.km, pace: '5:20', rpe: 6 });
  return dd;
}

function stubFetch(a, coach){
  a.fetch = (url, init) => {
    const u = String(url || '');
    if (u.indexOf('/api/voice-ask') !== -1){
      a.coachCalls.push(init && init.body);
      return coach ? coach(u, init) : Promise.reject(new TypeError('Failed to fetch'));
    }
    /* A VALID token, not an empty 200: an empty body reads as a failed refresh,
       the app signs the athlete out, and every assertion after it fails with
       "Sign in to talk to your coach" -- a fixture artefact wearing the costume
       of a real regression. */
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
const answers = (body) => () => Promise.resolve({
  ok:true, status:200, headers:{ get: () => 'application/json' },
  json: () => Promise.resolve(body)
});

// ---------------------------------------------------------------------------
// 1. THE SURFACE — THE COACH DOES NOT DISAPPEAR
// ---------------------------------------------------------------------------

test('an imported session does not take Ask Coach away when there is a safe next session', () => {
  const a = app();
  importOnto(a, todayDay(a));
  const html = a.renderVoiceCard(todayDay(a));
  assert.match(html, /data-action="voice-ask-open"/,
    'Ask Coach vanished because today came in from Strava');
  assert.ok(a.askLocalNextSession(), 'the fixture has no future session to be safe about');
});

test('the briefing offered is about the NEXT session, and that session is Valhalla-owned', () => {
  const a = app();
  const today = importOnto(a, todayDay(a));
  const html = a.renderVoiceCard(today);
  const m = /data-action="voice-listen" data-day="([^"]+)"/.exec(html);
  assert.ok(m, 'no briefing was offered at all');
  assert.notEqual(m[1], today.id, 'the briefing is about the imported session');
  const subject = a.state.days.filter(d => d.id === m[1])[0];
  assert.ok(subject, 'the briefing points at a day that is not in the plan');
  assert.equal(a.isStravaDerived(subject), false,
    'the briefing was pointed at another Strava-derived day');
  assert.ok(subject.date > TODAY, 'the briefing was pointed backwards');
  assert.match(html, /what’s next/, 'the control still claims to be about today');
});

test('the athlete is told what the coach can and cannot do, in one line', () => {
  const a = app();
  importOnto(a, todayDay(a));
  const html = a.renderVoiceCard(todayDay(a));
  assert.match(html, /came from Strava/, 'the athlete is not told why the run is off limits');
  assert.match(html, /can still help with what’s next/,
    'the athlete is not told what is still available');
  /* Restraint: one quiet note, not a panel, and not a second copy of the
     written review that is already on the card above. */
  assert.equal((html.match(/voice-note/g) || []).length, 1,
    'more than one explanatory note was drawn');
  assert.ok(!/voice-warning|alert/.test(html), 'the note escalated into a warning');
});

test('with no safe next session the original refusal is kept, not manufactured content', () => {
  /* The preferred behaviour has a floor: where there is nothing Valhalla owns
     to talk about, the honest answer is still the one it always was. Nothing
     is invented to fill the space. */
  const a = app();
  const today = importOnto(a, todayDay(a));
  /* Every future day removed, so askLocalNextSession() has nothing to return. */
  a.state.days = a.state.days.filter(d => d.date <= TODAY);
  a.voiceCoachAvailable = false;              // and no cloud coach either
  const html = a.renderVoiceCard(today);
  assert.ok(!/data-action="voice-listen"/.test(html), 'a briefing was invented from nothing');
  assert.ok(!/data-action="voice-ask-open"/.test(html));
  assert.match(html, /Your coach cannot talk about this session/,
    'the original refusal sentence was lost');
});

test('a Strava-derived FUTURE day is never offered as what is next', () => {
  /* FOUND BY MUTATION, NOT BY READING. Deleting the provenance skip inside
     askLocalNextSession() changed nothing any test could see, because no
     fixture had ever put an import on a future day -- so "the next session is
     Valhalla-owned" was passing vacuously everywhere it was asserted.

     It is not hypothetical either: an activity resolves onto the day it
     happened, and a device whose clock or timezone puts that a few hours ahead
     writes a marker onto tomorrow. The skip is the reason that cannot become a
     briefing about somebody else's data, and this is the test that holds it. */
  const a = app();
  importOnto(a, todayDay(a));
  const future = a.state.days.filter(d => d.date > TODAY && d.type !== 'rest')
                             .sort((x, y) => x.date < y.date ? -1 : 1);
  assert.ok(future.length >= 2, 'the fixture has too few future sessions');
  importOnto(a, future[0]);

  const nxt = a.askLocalNextSession();
  assert.ok(nxt, 'the forward reader gave up instead of skipping the import');
  assert.equal(a.isStravaDerived(nxt), false,
    'what is next is a session that came in from Strava');
  assert.notEqual(nxt.id, future[0].id);

  const html = a.renderVoiceCard(todayDay(a));
  const m = /data-action="voice-listen" data-day="([^"]+)"/.exec(html);
  assert.ok(m, 'no briefing was offered');
  assert.notEqual(m[1], future[0].id, 'the card briefed the imported future day');
  assert.ok(html.indexOf('data-day="' + future[0].id + '"') === -1);

  /* And the same day is absent from the model context, which is the half that
     carries the policy claim rather than the presentation. */
  const ctx = a.voiceCoachContext();
  ctx.upcoming.forEach(u => assert.notEqual(u.date, future[0].date,
    'an imported future day reached the model context'));
  assert.equal(ctx.withheld.stravaDerivedDays, 2);
});

test('a rest day is never offered as the next session', () => {
  const a = app();
  importOnto(a, todayDay(a));
  const nxt = a.askLocalNextSession();
  assert.notEqual(nxt.type, 'rest');
});

test('the suggestion chips stop inviting the athlete into the refusal', () => {
  const a = app();
  importOnto(a, todayDay(a));
  a.askSet('open', { heard:'', answer:'', message:'', proposalDayId:null });
  const html = a.renderVoiceCard(todayDay(a));
  assert.ok(!/Why this session today/.test(html),
    'a chip still asks about the session the coach may not discuss');
  assert.match(html, /What am I doing next/);
  /* And the normal chips are untouched for everybody else. */
  const b = app();
  b.askSet('open', { heard:'', answer:'', message:'', proposalDayId:null });
  assert.match(b.renderVoiceCard(todayDay(b)), /Why this session today/);
});

// ---------------------------------------------------------------------------
// 2. THE BRIEFING SAYS WHICH DAY IT IS ABOUT
// ---------------------------------------------------------------------------

test('a briefing about another day does not call that day today', () => {
  const a = app();
  importOnto(a, todayDay(a));
  const nxt = a.askLocalNextSession();
  const text = a.voiceScriptText(a.voiceScriptFor(nxt));
  assert.ok(text.length > 0, 'there was nothing to say about the next session');
  assert.ok(!/\btoday\b/i.test(text),
    'a briefing about a future session called it today: ' + text);
  const when = a.voiceWhenPhrase(nxt.date);
  assert.ok(when, 'no temporal frame was derived for a future day');
  assert.ok(text.toLowerCase().indexOf(when.toLowerCase()) !== -1,
    'the briefing never says which day it is about: ' + text);
});

test('today’s own briefing is word-for-word what it always was', () => {
  /* The frame is a parameter with a null default, so the ONE case that matters
     for every athlete who has never connected Strava is untouched. */
  const a = app();
  const dd = todayDay(a);
  assert.equal(a.voiceWhenPhrase(dd.date), null);
  const text = a.voiceScriptText(a.voiceScriptFor(dd));
  assert.match(text, /\btoday\b/i, 'today’s briefing stopped saying today');
});

test('an opener with no "today" in it still names the day', () => {
  /* 'Race day' is the one authored opener the substitution has nothing to
     work on. Without a fallback the athlete would be briefed about a race with
     no indication of when it is. */
  const a = app();
  const sp = a.VOICE_SPOKEN.race;
  const dd = { km: 21.1, title: 'Half Marathon', type: 'race', date: a.addDays(TODAY, 3) };
  assert.ok(!/\btoday\b/i.test(sp.opener), 'the race opener gained a "today" to swap');
  assert.match(a.voiceSpokenOpener(dd, sp, 'Sunday'), /Race day on Sunday/);
  assert.match(a.voiceSpokenOpener(dd, sp, 'Tomorrow'), /Race day tomorrow/);
  assert.match(a.voiceSpokenOpener(dd, sp, null), /^Race day —/);
});

test('the temporal frame reads as English on every day of the week', () => {
  const a = app();
  assert.equal(a.voiceWhenPhrase(a.addDays(TODAY, 1)), 'Tomorrow');
  for (let i = 2; i <= 7; i++){
    const w = a.voiceWhenPhrase(a.addDays(TODAY, i));
    assert.match(w, /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/,
      'a weekday came out as ' + w);
  }
  /* Sentence-initial and mid-sentence forms are both grammatical. */
  const rest = a.state.days.filter(d => d.type === 'rest' && d.date > TODAY)[0];
  if (rest) assert.match(a.voiceSessionLine(rest, a.voiceWhenPhrase(rest.date)),
    /^(Tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) is a rest day\./);
});

// ---------------------------------------------------------------------------
// 3. THE GATE — WHICH QUESTIONS ARE ANSWERED WHERE
// ---------------------------------------------------------------------------

const RETRO = ['How did today’s run go?', 'Was my heart rate too high?',
               'Why did I slow down?', 'How were my splits?',
               'Did I run too hard today?',
               'Should I change the plan because of that run?'];
const FORWARD = ['What am I doing next?', 'What pace are Sunday’s intervals?',
                 'How should I approach the 4x600m?',
                 'What is the purpose of my next session?',
                 'What am I doing tomorrow?', 'What phase am I in?'];

test('every retrospective question the founder listed is refused locally', async () => {
  for (const q of RETRO){
    const a = app();
    importOnto(a, todayDay(a));
    stubFetch(a, answers({ answer: 'CLOUD ANSWER', needsPlanChange: true }));
    const r = await a.askSend(q);
    assert.equal(a.coachCalls.length, 0, 'the model was asked about the run: ' + q);
    assert.equal(r.source, 'offline-local', q);
    assert.match(r.answer, /came in from Strava/, q);
    assert.ok(!/CLOUD ANSWER/.test(r.answer), q);
  }
});

test('every forward-looking question the founder listed reaches the coach normally', async () => {
  for (const q of FORWARD){
    const a = app();
    importOnto(a, todayDay(a));
    stubFetch(a, answers({ answer: 'Your next session is 5x600m at threshold.' }));
    const r = await a.askSend(q);
    assert.equal(a.coachCalls.length, 1, 'a safe question was refused locally: ' + q);
    assert.equal(a.askState.status, 'answered', q);
    assert.match(a.askState.answer, /5x600m/, q);
  }
});

test('the gate is inert for an athlete with nothing withheld', async () => {
  /* The same six retrospective questions, on a manually logged day. Nothing is
     withheld, so nothing is refused -- an athlete who never connected Strava
     loses nothing to a rule that is not about them. */
  for (const q of RETRO){
    const a = app();
    const dd = todayDay(a);
    a.applyCompletion(dd, true);
    athleteWroteAbout(dd);
    assert.equal(a.isStravaDerived(dd), false);
    stubFetch(a, answers({ answer: 'You held it well.' }));
    await a.askSend(q);
    assert.equal(a.coachCalls.length, 1, 'a manual day was refused: ' + q);
  }
});

test('the gate closes again once the import falls out of the window the coach reads', () => {
  const a = app();
  const old = a.state.days.filter(d => d.date < a.addDays(TODAY, -20))
                          .filter(d => d.type !== 'rest')[0];
  assert.ok(old, 'the fixture has no day old enough to test the window');
  importOnto(a, old);
  assert.equal(a.askStravaWithheldRecently(), false,
    'an import outside the recent window still suppresses retrospective questions');
  assert.equal(a.askRequiresStravaSession('How did my run go?'), false);
  /* And opens for one inside it. */
  importOnto(a, todayDay(a));
  assert.equal(a.askStravaWithheldRecently(), true);
  assert.equal(a.askRequiresStravaSession('How did my run go?'), true);
});

// ---------------------------------------------------------------------------
// 4. THE BOUNDARY — WHAT ACTUALLY LEAVES THE DEVICE
// ---------------------------------------------------------------------------

/* WORD BOUNDARIES, NOT SUBSTRINGS. A first version of this searched for the
   raw strings and failed on "rough" inside "throughout" in the system note --
   a test reporting a leak that was not there is worse than no test, because it
   is believed once and then loosened. */
function leaks(body, value){
  const v = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('\\b' + v + '\\b').test(String(body));
}

/* Everything the import wrote, plus everything the athlete wrote on the day it
   touched, as strings that must not appear anywhere in a request body. */
function forbiddenStrings(a, dd){
  const A = dd.actual || {};
  const out = ['4242', 'ZORBLAX', 'rough'];
  ['km','pace','hr','maxHR','cadence','movingTimeSec','elapsedTimeSec',
   'elevationGainM','rpe'].forEach(k => {
     if (A[k] != null) out.push(String(A[k]));
   });
  if (A.splits) out.push(JSON.stringify(A.splits));
  return out.filter(v => String(v).length >= 3);
}

test('no Strava-derived number, note or marker reaches the model request', async () => {
  const a = app();
  const dd = importOnto(a, todayDay(a));
  athleteWroteAbout(dd);
  stubFetch(a, answers({ answer: 'ok' }));
  await a.askSend('What am I doing next?');
  assert.equal(a.coachCalls.length, 1);
  const body = String(a.coachCalls[0]);
  assert.ok(!/stravaActivityId/i.test(body), 'the provenance marker itself was sent');
  for (const bad of forbiddenStrings(a, dd)){
    assert.ok(!leaks(body, bad),
      'Strava-derived value reached the model request: ' + bad);
  }
  assert.equal(dd.actual.hr, 163, 'the fixture never wrote a heart rate to withhold');
  assert.ok(dd.actual.splits && dd.actual.splits.length, 'the fixture wrote no splits');
});

test('the imported day is absent from the context, and its absence is declared', () => {
  const a = app();
  const dd = importOnto(a, todayDay(a));
  athleteWroteAbout(dd);
  const ctx = a.voiceCoachContext();
  assert.equal(ctx.todaySession, null, 'the imported session was summarised anyway');
  assert.equal(ctx.withheld.stravaDerivedDays, 1);
  assert.equal(ctx.withheld.todaySessionWithheld, true,
    'the model is left to read a missing session as no session');
  assert.ok(!/ZORBLAX/.test(JSON.stringify(ctx)));
  /* And the flag is honest in the other direction. */
  const b = app();
  assert.equal(b.voiceCoachContext().withheld.todaySessionWithheld, false);
});

test('the future prescription survives in the context', () => {
  const a = app();
  importOnto(a, todayDay(a));
  const ctx = a.voiceCoachContext();
  assert.ok(ctx.upcoming.length > 0, 'the athlete’s own future plan was withheld too');
  ctx.upcoming.forEach(u => {
    const d = a.state.days.filter(x => x.date === u.date)[0];
    assert.equal(a.isStravaDerived(d), false, 'an imported day reached upcoming');
    assert.ok(u.date > TODAY);
  });
  assert.ok(ctx.block, 'the block was withheld');
  assert.ok(ctx.goal, 'the goal was withheld');
});

test('a question about the run cannot become a plan-change proposal', async () => {
  const a = app();
  importOnto(a, todayDay(a));
  /* The engine IS recommending something, so the only thing standing between
     the question and a proposal is the gate. */
  a.coachProposedChangeDayId = () => { a.proposalAsked = true; return 'SOME-DAY'; };
  stubFetch(a, answers({ answer: 'Back off tomorrow.', needsPlanChange: true }));
  const r = await a.askSend('Should I change the plan because of that run?');
  assert.equal(a.coachCalls.length, 0, 'the run was described to the model');
  assert.equal(r.needsPlanChange, false);
  assert.equal(r.changeReason, null);
  assert.equal(a.askState.proposalDayId, null, 'a proposal was offered from a refused question');
  assert.ok(!a.proposalAsked, 'the proposal path was reached at all');
});

test('the engine still refuses to propose from an imported day directly', () => {
  /* Unchanged, and asserted because the gate above must not become the only
     thing holding this. */
  const a = app();
  const dd = importOnto(a, todayDay(a));
  a.applyCompletion(dd, true);
  assert.equal(a.coachProposedChangeDayId(), null);
});

// ---------------------------------------------------------------------------
// 5. OFFLINE
// ---------------------------------------------------------------------------

test('offline, the same boundary gives the same sentence', async () => {
  const a = app({ onLine: false });
  importOnto(a, todayDay(a));
  stubFetch(a, null);
  const r = await a.askSend('How did my run go?');
  assert.equal(a.coachCalls.length, 0);
  assert.equal(r.source, 'offline-local');
  assert.match(r.answer, /came in from Strava/);
  /* Not the offline sentence, which would blame the signal for a refusal that
     has nothing to do with it. */
  assert.ok(!/while you’re offline/.test(r.answer));
});

test('the boundary answer is not captioned as an offline one', async () => {
  /* FOUND IN THE ACCEPTANCE SCREENSHOT, NOT IN A TEST. Online, with full
     signal, "How did today's run go?" was answered instantly and correctly and
     then labelled "Offline guidance" -- which would send the athlete to check
     their connection over something that has nothing to do with it. The
     caption still declines to claim the coach was consulted; it just names the
     right reason. */
  const a = app();
  importOnto(a, todayDay(a));
  stubFetch(a, answers({ answer: 'x' }));
  const r = await a.askSend('How did my run go?');
  assert.equal(r.why, 'strava_session');
  const html = a.renderVoiceCard(todayDay(a));
  assert.match(html, /Answered on your device/);
  assert.ok(!/Offline guidance/.test(html), 'an online answer was labelled offline');

  /* And a genuinely offline answer keeps the label it had. */
  const b = app({ onLine: false });
  stubFetch(b, null);
  const rb = await b.askSend('What am I doing today?');
  assert.equal(rb.why, null);
  assert.match(b.renderVoiceCard(todayDay(b)), /Offline guidance/);
});

test('the reason is a label and cannot re-route a local answer', async () => {
  /* The plan fields are forced on `source`, not on `why`, so a reason handed
     in alongside a cloud-shaped payload changes nothing about what the answer
     is allowed to do. */
  const a = app();
  const forced = a.askResult({ answer:'x', source:'offline-local', why:'strava_session',
                               needsPlanChange:true, changeReason:'because' });
  assert.equal(forced.needsPlanChange, false);
  assert.equal(forced.changeReason, null);
  assert.equal(forced.why, 'strava_session');
});

test('offline, a future Valhalla session is still answered from the device', async () => {
  const a = app({ onLine: false });
  importOnto(a, todayDay(a));
  stubFetch(a, null);
  const r = await a.askSend('What am I doing next?');
  assert.equal(r.source, 'offline-local');
  assert.ok(r.answer.length > 0);
  assert.ok(!/came in from Strava/.test(r.answer), 'a safe question got the refusal');
  const nxt = a.askLocalNextSession();
  assert.equal(a.isStravaDerived(nxt), false);
});

test('offline local guidance never describes the imported session', async () => {
  const a = app({ onLine: false });
  const dd = importOnto(a, todayDay(a));
  athleteWroteAbout(dd);
  stubFetch(a, null);
  const asked = ['What am I doing today?', 'What pace should I run?',
                 'What is my long run this week?', 'How did my run go?'];
  for (const q of asked){
    const r = await a.askSend(q);
    for (const bad of forbiddenStrings(a, dd)){
      assert.ok(!leaks(r.answer, bad),
        'offline guidance quoted Strava-derived data (' + bad + ') for: ' + q);
    }
  }
});

test('a local answer is still spoken by the device and never by the cloud voice', async () => {
  const a = app({ onLine: false });
  importOnto(a, todayDay(a));
  stubFetch(a, null);
  await a.askSend('How did my run go?');
  assert.equal(a.spoken.length, 1);
  assert.equal(a.spoken[0].opts.localOnly, true);
});

// ---------------------------------------------------------------------------
// 6. NOTHING ELSE MOVED
// ---------------------------------------------------------------------------

test('an athlete who never connected Strava sees exactly the card they saw before', () => {
  const a = app();
  const dd = todayDay(a);
  const html = a.renderVoiceCard(dd);
  assert.match(html, /data-action="voice-listen" data-day="' + '"/.test('') ? /x/ : /data-action="voice-listen"/);
  assert.match(html, new RegExp('data-day="' + dd.id + '"'), 'the briefing changed subject');
  assert.match(html, /data-action="voice-ask-open"/);
  assert.ok(!/Strava/.test(html), 'a Strava sentence appeared for an athlete who has none');
  assert.match(html, /Hear today|Read today/);
});

test('a manually completed day still gets its debrief', () => {
  const a = app();
  const dd = completeManually(a, todayDay(a));
  const html = a.renderVoiceCard(dd);
  assert.match(html, new RegExp('data-day="' + dd.id + '"'));
  assert.match(html, /how it went/);
  assert.equal(a.voiceScriptFor(dd).kind, 'debrief');
});

test('the imported day is still refused whole by the AI boundary', () => {
  const a = app();
  const dd = importOnto(a, todayDay(a));
  assert.equal(a.aiContextRefusalReason(dd), 'strava_derived');
  assert.equal(a.aiEligibleDays([dd]).length, 0);
  assert.equal(a.voiceDayEligible(dd), false);
  assert.ok(a.stravaDerivedFields(dd).length > 0);
});

test('Ask Coach is still withheld where the deployment has no coach', () => {
  const a = app();
  a.voiceCoachAvailable = false;
  importOnto(a, todayDay(a));
  const html = a.renderVoiceCard(todayDay(a));
  assert.ok(!/data-action="voice-ask-open"/.test(html));
  /* The briefing is not gated on the cloud coach and must still be there. */
  assert.match(html, /data-action="voice-listen"/);
});

test('voice still renders on Today and nowhere else, imported or not', () => {
  const a = app();
  const dd = importOnto(a, todayDay(a));
  ['week', 'plan', 'record', 'settings'].forEach(v => {
    a.state.view = v;
    assert.equal(a.renderVoiceCard(dd), '', 'voice leaked onto ' + v);
  });
  a.state.view = 'today';
  assert.ok(a.renderVoiceCard(dd).length > 0);
});

// ---------------------------------------------------------------------------
// 7. ACCESSIBILITY
// ---------------------------------------------------------------------------

test('every control on the imported-day card carries an accessible name', () => {
  const a = app();
  importOnto(a, todayDay(a));
  a.askSet('open', { heard:'', answer:'', message:'', proposalDayId:null });
  const html = a.renderVoiceCard(todayDay(a));
  const buttons = html.match(/<button\b[^>]*>/g) || [];
  assert.ok(buttons.length >= 3, 'the card drew almost nothing to check');
  buttons.forEach(b => {
    assert.ok(/aria-label="[^"]+"/.test(b) || /data-action="voice-ask-suggest"/.test(b) ||
              /class="btn[^"]*"/.test(b),
      'a control has no accessible name: ' + b);
  });
});

test('the explanatory note is not announced as an alert or a live region', () => {
  /* It is standing context, not an event. A polite live region here would have
     a screen reader read the Strava sentence over the coaching every time the
     card is patched. */
  const a = app();
  importOnto(a, todayDay(a));
  const note = /<div class="voice-row voice-unavailable">[\s\S]*?<\/div><\/div>/.exec(
    a.renderVoiceCard(todayDay(a)));
  assert.ok(note, 'the note is gone');
  assert.ok(!/aria-live|role="alert"|role="status"/.test(note[0]),
    'the note became a live region');
});

test('the answer is still announced exactly once, through the one region', async () => {
  const a = app();
  importOnto(a, todayDay(a));
  a.askAnnounceAnswer = (t) => { a.announcements = (a.announcements || []).concat([t]); };
  stubFetch(a, answers({ answer: 'Tomorrow is 5x600m.' }));
  await a.askSend('What am I doing next?');
  assert.deepEqual((a.announcements || []).length, 1);
  a.askSet('open', { heard:'', answer:'', message:'', proposalDayId:null });
  a.askSet('answered', { answer:'x', source:'cloud' });
  const html = a.renderVoiceCard(todayDay(a));
  assert.equal((html.match(/id="ask-answer-announce"/g) || []).length, 1);
  assert.equal((html.match(/id="ask-answer-live"/g) || []).length, 1);
});

// ---------------------------------------------------------------------------
// 8. THE STRUCTURAL CLAIM
// ---------------------------------------------------------------------------

test('every consumer added by this pass asks the ONE provenance function', () => {
  /* The marker field is legitimately read by the import machinery -- the
     writer sets it, the resolver dedupes on it. What must not happen is a
     READER of provenance deciding "is this from Strava" for itself out of a
     field name, because that is a second rule that can quietly diverge from
     the first.

     So the claim is scoped to the functions this pass added or changed, and
     each is checked by its own body rather than by a whole-file count that
     would pass for the wrong reason. */
  const fs = require('fs');
  const path = require('path');
  const { RUNTIME_RELATIVE } = require('./harness.js');
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert.equal((code.match(/function\s+isStravaDerived\b/g) || []).length, 1,
    'a second provenance function appeared');

  const bodyOf = (name) => {
    const at = code.indexOf('function ' + name + '(');
    assert.ok(at > 0, name + ' is gone');
    let i = code.indexOf('{', at), depth = 0, j = i;
    for (; j < code.length; j++){
      if (code[j] === '{') depth++;
      else if (code[j] === '}' && --depth === 0) break;
    }
    return code.slice(i, j + 1);
  };
  ['askStravaWithheldRecently', 'askRequiresStravaSession', 'askLocalNextSession',
   'askLocalDayAt', 'renderVoiceCardBody', 'voiceCoachContext'].forEach(fn => {
    const body = bodyOf(fn);
    assert.ok(!/stravaActivityId/.test(body),
      fn + '() decides provenance from a field name instead of isStravaDerived()');
  });
  /* And the two that must actually consult it do. */
  assert.match(bodyOf('askStravaWithheldRecently'), /isStravaDerived\(/);
  assert.match(bodyOf('renderVoiceCardBody'), /isStravaDerived\(/);
});

test('the gate cannot widen what the coach may see', () => {
  /* voiceCoachContext() takes no question and must never take one. If scope
     could be argued from the prompt, "tell me about my run" would be the
     argument. */
  assert.equal(app().voiceCoachContext.length, 0);
});
