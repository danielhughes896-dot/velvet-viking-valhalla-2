'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const A = require('../api/_access.js');

// The account gate decides whether an athlete is handed the VVV runtime at all,
// so these tests drive the REAL decision function and the REAL cookie builder
// from api/_access.js rather than a description of them.
//
// Two properties matter more than any individual case:
//   * with the flag off, nothing changes for anybody -- that is what makes the
//     architecture deployable before it is activated;
//   * nothing a client can say about itself ever appears in the decision. The
//     inputs are the server-read entitlement row and the server-held flags.

const NOW = new Date('2026-03-11T09:00:00Z');
const UID = 'uid-athlete-1';
const ent = (over) => Object.assign({
  state: 'expired', tier: 'standard', access_until: null,
  cancel_at_period_end: false, override: null, override_expires_at: null,
}, over || {});

// The two flag states this phase cares about. COMMERCIAL_REQUIRED stays off
// throughout 3A1 -- the cases where it is on are here to prove the foundation
// is already correct, not because anything switches them on yet.
const gateOff = { accountRequired: false, commercialRequired: false };
const gateOn = { accountRequired: true, commercialRequired: false };
const decide = (extra) => A.resolveAccess(Object.assign({ now: NOW }, gateOff, extra));

// ---------------------------------------------------------------------------
// ACCOUNT_REQUIRED OFF -- CURRENT BEHAVIOUR IS PRESERVED EXACTLY
// ---------------------------------------------------------------------------
test('with the gate off an anonymous visitor is still admitted', () => {
  const d = decide({ uid: null });
  assert.equal(d.allow, true);
  assert.equal(d.reason, 'account_gate_off',
    'deploying the gate must not change what today’s athletes experience');
});

test('with the gate off an athlete with no entitlement row is admitted', () => {
  const d = decide({ uid: UID, entitlement: null });
  assert.equal(d.allow, true);
});

test('the flag is off unless a deployment says otherwise, in so many words', () => {
  ['', null, undefined, '0', 'false', 'off', 'no', 'maybe', 'TRUE '].forEach(v => {
    const on = A.flagOn(v);
    if (String(v).trim().toLowerCase() === 'true') assert.equal(on, true);
    else assert.equal(on, false, JSON.stringify(v) + ' must not switch the gate on');
  });
  ['1', 'true', 'on', 'yes', 'YES', ' On '].forEach(v => {
    assert.equal(A.flagOn(v), true, JSON.stringify(v) + ' should switch it on');
  });
});

// ---------------------------------------------------------------------------
// ACCOUNT_REQUIRED ON
// ---------------------------------------------------------------------------
test('with the gate on an anonymous visitor is refused', () => {
  const d = A.resolveAccess(Object.assign({ now: NOW, uid: null }, gateOn));
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'no_account');
  assert.deepEqual(d.capabilities, [], 'a refusal grants nothing');
});

test('an owner is admitted', () => {
  const d = A.resolveAccess(Object.assign({ now: NOW, uid: UID, entitlement: ent({ override: 'owner' }) }, gateOn));
  assert.equal(d.allow, true);
  assert.equal(d.reason, 'override_owner');
});

/* THE COMMERCIAL GATE, as distinct from `gateOn` above -- which switches on the
   ACCOUNT requirement and deliberately leaves commerce off, because that was
   the 3A1 migration posture. Launch is both flags on. */
const commerceLive = { accountRequired: true, commercialRequired: true };

test('a beta override no longer admits anybody', () => {
  /* COMMERCIAL LAUNCH. The private beta is over and beta is not an
     access-bearing override any more. This test asserted the opposite for the
     whole of the beta, and it is inverted rather than deleted because the
     inversion IS the launch: the row can still say 'beta' -- the column
     outlives the programme, and rows written before the change are re-projected
     only when something happens to that account -- and the gate must refuse it
     anyway. That is why _access.js checks the column itself instead of trusting
     the resolver to have stopped writing it. */
  const d = A.resolveAccess(Object.assign({ now: NOW, uid: UID, entitlement: ent({ override: 'beta' }) }, commerceLive));
  assert.equal(d.allow, false, 'a retired beta override still opened the product');
  assert.notEqual(d.reason, 'override_beta');
});

test('the overrides that DO still admit somebody are a stated list', () => {
  /* An override outranks every commercial rule, so which ones exist is the
     most security-relevant list in the file and is asserted rather than
     assumed. A new value appearing here should fail this test and make
     somebody argue for it. */
  assert.deepEqual(A.ACCESS_OVERRIDES.slice().sort(), ['owner', 'promo']);
  ['owner', 'promo'].forEach(o => {
    const d = A.resolveAccess(Object.assign({ now: NOW, uid: UID, entitlement: ent({ override: o }) }, commerceLive));
    assert.equal(d.allow, true, o + ' stopped granting access');
    assert.equal(d.reason, 'override_' + o);
  });
  ['beta', 'tester', '', 'BETA', 'admin'].forEach(o => {
    const d = A.resolveAccess(Object.assign({ now: NOW, uid: UID, entitlement: ent({ override: o }) }, commerceLive));
    assert.equal(d.allow, false, JSON.stringify(o) + ' opened the product');
  });
});

