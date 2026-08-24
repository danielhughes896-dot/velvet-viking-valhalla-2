'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const Agree = require('../api/_agreements.js');
const Prod = require('../api/_products.js');
const Checkout = require('../api/_checkout.js');
const HC = require('../api/_health-consent.js');

/* WHAT A PAYING CUSTOMER AGREED TO, AND WHEN.
 *
 * Two agreements, neither of them Article 9 health consent, and neither of them
 * a privacy "consent":
 *
 *   TERMS            which published version was in front of them.
 *   IMMEDIATE START  the acknowledgement that they are asking us to begin a
 *                    digital service inside the statutory cancellation period
 *                    for a distance contract, and that beginning it affects
 *                    that right.
 *
 * The failure this guards against is not a missing checkbox. It is a checkout
 * that takes money on evidence a browser asserted, wording nobody can prove was
 * shown, or a version that quietly re-points an old "yes" at new text. Every
 * assertion below exists because one of those is a way to end up unable to
 * evidence a contract you have already charged for.
 */

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const okRes = rows => ({ ok: true, status: 200, json: async () => rows });
const sbReturning = rows => async () => okRes(rows);
const CFG = {}, UID = 'u1';
const row = over => Object.assign({
  decision: 'accepted', agreement_version: Agree.TERMS_VERSION, decided_at: '2026-08-01T00:00:00Z'
}, over || {});

// ===========================================================================
// THE THREE THINGS THAT MUST STAY SEPARATE
// ===========================================================================
test('Terms, immediate start and Article 9 health consent are three separate records', () => {
  /* One tick standing for all three is the single worst outcome available
     here: it makes "did they consent to health processing" unanswerable
     without also asking about Terms, and it makes withdrawal of the one
     impossible without repudiating the others. */
  assert.deepEqual(Agree.TYPES, ['terms', 'immediate_start']);
  assert.ok(Agree.TYPES.indexOf('health') === -1);
  assert.ok(Agree.TYPES.indexOf('privacy') === -1);

  /* Article 9 lives in its own module against its own table, untouched. */
  assert.equal(HC.HEALTH_CONSENT_VERSION, 'health_data_consent_v1');
  const agreements = read('api/_agreements.js');
  assert.ok(agreements.indexOf('health_data_consent') === -1,
    'the agreements module must not reach into the Article 9 table');

  const sql = read('supabase-account-agreements.sql');
  assert.ok(sql.indexOf('health_data_consent') === -1 || /NOT HERE|stays in/.test(sql),
    'the agreements migration must not touch the consent table');
});

test('privacy is a notice and can never become a consent', () => {
  /* Asking somebody to consent to being informed is meaningless, and implying
     consent is the lawful basis for the whole product is worse. The version is
     recorded as context on a Terms row; there is no privacy decision. */
  const a = Agree.currentAgreements();
  assert.equal(a.privacy.version, Agree.PRIVACY_VERSION);
  assert.equal(a.privacy.note, 'notice, not consent');
  assert.equal(a.privacy.type, undefined, 'privacy must not be an agreement type');

  const sql = read('supabase-account-agreements.sql');
  assert.match(sql, /agreement_type in \('terms', 'immediate_start'\)/,
    'the database vocabulary must be closed to these two');
});

// ===========================================================================
// THE ACKNOWLEDGEMENT IS AFFIRMATIVE, AND IT IS NOT INFERRED
// ===========================================================================
test('the immediate-start acknowledgement is its own affirmative act', () => {
  const a = Agree.currentAgreements();
  assert.equal(a.immediateStart.type, 'immediate_start');
  assert.equal(a.immediateStart.version, 'immediate_start_v1');
  assert.equal(a.immediateStart.mustBeAffirmative, true);
  assert.equal(a.immediateStart.preTicked, false);

  /* The wording carries the four things the concept requires: the trial starts
     now, the service begins immediately, that affects the cancellation right,
     and they can still cancel free before the trial ends. */
  const t = a.immediateStart.text;
  assert.match(t, /14 days start now/);
  assert.match(t, /begin the service during the 14-day period/);
  assert.match(t, /affects that right/);
  assert.match(t, /cancel at any time before the trial ends and you will not be charged/);
});

