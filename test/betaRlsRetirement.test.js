'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const A = require('../api/_access.js');
const E = require('../api/_entitlement.js');
const Ck = require('../api/_checkout.js');
const Prod = require('../api/_products.js');

/* ROW AUTHORIZATION AFTER THE BETA
 * ===========================================================================
 * WHAT THIS FILE CAN AND CANNOT PROVE, said first because the difference
 * matters. There is no Postgres in this suite, so nothing here EXECUTES a
 * policy. What it holds is the migration's text and the app-side model around
 * it: that the predicates are ownership-only, that no policy was added or lost,
 * and that opening row access did not open product access. The runtime proof
 * that User A cannot read User B belongs to Postgres, and the assertion below
 * is that the predicate handed to Postgres is the one that makes that true.
 *
 * THE DEFECT. Five policies still read is_beta_approved(), which resolves the
 * caller's JWT email against beta_allowlist. A newly authenticated athlete who
 * was never in the beta could not read, create or update THEIR OWN plan: the
 * cloud push returned 403 and the app told them their private-beta access had
 * ended -- to somebody who had never been in a beta.
 */

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SQL = read('supabase-retire-beta-rls.sql');
/* Comments legitimately quote what they explain, so claims about statements
   are made against SQL with comments stripped. */
const stmts = SQL.replace(/^--.*$/gm, ' ');

const NOW = new Date('2026-09-01T09:00:00Z');
const UID = 'a1111111-1111-1111-1111-111111111111';
const LIVE = { accountRequired: true, commercialRequired: true };
const row = (o) => Object.assign({ state: 'expired', tier: 'standard', access_until: null,
  cancel_at_period_end: false, override: null, override_expires_at: null }, o || {});
const decide = (ent) => A.resolveAccess(Object.assign({ now: NOW, uid: UID, entitlement: ent }, LIVE));