test('an ordinary new account cannot reach the product', () => {
  /* The whole commercial claim, in one assertion: authenticated, no grant, no
     subscription, no override -- and no way in. */
  const d = A.resolveAccess(Object.assign({ now: NOW, uid: UID, entitlement: null }, commerceLive));
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'no_entitlement');
});

test('a revoked beta tester is refused once commerce is live', () => {
  // override removed by the operator; no subscription behind it
  const row = ent({ override: null });
  const during3A1 = A.resolveAccess({ now: NOW, uid: UID, entitlement: row, accountRequired: true, commercialRequired: false });
  assert.equal(during3A1.allow, true, 'while commerce is off, an account is enough -- by design');
  const after = A.resolveAccess({ now: NOW, uid: UID, entitlement: row, accountRequired: true, commercialRequired: true });
  assert.equal(after.allow, false, 'and the moment it is on, the withdrawal bites');
  assert.equal(after.reason, 'expired');
});

test('an expired override stops granting access', () => {
  const row = ent({ override: 'promo', override_expires_at: '2026-03-01T00:00:00Z' });
  const d = A.resolveAccess({ now: NOW, uid: UID, entitlement: row, accountRequired: true, commercialRequired: true });
  assert.equal(d.allow, false, 'a time-limited tester is time-limited');
});

test('an ordinary authenticated athlete is admitted while commerce is off', () => {
  const d = A.resolveAccess(Object.assign({ now: NOW, uid: UID, entitlement: ent() }, gateOn));
  assert.equal(d.allow, true);
  assert.equal(d.reason, 'pre_commercial',
    'the 3A1 migration policy, and the reason the gate can ship before payments');
});

// ---------------------------------------------------------------------------
// THE COMMERCIAL FOUNDATION IS ALREADY CORRECT (inert until 3A2)
// ---------------------------------------------------------------------------
test('an override outranks a lapsed subscription', () => {
  const row = ent({ override: 'owner', state: 'expired', access_until: '2020-01-01T00:00:00Z' });
  const d = A.resolveAccess({ now: NOW, uid: UID, entitlement: row, accountRequired: true, commercialRequired: true });
  assert.equal(d.allow, true, 'an owner is not a kind of subscriber');
});

test('access is decided by the timestamp, not by the state word', () => {
  const lying = ent({ state: 'active', access_until: '2026-03-01T00:00:00Z' });   // says active, ran out
  const d = A.resolveAccess({ now: NOW, uid: UID, entitlement: lying, accountRequired: true, commercialRequired: true });
  assert.equal(d.allow, false,
    'a row whose state and expiry disagree must fail closed, not open');
});

test('cancelled-but-paid-through is still access', () => {
  const row = ent({ state: 'active', cancel_at_period_end: true, access_until: '2026-04-01T00:00:00Z' });
  const d = A.resolveAccess({ now: NOW, uid: UID, entitlement: row, accountRequired: true, commercialRequired: true });
  assert.equal(d.allow, true, 'cancelling is not the same as ending');
  assert.equal(d.cancel_at_period_end, true, 'and the UI can still say so');
});

test('trial and grace both carry access while their clock runs', () => {
  ['trial', 'grace'].forEach(state => {
    const row = ent({ state: state, access_until: '2026-04-01T00:00:00Z' });
    const d = A.resolveAccess({ now: NOW, uid: UID, entitlement: row, accountRequired: true, commercialRequired: true });
    assert.equal(d.allow, true, state + ' should still open the product');
  });
});

// ---------------------------------------------------------------------------
// NOTHING A CLIENT SAYS ENTERS THE DECISION
// ---------------------------------------------------------------------------
test('no client-supplied field can manufacture access', () => {
  const spoofed = {
    now: NOW, uid: UID, accountRequired: true, commercialRequired: true,
    entitlement: ent(),                       // genuinely expired
    // everything a tampered client might send
    allow: true, access: true, tier: 'pro', capabilities: ['everything'],
    override: 'owner', state: 'active', entitled: true, admin: true,
  };
  const d = A.resolveAccess(spoofed);
  assert.equal(d.allow, false,
    'the decision reads the server row and the server flags -- nothing else');
  assert.deepEqual(d.capabilities, []);
});

test('a forged localStorage entitlement is not an input at all', () => {
  const d = A.resolveAccess({
    now: NOW, uid: UID, entitlement: null,
    accountRequired: true, commercialRequired: true,
  });
  assert.equal(d.allow, false, 'no row, no access -- there is nowhere for a spoof to land');
});

