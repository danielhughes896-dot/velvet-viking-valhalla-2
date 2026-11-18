'use strict';
// PUBLIC SIGN-UP, AS A SWITCH (founder, 18 November 2026: "It's on Vercel so
// only I can send it to people. So make it as if it's ready to go.").
//
// Sign-up works for anyone who reaches the app while the database's switch is
// on, and is invitation only (the beta allowlist) while it is off. These tests
// hold both halves:
//   * the migration: new file, idempotent, keeps the trigger, seeds the switch
//     to what the database already does, grants nothing -- and, where
//     Postgres is installed, proved by acting as real people;
//   * the server: the route never reads the allowlist; with the switch off the
//     database's refusal is the private-beta sentence, with it on an uninvited
//     address gets a link, and Apple and Google start the same way;
//   * access: a brand-new account gets into the app after the journey while
//     commerce is off, and is held at the seven-day trial while it is on;
//   * the words: no "private beta" on the journey, sign-in or account surfaces
//     while the switch is on, and today's wording while it is off.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');
const A = require('../api/_access.js');
const S = require('../api/_strava.js');
const Signup = require('../api/_signup.js');
const Prod = require('../api/_products.js');
const Agree = require('../api/_agreements.js');
const SIGNIN = require('../api/beta-signin.js');
const sessionHandler = require('../api/session.js');
const appHandler = require('../api/app.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const RUNTIME = read(RUNTIME_RELATIVE);
const SQL = read('supabase-public-signup.sql');
/* Claims about statements are made with comments stripped: the header quotes
   the ON, OFF and ROLL BACK statements so the operator can copy them, and
   those must not count as things the file does. */
const STMTS = SQL.replace(/--.*$/gm, ' ');
const PINNED = '2026-11-18T09:00:00Z';

function mockRes(){
  return {
    headers: {}, statusCode: null, body: null,
    setHeader(k, v){ this.headers[String(k).toLowerCase()] = v; },
    getHeader(k){ return this.headers[String(k).toLowerCase()]; },
    status(code){ this.statusCode = code; return this; },
    send(body){ this.body = body; if (this.statusCode == null) this.statusCode = 200; return this; },
    end(b){ if (b) this.body = b; if (this.statusCode == null) this.statusCode = 200; return this; },
    json(){ return JSON.parse(this.body); }
  };
}
async function withPatched(mod, patches, fn){
  const saved = {};
  Object.keys(patches).forEach(k => { saved[k] = mod[k]; mod[k] = patches[k]; });
  try { return await fn(); } finally { Object.keys(saved).forEach(k => { mod[k] = saved[k]; }); }
}
function setEnv(vars){
  const saved = {};
  Object.keys(vars).forEach(k => { saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; });
  return () => Object.keys(saved).forEach(k => {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
}
const CFG = { serviceKey: 'svc', serviceKeySource: 'test', anonKey: 'anon', supabaseUrl: 'https://proj.supabase.co' };
const OFF_FLAGS = { VVV_COMMERCE_ENABLED: undefined, VVV_COMMERCIAL_REQUIRED: undefined };

/* A Supabase that answers the switch read with `sw` (true, false, or a status
   for a failed read) and GoTrue's /otp with `otp`. Every request is recorded. */
function fakeSupabase(sw, otp){
  const calls = [];
  const fn = async (url, opts) => {
    const u = String(url), method = (opts && opts.method) || 'GET';
    calls.push({ url: u, method, body: opts && opts.body });
    if (/\/rest\/v1\/signup_settings\?/.test(u)){
      if (typeof sw === 'number') return { ok: false, status: sw, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => (sw === undefined ? [] : [{ public_signup: sw }]) };
    }
    if (/\/auth\/v1\/otp/.test(u)) return { ok: otp.status === 200, status: otp.status, json: async () => (otp.body || {}) };
    throw new Error('unexpected request: ' + method + ' ' + u);
  };
  return { fn, calls };
}
async function signin(req, sw, otp){
  const sb = fakeSupabase(sw, otp || { status: 200 });
  const realFetch = globalThis.fetch;
  globalThis.fetch = sb.fn;
  try {
    return await withPatched(S, { config: () => CFG }, async () => {
      const res = mockRes();
      await SIGNIN(Object.assign({ headers: { host: 'app.velvetviking.co.uk' } }, req), res);
      return { res, calls: sb.calls };
    });
  } finally { globalThis.fetch = realFetch; }
}
/* What GoTrue says when the BEFORE INSERT trigger refuses the new account. */
const DB_REFUSAL = { status: 500, body: { code: 500, error_code: 'unexpected_failure', msg: 'Database error saving new user' } };

// ===========================================================================
// 1. THE MIGRATION
// ===========================================================================
test('the switch is a new migration file; no already-applied file was edited to make it', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'supabase-public-signup.sql')));
  /* The gate as supabase-beta-gate.sql installed it is still exactly that. */
  const gate = read('supabase-beta-gate.sql');
  assert.match(gate, /if not public\.beta_email_approved\(new\.email\) then\s+raise exception 'velvet_viking_private_beta: address not authorised'/);
  assert.doesNotMatch(gate, /public_signup|signup_settings/);
  ['supabase-commercial-cutover.sql', 'supabase-commercial-activation.sql', 'supabase-retire-beta-rls.sql',
   'supabase-security-posture.sql', 'supabase-entitlement.sql', 'supabase-commercial-core.sql']
    .forEach(f => assert.doesNotMatch(read(f), /public_signup|signup_settings/, f + ' was edited for the switch'));
});

