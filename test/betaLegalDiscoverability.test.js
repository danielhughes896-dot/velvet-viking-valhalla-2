'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// BETA LEGAL DISCOVERABILITY TESTS.
//
// Two documents are published on the website and the app must LINK to them, not
// carry them. The failure this guards against is the obvious one: somebody
// deciding it would be nicer to have the policy inside the app, and the product
// ending up with three copies of a privacy policy where the one a tester reads is
// whichever was updated last.
//
// The app already had two legal pages of its own, and they had drifted exactly
// that way — one asserting no company had been incorporated after Velvet Viking
// Ltd was registered, the other printing bracketed placeholder tokens on a live
// page. Those are now corrected and point at the canonical documents.
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const RUNTIME = read(RUNTIME_RELATIVE);

const CANON_PRIVACY = 'https://velvetviking.co.uk/privacy';
const CANON_BETA_TERMS = 'https://velvetviking.co.uk/beta-terms';
const SUPPORT = 'support@velvetviking.co.uk';

const TODAY = '2026-08-17';
function app() {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {};
  return a;
}

// ---------------------------------------------------------------------------
// ONE SOURCE OF TRUTH
// ---------------------------------------------------------------------------
test('the canonical URLs are declared once and used everywhere', () => {
  const a = app();
  assert.equal(a.LEGAL_URLS.privacy, CANON_PRIVACY);
  /* Renamed from `betaTerms` to `terms`: the document that governs a paid
     subscription is not "the beta terms", and the alias that briefly held
     both names was a second place to change one URL -- which is exactly what
     the test below forbids. One key, one URL. */
  assert.equal(a.LEGAL_URLS.terms, CANON_BETA_TERMS);
  assert.equal(a.LEGAL_URLS.betaTerms, undefined,
    'the old key must be gone rather than kept alongside the new one');
  assert.equal(a.LEGAL_URLS.support, SUPPORT);
  // One declaration. Two would be how the app and the website drift apart.
  assert.equal(
    (RUNTIME.match(/var LEGAL_URLS = \{/g) || []).length,
    1,
    'declared once, or it is not a single source of truth'
  );
});

test('no legal URL is hardcoded anywhere else in the runtime', () => {
  const code = RUNTIME.replace(/\/\*[\s\S]*?\*\//g, ' ');
  for (const url of [CANON_PRIVACY, CANON_BETA_TERMS]) {
    const hits = (code.match(new RegExp(url.replace(/[/.]/g, '\\$&'), 'g')) || []).length;
    assert.equal(hits, 1, url + ' must appear once, inside LEGAL_URLS');
  }
});

test('the app does not embed a copy of either document', () => {
  // Phrases lifted from the published documents. If any of these turn up in the
  // runtime, somebody has started a fourth copy.
  for (const phrase of [
    'data controller',
    'Last updated',
    'rating of perceived effort',
    'It will contain defects',
    'Registered in England and Wales',
  ]) {
    assert.equal(
      RUNTIME.indexOf(phrase),
      -1,
      'the runtime must link to the documents, not restate them: found "' + phrase + '"'
    );
  }
});

// ---------------------------------------------------------------------------
// SETTINGS -> LEGAL & SUPPORT
// ---------------------------------------------------------------------------
test('Settings has a Legal & Support section with all three links', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: TODAY, distanceKey: 'half' });
  const html = a.renderSettingsHubView();

  assert.ok(html.indexOf('Legal &amp; Support') !== -1, 'the section must exist');
  assert.ok(html.indexOf('href="' + CANON_PRIVACY + '"') !== -1, 'Privacy Policy link');
  assert.ok(html.indexOf('href="' + CANON_BETA_TERMS + '"') !== -1, 'Private Beta Terms link');
  assert.ok(html.indexOf('href="mailto:' + SUPPORT + '"') !== -1, 'Support link');
  assert.ok(html.indexOf('Privacy Policy') !== -1);
  assert.ok(html.indexOf('Private Beta Terms') !== -1);
});

