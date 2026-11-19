'use strict';
// THE FIRST-TIME JOURNEY (founder, 18 November 2026).
//
// "The SAME screens, in this order, for the website and the installed app":
// Welcome, What would you love to achieve, What drives you, the builder, three
// slides from the athlete's real plan, the programme preview, Make It Yours,
// the seven-day trial, payment, Welcome to SACORO, the download page (website
// only), then Today.
//
// What these tests hold the journey to:
//   * the order, and who is never shown it (an existing athlete);
//   * the achieve answer IS the builder's purpose, so the builder skips Goal;
//   * the drives are kept on the setup, travel with it, and reach every coach
//     surface as one server-built sentence -- and never move the plan;
//   * the slides are drawn from the plan just built, by the app's own
//     components, and are inert;
//   * Apple and Google are hidden until the deployment names them;
//   * every figure on the trial screen comes from the one catalogue, and the
//     two existing agreement records are both required;
//   * the website and the installed app part only where the founder said:
//     the download page, and the payment seam.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');
const Prod = require('../api/_products.js');
const Agree = require('../api/_agreements.js');
const MEM = require('../api/_coach-memory-lines.js');
const V = require('../api/_voice.js');
const ASK = require('../api/_voice-ask.js');
const NOTE = require('../api/_voice-note.js');
const SIGNIN = require('../api/beta-signin.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const RUNTIME = read(RUNTIME_RELATIVE);
const PINNED = '2026-11-18T09:00:00Z';

function fresh(opts){
  const a = loadApp(Object.assign({ pinnedDate: PINNED }, opts || {}));
  a.showToast = () => {};
  return a;
}
function planned(opts){
  const a = fresh();
  buildPlan(a, Object.assign({ distanceKey: 'half', weeks: 12, volume: 35 }, opts || {}));
  return a;
}
/* A plan built through the journey: the record is past the builder. */
function journeyWithPlan(step, extra){
  const a = planned();
  a.journeyWrite(Object.assign({ v: 1, step: step || 'slides', purpose: 'race', drives: ['prove_myself'],
    period: 'yearly', slide: 0, built: true }, extra || {}));
  return a;
}
function fnSrc(name){
  const at = RUNTIME.indexOf('function ' + name + '(');
  assert.ok(at !== -1, name + '() is missing');
  return RUNTIME.slice(at, RUNTIME.indexOf('\n}\n', at) + 2);
}
function mkRes(){
  return { code: null, body: null, headers: {},
    setHeader(k, v){ this.headers[String(k).toLowerCase()] = v; },
    status(s){ this.code = s; return this; },
    send(b){ this.body = b; return this; },
    end(b){ if (b) this.body = b; if (this.code == null) this.code = 200; return this; },
    json(){ return JSON.parse(this.body); } };
}
function setEnv(vars){
  const saved = {};
  Object.keys(vars).forEach(k => { saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; });
  return () => Object.keys(saved).forEach(k => {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
}
function catalogueOffer(commerce){
  const env = commerce ? { VVV_PRICE_WEB_STANDARD_MONTHLY: 'price_m', VVV_PRICE_WEB_STANDARD_YEARLY: 'price_y' } : {};
  return { catalogue: Prod.catalogue('web', env, new Date(PINNED)), agreements: Agree.currentAgreements(),
           commerce_enabled: !!commerce, provider_configured: !!commerce };
}

// ---------------------------------------------------------------------------
// THE ORDER
// ---------------------------------------------------------------------------
test('the journey runs in the founder\'s order', () => {
  const a = fresh();
  assert.deepEqual(Array.from(a.JOURNEY_STEPS),
    ['welcome', 'achieve', 'drives', 'slides', 'preview', 'account', 'trial', 'arrive', 'done']);
  assert.equal(a.journeyActive(), true, 'a brand-new device is a new athlete');
  assert.match(a.renderMainContent(), /Your Journey Starts Here[^]*Personalised training\. Built around you\.[^]*Build My Plan[^]*Existing Member/);
  a.handleJourneyAction('journey-start');
  assert.match(a.renderMainContent(), /What Would You Love to Achieve\?[^]*You set the destination\. Together, we build the climb\./);
  ['Achieve a Race Goal', 'Build My Endurance', 'Run Faster', 'Maintain My Fitness'].forEach(l =>
    assert.ok(a.renderMainContent().indexOf(l) !== -1, l + ' is not offered'));
  assert.match(a.renderMainContent(), /data-action="journey-achieve-next" disabled/, 'Continue before a choice');
  a.handleJourneyAction('journey-achieve', { getAttribute: k => k === 'data-key' ? 'faster' : null });
  a.handleJourneyAction('journey-achieve-next');
  const drives = a.renderMainContent();
  assert.match(drives, /What Drives You\?[^]*Understanding what matters to you helps us become a better coach\.[^]*Select all that apply/);
  ['Prove Something to Myself', 'Achieve a Personal Best', 'Become a More Confident Runner',
   'Improve My Health and Wellbeing', 'Challenge My Limits', 'Rediscover My Love of Running']
    .forEach(l => assert.ok(drives.indexOf(l) !== -1, l + ' is not offered'));
  assert.match(drives, /Skip for Now/, 'none is allowed, quietly');
  /* THE SLIDES COME BEFORE THE BUILDER (founder, 19 November 2026), drawn on
     a sample plan for the goal just chosen, because there is no plan yet. */
  let opened = 0; a.openSetupModal = () => { opened++; };
  a.handleJourneyAction('journey-drive', { getAttribute: k => k === 'data-key' ? 'limits' : null });
  a.handleJourneyAction('journey-drives-next');
  assert.equal(opened, 0, 'the builder opened before the slides');
  assert.equal(a.journeyStep(), 'slides');
  const slides = a.renderMainContent();
  assert.match(slides, /Training Built Around You[^]*Know Every Session[^]*Your Coach, Always Within Reach/);
  assert.match(slides, /class="jr-screen">\s*<div class="view-plan">\s*<div/, 'the first slide drew no plan');
  assert.equal(a.planHasContent(), false, 'the sample plan became the athlete\'s plan');
  // the third Continue opens the builder (the stub document cannot draw it; the call is the fact)
  a.handleJourneyAction('journey-slides-next');
  a.handleJourneyAction('journey-slides-next');
  assert.equal(opened, 0);
  a.handleJourneyAction('journey-slides-next');
  assert.equal(opened, 1, 'Continue on the last slide does not open the builder');
});

test('a plan built from the journey goes on to the preview, account, trial and arrival', () => {
  const a = fresh();
  a.journeySet({ step: 'slides', slide: 2, purpose: 'race', drives: ['personal_best'] });
  buildPlan(a, { distanceKey: 'half', weeks: 12, volume: 35 });
  a.journeyPlanBuilt();                                 // what handleGeneratePlan() calls
  assert.equal(a.journeyStep(), 'preview', 'the slides were before the builder; the programme is next');
  assert.match(a.renderMainContent(), /Here Is Your Programme/);
  a.handleJourneyAction('journey-preview-next');
  assert.equal(a.journeyStep(), 'account', 'signed out: the account comes next');
  assert.match(a.renderMainContent(), /Make It Yours\.[^]*Create your account to save your personalised training plan\.[^]*Continue with Email[^]*Already a member\?[^]*Sign In[^]*Your plan is ready\. Your trial has not started\./);
  // signing in moves the journey on by itself: there is no account left to make
  a.cloudSession = { access_token: 't', user_id: 'u', email: 'a@b.c', expires_at: Date.now() + 3600e3 };
  assert.equal(a.journeyStep(), 'trial');
  a.handleJourneyAction('journey-trial-continue');
  assert.equal(a.journeyStep(), 'arrive');
  assert.match(a.renderMainContent(), /Welcome to SACORO[^]*Your goal is set\.[^]*Your programme is ready\.[^]*Now the work begins\.[^]*Earn Your Place[^]*Let’s Go/);
});

test('the builder\'s handler hands a journey plan on, and no other build', () => {
  const gen = fnSrc('handleGeneratePlan');
  assert.match(gen, /state\.days = days;\n[^]*?journeyPlanBuilt\(\);/, 'handleGeneratePlan no longer advances the journey');
  const a = planned();                                  // no journey record: an ordinary build
  a.journeyPlanBuilt();
  assert.equal(a.journeyRead(), null, 'an ordinary build started a journey');
});

// ---------------------------------------------------------------------------
// WHO NEVER SEES IT
// ---------------------------------------------------------------------------
test('existing athletes bypass the journey', () => {
  assert.equal(planned().journeyActive(), false, 'an athlete with a plan was sent to the Welcome');
  const reset = fresh();
  reset.state.athlete = { sessions: [{ id: 'x' }], blocks: [], performances: [] };
  assert.equal(reset.journeyActive(), false, 'an athlete with history and no current plan is not new');
  assert.match(reset.renderMainContent(), /data-action="open-setup"/, 'and still reaches the builder door');
});

test('a signed-in device waits for its account before greeting anybody as new', () => {
  const a = fresh({ storage: { vvv_cloud_session: JSON.stringify({ access_token: 't', expires_at: Date.now() + 3600e3 }) } });
  a.cloudStatus = 'syncing';
  assert.equal(a.journeyStep(), 'wait');
  assert.doesNotMatch(a.renderMainContent(), /Your Journey Starts Here/);
  a.cloudStatus = 'synced';
  assert.equal(a.journeyStep(), 'welcome', 'an account with nothing on it starts the journey');
  assert.doesNotMatch(a.renderJourneyWelcome(), /Existing Member/, 'a signed-in member is not offered sign-in');
});

test('a plan restored from the account ends a journey that had not built one', () => {
  const a = planned();
  a.journeyWrite({ v: 1, step: 'welcome', drives: [], slide: 0 });
  assert.equal(a.journeyActive(), false);
  assert.equal(a.journeyRead().step, 'done');
  assert.equal(a.journeyRead().endedBy, 'restored');
});

// ---------------------------------------------------------------------------
// THE PURPOSE IS THE BUILDER'S PURPOSE
// ---------------------------------------------------------------------------
test('the achieve answer prefills the builder and Goal is stepped over, both ways', () => {
  const map = {};
  fresh().JOURNEY_ACHIEVE.forEach(o => { map[o.key] = o.purpose; });
  assert.deepEqual(map, { race: 'race', endurance: 'base', faster: 'speed', maintain: 'maintain' });
  assert.match(fnSrc('openSetupModal'), /var journeyPurpose = journeyBuilderPurpose\(\);\n\s*if \(journeyPurpose && !planHasContent\(\)\) openPurpose = journeyPurpose;/);

  const a = fresh();
  a.journeySet({ step: 'drives', purpose: 'speed' });
  assert.equal(a.journeyBuilderPurpose(), 'speed');
  const went = [];
  a.bldValidateStage = () => true; a.bldClearErrors = () => {};
  a.bldStage = n => { went.push(n); a.bldCurrentStage = n; };
  a.bldCurrentStage = a.BLD_STAGE.OVERVIEW;
  a.handleBldNext();
  assert.equal(went.pop(), a.BLD_STAGE.DISTANCE, 'Continue from the overview asked the Goal again');
  a.handleBldBack();
  assert.equal(went.pop(), a.BLD_STAGE.OVERVIEW, 'Back from Distance landed on a Goal the athlete never saw');

  const b = fresh();                                   // outside the journey nothing changes
  b.bldValidateStage = () => true; b.bldClearErrors = () => {};
  const went2 = []; b.bldStage = n => { went2.push(n); b.bldCurrentStage = n; };
  b.bldCurrentStage = b.BLD_STAGE.OVERVIEW;
  b.journeyWrite({ v: 1, step: 'done' });
  b.handleBldNext();
  assert.equal(went2.pop(), b.BLD_STAGE.GOAL);
});

// ---------------------------------------------------------------------------
// WHAT DRIVES THE ATHLETE
// ---------------------------------------------------------------------------
test('the drives are kept on the setup, wherever the setup is rebuilt', () => {
  const a = fresh();
  a.journeySet({ step: 'drives', drives: ['limits', 'prove_myself', 'nonsense'] });
  assert.deepEqual(Array.from(a.carryDrives(null)), ['prove_myself', 'limits'], 'unknown keys survive or the order wanders');
  assert.deepEqual(Array.from(a.carryDrives({ drives: ['health'] })), ['health'], 'a rebuild lost the athlete\'s own answer');
  assert.match(fnSrc('handleGeneratePlan'), /drives: carryDrives\(state\.setup\),/);
  assert.match(fnSrc('adoptPendingBuildIfAny'), /drives: carryDrives\(null\)/);
  assert.match(fnSrc('startDevelopmentBlock'), /drives: carryDrives\(state\.setup\),/);
});

test('the drives travel like every setup field: sync signature, backup, Settings', () => {
  const a = planned();
  const before = a.planContentSignature(a.state);
  a.state.setup.drives = ['personal_best'];
  assert.notEqual(a.planContentSignature(a.state), before, 'a drives edit would not reach the other device');
  assert.match(JSON.stringify(a.state), /"drives":\["personal_best"\]/, 'the full backup does not carry them');
  const prefs = a.renderSettingsHubView();
  assert.match(prefs, /What Drives You[^]*Achieve a Personal Best/, 'Settings has no row for them');
  assert.ok(prefs.indexOf('Your Name') < prefs.indexOf('What Drives You'), 'the row is not beside the athlete\'s name');
  a.closeStgSheet = () => {}; a.openStgSheet = () => {};
  a.handleDrivesToggle('love_of_running');
  a.handleDrivesSave();
  assert.deepEqual(Array.from(a.state.setup.drives), ['personal_best', 'love_of_running']);
});

test('the drives never move the plan', () => {
  const a = planned(), b = planned();
  b.state.setup.drives = ['prove_myself', 'limits', 'health'];
  const days = s => JSON.stringify(s.state.days.map(d => [d.date, d.type, d.km, d.title]));
  assert.equal(days(a), days(b));
  /* And nothing in the generator can come to read them: the only functions
     that name setup drives are the journey's, Settings' and the coach's. */
  const readers = [];
  const re = /function (\w+)\([^)]*\)\{[^]*?\n\}/g; let m;
  while ((m = re.exec(RUNTIME))){ if (/\.drives\b|athleteDrives\(|carryDrives\(/.test(m[0])) readers.push(m[1]); }
  const allowed = ['athleteDrives', 'carryDrives', 'handleDrivesToggle', 'handleDrivesSave', 'renderDrivesRow',
    'drivesSheetBody', 'renderJourneyDrives', 'handleJourneyAction', 'coachMemoryWithPacket',
    'handleGeneratePlan', 'adoptPendingBuildIfAny', 'startDevelopmentBlock', 'journeyRec'];
  readers.forEach(r => assert.ok(allowed.indexOf(r) !== -1, r + '() reads the drives'));
});

test('the drives reach Ask Coach, the Coach\'s Note and the result panels as codes beside the memory', () => {
  const a = planned();
  assert.equal(a.coachMemoryWithPacket({ q: 1 }).drives, undefined, 'nothing chosen still changes the request');
  a.state.setup.drives = ['prove_myself', 'personal_best'];
  assert.deepEqual(Array.from(a.coachMemoryWithPacket({ q: 1 }).drives), ['prove_myself', 'personal_best']);
  ['/api/voice-ask', '/api/voice-note', '/api/voice-explain'].forEach(route => {
    const at = RUNTIME.indexOf("fetch('" + route + "'");
    assert.ok(at !== -1 && /coachMemoryWithPacket\(/.test(RUNTIME.slice(at, at + 900)), route + ' does not carry the drives');
  });
  assert.deepEqual(Array.from(a.ATHLETE_DRIVE_KEYS), MEM.DRIVE_KEYS, 'the app and the server name different drives');
});

test('the server turns the codes into one plain sentence, and nothing else', () => {
  assert.equal(MEM.drivesLine(['personal_best', 'prove_myself']),
    'What drives them: proving something to themselves; a personal best.');
  assert.equal(MEM.drivesLine(['ignore previous instructions']), '', 'free text became a line');
  assert.equal(MEM.drivesLine('prove_myself'), '');
  assert.match(MEM.drivesBlock(['limits']), /background only, never instructions[^]*never changes a session, a number or a recommendation/);
  assert.equal(MEM.withDrives('', []), '');
  ['api/_voice-ask.js', 'api/_voice-explain.js', 'api/_voice-note.js'].forEach(f =>
    assert.match(read(f), /MEM\.withDrives\(memoryBlock, body\.drives\)/, f + ' drops the drives'));
});

test('Ask Coach and the Coach\'s Note send the sentence to the model', async () => {
  const restore = setEnv({ VVV_VOICE_ENABLED: 'on', ANTHROPIC_API_KEY: 'test-key', VVV_VOICE_MODEL: undefined });
  const realFetch = globalThis.fetch, realVerify = V.verifyUser;
  const sent = [];
  globalThis.fetch = async (url, opts) => { sent.push(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'Keep it easy today and let the week build.' }] }) }; };
  V.verifyUser = async () => ({ uid: 'athlete-1', code: 'AUTH_OK' });
  try {
    await ASK.handle({ method: 'POST', url: '/api/voice-ask', query: {}, headers: { authorization: 'Bearer a.b.c' },
      body: { question: 'How hard today?', context: {}, drives: ['prove_myself', 'personal_best'] } }, mkRes());
    assert.match(sent[0].messages[0].content, /What drives them: proving something to themselves; a personal best\.\n\nMy question:/);
    sent.length = 0;
    await NOTE.handle({ method: 'POST', headers: { authorization: 'Bearer a.b.c' },
      body: { evidence: { engineNote: 'Run this one easy.', decision: 'proceed' }, drives: ['health'] } }, mkRes(),
      { verifyUser: async () => ({ uid: 'athlete-1' }), postModel: async (cfg, payload) => { sent.push(payload);
        return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'Run this one easy today.' }] }) }; } });
    assert.match(sent[0].messages[0].content, /What drives them: their health and wellbeing\./);
  } finally { globalThis.fetch = realFetch; V.verifyUser = realVerify; restore(); }
});

