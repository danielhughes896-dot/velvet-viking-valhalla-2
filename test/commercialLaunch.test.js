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
// 7. GRANDFATHERING — THE BETA COHORT KEEPS ITS ACCESS
// ---------------------------------------------------------------------------

/* WHAT GRANDFATHERING IS, IN THIS ARCHITECTURE. Not a rule that keeps honouring
   beta for the people who had it -- that rule would have to keep deciding,
   forever, who had it, from a list that can be added to. The cohort is
   converted ONCE into explicit per-account admin_comp grants, which is the
   existing complimentary mechanism: it resolves through the same fold, projects
   as override 'promo', and is honoured by resolveAccess(). Nothing parallel is
   invented, and after the conversion the allowlist grants nobody anything. */

const compGrant = (o) => Object.assign({ id: 'g', account_id: UID, source: 'admin_comp',
  product_code: Prod.STANDARD, expires_at: null, revoked_at: null,
  note: 'grandfathered-beta: complimentary access preserved at commercial cutover' }, o || {});

test('a grandfathered beta athlete keeps access, through the complimentary source', () => {
  const g = E.grantAccess(compGrant(), NOW);
  assert.equal(g.active, true);
  assert.equal(g.reason, 'admin_comp');
  assert.equal(g.until, null, 'a grandfathered grant is open-ended');
  /* And all the way down: the projection writes the override the gate reads. */
  const projected = E.projectToEntitlementRow(
    { active: true, reason: 'admin_comp',
      sources: [Object.assign({ source: 'admin_comp', commercial: false, active: true, until: null }, g)] },
    null);
  assert.equal(projected.override, 'promo');
  assert.equal(projected.state, 'expired', 'a grant must not masquerade as a subscription');
  assert.equal(projected.access_until, null, 'a grant leaked into the commercial window');
  assert.equal(decide(row({ override: 'promo' })).allow, true);
});

test('a grandfathered athlete is never sent to checkout and is offered nothing to buy', () => {
  const { html } = card({ access: true, reason: 'override_promo',
                          state: 'expired', override: 'promo' });
  assert.ok(!buys(html), 'a complimentary athlete was offered a purchase');
  assert.ok(!/sub-offers/.test(html), 'a complimentary athlete was shown a price list');
  assert.ok(!/free trial/i.test(html), 'a complimentary athlete was pushed into the trial');
  assert.ok(!/No subscription yet/.test(html),
    'a complimentary athlete was told they have no subscription, as though access had lapsed');
  /* What they DO see: an accurate state, and not a claim to be paying. */
  assert.match(html, /Your Valhalla access is active/);
  assert.match(html, /Complimentary/);
  assert.match(html, /Nothing is being charged/);
  assert.ok(!/Subscription active until/.test(html),
    'a complimentary athlete was labelled an active paid subscriber');
});

test('the owner is untouched by any of this', () => {
  assert.equal(decide(row({ override: 'owner' })).allow, true);
  assert.equal(decide(row({ override: 'owner' })).reason, 'override_owner');
  const { html } = card({ access: true, reason: 'override_owner',
                          state: 'expired', override: 'owner' });
  assert.ok(!buys(html));
  assert.match(html, /Owner/);
  /* And the cutover never reads or writes an owner row. */
  const sql = read('supabase-commercial-cutover.sql');
  assert.match(sql, /not exists \(select 1 from public\.entitlements e[\s\S]{0,120}override = 'owner'\)/,
    'the cohort query does not exclude the owner');
});

