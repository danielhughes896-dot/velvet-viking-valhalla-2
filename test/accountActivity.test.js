'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// LAST ACTIVE, AND WHAT HAPPENS WHEN AN ACCOUNT IS DELETED.
//
// Everything a metrics board wants already existed except one thing: whether an
// athlete is still using the product. That is the difference between a
// subscriber and a churn risk, and it was the only signal missing.

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SQL = read('supabase-account-activity.sql');

test('activity is one overwritten timestamp, not an event log', () => {
  // An events table would be an analytics product: rows per open, a retention
  // policy, and personal movement data we have no business keeping. One
  // nullable column answers the operational question and forgets the rest.
  assert.match(SQL, /add column if not exists last_active_at timestamptz/);
  assert.equal(/create table .*activity|create table .*events/i.test(SQL), false,
    'no activity table may be introduced');
  assert.match(SQL, /Overwritten, never appended/,
    'the schema must say why it cannot become a movement log');
});

test('the touch is coarse on purpose', () => {
  // Per-open precision buys nothing operationally and costs a write per
  // request -- and it would make the column a session-by-session timeline,
  // which is the failure mode of recording activity too precisely.
  assert.match(SQL, /last_active_at < v_now - interval '1 hour'/);
});

test('the client cannot write its own activity', () => {
  assert.match(SQL, /revoke all on function public\.touch_last_active\(uuid\) from public, anon, authenticated/);
  assert.match(SQL, /grant execute on function public\.touch_last_active\(uuid\) to postgres, service_role/);
  // And it is called where an athlete genuinely opens the product.
  const session = read('api/session.js');
  assert.match(session, /rpc\/touch_last_active/);
  assert.match(session, /p_account_id: who\.uid/, 'the account comes from the verified token');
});

