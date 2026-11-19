'use strict';
// THE PRODUCT CODE THE LIVE SCHEMA ACCEPTS (founder's Google Play test
// purchase, 19 November 2026: "Reference: subscription_unwritable").
//
// The rename to SACORO changed Prod.STANDARD to 'SACORO_STANDARD', but the
// live subscriptions table still has CHECK (product_code = 'VALHALLA_STANDARD')
// from supabase-commercial-core.sql, so Postgres refused every subscription
// row on every rail. The schema is not changed (founder: "Do not change the
// database"): rows are written under the stored name and read under either.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const P = require('../api/_products.js');
const E = require('../api/_entitlement.js');
const Store = require('../api/_commercial-store.js');
const { createFakeSupabase, SUBSCRIPTION_PRODUCT_CODE } = require('./fakeSupabase.js');

const SQL = fs.readFileSync(path.join(__dirname, '..', 'supabase-commercial-core.sql'), 'utf8');
const ACC = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-19T21:30:00Z');
const DAY = 864e5;

test('the stored name is the one the schema file\'s CHECK accepts; the catalogue keeps SACORO', () => {
  const block = SQL.slice(SQL.indexOf('create table if not exists public.subscriptions ('));
  const m = /check \(product_code = '([A-Z_]+)'\)/.exec(block);
  assert.ok(m, 'the subscriptions product_code CHECK moved');
  assert.equal(P.STORED_STANDARD, m[1]);
  assert.equal(SUBSCRIPTION_PRODUCT_CODE, m[1], 'the fake database reads the same constraint');
  assert.equal(P.STANDARD, 'SACORO_STANDARD');
  assert.equal(P.storedProductCode(P.STANDARD), P.STORED_STANDARD);
  assert.equal(P.isStandardProduct('SACORO_STANDARD'), true);
  assert.equal(P.isStandardProduct('VALHALLA_STANDARD'), true);
  assert.equal(P.isStandardProduct('SOMETHING_ELSE'), false);
});

test('the fake refuses what Postgres refuses, so this can never pass in tests and fail live again', async () => {
  const f = createFakeSupabase({});
  const r = await f.S.sb(f.cfg, '/subscriptions?on_conflict=provider,provider_subscription_id', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
    body: JSON.stringify({ account_id: ACC, provider: 'google', provider_subscription_id: 'tok-1',
                           product_code: 'SACORO_STANDARD', condition: 'active' }) });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, '23514');
  assert.equal(f.rows('subscriptions').length, 0);
});

test('a subscription is written under the stored name, from either name, and anything else is refused', async () => {
  const f = createFakeSupabase({ account_commercial: [{ account_id: ACC }] });
  const base = { account_id: ACC, provider: 'google', condition: 'active', offer_code: 'STANDARD_MONTHLY',
                 billing_period: 'monthly', current_period_start: new Date(NOW - DAY).toISOString(),
                 current_period_end: new Date(+NOW + 29 * DAY).toISOString() };
  const a = await Store.upsertSubscription(f.S, f.cfg, Object.assign({}, base,
    { provider_subscription_id: 'tok-a', product_code: P.STANDARD }));
  assert.equal(a.ok, true, JSON.stringify(a));
  const b = await Store.upsertSubscription(f.S, f.cfg, Object.assign({}, base,
    { provider_subscription_id: 'tok-b', product_code: P.STORED_STANDARD }));
  assert.equal(b.ok, true, JSON.stringify(b));
  f.rows('subscriptions').forEach(r => assert.equal(r.product_code, 'VALHALLA_STANDARD'));
  const c = await Store.upsertSubscription(f.S, f.cfg, Object.assign({}, base,
    { provider_subscription_id: 'tok-c', product_code: 'OTHER' }));
  assert.deepEqual(c, { ok: false, reason: 'unknown_product' });
});

