'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RUNTIME_RELATIVE } = require('./harness.js');

// PHASE 5 -- PRIVATE-BETA SUPABASE CLOSURE.
//
// "Verified Supabase closure" stayed open across several reports because it
// cannot be closed from here. This repository holds the migration SCRIPTS; it
// cannot know whether they were applied, applied in full, or edited in the
// dashboard afterwards. Those are facts about a running database.
//
// So this file does the half that IS provable, and pins it: the posture the
// migrations DECLARE, and the size of the surface a browser can actually reach.
// The other half is one read-only query, and these tests make sure that query
// keeps asking the right things.
//
// Nothing here executes SQL.
const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SETUP     = read('supabase-setup.sql');
const GATE      = read('supabase-beta-gate.sql');
const ENT       = read('supabase-entitlement.sql');
const VERIFY    = read('supabase-beta-verification.sql');
const HARDEN    = read('supabase-beta-hardening.sql');
const COMMERCIAL = read('supabase-commercial-activation.sql');
const RUNTIME   = read(RUNTIME_RELATIVE);

/* Statements only. Every one of these files explains itself at length, and a
   rule about SQL that a comment can satisfy is not a rule. */
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*--.*$/gm, '');

// ---------------------------------------------------------------------------
// 1. THE SURFACE A BROWSER CAN REACH
// ---------------------------------------------------------------------------
/* This is the fact everything else in the beta assessment rests on, and it is
   cheap to check, so it is checked rather than remembered. The runtime talks to
   exactly one table and one function. If that ever stops being true, the risk
   assessment for every policy below changes and this test is where it shows. */
test('1. the runtime touches one table and one RPC, and no others', () => {
  const reached = t => new RegExp('/rest/v1/' + t).test(RUNTIME);
  assert.equal(reached('plans'), true, 'the plan mirror is the one table the browser writes');
  ['strava_activities', 'strava_connections', 'beta_allowlist', 'entitlements', 'access_leases']
    .forEach(t => assert.equal(reached(t), false,
      'the browser must not reach ' + t + ' directly — it is server-side or nobody’s'));

  const rpcs = Array.from(new Set(
    Array.from(RUNTIME.matchAll(/rpc\/([a-z_]+)/g)).map(m => m[1])));
  assert.deepEqual(rpcs, ['delete_own_account'],
    'erasure is the only stored procedure the client is allowed to call');
});

test('1. and no service-role key is anywhere near it', () => {
  /* Comments in the runtime discuss the service-role key at length, and
     rightly so -- one of them is the note explaining that it must never be
     shipped. The rule is about KEY MATERIAL, so the prose is stripped before
     the rule is applied rather than the prose being reworded to dodge it. */
  const js = RUNTIME
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(!/sb_secret_|SUPABASE_SERVICE_ROLE_KEY/.test(js),
    'RLS is the boundary precisely because the browser only ever holds the publishable key');
  assert.match(RUNTIME, /sb_publishable_/, 'and the key it does hold is the public one');
});

// ---------------------------------------------------------------------------
// 2. THE POSTURE THE MIGRATIONS DECLARE, TABLE BY TABLE
// ---------------------------------------------------------------------------
/* Declared, not observed -- that distinction is the whole point of the
   verification script. What these guard against is the declaration silently
   changing, which is the half a repository CAN police. */
const RLS_TABLES = ['plans', 'strava_connections', 'strava_activities',
                    'beta_allowlist', 'entitlements', 'access_leases'];
test('2. every athlete-adjacent table declares row level security', () => {
  const all = SETUP + GATE + ENT;
  RLS_TABLES.forEach(t =>
    assert.match(all, new RegExp('alter table public\\.' + t + ' enable row level security'),
      t + ' must have RLS switched on by a migration'));
});

test('2. the token table has RLS and deliberately no policy', () => {
  const stmts = code(SETUP + GATE + ENT);
  assert.ok(!/create policy[^;]*on public\.strava_connections/.test(stmts),
    'RLS with no policy is deny-all to anon and authenticated alike; a policy here could only weaken it');
});