test('nothing else can stand in for the acknowledgement', () => {
  /* Creating an account, accepting Terms, supplying a card, pressing Start
     Trial and answering the health question are five different acts. None of
     them is this one, and the gate proves it by refusing when only the others
     are present. */
  const base = { commerceEnabled: true, isLiveKey: false, stripeConfigured: true,
                 uid: 'u1', period: 'monthly', purchaseCheck: { allowed: true } };
  const withEvidence = e => Checkout.decideCheckout(Object.assign({}, base, { evidence: e }));

  const termsOnly = withEvidence({ ok: false, reason: 'immediate_start_not_acknowledged',
                                   terms: true, immediateStart: false });
  assert.equal(termsOnly.ok, false);
  assert.equal(termsOnly.code, 'immediate_start_not_acknowledged');
  assert.equal(termsOnly.status, 409);
  assert.deepEqual(termsOnly.agreements, { terms: true, immediateStart: false });

  const neither = withEvidence({ ok: false, reason: 'terms_not_accepted',
                                 terms: false, immediateStart: false });
  assert.equal(neither.code, 'terms_not_accepted');

  const both = withEvidence({ ok: true, terms: true, immediateStart: true });
  assert.equal(both.ok, true, 'with both on record the purchase may proceed');
});

test('the acknowledgement is enforced by the server, not by a checkbox', () => {
  /* A tick is a claim a browser makes. The refusal that matters is the one in
     front of the Checkout Session, reading a table the browser cannot write
     except through a policy that pins it to their own id. */
  const src = read('api/_checkout.js');
  assert.match(src, /Agree\.purchaseEvidence\(cfg, S\.sb, uid\)/,
    'checkout must read the evidence itself');
  assert.match(src, /o\.evidence && o\.evidence\.ok !== true/,
    'and refuse on it');
  /* Before the provider is called: the gate sits in decideCheckout, and the
     handler only reaches ensureCustomer/createCheckoutSession after it. */
  const decide = src.slice(src.indexOf('function decideCheckout'), src.indexOf('async function handle'));
  assert.ok(decide.indexOf('evidence') !== -1, 'the gate belongs in the pure decision');
  assert.ok(decide.indexOf('createCheckoutSession') === -1);
});

test('the browser cannot name the version it is agreeing to', () => {
  /* Otherwise a client could claim agreement to wording nobody showed it, or
     keep claiming v1 long after v2 replaced it. The row records the version
     this server currently serves. */
  const src = read('api/_agreements.js');
  const rec = src.slice(src.indexOf('async function record'));
  assert.match(rec.slice(0, 1600), /agreement_version:\s*versionFor\(i\.type\)/);
  assert.ok(!/agreement_version:\s*i\./.test(rec.slice(0, 1600)),
    'the version must never come from the caller');
  assert.match(rec.slice(0, 1600), /user_id:\s*userId/,
    'and the athlete must be the token holder');
});

// ===========================================================================
// VERSIONING: A SOLICITOR'S REVISION MUST NOT COST THE EVIDENCE
// ===========================================================================
test('an agreement to superseded wording stops counting, and nothing is lost', async () => {
  /* The whole reason the wording can ship as a business draft. When the
     reviewed text lands, the constant changes, this gate starts refusing, and
     every athlete is asked again -- while the v1 rows stay exactly as they
     are as the record of what was agreed before. */
  assert.equal(await Agree.hasAccepted(CFG, sbReturning([row()]), UID, 'terms'), true);

  assert.equal(await Agree.hasAccepted(CFG,
    sbReturning([row({ agreement_version: 'terms_v0' })]), UID, 'terms'), false,
    'superseded wording must not count');

  assert.equal(await Agree.hasAccepted(CFG,
    sbReturning([row({ agreement_version: 'terms_v2' })]), UID, 'terms'), false,
    'wording this build has never served must not count either');
});