test('the header says what it does, how to turn it on and off, how to verify and how to roll back', () => {
  const head = SQL.slice(0, SQL.indexOf('\nbegin;'));
  assert.match(head, /Founder, 18 November 2026: "It's on Vercel so only I can send it to people/);
  ['WHAT THIS FILE CHANGES', 'WHAT THIS FILE DOES NOT DO', 'IDEMPOTENT', 'TURN IT ON', 'TURN IT BACK OFF', 'VERIFY', 'ROLL BACK']
    .forEach(h => assert.ok(head.indexOf(h) !== -1, 'the header has no ' + h + ' section'));
  assert.match(head, /update public\.signup_settings\s+--\s+set public_signup = true/);
  assert.match(head, /update public\.signup_settings\s+--\s+set public_signup = false/);
  assert.match(head, /tools\/db-proof\/full-chain\.sh tools\/db-proof\/public-signup-proof\.sql/);
});

test('it is idempotent: every statement is safe to run twice, and a second run never moves the switch', () => {
  assert.match(STMTS, /create table if not exists public\.signup_settings/);
  assert.match(STMTS, /id\s+smallint\s+primary key default 1 check \(id = 1\)/, 'more than one switch row is possible');
  assert.match(STMTS, /public_signup boolean\s+not null default false/, 'a missing value would not read as closed');
  /* the seed never overwrites */
  const seed = /insert into public\.signup_settings[^;]*;/.exec(STMTS)[0];
  assert.match(seed, /on conflict \(id\) do nothing/);
  /* no executable statement turns it */
  assert.doesNotMatch(STMTS, /update\s+public\.signup_settings/i, 'running the file turns the switch');
  (STMTS.match(/create\s+(or replace\s+)?function\s+[a-z_.]+/gi) || [])
    .forEach(f => assert.match(f, /or replace/i, f + ' is not re-runnable'));
  (STMTS.match(/create trigger\s+\w+/gi) || []).forEach(t => {
    const name = t.split(/\s+/).pop();
    assert.ok(new RegExp('drop trigger if exists ' + name + ' on auth\\.users;\\s*create trigger ' + name).test(STMTS),
      name + ' is created without dropping it first');
  });
  assert.match(STMTS, /^begin;/m); assert.match(STMTS, /^commit;/m);
});

test('it keeps the trigger, and the trigger consults the switch before the allowlist', () => {
  assert.match(STMTS, /create trigger beta_allowlist_gate\s+before insert on auth\.users\s+for each row execute function public\.enforce_beta_allowlist\(\);/);
  assert.equal((STMTS.match(/drop trigger/g) || []).length, 1, 'a trigger is dropped and not put back');
  const fn = /create or replace function public\.enforce_beta_allowlist\(\)[^]*?\$\$;/.exec(STMTS)[0];
  assert.ok(fn.indexOf('public.public_signup_open()') < fn.indexOf('public.beta_email_approved(new.email)'),
    'the allowlist is asked before the switch');
  assert.match(fn, /if public\.public_signup_open\(\) then\s+return new;/);
  assert.match(fn, /raise exception 'velvet_viking_private_beta: address not authorised'\s+using errcode = '42501'/,
    'the refusal lost its words or its errcode, so GoTrue and the app would no longer recognise it');
  assert.match(fn, /security definer\s+set search_path = ''/);
});

test('the switch reads closed unless the row says open, and is nobody\'s to read or turn but the SQL editor\'s', () => {
  const fn = /create or replace function public\.public_signup_open\(\)[^]*?\$\$;/.exec(STMTS)[0];
  assert.match(fn, /coalesce\(\(select s\.public_signup from public\.signup_settings s where s\.id = 1\), false\)/);
  assert.match(fn, /security definer\s+set search_path = ''/);
  assert.match(STMTS, /alter table public\.signup_settings enable row level security;/);
  assert.doesNotMatch(STMTS, /create policy/i, 'a policy was added');
  assert.match(STMTS, /revoke all on table public\.signup_settings from public, anon, authenticated, service_role;\s*grant select on table public\.signup_settings to service_role;/);
  assert.match(STMTS, /revoke all on function public\.public_signup_open\(\) from public, anon, authenticated;/);
  assert.doesNotMatch(STMTS, /grant [^;]* to (anon|public)\b/i, 'something was granted to the anonymous key');
});

test('it seeds the switch to what the database already does, so applying it opens and closes nothing', () => {
  const seed = /insert into public\.signup_settings[^;]*;/.exec(STMTS)[0];
  assert.match(seed, /not exists \(\s*select 1 from pg_trigger[^]*t\.tgname = 'beta_allowlist_gate'/);
  assert.ok(STMTS.indexOf('insert into public.signup_settings') < STMTS.indexOf('create trigger beta_allowlist_gate'),
    'the seed reads the trigger after this file has re-attached it');
});

test('row access follows the switch through the predicate, and ownership is untouched', () => {
  const fn = /create or replace function public\.is_beta_approved\(\)[^]*?\$\$;/.exec(STMTS)[0];
  assert.match(fn, /select public\.public_signup_open\(\)\s+or public\.beta_email_approved\(coalesce\(auth\.jwt\(\) ->> 'email', ''\)\)/);
  assert.match(STMTS, /grant execute on function public\.is_beta_approved\(\) to authenticated;/,
    'authenticated lost the predicate every signed-in read depends on');
  assert.doesNotMatch(STMTS, /(drop|create|alter) policy/i, 'a row-level policy was changed');
});

test('it grants nothing: no entitlement, grant, subscription or trial is written', () => {
  ['entitlements', 'entitlement_grants', 'subscriptions', 'account_commercial', 'access_leases'].forEach(t =>
    assert.doesNotMatch(STMTS, new RegExp('(insert into|update|delete from)\\s+public\\.' + t + '\\b', 'i'), 'the migration writes ' + t));
  assert.doesNotMatch(STMTS, /(insert into|update|delete from)\s+public\.beta_allowlist/i, 'the allowlist rows were touched');
  assert.doesNotMatch(STMTS, /drop (function|table)/i, 'something was removed');
});

test('it ends with the read-only verification, every column naming the value that is right', () => {
  /* quoted privilege names ('UPDATE') are what is being asked about, not done */
  const verify = STMTS.slice(STMTS.lastIndexOf('commit;')).replace(/'[^']*'/g, "''");
  assert.doesNotMatch(verify, /\b(insert|update|delete|create|drop|alter|grant|revoke)\b/i, 'the verification changes something');
  ['gate_trigger_attached_expect_true', 'gate_reads_switch_expect_true', 'rls_predicate_reads_switch_expect_true',
   'settings_rls_on_expect_true', 'settings_policies_expect_0', 'browser_can_read_switch_expect_false',
   'browser_can_call_switch_expect_false', 'server_key_can_change_switch_expect_false',
   'commercial_seed_intact_expect_true', 'public_signup', 'beta_predicate_policies']
    .forEach(c => assert.ok(verify.indexOf(c) !== -1, 'the verification does not report ' + c));
});

test('it is in the documented order and in the full rebuild', () => {
  assert.match(read('SUPABASE-MIGRATIONS.md'), /\| 14 \| `supabase-public-signup\.sql` \|/);
  assert.match(read('tools/db-proof/full-chain.sh'), /supabase-public-signup\.sql supabase-security-posture\.sql/);
});

/* THE PROOF ITSELF, on a throwaway Postgres: the whole schema in order, this
   file twice, then Ivy (invited), Una (not) and the anonymous key try every
   thing the switch forbids, with it off, on, and off again. Skipped where
   Postgres is not installed. */
const pgBin = (() => {
  try {
    return fs.readdirSync('/usr/lib/postgresql').map(v => '/usr/lib/postgresql/' + v + '/bin/initdb')
      .find(p => fs.existsSync(p)) || null;
  } catch(e){ return null; }
})();
test('the switch holds when real people try it, off, on and off again', { skip: !pgBin && 'Postgres is not installed here' }, () => {
  const out = execFileSync('bash', [path.join(ROOT, 'tools/db-proof/full-chain.sh'), 'tools/db-proof/public-signup-proof.sql'],
    { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', timeout: 180000 });
  assert.match(out, /ALL SIGN-UP SWITCH RULES HELD/);
});

// ===========================================================================
// 2. THE SERVER
// ===========================================================================
test('the switch reader: true, false, or null when it cannot be read; never a guess', async () => {
  const sbFrom = (r) => ({ sb: async () => r });
  const rows = (v) => ({ ok: true, json: async () => v });
  assert.equal(await Signup.readPublicSignup(sbFrom(rows([{ public_signup: true }])), CFG), true);
  assert.equal(await Signup.readPublicSignup(sbFrom(rows([{ public_signup: false }])), CFG), false);
  assert.equal(await Signup.readPublicSignup(sbFrom(rows([])), CFG), null, 'a missing row read as a value');
  assert.equal(await Signup.readPublicSignup(sbFrom(rows([{ public_signup: 'yes' }])), CFG), null);
  assert.equal(await Signup.readPublicSignup(sbFrom({ ok: false, status: 404 }), CFG), null, 'the table not existing yet read as a value');
  assert.equal(await Signup.readPublicSignup({ sb: async () => { throw new Error('down'); } }, CFG), null);
  let asked = false;
  assert.equal(await Signup.readPublicSignup({ sb: async () => { asked = true; } }, { serviceKey: '' }), null);
  assert.equal(asked, false, 'the switch was read with no service key');
  assert.equal(Signup.isNewUserRefusal(DB_REFUSAL.body), true);
  assert.equal(Signup.isNewUserRefusal({ error_description: 'Database error saving new user' }), true);
  assert.equal(Signup.isNewUserRefusal({ msg: 'Email rate limit exceeded' }), false);
});

test('GET /api/beta-signin says which way the switch stands, and nothing about anybody', async () => {
  for (const [sw, want] of [[true, true], [false, false], [503, null]]){
    const { res, calls } = await signin({ method: 'GET' }, sw);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().public_signup, want);
    calls.forEach(c => assert.match(c.url, /\/rest\/v1\/signup_settings\?select=public_signup&id=eq\.1&limit=1$/));
    calls.forEach(c => assert.equal(c.method, 'GET'));
  }
});

test('switch OFF: an uninvited address is refused by the database and told it is a private beta', async () => {
  for (const sw of [false, undefined, 503]){   // off, the row missing, the read failing
    const { res, calls } = await signin({ method: 'POST', body: { email: 'new@runner.test', redirect: 'https://app.velvetviking.co.uk/' } }, sw, DB_REFUSAL);
    assert.equal(res.statusCode, 403, 'switch ' + sw + ': ' + res.body);
    assert.deepEqual(res.json(), { error: 'not_in_beta' });
    assert.doesNotMatch(res.body, /Database error|saving new user/, 'the provider\'s words reached the browser');
    calls.forEach(c => assert.doesNotMatch(c.url, /beta_allowlist|beta_email_approved/, 'the route read the allowlist'));
  }
  /* and the app says the sentence it always said */
  const a = loadApp({ pinnedDate: PINNED });
  assert.match(a.signInErrorCopy('not_in_beta'), /SACORO is in private beta\. This email address is not on the tester list yet/);
});

test('switch ON: an uninvited address is sent a link, and the route asks no list', async () => {
  const { res, calls } = await signin({ method: 'POST', body: { email: 'new@runner.test', redirect: 'https://app.velvetviking.co.uk/' } }, true, { status: 200 });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { sent: true });
  assert.equal(calls.length, 1, 'the route asked something before sending the link');
  assert.match(calls[0].url, /^https:\/\/proj\.supabase\.co\/auth\/v1\/otp\?redirect_to=/);
  assert.deepEqual(JSON.parse(calls[0].body), { email: 'new@runner.test', create_user: true }, 'the link does not create the account');
});

test('switch ON: the same database words are not the gate any more, and are not called a private beta', async () => {
  const { res } = await signin({ method: 'POST', body: { email: 'new@runner.test' } }, true, DB_REFUSAL);
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.json(), { error: 'send_failed', reason: 'provider_error' });
});

test('every other protection on the route is unchanged by the switch', async () => {
  /* rate limits are still reported as rate limits */
  let r = await signin({ method: 'POST', body: { email: 'new@runner.test' } }, true, { status: 429, body: { msg: 'rate limited' } });
  assert.deepEqual(r.res.json(), { error: 'send_failed', reason: 'rate_limited' });
  /* an attacker's redirect still never reaches GoTrue */
  r = await signin({ method: 'POST', body: { email: 'new@runner.test', redirect: 'https://evil.example/steal' } }, true, { status: 200 });
  assert.equal(decodeURIComponent(r.calls[0].url.split('redirect_to=')[1]), 'https://app.velvetviking.co.uk/start');
  /* no password anywhere */
  assert.doesNotMatch(read('api/beta-signin.js') + read('api/_signup.js'), /grant_type=password|"password"|'password'/);
  /* Apple and Google: still off until named, and when named they start with a validated redirect and no list */
  let restore = setEnv({ VVV_AUTH_PROVIDERS: undefined });
  try {
    r = await signin({ method: 'POST', body: { provider: 'google', redirect: '/' } }, true);
    assert.equal(r.res.statusCode, 404);
  } finally { restore(); }
  restore = setEnv({ VVV_AUTH_PROVIDERS: 'apple,google' });
  try {
    r = await signin({ method: 'POST', body: { provider: 'apple', redirect: 'https://evil.example/x' } }, true);
    assert.equal(r.res.statusCode, 200);
    assert.match(r.res.json().url, /^https:\/\/proj\.supabase\.co\/auth\/v1\/authorize\?provider=apple&redirect_to=https%3A%2F%2Fapp\.velvetviking\.co\.uk%2Fstart$/);
    assert.equal(r.calls.length, 0, 'the OAuth start asked something: the trigger is what decides');
  } finally { restore(); }
});

// ===========================================================================
// 3. ACCESS FOR THE NEW ATHLETE
// ===========================================================================
async function sessionFor(row, env){
  const restore = setEnv(Object.assign({}, OFF_FLAGS, env || {}));
  try {
    return await withPatched(S, {
      config: () => CFG,
      verifyUser: async () => ({ uid: 'new-athlete', email: 'new@runner.test' }),
      sb: async () => ({ ok: true, json: async () => ({}) })
    }, async () => withPatched(A, {
      readEntitlement: async () => ({ ok: true, row: row }),
      createLease: async () => ({ ok: true, id: 'lease-new', ttl: 100 })
    }, async () => {
      const res = mockRes();
      await sessionHandler({ method: 'POST', headers: { authorization: 'Bearer t' } }, res);
      return res;
    }));
  } finally { restore(); }
}

test('commerce OFF: a brand-new account, no entitlement row at all, is handed the app', async () => {
  /* What a new account holds the moment it exists (proved in Postgres above):
     an account_commercial row and nothing else -- no entitlements row, no
     grant. The real decision, with VVV_COMMERCE_ENABLED and
     VVV_COMMERCIAL_REQUIRED unset: */
  const d = A.resolveAccess({ uid: 'new-athlete', entitlement: null, accountRequired: true, commercialRequired: false, now: new Date(PINNED) });
  assert.equal(d.allow, true);
  assert.equal(d.reason, 'pre_commercial');
  const res = await sessionFor(null);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['set-cookie'], /^vvv_gate=lease-new;/);
  assert.equal(res.json().reason, 'pre_commercial');
  /* and that cookie is a full delivery, not the journey copy */
  await withPatched(A, { accountRequired: () => true, readGateCookie: () => 'lease-new',
    resolveLease: async () => ({ user_id: 'new-athlete' }), readEntitlement: async () => ({ ok: true, row: null }),
    commercialRequired: () => false }, async () => {
    await withPatched(S, { config: () => CFG }, async () => {
      const r = mockRes();
      await appHandler({ method: 'GET', headers: {} }, r);
      assert.equal(r.headers['x-vvv-gate'], 'granted');
      assert.doesNotMatch(String(r.body).slice(0, 200), /data-vvv-access/);
    });
  });
});