// ---------------------------------------------------------------------------
// CAPABILITIES, NOT TIER NAMES
// ---------------------------------------------------------------------------
test('the coaching core is one capability set, addressed by name', () => {
  const caps = A.capabilitiesFor('standard');
  ['core_coach', 'plan_generation', 'execution_review', 'next_move', 'adaptation', 'cloud_sync']
    .forEach(c => assert.ok(caps.indexOf(c) !== -1, 'standard must include ' + c));
});

test('an unknown tier degrades to standard rather than to nothing', () => {
  assert.deepEqual(A.capabilitiesFor('pro'), A.capabilitiesFor('standard'),
    'until Pro exists it cannot mean less than Standard');
  assert.deepEqual(A.capabilitiesFor(undefined), A.capabilitiesFor('standard'));
});

test('capability lists are copies, so a caller cannot edit the map', () => {
  const caps = A.capabilitiesFor('standard');
  caps.push('admin_everything');
  assert.equal(A.capabilitiesFor('standard').indexOf('admin_everything'), -1);
});

// ---------------------------------------------------------------------------
// THE DELIVERY COOKIE
// ---------------------------------------------------------------------------
test('the cookie is Secure, HttpOnly and SameSite=Lax', () => {
  const c = A.buildSetCookie('lease-abc');
  assert.match(c, /^vvv_gate=lease-abc;/);
  assert.match(c, /HttpOnly/, 'no script may read or forge it');
  assert.match(c, /Secure/, 'never over plain http');
  assert.match(c, /SameSite=Lax/,
    'Strict would be withheld on the magic-link navigation from the email client');
  assert.match(c, /Path=\//);
});

test('the cookie expires with the lease', () => {
  assert.match(A.buildSetCookie('x'), new RegExp('Max-Age=' + A.LEASE_TTL_SEC));
  assert.equal(A.LEASE_TTL_SEC, 12 * 60 * 60, 'the settled 12-hour window');
});

test('clearing the cookie actually expires it', () => {
  assert.match(A.clearCookie(), /Max-Age=0/);
  assert.match(A.clearCookie(), /HttpOnly/);
});

test('cookie parsing survives the shapes a real header takes', () => {
  const p = A.parseCookies('a=1; vvv_gate=abc%2Fdef; b=; c=x=y');
  assert.equal(p.vvv_gate, 'abc/def', 'percent-encoding is undone');
  assert.equal(p.a, '1');
  assert.equal(p.b, '');
  assert.equal(p.c, 'x=y', 'a value containing = is not truncated');
});

test('a request with no cookies yields no lease', () => {
  assert.equal(A.readGateCookie({ headers: {} }), null);
  assert.equal(A.readGateCookie({ headers: { cookie: 'other=1' } }), null);
  assert.equal(A.readGateCookie({}), null);
});

test('lease ids are unguessable and unique', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const id = A.newLeaseId();
    assert.ok(id.length >= 40, 'at least 256 bits of entropy, base64url encoded');
    assert.ok(!seen.has(id), 'collision');
    seen.add(id);
  }
});

// ---------------------------------------------------------------------------
// THE RUNTIME IS NO LONGER A STATIC ASSET
// ---------------------------------------------------------------------------
test('the runtime lives behind the delivery gate, not at the site root', () => {
  const fs = require('fs');
  const root = path.join(__dirname, '..');
  assert.ok(!fs.existsSync(path.join(root, 'velvet-viking-valhalla.html')),
    'a copy at the root would be served statically and bypass /api/app entirely');
  assert.ok(fs.existsSync(path.join(root, 'protected', 'velvet-viking-valhalla.html')));
});

test('every route to the runtime goes through the gate', () => {
  const cfg = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const routes = cfg.routes || [];
  const fsIndex = routes.findIndex(r => r.handle === 'filesystem');
  assert.ok(fsIndex > 0, 'the filesystem handler must come after the guards');

  const guards = routes.slice(0, fsIndex).filter(r => r.dest === '/api/app').map(r => r.src);
  ['/', '/protected/(.*)'].forEach(src => {
    assert.ok(guards.indexOf(src) !== -1, src + ' must be routed to the gate before the filesystem');
  });
  // and no route may serve the protected directory as a static file
  routes.slice(0, fsIndex).forEach(r => {
    if (r.dest && /protected/.test(r.dest)) assert.fail('route exposes protected/: ' + JSON.stringify(r));
  });
});

test('the gate resolves the runtime from the protected directory', () => {
  const app = require('../api/app.js');
  assert.match(app.RUNTIME_FILE, /protected[\\/]velvet-viking-valhalla\.html$/);
  assert.ok(require('fs').existsSync(app.RUNTIME_FILE), 'and that file is really there');
});

test('the test harness reads the same file the gate serves', () => {
  const { RUNTIME_RELATIVE } = require('./harness.js');
  const app = require('../api/app.js');
  assert.equal(path.resolve(__dirname, '..', RUNTIME_RELATIVE), path.resolve(app.RUNTIME_FILE),
    'if these drifted, 160 tests would be validating something that never ships');
});