test('the immediate-start wording is marked as a business draft, not as law', () => {
  /* It is deployed deliberately as a draft -- an athlete asked in draft wording
     is better off than one never asked -- but nothing in the repository may
     represent it as solicitor-approved. */
  const src = read('api/_agreements.js');
  assert.match(src, /BUSINESS DRAFT\. NOT SOLICITOR-APPROVED/);
  assert.match(src, /immediate_start_v2/,
    'the upgrade path should be written down where the constant is');
});

// ===========================================================================
// EVERY WAY OF NOT KNOWING IS A NO
// ===========================================================================
test('an unprovable agreement is no agreement', async () => {
  const cases = {
    'no rows':             async () => okRes([]),
    'declined':            async () => okRes([row({ decision: 'declined' })]),
    'table missing (404)': async () => ({ ok: false, status: 404 }),
    'outage (503)':        async () => ({ ok: false, status: 503 }),
    'threw':               async () => { throw new Error('network'); },
    'malformed body':      async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad'); } })
  };
  for (const [name, sb] of Object.entries(cases)){
    assert.equal(await Agree.hasAccepted(CFG, sb, UID, 'terms'), false, name);
  }
  assert.equal(await Agree.hasAccepted(CFG, null, UID, 'terms'), false, 'no fetcher');
  assert.equal(await Agree.hasAccepted(CFG, sbReturning([row()]), null, 'terms'), false, 'no athlete');
  assert.equal(await Agree.hasAccepted(CFG, sbReturning([row()]), UID, 'nonsense'), false, 'unknown type');
});