test('commerce ON: the same account is granted nothing until its trial exists', async () => {
  const res = await sessionFor(null, { VVV_COMMERCIAL_REQUIRED: 'on', VVV_COMMERCE_ENABLED: 'on' });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().reason, 'no_entitlement');
  assert.match(res.headers['set-cookie'], /Max-Age=0/, 'a refused account kept a cookie');
  /* a legacy beta row (the old signup auto-grant, if it still fires) opens nothing */
  assert.equal((await sessionFor({ override: 'beta', state: 'expired' }, { VVV_COMMERCIAL_REQUIRED: 'on' })).statusCode, 403);
  /* the trial, once the provider reports it, is what opens the door */
  const trial = await sessionFor({ state: 'trial', access_until: '2026-11-25T09:00:00Z' }, { VVV_COMMERCIAL_REQUIRED: 'on', VVV_COMMERCE_ENABLED: 'on' });
  assert.equal(trial.statusCode, 200);
  assert.equal(trial.json().reason, 'subscription_trial');
});

/* The app side. A plan built through the journey, the record at `step`. */
function journeyApp(step, opts){
  const a = loadApp(Object.assign({ pinnedDate: PINNED }, opts || {}));
  a.showToast = () => {};
  buildPlan(a, { distanceKey: 'half', weeks: 12, volume: 35 });
  a.journeyWrite({ v: 1, step: step, purpose: 'race', drives: [], period: 'yearly', slide: 0, built: true });
  a.journeyProvidersAsked = true;
  return a;
}
function catalogueOffer(commerce){
  const env = commerce ? { VVV_PRICE_WEB_STANDARD_MONTHLY: 'price_m', VVV_PRICE_WEB_STANDARD_YEARLY: 'price_y' } : {};
  return { catalogue: Prod.catalogue('web', env, new Date(PINNED)), agreements: Agree.currentAgreements(),
           commerce_enabled: !!commerce, provider_configured: !!commerce };
}
function signedIn(a){
  a.cloudSession = { access_token: 't', user_id: 'new-athlete', expires_at: new a.Date().getTime() + 3600e3 };
}