/* Every `create policy` in the migration, as { name, cmd, using, check }. */
function policies(sql){
  const out = [];
  const re = /create policy\s+"([^"]+)"\s+on\s+([a-z_.]+)\s+for\s+(select|insert|update|delete)([\s\S]*?);/gi;
  let m;
  while ((m = re.exec(sql))){
    const body = m[4];
    const u = /using\s*\(([\s\S]*?)\)\s*(?:with check|$|;)/i.exec(body);
    const c = /with check\s*\(([\s\S]*?)\)\s*$/i.exec(body.trim());
    out.push({ name: m[1], table: m[2], cmd: m[3].toUpperCase(),
               using: u ? u[1] : null, check: c ? c[1] : null, body: body });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. THE BETA CLAUSE IS GONE, AND OWNERSHIP IS NOT
// ---------------------------------------------------------------------------

test('no created policy imposes beta membership', () => {
  const ps = policies(stmts);
  assert.equal(ps.length, 5, 'expected five policies, found ' + ps.length);
  ps.forEach((p) => assert.ok(!/beta/i.test(p.body),
    p.name + ' still imposes beta membership'));
});

test('every created policy still requires the caller to own the row', () => {
  /* THE ONE MISTAKE THIS MIGRATION COULD MAKE is dropping the ownership clause
     along with the beta clause, which would make the table public. Asserted per
     policy and per clause rather than by a whole-file grep, because a single
     policy losing it would be invisible to a file-level check. */
  policies(stmts).forEach((p) => {
    const clauses = [p.using, p.check].filter((x) => x !== null);
    assert.ok(clauses.length > 0, p.name + ' has neither USING nor WITH CHECK');
    clauses.forEach((c) => {
      assert.match(c, /auth\.uid\(\)/, p.name + ' no longer reads the caller identity');
      assert.match(c, /user_id/, p.name + ' no longer compares against the row owner');
      assert.match(c.replace(/\s+/g, ' '),
        /\(\s*select auth\.uid\(\)\s*\)\s*=\s*user_id/i,
        p.name + ' is not a plain ownership comparison: ' + c.trim());
    });
  });
});

test('SELECT/INSERT/UPDATE carry the clauses Postgres actually consults', () => {
  /* USING filters rows that already exist; WITH CHECK vets rows being written.
     An UPDATE needs both or an athlete could move a row to another owner; an
     INSERT has no rows to filter and takes WITH CHECK only. Getting this wrong
     is how "ownership enforced" quietly becomes "ownership enforced on read". */
  const by = {};
  policies(stmts).forEach((p) => { by[p.table + ':' + p.cmd] = p; });

  ['public.plans:SELECT', 'public.strava_activities:SELECT'].forEach((k) => {
    assert.ok(by[k].using, k + ' has no USING clause');
    assert.equal(by[k].check, null, k + ' has a WITH CHECK, which SELECT cannot use');
  });
  assert.ok(by['public.plans:INSERT'].check, 'INSERT has no WITH CHECK');
  assert.equal(by['public.plans:INSERT'].using, null, 'INSERT has a USING clause');
  ['public.plans:UPDATE', 'public.strava_activities:UPDATE'].forEach((k) => {
    assert.ok(by[k].using, k + ' has no USING clause');
    assert.ok(by[k].check, k + ' has no WITH CHECK: a row could be reassigned to another owner');
  });
});

test('anonymous callers are denied by the ownership clause itself', () => {
  /* auth.uid() is null for an anonymous caller, null = user_id is null, and a
     null predicate admits no rows. That is why the policies can stay TO PUBLIC
     exactly as they are now without exposing anything -- and why the migration
     deliberately does not start narrowing roles, which would be a second
     change with its own failure modes. */
  policies(stmts).forEach((p) => {
    assert.ok(!/\bto\s+(public|anon|authenticated)\b/i.test(p.body),
      p.name + ' changes the role list; that is not this migration’s job');
  });
  /* A phrase that sits on one line: the sentence wraps across a comment break,
     so matching the whole of it would fail on a reflow rather than on a
     behaviour change. */
  assert.match(SQL, /anonymous stays denied by the/,
    'the reasoning for leaving the roles alone is not written down');
});

// ---------------------------------------------------------------------------
// 2. NOTHING IS ADDED AND NOTHING IS LOST
// ---------------------------------------------------------------------------

test('the absent policies stay absent', () => {
  /* plans has no DELETE and strava_activities has no INSERT, so those stay
     denied to every browser role. A migration that "tidied up" by adding them
     would hand the client two abilities it has never had. */
  const ps = policies(stmts);
  assert.equal(ps.filter((p) => p.table === 'public.plans' && p.cmd === 'DELETE').length, 0);
  assert.equal(ps.filter((p) => p.table === 'public.strava_activities' && p.cmd === 'INSERT').length, 0);
  assert.equal(ps.filter((p) => p.table === 'public.plans').length, 3);
  assert.equal(ps.filter((p) => p.table === 'public.strava_activities').length, 2);
  /* And the verification block fails if the live counts drift. */
  assert.match(SQL, /plans has % policies, expected 3/);
  assert.match(SQL, /strava_activities has % policies, expected 2/);
  assert.match(SQL, /a DELETE policy was added to plans/);
  assert.match(SQL, /an INSERT policy was added to strava_activities/);
});

test('the token table is not touched and stays unreachable', () => {
  assert.ok(!/create policy[^;]*strava_connections/i.test(stmts),
    'a policy was added to strava_connections, exposing OAuth tokens to sessions');
  assert.match(SQL, /strava_connections gained % policies/,
    'the migration does not verify that strava_connections stays deny-all');
});

test('no table outside the two named is altered', () => {
  const touched = (stmts.match(/on\s+public\.([a-z_]+)/gi) || [])
    .map((s) => s.replace(/.*public\./i, '').toLowerCase());
  const unique = Array.from(new Set(touched)).sort();
  assert.deepEqual(unique, ['plans', 'strava_activities']);
  /* Entitlement tables in particular: this migration decides who owns a row,
     never who may use the product. */
  ['entitlements', 'entitlement_grants', 'account_commercial', 'subscriptions',
   'billing_events', 'account_agreements', 'beta_allowlist'
  ].forEach((t) => assert.ok(!new RegExp('(insert into|update|delete from|alter table)\\s+public\\.' + t, 'i').test(stmts),
    'the migration writes to ' + t));
});

test('it replays no commercial history', () => {
  /* The cutover and the projection have already run against this database.
     Re-running their work would rewrite commercial state that is now correct. */
  ['drop trigger', 'create trigger', 'grandfathered-beta', 'admin_comp', 'admin_beta',
   'auth.users', 'trial_consumed_at'
  ].forEach((s) => assert.ok(stmts.toLowerCase().indexOf(s.toLowerCase()) === -1,
    'the migration replays commercial cutover work: ' + s));
});

test('it is transactional and idempotent', () => {
  assert.match(SQL, /^begin;/m);
  assert.match(SQL, /^commit;/m);
  const drops = (stmts.match(/drop policy if exists/gi) || []).length;
  assert.equal(drops, 5, 'every policy must be dropped-if-exists before creation');
  assert.ok(SQL.indexOf('\nbegin;') < SQL.indexOf('drop policy'),
    'policies are dropped outside the transaction');
  /* And it refuses to run against a shape it was not written for. */
  assert.match(SQL, /refusing: RLS is not enabled on public\.plans/);
  assert.match(SQL, /refusing: RLS is not enabled on public\.strava_activities/);
});

test('the policy statements are exactly activation STEP 3, and nothing else from that file', () => {
  /* The correction has an approved form already: STEP 3 of
     supabase-commercial-activation.sql. This asserts the surgical migration
     reproduces those statements verbatim, so "surgical" is checkable rather
     than claimed -- and that it brings none of that file's other steps. */
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const activation = read('supabase-commercial-activation.sql');
  /* BOTH headings appear more than once -- in the file's header summary, in the
     step bodies, and in a closing note. The first index of each is the wrong
     boundary (an early attempt sliced an empty range and compared nothing
     against nothing), and so is the last. The step body is the first 'STEP 3'
     that actually has a 'STEP 4' after it. */
  let s3at = -1, s4at = -1;
  for (let i = activation.indexOf('STEP 3'); i > -1; i = activation.indexOf('STEP 3', i + 1)){
    const j = activation.indexOf('STEP 4', i);
    if (j > i){ s3at = i; s4at = j; break; }
  }
  assert.ok(s3at > 0 && s4at > s3at, 'the activation file’s STEP 3 could not be located');
  const step3 = activation.slice(s3at, s4at);
  const want = (step3.match(/^(create|drop) policy[\s\S]*?;/gim) || []).map(norm);
  const got = (stmts.match(/^(create|drop) policy[\s\S]*?;/gim) || []).map(norm);
  assert.deepEqual(got, want, 'the surgical migration diverges from approved STEP 3');
  assert.ok(want.length > 0, 'STEP 3 could not be located in the activation file');
});

// ---------------------------------------------------------------------------
// 3. OPENING ROW ACCESS DID NOT OPEN PRODUCT ACCESS
// ---------------------------------------------------------------------------

test('owning your rows is not being allowed through the door', () => {
  /* The separation this migration must not blur. Row authorization says which
     rows are yours; resolveAccess() says whether you may use Valhalla. */
  assert.equal(decide(null).allow, false);
  assert.equal(decide(null).reason, 'no_entitlement');
  assert.equal(decide(row({})).allow, false);
});

test('owner and the grandfathered cohort are unchanged', () => {
  assert.equal(decide(row({ override: 'owner' })).reason, 'override_owner');
  assert.equal(decide(row({ override: 'promo' })).reason, 'override_promo');
  assert.deepEqual(A.ACCESS_OVERRIDES.slice().sort(), ['owner', 'promo']);
});

test('admin_beta stays retired', () => {
  assert.equal(E.grantAccess({ id: 'g', account_id: UID, source: 'admin_beta',
    product_code: Prod.STANDARD, expires_at: null, revoked_at: null }, NOW).active, false);
  assert.equal(decide(row({ override: 'beta' })).allow, false);
});

test('UK-only checkout, prices and trial are untouched', () => {
  const ok = (o) => Object.assign({ commerceEnabled: true, commercialRequired: true,
    stripeConfigured: true, isLiveKey: true, uid: UID, country: 'GB', period: 'monthly',
    purchaseCheck: { allowed: true, reason: 'ok' },
    evidence: { ok: true, terms: true, immediateStart: true, published: true },
    now: NOW }, o || {});
  assert.equal(Ck.decideCheckout(ok()).ok, true);
  assert.equal(Ck.decideCheckout(ok({ country: 'US' })).code, 'country_not_supported');
  assert.equal(Prod.offer('STANDARD_MONTHLY').priceMinor, 1199);
  assert.equal(Prod.offer('STANDARD_YEARLY').priceMinor, 8999);
  assert.equal(Prod.offer('STANDARD_MONTHLY').trialDays, 14);
});

test('the beta predicates are left installed, and nothing authorises on them', () => {
  /* Kept so the beta's history stays inspectable and re-closing signup does not
     need a function rebuilt from git -- but no policy may consult them. */
  assert.ok(!/drop function[^;]*is_beta_approved/i.test(stmts));
  assert.ok(!/drop function[^;]*beta_email_approved/i.test(stmts));
  assert.match(SQL, /% policies still impose beta membership/,
    'the migration does not verify that no policy retains the beta clause');
});
