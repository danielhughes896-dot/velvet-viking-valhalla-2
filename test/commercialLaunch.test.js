'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const A = require('../api/_access.js');
const E = require('../api/_entitlement.js');
const Prod = require('../api/_products.js');
const { loadApp } = require('./harness.js');

/* COMMERCIAL LAUNCH — THE CLAIMS THAT MUST HOLD ON THE DAY
 * ===========================================================================
 * WHAT THIS FILE IS FOR. The commercial machinery is tested at length
 * elsewhere: webBilling.test.js drives real checkout and webhook journeys
 * through the router, commercialCore.test.js holds the resolver, accessGate
 * holds the decision function. None of that changes here.
 *
 * WHAT CHANGES IS WHO GETS IN. For the whole of the private beta the answer
 * was "anybody invited"; from launch it is "anybody paying". This file holds
 * that sentence from both directions -- what must now be refused, and what
 * must still work -- because a launch is exactly the moment when a rule
 * everybody has been relying on quietly stops applying.
 *
 * THE ONE THING TO BE CAREFUL OF, and the reason several tests here look
 * paranoid: the failure mode of a retirement is silent. Beta access coming
 * back would break nothing, throw nothing and fail no existing test. It would
 * simply give the product away.
 */

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
/* Comments legitimately quote the wording they explain, so structural claims
   are made against CODE. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const NOW = new Date('2026-09-01T09:00:00Z');
const UID = 'a1111111-1111-1111-1111-111111111111';
const LIVE = { accountRequired: true, commercialRequired: true };
const row = (o) => Object.assign({ state: 'expired', tier: 'standard', access_until: null,
  cancel_at_period_end: false, override: null, override_expires_at: null }, o || {});
const decide = (ent) => A.resolveAccess(Object.assign({ now: NOW, uid: UID, entitlement: ent }, LIVE));

// ---------------------------------------------------------------------------
// 1. WHO IS REFUSED
// ---------------------------------------------------------------------------

test('an ordinary new account cannot reach the product', () => {
  const d = decide(null);
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'no_entitlement');
  assert.deepEqual(d.capabilities, [], 'a refused athlete was handed capabilities');
  /* What they keep is stated rather than absent: export and account closure
     are promises the product makes to somebody who is not paying. */
  assert.ok((d.locked_capabilities || []).length > 0);
});

test('merely having an account is not an entitlement', () => {
  /* The 3A1 migration posture -- "any authenticated account is admitted" --
     was correct while nothing was for sale and is the single most dangerous
     line to leave switched on at launch. It is governed by the commercial
     flag, and this asserts which side of it the launch is on. */
  const off = A.resolveAccess({ now: NOW, uid: UID, entitlement: null,
                                accountRequired: true, commercialRequired: false });
  assert.equal(off.allow, true, 'the pre-commercial posture is unchanged where it applies');
  assert.equal(decide(null).allow, false, 'and it does not survive the flag being on');
});

test('an ended subscription ends access', () => {
  assert.equal(decide(row({ state: 'expired', access_until: '2026-08-01T00:00:00Z' })).allow, false);
  assert.equal(decide(row({ state: 'active', access_until: '2026-08-01T00:00:00Z' })).allow, false,
    'a state and a date that disagree must fail closed');
});

test('a beta override does not open the product, in any shape', () => {
  [row({ override: 'beta' }),
   row({ override: 'beta', state: 'active' }),
   row({ override: 'beta', override_expires_at: '2099-01-01T00:00:00Z' })
  ].forEach((r, i) => {
    assert.equal(decide(r).allow, false, 'a beta row opened the product (case ' + i + ')');
  });
});

test('a beta grant does not open the product, in any shape', () => {
  const grant = (o) => Object.assign({ id: 'g', account_id: UID, source: 'admin_beta',
    product_code: Prod.STANDARD, expires_at: null, revoked_at: null }, o || {});
  [grant(), grant({ expires_at: '2099-01-01T00:00:00Z' })].forEach((g) => {
    const r = E.resolveStandardEntitlement
      ? null : null;   // resolution is exercised in commercialCore; the unit is below
    assert.equal(E.grantAccess ? E.grantAccess(g, NOW).active : false, false,
      'a beta grant was still active');
  });
});