test('2. the tester list has RLS and deliberately no policy', () => {
  const stmts = code(GATE);
  assert.ok(!/create policy[^;]*on public\.beta_allowlist/.test(stmts),
    'a tester must not be able to read the list of testers');
});

test('2. leases have RLS and deliberately no policy', () => {
  const stmts = code(ENT);
  assert.ok(!/create policy[^;]*on public\.access_leases/.test(stmts),
    'a browser can neither read nor forge a delivery credential');
});

test('2. entitlements are readable by their owner and writable by nobody', () => {
  const stmts = code(ENT);
  const policies = (stmts.match(/create policy[\s\S]*?;/g) || [])
    .filter(p => /on public\.entitlements/.test(p));
  assert.equal(policies.length, 1, 'exactly one policy');
  /* Both forms accepted: `(select auth.uid()) = user_id` is the InitPlan
     rewrite -- evaluated once per statement instead of once per row -- and it
     is the SAME predicate. What this guards is that the caller's own id is
     what scopes the row, not how many times Postgres works it out. */
  assert.match(policies[0], /for select using \(\(?\s*(?:select\s+)?auth\.uid\(\)\s*\)?\s*= user_id\)/);
  assert.ok(!/for (insert|update|delete)[^;]*on public\.entitlements/.test(stmts),
    'access authority the client can write is not authority');
});

test('2. the plan row is scoped to its owner AND to an approved tester', () => {
  const stmts = code(GATE);
  const policies = (stmts.match(/create policy[\s\S]*?;/g) || [])
    .filter(p => /on public\.plans/.test(p));
  assert.equal(policies.length, 3, 'select, insert, update');
  policies.forEach(p => {
    assert.match(p, /\(?\s*(?:select\s+)?auth\.uid\(\)\s*\)?\s*= user_id/, 'isolation: ' + p.slice(0, 60));
    assert.match(p, /is_beta_approved\(\)/, 'revocation: ' + p.slice(0, 60));
  });
  assert.ok(!/for delete[^;]*on public\.plans/.test(stmts),
    'deleting a plan row goes through delete_own_account(), not through a policy');
});

test('2. no address that is not on the list can become an account', () => {
  assert.match(code(GATE), /create trigger beta_allowlist_gate\s+before insert on auth\.users/,
    'the endpoint is the message; this trigger is the boundary');
  const at = GATE.indexOf('function public.enforce_beta_allowlist');
  const body = GATE.slice(at, GATE.indexOf('$$;', at));
  assert.match(body, /if not public\.beta_email_approved\(new\.email\)/);
  assert.match(body, /raise exception/, 'and it refuses rather than degrading');
});

test('2. every SECURITY DEFINER function pins its search_path', () => {
  [['supabase-setup.sql', SETUP], ['supabase-beta-gate.sql', GATE],
   ['supabase-entitlement.sql', ENT], ['supabase-commercial-activation.sql', COMMERCIAL]]
    .forEach(([name, sql]) => {
      const defs = code(sql).split(/security definer/).slice(1);
      defs.forEach((d, i) => assert.match(d.slice(0, 120), /set search_path\s*=/,
        name + ' definer #' + (i + 1) + ' must pin search_path — that is what closes the hijack'));
    });
});

test('2. erasure is reachable by an athlete and by nobody else', () => {
  assert.match(code(SETUP), /revoke all on function public\.delete_own_account\(\) from public, anon/);
  assert.match(code(SETUP), /grant execute on function public\.delete_own_account\(\) to authenticated/);
  const at = SETUP.indexOf('function public.delete_own_account');
  const body = SETUP.slice(at, SETUP.indexOf('$$;', at));
  assert.match(body, /if auth\.uid\(\) is null/, 'no session deletes nothing');
  /* The signature, which is the actual guarantee: no parameter means no way to
     name somebody else, whatever the body does. */
  assert.match(SETUP, /function public\.delete_own_account\(\)\s*\n?\s*returns void/,
    'it takes no argument, so it cannot be pointed at anyone else');
  const targets = Array.from(body.matchAll(/where user_id = ([^;]+)/g)).map(m => m[1].trim());
  assert.deepEqual(targets, ['auth.uid()'],
    'and the only row it names is the caller’s own');
});