test('the external links cannot be used to hijack the app tab', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: TODAY, distanceKey: 'half' });
  const html = a.renderSettingsHubView();
  // Every off-origin link opens in a new context and drops the opener. The
  // mailto is deliberately exempt — target="_blank" on a mailto leaves a blank
  // tab behind on some browsers.
  const external = html.match(/<a[^>]*href="https:\/\/velvetviking\.co\.uk[^"]*"[^>]*>/g) || [];
  assert.equal(external.length, 2, 'both documents linked');
  for (const tag of external) {
    assert.match(tag, /target="_blank"/, tag);
    assert.match(tag, /rel="noopener noreferrer"/, tag);
  }
});

test('the Settings section reuses the existing hub architecture', () => {
  // No second settings system. The card and heading class are the ones every
  // other Settings section already uses. The three links themselves reuse
  // .ev-card -- the exact tappable-destination shell Coach's Reading rows use
  // -- rather than the plain .btn-ghost box a navigational entry used to get;
  // see the VALHALLA CONSISTENCY PASS comment on .ev-card.stg-nav.
  const at = RUNTIME.indexOf("'<div class=\"setup-section-title\">Legal &amp; Support</div>'");
  assert.ok(at !== -1, 'must use the existing setup-section-title heading');
  const card = RUNTIME.slice(RUNTIME.lastIndexOf('hub-card', at), at + 1200);
  assert.match(card, /ev-card stg-nav/, 'must use the shared tappable-destination row class');
  // And exactly one Settings hub renderer exists.
  assert.equal((RUNTIME.match(/function renderSettingsHubView\(/g) || []).length, 1);
});

test('the destructive Reset action is still the last thing in Settings', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: TODAY, distanceKey: 'half' });
  const html = a.renderSettingsHubView();
  assert.ok(
    html.indexOf('Legal &amp; Support') < html.indexOf('Reset Plan'),
    'a red destructive button belongs last; the legal card must not displace it'
  );
});

// ---------------------------------------------------------------------------
// ONBOARDING VISIBILITY
// ---------------------------------------------------------------------------
test('a first-time athlete is told which documents govern the beta', () => {
  const a = app();
  a.openModal = (html) => { a.__modal = html; };
  a.state.setup = null;
  a.openSetupModal();
  const html = a.__modal || '';
  assert.ok(html.indexOf('Private Beta Terms') !== -1, 'named before substantive use begins');
  assert.ok(html.indexOf(CANON_PRIVACY) !== -1);
  assert.ok(html.indexOf(CANON_BETA_TERMS) !== -1);
  assert.match(html, /Using the private beta is covered by/);
});

test('it is a sentence, not a consent gate', () => {
  const a = app();
  a.openModal = (html) => { a.__modal = html; };
  a.state.setup = null;
  a.openSetupModal();
  const html = a.__modal || '';
  // No checkbox, and certainly no pre-ticked one. Nothing here collects a
  // consent, and nothing pretends to — the health-data consent question is
  // explicitly parked, so inventing a mechanism for it would be worse than
  // leaving it alone.
  const legalRegion = html.slice(html.indexOf('Using the private beta is covered by'));
  assert.ok(!/type="checkbox"/.test(legalRegion), 'no consent checkbox');
  assert.ok(!/\bchecked\b/.test(legalRegion), 'nothing pre-ticked');
  assert.ok(!/I agree|I accept|You must accept/i.test(html), 'not a wall');
  // And it does not block the button it sits under.
  assert.ok(html.indexOf('data-action="generate-plan"') !== -1, 'the plan can still be built');
});

test('a returning athlete regenerating a plan is not shown it again', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: TODAY, distanceKey: 'half' });
  a.openModal = (html) => { a.__modal = html; };
  a.openSetupModal();
  const html = a.__modal || '';
  assert.ok(
    html.indexOf('Using the private beta is covered by') === -1,
    'shown once before substantive use, not on every regeneration — that is nagging'
  );
  assert.ok(html.indexOf('Regenerating rebuilds the schedule') !== -1, 'the regenerate note still shows');
});

test('the sign-in page names both documents', () => {
  const account = read('account.html');
  assert.ok(account.indexOf(CANON_PRIVACY) !== -1);
  assert.ok(account.indexOf(CANON_BETA_TERMS) !== -1);
  assert.ok(!/type="checkbox"/.test(account), 'no consent checkbox on the sign-in page either');
});