test('historical beta data cannot create new free access after cutover', () => {
  /* THE RULE THE BRIEF IS MOST WORRIED ABOUT: "anyone in beta_allowlist forever
     receives free access". It cannot happen, at three independent points. */
  // 1. No access-deciding module reads the allowlist at all.
  ['api/_access.js', 'api/_entitlement.js', 'api/_commercial-store.js',
   'api/_checkout.js', 'api/_subscription.js', 'api/app.js'
  ].forEach((f) => assert.ok(!/beta_allowlist/.test(code(read(f))), f + ' reads the allowlist'));
  // 2. A beta grant, however fresh, resolves to nothing.
  const beta = (o) => Object.assign({ id: 'g', account_id: UID, source: 'admin_beta',
    product_code: Prod.STANDARD, expires_at: null, revoked_at: null }, o || {});
  assert.equal(E.grantAccess(beta(), NOW).active, false);
  assert.equal(E.grantAccess(beta({ granted_at: NOW.toISOString() }), NOW).active, false);
  // 3. And the database refuses to accept a new one.
  const sql = read('supabase-commercial-cutover.sql');
  assert.match(sql, /create trigger no_new_beta_grants/);
  assert.match(sql, /raise exception[\s\S]{0,160}private beta closed at commercial cutover/);
});

test('a revoked or expired historical beta entry is not grandfathered', () => {
  /* The cohort query has to exclude withdrawn access, or the cutover would
     hand free access to somebody whose invitation was taken away. */
  const sql = read('supabase-commercial-cutover.sql');
  assert.match(sql, /g\.revoked_at is null/, 'revoked grants are not excluded');
  assert.match(sql, /g\.expires_at is null or g\.expires_at > now\(\)/, 'expired grants are not excluded');
  assert.match(sql, /e\.override_expires_at is null or e\.override_expires_at > now\(\)/,
    'expired beta overrides are not excluded');
  assert.match(sql, /b\.revoked_at is null/, 'revoked allowlist entries are not excluded');
  /* And the resolver agrees, which is what the cohort query is approximating. */
  const g = (o) => Object.assign({ id: 'g', account_id: UID, source: 'admin_comp',
    product_code: Prod.STANDARD, expires_at: null, revoked_at: null }, o || {});
  assert.equal(E.grantAccess(g({ revoked_at: '2026-08-01T00:00:00Z' }), NOW).active, false);
  assert.equal(E.grantAccess(g({ expires_at: '2026-08-01T00:00:00Z' }), NOW).active, false);
});

// ---------------------------------------------------------------------------
// 8. THE CUTOVER MIGRATION
// ---------------------------------------------------------------------------

test('the cutover opens signup, keeps the history, and keeps the seeding trigger', () => {
  const sql = read('supabase-commercial-cutover.sql');
  assert.match(sql, /drop trigger if exists beta_allowlist_gate on auth\.users/);
  /* The allowlist is history and must survive -- and must stop being a gate. */
  assert.ok(!/drop table[^\n]*beta_allowlist/i.test(sql), 'the migration destroys the audit record');
  assert.ok(!/delete from public\.beta_allowlist/i.test(sql));
  assert.match(sql, /HISTORY, NOT ENTITLEMENT, AND NOT A SIGNUP GATE/);
  /* The OTHER trigger on auth.users must survive: without it a new athlete has
     no account_commercial row and can never be sold anything. */
  assert.ok(!/drop trigger[^\n]*seed_account_commercial/i.test(sql));
  assert.match(sql, /refusing to cut over: seed_account_commercial_on_signup is missing/);
  /* No beta history is rewritten. */
  assert.ok(!/update public\.entitlement_grants[\s\S]{0,200}revoked_at/i.test(sql),
    'the migration revokes historical beta grants instead of leaving them');
});

test('the cutover is one transaction and verifies itself before committing', () => {
  const sql = read('supabase-commercial-cutover.sql');
  assert.match(sql, /^begin;/m, 'the cutover is not transactional');
  const beginAt = sql.indexOf('\nbegin;');
  const commitAt = sql.indexOf('\ncommit;');
  assert.ok(beginAt > -1 && commitAt > beginAt, 'there is no commit after the begin');
  /* Every verification the brief asks for happens INSIDE the transaction, so a
     failure rolls the whole cutover back rather than leaving it half done. */
  ['grandfathering incomplete', 'the owner override is gone',
   'the owner was swept into the grandfathered cohort',
   'the signup gate is still attached', 'the commercial seeding trigger was removed',
   'a new beta grant was accepted after cutover'
  ].forEach((claim) => {
    const at = sql.indexOf(claim);
    assert.ok(at > -1, 'the cutover does not verify: ' + claim);
    assert.ok(at < commitAt, 'the check for "' + claim + '" runs after the commit');
  });
});