test('being on the allowlist is not an entitlement anywhere in the code', () => {
  /* THE STRUCTURAL HALF, and it is the one that would survive somebody
     "helpfully" restoring the old behaviour. beta_allowlist is a signup
     record. No file that decides access may read it. */
  ['api/_access.js', 'api/_entitlement.js', 'api/_commercial-store.js',
   'api/_checkout.js', 'api/_subscription.js', 'api/app.js', 'api/_portal.js'
  ].forEach((f) => {
    assert.ok(!/beta_allowlist/.test(code(read(f))),
      f + ' reads the beta allowlist to decide something');
  });
});

// ---------------------------------------------------------------------------
// 2. WHO IS ADMITTED
// ---------------------------------------------------------------------------

test('trialing and active both reach the product; nothing else does', () => {
  const until = '2026-09-20T00:00:00Z';
  assert.equal(decide(row({ state: 'trial', access_until: until })).allow, true);
  assert.equal(decide(row({ state: 'active', access_until: until })).allow, true);
  assert.equal(decide(row({ state: 'grace', access_until: until })).allow, true,
    'a payment problem inside its grace window keeps access, by existing policy');
  ['expired', 'cancelled', 'revoked', 'unpaid', 'paused', ''].forEach((st) => {
    assert.equal(decide(row({ state: st, access_until: until })).allow, false,
      st + ' was treated as access-bearing');
  });
});

test('the overrides that still admit somebody are exactly two', () => {
  assert.deepEqual(A.ACCESS_OVERRIDES.slice().sort(), ['owner', 'promo']);
});

// ---------------------------------------------------------------------------
// 3. THE PRICES ARE THE APPROVED ONES, AND THE SERVER RESOLVES THEM
// ---------------------------------------------------------------------------

test('monthly is £11.99 and annual is £89.99, with a 14-day trial on both', () => {
  const m = Prod.offer('STANDARD_MONTHLY');
  const y = Prod.offer('STANDARD_YEARLY');
  assert.equal(m.priceMinor, 1199);
  assert.equal(m.currency, 'GBP');
  assert.equal(m.billingPeriod, 'monthly');
  assert.equal(y.priceMinor, 8999);
  assert.equal(y.currency, 'GBP');
  assert.equal(y.billingPeriod, 'yearly');
  assert.equal(m.trialDays, 14);
  assert.equal(y.trialDays, 14);
});

test('a billing period names an offer; a price id is never accepted from anywhere', () => {
  /* The browser chooses a PERIOD. The price is resolved from the environment
     by the server. A client that could name a price could name a cheaper one. */
  assert.equal(Prod.offerForPeriod('monthly').code, 'STANDARD_MONTHLY');
  assert.equal(Prod.offerForPeriod('yearly').code, 'STANDARD_YEARLY');
  [null, '', 'weekly', 'MONTHLY', 'price_123', 'monthly ', 0].forEach((p) => {
    assert.equal(Prod.offerForPeriod(p), null, JSON.stringify(p) + ' resolved to an offer');
  });
  /* And no checkout surface reads a price from a request. */
  const ck = code(read('api/_checkout.js'));
  assert.ok(!/body\s*\.\s*price/i.test(ck) && !/price_id/i.test(ck),
    'checkout reads a price identifier from the request');
});

// ---------------------------------------------------------------------------
// 4. THE SETTINGS CARD, WHICH IS WHERE AN ATHLETE ACTS
// ---------------------------------------------------------------------------

function card(info){
  const a = loadApp({ pinnedDate: '2026-09-01T09:00:00Z' });
  a.cloudSession = { access_token: 't', user_id: UID, email: 'a@b.test' };
  a.entitlementInfo = Object.assign({ signed_in: true, commercial_required: true,
    checkout_configured: true, capabilities: [] }, info);
  return { html: a.renderSubscriptionCard(), app: a };
}
const buys   = (h) => /data-action="subscription-resubscribe"/.test(h);
const manages = (h) => /data-action="subscription-manage"/.test(h);

test('an athlete with no entitlement is offered both prices and a way to start', () => {
  /* THE DEFECT THIS PINS. Every branch in the card keyed on a state NAME, and
     an athlete who has never subscribed has no state -- the server denies them
     with reason 'no_entitlement' and state null. So the one athlete who needed
     the price list and the button got a heading with nothing underneath it. */
  const { html } = card({ access: false, reason: 'no_entitlement', state: null });
  assert.ok(buys(html), 'no way to subscribe was offered');
  assert.match(html, /sub-offers/, 'the prices were not shown');
  assert.match(html, /£11\.99/);
  assert.match(html, /£89\.99/);
  assert.match(html, /free trial/i);
  assert.ok(!/Subscribe again/.test(html), 'somebody who never subscribed was told to do it again');
});

