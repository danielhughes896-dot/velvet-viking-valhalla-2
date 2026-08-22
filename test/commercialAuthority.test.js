'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const E = require('../api/_entitlement.js');
const Store = require('../api/_commercial-store.js');
const P = require('../api/_products.js');

/* ONE COMMERCIAL BRAIN.
 *
 * The repository and production had diverged, and the shape of the divergence
 * mattered more than the fact of it: for a while there were two answers to
 * "may this athlete use Valhalla", written by two different code paths into
 * the same row.
 *
 *   THE CORE       account_commercial + subscriptions + entitlement_grants,
 *                  resolved by resolveStandardEntitlement(), with
 *                  billing_events as the one ledger and the one idempotency
 *                  mechanism. Authoritative.
 *
 *   THE PROJECTION public.entitlements, which _access.js reads to hand over
 *                  the runtime. Fed by the core, one way, and authoritative
 *                  about nothing.
 *
 *   THE RETIRED    _billing.js and the generic webhook path, which wrote the
 *   SECOND BRAIN   projection directly and invented seven days of grace.
 *
 * These tests are the ones that would fail if a second authority came back, if
 * the ledger forked, if a trial gained a second counter, or if grace stopped
 * being something a provider tells us. They are deliberately cross-module:
 * every individual piece is tested elsewhere, and what is asserted here is
 * that the pieces still add up to one architecture.
 */

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const apiFiles = () => fs.readdirSync(path.join(ROOT, 'api')).filter(f => /\.js$/.test(f));
const sqlFiles = () => fs.readdirSync(ROOT).filter(f => /\.sql$/.test(f));
const stripSqlComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--[^\n]*/gm, '');
const stripJsComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ---------------------------------------------------------------------------
// ONE LEDGER
// ---------------------------------------------------------------------------

test('exactly one file in the repository creates billing_events', () => {
  /* The collision this guards against was real and latent: a second migration
     declared `create table if not exists public.billing_events` with a
     different shape. Against an empty database it would have won; against
     production it would have silently lost, leaving application code writing
     columns the surviving table does not have. IF NOT EXISTS is what makes it
     quiet rather than loud. */
  const creators = sqlFiles().filter(f =>
    /create\s+table[^;]*\bbilling_events\b/i.test(stripSqlComments(read(f))));
  assert.deepEqual(creators, ['supabase-commercial-core.sql'],
    'there must be exactly one billing_events DDL');
});

test('the ledger the code writes is the ledger the schema declares', () => {
  const sql = stripSqlComments(read('supabase-commercial-core.sql'));
  const ddl = sql.slice(sql.search(/create\s+table[^;]*\bbilling_events\b/i));
  const cols = ddl.slice(0, ddl.indexOf(');'));
  ['provider', 'provider_event_id', 'account_id', 'subscription_id', 'result']
    .forEach(c => assert.ok(new RegExp('\\b' + c + '\\b').test(cols),
      'billing_events must declare ' + c));

  /* And the store must not write a column the table does not have. `applied`
     was the specific field a previous implementation expected and this schema
     never had. */
  const store = stripJsComments(read('api/_commercial-store.js'));
  const claim = store.slice(store.indexOf('function claimBillingEvent'));
  assert.ok(!/\bapplied\b\s*:/.test(claim.slice(0, 2000)),
    'the ledger has no `applied` column and nothing may write one');
});

test('the ledger is the idempotency mechanism, and the only one', () => {
  const sql = stripSqlComments(read('supabase-commercial-core.sql'));
  assert.match(sql, /create\s+unique\s+index[^;]*billing_events[^;]*provider[^;]*provider_event_id/i,
    'replay protection is a unique index on (provider, provider_event_id)');
  /* Same id from two providers stays two events -- the uniqueness is on the
     PAIR, which is what makes the ledger provider-neutral rather than
     Stripe-shaped. */
  const idx = sql.slice(sql.search(/create\s+unique\s+index[^;]*billing_events/i));
  assert.match(idx.slice(0, 200), /\(\s*provider\s*,\s*provider_event_id\s*\)/,
    'the unique key must be the pair, not the id alone');
});

// ---------------------------------------------------------------------------
// ONE AUTHORITY
// ---------------------------------------------------------------------------