// ---------------------------------------------------------------------------
// AUTH WORDING STAYS PROVABLE
// ---------------------------------------------------------------------------
test('no absolute password claim survives anywhere athlete-facing', () => {
  // A password credential exists on the Supabase owner account, and password auth
  // is a project-level setting the app does not control, so "we do not store
  // passwords" is not provable. Describing what the ATHLETE does is.
  for (const file of ['account.html', 'privacy.html', 'terms.html']) {
    const src = read(file).replace(/<!--[\s\S]*?-->/g, ' ');
    for (const overclaim of [
      /there is no password\b(?!\s+for you)/i,
      /no password to (store or )?leak/i,
      /we do not store (a )?passwords?/i,
    ]) {
      assert.ok(!overclaim.test(src), file + ' makes an unprovable password claim: ' + overclaim);
    }
  }
  const account = read('account.html');
  assert.match(account, /no password for you to create or remember/);
});

// ---------------------------------------------------------------------------
// THE APP'S OWN LEGAL PAGES NO LONGER CONTRADICT THE PUBLISHED ONES
// ---------------------------------------------------------------------------
test('no visible placeholder token remains on any app legal page', () => {
  for (const file of ['privacy.html', 'terms.html', 'account.html', 'get.html']) {
    const visible = read(file).replace(/<!--[\s\S]*?-->/g, ' ');
    const found = visible.match(/\[[A-Z][A-Z /]{3,}\]/g) || [];
    assert.deepEqual(found, [], file + ' shows placeholder tokens to a real reader');
  }
});

test('the app legal pages state the company correctly and point at canonical', () => {
  const privacy = read('privacy.html');
  const terms = read('terms.html');
  // The stale claim that no company existed is gone.
  assert.ok(
    !/no company has been incorporated/.test(privacy),
    'Velvet Viking Ltd is incorporated; that statement was out of date'
  );
  for (const [name, src, canon] of [
    ['privacy.html', privacy, CANON_PRIVACY],
    ['terms.html', terms, CANON_BETA_TERMS],
  ]) {
    assert.ok(src.indexOf(canon) !== -1, name + ' must point at the canonical document');
    assert.match(src, /company number 17404255/, name);
    assert.match(src, /registered in England and Wales/i, name);
  }
});

// ---------------------------------------------------------------------------
// NOTHING ELSE MOVED
// ---------------------------------------------------------------------------
test('the function budget is unchanged at 12', () => {
  const fns = fs
    .readdirSync(path.join(ROOT, 'api'))
    .filter((f) => /\.js$/.test(f) && f.charAt(0) !== '_');
  /* Stated as a CEILING rather than a constant. Every one of these
     assertions was written to mean "my feature added no Serverless
     Function", and pinning the absolute total made a legitimate
     CONSOLIDATION look like a regression: the Strava routes moved
     behind one router and the count fell 12 -> 7, which is the same
     claim holding more strongly, not a broken one. The limit is what
     the deployment actually enforces. */
  assert.ok(fns.length <= 12, 'Hobby plan allows 12; this closeout adds none');
});

test('no commercial activation, no Race Finder, no engine change', () => {
  const access = read('api/_access.js');
  assert.match(access, /flagOn\(process\.env\.VVV_ACCOUNT_REQUIRED\)/);
  assert.match(access, /flagOn\(process\.env\.VVV_COMMERCIAL_REQUIRED\)/);
  assert.equal(RUNTIME.indexOf('RACE_FINDER_ENABLED'), -1, 'Race Finder is still held off main');
  // Execution Strategy was merged and turned ON by HQ after the previous
  // workstream. This task must not touch it, so the assertion is that it is
  // still here and still on — not that it is absent.
  assert.match(RUNTIME, /var EXECUTION_STRATEGY_ENABLED = true;/,
    'Execution Strategy is live on main and this task must leave it exactly as it is');
  for (const fn of [
    'function segmentsFor(',
    'function buildBlockWeeks(',
    'function buildDaysFromWeeks(',
    'function evolutionRationale(',
  ]) {
    assert.ok(RUNTIME.includes(fn), fn + ' must still exist');
  }
});

test('a plan renders identically whether or not the legal links are present', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: TODAY, distanceKey: 'half' });
  const sig = a.planContentSignature(a.state);
  a.renderSettingsHubView();
  assert.equal(a.planContentSignature(a.state), sig, 'rendering Settings must not touch the plan');
});
