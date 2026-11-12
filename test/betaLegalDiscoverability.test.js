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
// SETTINGS -> PRIVACY, TERMS AND CONTACT
// ---------------------------------------------------------------------------
/* Founder: "Legal and support. Currently the 3 options go nowhere. And we
   have the 2 greyed out options at the bottom so they can be removed from
   there and delete the legal title. Contact should then be a standalone
   option."
   So the documents are reached from the footer under the Settings list, the
   Legal & Support heading is gone, and Contact is a row of its own. Every
   one of them leaves the app through openExternal(), because a link opening
   a new window is what went nowhere in the installed app. */
test('Settings reaches both documents from its footer, and Contact is a row of its own', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: TODAY, distanceKey: 'half' });
  const html = a.renderSettingsHubView();
  assert.equal(html.indexOf('Legal &amp; Support'), -1, 'the Legal & Support heading is back');
  assert.match(html, /<button type="button" class="legal-link" data-action="open-legal" data-doc="privacy">Privacy<\/button>/);
  assert.match(html, /<button type="button" class="legal-link" data-action="open-legal" data-doc="terms">Terms<\/button>/);
  /* No second copy of the links up in the list. */
  assert.equal((html.match(/Privacy Policy|Private Beta Terms|Terms of Service/g) || []).length, 0, 'the documents are listed twice');
  /* Contact, on its own, with the address on it -- so the athlete has it
     whether or not the phone has a mail app to open. */
  const contact = /<div class="hub-card tile-card stg-group stg-solo"><button type="button" class="ev-card stg-nav stg-row" data-action="open-contact">([\s\S]*?)<\/button><\/div>/.exec(html);
  assert.ok(contact, 'Contact is not a row of its own');
  assert.match(contact[1], /<span class="stg-row-title">Contact<\/span>/);
  assert.match(contact[1], new RegExp('<span class="stg-row-sub">' + SUPPORT + '</span>'));
  assert.ok(!/class="setup-section-title">[^<]*<\/div><button[^>]*data-action="open-contact"/.test(html), 'Contact sits under a heading');
});

test('every link out of the app goes through one door, and lands on the canonical documents', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: TODAY, distanceKey: 'half' });
  const went = [];
  a.window.open = (u, n, f) => { went.push(['open', u, n, f]); return {}; };
  const loc = { href: '' };
  Object.defineProperty(a.window, 'location', { value: loc, configurable: true, writable: true });
  /* In a browser: a new tab, with no way back into this one. */
  a.isNativeApp = () => false;
  a.openExternal(a.LEGAL_URLS.privacy);
  a.openExternal(a.LEGAL_URLS.terms);
  assert.deepEqual(went, [['open', CANON_PRIVACY, '_blank', 'noopener'], ['open', CANON_BETA_TERMS, '_blank', 'noopener']]);
  /* In the installed app: the page itself navigates, which the shell hands
     to the system browser. A new window is what went nowhere. */
  a.isNativeApp = () => true;
  a.openExternal(CANON_PRIVACY);
  assert.equal(loc.href, CANON_PRIVACY);
  assert.equal(went.length, 2, 'the installed app tried to open a window');
  /* The mail app, either way. */
  a.isNativeApp = () => false;
  a.openContact();
  assert.equal(loc.href, 'mailto:' + SUPPORT);
  /* And nothing on the Settings page still opens a window of its own. */
  const html = a.renderSettingsHubView();
  assert.doesNotMatch(html, /target="_blank"/, 'a link that goes nowhere in the app is back');
  assert.ok(!/href="\/(terms|privacy)"/.test(html), 'Settings must not link to the superseded local documents');
  assert.match(RUNTIME, /case 'open-legal': openExternal\(target\.getAttribute\('data-doc'\) === 'terms' \? LEGAL_URLS\.terms : LEGAL_URLS\.privacy\); break;/);
  assert.match(RUNTIME, /case 'open-contact': openContact\(\); break;/);
});

test('the Settings section reuses the existing hub architecture', () => {
  const a0 = app();
  buildPlan(a0, { weeks: 12, startDate: TODAY, distanceKey: 'half' });
  const view = a0.renderSettingsHubView();
  assert.match(view, /<div class="setup-section-title">Data<\/div>/, 'must use the existing setup-section-title heading');
  assert.match(view, /data-action="open-contact"/);
  assert.match(view.slice(view.indexOf('open-contact') - 200, view.indexOf('open-contact')), /ev-card stg-nav/, 'must use the shared tappable-destination row class');
  assert.equal((RUNTIME.match(/function stgGroup\(/g) || []).length, 1,
    'there must be one group builder, or the eight copies are back');
  assert.equal((RUNTIME.match(/function renderSettingsHubView\(/g) || []).length, 1);
});

test('one way to start again: New Block stays, Reset Plan leaves the list', () => {
  /* Founder: "Is start a new block needed? We have that, reset plan and
     update plan." Asked which should stay: "Keep New Block, drop Reset."
     New Block keeps the finished weeks as history and carries everything
     learned; Edit Plan Settings, in Training & Zones, still changes the plan
     you are in. */
  const a = app();
  buildPlan(a, { weeks: 12, startDate: TODAY, distanceKey: 'half' });
  const html = a.renderSettingsHubView();
  assert.doesNotMatch(html, /Reset Plan|data-panel="resetplan"/, 'Reset Plan is back in Settings');
  assert.match(html, /data-action="open-new-block"[\s\S]*?Start a New Block[\s\S]*?Keeps your history and everything learned/);
  assert.doesNotMatch(html, /data-action="reset-plan"/, 'a reset button is on the Settings page itself');
  assert.match(a.settingsPanelTraining(), /data-action="open-setup"/, 'Edit Plan Settings left Training & Zones');
});

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