// ---------------------------------------------------------------------------
// 3. THE VERIFICATION SCRIPT IS READ-ONLY AND ASKS THE RIGHT QUESTIONS
// ---------------------------------------------------------------------------
test('3. it cannot change anything', () => {
  const stmts = code(VERIFY);
  [/\binsert\s+into\b/i, /\bupdate\s+\w+\s+set\b/i, /\bdelete\s+from\b/i,
   /\bcreate\s+(table|policy|trigger|function|or replace)\b/i,
   /\bdrop\b/i, /\balter\b/i, /\bgrant\b/i, /\brevoke\b/i, /\btruncate\b/i]
    .forEach(rx => assert.ok(!rx.test(stmts),
      'the verification script must be safe to run mid-beta: ' + rx));
});

test('3. it covers every table whose posture the beta depends on', () => {
  RLS_TABLES.forEach(t => assert.ok(VERIFY.indexOf(t) !== -1, t + ' is unchecked'));
  ['beta_allowlist_gate', 'seed_entitlement_on_signup', 'entitlement_revocation_kills_leases']
    .forEach(t => assert.ok(VERIFY.indexOf(t) !== -1, 'trigger ' + t + ' is unchecked'));
});

test('3. it looks for the table nobody thought of', () => {
  assert.match(VERIFY, /public_tables_without_rls_expect_0/,
    'a per-table checklist only finds tables someone remembered');
  assert.match(code(VERIFY), /relrowsecurity = false/);
});

test('3. every column states the value it must have', () => {
  const cols = Array.from(code(VERIFY).matchAll(/\bas\s+([a-z0-9_]+)\s*(?:,|;)/g)).map(m => m[1]);
  assert.ok(cols.length >= 20, 'expected a wide single row, got ' + cols.length + ' columns');
  const INFORMATIONAL = ['active_testers', 'live_leases',
                         'oracle_readable_by_testers', 'activities_payload_writable_by_testers'];
  cols.filter(c => INFORMATIONAL.indexOf(c) === -1).forEach(c =>
    assert.match(c, /_expect_(true|false|\d+)$/,
      c + ' must name its expected value or the output cannot be read without this file'));
});

// ---------------------------------------------------------------------------
// 4. THE TWO ACCEPTED-FOR-BETA FACTS, AND WHY THEY ARE ACCEPTABLE
// ---------------------------------------------------------------------------
/* Both are pinned as facts rather than fixed, because fixing them means
   touching a live database and neither is a beta blocker. If the reasoning that
   makes them acceptable stops holding, these are what notice. */
test('4. the allowlist oracle is only reachable by someone already on the list', () => {
  assert.match(code(GATE), /revoke all on function public\.beta_email_approved\(text\) from public, anon/,
    'anon cannot ask');
  assert.ok(!/revoke[^;]*beta_email_approved[^;]*authenticated/.test(code(GATE)),
    'a signed-in tester still can — which is the fact supabase-beta-hardening.sql closes');
  assert.equal(RUNTIME.indexOf('beta_email_approved'), -1,
    'and no shipped client code calls it, which is why closing it is safe');
});

test('4. the RLS predicate does not go through the oracle, so revoking it is safe', () => {
  const at = GATE.indexOf('function public.is_beta_approved');
  const body = GATE.slice(at, GATE.indexOf('$$;', at));
  assert.match(body, /security definer/,
    'SECURITY DEFINER means its body runs as the owner, so the policies keep working ' +
    'even once `authenticated` loses EXECUTE on the function it calls');
  assert.match(body, /auth\.jwt\(\) ->> 'email'/,
    'and it asks about the CALLER, never about an address the caller chose');
});

