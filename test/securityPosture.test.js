'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// THE SECURITY POSTURE THIS DATABASE IS SUPPOSED TO HAVE.
//
// Every claim below was checked on a disposable Postgres 16 cluster built from
// the repository migrations in order, with the Supabase substrate around them
// -- the auth schema, auth.uid(), auth.jwt(), the three browser roles, and the
// default table grants that make ROW-LEVEL SECURITY the thing that decides
// rather than a missing GRANT. A proof run as superuser proves nothing about
// RLS, and a proof against a cluster where `authenticated` holds no table
// grants proves the wrong refusal.
//
// These tests guard the SOURCE against drifting away from what was proven.

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* Executable statements only. These files explain the rules at length and
   legitimately contain the words a violation would. */
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, ' ')
                           .split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

const POSTURE = 'supabase-security-posture.sql';

// ===========================================================================
// RLS PERFORMANCE -- THE INIT-PLAN REWRITE
// ===========================================================================
test('no policy calls auth.uid() once per row', () => {
  // A bare auth.uid() in a policy is evaluated per row; wrapped in a scalar
  // sub-select it is an InitPlan evaluated once per statement. Same rows, same
  // permissions -- auth.uid() is STABLE, takes no arguments and reads nothing
  // from the row, so it cannot differ between rows of one statement.
  const files = fs.readdirSync(ROOT).filter(f => /^supabase-.*\.sql$/.test(f));
  const offenders = [];
  for (const f of files){
    for (const line of code(f).split('\n')){
      if (!/\b(using|with check)\s*\(/.test(line)) continue;
      if (/(^|[^(]\s*)auth\.uid\(\)/.test(line.replace(/\(\s*select\s+auth\.uid\(\)\s*\)/g, 'HOISTED'))){
        offenders.push(f + ': ' + line.trim());
      }
    }
  }
  assert.deepEqual(offenders, [], 'these policy clauses evaluate auth.uid() per row');
});

test('the beta predicate is hoisted for the same reason, and by the same rule', () => {
  // is_beta_approved() is STABLE, takes no arguments and reads the caller's own
  // JWT claim. Hoisting something that DID depend on the row would be wrong,
  // and there is nothing of that kind in any policy.
  const gate = code('supabase-beta-gate.sql');
  const clauses = gate.split('\n').filter(l => /\b(using|with check)\s*\(/.test(l));
  assert.ok(clauses.length >= 5, 'the live policies must still be here');
  for (const c of clauses){
    if (!/is_beta_approved/.test(c)) continue;
    assert.match(c, /\(select public\.is_beta_approved\(\)\)/, c.trim());
  }
});

test('the beta gate is not removed as a side effect of a performance fix', () => {
  // Dropping the predicate would open the private beta. The file that removes
  // it is supabase-commercial-activation.sql, deliberately, on the day HQ opens
  // the gate -- and that file is NOT in the apply order.
  const gate = code('supabase-beta-gate.sql');
  assert.match(gate, /is_beta_approved/);
  const posture = code(POSTURE);
  assert.match(posture, /has_gate/,
    'the posture file must branch on the gate being present, not assume it away');
  const order = read('SUPABASE-MIGRATIONS.md');
  const table = order.slice(order.indexOf('| # | File'), order.indexOf('## Deployment parameters'));
  assert.equal(table.indexOf('supabase-commercial-activation.sql'), -1,
    'the file that opens the gate must never be in the apply order');
});

// ===========================================================================
// THE SERVICE-ONLY TABLES
// ===========================================================================
const SERVICE_ONLY = ['access_leases', 'beta_allowlist', 'billing_events', 'strava_connections'];

test('four tables run RLS with no policies, which is deny-all and is the design', () => {
  // Proven on the disposable cluster: a correctly signed-in, allowlisted
  // athlete reads zero rows from all four. Only the service key reaches them.
  const all = fs.readdirSync(ROOT).filter(f => /^supabase-.*\.sql$/.test(f))
    .map(f => ({ f, src: code(f) }));
  for (const t of SERVICE_ONLY){
    const enabled = all.some(x => new RegExp('alter table public\\.' + t + ' enable row level security').test(x.src));
    assert.ok(enabled, t + ' never has row-level security switched on');
    for (const x of all){
      // commercial-activation is the deliberate future widening and is not applied.
      if (x.f === 'supabase-commercial-activation.sql') continue;
      const re = new RegExp('create policy[^;]*on public\\.' + t + '\\b', 'i');
      assert.equal(re.test(x.src), false,
        x.f + ' adds a client policy to ' + t + ', which is a widening, not a lint fix');
    }
  }
});

test('the posture file refuses if somebody adds a policy to silence the advisor', () => {
  const src = read(POSTURE);
  for (const t of SERVICE_ONLY) assert.match(src, new RegExp("'" + t + "'"));
  assert.match(src, /a client policy exists on a service-only table/);
  assert.match(src, /Nothing has been changed/);
});

// ===========================================================================
// THE SECURITY DEFINER FUNCTIONS
// ===========================================================================
test('every SECURITY DEFINER function pins its search path', () => {
  const files = fs.readdirSync(ROOT).filter(f => /^supabase-.*\.sql$/.test(f));
  const unpinned = [];
  for (const f of files){
    const src = code(f);
    const re = /create (?:or replace )?function\s+([\w.]+)\s*\(([^)]*)\)([\s\S]*?)\bas\s+\$/gi;
    let m;
    while ((m = re.exec(src))){
      const head = m[3];
      if (!/security definer/i.test(head)) continue;
      if (!/set\s+search_path\s*=/i.test(head)) unpinned.push(f + ': ' + m[1]);
    }
  }
  assert.deepEqual(unpinned, [], 'a definer function with a mutable search path is the classic hijack');
});

test('the empty search path is stricter than naming schemas, and is used', () => {
  // pg_catalog is searched implicitly and FIRST unless it is named -- so
  // `search_path = public, pg_catalog` is WEAKER than `search_path = public`,
  // because naming it later lets a table in public shadow a builtin. An empty
  // path leaves only the implicit pg_catalog entry and resolves nothing else.
  // Both function bodies qualify every object they touch, so nothing is left to
  // resolve by search. Proven by applying it and calling them.
  const src = read(POSTURE);
  for (const fn of ['delete_own_account', 'is_beta_approved', 'beta_email_approved']){
    assert.match(src, new RegExp('alter function public\\.' + fn + '\\([^)]*\\) set search_path'),
      fn + ' is not pinned by the posture file');
  }
  assert.match(src, /searched implicitly, and FIRST, unless it is named/,
    'the reasoning must be written down, because it is the opposite of the obvious reading');
});

test('delete_own_account can only ever delete the caller', () => {
  // Proven on the cluster: anon cannot execute it at all; a session with no uid
  // raises "not authenticated" and deletes nothing; a signed-in athlete deletes
  // themselves and nobody else.
  const src = code('supabase-setup.sql');
  const fn = src.slice(src.indexOf('create or replace function public.delete_own_account'),
                       src.indexOf('revoke all on function public.delete_own_account'));
  assert.match(fn, /if auth\.uid\(\) is null then/, 'no session must refuse, not delete nothing quietly');
  assert.match(fn, /raise exception 'not authenticated'/);
  // Every statement in the body is scoped to auth.uid(). No parameter exists to
  // point it at somebody else -- the function takes none.
  assert.match(fn, /create or replace function public\.delete_own_account\(\)/,
    'it must take no arguments at all');
  const statements = fn.split('\n').filter(l => /^\s*delete from/.test(l));
  assert.ok(statements.length >= 1);
  for (const st of statements){
    assert.match(st, /= auth\.uid\(\)/, 'a delete not scoped to the caller: ' + st.trim());
  }
  assert.match(src, /revoke all on function public\.delete_own_account\(\) from public, anon/);
  assert.match(src, /grant execute on function public\.delete_own_account\(\) to authenticated/);
});

test('is_beta_approved is retained, and the reason is that signup is closed', () => {
  // "Is it still required" has a checkable answer: it is the predicate inside
  // the live row-level policies, and a policy expression is evaluated with the
  // CALLER's privileges -- so revoking it from `authenticated` would make every
  // signed-in read and write fail. It is a load-bearing grant, not a leftover.
  const gate = code('supabase-beta-gate.sql');
  assert.match(gate, /grant execute on function public\.is_beta_approved\(\) to authenticated/);
  assert.match(code(POSTURE), /grant execute on function public\.is_beta_approved\(\) to authenticated/);
  // And the posture file checks the thing that would actually break.
  assert.match(read(POSTURE), /authenticated can no longer evaluate the RLS predicate/);
});

test('the membership oracle stays shut to signed-in callers', () => {
  // beta_email_approved(addr) answers "is this address invited" for any address
  // the caller names. is_beta_approved() calls it across the definer boundary,
  // so closing it to `authenticated` cannot break the policies.
  assert.match(code(POSTURE),
    /revoke all on function public\.beta_email_approved\(text\) from public, anon, authenticated/);
});

// ===========================================================================
// REPRODUCIBILITY
// ===========================================================================
test('a fresh database asserts RLS everywhere without needing the event trigger', () => {
  // The gap was that supabase-pre-beta-least-privilege.sql revokes EXECUTE on
  // public.rls_auto_enable(), a function created by hand in production whose
  // definition was never in this repository -- so a rebuild could not run that
  // migration and the repository could not reproduce production.
  const src = read(POSTURE);
  assert.match(src, /create or replace function public\.rls_auto_enable\(\)/,
    'the helper definition must exist in the repository now');
  assert.match(src, /returns event_trigger/);
  assert.match(src, /create event trigger ensure_rls on ddl_command_end/);
  // But the guarantee does not rest on it: creating an event trigger needs
  // superuser, which a managed Postgres may refuse.
  assert.match(src, /insufficient_privilege/, 'a refused install must be reported, not fatal');
  assert.match(src, /these public tables have row-level security OFF/,
    'the assertion is what actually guarantees the posture');
});

test('the apply order names every file, in the order it was proven in', () => {
  const full = read('SUPABASE-MIGRATIONS.md');
  const doc = full.slice(full.indexOf('| # | File'), full.indexOf('## Deployment parameters'));
  const order = ['supabase-setup.sql', 'supabase-beta-gate.sql', 'supabase-entitlement.sql',
                 'supabase-commercial-core.sql', 'supabase-retire-legacy-beta-autogrant.sql',
                 'supabase-trial-grant-source.sql', 'supabase-account-activity.sql',
                 'supabase-trial-via-provider.sql',
                 'supabase-operational-view-provider-trial.sql',
                 'supabase-security-posture.sql'];
  let at = -1;
  for (const f of order){
    const i = doc.indexOf(f);
    assert.ok(i > at, f + ' must appear after the file it depends on');
    at = i;
  }
});

test('the known gap is recorded as closed rather than quietly deleted', () => {
  const doc = read('SUPABASE-MIGRATIONS.md');
  assert.match(doc, /rls_auto_enable/,
    'a gap that is closed should still say what it was, or the next person rediscovers it');
});

// ===========================================================================
// WHAT WAS DELIBERATELY NOT DONE
// ===========================================================================
test('no index is dropped on the evidence of an empty table', () => {
  const files = fs.readdirSync(ROOT).filter(f => /^supabase-.*\.sql$/.test(f));
  for (const f of files){
    assert.equal(/drop index/i.test(code(f)), false, f + ' drops an index');
  }
});

test('no password path is invented to clear a warning about passwords', () => {
  // The application signs in with a magic link. Adding a password UX to satisfy
  // a leaked-password lint would be adding an attack surface to clear a warning
  // about an attack surface.
  const posture = read(POSTURE);
  assert.match(posture, /auth_leaked_password_protection/);
  assert.match(posture, /no password path/);
  const api = fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js'));
  for (const f of api){
    const src = read(path.join('api', f)).replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
    assert.equal(/signInWithPassword|\bpassword\s*:/i.test(src), false,
      'api/' + f + ' introduces a password path');
  }
});