test('commerce OFF: after Make It Yours the new athlete continues free, through Welcome, into Today', () => {
  const a = journeyApp('account');
  signedIn(a);
  a.entitlementInfo = { signed_in: true, access: true, reason: 'pre_commercial', commercial_required: false };
  assert.equal(a.journeyStep(), 'trial', 'signed in, the journey did not move on to the trial');
  a.journeyOfferAsked = true; a.journeyOffer = catalogueOffer(false);
  const html = a.renderJourneyTrial();
  assert.match(html, /Subscriptions are not open yet\./);
  assert.match(html, /data-action="journey-trial-continue"/, 'the free way on is missing');
  assert.doesNotMatch(html, /journey-trial-start|journey-agree/, 'commerce off, but the screen sells');
  a.handleJourneyAction('journey-trial-continue');
  assert.equal(a.journeyStep(), 'arrive');
  a.isNativeApp = () => true;
  a.handleJourneyAction('journey-finish');
  assert.equal(a.journeyActive(), false, 'the journey did not end');
  assert.equal(a.state.view, 'today');
});

test('commerce ON: a refused new athlete stays on the journey at the trial, not "Your access has ended"', () => {
  const a = journeyApp('account', { storage: { vvv_cloud_session: JSON.stringify({ access_token: 't', expires_at: Date.now() + 3600e3 }) } });
  a.JOURNEY_ONLY_MODE = true;
  signedIn(a);
  const went = []; a.journeyNavigate = u => { went.push(u); return true; }; a.journeyReload = () => went.push('reload');
  a.entitlementInfo = { signed_in: true, access: false, reason: 'no_entitlement', state: null, commercial_required: true };
  a.journeyOnlyLift(false);
  assert.deepEqual(went, [], 'a new athlete whose next step is the trial was sent to the locked shell');
  assert.equal(a.journeyOnlyRefused, true);
  a.journeyOfferAsked = true; a.journeyOffer = catalogueOffer(true);
  const html = a.renderMainContent();
  assert.match(html, /Start Your 7-Day Free Trial/, 'the refused new athlete is not shown the trial');
  assert.match(html, /data-action="journey-trial-start"/);
  assert.doesNotMatch(html, /journey-trial-continue/, 'a refused athlete is offered a free way into an app the gate will not hand over');
  /* the journey cannot be walked past the trial while refused */
  a.journeySet({ step: 'arrive' });
  assert.equal(a.journeyStep(), 'trial');
  /* the trial screen's actions are the journey's, so journey-only mode lets them through */
  ['journey-trial-start', 'journey-agree', 'journey-period', 'journey-account-page'].forEach(x =>
    assert.equal(a.journeyOnlyAllows(x), true, x + ' is refused in journey-only mode'));
  /* and nothing else opens: the dispatcher still refuses the app */
  ['set-view', 'open-ask', 'open-settings-panel'].forEach(x => assert.equal(a.journeyOnlyAllows(x), false));
});

