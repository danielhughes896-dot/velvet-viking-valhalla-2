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
  assert.deepEqual(termsOnly.agreements,
    { terms: true, immediateStart: false, commercialLegalPublished: true },
    'which half is missing, and whether the documents exist at all');

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
  const head = rec.slice(0, 2600);
  /* The version is resolved from the type by this module and written from
     that local. Both halves are asserted: where it comes FROM, and that it
     never comes from the request body. */
  assert.match(head, /const version = versionFor\(i\.type\)/,
    'the version must be resolved here, from the type');
  assert.match(head, /agreement_version:\s*version\b/,
    'and written from that, not from anything the caller sent');
  assert.ok(!/agreement_version:\s*i\./.test(head),
    'the version must never come from the caller');
  assert.match(head, /user_id:\s*userId/,
    'and the athlete must be the token holder');
});

// ===========================================================================
// VERSIONING: A SOLICITOR'S REVISION MUST NOT COST THE EVIDENCE
// ===========================================================================
test('an agreement to superseded wording stops counting, and nothing is lost', async () => {
  /* The whole reason the wording can be revised after approval. When the
     reviewed text lands, the constant changes, this gate starts refusing, and
     every athlete is asked again -- while the v1 rows stay exactly as they
     are as the record of what was agreed before. */
  /* Exercised against the immediate-start acknowledgement, because that is the
     agreement with a version actually in force. The Terms have none while the
     commercial documents are unpublished -- which is itself asserted below,
     and is a stronger form of the same rule rather than an exemption from it. */
  const iRow = over => Object.assign({
    decision: 'accepted', agreement_version: 'immediate_start_v1',
    decided_at: '2026-08-01T00:00:00Z'
  }, over || {});

  assert.equal(await Agree.hasAccepted(CFG, sbReturning([iRow()]), UID, 'immediate_start'), true);

  assert.equal(await Agree.hasAccepted(CFG,
    sbReturning([iRow({ agreement_version: 'immediate_start_v0' })]), UID, 'immediate_start'), false,
    'superseded wording must not count');

  assert.equal(await Agree.hasAccepted(CFG,
    sbReturning([iRow({ agreement_version: 'immediate_start_v2' })]), UID, 'immediate_start'), false,
    'wording this build has never served must not count either');

  /* AND THE LIMIT CASE. With no document in force, no stored row of any
     version counts -- including a row naming the beta Terms, which is exactly
     the acceptance that must never be readable as evidence for a purchase. */
  for (const v of ['terms_v1', 'commercial_terms_v1', 'anything']){
    assert.equal(await Agree.hasAccepted(CFG,
      sbReturning([row({ agreement_version: v })]), UID, 'terms'), false,
      'no Terms row counts while nothing is published: ' + v);
  }
});