test('a rejected write is reported rather than assumed', async () => {
  const failing = async () => ({ ok: false, status: 503 });
  const r = await Agree.record(CFG, failing, UID,
    { type: 'terms', decision: 'accepted', surface: 'checkout' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'write_failed');

  for (const bad of [
    { type: 'health', decision: 'accepted', surface: 'checkout' },
    { type: 'terms', decision: 'maybe', surface: 'checkout' },
    { type: 'terms', decision: 'accepted', surface: 'billboard' }
  ]){
    const out = await Agree.record(CFG, sbReturning([]), UID, bad);
    assert.equal(out.ok, false, JSON.stringify(bad));
  }
});

test('the record is append-only: there is no path that rewrites one', () => {
  const src = read('api/_agreements.js');
  assert.ok(!/method:\s*'(PATCH|PUT|DELETE)'/.test(src),
    'the agreements module must only ever insert');
  const sql = read('supabase-account-agreements.sql');
  assert.match(sql, /for select using \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(sql, /for insert with check \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.ok(!/for (update|delete)/i.test(sql),
    'no UPDATE or DELETE policy may exist on the evidence table');
  assert.match(sql, /must be append-only/, 'and the migration should refuse if one appears');
});

test('decided_at is the athlete’s own moment, not the write’s', async () => {
  let sent = null;
  const sb = async (cfg, url, opts) => { sent = JSON.parse(opts.body); return okRes([]); };
  const theirMoment = '2026-08-24T09:15:00.000Z';
  await Agree.record(CFG, sb, UID, { type: 'immediate_start', decision: 'accepted',
    surface: 'checkout', offerCode: 'STANDARD_MONTHLY', decidedAt: theirMoment });
  assert.equal(sent.decided_at, theirMoment);
  assert.equal(sent.created_at, undefined, 'created_at is the server’s own view of arrival');
  assert.equal(sent.agreement_version, Agree.IMMEDIATE_START_VERSION);
  assert.equal(sent.offer_code, 'STANDARD_MONTHLY',
    'the acknowledgement is about beginning THIS service on THIS purchase');
  assert.equal(sent.privacy_version, null, 'privacy context belongs on a Terms row');
});

// ===========================================================================
// THE FIRST CHARGE HAS A DATE
// ===========================================================================
test('the catalogue carries the actual first-charge instant, not a duration', () => {
  const at = new Date('2026-08-24T09:00:00Z');
  const c = Prod.catalogue('web', {}, at);
  assert.equal(c.trialDays, 14);
  assert.equal(c.firstChargeAt, '2026-09-07T09:00:00.000Z');
  c.offers.forEach(o => assert.equal(o.firstChargeAt, '2026-09-07T09:00:00.000Z',
    o.code + ' must carry its own first-charge instant'));
});

test('there is one trial-date authority, and the screen is not it', () => {
  /* A surface that added fourteen days itself would be a second calculation of
     the same fact, drifting the first time the trial length changed. */
  assert.equal(
    Prod.trialEndsAt(new Date('2026-08-24T09:00:00Z')).toISOString(),
    Prod.catalogue('web', {}, new Date('2026-08-24T09:00:00Z')).firstChargeAt);

  const shell = read('account.html');
  assert.match(shell, /whenText\(o\.firstChargeAt\)/,
    'the shell must render the server’s instant');
  assert.ok(!/14 \* 24 \* 60 \* 60 \* 1000|\+ 14 \* |addDays\(.*14\)/.test(shell),
    'the shell must not compute a trial end of its own');
});

test('the sentence an athlete reads names £0, the amount, the date and the cadence', () => {
  const shell = read('account.html');
  assert.match(shell, /'£0 today\. ' \+ priceAmount\(o\) \+ ' will be taken on ' \+ when/);
  assert.match(shell, /renews ' \+\s*\(o\.billingPeriod === 'yearly' \? 'annually' : 'monthly'\)/);
  assert.match(shell, /unless you cancel before then/);
});

test('the date is rendered in the athlete’s own timezone, from a UTC instant', () => {
  /* The arithmetic is UTC so the server's timezone never decides somebody
     else's date; the rendering is local so the calendar day they read is the
     one the charge falls on where they are. */
  const lateUtc = Prod.trialEndsAt(new Date('2026-08-24T23:30:00Z'));
  assert.equal(lateUtc.toISOString(), '2026-09-07T23:30:00.000Z');
  /* Fourteen days is fourteen days across a DST boundary, because the
     arithmetic never leaves UTC. */
  const acrossDst = Prod.trialEndsAt(new Date('2026-10-20T23:30:00Z'));
  assert.equal(acrossDst.toISOString(), '2026-11-03T23:30:00.000Z');

  const shell = read('account.html');
  assert.match(shell, /toLocaleDateString/, 'the shell renders in the athlete’s locale');
});

test('a malformed instant yields no sentence rather than "Invalid Date"', () => {
  assert.equal(Prod.trialEndsAt('not-a-date'), null);
  const shell = read('account.html');
  assert.match(shell, /if \(when\)\{/, 'no date means no sentence');
});

// ===========================================================================
// THE COMMERCIAL MODEL IS UNCHANGED
// ===========================================================================
test('one product, two offers, the approved prices, and no resurrected tier', () => {
  assert.deepEqual(Object.keys(Prod.OFFERS), ['STANDARD_MONTHLY', 'STANDARD_YEARLY']);
  assert.equal(Prod.OFFERS.STANDARD_MONTHLY.priceMinor, 1199);
  assert.equal(Prod.OFFERS.STANDARD_YEARLY.priceMinor, 8999);
  assert.equal(Prod.OFFERS.STANDARD_MONTHLY.currency, 'GBP');
  assert.equal(Prod.TRIAL_DAYS, 14);
  assert.deepEqual(Object.keys(Prod.PRODUCTS), ['VALHALLA_STANDARD']);

  /* No Basic, no Pro, and no £9.99 founding price anywhere in the catalogue or
     on the purchase surface. Matched precisely rather than loosely: a bare
     "999" also appears inside 8999, and a test that fires on the correct annual
     price is a test somebody deletes. */
  const src = read('api/_products.js') + read('account.html');
  [/priceMinor:\s*999\b/, /£9\.99/, /VALHALLA_BASIC/, /VALHALLA_PRO/,
   /founding[ _]?price/i, /\btier:\s*'(basic|pro)'/]
    .forEach(rx => assert.ok(!rx.test(src), 'retired pricing or tier resurfaced: ' + rx));

  /* And the capability map still ships exactly one tier. */
  const A = require('../api/_access.js');
  assert.deepEqual(Object.keys(A.CAPABILITIES), ['standard']);
});
