'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const E = require('../api/_entitlement.js');
const P = require('../api/_products.js');

// THE CARD-FREE TRIAL.
//
// Three tables, three questions, deliberately not merged:
//
//   account_commercial.trial_consumed_at   has this account EVER used its trial?
//   entitlement_grants source='trial'      does it have trial access RIGHT NOW?
//   subscriptions                          real provider relationships only
//
// The first is why a trial cannot be farmed. The second is why it ends. A grant
// can be revoked and reissued, so it must never be the thing that decides
// whether the one-time allowance was spent.

const ROOT = path.join(__dirname, '..');
const NOW = new Date('2026-08-20T12:00:00Z');
const grant = (over) => Object.assign({
  id: 'g1', account_id: 'acc-1', source: 'trial',
  product_code: P.STANDARD, expires_at: '2026-09-03T12:00:00Z', revoked_at: null
}, over || {});

// ---------------------------------------------------------------------------
// VOCABULARY — one list, everywhere
// ---------------------------------------------------------------------------
test('trial is a canonical grant source in code and in SQL', () => {
  assert.deepEqual(E.GRANT_SOURCES.slice().sort(), ['admin_beta', 'admin_comp', 'trial']);
  const sql = fs.readFileSync(path.join(ROOT, 'supabase-trial-grant-source.sql'), 'utf8');
  assert.match(sql, /check \(source in \('admin_beta', 'admin_comp', 'trial'\)\)/);
});

test('no conflicting source list survives anywhere', () => {
  // The failure this guards: extending the SQL constraint and forgetting the
  // application constant, which makes a legitimately-granted trial resolve as
  // 'invalid'. That happened once during this build.
  const files = ['api/_entitlement.js', 'supabase-commercial-core.sql', 'supabase-trial-grant-source.sql'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/--.*$/gm, ' ');
    const pairs = src.match(/'admin_beta'\s*,\s*'admin_comp'\s*\)/g) || [];
    assert.deepEqual(pairs, [],
      f + ' still declares the two-source vocabulary without trial');
  }
});

// ---------------------------------------------------------------------------
// ACCESS
// ---------------------------------------------------------------------------
test('an active trial grants access, and says so as "trial"', () => {
  const a = E.grantAccess(grant(), NOW);
  assert.equal(a.active, true);
  assert.equal(a.reason, 'trial', 'the athlete-facing reason must not be "grant"');
  assert.equal(a.until, '2026-09-03T12:00:00.000Z');
});

test('a trial ends by itself when expires_at passes', () => {
  const a = E.grantAccess(grant({ expires_at: '2026-08-01T12:00:00Z' }), NOW);
  assert.equal(a.active, false);
  assert.equal(a.reason, 'expired');
  // Nothing had to run to make that true -- no cron, no webhook, no sweep.
  const r = E.resolveStandardEntitlement({ subscriptions: [], grants: [grant({ expires_at: '2026-08-01T12:00:00Z' })], account: {}, now: NOW });
  assert.equal(r.active, false);
  assert.equal(r.reason, 'expired');
});

test('a revoked trial stops immediately, whatever its expiry says', () => {
  const a = E.grantAccess(grant({ revoked_at: '2026-08-15T00:00:00Z' }), NOW);
  assert.equal(a.active, false);
  assert.equal(a.reason, 'revoked');
});

test('a trial for a product we do not sell grants nothing', () => {
  assert.equal(E.grantAccess(grant({ product_code: 'SOMETHING_ELSE' }), NOW).active, false);
  assert.equal(E.grantAccess(grant({ source: 'not_a_source' }), NOW).reason, 'invalid');
});

// ---------------------------------------------------------------------------
// PURCHASE DURING TRIAL
// ---------------------------------------------------------------------------
test('a trialling athlete may still subscribe', () => {
  // A trial that blocked purchase would be a trial nobody could convert from.
  const p = E.mayStartStandardPurchase({
    provider: 'web', offerCode: 'STANDARD_MONTHLY',
    account: { trial_consumed_at: '2026-08-20T00:00:00Z' },
    subscriptions: [], grants: [grant()], now: NOW
  });
  assert.equal(p.allowed, true);
  assert.equal(p.reason, 'ok');
});