test('only the store writes the entitlements projection', () => {
  /* _access.js reads it. _commercial-store.js writes it, and only through
     syncEntitlementRow, which resolves first. Anything else writing that table
     is a second brain by definition. */
  const writers = apiFiles().filter(f => {
    const src = stripJsComments(read('api/' + f));
    return /['"]\/entitlements[?'"]/.test(src) &&
           /\/entitlements[^'"]*['"][\s\S]{0,200}method:\s*'(POST|PATCH|PUT)'/.test(src);
  });
  assert.deepEqual(writers, ['_commercial-store.js'],
    'exactly one module may write the projection');
});

test('the store never reads the projection to decide anything', () => {
  /* The arrow points one way. If the resolver ever consulted the row it
     projects, the projection would become an input to its own truth. */
  const src = stripJsComments(read('api/_commercial-store.js'));
  const resolver = src.slice(src.indexOf('async function resolveStandardEntitlement'),
                             src.indexOf('async function ensureAccountCommercial'));
  assert.ok(!/\/entitlements/.test(resolver),
    'resolveStandardEntitlement must not read the row it feeds');
});

test('the resolver is the only thing that decides Standard access', () => {
  const exported = Object.keys(E);
  ['resolveStandardEntitlement', 'mayStartStandardPurchase', 'projectToEntitlementRow']
    .forEach(fn => assert.ok(exported.indexOf(fn) !== -1, 'the core must export ' + fn));
});

// ---------------------------------------------------------------------------
// PROVIDER GRACE ONLY
// ---------------------------------------------------------------------------

test('grace comes from the provider and is never extended', () => {
  const at = new Date('2026-03-10T00:00:00Z');
  const provided = new Date('2026-03-20T00:00:00Z').toISOString();
  const withGrace = E.subscriptionAccess({
    provider: 'web', product_code: P.STANDARD, condition: 'past_due',
    current_period_end: '2026-03-01T00:00:00Z', grace_period_end: provided
  }, at);
  assert.equal(withGrace.active, true);
  assert.equal(withGrace.reason, 'grace_period');
  assert.equal(new Date(withGrace.until).toISOString(), provided,
    'access ends exactly when the provider said, not a day later');
});

test('no provider grace means no grace at all', () => {
  const at = new Date('2026-03-10T00:00:00Z');
  const none = E.subscriptionAccess({
    provider: 'web', product_code: P.STANDARD, condition: 'past_due',
    current_period_end: '2026-03-01T00:00:00Z', grace_period_end: null
  }, at);
  assert.equal(none.active, false,
    'a failed payment with no provider grace does not buy a training week');
  assert.equal(none.reason, 'payment_hold');
});

test('the period already paid for is honoured, and is not called grace', () => {
  /* Distinguishing the two is the point of the rule. Being inside a period the
     athlete has already paid for is not a concession; it is what they bought. */
  const at = new Date('2026-03-10T00:00:00Z');
  const paid = E.subscriptionAccess({
    provider: 'web', product_code: P.STANDARD, condition: 'past_due',
    current_period_end: '2026-03-31T00:00:00Z', grace_period_end: null
  }, at);
  assert.equal(paid.active, true);
  assert.notEqual(paid.reason, 'grace_period');
});

test('no module declares a grace length of its own', () => {
  apiFiles().forEach(f => {
    const src = stripJsComments(read('api/' + f));
    assert.ok(!/GRACE_DAYS/.test(src), f + ' declares an invented grace length');
  });
});

// ---------------------------------------------------------------------------
// ONE TRIAL COUNTER
// ---------------------------------------------------------------------------

test('the trial fact lives on the account and nowhere else', () => {
  const sql = stripSqlComments(read('supabase-commercial-core.sql'));
  const tables = {};
  sql.replace(/create\s+table\s+if\s+not\s+exists\s+public\.(\w+)\s*\(([\s\S]*?)\n\);/gi,
    (m, name, body) => { tables[name] = body; return m; });
  const holders = Object.keys(tables).filter(t => /trial_consumed_at/.test(tables[t]));
  assert.deepEqual(holders, ['account_commercial'],
    'exactly one table records that the introductory trial has been used');
});

test('one trial per athlete, not one per provider', () => {
  const already = {
    account: { trial_consumed_at: '2026-01-01T00:00:00Z' },
    subscriptions: [],
    provider: 'apple', offerCode: 'STANDARD_MONTHLY',
    now: new Date('2026-06-01T00:00:00Z')
  };
  const r = E.mayStartStandardPurchase(already);
  assert.ok(r.trial && r.trial.eligible === false,
    'a trial spent on the web is spent for Apple too');
});

test('a beta grant does not spend the trial, and does not block a first purchase', () => {
  const r = E.mayStartStandardPurchase({
    account: { trial_consumed_at: null },
    subscriptions: [],
    grants: [{ source: 'admin_beta', revoked_at: null }],
    provider: 'web', offerCode: 'STANDARD_MONTHLY',
    now: new Date('2026-06-01T00:00:00Z')
  });
  assert.equal(r.allowed, true, 'a tester may still make a first real purchase');
  assert.ok(r.trial && r.trial.eligible === true, 'and their trial is untouched');
});

// ---------------------------------------------------------------------------
// COMMERCE IS OFF
// ---------------------------------------------------------------------------

test('checkout refuses before it touches a provider or the database', () => {
  const C = require('../api/_checkout.js');
  const src = stripJsComments(read('api/_checkout.js'));
  const guard = src.indexOf("commerce_disabled");
  const firstNetwork = Math.min(
    ...['S.sb(', 'fetch(', 'createSession'].map(t => {
      const i = src.indexOf(t);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    }));
  assert.ok(guard !== -1, 'there must be a disabled path');
  assert.ok(guard < firstNetwork,
    'the switch must be read before anything is created anywhere');
  assert.ok(typeof C === 'object' || typeof C === 'function');
});

test('the commerce switch defaults to off', () => {
  const A = require('../api/_access.js');
  const prev = process.env.VVV_COMMERCE_ENABLED;
  delete process.env.VVV_COMMERCE_ENABLED;
  try{ assert.equal(A.commerceEnabled(), false); }
  finally{ if (prev !== undefined) process.env.VVV_COMMERCE_ENABLED = prev; }
});

// ---------------------------------------------------------------------------
// THE SCHEMA IN THE REPOSITORY IS THE SCHEMA IN PRODUCTION
// ---------------------------------------------------------------------------

test('the four production hardening changes are represented', () => {
  const sql = read('supabase-commercial-core.sql');
  const bare = stripSqlComments(sql);

  // A. touch_updated_at has a pinned search_path
  const fn = bare.slice(bare.indexOf('function public.touch_updated_at'));
  assert.match(fn.slice(0, 400), /set\s+search_path/i,
    'touch_updated_at must pin its search_path');

  // B. the seeder is not executable by the client roles
  assert.match(bare,
    /revoke\s+all\s+on\s+function\s+public\.seed_account_commercial\(\)\s+from\s+public,\s*anon,\s*authenticated/i,
    'seed_account_commercial must not be callable by anon or authenticated');

  // C. read-own policies hoist auth.uid()
  const policies = bare.match(/create\s+policy[\s\S]*?;/gi) || [];
  const readOwn = policies.filter(p => /auth\.uid\(\)/.test(p));
  assert.ok(readOwn.length >= 3, 'the commercial read-own policies must exist');
  readOwn.forEach(p => assert.ok(/\(\s*select\s+auth\.uid\(\)\s*\)/i.test(p),
    'every policy must hoist auth.uid() into a subquery: ' + p.slice(0, 80)));

  // D. billing_events.subscription_id is covered
  assert.match(bare, /create\s+index[^;]*billing_events[^;]*\(\s*subscription_id\s*\)/i,
    'billing_events.subscription_id must have a covering index');
});

test('the migration is safe to re-run against a populated database', () => {
  const bare = stripSqlComments(read('supabase-commercial-core.sql'));
  (bare.match(/create\s+table\s+[^;]*/gi) || []).forEach(s =>
    assert.match(s, /create\s+table\s+if\s+not\s+exists/i, 'tables must be conditional'));
  (bare.match(/create\s+(unique\s+)?index\s+[^;]*/gi) || []).forEach(s =>
    assert.match(s, /if\s+not\s+exists/i, 'indexes must be conditional'));
  /* And nothing destructive: production already holds two accounts, two beta
     grants and zero consumed trials, and re-running this must not change any
     of that. */
  [/\bdrop\s+table\b/i, /\btruncate\b/i, /\bdelete\s+from\b/i]
    .forEach(rx => assert.ok(!rx.test(bare),
      'the migration must never destroy production data: ' + rx));
});

test('nothing backfills a consumed trial or invents a subscription', () => {
  const bare = stripSqlComments(read('supabase-commercial-core.sql'));
  const inserts = bare.match(/insert\s+into\s+public\.\w+[\s\S]*?;/gi) || [];
  inserts.forEach(ins => {
    assert.ok(!/trial_consumed_at/i.test(ins),
      'no migration may stamp a trial as used');
    assert.ok(!/insert\s+into\s+public\.subscriptions/i.test(ins),
      'no migration may invent a subscription');
    assert.ok(!/insert\s+into\s+public\.billing_events/i.test(ins),
      'no migration may invent a billing event');
  });
});

// ---------------------------------------------------------------------------
// THE STORE STILL EXPORTS ONE COHERENT API
// ---------------------------------------------------------------------------

test('the commercial store exposes one API and no duplicate of it', () => {
  ['readCommercialFacts', 'resolveStandardEntitlement', 'ensureAccountCommercial',
   'consumeTrialForAccount', 'upsertSubscription', 'grantEntitlement', 'revokeGrant',
   'claimBillingEvent', 'markBillingEventProcessed', 'mayStartStandardPurchase',
   'syncEntitlementRow']
    .forEach(fn => assert.equal(typeof Store[fn], 'function', 'store must export ' + fn));
});