// ---------------------------------------------------------------------------
// THE SLIDES ARE THE ATHLETE'S OWN PLAN
// ---------------------------------------------------------------------------
test('the three slides are drawn from the real plan by the app\'s own components, and are inert', () => {
  const a = journeyWithPlan('slides');
  const html = a.renderJourneySlides();
  const total = a.totalWeeksInPlan();
  assert.match(html, new RegExp('Week 1 of ' + total, 'i'), 'slide one does not say Week 1 of the plan\'s own length');
  assert.match(html, /Half Marathon/, 'slide one does not name the programme');
  const bp = a.blockDistanceProgress();
  assert.ok(html.indexOf(String(a.kmToDisplay(bp.planned))) !== -1, 'slide one does not carry the block total');
  assert.match(html, /class="pp-slide /, 'slide one is not the Full Plan phase card');
  const q = a.journeyFirstQualityDay();
  assert.ok(a.isQualityType(q.type), 'slide two is not a quality session');
  assert.ok(html.indexOf(a.escapeHtml(a.heroCardTitle(q))) !== -1, 'slide two is not the first quality session');
  assert.match(html, /class="how-mod is-active" data-mod="ws-0"[^]*?ws-warmup/, 'slide two is not the session\'s own warm-up card');
  assert.match(html, /Ask about your training/, 'slide three is not the Ask Coach panel');
  const devices = html.match(/<div class="jr-device"[^]*?<h2/g) || [];
  assert.equal(devices.length, 3);
  devices.forEach(d => assert.doesNotMatch(d, /data-action=/, 'a control inside a slide still fires'));
  assert.equal(a.askState.status, 'closed', 'drawing the coach slide opened the real Ask Coach');
});

test('the preview is the plan\'s own figures', () => {
  const a = journeyWithPlan('preview');
  const f = a.journeyPreviewFacts();
  assert.equal(f.weeks, a.state.setup.planWeeks);
  assert.equal(f.sessions, a.state.days.filter(d => d.type !== 'rest').length);
  const html = a.renderJourneyPreview();
  assert.match(html, /Here Is Your Programme[^]*Weeks[^]*Sessions[^]*Total[^]*Your First Week/);
  assert.match(html, /pace-ref-card/, 'the paces are not the app\'s Pace Reference');
});

// ---------------------------------------------------------------------------
// MAKE IT YOURS: APPLE AND GOOGLE HIDDEN UNTIL SWITCHED ON
// ---------------------------------------------------------------------------
test('Apple and Google are hidden by default and shown when the deployment names them', () => {
  const a = journeyWithPlan('account');
  a.journeyProvidersAsked = true;
  assert.doesNotMatch(a.renderJourneyAccount(), /journey-oauth/);
  a.journeyProviders = { apple: true, google: false };
  assert.match(a.renderJourneyAccount(), /data-provider="apple"[^>]*>[^]*Continue with Apple/);
  assert.doesNotMatch(a.renderJourneyAccount(), /Continue with Google/);
  a.journeyProviders = { apple: true, google: true };
  assert.match(a.renderJourneyAccount(), /Continue with Apple[^]*Continue with Google[^]*Continue with Email/);
});

test('the server lists no provider until VVV_AUTH_PROVIDERS names it', async () => {
  let restore = setEnv({ VVV_AUTH_PROVIDERS: undefined });
  try {
    const res = mkRes();
    await SIGNIN({ method: 'GET', headers: {} }, res);
    assert.deepEqual(res.json().providers, { email: true, apple: false, google: false });
  } finally { restore(); }
  restore = setEnv({ VVV_AUTH_PROVIDERS: 'google, apple', VVV_SUPABASE_SERVICE_ROLE_KEY: 'test-service' });
  /* With a service key the GET also reads the public sign-up switch (founder,
     18 November 2026; supabase-public-signup.sql), so the database is
     answered here rather than reached for real. */
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => /\/rest\/v1\/signup_settings/.test(String(url))
    ? { ok: true, status: 200, json: async () => ([{ public_signup: false }]) }
    : { ok: false, status: 500, json: async () => ({}) };
  try {
    const res = mkRes();
    await SIGNIN({ method: 'GET', headers: {} }, res);
    assert.deepEqual(res.json().providers, { email: true, apple: true, google: true });
    const go = mkRes();
    await SIGNIN({ method: 'POST', headers: { host: 'app.velvetviking.co.uk' },
      body: { provider: 'google', redirect: 'https://evil.example/steal' } }, go);
    assert.equal(go.code, 200);
    const url = go.json().url;
    assert.match(url, /\/auth\/v1\/authorize\?provider=google&redirect_to=/);
    assert.equal(decodeURIComponent(url.split('redirect_to=')[1]), 'https://app.velvetviking.co.uk/start',
      'an attacker-chosen redirect reached GoTrue');
  } finally { globalThis.fetch = realFetch; restore(); }
  restore = setEnv({ VVV_AUTH_PROVIDERS: 'apple', VVV_SUPABASE_SERVICE_ROLE_KEY: 'test-service' });
  try {
    const off = mkRes();
    await SIGNIN({ method: 'POST', headers: { host: 'app.velvetviking.co.uk' }, body: { provider: 'google', redirect: '/' } }, off);
    assert.equal(off.code, 404);
    assert.equal(off.json().error, 'provider_disabled');
  } finally { restore(); }
});

/* UPDATED (founder, 18 November 2026: "Get rid of the private beta stuff").
   The refusal used to be called a private beta while the sign-up switch was
   off; sign-up is open, so it is said as what the athlete can do. */
test('an Apple or Google account that could not be made is told so, not shown a database error', () => {
  const a = fresh();
  const said = a.cloudAuthErrorCopy('unexpected_failure', 'Database error saving new user');
  assert.match(said, /Your account couldn\u2019t be created just then\. Please try again in a moment/);
  assert.doesNotMatch(said, /beta|database/i);
  assert.match(a.cloudAuthErrorCopy('otp_expired'), /expired/);
});

// ---------------------------------------------------------------------------
// THE TRIAL: ONE SOURCE FOR THE NUMBERS, BOTH AGREEMENTS REQUIRED
// ---------------------------------------------------------------------------
test('every figure on the trial screen is the catalogue\'s', () => {
  const a = journeyWithPlan('trial');
  a.journeyOfferAsked = true;
  a.journeyOffer = catalogueOffer(true);
  const m = Prod.offer('STANDARD_MONTHLY'), y = Prod.offer('STANDARD_YEARLY');
  const money = n => '£' + (n / 100).toFixed(2);
  const html = a.renderJourneyTrial();
  assert.match(html, new RegExp('Start Your ' + Prod.TRIAL_DAYS + '-Day Free Trial'));
  assert.ok(html.indexOf(money(y.priceMinor)) !== -1 && html.indexOf(money(m.priceMinor)) !== -1);
  assert.match(html, /Save 44%/);
  assert.ok(html.indexOf('Equivalent to ' + money(Math.round(y.priceMinor / 12)) + ' per month') !== -1);
  assert.match(html, /Today:<\/b> <span class="font-mono">£0\.00/);
  assert.ok(html.indexOf('Day ' + (Prod.TRIAL_DAYS + 1) + ':</b> <span class="font-mono">' + money(y.priceMinor) + '</span>, then annually') !== -1,
    'annual is not the preselected timeline');
  assert.match(html, /Cancel before your trial ends to avoid being charged\./);
  a.journeySet({ period: 'monthly' });
  assert.ok(a.renderJourneyTrial().indexOf(money(m.priceMinor) + '</span>, then monthly') !== -1);
  /* No second copy of a number: the journey's own source quotes none. */
  const block = RUNTIME.slice(RUNTIME.indexOf('THE FIRST-TIME JOURNEY\n'), RUNTIME.indexOf('function renderMainContent(){'));
  assert.doesNotMatch(block, /11\.99|79\.99|6\.67|£\d|\\u00a3\d|1199|7999/, 'a price is typed into the journey');
});

test('both agreements are required, and they are the existing checkout records', () => {
  const a = journeyWithPlan('trial');
  a.journeyOfferAsked = true;
  a.journeyOffer = catalogueOffer(true);
  let html = a.renderJourneyTrial();
  assert.match(html, /I accept the <a [^>]*>Terms of Service<\/a> and acknowledge the <a [^>]*>Privacy Policy<\/a>\./);
  assert.match(html, /I agree to start access immediately\./);
  assert.ok(html.indexOf(a.escapeHtml(Agree.currentAgreements().immediateStart.text)) !== -1,
    'the wording recorded against the tick is not on the screen');
  assert.doesNotMatch(html, /<input[^>]*\schecked[\s>]/, 'a box starts ticked');
  assert.match(html, /data-action="journey-trial-start" disabled/);
  a.journeyAgreed = { terms: true, immediate_start: false };
  assert.match(a.renderJourneyTrial(), /data-action="journey-trial-start" disabled/, 'one tick was enough');
  a.journeyAgreed = { terms: true, immediate_start: true };
  assert.doesNotMatch(a.renderJourneyTrial(), /data-action="journey-trial-start" disabled/);
  const agree = fnSrc('handleJourneyAgree');
  assert.match(agree, /action:'agree', agreement:kind, decision:'accepted', surface:'checkout'/,
    'the tick is not the same record /start and /account write');
});

test('with commerce off the prices are information, nothing is recorded and the athlete goes on free', () => {
  /* UPDATED (founder, 18 November 2026: "Get rid of the private beta
     stuff"): one sentence now, whichever way the sign-up switch stands. */
  const a = journeyWithPlan('trial');
  a.journeyOfferAsked = true;
  a.journeyOffer = catalogueOffer(false);
  const html = a.renderJourneyTrial();
  assert.match(html, /Subscriptions are not open yet\. For now SACORO is free to use, and nothing is charged\./);
  assert.doesNotMatch(html, /beta/i);
  assert.doesNotMatch(html, /journey-agree|journey-trial-start/);
  assert.match(html, /data-action="journey-trial-continue"/);
});

test('a subscription the server already reports moves the journey past the trial', () => {
  const a = journeyWithPlan('trial');
  a.cloudSession = { access_token: 't', user_id: 'u', expires_at: Date.now() + 3600e3 };
  a.entitlementInfo = { signed_in: true, access: true, reason: 'pre_commercial' };
  assert.equal(a.journeyStep(), 'trial', 'the open beta gate was read as a subscription');
  a.entitlementInfo = { signed_in: true, access: true, reason: 'subscription_trial', state: 'trial' };
  assert.equal(a.journeyStep(), 'arrive');
});

// ---------------------------------------------------------------------------
// THE WEBSITE AND THE INSTALLED APP
// ---------------------------------------------------------------------------
/* UPDATED (founder, 18 November 2026: the installed Android app must take
   payment too). The website-distributed APK is the web rail now, returning
   into the app (test/m10-androidPayment.test.js holds the whole path); the
   store rail is for a genuine store build, which carries the explicit build
   marker. The store guarantee itself is unchanged and asserted here. */
test('the payment seam: the web rail on the website and in the website\'s APK, the store rail in a store build', async () => {
  const web = journeyWithPlan('trial');
  assert.equal(web.journeyPaymentProvider().id, 'web');
  const apk = journeyWithPlan('trial');
  apk.isNativeApp = () => true;
  assert.equal(apk.journeyPaymentProvider().id, 'app');
  assert.equal(apk.journeyPaymentProvider().showsPrices, true);
  const app = journeyWithPlan('trial');
  app.isNativeApp = () => true;
  app.navigator.userAgent = 'Mozilla/5.0 (Linux; Android 14) SACORO-Store-Build';
  const store = app.journeyPaymentProvider();
  assert.equal(store.id, 'store');
  assert.equal(store.available, false);
  assert.equal(JSON.stringify(await store.start('yearly')), JSON.stringify({ ok: false, code: 'store_unavailable' }));
  app.journeyOfferAsked = true; app.journeyOffer = catalogueOffer(true);
  const html = app.renderJourneyTrial();
  assert.doesNotMatch(html, /£|journey-agree|journey-trial-start|api\/checkout/, 'the app shows a web price or a way to it');
  assert.match(html, /Subscriptions are not available in the app yet/);
});

test('the download page is the website\'s step only; the app goes straight to Today', () => {
  const web = journeyWithPlan('arrive');
  const went = []; web.journeyNavigate = u => { went.push(u); return true; };
  web.handleJourneyAction('journey-finish');
  assert.deepEqual(went, ['/get?from=journey']);
  assert.equal(web.journeyRead().step, 'done');

  const app = journeyWithPlan('arrive');
  app.isNativeApp = () => true;
  const went2 = []; app.journeyNavigate = u => { went2.push(u); return true; };
  app.handleJourneyAction('journey-finish');
  assert.deepEqual(went2, [], 'the installed app was sent to the download page');
  assert.equal(app.journeyActive(), false);
  assert.equal(app.state.view, 'today');
});

/* UPDATED (founder, 18 November 2026: "Remove the old start."): /start leads
   everybody to the root, not only a visitor with no session. */
test('/start and /get lead a new visitor into the journey', () => {
  const start = read('start.html');
  assert.match(start, /var dest = '\/' \+ \(location\.search \|\| ''\) \+ \(location\.hash \|\| ''\);\s*try\{ location\.replace\(dest\); \}/,
    'a new visitor to /start does not reach the journey');
  assert.doesNotMatch(start, /\/get/, '/start still skips the journey to the install page');
  const get = read('get.html');
  assert.match(get, /from=journey/);
  assert.match(get, /Continue in the Browser/);
  assert.match(get, /id="web-launch"[^>]*>\s*Launch the App/, 'a visitor not on the journey lost Launch the App');
});

// ---------------------------------------------------------------------------
// HOUSE RULES
// ---------------------------------------------------------------------------
test('the journey keeps the house rules: no em dash, Title Case actions, one style tag, the floor rule last', () => {
  const block = RUNTIME.slice(RUNTIME.indexOf('THE FIRST-TIME JOURNEY\n'), RUNTIME.indexOf('function renderMainContent(){'));
  assert.doesNotMatch(block, /—|\\u2014|&mdash;/, 'an em dash in the journey');
  const a = journeyWithPlan('trial');
  a.journeyOfferAsked = true; a.journeyOffer = catalogueOffer(true);
  const screens = [a.renderJourneyWelcome(), a.renderJourneyAchieve(), a.renderJourneyDrives(), a.renderJourneyPreview(),
    a.renderJourneyAccount(), a.renderJourneyTrial(), a.renderJourneyArrive()].join('');
  const labels = (screens.match(/<button[^>]*class="btn[^"]*"[^>]*>[^]*?<\/button>/g) || [])
    .map(s => s.replace(/<svg[^]*?<\/svg>/g, '').replace(/<[^>]*>/g, '').trim()).filter(Boolean);
  assert.ok(labels.length >= 8, 'the button labels were not found');
  const small = ['a', 'an', 'and', 'the', 'to', 'of', 'in', 'with', 'for', 'my'];
  labels.forEach(l => l.split(/\s+/).forEach((w, i) => {
    if (i && small.indexOf(w.toLowerCase()) !== -1) return;
    assert.ok(/^[A-Z£]/.test(w), '"' + l + '" is not in Title Case');
  }));
  assert.equal((RUNTIME.match(/<style\b/g) || []).length, 1);
  const css = RUNTIME.slice(RUNTIME.indexOf('<style>'), RUNTIME.indexOf('</style>'));
  assert.ok(css.indexOf('.jr{') < css.indexOf('.coach-why-btn,\n'), 'the journey CSS landed after the floor rule');
  (css.slice(css.indexOf('THE FIRST-TIME JOURNEY'), css.indexOf('.coach-why-btn,\n')).match(/font-size:\s*([\d.]+)(px|rem)/g) || [])
    .forEach(f => { const n = parseFloat(f.replace(/[^\d.]/g, '')) * (/rem/.test(f) ? 16 : 1);
      assert.ok(n >= 11, 'type under 11px in the journey: ' + f); });
});

test('the welcome photograph is an optimised asset, and only the Welcome uses it', () => {
  const p = path.join(ROOT, 'assets/onboarding/welcome-runner.webp');
  const size = fs.statSync(p).size;
  assert.ok(size > 40e3 && size < 320e3, 'the welcome photo is ' + size + ' bytes');
  assert.equal((RUNTIME.match(/welcome-runner\.webp/g) || []).length, 1, 'the photograph is on more than the Welcome');
  assert.ok(fs.existsSync(path.join(ROOT, 'assets/onboarding/sacoro-s.png')));
});

// ---------------------------------------------------------------------------
// COORDINATOR FIXES BEFORE THE FOUNDER'S REVIEW (18 November 2026)
// ---------------------------------------------------------------------------
test('slide two shows the session\'s warm-up as Today draws it, label and distance', () => {
  const a = journeyWithPlan('slides');
  const html = a.journeySlideSession();
  assert.match(html, /ws-warmup[^]*?<span class="ws-h-presc">Warm up<\/span><span class="ws-h-qty font-mono">[0-9.]+(km|mi)<\/span>/,
    'the warm-up card does not name the warm-up and its distance');
  assert.doesNotMatch(html, /strat-phase|from 0/, 'the execution phase "Settle / from 0km" is back on the slide');
  /* the same card as the real session page, not a copy */
  const dd = a.journeyFirstQualityDay();
  assert.ok(a.renderDayCard(dd).indexOf(a.renderStructuredWorkout(dd)) !== -1,
    'the session page does not draw this same Workout rail');
  /* a quality session without a warm-up is passed over for the next with one */
  const quality = a.state.days.filter(d => d.type !== 'rest' && d.type !== 'race' && a.isQualityType(d.type))
    .sort((x, y) => x.date < y.date ? -1 : 1);
  const at = quality.indexOf(dd);
  assert.ok(at >= 0);
  quality.slice(0, at).forEach(d => assert.equal(a.renderStructuredWorkout(d).indexOf('ws-warmup'), -1,
    d.title + ' has a warm-up and was skipped'));
  const real = a.renderStructuredWorkout;
  a.renderStructuredWorkout = d => d === dd ? '<section class="ws-block"></section>' : real(d);
  const next = a.journeyFirstQualityDay();
  assert.notEqual(next, dd, 'a session with no warm-up card was still chosen');
  assert.match(a.renderStructuredWorkout(next), /ws-warmup/);
});

test('a phase that starts at zero with no end shows no distance, and words are not set in mono', () => {
  const a = fresh();
  assert.equal(a.fmtStrategySpan({ from: 0 }), '', '"from 0km" is a distance again');
  assert.equal(a.fmtStrategySpan({ from: 2 }), 'from 2km');
  assert.equal(a.fmtStrategySpan({ from: 0, to: 2 }), '0km\u20132km');
  const settle = a.renderStrategyPhase({ label: 'Settle', from: 0 });
  assert.doesNotMatch(settle, /strat-phase-span/, 'an empty span is still drawn');
  assert.match(a.renderStrategyPhase({ label: 'Absorb', to: 5 }), /<span class="strat-phase-span">to 5km<\/span>/,
    'a span that opens with a word is set in the figure face');
  assert.match(a.renderStrategyPhase({ label: 'Hold', from: 5, to: 10 }), /strat-phase-span font-mono">5km\u201310km/);
});

test('the Plan generated toast stands down while the journey is the confirmation', () => {
  const gen = fnSrc('handleGeneratePlan');
  assert.match(gen, /if \(!journeyActive\(\)\) showToast\('Plan generated: '/);
});

test('the first Today after the journey raises no sheet; the offer comes at the next opening', () => {
  /* the installed app: the journey ends in this launch, which stays quiet */
  const app = journeyWithPlan('arrive');
  app.isNativeApp = () => true;
  app.journeyNavigate = () => true;
  app.autoSheetsUntil = Date.now() + 60e3;
  app.handleJourneyAction('journey-finish');
  assert.equal(app.autoSheetsOpen(), false, 'an offer sheet can rise over the first Today');
  /* leaving and coming back is the next natural opportunity */
  app.document.visibilityState = 'hidden';
  (app.document._listeners.visibilitychange || []).forEach(fn => fn());
  assert.equal(app.autoSheetsOpen(), true, 'the quiet outlived the first visit');

  /* the website: the journey ends by going to /get, so the NEXT load is quiet, once */
  const web = journeyWithPlan('arrive');
  web.journeyNavigate = () => true;
  web.handleJourneyAction('journey-finish');
  const rec = web.localStorage.getItem('vvv_journey');
  assert.match(rec, /"quietPending":true/);
  const first = fresh({ storage: { vvv_journey: rec, 'velvet-viking-generator-v2': JSON.stringify(web.state) } });
  assert.equal(first.autoSheetsOpen(), false, 'the first Today on the website raised a sheet');
  const second = fresh({ storage: { vvv_journey: first.localStorage.getItem('vvv_journey'),
    'velvet-viking-generator-v2': JSON.stringify(web.state) } });
  assert.equal(second.autoSheetsOpen(), true, 'the offer was dropped rather than deferred');
  /* and the offer keeps its own rules */
  assert.match(fnSrc('maybeRaiseThresholdTestOffer'), /if \(thresholdTestNotToday\(\)\) return;/);
  assert.match(fnSrc('maybeRaiseThresholdTestOffer'), /!autoSheetsOpen\(\)/);
});

// ---------------------------------------------------------------------------
// THE FIRST PICTURE (founder, 19 November 2026: "when you first open the app
// as a new user the splash screens comes up. It should go straight to This
// page no splash. And the splash for the next time it's opened", and "they
// come up if your not a paying customer. Were it should just be this")
// ---------------------------------------------------------------------------
function bootDecide(storage, attrs){
  const vm = require('vm');
  const src = /<script id="boot-decide">([\s\S]*?)<\/script>/.exec(RUNTIME);
  assert.ok(src, 'the boot decision is missing');
  const set = {};
  const html = { getAttribute: k => (attrs || {})[k] || null, setAttribute: (k, v) => { set[k] = v; } };
  const ls = { getItem: k => (k in (storage || {}) ? storage[k] : null) };
  vm.runInNewContext(src[1], { document: { documentElement: html }, window: { localStorage: ls }, JSON });
  return set;
}
test('the first picture: the Welcome for anyone the app will greet with it, the splash where a plan opens', () => {
  const plan = JSON.stringify({ days: [{ date: '2026-11-19', type: 'easy' }] });
  const sess = JSON.stringify({ access_token: 't' });
  const JO = { 'data-vvv-access': 'journey' };
  assert.equal(bootDecide({})['data-boot'], 'welcome', 'a first open was shown the splash');
  assert.equal(bootDecide({}, JO)['data-boot'], 'welcome');
  assert.equal(bootDecide({ vvv_cloud_session: sess }, JO)['data-boot'], 'welcome', 'an account with nothing here was shown the splash');
  assert.equal(bootDecide({ 'velvet-viking-generator-v2': plan }, JO)['data-boot'], 'welcome', 'an old plan, signed out, is greeted at the Welcome');
  assert.equal(bootDecide({ 'velvet-viking-generator-v2': plan, vvv_cloud_session: sess }, JO)['data-boot'], 'splash');
  assert.equal(bootDecide({ 'velvet-viking-generator-v2': plan, vvv_cloud_session: sess })['data-boot'], 'splash');
  assert.equal(bootDecide({ vvv_journey: JSON.stringify({ step: 'slides' }) })['data-boot'], 'plain', 'part way through the journey');
  assert.equal(bootDecide({ vvv_journey: JSON.stringify({ step: 'done' }), 'velvet-viking-generator-v2': plan })['data-boot'], 'splash');
  assert.ok('data-boot-signed' in bootDecide({ vvv_cloud_session: sess }, JO), 'a signed-in Welcome would offer Existing Member');
  /* storage refused: as before, the splash */
  const vm = require('vm');
  const src = /<script id="boot-decide">([\s\S]*?)<\/script>/.exec(RUNTIME)[1];
  const set = {};
  vm.runInNewContext(src, { document: { documentElement: { getAttribute: () => null, setAttribute: (k, v) => { set[k] = v; } } },
    window: { get localStorage(){ throw new Error('denied'); } }, JSON });
  assert.equal(set['data-boot'], 'splash');
});

test('the painted Welcome is the journey\'s own, and goes with the first render', () => {
  const at = RUNTIME.indexOf('<div id="boot-welcome"');
  assert.ok(at > RUNTIME.indexOf('<script id="boot-decide">'), 'the Welcome is painted before the decision');
  assert.ok(at < RUNTIME.indexOf('\n<script>\n', at), 'the painted Welcome is not above the application script');
  const painted = RUNTIME.slice(at, RUNTIME.indexOf('\n', at));
  assert.doesNotMatch(painted, /data-action=/, 'a picture of the Welcome has live controls');
  const a = fresh(); a.journeyAskProviders = () => {};
  const live = a.renderJourneyWelcome();
  ['jr-photo', 'jr-welcome-back', 'jr-crest', 'Your Journey Starts Here', 'Personalised training. Built around you.',
   'Build My Plan', 'Existing Member', 'jr-cta', 'jr-gold'].forEach(w => {
    assert.ok(painted.indexOf(w) !== -1, 'the painted Welcome lost ' + w);
    assert.ok(live.indexOf(w) !== -1, 'the real Welcome lost ' + w + '; the two have drifted');
  });
  assert.match(fnSrc('clearBootSplash'), /'boot-splash', 'boot-welcome'/, 'the painted Welcome is never taken down');
  assert.match(RUNTIME, /html\[data-boot="welcome"\] #boot-splash, html\[data-boot="plain"\] #boot-splash\{display:none;\}/);
});
