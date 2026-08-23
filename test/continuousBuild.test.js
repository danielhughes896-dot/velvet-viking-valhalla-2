'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const Preview = require('../api/_preview.js');

// THE CONTINUOUS BUILD.
//
// The approved journey is Builder -> Personalised Preview -> Save My Plan ->
// Authenticate -> Trial/Purchase -> App, and the plan an athlete wakes up
// with inside the app must be the exact one the preview showed them -- not a
// second, independent build from the same raw answers, and never a plan
// built from someone else's abandoned attempt on a shared device.
//
// These tests drive protected/velvet-viking-valhalla.html's real
// adoptPendingBuildIfAny() through the harness, and cross-check its output
// against api/_preview.js's real generate()/summarise() -- the same two
// engine functions, called with the same arguments, must agree.

const PINNED = '2026-08-20T09:00:00Z';
const PINNED_MS = new Date(PINNED).getTime();

function fakeJwt(sub){
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '');
  return b64({ alg: 'HS256' }) + '.' + b64({ sub }) + '.sig';
}

/* Runs the real server-side preview for a raw mini-builder input and returns
   both the athlete-facing preview and the exact buildEcho() the endpoint
   would bank to localStorage -- i.e. what /start actually produces today. */
function realPreview(input){
  const previewApp = loadApp({ pinnedDate: PINNED });
  const v = Preview.validate(input);
  assert.equal(v.ok, true, 'fixture input failed validation: ' + JSON.stringify(v.errors || v));
  const g = Preview.generate(previewApp, v.input);
  const preview = Preview.summarise(g.app, g.days, g.blockResult, v.input);
  const build = Preview.buildEcho(v.input, g.startDate, g.raceDate);
  return { preview, build };
}

const RAW_INPUT = {
  purpose: 'race', distanceKey: 'half', weeks: 12, volume: 45,
  activeDays: [0, 1, 2, 4, 5], longRunDay: 5, benchmarkSeconds: 2700 // 45:00 10K
};

function bankPending(app, build, extra){
  // savedAt is measured against PINNED_MS, not the real wall clock -- the
  // adopting app's own Date.now() is pinned to PINNED, and comparing a
  // real-time savedAt against a pinned "now" would give a meaningless (and
  // sign-flipped, once real time passes PINNED) age.
  const pending = Object.assign({ build: build, savedAt: PINNED_MS }, extra || {});
  app.window.localStorage.setItem('vvv_pending_build', JSON.stringify(pending));
  return pending;
}

// ---------------------------------------------------------------------------
// 4 & 5. THE ROUND TRIP CARRIES THE SAME ANSWERS INTO THE SAME REAL PLAN
// ---------------------------------------------------------------------------
test('adopting a banked build produces the exact plan the preview showed', () => {
  const { preview, build } = realPreview(RAW_INPUT);

  const app = loadApp({ pinnedDate: PINNED });
  bankPending(app, build);

  const adopted = app.adoptPendingBuildIfAny();
  assert.equal(adopted, true, 'a valid banked build was not adopted');

  assert.ok(app.state.setup, 'no plan was constructed');
  assert.equal(app.state.setup.distanceKey, build.distanceKey);
  assert.equal(app.state.setup.currentVolume, build.volume);
  assert.equal(app.state.setup.raceDate, build.raceDate);
  assert.equal(app.state.setup.startDate, build.startDate);
  assert.equal(app.state.setup.hasEvent, false);
  assert.equal(app.state.setup.purpose, 'race');
  // JSON.stringify rather than assert.deepEqual: the adopted schedule's
  // array was parsed inside the VM sandbox and Node's strict assertions
  // treat that as a different realm even when every value matches.
  assert.equal(JSON.stringify(app.state.setup.schedule),
    JSON.stringify({ activeDays: build.activeDays, longRunDay: build.longRunDay }));
  assert.equal(app.state.setup.planWeeks, preview.programme.weeks,
    'the adopted plan runs a different number of weeks than the preview promised');

  // Same shape: same total sessions, same total km, same first week.
  const totalSessions = app.state.days.filter(d => (d.type || 'rest') !== 'rest').length;
  const totalKm = Math.round(app.state.days.reduce((a, d) => a + (typeof d.km === 'number' ? d.km : 0), 0));
  assert.equal(totalSessions, preview.programme.totalSessions);
  assert.equal(totalKm, preview.programme.totalKm);

  const week1 = app.state.days.filter(d => d.week === 1).sort((a, b) => a.date < b.date ? -1 : 1);
  assert.equal(week1.length, preview.firstWeek.length, 'the first week has a different number of days');
  week1.forEach((d, i) => {
    const p = preview.firstWeek[i];
    assert.equal(d.type || 'rest', p.type, 'day ' + i + ' type disagrees with the preview');
    assert.equal(Math.round((d.km || 0) * 10) / 10, p.km, 'day ' + i + ' distance disagrees with the preview');
  });

  // No duplicate/second plan machinery: exactly one block was opened.
  assert.equal(app.athlete().blocks.length, 1);
  assert.equal(app.state.setup.blockId, app.athlete().blocks[0].id);
});

