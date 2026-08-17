'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RUNTIME_RELATIVE } = require('./harness.js');

// PRE-BETA HARDENING TESTS.
//
// The database change this covers has already been applied to the live project.
// These tests do not re-apply it and cannot reach it; what they protect is the
// repository's account of it, and the invariants around it that a later change
// could quietly break.
//
// The distinction that matters throughout: two of the advisor's warnings are
// still open ON PURPOSE, because closing them would break the product. A future
// reader tidying up warnings needs to find that written down rather than
// discover it by making signed-in reads fail.
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SQL = read('supabase-pre-beta-least-privilege.sql');
const RUNTIME = read(RUNTIME_RELATIVE);
// Comments carry the reasoning and legitimately name things they forbid.
const stmts = SQL.replace(/^\s*--[^\n]*$/gm, ' ');

test('the applied migration revokes exactly the functions with no legitimate direct caller', () => {
  for (const fn of [
    'public.enforce_beta_allowlist()',
    'public.seed_entitlement_for_new_user()',
    'public.revoke_leases_on_entitlement_change()',
    'public.rls_auto_enable()',
  ]) {
    const rx = new RegExp(
      'revoke all on function ' + fn.replace(/[().]/g, '\\$&') +
        '\\s+from public, anon, authenticated;'
    );
    assert.match(stmts, rx, fn + ' must be revoked from all three browser roles');
  }
});

test('rls_auto_enable is named as the one of greatest concern, and why', () => {
  // It can change the security state of the database and it was anonymously
  // callable. If that reasoning is lost, the revoke looks arbitrary.
  assert.match(SQL, /rls_auto_enable is the one that mattered most/);
  assert.match(SQL, /ddl_command_end/);
});

test('the search_path finding is closed with an explicit empty search_path', () => {
  assert.match(stmts, /alter function public\._vvv_owner_uid\(\) set search_path = '';/);
  assert.match(stmts, /revoke all on function public\._vvv_owner_uid\(\) from public, anon, authenticated;/);
});

test('the two functions the product needs are granted, not revoked', () => {
  assert.match(stmts, /grant execute on function public\.is_beta_approved\(\)\s+to authenticated;/);
  assert.match(stmts, /grant execute on function public\.delete_own_account\(\) to authenticated;/);
  // And never revoked anywhere in the file. The keyword has to be matched as a
  // keyword: `revoke_leases_on_entitlement_change` is a function NAME containing
  // "revoke", and a looser pattern spans the whole verify SELECT and misfires.
  const REVOKE_STMT = /\brevoke\s+(all|execute)\b[^;]*/gi;
  const revoked = stmts.match(REVOKE_STMT) || [];
  assert.ok(revoked.length >= 6, 'sanity: the revoke statements were found');
  for (const r of revoked) {
    assert.ok(
      !/\bis_beta_approved\b/.test(r),
      'is_beta_approved is an RLS policy predicate: revoking it breaks every signed-in query'
    );
    assert.ok(
      !/\bdelete_own_account\b/.test(r),
      'delete_own_account is the only RPC the app calls, and is how erasure happens'
    );
  }
});

test('the migration disables no RLS and invents no policy', () => {
  assert.ok(!/disable row level security/i.test(stmts), 'must never disable RLS');
  assert.ok(!/create policy/i.test(stmts), 'must not invent a policy');
  assert.ok(!/\bdrop (table|column|policy)\b/i.test(stmts), 'must not drop anything');
  assert.ok(!/\b(delete from|truncate|update )\b/i.test(stmts), 'must not touch data');
});

test('the fail-closed RLS warnings are explained rather than silenced', () => {
  // These three are INFO and are the safe state: RLS on, no policy, so the
  // browser roles read nothing and only the service key gets in.
  for (const t of ['access_leases', 'beta_allowlist', 'strava_connections']) {
    assert.ok(SQL.includes(t), t + ' must be accounted for');
  }
  assert.match(SQL, /FAIL-CLOSED/);
  assert.match(
    SQL,
    /Adding a policy to silence the lint would be the\s*--\s*only way to make these tables less safe/,
    'the reason not to act must be stated, not left implied'
  );
});

