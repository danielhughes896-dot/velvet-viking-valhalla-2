'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// THE FOUNDER WELCOME EMAIL.
//
// One email, the first time an athlete actually gets into Valhalla. The whole
// risk is in the word "one": an email that never arrives is a disappointment,
// and one that arrives three times is an apology. Those are not equally bad, so
// the design guarantees AT MOST once and only tries for at least once.
//
// Nothing here proves that by counting sends in JavaScript. The lock is a
// primary key, and the test that matters drives the real claiming statement
// against a real Postgres.

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const W = require(path.join(ROOT, 'api', '_welcome-email.js'));

const ACC = '11111111-1111-4111-8111-111111111111';
const EMAIL = 'athlete@valhalla.test';
const ON = W.config({ VVV_WELCOME_EMAIL: 'on', RESEND_API_KEY: 're_fixture' });

/* A stand-in for the two RPCs and the provider. The claim is the interesting
   one, so it behaves like the database does: the first caller wins, every
   later caller is refused until the backoff elapses and the attempt budget
   allows another try. */
function harness(opts){
  const o = opts || {};
  const state = { claims: 0, sends: 0, sent: false, attempts: 0, marked: 0, failures: [] };
  const S = { sb: async (cfg, p, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    if (/claim_welcome_email/.test(p)){
      state.claims++;
      if (o.claimFails) return { ok: false, status: 503, json: async () => null };
      const may = !state.sent && state.attempts < (o.maxAttempts == null ? 3 : o.maxAttempts);
      if (may) state.attempts++;
      return { ok: true, status: 200, json: async () => may };
    }
    if (/mark_welcome_email_sent/.test(p)){
      state.marked++; state.sent = true;
      if (o.markFails) throw new Error('unreachable');
      return { ok: true, status: 200, json: async () => true };
    }
    if (/record_welcome_email_failure/.test(p)){
      state.failures.push(body.p_code);
      return { ok: true, status: 200, json: async () => null };
    }
    throw new Error('unexpected rpc ' + p);
  } };
  const fetch = async () => {
    state.sends++;
    if (o.providerStatus && o.providerStatus >= 400)
      return { ok: false, status: o.providerStatus };
    if (o.providerThrows) throw new Error('network');
    return { ok: true, status: 200 };
  };
  return { S, state, deps: { config: o.config || ON, fetch } };
}

// ===========================================================================
// SENDS ONCE, AND ONLY ONCE
// ===========================================================================
test('a new account is welcomed exactly once', async () => {
  const h = harness();
  const r = await W.welcomeIfFirstEntry(h.S, {}, ACC, EMAIL, h.deps);
  assert.equal(r.ok, true);
  assert.equal(r.code, 'sent');
  assert.equal(h.state.sends, 1);
  assert.equal(h.state.marked, 1);
});

test('a returning athlete is welcomed zero times, and the provider is never called', async () => {
  const h = harness();
  await W.welcomeIfFirstEntry(h.S, {}, ACC, EMAIL, h.deps);
  for (let i = 0; i < 5; i++){
    const r = await W.welcomeIfFirstEntry(h.S, {}, ACC, EMAIL, h.deps);
    assert.equal(r.code, 'already_welcomed');
  }
  assert.equal(h.state.sends, 1, 'every later sign-in must stop at the claim');
  assert.equal(h.state.claims, 6, 'and the claim is what refuses, not a check in JavaScript');
});

test('the claim happens BEFORE the send, which is the whole ordering decision', () => {
  /* Claim-then-send can lose an email. Send-then-claim can send it twice. One
     of those is recoverable by the athlete asking; the other is not
     recoverable at all. */
  const src = read('api/_welcome-email.js');
  const claimAt = src.indexOf("'/rpc/claim_welcome_email'");
  const sendAt = src.indexOf('await sendViaResend(');
  const markAt = src.indexOf("'/rpc/mark_welcome_email_sent'");
  assert.ok(claimAt > 0 && sendAt > claimAt, 'the send must come after the claim');
  assert.ok(markAt > sendAt, 'and the stamp after the send');
});

