'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// PROPORTIONATE OBSERVABILITY.
//
// Enough to answer "why did that fail" from a log search, and deliberately not
// an analytics warehouse. The rule that makes that possible is one line per
// outcome carrying a CODE and a classification, and nothing that identifies a
// person -- so the logs can be kept, searched and shared without becoming a
// second copy of the database with no access control on it.
//
// The failure mode these tests guard against is not "we forgot to log". It is
// "somebody added the useful detail" -- the email, the token, the whole error
// body -- on the afternoon they were debugging, and it stayed.

const ROOT = path.join(__dirname, '..');
const API = path.join(ROOT, 'api');
const files = fs.readdirSync(API).filter(f => f.endsWith('.js'));
const src = (f) => fs.readFileSync(path.join(API, f), 'utf8');
const code = (f) => src(f).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');

/* Every log call site, as written. */
function logCalls(f){
  return (code(f).match(/\blog\(([^;]*?)\)\s*;/g) || []);
}

test('every diagnosable subsystem has a named failure code', () => {
  // The six things HQ needs to be able to diagnose. Each is named here by the
  // file that would fail, so a subsystem that stops logging is a failing test
  // rather than a silent gap discovered during an outage.
  const required = {
    'auth':            ['beta-signin.js', /log\('(GOTRUE_REFUSED|GOTRUE_UNREACHABLE|REFUSED)/],
    'checkout':        ['_checkout.js',   /log\('(REFUSED|CUSTOMER_FAILED|SESSION_FAILED)/],
    'webhook':         ['billing-webhook.js', /log\('STRIPE_(REJECTED|CLAIM_FAILED|SUBSCRIPTION_WRITE_FAILED)/],
    /* _access.js is a PURE decision module: it returns a reason and logs
       nothing, which is right -- a function that both decides and reports is a
       function whose decision you cannot test without capturing stdout. Its
       two callers do the logging, so that is where the diagnostic must be. */
    'entitlement':     ['session.js',     /log\('(DENIED|ENTITLEMENT_READ_FAILED|LEASE_CREATE_FAILED)/],
    'entitlement (runtime)': ['app.js',   /log\('(DENIED|LEASE_LOOKUP_FAILED)/],
    'monday sync':     ['_monday-operational.js', /log\('OPS_[A-Z_]*(FAILED|UNAVAILABLE|REJECTED)/],
    'external strava': ['_strava-callback.js', /log\(/]
  };
  for (const [what, [file, re]] of Object.entries(required)){
    assert.ok(files.indexOf(file) !== -1, file + ' has gone');
    assert.match(code(file), re, what + ' has no diagnosable failure code in ' + file);
  }
});

test('no log line can carry an email address', () => {
  // An email in a log is the personal data most likely to be there and least
  // likely to be noticed, because it is the most useful thing to a person
  // debugging at the time.
  const offenders = [];
  for (const f of files){
    for (const call of logCalls(f)){
      if (/\bemail\b/i.test(call) && !/hasEmail|emailShape|BAD_EMAIL_SHAPE|no_email/i.test(call))
        offenders.push(f + ': ' + call.trim().slice(0, 90));
    }
  }
  assert.deepEqual(offenders, []);
});

test('no log line can carry a secret, a token or a signature', () => {
  const offenders = [];
  for (const f of files){
    for (const call of logCalls(f)){
      if (/\b(secret|token|signature|apikey|api_key|serviceKey|anonKey|jwt|bearer|salt)\b/i.test(call)
          && !/hasSecret|hasToken|hasSalt|serviceKeySource|verifyToken:|_NOT_CONFIGURED|VERIFY_TOKEN/i.test(call))
        offenders.push(f + ': ' + call.trim().slice(0, 90));
    }
  }
  assert.deepEqual(offenders, []);
});

test('an identifier in a log is truncated, never whole', () => {
  // A provider id is not a secret but it is somebody's customer reference.
  // Enough of one to correlate a line, never enough to be one.
  for (const f of ['billing-webhook.js', '_stripe.js']){
    assert.match(code(f), /function ref\(v\)\{[^}]*slice\(0, ?8\)/,
      f + ' has no truncating reference helper');
  }
  const hook = code('billing-webhook.js');
  const bare = (hook.match(/log\([^;]*?(account_id|subscription_ref|customer_ref|provider_event_id)[^;]*?\)\s*;/g) || [])
    .filter(c => !/\bref\(|P\.ref\(/.test(c));
  assert.deepEqual(bare, [], 'these log an identifier in full');
});

test('a provider error body is never echoed', () => {
  // Stripe and monday both repeat the request in their error bodies, and the
  // request carries the customer, the price and the whole payload.
  const stripe = code('_stripe.js');
  assert.equal(/err\.message|json\.error\.message|error\.message/.test(stripe), false,
    'the Stripe adapter echoes a provider message');
  assert.match(stripe, /code: err\.code \? 'stripe_' \+ err\.code/,
    'a code, never a message');
  const ops = code('_monday-operational.js');
  assert.match(ops, /return \{ ok: false, code: 'graphql_error' \}/);
  assert.equal(/json\.errors\[0\]\.message|errors\[0\]\.message/.test(ops), false);
});

test('logging is never the reason something fails', () => {
  // A console.log that throws inside a serverless handler takes the request
  // with it. Every logger in the codebase swallows.
  for (const f of files){
    const c = code(f);
    const defs = c.match(/function log\([^)]*\)\s*\{[\s\S]*?\}\s*$/gm) || [];
    for (const d of defs){
      assert.match(d, /try\s*\{[\s\S]*catch/, f + ' has a logger that can throw');
    }
  }
});

test('there is no analytics warehouse and no behavioural event log', () => {
  // The only behavioural signal retained anywhere is a single overwritten
  // timestamp, and the schema is where that is enforced.
  const sqls = fs.readdirSync(ROOT).filter(f => /^supabase-.*\.sql$/.test(f));
  for (const f of sqls){
    const stmts = fs.readFileSync(path.join(ROOT, f), 'utf8')
      .split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
    assert.equal(/create table[^;]*\b(events|analytics|activity_log|audit_log|sessions_log|page_views)\b/i.test(stmts),
      false, f + ' introduces an event log');
  }
  // billing_events is the exception and is not behavioural: it is the money
  // ledger, it exists for idempotency, and it holds no athlete behaviour.
  const core = fs.readFileSync(path.join(ROOT, 'supabase-commercial-core.sql'), 'utf8');
  assert.match(core, /create table if not exists public\.billing_events/);
  const block = core.slice(core.indexOf('create table if not exists public.billing_events'));
  const cols = block.slice(0, block.indexOf(');'));
  for (const forbidden of ['ip', 'user_agent', 'device', 'referrer', 'session_id']){
    assert.equal(new RegExp('^\\s*' + forbidden + '\\b', 'mi').test(cols), false,
      'billing_events records ' + forbidden);
  }
});

test('the one behavioural timestamp cannot become a timeline', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase-account-activity.sql'), 'utf8');
  assert.match(sql, /last_active_at < v_now - interval '1 hour'/,
    'without the suppression it is a session-by-session history');
  assert.match(sql, /Overwritten, never appended/);
});

test('every log code is upper snake case, so the vocabulary stays searchable', () => {
  /* Three call shapes exist and all are legitimate:
       log('CODE ...')                     most of the codebase
       S.log('scope', 'CODE ...')          the Strava family prefixes a scope
       S.log('scope', tag + ' CODE ...')   the webhook prefixes a correlation tag
     So the test does not try to guess which argument holds the code. It asks a
     weaker and more honest question: does this call site contain an upper-snake
     token at all? A call whose only literals are lowercase prose has no
     searchable code, which is the thing being guarded. The logger DEFINITIONS
     are excluded -- they read console.log('checkout: ' + what). */
  const bad = [];
  for (const f of files){
    for (const call of (code(f).match(/(?:[A-Za-z_$][\w$]*\.)?\blog\([^;]*?\)\s*;/g) || [])){
      if (/console\.log/.test(call)) continue;
      /* diagLine(code, diag) composes the code from a variable and is the
         SHARED auth diagnostic -- one vocabulary, one place, better than a
         literal at each call site. Its own codes are guarded below. */
      if (/diagLine\(/.test(call)) continue;
      const literals = (call.match(/'[^']*'/g) || []).map(x => x.slice(1, -1));
      const hasCode = literals.some(l => l.split(/[ ,]/).some(w => /^[A-Z][A-Z0-9_]{2,}$/.test(w)));
      if (!hasCode) bad.push(f + ': ' + call.trim().slice(0, 70));
    }
  }
  assert.deepEqual(bad, []);
});

test('the shared auth diagnostic reports classifications, never material', () => {
  // diagLine() is the one place several endpoints get their auth failure code
  // from, which is why it is worth checking directly: it is a single line that
  // ends up in six log streams.
  const strava = code('_strava.js');
  const fn = strava.slice(strava.indexOf('function diagLine('),
                          strava.indexOf('function diagLine(') + 700);
  const body = fn.slice(0, fn.indexOf('\n}'));
  // Every value it emits is a yes/no, a state word or a status number.
  assert.match(body, /authHeader=' \+ \(diag\.authHeader \? 'yes' : 'no'\)/);
  assert.match(body, /jwtShape=' \+ \(diag\.jwtShape \? 'yes' : 'no'\)/);
  assert.match(body, /anonKey=' \+ \(diag\.anonKey \? 'configured' : 'missing'\)/,
    'the key itself must never be the thing reported');
  // And nothing that could be the credential.
  assert.equal(/diag\.(token|jwt|secret|key)\b(?!Issuer|Shape)/.test(body), false,
    'the diagnostic emits credential material');
});