test('a failed touch never blocks an athlete getting in', () => {
  const session = read('api/session.js');
  const at = session.indexOf('touch_last_active');
  const around = session.slice(at - 600, at + 400);
  assert.match(around, /try\{/, 'the touch must be guarded');
  assert.match(around, /catch\(e\)\{ log\('LAST_ACTIVE_TOUCH_FAILED'\); \}/,
    'a metrics timestamp must not be the reason a session fails');
  // And it happens after the lease exists, so it cannot delay or prevent one.
  assert.ok(session.indexOf('A.buildSetCookie') < at);
});

test('the operational view carries no personal or training data', () => {
  /* The view definition ONLY -- the verify query below it counts 'active_30d'
     using interval '30 days', and a slice that swallowed it would fail on the
     word "days" while proving nothing about the view. */
  const start = SQL.indexOf('create or replace view');
  const view = SQL.slice(start, SQL.indexOf('revoke all on public.account_operational_state'));
  /* Table names, not loose words: 'name' matches column_name and 'days' matches
     an interval. What must be absent is the DATA, so the tables are the test. */
  for (const forbidden of ['email', 'plans', 'strava_activities', 'strava_connections', 'garmin']) {
    assert.equal(new RegExp('\\b' + forbidden + '\\b', 'i').test(view), false,
      'the operational view reaches into ' + forbidden);
  }
  assert.match(view, /account_id/);
  /* Asserted against the whole file: the slice above deliberately STOPS at the
     revoke, so looking for it inside the slice can never succeed. */
  assert.match(SQL, /revoke all on public\.account_operational_state from public, anon, authenticated/);
});

// ---------------------------------------------------------------------------
// DELETION
// ---------------------------------------------------------------------------
test('deleting an account erases the person and keeps the money record', () => {
  // Proven on a disposable Postgres cluster: every table keyed on the athlete
  // cascades, and billing_events alone is SET NULL -- so a financial audit row
  // survives with no one attached to it. Erasure of the person, retention of
  // the anonymised record.
  const core = read('supabase-commercial-core.sql');
  assert.match(core, /account_id\s+uuid\s+references auth\.users\(id\) on delete set null/,
    'billing_events must survive deletion, anonymised');
  for (const table of ['account_commercial', 'subscriptions', 'entitlement_grants']) {
    const block = core.slice(core.indexOf('create table if not exists public.' + table));
    assert.match(block.slice(0, 600), /on delete cascade/,
      table + ' must not outlive the account');
  }
});

test('no table keyed on the athlete is left to orphan', () => {
  // NO ACTION on a user-keyed foreign key would block deletion outright or
  // leave a row pointing at nobody. Every one is CASCADE or a deliberate
  // SET NULL, and the deliberate one is named here so a new NO ACTION stands out.
  const files = ['supabase-setup.sql', 'supabase-commercial-core.sql',
                 'supabase-entitlement.sql', 'supabase-account-activity.sql'];
  for (const f of files) {
    const src = read(f);
    const refs = src.match(/references auth\.users\(id\)[^,\n]*/g) || [];
    for (const r of refs) {
      assert.ok(/on delete (cascade|set null)/i.test(r),
        f + ' has a user-keyed FK with no delete rule: ' + r.trim());
    }
  }
});

test('migration order is recorded, because it matters', () => {
  // supabase-commercial-core.sql reads beta_allowlist, so it cannot be applied
  // first. A fresh environment that guesses the order fails halfway.
  /* The ordered table only. The prose above it names files out of order while
     explaining WHY the order matters, and searching the whole document would
     read that explanation as a violation of the thing it explains. */
  const full = read('SUPABASE-MIGRATIONS.md');
  const doc = full.slice(full.indexOf('| # | File'), full.indexOf('## Deployment parameters'));
  const order = ['supabase-setup.sql', 'supabase-beta-gate.sql', 'supabase-entitlement.sql',
                 'supabase-commercial-core.sql', 'supabase-retire-legacy-beta-autogrant.sql',
                 'supabase-trial-grant-source.sql', 'supabase-account-activity.sql',
                 'supabase-trial-via-provider.sql',
                 'supabase-operational-view-provider-trial.sql'];
  let at = -1;
  for (const f of order) {
    const i = doc.indexOf(f);
    assert.ok(i > at, f + ' must appear after the file it depends on');
    at = i;
  }
});

// ---------------------------------------------------------------------------
// THE TRIAL THE VIEW REPORTS IS THE TRIAL THE PRODUCT SELLS
//
// This view once derived trial_active from an entitlement_grants row with
// source = 'trial'. That source was retired when the trial moved onto a real
// provider subscription, and the view was left reading something that can no
// longer exist -- so it answered "no trials are running" with total confidence,
// on the board that decides whether the product is working. These tests exist
// to fail if it ever drifts back.
// ---------------------------------------------------------------------------
const VIEW_MIGRATION = read('supabase-operational-view-provider-trial.sql');

/* The SELECT only. The prose above each copy explains the retired grant model
   at length, and a search across the whole file would read that explanation as
   the defect it describes. */
const viewBody = (sql) => sql.slice(
  sql.indexOf('create or replace view public.account_operational_state'),
  sql.indexOf('from public.account_commercial ac;') + 'from public.account_commercial ac;'.length);

test('the trial comes from the provider subscription, not a grant', () => {
  for (const [name, sql] of [['repository source', SQL], ['migration', VIEW_MIGRATION]]) {
    const body = viewBody(sql);
    assert.equal(/source\s*=\s*'trial'/.test(body), false,
      name + ': the view derives a trial from the retired grant source');
    assert.match(body, /as trial_active/);
    /* Not merely "mentions subscriptions" -- the trial_active expression itself
       must be the one reading condition = 'trialing'. */
    const trialActive = body.slice(body.lastIndexOf('exists', body.indexOf('as trial_active')),
                                   body.indexOf('as trial_active'));
    assert.match(trialActive, /public\.subscriptions/, name + ': trial_active does not read subscriptions');
    assert.match(trialActive, /condition\s*=\s*'trialing'/, name + ': trial_active does not read the provider condition');
    assert.equal(/entitlement_grants/.test(trialActive), false,
      name + ': trial_active still reaches into entitlement_grants');
  }
});

test('the view bounds a trial exactly the way the resolver does', () => {
  // subscriptionAccess() ends a trial at trial_end, falling back to
  // current_period_end for providers that express a trial as the first period.
  // If the view used trial_end alone, a Stripe trial recorded that way would
  // show as inactive while the athlete is demonstrably inside it.
  const resolver = read('api/_entitlement.js');
  assert.match(resolver, /boundary\(s\.trial_end, s\.current_period_end\)/,
    'the resolver no longer bounds a trial this way -- the view must follow it');
  for (const [name, sql] of [['repository source', SQL], ['migration', VIEW_MIGRATION]]) {
    assert.match(viewBody(sql), /coalesce\(s\.trial_end, s\.current_period_end\) > now\(\)/,
      name + ': the view and the access decision disagree about when a trial ends');
  }
});

test('trial_ends_at is a subscription date', () => {
  for (const [name, sql] of [['repository source', SQL], ['migration', VIEW_MIGRATION]]) {
    const body = viewBody(sql);
    const expr = body.slice(body.lastIndexOf('(select', body.indexOf('as trial_ends_at')),
                            body.indexOf('as trial_ends_at'));
    assert.match(expr, /public\.subscriptions/, name + ': trial_ends_at does not read subscriptions');
    assert.match(expr, /s\.trial_end/, name + ': trial_ends_at is not the subscription trial end');
    assert.equal(/entitlement_grants/.test(expr), false,
      name + ': trial_ends_at still reaches into entitlement_grants');
    /* The resolver refuses a revoked subscription before it reads any date on
       it. A refunded purchase whose trial_end is next week has no trial ending
       next week, and reporting one puts a phantom renewal on the board. */
    assert.match(expr, /s\.condition <> 'revoked'/,
      name + ': trial_ends_at reports dates off a revoked subscription');
  }
});

test('admin grants stay in entitlement_grants, and stay the only two', () => {
  // Nothing about moving the trial touches admin_beta and admin_comp: they have
  // no provider, so a grant is where they belong. This fails if the fix above
  // took the grant lookup out with the trial.
  const resolver = read('api/_entitlement.js');
  const sources = /const GRANT_SOURCES = \[([^\]]*)\]/.exec(resolver);
  assert.ok(sources, 'GRANT_SOURCES is gone from the resolver');
  assert.equal(/'trial'/.test(sources[1]), false, 'the retired trial source is back in the resolver');
  for (const [name, sql] of [['repository source', SQL], ['migration', VIEW_MIGRATION]]) {
    const body = viewBody(sql);
    const expr = body.slice(body.lastIndexOf('exists', body.indexOf('as admin_grant_active')),
                            body.indexOf('as admin_grant_active'));
    assert.match(expr, /public\.entitlement_grants/, name + ': admin grants no longer come from grants');
    assert.match(expr, /'admin_beta','admin_comp'/, name + ': the admin grant sources have drifted');
  }
});