test('4. nothing that ships writes a staged activity, which is what makes the column grant safe', () => {
  assert.equal(RUNTIME.indexOf('strava_activities'), -1, 'not from the browser');
  // Renamed to a _-prefixed module when the six Strava routes moved behind
  // one router. Same file, same writer, same service key -- only Vercel's
  // count of Serverless Functions changed.
  const sync = read('api/_strava-sync.js');
  assert.match(sync, /ingested_at: new Date\(\)\.toISOString\(\)/,
    'the only writer of ingested_at is the server');
  assert.match(sync, /S\.sb\(cfg,\s*\n?\s*'\/strava_activities/,
    'and it uses the service key, which bypasses both RLS and column grants');
});

// ---------------------------------------------------------------------------
// 5. THE TWO MIGRATIONS ARE INERT, SEPARATE, AND POINT OPPOSITE WAYS
// ---------------------------------------------------------------------------
test('5. the beta hardening is off, reversible, and touches no policy', () => {
  assert.match(HARDEN, /_vvv_beta_hardening_authorised/);
  assert.match(HARDEN, /select 'no'::text/, 'off');
  assert.match(HARDEN, /raise exception[\s\S]{0,200}ABORTED/);
  const stmts = code(HARDEN);
  assert.ok(!/create policy|drop policy/.test(stmts),
    'row isolation is not what this changes, in either direction');
  assert.ok(!/drop (table|trigger|function)/.test(stmts), 'and nothing is removed');
  assert.match(stmts, /revoke execute on function public\.beta_email_approved\(text\) from authenticated/);
  assert.match(stmts, /grant\s+update \(ingested_at\) on public\.strava_activities to authenticated/);
  assert.match(HARDEN, /THE INVERSE[\s\S]*grant execute on function public\.beta_email_approved/,
    'the way back is written down');
});

test('5. the hardening does not quietly do commercial work', () => {
  const stmts = code(HARDEN);
  ['is_beta_approved()', 'beta_allowlist_gate', 'seed_entitlement_for_new_user', 'entitlements']
    .forEach(k => assert.ok(stmts.indexOf(k) === -1 || /grant execute on function public\.is_beta_approved/.test(stmts),
      'private-beta access control must not be dismantled here: ' + k));
  assert.ok(!/drop trigger/.test(stmts), 'no gate is lifted');
});

test('5. the commercial migration is off and stays a separate gate', () => {
  assert.match(COMMERCIAL, /select 'no'::text/, 'off');
  assert.match(COMMERCIAL, /raise exception[\s\S]{0,300}ABORTED/);
  /* The two files must not be confusable. This one lifts the beta; the other
     tightens it. */
  assert.match(code(COMMERCIAL), /drop trigger if exists beta_allowlist_gate/);
  assert.ok(!/beta_allowlist_gate/.test(code(HARDEN)),
    'and the beta-safe script must never contain that statement');
});

test('5. neither migration can switch a flag or configure a provider', () => {
  [['hardening', HARDEN], ['commercial', COMMERCIAL], ['verification', VERIFY]].forEach(([n, sql]) => {
    assert.ok(!/VVV_ACCOUNT_REQUIRED\s*=|VVV_COMMERCIAL_REQUIRED\s*=|alter system/i.test(sql),
      n + ': a flag lives in Vercel and cannot be set from SQL');
    assert.ok(!/sk_(live|test)_|whsec_|stripe|paddle|lemonsqueezy/i.test(sql),
      n + ': no payment provider is named or configured');
  });
});

test('5. and no existing tester loses access to either of them', () => {
  [['hardening', HARDEN], ['commercial', COMMERCIAL]].forEach(([n, sql]) => {
    const stmts = code(sql);
    assert.ok(!/delete from public\.entitlements/.test(stmts), n + ': no entitlement is deleted');
    assert.ok(!/update public\.entitlements[\s\S]{0,120}override\s*=\s*null/.test(stmts),
      n + ': no override is cleared');
    assert.ok(!/delete from public\.beta_allowlist|update public\.beta_allowlist/.test(stmts),
      n + ': the allowlist is not edited');
    assert.ok(!/delete from public\.plans|drop table/.test(stmts), n + ': no training is touched');
  });
});
