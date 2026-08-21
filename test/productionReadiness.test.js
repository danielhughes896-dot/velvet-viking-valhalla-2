'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// THE CLAIMS THIS SYSTEM MAKES ABOUT ITSELF.
//
// LEGAL-FACTS.md is handed to Website as fact. A document that says what the
// code used to do is worse than no document, because somebody will publish it.
// So the load-bearing claims in it are asserted here against the code, and the
// switches that must stay off are asserted to be off.

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
const sql = (f) => read(f).split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

const FACTS = read('LEGAL-FACTS.md');
const E = require(path.join(ROOT, 'api', '_entitlement.js'));
const P = require(path.join(ROOT, 'api', '_products.js'));
const S = require(path.join(ROOT, 'api', '_strava.js'));

// ===========================================================================
// THE SWITCHES THAT MUST STAY OFF
// ===========================================================================
test('public signup is closed, and closed by the database rather than the UI', () => {
  // A UI check is a suggestion. The refusal is a trigger on user creation.
  const gate = sql('supabase-beta-gate.sql');
  assert.match(gate, /create trigger beta_allowlist_gate\s+before insert on auth\.users/);
  assert.match(gate, /is_beta_approved/);
  // And the file that dismantles it is not in the apply order.
  const doc = read('SUPABASE-MIGRATIONS.md');
  const table = doc.slice(doc.indexOf('| # | File'), doc.indexOf('## Deployment parameters'));
  assert.equal(table.indexOf('supabase-commercial-activation.sql'), -1);
});

test('live charging is not a credential being present', () => {
  const stripe = code('api/_stripe.js');
  assert.match(stripe, /isLiveKey: \/\^sk_live_\/\.test\(secret\)/);
  // Nothing derives "we may charge" from a key existing.
  assert.equal(/\blive:\s*(!!)?(secret|cfg\.hasSecret|hasSecret)\b/.test(stripe), false);
});

test('no store purchase flow exists for a rail that has not been approved', () => {
  const api = fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js'));
  for (const f of api){
    const c = code(path.join('api', f));
    assert.equal(/StoreKit|in_app_purchase|BillingClient|purchaseToken|appstoreconnect|androidpublisher/i.test(c),
      false, 'api/' + f + ' contains store purchase code');
  }
  /* WHAT ACTUALLY STOPS AN APPLE PURCHASE, stated correctly rather than
     conveniently. The entitlement model does NOT refuse one: 'apple' is a
     legitimate rail and mayStartStandardPurchase() would allow it, which is the
     point of having the axis before having the adapter. What stops it is that
     there is no code that can start one and no price identifier configured --
     and an unset price must never resolve to "charge them something". */
  assert.equal(P.isProvider('apple'), true, 'the axis exists so an adapter is not a migration');
  assert.equal(P.providerRef('apple', 'STANDARD_MONTHLY', {}), null);
  assert.equal(P.providerRef('google', 'STANDARD_YEARLY', {}), null);
  // A provider that is not a rail at all is refused before anything is read.
  const bogus = E.mayStartStandardPurchase({ provider: 'paypal', subscriptions: [], account: {} });
  assert.equal(bogus.reason, 'unknown_provider');
});