// ===========================================================================
// FAILURE NEVER BLOCKS, AND RETRIES ARE BOUNDED
// ===========================================================================
test('a provider outage does not block the sign-in, and is retried', async () => {
  const h = harness({ providerStatus: 503 });
  const r = await W.welcomeIfFirstEntry(h.S, {}, ACC, EMAIL, h.deps);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'resend_http_503');
  assert.equal(r.willRetry, true);
  assert.deepEqual(h.state.failures, ['resend_http_503'], 'a code is recorded, never a body');
  assert.equal(h.state.marked, 0, 'nothing may be stamped as sent');
});

test('retries are bounded by the database, not by hope', async () => {
  const h = harness({ providerStatus: 500, maxAttempts: 3 });
  for (let i = 0; i < 6; i++) await W.welcomeIfFirstEntry(h.S, {}, ACC, EMAIL, h.deps);
  assert.equal(h.state.sends, 3, 'three attempts and then it stops asking');
  assert.equal(h.state.attempts, 3);
});

test('a hanging provider cannot hold the sign-in open', async () => {
  assert.equal(W.SEND_TIMEOUT_MS, 10000);
  const src = read('api/_welcome-email.js');
  assert.match(src, /new AbortController\(\)/);
  assert.match(src, /controller\.abort\(\)/);
  assert.match(src, /signal: controller \? controller\.signal : undefined/);
  // And the abort is classified as transient, so it is retried rather than
  // recorded as a permanent refusal.
  const cfg = W.config({ VVV_WELCOME_EMAIL: 'on', RESEND_API_KEY: 're_x' });
  const r = await W.sendViaResend(cfg, EMAIL, {
    fetch: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; } });
  assert.equal(r.code, 'resend_timeout');
  assert.equal(r.transient, true);
});

test('a claim that cannot be recorded sends nothing', async () => {
  // No record means no guarantee, and no guarantee means no email.
  const h = harness({ claimFails: true });
  const r = await W.welcomeIfFirstEntry(h.S, {}, ACC, EMAIL, h.deps);
  assert.equal(r.code, 'claim_failed');
  assert.equal(h.state.sends, 0);
});

test('sent-but-unstamped is reported rather than swallowed', async () => {
  // The one path that can produce a second copy. Bounded by the attempt limit,
  // and logged loudly because it is the one that matters.
  const h = harness({ markFails: true });
  const r = await W.welcomeIfFirstEntry(h.S, {}, ACC, EMAIL, h.deps);
  assert.equal(r.ok, true);
  assert.equal(r.code, 'sent_unstamped');
  assert.match(read('api/_welcome-email.js'), /log\('SENT_BUT_UNSTAMPED'\)/);
});

// ===========================================================================
// IT IS OFF, AND IT IS SERVER-SIDE
// ===========================================================================
test('nothing sends unless somebody switched it on', async () => {
  const off = W.config({ RESEND_API_KEY: 're_x' });
  const h = harness({ config: off });
  const r = await W.welcomeIfFirstEntry(h.S, {}, ACC, EMAIL, h.deps);
  assert.equal(r.code, 'welcome_email_disabled');
  assert.equal(h.state.claims, 0, 'a disabled feature must not even claim');
  assert.equal(h.state.sends, 0);
});