test('the adopted plan trains at the SAME paces the preview showed, not a different goal', () => {
  const { preview, build } = realPreview(RAW_INPUT);
  const app = loadApp({ pinnedDate: PINNED });
  bankPending(app, build);
  app.adoptPendingBuildIfAny();

  const activeGoalTime = app.state.setup.goals[app.state.setup.activeGoal].timeSec;
  const vdotFromGoal = app.vdotFromPerformance(
    app.DISTANCE_PROFILES[app.state.setup.distanceKey].raceKm * 1000, activeGoalTime);
  const vdotFromBenchmark = app.vdotFromPerformance(10000, build.benchmarkSeconds);
  // Goal B is exactly the benchmark-equivalent pace -- see adoptPendingBuildIfAny()'s
  // own comment. If this ever drifts, the athlete sees different training
  // paces the moment they enter the app than the preview just showed them.
  assert.ok(Math.abs(vdotFromGoal - vdotFromBenchmark) < 0.05,
    'the active goal does not correspond to the benchmark VDOT the preview used: ' +
    vdotFromGoal + ' vs ' + vdotFromBenchmark);
  assert.ok(preview.paces && preview.paces.length > 0, 'fixture produced no comparable preview paces');
});

// ---------------------------------------------------------------------------
// GOAL AMBITION -- the athlete's own choice, not a bridge invention.
//
// A/B/C represent three different race targets (Dream/Solid/Safety Net), not
// three interchangeable internal representations -- picking one over another
// changes every training pace in the block. The bridge must carry whichever
// one the athlete actually chose through to the real plan, never overriding
// it with its own default once a real choice was made.
// ---------------------------------------------------------------------------
['A', 'B', 'C'].forEach(ambition => {
  test('goalAmbition=' + ambition + ' is honoured end to end, not overridden', () => {
    const input = Object.assign({}, RAW_INPUT, { goalAmbition: ambition });
    const { preview, build } = realPreview(input);
    assert.equal(build.goalAmbition, ambition, 'buildEcho() dropped the chosen ambition');

    const app = loadApp({ pinnedDate: PINNED });
    bankPending(app, build);
    app.adoptPendingBuildIfAny();

    assert.equal(app.state.setup.activeGoal, ambition,
      'the adopted plan is not training toward the ambition the athlete chose');

    // And the paces the athlete is actually training at still match what
    // the preview showed for THIS ambition (not silently pinned to B).
    const activeGoalTime = app.state.setup.goals[app.state.setup.activeGoal].timeSec;
    const vdotFromGoal = app.vdotFromPerformance(
      app.DISTANCE_PROFILES[app.state.setup.distanceKey].raceKm * 1000, activeGoalTime);
    const mult = Preview.GOAL_AMBITION_MULT[ambition];
    const vdotFromPreview = app.vdotFromPerformance(10000, build.benchmarkSeconds) * mult;
    assert.ok(Math.abs(vdotFromGoal - vdotFromPreview) < 0.05,
      ambition + ': adopted-plan VDOT ' + vdotFromGoal + ' vs preview VDOT ' + vdotFromPreview);
    assert.ok(preview.paces && preview.paces.length > 0);
  });
});

