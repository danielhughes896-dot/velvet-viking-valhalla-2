'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* STRAVA WHERE THE ATHLETE MEETS IT — the builder's first screen, and Settings.
 * ===========================================================================
 * The integration itself already existed: OAuth, refresh, webhooks, staging,
 * matching and ingestion are covered elsewhere. What was missing was the offer
 * — an athlete could only find Strava by going looking for it in Settings.
 *
 * THE TWO RULES EVERYTHING HERE PROTECTS:
 *
 *   1. NEVER A CONTROL THAT CANNOT HONOUR A PRESS. The offer appears only when
 *      the server says this deployment permits Strava. The beta gate defaults
 *      to false and only the server can open it, so a blocked or slow probe
 *      leaves the button undrawn rather than drawn and broken.
 *   2. NEVER COMPULSORY, AND NEVER STATEFUL. It asks for nothing, stores
 *      nothing, and blocks nothing. An athlete who ignores it reaches exactly
 *      the same next screen as one who never saw it.
 */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const TODAY = '2026-08-24';

function app(opts){
  const o = opts || {};
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.flushSave = () => {}; a.scheduleSave = () => {};
  if (o.available) a.stravaSetAvailable(true);
  if (o.connected) a.stravaSetState('connected', { athleteName: o.athleteName || null });
  return a;
}

// ---------------------------------------------------------------------------
// THE BUILDER OFFER
// ---------------------------------------------------------------------------
test('the offer is absent until the server permits Strava', () => {
  /* The beta gate. Not a hidden control -- an undrawn one, which is the same
     decision the Garmin card makes while its contract is outstanding. */
  const a = app();
  assert.equal(a.stravaAvailable, false, 'availability defaults to off');
  assert.equal(a.bldStravaOffer(), '', 'nothing is drawn');
});

test('when Strava is available the first screen offers it, optionally', () => {
  const a = app({ available: true });
  const html = a.bldStravaOffer();
  assert.match(html, /Connect Strava/);
  assert.match(html, /data-action="strava-connect"/);
  assert.match(html, /Optional/i, 'the athlete is told they can carry on');
  assert.match(html, /connect later in Settings/i);
});

test('a connected athlete is told so, and is not asked again', () => {
  const a = app({ available: true, connected: true, athleteName: 'Dan H' });
  const html = a.bldStravaOffer();
  assert.match(html, /Strava connected/);
  assert.match(html, /Dan H/, 'and which account, when Strava told us');
  assert.ok(!/data-action="strava-connect"/.test(html),
    'a connected athlete must not be offered a second connection');
});

test('an unnamed connection says Connected without a blank name', () => {
  /* Strava does not always give a name. A dangling "Connected as" reads worse
     than the state on its own, so the name is omitted rather than guessed. */
  const a = app({ available: true, connected: true });
  const html = a.bldStravaOffer();
  assert.match(html, /Strava connected/);
  assert.ok(!/·\s*<\/div>/.test(html), 'a separator was left with nothing after it');
});

test('the offer sits on the orientation screen, not in the question flow', () => {
  /* WHY IT IS NOT AN ELEVENTH STAGE. BUILDER_SPEC.stages drives the rail, the
     numerals, the validation map, start.html's renderer list and the
     server-side preview. Strava is not a question the builder needs answered,
     so it must not become one -- and the stage count is asserted by three
     other suites that would all have to be told a different number. */
  const a = app({ available: true });
  assert.equal(a.BLD_STAGE_NAMES.length, 10, 'the builder still asks ten questions');
  assert.equal(a.BLD_STAGE_NAMES[0], 'Overview');

  const panel = SRC.slice(SRC.indexOf('data-stage="0"'), SRC.indexOf('data-stage="1"'));
  assert.match(panel, /bldStravaOffer\(\)/, 'the offer is on the first panel');
  assert.match(panel, /navBtns\(0\)/, 'and Continue is still the ordinary stage button');
});

test('the offer stores nothing and gates nothing', () => {
  /* No deferred intent, no "connect later" flag to reconcile after sign-in.
     The athlete connects now or carries on, and the builder is unaffected. */
  const a = app({ available: true });
  buildPlan(a, { weeks: 10, startDate: TODAY, distanceKey: 'half', volume: 45,
                 schedule: { activeDays: [1,2,3,5,6], longRunDay: 6 } });
  const before = JSON.stringify(a.state);
  a.bldStravaOffer();
  assert.equal(JSON.stringify(a.state), before, 'drawing the offer wrote state');

  const fn = /function bldStravaOffer\([^]*?\n\}/.exec(SRC)[0];
  assert.ok(!/state\.\w+\s*=/.test(fn), 'the offer assigns to state');
  assert.ok(!/localStorage/.test(fn), 'the offer persists something');
});

