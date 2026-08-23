'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const A = require('../api/_access.js');
const SUB = require('../api/_subscription.js');
const { loadApp } = require('./harness.js');

// Phase 3A2. The question this answers is not "how do we stop people who have
// not paid" -- 3A1 answered that, and the delivery gate is the answer. It is
// the question underneath: what does an athlete still have when they have
// nothing?
//
// Four things, and they are a stated contract rather than whatever happens to
// survive a refusal: see their state and pay again, take every byte of their
// training out, close the account entirely, and read the privacy policy. An
// athlete locked out of the app has no other route to any of them, which is
// why account.html is public by construction and why these live there.
//
// The failure this prevents is concrete and commercial: a lapsed subscriber
// with nowhere to pay is a support ticket, and then a chargeback.
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ACCOUNT = read('account.html');
const NOW = new Date('2026-06-01T12:00:00Z');
const days = n => new Date(NOW.getTime() + n * 24 * 3600e3).toISOString();

const denied = ent => A.resolveAccess({ uid: 'u1', entitlement: ent || null,
  accountRequired: true, commercialRequired: true, now: NOW });

// ---------------------------------------------------------------------------
// THE CONTRACT
// ---------------------------------------------------------------------------
test('a refusal states what the athlete keeps, rather than leaving it blank', () => {
  const d = denied();
  assert.equal(d.allow, false);
  assert.deepEqual(d.locked_capabilities.slice().sort(),
    ['account_delete', 'account_manage', 'data_export', 'legal']);
  assert.deepEqual(d.capabilities, [],
    'and nothing that produces or interprets training');
});

test('the locked set never includes any part of the product', () => {
  const product = A.capabilitiesFor('standard');
  A.lockedCapabilities().forEach(c =>
    assert.ok(product.indexOf(c) === -1,
      c + ' is in the paid tier — the locked shell is the door, not a sample'));
  ['plan_generation', 'adaptation', 'execution_review', 'next_move', 'core_coach']
    .forEach(c => assert.ok(A.lockedCapabilities().indexOf(c) === -1,
      c + ' must never survive a refusal'));
});

test('the list is a copy, so a caller cannot edit the contract', () => {
  const a = A.lockedCapabilities();
  a.push('plan_generation');
  assert.equal(A.lockedCapabilities().indexOf('plan_generation'), -1);
});

test('every reason for refusal keeps the same four', () => {
  [null,
   { state: 'expired', access_until: days(-1) },
   { state: 'active', access_until: days(-1) },
   { state: 'cancelled', access_until: days(5) }
  ].forEach(ent => {
    const d = denied(ent);
    assert.equal(d.allow, false, JSON.stringify(ent));
    assert.deepEqual(d.locked_capabilities.slice().sort(),
      ['account_delete', 'account_manage', 'data_export', 'legal'],
      'the reason someone lost access does not change what they keep');
  });
});