test('the three ambitions genuinely produce different training paces, proving the choice is wired', () => {
  const easy = ['A', 'B', 'C'].map(ambition => {
    const { preview } = realPreview(Object.assign({}, RAW_INPUT, { goalAmbition: ambition }));
    return preview.paces.find(p => p.zone === 'Easy').range;
  });
  assert.notEqual(easy[0], easy[1], 'Dream and Solid produced identical easy paces');
  assert.notEqual(easy[1], easy[2], 'Solid and Safety Net produced identical easy paces');
});

test('an older client that omits goalAmbition still gets exactly the old behaviour (B)', () => {
  const { preview, build } = realPreview(RAW_INPUT); // RAW_INPUT sets no goalAmbition
  assert.equal(build.goalAmbition, 'B');
  const app = loadApp({ pinnedDate: PINNED });
  bankPending(app, build);
  app.adoptPendingBuildIfAny();
  assert.equal(app.state.setup.activeGoal, 'B');
});

test('an invalid goalAmbition is refused by the server, not silently coerced', () => {
  const v = Preview.validate(Object.assign({}, RAW_INPUT, { goalAmbition: 'Z' }));
  assert.equal(v.ok, false);
  assert.equal(v.code, 'unknown_goal_ambition');
});

test('start.html asks the athlete directly, defaulting to no invented stretch or pullback', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'start.html'), 'utf8');
  assert.match(src, /How ambitious should this block be/);
  assert.match(src, /data-ambition="A"/);
  assert.match(src, /data-ambition="B"[^]*?aria-pressed="true"/);
  assert.match(src, /data-ambition="C"/);
  assert.match(src, /goalAmbition:\s*ambition/, 'the chosen ambition is never sent to the server');
});

test('6 -- the builder gate never fires once a plan has been adopted', () => {
  const { build } = realPreview(RAW_INPUT);
  const app = loadApp({ pinnedDate: PINNED });
  bankPending(app, build);
  app.adoptPendingBuildIfAny();
  // This is the literal condition renderHero() and renderMainContent() gate
  // the "Build Your Training Block" screen on.
  assert.equal(!app.state.setup, false, 'the athlete would still be shown the builder gate');
  const hero = app.renderHero();
  assert.doesNotMatch(hero, /Build Your Training Block/,
    'the builder gateway still renders after a plan was adopted');
});

// ---------------------------------------------------------------------------
// 9. AN EXISTING PLAN CAN NEVER BE OVERWRITTEN
// ---------------------------------------------------------------------------
test('9 -- a returning athlete\'s existing plan is never touched, even with a build banked', () => {
  const { build } = realPreview(RAW_INPUT);
  const app = loadApp({ pinnedDate: PINNED });
  const existing = { distanceKey: 'full', currentVolume: 60, raceDate: '2026-12-01',
    startDate: '2026-08-01', planWeeks: 16, schedule: { activeDays: [0,1,2,3,4], longRunDay: 4 },
    blockId: 'existing-block', purpose: 'race',
    benchmark: { distanceKey: '10k', timeSec: 2400 },
    goals: { A: { timeSec: 12000 } }, activeGoal: 'A', paceOverrides: {}, lthr: null, maxHR: null,
    experience: 'experienced' };
  app.state.setup = Object.assign({}, existing);
  app.state.days = [{ date: '2026-08-20', week: 3, type: 'easy', km: 8 }];
  bankPending(app, build);

  const adopted = app.adoptPendingBuildIfAny();
  assert.equal(adopted, false, 'an existing plan was overwritten');
  assert.deepEqual(app.state.setup, existing, 'the existing plan was mutated');
  assert.equal(app.state.days.length, 1, 'existing training days were replaced');
});