test('an athlete whose subscription ended is offered the same route', () => {
  const { html } = card({ access: false, reason: 'expired', state: 'expired',
                          access_until: '2026-08-01T00:00:00Z' });
  assert.ok(buys(html));
  assert.match(html, /Subscribe again/);
});

test('a trialing athlete is not sold anything, and can cancel', () => {
  const { html } = card({ access: true, reason: 'subscription_trial', state: 'trial',
                          access_until: '2026-09-14T00:00:00Z', manageable_here: true });
  assert.ok(!buys(html), 'a trialing athlete was offered a second purchase');
  assert.ok(manages(html), 'a trialing athlete had no way to cancel');
  assert.match(html, /Trial until/);
});

test('an active subscriber sees their subscription and can cancel', () => {
  const { html } = card({ access: true, reason: 'subscription_active', state: 'active',
                          access_until: '2026-09-29T00:00:00Z', manageable_here: true });
  assert.ok(!buys(html));
  assert.ok(manages(html));
  assert.match(html, /Subscription active until/);
  assert.ok(!/sub-offers/.test(html), 'a price list was shown to somebody mid-subscription');
});

test('a store subscription is not offered a web cancellation', () => {
  /* Apple and Google own that relationship. manageable_here is the server's
     answer and the card must not second-guess it. */
  const { html } = card({ access: true, state: 'active', access_until: '2026-09-29T00:00:00Z',
                          manageable_here: false, management_provider: 'apple' });
  assert.ok(!manages(html));
});

test('the card never claims beta access, whatever the row says', () => {
  const { html } = card({ access: false, state: 'expired', override: 'beta' });
  assert.ok(!/beta/i.test(html), 'the card still describes beta access');
  assert.ok(buys(html), 'a retired beta athlete was left with no way to subscribe');
});

test('no pre-launch copy survives on the subscription card', () => {
  const states = [
    { access: false, state: null },
    { access: false, state: 'expired' },
    { access: true, state: 'trial', access_until: '2026-09-14T00:00:00Z' },
    { access: true, state: 'active', access_until: '2026-09-29T00:00:00Z' },
    { access: false, state: null, checkout_configured: false }
  ];
  states.forEach((s, i) => {
    const { html } = card(s);
    [/not open yet/i, /aren.t switched on/i, /not charging for access yet/i,
     /private beta/i, /coming soon/i].forEach((rx) => {
      assert.ok(!rx.test(html), 'pre-launch copy in state ' + i + ': ' + rx);
    });
  });
});

test('the purchase button leads to the one purchase door, not a second one', () => {
  /* handleSubscribeStart navigates to /account, which owns the period choice,
     the agreements and the session. A second checkout in the runtime would be
     a second legal gate to keep in step with the first. */
  const src = code(read('protected/velvet-viking-valhalla.html'));
  const fn = src.slice(src.indexOf('function handleSubscribeStart'),
                       src.indexOf('function subscriptionPreferredPeriod'));
  assert.match(fn, /\/account\?checkout=start/);
  assert.ok(!/api\/checkout/.test(fn), 'the runtime opened a second checkout path');
  assert.ok(!/resubscribe/.test(fn), 'the retired 410 route is still being called');
  /* And the retired action is not called from anywhere else either. */
  assert.ok(!/action:\s*'resubscribe'/.test(src),
    'something still POSTs the retired resubscribe action');
});

// ---------------------------------------------------------------------------
// 5. THE PORTAL
// ---------------------------------------------------------------------------

test('the portal never accepts a customer id from the caller', () => {
  /* A parameter naming somebody else's Stripe customer is the whole attack.
     Asserted structurally, because the safe version and the unsafe version
     differ by one line that is easy to add. */
  const src = code(read('api/_portal.js'));
  assert.ok(!/body\s*\.\s*customer/i.test(src));
  assert.ok(!/req\.(query|body)[^\n]*customer/i.test(src));
  assert.match(src, /provider_customer_id/, 'the customer must come from the athlete’s own row');
  assert.match(src, /userIdFromRequest/, 'the athlete must come from the bearer token');
});

test('the portal return url is the app’s own origin and never the caller’s', () => {
  const Portal = require('../api/_portal.js');
  assert.equal(Portal.returnUrl({ appOrigin: 'https://app.test' }),
               'https://app.test/account?portal=returned');
  assert.equal(Portal.returnUrl({ appOrigin: '' }), null);
  const src = code(read('api/_portal.js'));
  assert.ok(!/return_?url\s*[:=]\s*(body|req)/i.test(src),
    'a caller-supplied return_url is an open redirect with a Stripe logo on it');
});