test('commerce ON: Start My Free Trial opens the 7-day checkout with the athlete\'s own token', async () => {
  const sent = [];
  const a = journeyApp('trial', { fetch: async (url, opts) => { sent.push({ url: String(url), opts: opts || {} });
    return { status: 200, ok: true, json: async () => ({ url: 'https://checkout.stripe.test/c/abc' }) }; } });
  a.JOURNEY_ONLY_MODE = true; a.journeyOnlyRefused = true;
  signedIn(a);
  const went = []; a.journeyNavigate = u => { went.push(u); return true; };
  a.handleJourneyTrialStart();
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  const co = sent.filter(s => s.url === '/api/checkout');
  assert.equal(co.length, 1, 'no checkout was asked for');
  assert.equal(co[0].opts.method, 'POST');
  assert.equal(co[0].opts.headers.Authorization, 'Bearer t');
  assert.deepEqual(JSON.parse(co[0].opts.body), { period: 'yearly' });
  assert.deepEqual(went, ['https://checkout.stripe.test/c/abc']);
  assert.equal(Prod.offer('STANDARD_YEARLY').trialDays, 7);
});

test('a refused athlete with no journey to finish still goes to the locked shell, as before', () => {
  const a = loadApp({ pinnedDate: PINNED });
  a.showToast = () => {};
  a.JOURNEY_ONLY_MODE = true;
  const went = []; a.journeyNavigate = u => { went.push(u); return true; };
  a.journeyOnlyLift(false);
  assert.deepEqual(went, ['/account?why=locked']);
  /* nor does the refusal hold an athlete whose journey is already done */
  const b = journeyApp('done');
  b.JOURNEY_ONLY_MODE = true;
  const went2 = []; b.journeyNavigate = u => { went2.push(u); return true; };
  b.journeyOnlyLift(false);
  assert.deepEqual(went2, ['/account?why=locked']);
});