// ---------------------------------------------------------------------------
// 10. ABANDONED / CORRUPT / FOREIGN STATE IS SAFELY HANDLED
// ---------------------------------------------------------------------------
test('10a -- a stale banked build (older than 48h) is not adopted, and is cleared', () => {
  const { build } = realPreview(RAW_INPUT);
  const app = loadApp({ pinnedDate: PINNED });
  bankPending(app, build, { savedAt: PINNED_MS - 49 * 60 * 60 * 1000 });

  const adopted = app.adoptPendingBuildIfAny();
  assert.equal(adopted, false, 'a 49-hour-old build was adopted');
  assert.equal(app.state.setup, null);
  assert.equal(app.window.localStorage.getItem('vvv_pending_build'), null,
    'a rejected stale build was left sitting in storage');
});

test('10b -- corrupt JSON in the pending slot is not adopted, and is cleared', () => {
  const app = loadApp({ pinnedDate: PINNED });
  app.window.localStorage.setItem('vvv_pending_build', '{not valid json');
  const adopted = app.adoptPendingBuildIfAny();
  assert.equal(adopted, false);
  assert.equal(app.state.setup, null);
  assert.equal(app.window.localStorage.getItem('vvv_pending_build'), null);
});

test('10c -- a build missing required fields is not adopted, and is cleared', () => {
  const app = loadApp({ pinnedDate: PINNED });
  app.window.localStorage.setItem('vvv_pending_build', JSON.stringify({ savedAt: Date.now() }));
  const adopted = app.adoptPendingBuildIfAny();
  assert.equal(adopted, false);
  assert.equal(app.state.setup, null);
});

test('10d -- a build that fails the real builder\'s own validation rules is refused', () => {
  const app = loadApp({ pinnedDate: PINNED });
  const { build } = realPreview(RAW_INPUT);
  // 7 active days -- /start's mini-builder now refuses this client-side too
  // (see start.html), but the app must refuse it independently regardless of
  // what reaches localStorage.
  const badBuild = Object.assign({}, build, { activeDays: [0,1,2,3,4,5,6] });
  bankPending(app, badBuild);
  assert.equal(app.adoptPendingBuildIfAny(), false, 'an out-of-range day count was adopted');
  assert.equal(app.state.setup, null);
});

test('10e -- no pending build at all is a safe no-op', () => {
  const app = loadApp({ pinnedDate: PINNED });
  assert.equal(app.adoptPendingBuildIfAny(), false);
  assert.equal(app.state.setup, null);
});

test('10f -- a build banked for a DIFFERENT account is refused, not silently inherited', () => {
  const { build } = realPreview(RAW_INPUT);
  const app = loadApp({ pinnedDate: PINNED });
  app.cloudSession = { access_token: fakeJwt('athlete-b') };
  bankPending(app, build, { uid: 'athlete-a' });

  const adopted = app.adoptPendingBuildIfAny();
  assert.equal(adopted, false, 'athlete B silently inherited athlete A\'s abandoned build');
  assert.equal(app.state.setup, null);
});

test('a build already tagged for the SIGNED-IN account is adopted normally', () => {
  const { build } = realPreview(RAW_INPUT);
  const app = loadApp({ pinnedDate: PINNED });
  app.cloudSession = { access_token: fakeJwt('athlete-a') };
  bankPending(app, build, { uid: 'athlete-a' });
  assert.equal(app.adoptPendingBuildIfAny(), true);
});

test('a build never claimed by anyone (no uid stamp) is still adopted normally', () => {
  const { build } = realPreview(RAW_INPUT);
  const app = loadApp({ pinnedDate: PINNED });
  app.cloudSession = { access_token: fakeJwt('athlete-a') };
  bankPending(app, build); // no uid field at all
  assert.equal(app.adoptPendingBuildIfAny(), true);
});

// ---------------------------------------------------------------------------
// IDEMPOTENCY -- init()'s fallback and cloudReconcile()'s hook can never
// double-adopt, whichever one runs first.
// ---------------------------------------------------------------------------
test('adoption never fires twice, even if called again after succeeding', () => {
  const { build } = realPreview(RAW_INPUT);
  const app = loadApp({ pinnedDate: PINNED });
  bankPending(app, build);
  assert.equal(app.adoptPendingBuildIfAny(), true);
  const firstBlockId = app.state.setup.blockId;
  assert.equal(app.adoptPendingBuildIfAny(), false, 'a second call adopted again');
  assert.equal(app.state.setup.blockId, firstBlockId, 'a second block was opened');
  assert.equal(app.athlete().blocks.length, 1);
});