test('no key means no send, and the key is never client-side', async () => {
  const noKey = W.config({ VVV_WELCOME_EMAIL: 'on' });
  assert.equal(noKey.hasKey, false);
  /* AND IT ACTUALLY REFUSES. Asserting hasKey is false says nothing about what
     the send path does with it -- deleting the guard left every test passing,
     because the fetch stub does not care whether the Authorization header says
     "Bearer ". A real Resend would 401, the claim would already be spent, and
     the athlete would silently never be welcomed. */
  const h = harness({ config: noKey });
  const r = await W.welcomeIfFirstEntry(h.S, {}, ACC, EMAIL, h.deps);
  assert.equal(r.code, 'not_configured');
  assert.equal(h.state.claims, 0, 'an unconfigured provider must not spend the one claim');
  assert.equal(h.state.sends, 0);
  // The key is read through a function, so a rotation is picked up rather than
  // captured at cold start, and it is not on the object anything serialises.
  const on = W.config({ VVV_WELCOME_EMAIL: 'on', RESEND_API_KEY: 're_secret_fixture' });
  assert.equal(JSON.stringify(on).indexOf('re_secret_fixture'), -1);
  assert.equal(on.key(), 're_secret_fixture');
  // And nothing that ships to a browser knows the name.
  for (const f of ['protected/velvet-viking-valhalla.html', 'start.html', 'account.html', 'get.html']){
    assert.equal(/RESEND_API_KEY|api\.resend\.com/.test(read(f)), false, f + ' references Resend');
  }
});

