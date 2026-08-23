'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

/* THE COMMISSIONING PROBE IS RUN ONCE, BY A PERSON, AGAINST A REAL STRIPE
 * ACCOUNT -- which is exactly the kind of script that is never tested and is
 * wrong the one time it matters.
 *
 * Only three things about it need proving, and they are the three that would
 * hurt: that it cannot run against live money, that it cannot reach the
 * database, and that its paid-through verdict is the real adapter's answer
 * rather than a paraphrase the probe invented.
 *
 * Everything else it does is talk to Stripe, which this suite deliberately does
 * not: the whole reason the probe exists is that the repository cannot.
 */

const ROOT = path.join(__dirname, '..');
const PROBE = path.join(ROOT, 'tools', 'commissioning', 'stripe-check.js');

function run(env){
  const r = cp.spawnSync(process.execPath, [PROBE], {
    encoding: 'utf8', cwd: ROOT,
    env: Object.assign({}, process.env, {
      STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '',
      VVV_SITE_ORIGIN: '', VVV_PRICE_WEB_STANDARD_MONTHLY: '',
      VVV_PRICE_WEB_STANDARD_YEARLY: ''
    }, env || {})
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

test('a live key is refused before anything else runs', () => {
  /* The single worst outcome for this file: somebody pastes a production key in
     to "just check", and the probe starts creating customers against real
     money. It refuses on the key shape, in the first section, before a single
     request is made. */
  const r = run({ STRIPE_SECRET_KEY: 'sk_live_notreal',
                  VVV_PRICE_WEB_STANDARD_MONTHLY: 'price_m',
                  VVV_SITE_ORIGIN: 'https://app.test' });
  assert.match(r.out, /LIVE key/);
  assert.match(r.out, /refusing to run/);
  assert.notEqual(r.code, 0);
  /* And it got no further: no price was looked up, no endpoint was listed, no
     session was created. */
  assert.ok(!/PRICES/.test(r.out), 'the probe continued past the live-key refusal');
  assert.ok(!/WEBHOOK ENDPOINT/.test(r.out));
});

test('no key at all stops rather than half-reporting', () => {
  const r = run({});
  assert.match(r.out, /STRIPE_SECRET_KEY is not set/);
  assert.ok(!/PRICES/.test(r.out));
  assert.notEqual(r.code, 0);
});

test('the probe cannot touch the database, and holds no way to', () => {
  /* Structural, and it is the guarantee that lets this be run against a
     production Stripe account without anybody having to reason about blast
     radius: there is no Supabase client, no service key, and no table name. */
  const src = fs.readFileSync(PROBE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  ['_strava.js', '_commercial-store.js', '_billing-apply.js', 'S.sb(',
   'serviceKey', 'SUPABASE', '/subscriptions?', '/entitlements', '/account_commercial']
    .forEach(bad => assert.ok(src.indexOf(bad) === -1,
      'the commissioning probe can reach ' + bad));
});

test('the probe reports the adapter’s answer, not one of its own', () => {
  /* A probe that re-derived "is this paid through" would be proving the probe.
     It must call the same subscriptionFacts() the webhook calls and the same
     subscriptionAccess() the resolver calls, and nothing else may decide. */
  const src = fs.readFileSync(PROBE, 'utf8');
  assert.match(src, /P\.subscriptionFacts\(/);
  assert.match(src, /E\.subscriptionAccess\(/);
  assert.match(src, /P\.priceFor\(/);
  assert.match(src, /P\.createCheckoutSession\(/);
  assert.match(src, /P\.fetchSubscription\(/);
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(!/CONDITION_OF\s*=/.test(stripped), 'the probe keeps its own status map');
  assert.ok(!/function\s+paidThrough/.test(stripped), 'the probe computes paid-through itself');
});

test('the probe creates nothing unless it is asked to', () => {
  /* Default is read-only. Exactly one mode creates a Stripe object, it is
     behind an explicit flag, and it announces itself before acting. */
  const src = fs.readFileSync(PROBE, 'utf8');
  const creating = src.slice(src.indexOf("if (flag('session'))"));
  assert.match(creating, /the one mode that creates something/);
  assert.match(creating, /creating ONE test-mode Checkout Session/);
  /* ensureCustomer and createCheckoutSession are the only two writes, and both
     are inside that branch. */
  const before = src.slice(0, src.indexOf("if (flag('session'))"));
  assert.ok(!/ensureCustomer|createCheckoutSession/.test(before),
    'the probe writes to Stripe before the flag that authorises it');
});
