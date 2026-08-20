'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// supabase-entitlement.sql cannot be executed here -- there is no database in
// the test environment and there must never be a production one. What CAN be
// pinned is the set of properties whose absence caused, or would cause, a real
// incident. Each test below corresponds to something that actually went wrong
// or was found on review, not to a hypothetical.
//
// The headline one: the first real migration reported beta_users=0 against
// approved_testers=5 and looked like a failure. It was not. The backfill joins
// the allowlist to auth.users, so it can only grant access to testers who have
// signed in at least once; the acceptance criterion was wrong, not the data.
const SQL = fs.readFileSync(path.join(__dirname, '..', 'supabase-entitlement.sql'), 'utf8');
// Comments describe intent; only executable text can create or destroy a row.
const CODE = SQL.replace(/^\s*--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ' ');

// ---------------------------------------------------------------------------
// THE MIGRATION CANNOT DESTROY LIVE DATA
// ---------------------------------------------------------------------------
test('nothing in the migration drops or truncates anything', () => {
  [/\bdrop\s+table\b/i, /\btruncate\b/i, /\bdrop\s+column\b/i, /\bdrop\s+schema\b/i]
    .forEach(rx => assert.ok(!rx.test(CODE), 'destructive statement present: ' + rx));
});

test('the only DELETE is inside the pruner, which the migration never calls', () => {
  const deletes = CODE.match(/\bdelete\s+from\s+[a-z_.]+/gi) || [];
  assert.equal(deletes.length, 1, 'expected exactly one DELETE, found: ' + JSON.stringify(deletes));
  assert.match(deletes[0], /access_leases/, 'and it must only ever touch leases');
  const body = CODE.slice(CODE.indexOf('function public.prune_access_leases'));
  assert.match(body.slice(0, 600), /delete\s+from\s+public\.access_leases/i,
    'the DELETE belongs to prune_access_leases()');
  assert.ok(!/select\s+public\.prune_access_leases\s*\(/i.test(CODE),
    'and the migration must not invoke it');
});

test('it drops only its own policy and its own triggers', () => {
  (CODE.match(/drop\s+policy[^;]*/gi) || []).forEach(s =>
    assert.match(s, /on public\.entitlements/i, 'must not disturb Phase 1/2 policies: ' + s));
  (CODE.match(/drop\s+trigger[^;]*/gi) || []).forEach(s =>
    assert.ok(/seed_entitlement_on_signup|entitlement_revocation_kills_leases/.test(s),
      'must not disturb an existing trigger: ' + s));
});

test('it does not collide with the live beta gate trigger', () => {
  assert.ok(!/beta_allowlist_gate/.test(CODE),
    'beta_allowlist_gate is live and verified; this migration must not touch it');
  const beta = fs.readFileSync(path.join(__dirname, '..', 'supabase-beta-gate.sql'), 'utf8');
  assert.match(beta, /create trigger beta_allowlist_gate/,
    'precondition: the beta gate still owns that trigger name');
});

test('both new tables cascade from auth.users, so account deletion stays clean', () => {
  const ent = CODE.slice(CODE.indexOf('create table if not exists public.entitlements'));
  assert.match(ent.slice(0, 400), /references auth\.users\(id\) on delete cascade/i);
  const lease = CODE.slice(CODE.indexOf('create table if not exists public.access_leases'));
  assert.match(lease.slice(0, 500), /references auth\.users\(id\) on delete cascade/i);
});

// ---------------------------------------------------------------------------
// THE BACKFILL ADDS ACCESS AND NEVER REMOVES IT
// ---------------------------------------------------------------------------
test('the backfill never demotes an override it did not create', () => {
  const conflicts = CODE.match(/on conflict \(user_id\) do update[\s\S]*?;/gi) || [];
  assert.equal(conflicts.length, 2, 'owner and beta');
  const beta = conflicts.find(c => /coalesce/i.test(c));
  assert.ok(beta, 'the beta backfill must preserve an existing override');
  assert.match(beta, /set override = coalesce\(public\.entitlements\.override, 'beta'\)/i,
    "`else 'beta'` would overwrite a future promo grant on a re-run of a " +
    'migration advertised as idempotent');
});

test('the owner is written before the beta pass, and is never overwritten by it', () => {
  assert.ok(CODE.indexOf("values (owner_uid::uuid, 'owner'") <
            CODE.indexOf("select id, 'beta'"),
    'ordering matters: the beta pass must find the owner row already present');
});

test('the allowlist join normalises the same way the allowlist stores', () => {
  assert.match(CODE, /join auth\.users u on lower\(trim\(u\.email\)\) = b\.email/,
    'beta_allowlist stores lower(trim(email)); matching on lower() alone silently misses');
});

test('the owner placeholder cannot be run past by accident', () => {
  assert.match(CODE, /like 'REPLACE-WITH-%'[\s\S]{0,200}raise exception/i);
  assert.match(CODE, /!~\*\s*'\^\[0-9a-f\]\{8\}/, 'and it must look like a uuid');
  assert.match(CODE, /not exists \(select 1 from auth\.users where id = owner_uid::uuid\)[\s\S]{0,160}raise exception/i,
    'and belong to an account that exists');
});

// ---------------------------------------------------------------------------
// THE VERIFICATION QUERY ASKS THE RIGHT QUESTION
// ---------------------------------------------------------------------------
test('STEP 7 reports coverage, not allowlist equality', () => {
  const step7 = SQL.slice(SQL.indexOf('STEP 7'));
  assert.match(step7, /uncovered_MUST_BE_0/,
    'the invariant is that no approved tester WITH an account lacks access');
  assert.match(step7, /approved_never_signed_in/,
    'and the benign explanation must be visible beside it, or a correct result reads as a failure');
});

test('coverage counts owner access as covering a tester', () => {
  const step7 = SQL.slice(SQL.indexOf('STEP 7'));
  assert.match(step7, /override in \('beta','owner'\)/,
    'the owner is often on the allowlist; owner access exceeds beta access rather than differing from it');
});

test('an expired override does not count as coverage', () => {
  const step7 = SQL.slice(SQL.indexOf('STEP 7'));
  assert.match(step7, /override_expires_at is null[\s\S]{0,80}override_expires_at > now\(\)/,
    'a lapsed grant is not a grant');
});

test('STEP 7 surfaces any account that would be refused at activation', () => {
  const step7 = SQL.slice(SQL.indexOf('STEP 7'));
  assert.match(step7, /accounts_without_override/,
    'the question that actually matters before switching ACCOUNT_REQUIRED on');
});

test('STEP 7 is read-only', () => {
  const step7 = SQL.slice(SQL.indexOf('STEP 7'));
  [/\binsert\b/i, /\bupdate\b/i, /\bdelete\b/i, /\bcreate\b/i, /\bdrop\b/i, /\balter\b/i]
    .forEach(rx => assert.ok(!rx.test(step7.replace(/^\s*--.*$/gm, '')),
      'the verification step must never write: ' + rx));
});

// ---------------------------------------------------------------------------
// SECURITY SURFACE
// ---------------------------------------------------------------------------
test('leases are unreadable by any browser', () => {
  assert.match(CODE, /alter table public\.access_leases enable row level security/i);
  const after = CODE.slice(CODE.indexOf('access_leases enable row level security'));
  assert.ok(!/create policy[^;]*on public\.access_leases/i.test(after),
    'RLS with no policy is deny-all; a single policy here would open the credential store');
});

test('the athlete may read their own entitlement and write nothing', () => {
  const pol = (CODE.match(/create policy[^;]*on public\.entitlements[\s\S]*?;/gi) || []);
  assert.equal(pol.length, 1, 'exactly one policy');
  assert.match(pol[0], /for select/i, 'read only');
  assert.match(pol[0], /auth\.uid\(\) = user_id/, 'and only their own row');
});

test('the pruner is not executable by a browser', () => {
  assert.match(CODE, /revoke all on function public\.prune_access_leases\(\) from public, anon, authenticated/i);
});

test('the signup seeder that 3A2 had to replace is now gone entirely', () => {
  // This test used to assert the seeder was FLAGGED for replacement. Phase 3
  // replaced it: the beta cohort is carried by canonical entitlement_grants,
  // and a signup auto-grant would have given every arriving athlete permanent
  // free access the moment the commercial front door opened.
  const step6 = SQL.slice(SQL.indexOf('STEP 6'), SQL.indexOf('STEP 7'));
  assert.match(step6, /RETIRED/i, 'STEP 6 must say what happened to it');
  assert.equal(/create trigger seed_entitlement_on_signup/i.test(step6), false);
  assert.equal(/create or replace function public\.seed_entitlement_for_new_user/i.test(step6), false);
});

// ---------------------------------------------------------------------------
// THE GATE ITSELF IS STILL INERT
// ---------------------------------------------------------------------------
test('both activation flags remain off with the environment unset', () => {
  const saved = [process.env.VVV_ACCOUNT_REQUIRED, process.env.VVV_COMMERCIAL_REQUIRED];
  delete process.env.VVV_ACCOUNT_REQUIRED;
  delete process.env.VVV_COMMERCIAL_REQUIRED;
  try {
    const A = require('../api/_access.js');
    assert.equal(A.accountRequired(), false);
    assert.equal(A.commercialRequired(), false);
    const d = A.resolveAccess({ uid: null, entitlement: null, accountRequired: A.accountRequired(),
                                commercialRequired: A.commercialRequired(), now: new Date() });
    assert.equal(d.allow, true, 'nothing is gated while the flags are unset');
    assert.equal(d.reason, 'account_gate_off');
  } finally {
    if (saved[0] !== undefined) process.env.VVV_ACCOUNT_REQUIRED = saved[0];
    if (saved[1] !== undefined) process.env.VVV_COMMERCIAL_REQUIRED = saved[1];
  }
});

test('an authenticated account with no override still gets in while commerce is off', () => {
  // This is the answer to "would an ordinary non-beta user receive access when
  // ACCOUNT_REQUIRED is ON?" -- yes, deliberately: 3A1 gates identity, not
  // entitlement. It is safe only because the live beta trigger refuses to
  // create an account for an unapproved address in the first place.
  const A = require('../api/_access.js');
  const d = A.resolveAccess({ uid: 'u1', entitlement: { state: 'expired', tier: 'standard',
                              access_until: null, override: null },
                              accountRequired: true, commercialRequired: false, now: new Date() });
  assert.equal(d.allow, true);
  assert.equal(d.reason, 'pre_commercial');
});