// ---------------------------------------------------------------------------
// PERSISTENCE -- consent and HR data are never smuggled in from an
// unauthenticated build, and the athlete's existing consent card still fires.
// ---------------------------------------------------------------------------
test('an adopted plan never carries LTHR/MaxHR, and consent is left for the app to ask', () => {
  const { build } = realPreview(RAW_INPUT);
  const app = loadApp({ pinnedDate: PINNED });
  bankPending(app, build);
  app.adoptPendingBuildIfAny();
  assert.equal(app.state.setup.lthr, null);
  assert.equal(app.state.setup.maxHR, null);
  assert.equal(app.state.healthConsent, null, 'consent must not be inferred from reaching the end of acquisition');
});

// ---------------------------------------------------------------------------
// DEFECT REGRESSION -- start.html's weekday numbering must agree with the
// engine's ISO numbering (Mon=0..Sun=6), or every previewed/adopted plan
// runs on the wrong days.
// ---------------------------------------------------------------------------
test('start.html sends the engine\'s own ISO weekday numbering, not getDay()', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'start.html'), 'utf8');
  assert.match(src, /var DOW\s*=\s*\[0,\s*1,\s*2,\s*3,\s*4,\s*5,\s*6\]/,
    'start.html no longer sends ISO weekday numbers (Mon=0..Sun=6)');
});

test('a Saturday long run picked on /start lands on a Saturday in the adopted plan', () => {
  // ISO 5 = Saturday. This is the exact regression the investigation found:
  // getDay() numbering shifted every chosen day by one.
  const input = Object.assign({}, RAW_INPUT, { activeDays: [0,1,2,4,5], longRunDay: 5 });
  const { build } = realPreview(input);
  const app = loadApp({ pinnedDate: PINNED });
  bankPending(app, build);
  app.adoptPendingBuildIfAny();
  const longRuns = app.state.days.filter(d => d.type === 'long');
  assert.ok(longRuns.length > 0, 'no long run was scheduled at all');
  longRuns.forEach(d => {
    assert.equal(app.isoWeekday(d.date), 5, 'a long run landed on the wrong weekday: ' + d.date);
  });
});

// ---------------------------------------------------------------------------
// AN UNREACHABLE CLOUD MUST NOT STRAND A BANKED BUILD.
//
// init()'s own fallback only adopts when cloud sync is not going to run at
// all (cloud disabled, or no session stored). It has no way to predict a
// network failure -- cloudInit() genuinely tries to reconcile and only then
// discovers it cannot reach the account. Without a second safety net inside
// cloudInit() itself, a signed-in athlete with a valid banked build and
// nothing but bad luck on the network would be stuck at the builder gate.
// ---------------------------------------------------------------------------
test('a signed-in athlete whose cloud is unreachable still gets their banked plan', () => {
  const { build } = realPreview(RAW_INPUT);
  const app = loadApp({ pinnedDate: PINNED });
  bankPending(app, build);

  // The harness's fetch always rejects (network disabled) -- exactly an
  // unreachable cloud. A refresh_token and no future expires_at forces
  // cloudRefreshIfNeeded() down the real network path instead of its
  // still-valid short-circuit.
  app.cloudSession = { access_token: 'stale', refresh_token: 'r', user_id: 'athlete-a' };

  return app.cloudInit().then(() => {
    assert.equal(app.cloudRefreshUnreachable, true, 'the fixture did not actually simulate unreachable');
    assert.ok(app.state.setup, 'the banked build was never adopted when the cloud could not be reached');
    assert.equal(app.state.setup.distanceKey, build.distanceKey);
  });
});