test('paid state stays provider-derived', () => {
  for (const [name, sql] of [['repository source', SQL], ['migration', VIEW_MIGRATION]]) {
    const body = viewBody(sql);
    assert.match(body, /\(select s\.condition from public\.subscriptions s[\s\S]*?as subscription_condition/,
      name + ': subscription_condition is not read from subscriptions');
    assert.match(body, /\(select s\.current_period_end from public\.subscriptions s[\s\S]*?as paid_through/,
      name + ': paid_through is not read from subscriptions');
  }
});

test('the migration and the repository source cannot disagree', () => {
  // A fresh environment builds the view from supabase-account-activity.sql; an
  // existing database is corrected by the migration. Two copies of a definition
  // is a defect waiting to happen, so they are asserted identical rather than
  // reviewed by eye.
  assert.equal(viewBody(VIEW_MIGRATION), viewBody(SQL),
    'the migration would leave production with a different view than a rebuild produces');
});

test('the migration proves the apply took, and touches no data', () => {
  // A migration that reports success because it reached the end proves nothing.
  assert.match(VIEW_MIGRATION, /pg_get_viewdef\('public\.account_operational_state'::regclass/,
    'the migration must read the definition back out of the catalogue');
  assert.match(VIEW_MIGRATION, /raise exception/, 'and refuse if the replace did not take');
  // It replaces one derived view. Nothing here may write, drop or create a table.
  const stripped = VIEW_MIGRATION.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');
  for (const forbidden of [/\bdrop table\b/i, /\bcreate table\b/i, /\bdelete from\b/i,
                           /\binsert into\b/i, /\bupdate public\./i, /\balter table\b/i]) {
    assert.equal(forbidden.test(stripped), false,
      'the view migration writes to a table: ' + forbidden);
  }
});