// ---------------------------------------------------------------------------
// THE ENDPOINT THAT TALKS TO A LOCKED-OUT ATHLETE
// ---------------------------------------------------------------------------
test('subscription status answers a lapsed athlete rather than refusing them', () => {
  const src = read('api/_subscription.js');
  assert.match(src, /if \(req\.method === 'GET'\)\{[\s\S]*?S\.json\(res, 200, publicView/,
    '403 here would leave the locked shell with nothing to say');
});

test('the view says what the screen needs and nothing that identifies a third party', () => {
  const v = SUB.publicView(denied({ state: 'expired', access_until: days(-2) }),
    { provider_customer_id: 'cus_SECRET', provider_sub_id: 'sub_SECRET', event_seq: 12 },
    'u1', 'a@b.c');
  ['provider', 'provider_customer_id', 'provider_sub_id', 'event_seq', 'last_event_at']
    .forEach(k => assert.ok(!(k in v), k + ' is plumbing, and it identifies the athlete to a provider'));
  assert.equal(JSON.stringify(v).indexOf('SECRET'), -1);
  assert.equal(v.access, false);
  assert.deepEqual(v.locked_capabilities.slice().sort(),
    ['account_delete', 'account_manage', 'data_export', 'legal']);
  assert.ok(!Object.prototype.hasOwnProperty.call(v, 'grace_days'),
    'the shell is not told a grace length, because Valhalla does not invent one');
});

test('the locked set is present even when access is fine', () => {
  const ok = A.resolveAccess({ uid: 'u1', entitlement: { state: 'active', access_until: days(30) },
    accountRequired: true, commercialRequired: true, now: NOW });
  const v = SUB.publicView(ok, {}, 'u1', 'a@b.c');
  assert.equal(v.access, true);
  assert.deepEqual(v.locked_capabilities.slice().sort(),
    ['account_delete', 'account_manage', 'data_export', 'legal'],
    'what an athlete keeps is a promise, so it is stated before they need it');
});

test('checkout is honest about not being configured', () => {
  const saved = process.env.VVV_CHECKOUT_URL;
  delete process.env.VVV_CHECKOUT_URL;
  try{
    assert.equal(SUB.checkoutUrl(), '');
    assert.equal(SUB.publicView(denied(), {}, 'u1', null).checkout_configured, false);
    assert.match(read('api/_subscription.js'), /CHECKOUT_NOT_CONFIGURED/,
      'a button that opens nothing is worse than a sentence saying payments are not open');
  } finally { if (saved === undefined) delete process.env.VVV_CHECKOUT_URL; else process.env.VVV_CHECKOUT_URL = saved; }
});

test('checkout carries the athlete’s id and not their email', () => {
  const src = read('api/_subscription.js');
  assert.match(src, /client_reference_id=' \+ encodeURIComponent\(who\.uid\)/,
    'the provider must hand something back that lands the payment on the right row');
  assert.ok(!/checkout[\s\S]{0,200}who\.email/.test(src),
    'an email address has no reason to ride in a URL that ends up in browser history');
});

// ---------------------------------------------------------------------------
// EXPORT
// ---------------------------------------------------------------------------
test('export is server-side, so it works from a device that never held the plan', () => {
  const src = read('api/_account-data.js');
  assert.match(src, /S\.verifyUser\(req, cfg\)/);
  assert.match(src, /\/plans\?select=data,updated_at&user_id=eq\.' \+\s*encodeURIComponent\(who\.uid\)/,
    'scoped to the verified uid, with no parameter that could name somebody else');
  assert.ok(!/req\.query|body\.user_id/.test(src), 'there must be no way to ask for another athlete');
});

test('export summarises the entitlement instead of dumping provider references', () => {
  const ENT = require('../api/_account-data.js').entitlementSummary;
  const s = ENT({ state: 'expired', tier: 'standard', access_until: days(-1),
                  provider_customer_id: 'cus_SECRET', provider_sub_id: 'sub_SECRET',
                  event_seq: 9, override: 'beta' });
  assert.equal(JSON.stringify(s).indexOf('SECRET'), -1);
  assert.equal(s.state, 'expired');
  assert.equal(s.override, 'beta');
});

test('an athlete with no cloud copy gets an answer, not an error', () => {
  assert.match(read('api/_account-data.js'), /plan_present: !!row/,
    '"I exported and got nothing" must never be confusable with "the export is broken"');
});

test('the shell exports both copies when both exist', () => {
  assert.match(ACCOUNT, /account_plan: b\.plan[\s\S]{0,200}this_device_plan: localPlan\(\)/,
    'the device may hold sessions logged after the last backup, and an export ' +
    'that silently picked one would be this product choosing between two plans');
});

// ---------------------------------------------------------------------------
// DELETION
// ---------------------------------------------------------------------------
test('deletion still goes through the database function, with the athlete’s own token', () => {
  const src = read('api/_account-delete.js');
  assert.match(src, /rpc\/delete_own_account/, 'the same SECURITY DEFINER function Settings calls');
  assert.match(src, /'Authorization': 'Bearer ' \+ token/,
    'forwarded, never substituted — auth.uid() inside Postgres stays the authority');
  assert.ok(!/S\.sb\(cfg, '\/rest\/v1\/rpc/.test(src),
    'reaching for the service key here would promote self-service into administrative');
  assert.ok(!/body\.user_id|req\.query/.test(src), 'there must be no way to name another account');
});

test('Strava is disconnected before the account that authorises it disappears', () => {
  const src = read('api/_account-delete.js');
  const stravaAt = src.indexOf('/api/strava-auth');
  const deleteAt = src.indexOf('rpc/delete_own_account');
  assert.ok(stravaAt > 0 && stravaAt < deleteAt,
    'deleting first strands the authorization: gone from VVV, still listed on Strava');
});

test('deletion revokes leases and clears the cookie', () => {
  const src = read('api/_account-delete.js');
  assert.match(src, /revokeLeasesForUser/);
  assert.match(src, /Set-Cookie', A\.clearCookie\(\)/,
    'a cookie is not a database row and does not cascade');
});

test('the shell warns twice and tells the athlete to export first', () => {
  assert.ok((ACCOUNT.match(/window\.confirm/g) || []).length >= 2,
    'irreversible, and reached by someone who did not come here intending it');
  assert.match(ACCOUNT, /export your training first/i);
});

test('deleting the account does not delete the plan on the device', () => {
  assert.match(ACCOUNT, /training block on this device is still here/i);
  assert.ok(!/removeItem\('velvet-viking-generator-v2'\)/.test(ACCOUNT),
    'the runner\'s own copy on their own hardware is not ours to wipe');
});

// ---------------------------------------------------------------------------
// THE SHELL ITSELF
// ---------------------------------------------------------------------------
test('all four capabilities are actually reachable on the page', () => {
  ['id="resubscribe"', 'id="export"', 'id="delete"', 'href="/privacy"']
    .forEach(m => assert.ok(ACCOUNT.indexOf(m) !== -1, 'the locked shell is missing ' + m));
});

test('the locked shell exposes no part of the product', () => {
  const locked = /<div id="pane-locked"[\s\S]*?<\/div>\s*<div class="vvv-foot"/.exec(ACCOUNT);
  assert.ok(locked, 'no locked pane found');
  [/plan|workout|session|coach/i].forEach(rx => {
    const offending = (locked[0].match(rx) || [])[0];
    // "training" and "training block" are allowed -- they describe the data
    // being exported. What must not appear is a way to USE it.
    assert.ok(!/data-action|generate|build my plan/i.test(locked[0]),
      'the locked shell is the door, not a sample: ' + offending);
  });
});

test('a signed-out athlete still gets the sign-in form, not the locked shell', () => {
  assert.match(ACCOUNT, /show\('signin'\)/);
  assert.match(ACCOUNT, /\['signin','working','locked'\]/,
    'three panes, one of which is showing');
});

test('resubscribe is hidden rather than greyed out when payments are not open', () => {
  assert.match(ACCOUNT, /\$\('resubscribe'\)\.classList\.toggle\('vvv-hidden', hasAccess \|\| !v\.checkout_configured\)/,
    'a disabled button invites a message asking when it will work');
});

// ---------------------------------------------------------------------------
// WHAT THE APP TELLS THE ATHLETE
// ---------------------------------------------------------------------------
test('the app says nothing about a subscription while nothing is being sold', () => {
  const a = loadApp();
  assert.equal(a.subscriptionSentence({ signed_in: true, state: 'expired',
    access_until: days(-1), commercial_required: false }), '',
    'inventing reassurance for a product that is not selling anything is a claim we do not make');
});

test('each commercial state gets its own sentence, and cancelled is not ended', () => {
  const a = loadApp();
  const say = o => a.subscriptionSentence(Object.assign(
    { signed_in: true, commercial_required: true }, o));
  const trial = say({ state: 'trial', access_until: days(10) });
  const active = say({ state: 'active', access_until: days(30) });
  const cancelled = say({ state: 'active', cancel_at_period_end: true, access_until: days(9) });
  const grace = say({ state: 'grace', access_until: days(4) });
  const ended = say({ state: 'expired', access_until: days(-2) });

  assert.match(trial, /Trial/i);
  assert.match(active, /active until/i);
  assert.match(cancelled, /paid up until/i);
  assert.ok(!/ended|expired/i.test(cancelled),
    'cancelled but paid through is not ended, and must not read as though it were');
  assert.match(grace, /didn.t go through/i);
  assert.match(ended, /ended on/i);
  assert.equal(new Set([trial, active, cancelled, grace, ended]).size, 5,
    'five situations needing five different things from the reader');
});

test('an override outranks any commercial sentence', () => {
  const a = loadApp();
  ['owner', 'beta'].forEach(ov => {
    const s = a.subscriptionSentence({ signed_in: true, commercial_required: true,
      override: ov, state: 'expired', access_until: days(-30) });
    assert.ok(!/ended|expired/i.test(s), ov + ' must never be told their access ended');
  });
});

test('subscription copy carries no terminal full stop and no invented claim', () => {
  const a = loadApp();
  const all = [
    { state: 'trial', access_until: days(10) },
    { state: 'active', access_until: days(30) },
    { state: 'active', cancel_at_period_end: true, access_until: days(9) },
    { state: 'grace', access_until: days(4) },
    { state: 'expired', access_until: days(-2) },
    { override: 'owner' }, { override: 'beta' }
  ].map(o => a.subscriptionSentence(Object.assign({ signed_in: true, commercial_required: true }, o)));
  all.forEach(s => {
    assert.ok(!/\.$/.test(s), 'a card heading does not end in a full stop: ' + s);
    assert.ok(!/free|forever|cancel any ?time|guarantee/i.test(s),
      'no claim the product has not earned: ' + s);
  });
});

test('a broken timestamp never reaches the athlete as Invalid Date', () => {
  const a = loadApp();
  assert.equal(a.dLong('whenever'), '');
  assert.equal(a.dLong(null), '');
  const s = a.subscriptionSentence({ signed_in: true, commercial_required: true,
    state: 'active', access_until: 'whenever' });
  assert.ok(!/Invalid|NaN|undefined/.test(s), s);
});

test('the app still treats entitlement display as display only', () => {
  const src = read('protected/velvet-viking-valhalla.html');
  const fn = /function subscriptionSentence\(info\)\{[\s\S]*?\n\}/.exec(src)[0];
  [/localStorage/, /writeStored/, /state\.days/, /cloudPutPlan/, /fetch\(/]
    .forEach(rx => assert.ok(!rx.test(fn), 'a sentence must not do anything: ' + rx));
});