test('an administrative grant does not block purchase either', () => {
  for (const source of ['admin_beta', 'admin_comp']) {
    const p = E.mayStartStandardPurchase({
      provider: 'web', offerCode: 'STANDARD_MONTHLY', account: {},
      subscriptions: [], grants: [grant({ source, expires_at: null })], now: NOW
    });
    assert.equal(p.allowed, true, source + ' must not block a purchase');
  }
});

test('a real subscription still blocks a second purchase', () => {
  // The trial extension must not have loosened the duplicate-purchase guard.
  const p = E.mayStartStandardPurchase({
    provider: 'web', offerCode: 'STANDARD_MONTHLY', account: {},
    subscriptions: [{ id: 's1', provider: 'apple', condition: 'active', product_code: P.STANDARD,
                      current_period_end: '2027-01-01T00:00:00Z', environment: 'production' }],
    grants: [], now: NOW
  });
  assert.equal(p.allowed, false);
  assert.equal(p.existingProvider, 'apple');
});

// ---------------------------------------------------------------------------
// ONE-TIME ALLOWANCE
// ---------------------------------------------------------------------------
test('the allowance lives on the account, not on the grant', () => {
  // Deleting or revoking the grant must not hand the trial back.
  const consumed = { trial_consumed_at: '2026-08-06T00:00:00Z', trial_consumed_provider: 'web' };
  assert.equal(E.trialEligibility(consumed, NOW).eligible, false);
  assert.equal(E.trialEligibility(consumed, NOW).reason, 'already_used');
  // Even with the grant gone entirely.
  const r = E.resolveStandardEntitlement({ subscriptions: [], grants: [], account: consumed, now: NOW });
  assert.equal(r.active, false, 'no access');
  assert.equal(E.trialEligibility(consumed, NOW).eligible, false, 'and still no second trial');
});

test('a never-used account is eligible exactly once', () => {
  assert.equal(E.trialEligibility({}, NOW).eligible, true);
  assert.equal(E.trialEligibility({ trial_blocked_at: '2026-01-01T00:00:00Z' }, NOW).eligible, false);
});

// ---------------------------------------------------------------------------
// THE ATOMIC ACTIVATION
// ---------------------------------------------------------------------------
test('activation is one database operation, not two round trips', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase-trial-grant-source.sql'), 'utf8');
  const fn = sql.slice(sql.indexOf('create or replace function public.start_standard_trial'));
  // Consume and grant in the same function body = the same transaction.
  assert.ok(fn.indexOf('update public.account_commercial') !== -1);
  assert.ok(fn.indexOf('insert into public.entitlement_grants') !== -1);
  assert.ok(fn.indexOf('update public.account_commercial') < fn.indexOf('insert into public.entitlement_grants'),
    'the allowance is spent first, so a failed grant rolls it back');
  // The one-time guarantee is the WHERE clause, not a prior read.
  assert.match(fn, /where account_id = p_account_id\s*\n\s*and trial_consumed_at is null/);
  assert.match(fn, /get diagnostics v_updated = row_count/);
});

test('the client cannot choose the source, product, expiry or account', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase-trial-grant-source.sql'), 'utf8');
  // Only two parameters, and neither is a source, a product or an instant.
  assert.match(sql, /start_standard_trial\(\s*\n?\s*p_account_id uuid,\s*\n?\s*p_trial_days integer\s*\n?\)/);
  assert.match(sql, /values \(p_account_id, 'trial', 'VALHALLA_STANDARD', v_expires/,
    'source and product are literals in the function, not arguments');
  // Duration is bounded server-side as well as by the caller.
  assert.match(sql, /p_trial_days < 1 or p_trial_days > 60/);
  // And the browser cannot call it at all.
  assert.match(sql, /revoke all on function public\.start_standard_trial\(uuid, integer\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.start_standard_trial\(uuid, integer\) to postgres, service_role/);
});

test('the trial duration has one source of truth', () => {
  assert.equal(P.TRIAL_DAYS, 14);
  // The SQL must not carry its own copy.
  const sql = fs.readFileSync(path.join(ROOT, 'supabase-trial-grant-source.sql'), 'utf8')
    .replace(/--.*$/gm, ' ');
  assert.equal(/interval '14 days'|= 14\b/.test(sql), false,
    'the duration comes from _products.js and is passed in, never restated in SQL');
});