test('refused, with nothing to buy here (the app, or commerce off), the trial screen does not pretend there is a way on', () => {
  const a = journeyApp('trial');
  a.JOURNEY_ONLY_MODE = true; a.journeyOnlyRefused = true;
  signedIn(a);
  a.journeyOfferAsked = true; a.journeyOffer = catalogueOffer(false);
  let html = a.renderJourneyTrial();
  assert.doesNotMatch(html, /journey-trial-continue/);
  assert.match(html, /data-action="journey-account-page"/);
  a.isNativeApp = () => true;
  html = a.renderJourneyTrial();
  assert.doesNotMatch(html, /journey-trial-continue|£/);
  assert.match(html, /Subscriptions are not available in the app yet\. Nothing has been charged\./);
  const went = []; a.journeyNavigate = u => { went.push(u); return true; };
  a.handleJourneyAction('journey-account-page');
  assert.deepEqual(went, ['/account?why=locked']);
});

// ===========================================================================
// 4. THE WORDS
// ===========================================================================
function everyJourneyScreen(a){
  a.openModal = (html) => { a.__modal = html; };
  const keep = a.state.setup;
  a.state.setup = null;
  a.openSetupModal();
  const builder = a.__modal || '';
  a.state.setup = keep;
  a.journeyOfferAsked = true; a.journeyOffer = catalogueOffer(false);
  const web = a.renderJourneyTrial();
  a.isNativeApp = () => true;
  const store = a.renderJourneyTrial();
  a.isNativeApp = () => false;
  return [a.renderJourneyWelcome(), a.renderJourneyWelcome(true), a.renderJourneyAccount(), web, store, builder,
    a.cloudAuthErrorCopy('unexpected_failure', 'Database error saving new user'), a.legalTermsLabel(), a.legalCoverSentence()].join('\n');
}