test('no API vocabulary reaches the athlete', () => {
  /* The brief's rule, and the product's own: a normal runner should not meet
     OAuth, scopes, endpoints or tokens anywhere in the ordinary UX. */
  const a = app({ available: true });
  const surfaces = [a.bldStravaOffer(), a.renderStravaSection()];
  a.stravaSetState('connected', { athleteName: 'Dan H' });
  surfaces.push(a.renderStravaSection());
  surfaces.forEach(html => {
    [/OAuth/i, /\bAPI\b/, /\bscope/i, /\bendpoint/i, /access token/i, /refresh token/i,
     /client secret/i, /webhook/i].forEach(rx =>
      assert.ok(!rx.test(html), 'developer vocabulary reached the athlete: ' + rx));
  });
});

// ---------------------------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------------------------
test('Settings draws every state the athlete can actually be in', () => {
  const a = app({ available: true });

  a.stravaSetState('off');
  const off = a.renderStravaSection();
  assert.match(off, /data-action="strava-connect"/);
  assert.ok(!/Disconnect/.test(off));

  a.stravaSetState('connecting');
  assert.match(a.renderStravaSection(), /Connecting…/);

  a.stravaSetState('connected', { athleteName: 'Dan H' });
  const on = a.renderStravaSection();
  assert.match(on, /Connected/);
  assert.match(on, /Connected as Dan H/, 'which account, since Strava told us');
  assert.match(on, /data-action="strava-sync"/);
  assert.match(on, /data-action="strava-disconnect"/);

  a.stravaSetState('syncing', { athleteName: 'Dan H' });
  assert.match(a.renderStravaSection(), /Syncing…/);

  a.stravaSetState('error', { });
  a.stravaConn.message = 'Strava did not respond. Try again.';
  const err = a.renderStravaSection();
  assert.match(err, /Strava did not respond/, 'a human sentence, not a status code');
  assert.match(err, /data-action="strava-connect"/, 'and a way back');
});

test('an athlete who may not use Strava is shown nothing at all', () => {
  /* CHANGED WITH THE FOUNDER-ONLY GATE. This used to assert an honest "not
     available during the private beta" note, which was right while the answer
     was the same for everybody. It is not now: for every other athlete Strava
     is simply not part of their product, and a card announcing a feature they
     will never be offered advertises functionality they cannot use.

     The empty wrapper stays so the section can appear the moment the server
     says they may use it, without re-rendering Settings. */
  const a = app();                       // availability off
  const html = a.renderStravaSection();
  assert.equal(html, '<div id="strava-section"></div>');
  assert.ok(!/data-action="strava-connect"/.test(html));
  assert.ok(!/Strava/.test(html.replace(/id="strava-section"/, '')),
    'the word Strava must not reach an athlete who cannot use it');
  assert.equal(a.bldStravaOffer(), '', 'and the builder offers nothing either');
});

test('an unnamed Strava account does not print a dangling "Connected as"', () => {
  const a = app({ available: true, connected: true });
  const html = a.renderStravaSection();
  assert.match(html, /Connected/);
  assert.ok(!/Connected as\s*</.test(html));
});

// ---------------------------------------------------------------------------
// THE PRE-ACCOUNT BUILDER MUST NOT OFFER IT
// ---------------------------------------------------------------------------
test('start.html never draws a Strava control', () => {
  /* THE ARCHITECTURAL REASON, asserted so it cannot be undone by accident.
     The pre-account builder runs BEFORE the athlete has a Valhalla account:
     build, preview, "Save My Plan", then authenticate. A Strava authorization
     has nothing to attach to until that account exists -- strava_connections
     is keyed on auth.users(id) and every Strava route verifies a Supabase
     token first -- so a Connect button there could not honour a press. */
  const start = fs.readFileSync(path.join(ROOT, 'start.html'), 'utf8');
  assert.ok(!/data-action="strava-connect"/.test(start));
  assert.ok(!/strava-connect-btn/.test(start));

  /* And the sequence that makes it so is still the sequence. */
  assert.match(start, /pane-build/);
  assert.match(start, /pane-preview/);
  assert.match(start, /pane-auth/);
});
