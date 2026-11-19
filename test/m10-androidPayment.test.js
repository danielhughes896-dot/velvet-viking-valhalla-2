'use strict';
// THE INSTALLED ANDROID APP TAKES PAYMENT (founder, 18 November 2026).
//
// "The installed Android app must take payment too." The APK is a Capacitor
// shell that loads the live site and is distributed from the website, not from
// Google Play, so Play billing rules do not apply to it. New sign-ups get the
// seven-day free trial and "it takes the money at that point": a card at the
// trial step, the first charge on day 8, through the same Stripe checkout as
// the website. A genuine store build keeps the store seam, decided by an
// explicit build marker (STORE-COMMERCIAL-BOUNDARY.md).
//
// These tests hold the whole path:
//   * the marker: what decides store vs website-distributed, and that today's
//     APK config does not carry it;
//   * the trial screen in the app is the website's, and its button asks for
//     the checkout with return:'app';
//   * the server turns that one word into two fixed return addresses, never a
//     URL from the request;
//   * Stripe's return, in the phone's browser, is handed back into the app
//     through the custom scheme the manifest already claims;
//   * the app reconciles it with its own token, asks the gate again, and lets
//     the athlete in; a cancelled checkout leaves them at the trial.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');
const Prod = require('../api/_products.js');
const Agree = require('../api/_agreements.js');
const P = require('../api/_stripe.js');
const Portal = require('../api/_portal.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const RUNTIME = read(RUNTIME_RELATIVE);
const ACCOUNT = read('account.html');
const PINNED = '2026-11-18T09:00:00Z';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36';
const tick = () => new Promise(r => setImmediate(r));

function app(opts){
  const a = loadApp(Object.assign({ pinnedDate: PINNED }, opts || {}));
  a.showToast = () => {};
  return a;
}
/* The installed shell, as the bridge reports itself. */
function inAndroid(a, ua){
  a.window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
  a.navigator.userAgent = ua || ANDROID_UA;
  return a;
}
function catalogueOffer(){
  return { catalogue: Prod.catalogue('web', { VVV_PRICE_WEB_STANDARD_MONTHLY: 'price_m', VVV_PRICE_WEB_STANDARD_YEARLY: 'price_y' }, new Date(PINNED)),
           agreements: Agree.currentAgreements(), commerce_enabled: true, provider_configured: true };
}
function atTrial(a){
  buildPlan(a, { distanceKey: 'half', weeks: 12, volume: 35 });
  a.journeyWrite({ v: 1, step: 'trial', built: true, drives: [], slide: 0, period: 'yearly' });
  a.journeyOfferAsked = true;
  a.journeyOffer = catalogueOffer();
  a.cloudSession = { access_token: 'tok', user_id: 'new-athlete', expires_at: Date.now() + 3600e3 };
  return a;
}

// ---------------------------------------------------------------------------
// 1. THE MARKER
// ---------------------------------------------------------------------------
test('today\'s APK config carries no store marker, so it is the website-distributed app', () => {
  const cap = JSON.parse(read('capacitor.config.json'));
  assert.equal(cap.server.url, 'https://app.velvetviking.co.uk', 'the shell no longer loads the live site');
  const flat = JSON.stringify(cap);
  assert.equal(flat.indexOf('SACORO-Store-Build'), -1,
    'capacitor.config.json builds the website-distributed APK; the store marker belongs only in a store build');
  assert.match(RUNTIME, /var STORE_BUILD_MARKER = 'SACORO-Store-Build';/);
  assert.match(ACCOUNT, /indexOf\('SACORO-Store-Build'\) !== -1/, 'account.html asks a different question');
});

test('store or website-distributed is decided by the marker, and iOS is always a store build', () => {
  const a = app();
  assert.equal(a.storeDistributedApp(), false, 'the website is a store build');
  assert.equal(a.websiteDistributedApp(), false, 'the website is an installed app');
  inAndroid(a);
  assert.equal(a.storeDistributedApp(), false, 'today\'s APK was read as a store build');
  assert.equal(a.websiteDistributedApp(), true);
  inAndroid(a, ANDROID_UA + ' SACORO-Store-Build');
  assert.equal(a.storeDistributedApp(), true, 'a Play build with the marker was offered the web checkout');
  a.window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
  a.navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';
  assert.equal(a.storeDistributedApp(), true, 'an iOS shell without the marker was offered the web checkout');
});

test('STORE-COMMERCIAL-BOUNDARY.md documents the marker and the payment path', () => {
  const doc = read('STORE-COMMERCIAL-BOUNDARY.md');
  assert.match(doc, /"appendUserAgent": "SACORO-Store-Build"/);
  assert.match(doc, /Website-distributed \(today's APK\)/);
  assert.match(doc, /com\.velvetviking\.valhalla:\/\/auth\/checkout\?status=complete&session_id=cs_/);
  assert.match(doc, /no new APK is needed/);
  assert.match(doc, /founder, 18 November 2026|Founder, 18 November 2026/);
});

// ---------------------------------------------------------------------------
// 2. THE TRIAL SCREEN IN THE APP IS THE WEBSITE'S
// ---------------------------------------------------------------------------
test('in the website-distributed app the trial screen shows the prices, the ticks and Start My Free Trial', () => {
  const web = atTrial(app());
  const apk = atTrial(inAndroid(app()));
  assert.equal(apk.journeyPaymentProvider().id, 'app');
  const w = web.renderJourneyTrial(), h = apk.renderJourneyTrial();
  const strip = s => s.replace(/<p class="jr-fine jr-centre">[^<]*<\/p>/, '');
  assert.equal(strip(h), strip(w), 'the app\'s trial screen is not the website\'s');
  assert.match(h, /£79\.99[^]*£11\.99/);
  assert.match(h, /data-action="journey-agree" data-kind="terms"/);
  assert.match(h, /data-action="journey-trial-start" disabled>Start My Free Trial</);
  assert.match(h, /Secure payment setup opens in your browser, then brings you back here\./);
  assert.match(w, /Continue to secure payment setup/);
  /* and a store build still shows none of it */
  const store = atTrial(inAndroid(app(), ANDROID_UA + ' SACORO-Store-Build'));
  assert.doesNotMatch(store.renderJourneyTrial(), /£|journey-agree|journey-trial-start/);
});

test('Start My Free Trial in the app asks for the checkout with return:"app", and opens it', async () => {
  const sent = [];
  const a = atTrial(inAndroid(app({ fetch: async (url, o) => {
    sent.push({ url: String(url), o: o || {} });
    return { status: 200, ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test_a1' }) };
  } })));
  a.JOURNEY_ONLY_MODE = true; a.journeyOnlyRefused = true;
  const went = []; a.journeyNavigate = u => { went.push(u); return true; };
  a.renderApp = () => {};
  a.handleJourneyTrialStart();
  await tick(); await tick();
  const co = sent.filter(s => s.url === '/api/checkout');
  assert.equal(co.length, 1);
  assert.equal(co[0].o.headers.Authorization, 'Bearer tok', 'not the athlete\'s own token');
  assert.deepEqual(JSON.parse(co[0].o.body), { period: 'yearly', return: 'app' });
  assert.deepEqual(went, ['https://checkout.stripe.com/c/pay/cs_test_a1'],
    'the payment page was not opened (the shell hands this off-origin address to the browser)');
  assert.equal(a.journeyCheckoutAway, true);
  assert.match(a.renderJourneyTrial(), /Finish setting up payment in your browser\. SACORO brings you back here when it is done\./);
  /* the website asks for nothing but the period */
  const sentWeb = [];
  const w = atTrial(app({ fetch: async (url, o) => { sentWeb.push({ url: String(url), o: o || {} });
    return { status: 200, ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test_b2' }) }; } }));
  w.journeyNavigate = () => true;
  w.handleJourneyTrialStart();
  await tick(); await tick();
  assert.deepEqual(JSON.parse(sentWeb.filter(s => s.url === '/api/checkout')[0].o.body), { period: 'yearly' });
});

// ---------------------------------------------------------------------------
// 3. THE SERVER: ONE WORD, TWO FIXED ADDRESSES
// ---------------------------------------------------------------------------
test('return:"app" chooses the app\'s two fixed return addresses, and nothing else reaches Stripe', async () => {
  const cfg = P.config({ STRIPE_SECRET_KEY: 'sk_test_1', VVV_SITE_ORIGIN: 'https://app.velvetviking.co.uk' });
  assert.deepEqual(P.returnUrls(cfg, 'app'), {
    success: 'https://app.velvetviking.co.uk/account?checkout=complete&session_id={CHECKOUT_SESSION_ID}&return=app',
    cancel: 'https://app.velvetviking.co.uk/account?checkout=cancelled&return=app'
  });
  const webUrls = P.returnUrls(cfg, 'web');
  assert.equal(webUrls.success, 'https://app.velvetviking.co.uk/account?checkout=complete&session_id={CHECKOUT_SESSION_ID}');
  assert.equal(webUrls.cancel, 'https://velvetviking.co.uk/pricing?checkout=cancelled');
  ['https://evil.example/', 'APP', 'app ', null, undefined, {}].forEach(x =>
    assert.deepEqual(P.returnUrls(cfg, x), webUrls, JSON.stringify(x) + ' moved the return address'));

  for (const returnTo of ['app', 'web']){
    let sent = null;
    const r = await P.createCheckoutSession(cfg, { uid: 'u1', accountId: 'u1', customerId: 'cus_1', offerCode: 'STANDARD_YEARLY',
      env: { VVV_PRICE_WEB_STANDARD_YEARLY: 'price_y' }, returnTo },
      { fetch: async (u, i) => {
          /* Checkout verifies the Price before creating a session, so the
             lookup is answered from the catalogue. `sent` is deliberately not
             written here: it holds the session's form body, and a GET with no
             body would blank the assertions below. */
          if (/\/prices\//.test(String(u))) {
            const o = Prod.offer('STANDARD_YEARLY');
            return { ok: true, text: async () => JSON.stringify({
              id: 'price_y', object: 'price', active: true, type: 'recurring',
              currency: String(o.currency).toLowerCase(), unit_amount: o.priceMinor,
              recurring: { interval: 'year', interval_count: 1 },
              product: 'prod_sacoro_standard' }) };
          }
          sent = decodeURIComponent(String(i.body)); return { ok: true, text: async () => JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/x' }) }; } });
    assert.equal(r.ok, true);
    const urls = P.returnUrls(cfg, returnTo);
    assert.ok(sent.indexOf('success_url=' + urls.success) !== -1, returnTo + ': success_url is not the fixed one');
    assert.ok(sent.indexOf('cancel_url=' + urls.cancel) !== -1, returnTo + ': cancel_url is not the fixed one');
    /* the trial and the card upfront are the same for the app */
    assert.ok(sent.indexOf('subscription_data[trial_period_days]=' + Prod.TRIAL_DAYS) !== -1);
    assert.ok(sent.indexOf('payment_method_collection=always') !== -1, 'the app\'s trial takes no card');
  }
});

test('/api/checkout reads only the one word, and keys the app\'s session apart', () => {
  const src = read('api/_checkout.js');
  assert.match(src, /const returnTo = \(body && body\.return === 'app'\) \? 'app' : 'web';/);
  assert.match(src, /offerCode: decision\.offerCode, env: process\.env, returnTo: returnTo/);
  assert.match(src, /\(returnTo === 'app' \? ':app' : ''\)/, 'Stripe would refuse a reused key with a different return');
});

test('the billing portal comes back into the app the same way', () => {
  const stripe = { appOrigin: 'https://app.velvetviking.co.uk' };
  assert.equal(Portal.returnUrl(stripe), 'https://app.velvetviking.co.uk/account?portal=returned');
  assert.equal(Portal.returnUrl(stripe, 'app'), 'https://app.velvetviking.co.uk/account?portal=returned&return=app');
  assert.equal(Portal.returnUrl(stripe, 'https://evil.example'), 'https://app.velvetviking.co.uk/account?portal=returned');
  assert.equal(Portal.returnUrl({}, 'app'), null);
});

// ---------------------------------------------------------------------------
// 4. IN THE PHONE'S BROWSER: HAND BACK TO THE APP
// ---------------------------------------------------------------------------
function accountFn(name){
  const at = ACCOUNT.indexOf('function ' + name + '(');
  assert.ok(at !== -1, name + '() is missing from account.html');
  let depth = 0, i = ACCOUNT.indexOf('{', at);
  for (; i < ACCOUNT.length; i++){
    if (ACCOUNT[i] === '{') depth++;
    else if (ACCOUNT[i] === '}' && --depth === 0) break;
  }
  return ACCOUNT.slice(at, i + 1);
}
const returnTarget = search => new Function('location', 'URLSearchParams',
  accountFn('checkoutSessionId') + accountFn('returnTarget') + 'return returnTarget();')({ search }, URLSearchParams);

test('Stripe\'s return in the browser becomes the app\'s own link, with only the session id carried', () => {
  assert.equal(returnTarget('?checkout=complete&session_id=cs_test_a1B2&return=app'),
    'com.velvetviking.valhalla://auth/checkout?status=complete&session_id=cs_test_a1B2');
  assert.equal(returnTarget('?checkout=cancelled&return=app'), 'com.velvetviking.valhalla://auth/checkout?status=cancelled');
  assert.equal(returnTarget('?portal=returned&return=app'), 'com.velvetviking.valhalla://auth/checkout?status=portal');
  /* the website's own return is untouched, and nothing odd is passed on */
  assert.equal(returnTarget('?checkout=complete&session_id=cs_test_a1'), null);
  assert.equal(returnTarget('?checkout=complete&session_id=javascript:alert(1)&return=app'),
    'com.velvetviking.valhalla://auth/checkout?status=complete');
  assert.equal(returnTarget('?checkout=start&return=app'), null);
});

test('the browser page says where to go, offers the tap, tries once, and signs nobody in', () => {
  assert.match(ACCOUNT, /<div id="pane-return" class="vvv-hidden">\s*<h1 id="return-title">Back to the App<\/h1>/);
  assert.match(ACCOUNT, /<a class="vvv-btn" id="return-open" href="com\.velvetviking\.valhalla:\/\/auth\/checkout">Open the SACORO App<\/a>/);
  assert.match(ACCOUNT, /Open the SACORO app to finish\. It confirms your free trial and takes you straight in\./);
  assert.match(ACCOUNT, /var appReturn = isNativeApp\(\) \? null : returnTarget\(\);/, 'the hand-off runs inside the app too');
  assert.match(ACCOUNT, /try\{ location\.replace\(appReturn\); \}catch\(e\)\{\}/);
  assert.match(ACCOUNT, /var hash = appReturn \? null : readAuthHash\(\);/);
  assert.match(ACCOUNT, /if \(stored && stored\.access_token && !appReturn\)\{/, 'the browser page tries a sign-in of its own');
  assert.match(ACCOUNT, /'Checkout Cancelled'/);
});

test('the manifest already delivers that link to the app: no new APK is needed', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const filter = /<intent-filter>\s*<action android:name="android\.intent\.action\.VIEW" \/>[^]*?android:scheme="com\.velvetviking\.valhalla"\s+android:host="auth" \/>\s*<\/intent-filter>/.exec(manifest);
  assert.ok(filter, 'the custom-scheme filter is gone');
  assert.doesNotMatch(filter[0], /android:path/, 'the filter no longer accepts every path under auth');
  assert.match(manifest, /android:launchMode="singleTask"/, 'the return would open a second copy of the app');
});

// ---------------------------------------------------------------------------
// 5. BACK IN THE APP
// ---------------------------------------------------------------------------
test('the app listens for its own link on a warm and a cold start, and checkout comes first', () => {
  assert.match(RUNTIME, /App\.addListener\('appUrlOpen', function\(data\)\{ handleAppDeepLink\(data && data\.url\); \}\);/);
  assert.match(RUNTIME, /App\.getLaunchUrl\(\)\.then\(function\(res\)\{ if \(res && res\.url\) handleAppDeepLink\(res\.url\); \}/);
  const a = app();
  const seen = [];
  a.handleCheckoutDeepLink = u => { seen.push(['checkout', u]); return /\/checkout/.test(u); };
  a.handleAuthDeepLink = u => { seen.push(['auth', u]); return true; };
  a.handleAppDeepLink('com.velvetviking.valhalla://auth/checkout?status=cancelled');
  a.handleAppDeepLink('com.velvetviking.valhalla://auth#access_token=a.b.c');
  assert.deepEqual(seen.map(x => x[0]), ['checkout', 'checkout', 'auth'], 'a sign-in link no longer reaches sign-in');
});

test('a completed checkout is reconciled with the app\'s own token, the gate asked again, and the athlete let in', async () => {
  const calls = [];
  const a = atTrial(inAndroid(app({ fetch: async (url, o) => {
    if (/^\/api\/(subscription|session|checkout)$/.test(String(url))) calls.push({ url: String(url), o: o || {} });
    if (url === '/api/session') return { status: 200, ok: true, json: async () => ({ signed_in: true, access: true, reason: 'subscription_trial', state: 'trial' }) };
    return { status: 200, ok: true, json: async () => ({ result: 'reconciled' }) };
  } })));
  a.JOURNEY_ONLY_MODE = true; a.journeyOnlyRefused = true; a.journeyCheckoutAway = true;
  const toasts = []; a.showToast = t => toasts.push(t);
  let reloaded = 0; a.journeyReload = () => { reloaded++; return true; };
  a.renderApp = () => {};
  assert.equal(a.handleCheckoutDeepLink('com.velvetviking.valhalla://auth/checkout?status=complete&session_id=cs_test_a1B2'), true);
  await tick(); await tick(); await tick(); await tick();
  assert.equal(calls[0].url, '/api/subscription', 'the session was not reconciled first');
  assert.deepEqual(JSON.parse(calls[0].o.body), { action: 'reconcile', session_id: 'cs_test_a1B2' });
  assert.equal(calls[0].o.headers.Authorization, 'Bearer tok');
  assert.equal(calls[1].url, '/api/session', 'the gate was not asked again');
  assert.equal(reloaded, 1, 'journey-only mode did not reload into the full app');
  assert.ok(toasts.indexOf('Your free trial has started') !== -1);
  assert.equal(a.journeyCheckoutAway, false);
  /* after the reload, the journey reads the trial and moves to Welcome */
  a.JOURNEY_ONLY_MODE = false;
  assert.equal(a.journeyStep(), 'arrive');
});

test('a second granted answer while the reload is under way is not read as a refused cookie', () => {
  const a = app();
  a.JOURNEY_ONLY_MODE = true;
  let reloaded = 0; a.journeyReload = () => { reloaded++; return true; };
  a.renderApp = () => {};
  assert.equal(a.journeyOnlyLift(true), true);
  assert.equal(a.journeyOnlyLift(true), true);
  assert.equal(reloaded, 1);
  assert.equal(a.journeyLiftStuck, false, 'the return and the app coming to the front read as blocked cookies');
});

test('a cancelled checkout says so and stays at the trial; a forged link reconciles nothing', async () => {
  const calls = [];
  const a = atTrial(inAndroid(app({ fetch: async (url, o) => {
    if (/^\/api\/(subscription|session|checkout)$/.test(String(url))) calls.push(String(url)); return { status: 403, ok: false, json: async () => ({ signed_in: true, access: false }) }; } })));
  a.JOURNEY_ONLY_MODE = true; a.journeyOnlyRefused = true;
  const toasts = []; a.showToast = t => toasts.push(t);
  a.renderApp = () => {};
  assert.equal(a.handleCheckoutDeepLink('com.velvetviking.valhalla://auth/checkout?status=cancelled'), true);
  await tick(); await tick();
  assert.deepEqual(calls, [], 'a cancelled checkout asked the server for something');
  assert.deepEqual(toasts, ['Checkout cancelled. Nothing has been charged']);
  assert.equal(a.journeyStep(), 'trial');
  /* a session id that is not one is never sent; the gate is still asked */
  a.handleCheckoutDeepLink('com.velvetviking.valhalla://auth/checkout?status=complete&session_id=../../x');
  await tick(); await tick(); await tick();
  assert.equal(calls.indexOf('/api/subscription'), -1, 'a malformed session id was sent to the server');
  assert.ok(calls.indexOf('/api/session') !== -1);
  /* and anything else is not a checkout return */
  assert.equal(a.parseCheckoutDeepLink('com.velvetviking.valhalla://auth#access_token=x'), null);
  assert.equal(a.parseCheckoutDeepLink('com.velvetviking.valhalla://auth/checkout?status=paid'), null);
  assert.equal(a.parseCheckoutDeepLink('https://app.velvetviking.co.uk/auth/checkout?status=complete'), null);
});

test('coming back to the front asks the gate again, so a webhook that landed first is enough', () => {
  const vis = RUNTIME.slice(RUNTIME.indexOf("document.addEventListener('visibilitychange', function(){\n  if (document.visibilityState!=='visible'){ stravaHiddenSince"));
  assert.match(vis.slice(0, 3000), /try\{ revalidateDeliverySession\(\); \}catch\(e\)\{\}/);
  /* a refusal does not start the five-minute wait, so every return asks */
  assert.match(RUNTIME, /if \(r\.status === 403 && body\)\{ entitlementInfo = body; legalUrlsFromView\(body\); patchCloudCard\(\); journeyOnlyLift\(false\); \}/);
});

test('in the app\'s Settings the subscription is bought and managed through the website\'s rail, returning to the app', async () => {
  const ENT = { signed_in: true, access: false, state: 'expired', commercial_required: true, checkout_configured: true,
                manageable_here: true };
  const a = inAndroid(app());
  const html = a.renderSubscriptionActions(ENT);
  assert.match(html, /data-action="subscription-resubscribe"/, 'the website-distributed app cannot subscribe from Settings');
  assert.match(html, /data-action="subscription-manage"/);
  inAndroid(a, ANDROID_UA + ' SACORO-Store-Build');
  assert.doesNotMatch(a.renderSubscriptionActions(ENT), /data-action="subscription-(resubscribe|manage)"/);

  const sent = [];
  const b = inAndroid(app({ fetch: async (url, o) => { sent.push({ url: String(url), o: o || {} });
    return { status: 200, ok: true, json: async () => ({ url: 'https://billing.stripe.com/p/session/x' }) }; } }));
  b.cloudSession = { access_token: 'tok', user_id: 'u', expires_at: Date.now() + 3600e3 };
  const loc = { href: '' };
  Object.defineProperty(b.window, 'location', { value: loc, configurable: true, writable: true });
  b.window.open = () => { throw new Error('a new window goes nowhere in the shell'); };
  b.handleManageSubscription();
  await tick(); await tick();
  const portal = sent.filter(s => s.url === '/api/portal')[0];
  assert.deepEqual(JSON.parse(portal.o.body), { return: 'app' });
  assert.equal(loc.href, 'https://billing.stripe.com/p/session/x', 'the portal did not open (in the browser)');
  /* and /account, opened in the app's WebView from Settings, starts the
     checkout with the same return */
  assert.match(ACCOUNT, /if \(isNativeApp\(\) && !storeBuild\(\)\) body\['return'\] = 'app';/);
  assert.match(ACCOUNT, /CapApp\.addListener\('appUrlOpen', function\(data\)\{/);
});

test('house rules on the new words: no em dash, Title Case buttons and titles, nothing about a beta', () => {
  const words = [
    'Secure payment setup opens in your browser, then brings you back here.',
    'Finish setting up payment in your browser. SACORO brings you back here when it is done.',
    'Checkout cancelled. Nothing has been charged', 'Your free trial has started'];
  words.forEach(w => { assert.ok(RUNTIME.indexOf(w) !== -1, 'missing: ' + w); assert.doesNotMatch(w, /—|beta/i); });
  ['Back to the App', 'Open the SACORO App', 'Checkout Cancelled'].forEach(t => {
    assert.ok(ACCOUNT.indexOf(t) !== -1, 'missing: ' + t);
    t.split(' ').forEach((w, i) => assert.ok(i === 0 || ['the', 'to'].indexOf(w) !== -1 || /^[A-Z]/.test(w), t + ' is not Title Case'));
  });
  assert.equal((ACCOUNT.match(/<style\b/g) || []).length, 1);
  assert.doesNotMatch(ACCOUNT.replace(/<!--[^]*?-->/g, ''), /—/);
});
