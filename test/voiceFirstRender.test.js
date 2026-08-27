'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* ASK COACH MUST BE THERE ON THE FIRST TODAY THE ATHLETE SEES
 * ===========================================================================
 * THE LIVE DEFECT. Cold-open the installed app onto Today: the session card
 * drew HEAR TODAY and no ASK COACH. Navigate to any other tab, come back, and
 * ASK COACH appeared beside it -- same day, same session, same athlete.
 *
 * THE ROOT CAUSE, WHICH IS NOT THE ONE IT LOOKS LIKE. This has the shape of a
 * capability arriving after the first render, and it is not that. The probes
 * were fired only from handleSetView(), so they ran when the athlete NAVIGATED
 * to Today -- and a cold start never navigates. init() reaches Today by calling
 * renderApp() directly. On the launch that matters most the probe did not run
 * late; it did not run AT ALL, and no request was made until the athlete
 * happened to leave Today and return.
 *
 * Proved rather than assumed: on a cold start with a restored plan and a
 * restored session, `__vvvVoiceProbed` was undefined and ZERO requests to
 * /api/voice-enabled had been made.
 *
 * voiceSetAvailable() already patched the drawn card, and patchVoiceCard()
 * already found its mount. Nothing was arriving too late. Nothing was asked.
 */

const PINNED = '2026-08-24T09:00:00Z';
const TODAY = '2026-08-24';

/* A realistic saved state, written by the app itself rather than hand-built. */
function savedState(){
  const seed = loadApp({ pinnedDate: PINNED });
  seed.showToast = () => {}; seed.renderApp = () => {};
  seed.scheduleSave = () => {}; seed.flushSave = () => {};
  buildPlan(seed, { weeks: 14, startDate: '2026-07-01', distanceKey: '10k', volume: 40,
                    schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } });
  seed.state.view = 'today';
  return { plan: JSON.stringify(seed.state),
           planKey: seed.STORAGE_KEY, sessionKey: seed.CLOUD_SESSION_KEY };
}
const SAVED = savedState();

/* THE LAUNCH ITSELF. Storage is populated BEFORE the runtime is evaluated,
   because init() runs during evaluation -- which is the only way to observe
   what a cold start actually asks for. */