test('no secret, address or provider body ever reaches a log', () => {
  const src = read('api/_welcome-email.js')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
  for (const call of (src.match(/\blog\([^;]*?\)\s*;/g) || [])){
    /* The logger's OWN definition matches a naive search, because the module
       prefix it writes is 'welcome-email: '. Excluded by the thing that makes
       it a definition rather than a call site. */
    if (/console\.log/.test(call)) continue;
    assert.equal(/email|key\(|apiKey|toEmail|accountId|uid/i.test(call), false,
      'a log line carries something it should not: ' + call.trim());
  }
  // The provider's own message is never returned either -- its error bodies
  // echo the request, and the request carries the address.
  assert.equal(/await r\.text\(\)|await r\.json\(\)[\s\S]{0,40}message/.test(src), false,
    'the adapter reads a provider error body');
});

// ===========================================================================
// THE EMAIL ITSELF
// ===========================================================================
test('the sender, reply address and subject are pinned', () => {
  assert.equal(W.FROM, 'Dan from Velvet Viking <support@velvetviking.co.uk>');
  assert.equal(W.REPLY_TO, 'support@velvetviking.co.uk');
  assert.equal(W.SUBJECT, 'Welcome to Valhalla — the flagship app from Velvet Viking');
});

test('the request Resend receives is exactly what was approved', async () => {
  let body = null, headers = null;
  await W.sendViaResend(ON, EMAIL, {
    fetch: async (url, init) => { body = JSON.parse(init.body); headers = init.headers;
      assert.equal(url, 'https://api.resend.com/emails');
      return { ok: true, status: 200 }; } });
  assert.equal(body.from, W.FROM);
  assert.deepEqual(body.to, [EMAIL]);
  assert.equal(body.reply_to, W.REPLY_TO);
  assert.equal(body.subject, W.SUBJECT);
  assert.ok(body.html && body.text, 'both parts, so text and HTML readers get the same letter');
  assert.match(headers['Authorization'], /^Bearer /);
  // Nothing asks the provider to watch the recipient.
  assert.equal(Object.keys(body).sort().join(','), 'from,html,reply_to,subject,text,to');
});

test('the copy is verbatim, in both renderings', () => {
  const expected = [
    'Welcome to Valhalla!',
    "My name is Dan, and I'm the founder and CEO of Velvet Viking and its flagship Valhalla app.",
    "You're now part of Valhalla, and I'm genuinely glad you're here.",
    'I built this because I wanted something that actually felt like having a coach, ' +
      'something that pays attention to your training, learns from it and helps you make ' +
      'better decisions, rather than just handing you a plan.',
    'So, train hard, train smart and earn your place.'
  ];
  assert.deepEqual(W.PARAGRAPHS, expected);
  assert.deepEqual(W.SIGN_OFF, ['Thank you,', 'Dan', 'Founder, Velvet Viking']);

  const text = W.textBody();
  const html = W.htmlBody();
  for (const p of expected){
    assert.ok(text.indexOf(p) !== -1, 'missing from the text part: ' + p.slice(0, 40));
    // The HTML escapes apostrophes as themselves but ampersands etc. change, so
    // compare on the escaped form the renderer actually produces.
    const esc = p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    assert.ok(html.indexOf(esc) !== -1, 'missing from the HTML part: ' + p.slice(0, 40));
  }
  for (const s of W.SIGN_OFF){
    assert.ok(text.indexOf(s) !== -1 && html.indexOf(s) !== -1, 'sign-off missing: ' + s);
  }
});

test('it carries no marketing, no pricing, no feature list and no tracking', () => {
  const html = W.htmlBody(), text = W.textBody();
  for (const src of [html, text]){
    assert.equal(/£|\$|\bper month\b|\bper year\b|11\.99|89\.99|subscri/i.test(src), false,
      'the welcome email mentions money');
    assert.equal(/unsubscribe|utm_|pixel|track/i.test(src), false, 'it carries tracking');
    assert.equal(/<img|background-image/i.test(html), false, 'a remote image is a read receipt');
  }
  // No CTA, because there is nothing to ask for -- the athlete is already in.
  assert.equal(/<a\s/i.test(html), false, 'the welcome email has a link, and needs none');
});

test('it says nothing about the athlete', () => {
  // No name, no training, no health information, no plan. There is nowhere in
  // the copy for any of it to go, and this fails if somewhere appears.
  const html = W.htmlBody();
  assert.equal(/\{\{|\$\{|%s|<%/.test(html), false, 'the body has an interpolation slot');
  assert.equal(html.indexOf(EMAIL), -1);
  for (const forbidden of ['heart', 'readiness', 'pace', 'rpe', 'plan for', 'your week']){
    assert.equal(new RegExp(forbidden, 'i').test(html), false, 'the email mentions ' + forbidden);
  }
});

test('it renders, and to the same standard as the auth emails', () => {
  const html = W.htmlBody();
  assert.equal(/<style|<script|javascript:/i.test(html), false);
  assert.match(html, /name="viewport"/);
  assert.match(html, /max-width:560px; width:100%/);
  for (const t of (html.match(/<table[^>]*>/g) || []))
    assert.match(t, /role="presentation"/, 'a layout table read as data: ' + t);
  for (const tag of ['html', 'head', 'body', 'table', 'tr', 'td', 'p', 'h1', 'div', 'title']){
    const open = (html.match(new RegExp('<' + tag + '(?=[\\s>])', 'gi')) || []).length;
    const close = (html.match(new RegExp('</' + tag + '>', 'gi')) || []).length;
    assert.equal(open, close, '<' + tag + '> opened ' + open + ', closed ' + close);
  }
  // Same palette as the auth templates, and every colour one of the product's.
  const known = new Set(['#F4F1EA', '#FCFBFB', '#171717', '#514D45', '#5D574C', '#7A5C1E', '#DAD1BB']);
  for (const hex of (html.match(/#[0-9A-Fa-f]{6}/g) || []))
    assert.ok(known.has(hex.toUpperCase()), 'unchecked colour ' + hex);
});

test('it is not an auth email and shares nothing with one', () => {
  const html = W.htmlBody();
  assert.equal(/ConfirmationURL|Token|sign in|magic link/i.test(html), false,
    'the welcome email carries auth language or a credential');
  // And the Supabase templates are untouched by it.
  const dir = path.join(ROOT, 'supabase-auth-emails');
  for (const f of fs.readdirSync(dir)){
    assert.equal(/Welcome to Valhalla|founder|Resend/i.test(fs.readFileSync(path.join(dir, f), 'utf8')),
      false, f + ' has grown welcome copy');
  }
});

// ===========================================================================
// THE TRIGGER POINT
// ===========================================================================
test('it fires after a lease is minted, which is when they are actually in', () => {
  const session = read('api/session.js');
  const leaseAt = session.indexOf('A.buildSetCookie(lease.id');
  const welcomeAt = session.indexOf('W.welcomeIfFirstEntry');
  const issuedAt = session.indexOf("log('ISSUED");
  assert.ok(leaseAt > 0 && welcomeAt > leaseAt, 'the welcome must come after the lease');
  assert.ok(issuedAt > welcomeAt);
  // The address comes from the verified token, never from a request body.
  assert.match(session, /W\.welcomeIfFirstEntry\(S, cfg, who\.uid, who\.email\)/);
  // Guarded, so it can never be why somebody cannot get in.
  const around = session.slice(welcomeAt - 300, welcomeAt + 200);
  assert.match(around, /try\{/);
  assert.match(session.slice(welcomeAt, welcomeAt + 200), /catch\(e\)\{ log\('WELCOME_EMAIL_THREW'\); \}/);
});

test('a refused sign-in is never welcomed', () => {
  // The denial returns before the lease, so an athlete who cannot get in does
  // not get a letter saying they are in.
  const session = read('api/session.js');
  const deniedAt = session.indexOf("log('DENIED reason=");
  const welcomeAt = session.indexOf('W.welcomeIfFirstEntry');
  assert.ok(deniedAt > 0 && deniedAt < welcomeAt);
  const between = session.slice(deniedAt, welcomeAt);
  assert.match(between, /return S\.json\(res, 403/, 'the refusal must return before the welcome');
});

// ===========================================================================
// THE SCHEMA
// ===========================================================================
test('the record is service-only, and the primary key is the lock', () => {
  const sql = read('supabase-welcome-email.sql');
  assert.match(sql, /account_id\s+uuid\s+primary key references auth\.users\(id\) on delete cascade/);
  assert.match(sql, /alter table public\.account_welcome_email enable row level security/);
  const stmts = sql.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
  assert.equal(/create policy/i.test(stmts), false, 'a policy here is a widening');
  // One atomic statement, not a read-then-write.
  assert.match(sql, /on conflict \(account_id\) do update/);
  assert.match(sql, /where w\.sent_at is null/);
  assert.match(sql, /and w\.attempts < p_max_attempts/);
  // The client can reach none of it.
  for (const fn of ['claim_welcome_email\\(uuid, integer, interval\\)',
                    'mark_welcome_email_sent\\(uuid\\)',
                    'record_welcome_email_failure\\(uuid, text\\)']){
    assert.match(sql, new RegExp('revoke all on function public\\.' + fn +
      '\\s+from public, anon, authenticated'));
  }
  /* EVERY grantee, not just the first. The obvious regex -- to (public|anon|
     authenticated) -- only matches when the browser role is named first, so
     `to postgres, service_role, authenticated` sailed straight past it. Parse
     the list instead of pattern-matching the sentence. */
  for (const g of (stmts.match(/grant execute on function[^;]*;/gi) || [])){
    const grantees = g.slice(g.lastIndexOf(' to ') + 4).replace(';', '')
      .split(',').map(x => x.trim().toLowerCase());
    for (const role of ['public', 'anon', 'authenticated']){
      assert.equal(grantees.indexOf(role), -1,
        'a browser role is granted EXECUTE: ' + g.trim());
    }
  }
  // Every definer function pins its search path.
  const defs = (stmts.match(/security definer[\s\S]{0,80}/gi) || []);
  assert.ok(defs.length >= 3);
  for (const d of defs) assert.match(d, /set search_path = ''/);
});

test('deleting the account removes the welcome state with it', () => {
  const sql = read('supabase-welcome-email.sql');
  assert.match(sql, /on delete cascade/);
  const facts = read('LEGAL-FACTS.md');
  assert.match(facts, /account_welcome_email/,
    'the deletion table Website relies on must name it');
});

test('the migration order names it, after the posture file that asserts RLS', () => {
  const doc = read('SUPABASE-MIGRATIONS.md');
  const table = doc.slice(doc.indexOf('| # | File'), doc.indexOf('## Deployment parameters'));
  assert.ok(table.indexOf('supabase-welcome-email.sql') >
            table.indexOf('supabase-security-posture.sql'));
});