test('cloudInit()\'s unreachable branch does not adopt when a plan already exists', () => {
  const { build } = realPreview(RAW_INPUT);
  const app = loadApp({ pinnedDate: PINNED });
  const existing = { distanceKey: 'full', currentVolume: 60, raceDate: '2026-12-01',
    startDate: '2026-08-01', planWeeks: 16, schedule: { activeDays: [0,1,2,3,4], longRunDay: 4 },
    blockId: 'existing-block', purpose: 'race', benchmark: { distanceKey: '10k', timeSec: 2400 },
    goals: { A: { timeSec: 12000 } }, activeGoal: 'A', paceOverrides: {}, lthr: null, maxHR: null,
    experience: 'experienced' };
  app.state.setup = Object.assign({}, existing);
  bankPending(app, build);
  app.cloudSession = { access_token: 'stale', refresh_token: 'r', user_id: 'athlete-a' };

  return app.cloudInit().then(() => {
    assert.deepEqual(app.state.setup, existing, 'an existing plan was overwritten by the unreachable-cloud fallback');
  });
});

// ---------------------------------------------------------------------------
// AN ADOPTED PLAN MUST ACTUALLY APPEAR ON SCREEN.
//
// init() paints the app once, synchronously, before either async adoption
// path (cloudReconcile()'s hook, cloudInit()'s unreachable fallback) has a
// chance to run -- and that first paint necessarily shows the builder gate,
// because there was still no plan when it ran. Populating state.setup after
// that without repainting leaves the athlete staring at "Build Your Training
// Block" with a real plan sitting in memory one tap away from nowhere. A
// live walkthrough against the real server caught exactly this: the plan was
// there in state, but the screen never moved off the builder gate.
// ---------------------------------------------------------------------------
test('cloudInit()\'s unreachable-cloud adoption actually repaints the app', () => {
  const { build } = realPreview(RAW_INPUT);
  const app = loadApp({ pinnedDate: PINNED });
  bankPending(app, build);
  app.cloudSession = { access_token: 'stale', refresh_token: 'r', user_id: 'athlete-a' };

  let renderCount = 0;
  const originalRenderApp = app.renderApp;
  app.renderApp = function(){ renderCount += 1; return originalRenderApp.apply(this, arguments); };

  return app.cloudInit().then(() => {
    assert.ok(app.state.setup, 'sanity: the plan was not actually adopted in this fixture');
    assert.ok(renderCount >= 1, 'the app never repainted after adopting the banked build');
  });
});

test('cloudReconcile()\'s primary adoption hook also repaints the app', () => {
  const { build } = realPreview(RAW_INPUT);
  const app = loadApp({ pinnedDate: PINNED });
  bankPending(app, build);
  app.cloudSession = { access_token: 'stale', refresh_token: 'r', user_id: 'athlete-a' };
  // Bypass the network entirely: this is the exact shape cloudReconcile()
  // sees once a signed-in athlete's account genuinely has no plan on it.
  app.cloudGetPlan = function(){ return Promise.resolve({ data: null }); };

  let renderCount = 0;
  const originalRenderApp = app.renderApp;
  app.renderApp = function(){ renderCount += 1; return originalRenderApp.apply(this, arguments); };

  return app.cloudReconcile().then(() => {
    assert.ok(app.state.setup, 'sanity: the plan was not actually adopted in this fixture');
    assert.ok(renderCount >= 1, 'the app never repainted after cloudReconcile() adopted the banked build');
  });
});

test('cloudInit()\'s unreachable-cloud fallback does not force a repaint when nothing was adopted', () => {
  const app = loadApp({ pinnedDate: PINNED });
  // No pending build banked -- adoptPendingBuildIfAny() has nothing to do.
  app.cloudSession = { access_token: 'stale', refresh_token: 'r', user_id: 'athlete-a' };

  let renderCount = 0;
  const originalRenderApp = app.renderApp;
  app.renderApp = function(){ renderCount += 1; return originalRenderApp.apply(this, arguments); };

  return app.cloudInit().then(() => {
    assert.equal(app.state.setup, null);
    assert.equal(renderCount, 0, 'a repaint was forced even though nothing was adopted');
  });
});