test('garmin is off, and the document says only what is true', () => {
  const g = code('api/_garmin.js');
  assert.match(g, /VVV_GARMIN_ENABLED'\) === '1'/, 'it must take an explicit switch');
  assert.match(g, /GARMIN_CONTRACT_MISSING|GARMIN_UNAVAILABLE/);
  assert.match(FACTS, /Garmin is not connected, not enabled/);
  assert.match(FACTS, /not currently available/);
  /* Section 13 is the list of things Website must NOT say, so it legitimately
     contains the sentence "That Garmin is supported or coming on a date."
     Scanning the whole document would fail on the prohibition itself. */
  const body = FACTS.slice(0, FACTS.indexOf('## 13.'));
  assert.equal(/Garmin is supported|Garmin support is live/i.test(body), false);
});

test('Website is told what it must not say yet', () => {
  const tail = FACTS.slice(FACTS.indexOf('## 13.'));
  for (const claim of ['pause is available', 'founding-price guarantee is in effect',
                       'Garmin is supported', 'signup is open']){
    assert.ok(tail.indexOf(claim) !== -1, 'the prohibition on "' + claim + '" is missing');
  }
});

// ===========================================================================
// THE DELETION FACTS -- ASSERTED AGAINST THE SCHEMA, NOT AGAINST MEMORY
// ===========================================================================
test('every fact in the deletion table matches the schema it describes', () => {
  // Proven on a fresh cluster; guarded here so an added table cannot make the
  // published document wrong without a failing test.
  const table = FACTS.slice(FACTS.indexOf('| Table | On delete |'),
                            FACTS.indexOf('**Website can safely state:**'));
  const claimed = {};
  for (const m of table.matchAll(/\|\s*`(\w+)`\s*\|\s*\*{0,2}(CASCADE|SET NULL)\*{0,2}\s*\|/g)){
    claimed[m[1]] = m[2];
  }
  assert.ok(Object.keys(claimed).length >= 9, 'the table lost rows');

  const files = fs.readdirSync(ROOT).filter(f => /^supabase-.*\.sql$/.test(f));
  const found = {};
  for (const f of files){
    const src = sql(f);
    for (const m of src.matchAll(/create table if not exists public\.(\w+)\s*\(([\s\S]*?)\n\);/g)){
      const [, name, body] = m;
      const ref = /references auth\.users\(id\)([^,\n]*)/.exec(body);
      if (!ref) continue;
      found[name] = /set null/i.test(ref[1]) ? 'SET NULL' : 'CASCADE';
    }
  }
  for (const [t, rule] of Object.entries(found)){
    assert.equal(claimed[t], rule,
      'LEGAL-FACTS says ' + t + ' is ' + claimed[t] + '; the schema says ' + rule);
  }
  for (const t of Object.keys(claimed)){
    assert.ok(found[t], 'LEGAL-FACTS names ' + t + ', which no migration creates');
  }
  // The one deliberate survivor, named so a second one stands out.
  assert.equal(found.billing_events, 'SET NULL');
  assert.equal(Object.values(found).filter(v => v === 'SET NULL').length, 1);
});

test('the surviving ledger row carries nothing that identifies a person', () => {
  const core = sql('supabase-commercial-core.sql');
  const block = core.slice(core.indexOf('create table if not exists public.billing_events'));
  const cols = block.slice(0, block.indexOf('\n);'));
  for (const forbidden of ['email', 'name', 'address', 'card', 'last4', 'pan',
                           'ip', 'user_agent', 'payload', 'body']){
    assert.equal(new RegExp('^\\s*' + forbidden + '\\b', 'mi').test(cols), false,
      'billing_events holds ' + forbidden + ', so an anonymised row would not be');
  }
  assert.match(FACTS, /\*\*set to NULL\*\*/);
});

// ===========================================================================
// AUTH
// ===========================================================================
test('there is no password anywhere, so there is none to leak', () => {
  const dirs = ['api', 'protected'];
  for (const d of dirs){
    for (const f of fs.readdirSync(path.join(ROOT, d))){
      if (!/\.(js|html)$/.test(f)) continue;
      const c = read(path.join(d, f)).replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
      assert.equal(/signInWithPassword|type=["']password["']|grant_type=password/i.test(c),
        false, d + '/' + f + ' introduces a password path');
    }
  }
  assert.match(FACTS, /Sign-in is a magic link/);
});

test('a magic link cannot be redirected somewhere we do not control', () => {
  // An attacker-supplied redirect would hand them the tokens in the link.
  const signin = code('api/beta-signin.js');
  assert.match(signin, /function safeRedirect/);
  assert.match(signin, /redirect_to=' \+ encodeURIComponent\(redirect\)/,
    'the target must be the one we validated, not one from the body');
  // And the validated one is exported so it can be exercised directly.
  const mod = require(path.join(ROOT, 'api', 'beta-signin.js'));
  assert.equal(typeof mod.safeRedirect, 'function');
});

// ===========================================================================
// STRAVA
// ===========================================================================
test('the Strava scopes are the minimum that makes the feature work', () => {
  assert.equal(S.STRAVA_SCOPE, 'read,activity:read_all');
  // No write scope of any kind, and no profile scope.
  assert.equal(/activity:write|profile:write|read_all,|,read_all$/.test(S.STRAVA_SCOPE), false);
  assert.match(FACTS, /`read,activity:read_all`/);
});

test('disconnect removes the tokens AND everything derived from them', () => {
  // Deleting the tokens and keeping the payloads is neither what "disconnect"
  // means to an athlete nor defensible under Strava's retention terms.
  const auth = code('api/_strava-auth.js');
  assert.match(auth, /S\.deleteStagedActivities\(cfg, uid\)/);
  assert.match(auth, /STRAVA_DEAUTH_URL/, 'and it deauthorises at Strava');
  assert.match(auth, /deleteConnection/);
});

test('a Strava token is not reachable from any browser', () => {
  const setup = sql('supabase-setup.sql');
  assert.match(setup, /alter table public\.strava_connections enable row level security/);
  const files = fs.readdirSync(ROOT).filter(f => /^supabase-.*\.sql$/.test(f));
  for (const f of files){
    assert.equal(/create policy[^;]*on public\.strava_connections\b/i.test(sql(f)), false,
      f + ' gives a browser role a way to read Strava tokens');
  }
  // And the shipped runtime never names the table.
  const runtime = read('protected/velvet-viking-valhalla.html');
  assert.equal(/strava_connections/.test(runtime), false);
});

test('a dead Strava grant is cleared rather than papered over', () => {
  const strava = code('api/_strava.js');
  const at = strava.indexOf('grant_type: \'refresh_token\'');
  assert.ok(at > 0);
  assert.match(strava.slice(at, at + 700), /deleteConnection|delete/i,
    'a rejected refresh must stop reporting the athlete as connected');
});

// ===========================================================================
// THE PROVIDER SEAM
// ===========================================================================
test('only one file per rail knows a provider, and today there is one rail', () => {
  const neutral = ['_products.js', '_entitlement.js', '_commercial-store.js',
                   '_pause.js', '_access.js', '_billing.js'];
  for (const f of neutral){
    const c = code(path.join('api', f));
    assert.equal(/\bstripe\b/i.test(c), false, 'api/' + f + ' names the processor');
    assert.equal(/api\.stripe\.com|StoreKit|play\.google\.com\/billing/i.test(c), false);
  }
  assert.deepEqual(P.PROVIDERS, ['web', 'apple', 'google']);
  const stripeSrc = code('api/_stripe.js');
  assert.match(stripeSrc, /const PROVIDER = 'web';/,
    'Stripe is the processor beneath the web rail, never a provider value');
});

test('one athlete, one live subscription, whichever rail it came from', () => {
  const onApple = { provider: 'apple', product_code: P.STANDARD, condition: 'active',
                    current_period_end: '2027-01-01T00:00:00Z' };
  const r = E.mayStartStandardPurchase({
    provider: 'web', subscriptions: [onApple], account: {}, now: new Date('2026-09-01T00:00:00Z')
  });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'already_subscribed_elsewhere',
    'the product must be able to say WHICH rail, or it points them at the wrong screen');
  assert.equal(r.existingProvider, 'apple');
});

test('one trial per athlete, and the allowance is not a provider fact', () => {
  // Apple does not know about a trial taken on the web. An athlete who could
  // take one per rail would get six weeks by changing which button they press.
  const spent = { trial_consumed_at: '2026-01-01T00:00:00Z', trial_consumed_provider: 'web' };
  for (const provider of ['web', 'apple', 'google']){
    const r = E.mayStartStandardPurchase({
      provider: provider, subscriptions: [], account: spent, now: new Date('2026-09-01T00:00:00Z')
    });
    assert.equal(r.trial.eligible, false, provider + ' would hand out a second trial');
  }
  const core = sql('supabase-commercial-core.sql');
  assert.match(core, /create table if not exists public\.account_commercial/);
  assert.match(core, /trial_consumed_at/);
});

test('the boundary document describes the code as it is', () => {
  const doc = read('STORE-COMMERCIAL-BOUNDARY.md');
  assert.match(doc, /`web` \| `apple` \| `google`/);
  assert.match(doc, /Stripe is the processor beneath the web rail/);
  // The neutrality table must not claim a file is neutral that is not.
  for (const f of ['_products.js', '_entitlement.js', '_commercial-store.js', '_pause.js', '_access.js']){
    assert.ok(doc.indexOf(f) !== -1, doc + ' no longer lists ' + f);
  }
  assert.match(doc, /no unapproved store purchase flow is\s*\nenabled anywhere/);
});