test('the resolver grants access from a row under either name, and reports the catalogue name', () => {
  ['VALHALLA_STANDARD', 'SACORO_STANDARD'].forEach(code => {
    const res = E.resolveStandardEntitlement({
      account: { account_id: ACC },
      subscriptions: [{ id: 's1', account_id: ACC, provider: 'google', product_code: code, condition: 'active',
                        current_period_end: new Date(+NOW + 10 * DAY).toISOString() }],
      grants: [], now: NOW });
    assert.equal(res.active, true, code + ' was not recognised as the standard product');
    assert.equal(res.product, 'SACORO_STANDARD');
  });
  const other = E.resolveStandardEntitlement({ account: { account_id: ACC },
    subscriptions: [{ id: 's2', account_id: ACC, provider: 'google', product_code: 'OTHER', condition: 'active',
                      current_period_end: new Date(+NOW + 10 * DAY).toISOString() }], grants: [], now: NOW });
  assert.equal(other.active, false);
});

test('grants are deliberately untouched by this change (a separate decision for the founder)', () => {
  /* A grant under the stored name is still read as invalid, exactly as before
     this change: accepting it would restore access for an account, and that
     is not decided here. This test pins the boundary so the change cannot
     widen silently. */
  const res = E.resolveStandardEntitlement({ account: { account_id: ACC }, subscriptions: [],
    grants: [{ id: 'g1', account_id: ACC, source: 'admin_comp', product_code: 'VALHALLA_STANDARD',
               revoked_at: null, expires_at: null }], now: NOW });
  assert.equal(res.active, false);
});

// ---------------------------------------------------------------------------
// OWNER AND COMPLIMENTARY ACCESS ARE LEFT AS THEY ARE; RETIRED BETA STAYS OFF
// (founder, 19 November 2026: "Leave the complimentary grants and permanent
// owner access untouched. Do not reactivate retired beta access.")
// ---------------------------------------------------------------------------
const Apply = require('../api/_billing-apply.js');
function playFacts(account, token){
  return { provider: 'google', account_id: account, subscription_ref: token, condition: 'active',
           offer_code: 'STANDARD_MONTHLY', billing_period: 'monthly',
           period_start: new Date(+NOW - DAY).toISOString(), period_end: new Date(+NOW + 29 * DAY).toISOString(),
           occurred_at: NOW.toISOString(), cancel_at_period_end: false, environment: 'sandbox' };
}

test('a purchase recorded for an owner or promo account leaves its override exactly as it was', async () => {
  for (const override of ['owner', 'promo']){
    const f = createFakeSupabase({ account_commercial: [{ account_id: ACC }],
      entitlements: [{ user_id: ACC, state: 'expired', override: override, override_expires_at: null,
                       override_note: 'set by hand' }] });
    const r = await Apply.applySubscriptionFacts(f.S, f.cfg, playFacts(ACC, 'tok-' + override), { environment: 'sandbox' });
    assert.equal(r.ok, true, JSON.stringify(r));
    const ent = f.rows('entitlements')[0];
    assert.equal(ent.override, override, 'a recorded purchase cleared the ' + override + ' override');
    assert.equal(ent.override_expires_at, null);
    assert.equal(ent.override_note, 'set by hand');
    assert.equal(ent.state, 'active', 'and the purchase itself is still recorded');
  }
});

test('the projection keeps owner and promo with their own expiry, and never keeps retired beta', () => {
  const sub = { source: 'google', commercial: true, active: true, reason: 'active', until: '2026-12-19T00:00:00.000Z', provider: 'google' };
  const res = { active: true, reason: 'active', sources: [sub] };
  assert.equal(E.projectToEntitlementRow(res, { override: 'owner' }).override, 'owner');
  const promo = E.projectToEntitlementRow(res, { override: 'promo', override_expires_at: '2027-01-01T00:00:00.000Z' });
  assert.equal(promo.override, 'promo');
  assert.equal(promo.override_expires_at, '2027-01-01T00:00:00.000Z');
  /* Retired beta is not carried forward, and a retired beta grant derives nothing. */
  assert.equal(E.projectToEntitlementRow(res, { override: 'beta' }).override, null);
  const retired = E.resolveStandardEntitlement({ account: { account_id: ACC }, subscriptions: [],
    grants: [{ id: 'g', account_id: ACC, source: 'admin_beta', product_code: 'SACORO_STANDARD', revoked_at: null, expires_at: null },
             { id: 'h', account_id: ACC, source: 'admin_beta', product_code: 'VALHALLA_STANDARD', revoked_at: null, expires_at: null }],
    now: NOW });
  assert.equal(retired.active, false, 'retired beta access was reactivated');
  assert.equal(E.projectToEntitlementRow(retired, null).override, null);
});