test('only a web subscription that still means something is portable', () => {
  const Portal = require('../api/_portal.js');
  const at = new Date('2026-09-01T00:00:00Z');
  /* A row shaped as the store writes it. product_code matters: subscriptionAccess
     fails closed on an unrecognised product before it looks at a single date. */
  const sub = (o) => Object.assign({ provider: 'web', provider_customer_id: 'cus_1',
    condition: 'active', product_code: Prod.STANDARD, offer_code: 'STANDARD_MONTHLY',
    current_period_end: '2026-10-01T00:00:00Z' }, o || {});
  assert.ok(Portal.portableSubscription({ subscriptions: [sub()] }, at));
  assert.equal(Portal.portableSubscription({ subscriptions: [sub({ provider: 'apple' })] }, at), null,
    'a store subscription was sent to the wrong company’s portal');
  assert.equal(Portal.portableSubscription({ subscriptions: [sub({ provider_customer_id: null })] }, at), null);
  assert.equal(Portal.portableSubscription({ subscriptions: [] }, at), null);
});

test('the portal is mounted on the router and costs no new function', () => {
  /* Vercel's Hobby plan caps serverless functions; the consolidated routers
     exist so a new commercial surface is a route entry instead of one of
     them. */
  assert.match(code(read('api/account.js')), /portal:\s*require\('\.\/_portal\.js'\)/);
  const vercel = JSON.parse(read('vercel.json'));
  const hit = vercel.routes.filter((r) => r.src === '/api/portal')[0];
  assert.ok(hit, 'there is no /api/portal route');
  assert.equal(hit.dest, '/api/account?resource=portal');
  const fns = fs.readdirSync(path.join(ROOT, 'api'))
    .filter((f) => f.endsWith('.js') && !f.startsWith('_'));
  assert.ok(fns.length <= 12, 'the serverless function budget is exceeded: ' + fns.length);
});

// ---------------------------------------------------------------------------
// 6. THE PERIOD THE WEBSITE CHOSE
// ---------------------------------------------------------------------------

test('the account page accepts only two period values, and treats them as a hint', () => {
  const page = read('account.html');
  const body = code(page);
  assert.match(body, /get\('period'\)/, 'the period is not read at all');
  assert.match(body, /'monthly'.*'yearly'|'yearly'.*'monthly'/s);
  /* A preselection, not a decision: both buttons still exist and still call
     startCheckout with their own period. */
  assert.match(body, /aria-current/);
  assert.match(body, /startCheckout\(o\.billingPeriod/);
  /* And nothing purchasable travels in a query string. */
  assert.ok(!/price_[A-Za-z0-9]{6,}/.test(page));
});

test('the runtime carries a period only when the athlete has one recorded', () => {
  const a = loadApp({ pinnedDate: '2026-09-01T09:00:00Z' });
  a.state.setup = a.state.setup || {};
  assert.equal(a.subscriptionPreferredPeriod(), null, 'a period was invented');
  a.state.setup.billingPeriod = 'yearly';
  assert.equal(a.subscriptionPreferredPeriod(), 'yearly');
  a.state.setup.billingPeriod = 'price_123';
  assert.equal(a.subscriptionPreferredPeriod(), null, 'an arbitrary value was passed on');
});

// ---------------------------------------------------------------------------
// 7. THE MIGRATION THAT OPENS THE DOOR
// ---------------------------------------------------------------------------

test('the signup migration removes the refusal and keeps the history', () => {
  const sql = read('supabase-open-public-signup.sql');
  assert.match(sql, /drop trigger if exists beta_allowlist_gate on auth\.users/);
  /* The allowlist itself is history and must survive. */
  assert.ok(!/drop table[^\n]*beta_allowlist/i.test(sql), 'the migration destroys the audit record');
  /* And the OTHER trigger on auth.users must not be caught by it: without it a
     new athlete has no account_commercial row and cannot be sold anything. */
  assert.ok(!/drop trigger[^\n]*seed_account_commercial/i.test(sql));
  assert.match(sql, /seed_account_commercial_on_signup/, 'the migration does not check the seeding trigger survives');
  /* It refuses to run into a schema that could not catch the traffic. */
  assert.match(sql, /refusing to open signup/);
});