test('the approved wording is the wording that ships, and it is labelled honestly', () => {
  /* Review is complete and the text was approved UNCHANGED, which is why the
     version is still v1: nothing an athlete agrees to has moved, so nobody
     needs asking again. The repository must say that plainly -- a stale "not
     approved" label is as untrue as a premature "approved" one.

     Approval is a fact about THIS string. The version mechanism stays so the
     next string cannot inherit it. */
  const src = read('api/_agreements.js');
  assert.match(src, /SOLICITOR-REVIEWED AND APPROVED/);
  assert.match(src, /immediate_start_v2/,
    'and the upgrade path stays written down where the constant is');

  /* Case-INSENSITIVE, and across every file that describes the wording rather
     than just the one carrying the headline label. A stale "draft" sentence
     buried in prose misrepresents the legal position exactly as effectively as
     a stale banner, and it is the buried one that survives a careless edit. */
  for (const f of ['api/_agreements.js', 'api/_checkout.js',
                   'supabase-account-agreements.sql', 'LEGAL-FACTS.md']){
    const text = read(f);
    assert.ok(!/not solicitor-approved|business draft/i.test(text),
      f + ' still describes the approved wording as an unapproved draft');
  }

  /* The approved text, pinned. If somebody edits the wording without bumping
     the version, this fails -- which is exactly the failure that would
     otherwise let an old "yes" stand for new words. */
  assert.equal(Agree.IMMEDIATE_START_VERSION, 'immediate_start_v1');
  assert.equal(Agree.IMMEDIATE_START_TEXT,
    'Your 14 days start now and you get the full product straight away. That ' +
    'means you are asking us to begin the service during the 14-day period in ' +
    'which you would otherwise have the right to cancel a distance contract, ' +
    'and you accept that starting immediately affects that right. You can still ' +
    'cancel at any time before the trial ends and you will not be charged.');
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
  /* immediate_start, because it is the type that actually reaches the write.
     A Terms write is refused earlier and for a different reason, which the
     canonical-documents section asserts separately. */
  const failing = async () => ({ ok: false, status: 503 });
  const r = await Agree.record(CFG, failing, UID,
    { type: 'immediate_start', decision: 'accepted', surface: 'checkout' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'write_failed');

  for (const bad of [
    { type: 'health', decision: 'accepted', surface: 'checkout' },
    { type: 'immediate_start', decision: 'maybe', surface: 'checkout' },
    { type: 'immediate_start', decision: 'accepted', surface: 'billboard' }
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

// ===========================================================================
// THE CANONICAL DOCUMENTS
//
// The defect this section exists to close, stated plainly: checkout asked the
// athlete to accept "the Terms of Service" and linked to the app's own /terms,
// which describes a PRIVATE BETA -- no subscription, no trial, no
// cancellation, no refund -- while the commercial Terms sat unpublished on the
// website. A customer could have agreed to evidence naming a document that
// does not describe the thing they were paying for.
//
// It is closed structurally rather than by editing a link: while the
// commercial documents are unpublished there is no Terms version in force, so
// no Terms row can be written by any surface and checkout refuses.
// ===========================================================================
test('the app keeps no commercial legal text of its own', () => {
  /* One copy, on the website. Two copies of a contract is two contracts, and
     an athlete has no way of knowing which governs them. The app may point at
     documents; it may not become one. */
  for (const url of [Agree.CANONICAL_TERMS_URL, Agree.CANONICAL_PRIVACY_URL, Agree.BETA_TERMS_URL]){
    assert.match(url, /^https:\/\/velvetviking\.co\.uk\//,
      'the canonical documents live on the website: ' + url);
  }
  assert.notEqual(Agree.CANONICAL_TERMS_URL, Agree.BETA_TERMS_URL,
    'the commercial Terms and the private-beta Terms are different documents');
});

test('the commercial Terms do not inherit the private-beta Terms identifier', () => {
  /* THE POINT OF THE WHOLE SECTION. terms_v1 names the beta document. Reusing
     it for a subscription contract would make every stored row ambiguous about
     which document it attests, and would let a beta-era acceptance stand as
     evidence for a paid purchase. A new document gets a new identifier. */
  /* The identifiers are the WEBSITE'S, published alongside the documents
     themselves. The app adopts the published names rather than minting its
     own -- two vocabularies for one contract is the ambiguity the identifier
     exists to prevent. */
  assert.equal(Agree.TERMS_BETA_VERSION, 'terms_v1');
  assert.equal(Agree.TERMS_COMMERCIAL_VERSION, 'commercial_terms_v1');
  assert.equal(Agree.PRIVACY_COMMERCIAL_VERSION, 'commercial_privacy_v1');
  assert.equal(Agree.PRIVACY_BETA_VERSION, 'privacy_v1');
  assert.notEqual(Agree.TERMS_COMMERCIAL_VERSION, Agree.TERMS_BETA_VERSION);
  assert.notEqual(Agree.PRIVACY_COMMERCIAL_VERSION, Agree.PRIVACY_BETA_VERSION);
});

test('while the commercial Terms are unpublished, nothing is in force to accept', () => {
  /* Not "the athlete has not accepted yet" -- there is no document. The two
     are different facts with different owners and different fixes. */
  assert.equal(Agree.COMMERCIAL_LEGAL_PUBLISHED, false,
    'the website has not published; this test changes when that does');
  assert.equal(Agree.versionFor('terms'), null);
  assert.equal(Agree.TERMS_VERSION, null);

  const defs = Agree.currentAgreements();
  assert.equal(defs.commercialLegalPublished, false);
  assert.equal(defs.terms.agreeable, false, 'no surface may offer a Terms tickbox');
  assert.equal(defs.terms.url, Agree.BETA_TERMS_URL,
    'and the link names the document actually in force today, not a page that does not exist yet');
});

test('no Terms row can be written against the private-beta document', async () => {
  /* THE STRUCTURAL GUARANTEE. Not a screen refusing to render a checkbox --
     the recorder itself refuses, so a hand-made request cannot do what the
     screen will not. */
  let wrote = false;
  const sb = async () => { wrote = true; return okRes([]); };
  const r = await Agree.record(CFG, sb, UID, {
    type: 'terms', decision: 'accepted', surface: 'checkout'
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'commercial_terms_not_published');
  assert.equal(wrote, false, 'it must not even reach the database');
});

test('the immediate-start acknowledgement is unaffected and still recordable', async () => {
  /* Publication of the Terms is the website's gap, not a reason to tear down
     an approved acknowledgement or discard evidence already given for it. */
  let body = null;
  const sb = async (cfg, pathname, opts) => { body = JSON.parse(opts.body); return okRes([]); };
  const r = await Agree.record(CFG, sb, UID, {
    type: 'immediate_start', decision: 'accepted', surface: 'checkout'
  });
  assert.equal(r.ok, true);
  assert.equal(body.agreement_version, 'immediate_start_v1');
});

test('checkout refuses, and says whose gap it is', async () => {
  /* An athlete told "please accept the Terms" when the truth is "we have not
     published them" is being blamed for our own gap. */
  const ev = await Agree.purchaseEvidence(CFG, sbReturning([]), UID);
  assert.equal(ev.ok, false);
  assert.equal(ev.published, false);
  assert.equal(ev.reason, 'commercial_terms_not_published');

  const d = Checkout.decideCheckout({
    commerceEnabled: true, commercialRequired: true, stripeConfigured: true,
    uid: UID, period: 'monthly', purchaseCheck: { mayBuy: true },
    evidence: ev, now: new Date()
  });
  assert.equal(d.ok, false);
  assert.equal(d.code, 'commercial_terms_not_published');
  assert.equal(d.status, 409);
  assert.equal(d.agreements.commercialLegalPublished, false);
});

test('every app surface links to the canonical documents, never to a local copy', () => {
  /* The app's own /terms and /privacy are superseded working copies. A surface
     that asks for a commercial decision while linking to one of them is the
     original defect. Checked across every file an athlete can reach. */
  for (const f of ['account.html', 'start.html', 'get.html',
                   'protected/velvet-viking-valhalla.html']){
    const src = read(f);
    assert.ok(!/href="\/terms"/.test(src), f + ' still links to the local Terms copy');
    assert.ok(!/href="\/privacy"/.test(src), f + ' still links to the local Privacy copy');
  }
});

test('the checkout consent renders its links from the server, not from itself', () => {
  /* A screen holding its own copy of the URL is how a surface ends up linking
     to one document while the evidence names another. The URL and the version
     leave the server together. */
  const src = read('account.html');
  assert.match(src, /defs\.terms\.url/);
  assert.match(src, /defs\.privacy\.url/);
  /* And it renders no tickbox at all when there is nothing published. */
  assert.match(src, /commercialLegalPublished === false/);
});

test('Settings opens whatever the server says is in force', () => {
  const shell = read('protected/velvet-viking-valhalla.html');
  assert.match(shell, /function legalUrlsFromView/);
  assert.match(shell, /LEGAL_URLS\.terms = a\.terms\.url/);
  assert.match(shell, /LEGAL_URLS\.privacy = a\.privacy\.url/);
  /* The session payload is what carries them. */
  assert.match(read('api/session.js'), /agreements: Agree\.currentAgreements\(\)/);
});

test('privacy is still a notice, and the payload says so out loud', () => {
  const defs = Agree.currentAgreements();
  assert.equal(defs.privacy.isConsent, false);
  assert.equal(defs.privacy.note, 'notice, not consent');
  assert.equal(Agree.TYPES.indexOf('privacy'), -1, 'privacy is not an agreement type');
  /* No surface grew a privacy tickbox while the links were being rewired. */
  const src = read('account.html');
  assert.ok(!/agreementRow\(\s*'privacy'/.test(src));
});

test('the app legal pages show no unresolved placeholder', () => {
  /* A document that shows a reader an unfilled bracket next to an answer it
     has already given is worse than one that gives the answer once. */
  for (const f of ['terms.html', 'privacy.html']){
    const src = read(f);
    assert.ok(!/to be confirmed by the owner|\[GOVERNING LAW|\bTBC\b/i.test(src),
      f + ' still shows an unresolved placeholder');
  }
});

// ===========================================================================
// FAIL-CLOSED IS A PROPERTY OF EVERY STATE, NOT A FACT ABOUT TODAY
//
// The dangerous moment for a gate like this is the day it first opens: the
// refusing half stops being exercised, and quietly stops working. inForce() is
// a pure function of one boolean precisely so both halves stay provable after
// the commercial documents go live -- and so a future withdrawal, replacement
// or lapse lands back in a state that has tests.
// ===========================================================================
test('with the documents published, the website\'s own identifiers are what count', () => {
  const on = Agree.inForce(true);
  assert.equal(on.terms, 'commercial_terms_v1');
  assert.equal(on.privacy, 'commercial_privacy_v1');
  assert.equal(on.termsUrl, Agree.CANONICAL_TERMS_URL);
  assert.equal(on.termsUrl, 'https://velvetviking.co.uk/terms');
});

test('with the documents unpublished, no Terms version exists at all', () => {
  const off = Agree.inForce(false);
  assert.equal(off.terms, null, 'and never the beta identifier as a fallback');
  assert.notEqual(off.terms, Agree.TERMS_BETA_VERSION);

  /* The notice and the link DO name what is actually in force, because a
     reader should be able to reach the document that governs them today. It
     is ACCEPTANCE that must not be recordable, not information. */
  assert.equal(off.privacy, 'privacy_v1');
  assert.equal(off.termsUrl, Agree.BETA_TERMS_URL);
});

test('a beta acceptance can never satisfy the commercial Terms', async () => {
  /* THE MIGRATION HAZARD, closed by construction. When the commercial document
     goes live, every athlete is asked again -- an existing terms_v1 row is
     evidence about the beta document and stays that way. Proven against the
     published-world version rather than against today's null, so it keeps
     meaning something after the gate opens. */
  const published = Agree.inForce(true).terms;
  const betaRow = { decision: 'accepted', agreement_version: Agree.TERMS_BETA_VERSION,
                    decided_at: '2026-08-01T00:00:00Z' };
  assert.notEqual(betaRow.agreement_version, published,
    'a beta acceptance must not read as a commercial one');

  /* And the live reader refuses it too, today, for the stronger reason that
     nothing is in force at all. */
  assert.equal(await Agree.hasAccepted(CFG, sbReturning([betaRow]), UID, 'terms'), false);
});

test('a superseded commercial version stops counting when v2 lands', async () => {
  /* Not hypothetical: it is the same comparison that protects the beta rows,
     and the reason a solicitor's revision costs no evidence and no migration. */
  const v1 = Agree.inForce(true).terms;
  for (const stored of ['commercial_terms_v0', 'commercial_terms_v2', 'terms_v1']){
    assert.notEqual(stored, v1, stored + ' must not read as the version in force');
  }
});

test('the gate that is closed today is the one line that opens it', () => {
  /* One constant, one place, and the test says which. If somebody opens the
     gate, this assertion is what makes them look at the publication evidence
     rather than at a link. */
  const src = read('api/_agreements.js');
  assert.match(src, /const COMMERCIAL_LEGAL_PUBLISHED = (true|false);/,
    'exactly one constant decides it');
  assert.match(src, /LEGAL_APPROVALS\.terms and LEGAL_APPROVALS\.privacyCommercial/,
    'and the check to run before flipping it is written down beside it');
});