test('the cutover is safe to run twice', () => {
  /* Re-running must not grant anybody a second time, and must not fail on the
     objects it already created. */
  const sql = read('supabase-commercial-cutover.sql');
  assert.match(sql, /where not exists \([\s\S]{0,240}grandfathered-beta/,
    'the grandfathering insert is not guarded against a second run');
  assert.match(sql, /drop trigger if exists no_new_beta_grants/);
  assert.match(sql, /drop trigger if exists beta_allowlist_gate/);
  assert.match(sql, /create or replace function public\.refuse_new_beta_grants/);
  assert.match(sql, /on commit drop/, 'the temporary cohort table outlives the transaction');
});

test('signing up grants nothing: a new public account starts commercially empty', () => {
  /* THE OTHER HALF OF OPENING THE DOOR, and the one that would be easy to get
     wrong. Once anybody may create an account, the thing that must NOT happen
     is an account creating an entitlement.

     The only trigger left on auth.users is seed_account_commercial, and what
     it writes is an account_commercial row -- the record an athlete needs
     before they can be SOLD anything, not a grant of anything. This asserts
     that shape, because a single extra insert in that function would give the
     product away to every visitor. */
  const sql = fs.readFileSync(path.join(ROOT, 'supabase-commercial-cutover.sql'), 'utf8');
  assert.match(sql, /seed_account_commercial_on_signup/);
  /* Nothing in the cutover grants on signup, and no trigger writes a grant. */
  assert.ok(!/insert into public\.entitlement_grants[\s\S]{0,200}auth\.users/i.test(sql),
    'the cutover wires a grant to account creation');
  /* And the resolver's answer for a brand-new account, which is the real
     assertion: no grant, no subscription, no override, no access. */
  assert.equal(decide(null).allow, false);
  assert.equal(decide(row({})).allow, false, 'an empty entitlement row admitted somebody');
  assert.equal(E.grantAccess({ account_id: UID, source: 'admin_comp',
    product_code: Prod.STANDARD, revoked_at: null, expires_at: null,
    note: null }, NOW).active, true,
    'the complimentary source must still work for the cohort that was granted it');
});

test('being on the allowlist is not, by itself, access after cutover', () => {
  /* Before cutover the allowlist decided who could exist. After it, existing
     is free and access is bought. The two are now completely separate, and the
     only thing that carries a beta athlete across is the explicit grant the
     migration wrote them -- not their presence on the list. */
  const sql = fs.readFileSync(path.join(ROOT, 'supabase-commercial-cutover.sql'), 'utf8');
  /* The list is read ONCE, to build the cohort, and never again. */
  const reads = (sql.match(/beta_allowlist/g) || []).length;
  assert.ok(reads >= 1, 'the cohort is not built from the allowlist at all');
  assert.match(sql, /from public\.beta_allowlist b[\s\S]{0,120}b\.revoked_at is null/,
    'the cohort query does not read the allowlist with a revocation check');
  /* Nothing in the running product reads it. */
  assert.ok(!/beta_allowlist/.test(code(read('api/_access.js'))));
  assert.ok(!/beta_allowlist/.test(code(read('api/_entitlement.js'))));
});

test('a grant only grants anything once it reaches the row the gate reads', () => {
  /* THE DEFECT THIS PINS, found by auditing production rather than by any test.
     The cutover wrote every grandfathered athlete an admin_comp grant and
     verified the GRANTS existed. They did. But entitlement_grants is the source
     of truth and public.entitlements is a PROJECTION of it, and
     api/app.js -> resolveAccess() reads the projection and nothing else.

     The projection is written by exactly one function, syncEntitlementRow(),
     called from exactly one place: _billing-apply.js, on a Stripe webhook. A
     complimentary athlete has no Stripe activity, so no webhook ever fires for
     them and their projection is never written. All four were therefore denied
     the product while holding a valid grant.

     What this test holds is the invariant the cutover assumed without checking:
     the row projected from a comp-only athlete must be one the gate admits. */
  const grant = { id: 'g', account_id: UID, source: 'admin_comp',
    product_code: Prod.STANDARD, expires_at: null, revoked_at: null };
  const g = E.grantAccess(grant, NOW);
  assert.equal(g.active, true, 'the grant itself must be live for this test to mean anything');

  const projected = E.projectToEntitlementRow(
    { active: true, reason: 'admin_comp', sources: [Object.assign({ source: 'admin_comp' }, g)] },
    null);
  /* The projected row, handed to the real gate, must open the product. */
  assert.equal(decide(projected).allow, true,
    'a complimentary grant projects onto a row the gate refuses');
  assert.equal(decide(projected).reason, 'override_promo');
  /* And the override it writes must be one _access.js honours -- the two files
     agreeing about this is the whole mechanism. */
  assert.ok(A.ACCESS_OVERRIDES.indexOf(projected.override) !== -1,
    'the projection writes an override the gate does not honour: ' + projected.override);

  /* THE STATES THAT ACTUALLY EXISTED IN PRODUCTION AFTER THE CUTOVER, both of
     which deny -- which is why the projection has to be written explicitly. */
  assert.equal(decide(null).allow, false, 'no entitlements row admitted somebody');
  assert.equal(decide(row({ override: 'beta', state: 'expired' })).allow, false);
});

test('the projection fix writes exactly what the projector would have written', () => {
  /* The migration hard-codes a row rather than calling the projector, so the
     two must be pinned together or they will drift. */
  const sql = read('supabase-grandfather-projection.sql');
  const grant = { id: 'g', account_id: UID, source: 'admin_comp',
    product_code: Prod.STANDARD, expires_at: null, revoked_at: null };
  const g = E.grantAccess(grant, NOW);
  const projected = E.projectToEntitlementRow(
    { active: true, reason: 'admin_comp', sources: [Object.assign({ source: 'admin_comp' }, g)] },
    null);
  assert.equal(projected.state, 'expired');
  assert.equal(projected.tier, 'standard');
  assert.equal(projected.access_until, null);
  assert.equal(projected.override, 'promo');
  assert.equal(projected.override_expires_at, null);
  /* Each of those five appears in the migration's insert. */
  assert.match(sql, /'expired', 'standard', null, false,\s*\n?\s*'promo', null/);
  /* It must never touch the owner. */
  assert.match(sql, /e\.override = 'owner'/);
  assert.match(sql, /override is distinct from 'owner'/);
  /* And it must verify admission rather than existence -- the mistake the
     cutover made. */
  /* EXACTLY 'promo'. Accepting ('owner','promo') would prove the cohort was
     admitted without proving they were admitted as complimentary, which is the
     entitlement the migration exists to give them. */
  assert.match(sql, /e\.override = 'promo'/);
  assert.ok(!/override in \('owner','promo'\)/.test(sql));
  assert.match(sql, /projection incomplete/);
});

test('there is exactly one cutover migration to run', () => {
  /* Two migrations that must be applied in a particular order is a production
     incident waiting for somebody to be in a hurry. The signup-only file was
     folded into this one and deleted. */
  assert.ok(!fs.existsSync(path.join(ROOT, 'supabase-open-public-signup.sql')),
    'the superseded signup-only migration is still present');
  assert.ok(fs.existsSync(path.join(ROOT, 'supabase-commercial-cutover.sql')));
});