test('switch ON: nothing on the journey, the builder or the sign-in errors says private beta', () => {
  const a = journeyApp('account');
  a.signupPublic = true;
  const all = everyJourneyScreen(a);
  assert.doesNotMatch(all, /private[ -]beta|tester list|beta terms/i);
  assert.match(all, /For now SACORO is free to use, and nothing is charged\./);
  assert.match(all, /Using SACORO is covered by our/);
  assert.equal(a.legalTermsLabel(), 'Terms');
  /* the cloud push refusal, the one toast that named the beta */
  const toasts = []; a.showToast = t => toasts.push(t);
  a.cloudSession = { access_token: 't', user_id: 'u', expires_at: new a.Date().getTime() + 3600e3 };
  const src = RUNTIME.slice(RUNTIME.indexOf("if (err && err.code === 'not_in_beta' && !window.__vvvBetaRevokedTold)"));
  assert.match(src.slice(0, 600), /signupIsPublic\(\)\s*\?\s*'Your plan couldn\\u2019t be saved to your account/);
});

test('switch OFF, or not yet known: today\'s wording, word for word', () => {
  for (const sw of [false, null]){
    const a = journeyApp('account');
    a.signupPublic = sw;
    const all = everyJourneyScreen(a);
    assert.match(all, /During the private beta SACORO is free to use, and nothing is charged\./);
    assert.match(all, /Using the private beta is covered by our/);
    assert.match(all, /SACORO is in private beta\. This email address is not on the tester list yet/);
    assert.equal(a.legalTermsLabel(), 'Private Beta Terms');
  }
});

test('the server\'s answer is what the app believes, and it is remembered for the next load', async () => {
  const answers = { public_signup: true, providers: { email: true, apple: false, google: false } };
  const a = loadApp({ pinnedDate: PINNED, fetch: async () => ({ ok: true, json: async () => answers }) });
  a.showToast = () => {};
  a.journeyProvidersAsked = false;
  a.journeyAskProviders();
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.equal(a.signupIsPublic(), true);
  assert.equal(a.localStorage.getItem('vvv_signup_public'), '1');
  const b = loadApp({ pinnedDate: PINNED, storage: { vvv_signup_public: '1' } });
  assert.equal(b.signupIsPublic(), true, 'a reload forgot the answer and would flash the old wording');
  /* an answer that is not true or false changes nothing */
  assert.equal(b.noteSignupPublic(null), false);
  assert.equal(b.noteSignupPublic(undefined), false);
  assert.equal(b.signupIsPublic(), true);
  assert.equal(b.noteSignupPublic(false), true);
  assert.equal(b.legalTermsLabel(), 'Private Beta Terms');
  /* the Welcome asks, so the answer is in before the builder or Make It Yours */
  assert.match(/function renderJourneyWelcome\(memberOnly\)\{[^]*?journeyAskProviders\(\);/.exec(RUNTIME)[0], /journeyAskProviders/);
});

test('account.html: the sign-in line loses "private beta" only on an explicit yes, and a new account is not told its access ended', () => {
  const html = read('account.html');
  assert.match(html, /<p class="vvv-quiet" id="legal-note">Using the private beta is covered by our/, 'today\'s line is not the default');
  const fn = /function applySignupWording\(\)\{[^]*?\n  \}/.exec(html)[0];
  assert.match(fn, /signupOpen \? 'Using SACORO is covered by our [^']*' : legalBefore;/,
    'the new line is not conditional on the switch, or a no would keep it');
  assert.doesNotMatch(fn, /private beta/i);
  assert.match(html, /if \(typeof d\.public_signup !== 'boolean'\) return;/, 'an unknown answer changes the page');
  assert.match(html, /signupOpen = d\.public_signup; applySignupWording\(\);/);
  assert.match(html, /if \(v\.override === 'beta'\)\s+return signupOpen \? '' : 'Private beta access\.';/);
  assert.match(html, /var never = !hasAccess && !grace && !\(v && \(v\.state \|\| v\.access_until\)\);/);
  assert.match(html, /: never \? 'Your SACORO account'/);
  /* start.html and get.html carry no private-beta words a public visitor can reach */
  const start = read('start.html').replace(/<!--[^]*?-->/g, '').replace(/\/\*[^]*?\*\//g, '');
  (start.match(/'[^'\n]*'/g) || []).filter(s => /private beta|tester/i.test(s))
    .forEach(s => assert.fail('start.html says: ' + s));
  assert.doesNotMatch(read('get.html').replace(/<!--[^]*?-->/g, ''), /private beta/i);
});

// ===========================================================================
// 5. THE DOCUMENTS
// ===========================================================================
test('AUTH-AND-EMAIL.md and ENVIRONMENT.md say how the switch works, and the email limit plainly', () => {
  const auth = read('AUTH-AND-EMAIL.md');
  assert.match(auth, /supabase-public-signup\.sql/);
  assert.match(auth, /set public_signup = true/);
  assert.match(auth, /set public_signup = false/);
  assert.match(auth, /custom SMTP/i);
  assert.match(auth, /rate limit/i);
  const env = read('ENVIRONMENT.md');
  assert.match(env, /supabase-public-signup\.sql/);
  assert.match(env, /not an environment variable/i);
});