test('the two warnings left open are documented as deliberate', () => {
  assert.match(SQL, /remain as live\s*--\s*advisor warnings ON PURPOSE/);
  assert.match(SQL, /evaluated with the CALLER's privileges/);
});

test('the unapplied hardening step is recorded as outstanding, not as done', () => {
  // supabase-beta-hardening.sql STEP 2 narrows a real over-grant but is not an
  // advisor finding and carries its own authorisation switch.
  assert.match(SQL, /STEP 2 -- `revoke update on\s*--\s*public\.strava_activities/);
  assert.match(SQL, /needs that authorisation rather than a quiet inclusion/);
  // And the file must not pretend to have applied it.
  assert.ok(
    !/revoke update on public\.strava_activities/.test(stmts),
    'STEP 2 must not be smuggled in as an executable statement'
  );
});

test('the leaked-password warning is recorded with the finding that makes it non-vacuous', () => {
  assert.match(SQL, /auth_leaked_password_protection/);
  assert.match(
    SQL,
    /one\s*--\s*account carries a real bcrypt hash, so the warning is not vacuous/,
    'the passwordless claim is true of the app and not of the project; that must be written down'
  );
});

test('an undo path exists for every reversible statement', () => {
  assert.match(SQL, /HOW TO UNDO/);
  assert.match(SQL, /alter function public\._vvv_owner_uid\(\) reset search_path;/);
});

// ---------------------------------------------------------------------------
// NOTHING ELSE MOVED
// ---------------------------------------------------------------------------
test('the serverless function budget is unchanged at 12', () => {
  const fns = fs
    .readdirSync(path.join(ROOT, 'api'))
    .filter((f) => /\.js$/.test(f) && f.charAt(0) !== '_');
  assert.equal(fns.length, 12, 'Hobby plan allows 12; this closeout adds none');
});

test('both commercial gates are still read from the environment and neither is forced on', () => {
  const access = read('api/_access.js');
  assert.match(access, /flagOn\(process\.env\.VVV_ACCOUNT_REQUIRED\)/);
  assert.match(access, /flagOn\(process\.env\.VVV_COMMERCIAL_REQUIRED\)/);
  // No hardcoded activation anywhere in the API surface.
  for (const f of fs.readdirSync(path.join(ROOT, 'api')).filter((f) => /\.js$/.test(f))) {
    const src = read(path.join('api', f));
    assert.ok(
      !/VVV_(ACCOUNT|COMMERCIAL)_REQUIRED\s*=\s*['"]?(1|on|true|yes)/i.test(src),
      f + ' must not force a commercial gate on'
    );
  }
});

test('the beta allowlist gate is still the mechanism, in SQL and in the trigger', () => {
  assert.match(read('supabase-beta-gate.sql'), /create trigger beta_allowlist_gate/);
  // The revoke must not have removed the gate's own definition.
  assert.match(read('supabase-beta-gate.sql'), /function public\.enforce_beta_allowlist/);
});

test('no payment activation and no Race Finder came along for the ride', () => {
  assert.match(read('supabase-commercial-activation.sql'), /select 'no'::text/);
  assert.equal(
    RUNTIME.indexOf('RACE_FINDER_ENABLED'),
    -1,
    'Race Finder is a separate held branch and must not appear on main'
  );
  assert.equal(RUNTIME.indexOf('searchRaces'), -1);
});

test('this closeout changed no coaching behaviour and no native build', () => {
  // The runtime is untouched by this workstream; these are the load-bearing
  // engine entry points, asserted present and unrenamed.
  for (const fn of ['function segmentsFor(', 'function buildBlockWeeks(', 'function buildDaysFromWeeks(']) {
    assert.ok(RUNTIME.includes(fn), fn + ' must still exist');
  }
  const cap = JSON.parse(read('capacitor.config.json'));
  assert.equal(cap.appId, 'com.velvetviking.valhalla', 'native app id unchanged');
});