function coldStart(opts){
  const o = opts || {};
  const calls = [];
  const storage = {};
  storage[SAVED.planKey] = SAVED.plan;
  if (o.signedIn !== false)
    storage[SAVED.sessionKey] = JSON.stringify({ access_token: 't', refresh_token: 'r',
      expires_at: Date.now() + 3600000, user_id: 'u1', email: 'f@x.com' });
  const a = loadApp({ pinnedDate: PINNED, storage,
    fetch: (url) => {
      calls.push(String(url));
      if (/voice-enabled/.test(String(url)))
        return Promise.resolve({ ok: o.voiceOk !== false, status: o.voiceOk === false ? 500 : 200,
          json: () => Promise.resolve({ enabled: o.voiceEnabled !== false }) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    } });
  a.renderApp = () => {}; a.showToast = () => {};
  a.calls = calls;
  return a;
}
const settle = () => new Promise(r => setTimeout(r, 40));
const voiceProbes = a => a.calls.filter(u => /voice-enabled/.test(u)).length;
const voiceCard = a => a.renderVoiceCard(a.findDayByDate(TODAY));

// ---------------------------------------------------------------------------
// THE DEFECT
// ---------------------------------------------------------------------------
test('a cold start onto Today asks whether there is a coach, without being navigated to', () => {
  const a = coldStart();
  assert.equal(a.state.view, 'today', 'the fixture did not open on Today');
  assert.ok(a.state.days.length, 'the plan did not restore');
  assert.equal(voiceProbes(a), 1,
    'a cold start onto Today made ' + voiceProbes(a) + ' availability requests, expected 1');
});

test('ASK COACH appears on the already-rendered Today, with no navigation at all', async () => {
  const a = coldStart();
  await settle();
  const html = voiceCard(a);
  assert.equal(a.voiceCoachAvailable, true, 'availability never resolved');
  assert.match(html, /data-action="voice-listen"/, 'HEAR TODAY is missing');
  assert.match(html, /data-action="voice-ask-open"/,
    'ASK COACH still requires navigating away and back');
});

test('ASK COACH appears exactly once beside HEAR TODAY', async () => {
  const a = coldStart();
  await settle();
  const html = voiceCard(a);
  assert.equal((html.match(/data-action="voice-ask-open"/g) || []).length, 1);
  assert.equal((html.match(/data-action="voice-listen"/g) || []).length, 1);
});

// ---------------------------------------------------------------------------
// FAIL-CLOSED IS UNCHANGED
// ---------------------------------------------------------------------------
test('a deployment with no coach draws HEAR TODAY and no ASK COACH', async () => {
  const a = coldStart({ voiceEnabled: false });
  await settle();
  const html = voiceCard(a);
  assert.equal(a.voiceCoachAvailable, false);
  assert.match(html, /data-action="voice-listen"/, 'LISTEN must not depend on a coach');
  assert.ok(!/data-action="voice-ask-open"/.test(html), 'ASK COACH was drawn without a coach');
});

test('a failed probe leaves Ask Coach closed rather than open', async () => {
  const a = coldStart({ voiceOk: false });
  await settle();
  assert.equal(a.voiceCoachAvailable, false, 'a 500 opened the coach');
  assert.ok(!/data-action="voice-ask-open"/.test(voiceCard(a)));
  assert.match(voiceCard(a), /data-action="voice-listen"/, 'a failed probe took LISTEN with it');
});

test('signed out, Today still draws its briefing and asks for no coach it cannot use', async () => {
  const a = coldStart({ signedIn: false });
  await settle();
  assert.match(voiceCard(a), /data-action="voice-listen"/,
    'LISTEN depends on a session, which it must not');
});

// ---------------------------------------------------------------------------
// ONE LATCH: NO SECOND REQUEST, NO DUPLICATED CONTROL
// ---------------------------------------------------------------------------
test('navigating away and back costs no second request and duplicates nothing', async () => {
  const a = coldStart();
  await settle();
  const before = voiceProbes(a);
  a.handleSetView('thisweek');
  a.handleSetView('today');
  await settle();
  assert.equal(voiceProbes(a), before, 'the athlete was charged a second availability request');
  const html = voiceCard(a);
  assert.equal((html.match(/data-action="voice-ask-open"/g) || []).length, 1, 'ASK COACH duplicated');
  assert.equal((html.match(/data-action="voice-listen"/g) || []).length, 1, 'HEAR TODAY duplicated');
});

test('the other entry path still works: opening on another tab, then reaching Today', async () => {
  /* An app that cold-starts somewhere else must still ask exactly once, when
     Today is first reached -- the behaviour handleSetView() always had. */
  const a = coldStart();
  a.window.__vvvVoiceProbed = undefined;      // as if this launch opened elsewhere
  a.calls.length = 0;
  a.handleSetView('fullplan');
  assert.equal(voiceProbes(a), 0, 'a non-Today screen asked for a coach');
  a.handleSetView('today');
  await settle();
  assert.equal(voiceProbes(a), 1, 'reaching Today by navigation stopped asking');
  assert.match(voiceCard(a), /data-action="voice-ask-open"/);
});

test('the probe is latched in one place, so no entry path can double-ask', () => {
  const a = coldStart();
  assert.equal(a.window.__vvvVoiceProbed, true);
  assert.equal(a.voiceProbeOnce(), false, 'a second call re-probed');
  assert.equal(a.voiceProbeOnce(), false);
  assert.equal(voiceProbes(a), 1);
});

test('a launch with no plan asks nothing, because onboarding can draw no voice control', async () => {
  /* An unconfigured build stays an app that makes no request. The athlete who
     finishes the builder reaches Today through handleSetView(), which asks
     then -- so nothing is lost by not asking here. */
  const calls = [];
  const a = loadApp({ pinnedDate: PINNED,
    fetch: (url) => { calls.push(String(url));
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ enabled: true }) }); } });
  a.renderApp = () => {}; a.showToast = () => {};
  await settle();
  assert.ok(!a.state.days || !a.state.days.length, 'the fixture unexpectedly had a plan');
  assert.equal(calls.filter(u => /voice-enabled/.test(u)).length, 0,
    'onboarding bought an availability request it cannot spend');
  assert.equal(a.window.__vvvVoiceProbed, undefined, 'the latch was spent before Today existed');
});

test('finishing the builder and reaching Today asks exactly once', async () => {
  const calls = [];
  const a = loadApp({ pinnedDate: PINNED,
    fetch: (url) => { calls.push(String(url));
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ enabled: true }) }); } });
  a.renderApp = () => {}; a.showToast = () => {};
  a.scheduleSave = () => {}; a.flushSave = () => {};
  buildPlan(a, { weeks: 14, startDate: '2026-07-01', distanceKey: '10k', volume: 40,
                 schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } });
  a.handleSetView('today');
  await settle();
  assert.equal(calls.filter(u => /voice-enabled/.test(u)).length, 1,
    'the newly-built plan never asked whether there is a coach');
  assert.equal(a.voiceCoachAvailable, true);
});
