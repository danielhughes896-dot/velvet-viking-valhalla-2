'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* SETTINGS WORKFLOWS ARE PAGES.
 *
 * Founder, with every Settings sheet screenshotted: "I would like to be able
 * to swipe to exit not just have to press the x. Make full-screen pages the
 * standard for important Settings workflows, matching the Coach design: Same
 * dark background. Same large condensed heading. Same close button position.
 * Same cherry and gold colour language. Main action fixed near the bottom
 * where appropriate. No stacked pop-ups or modal-within-modal interactions.
 * Keep quick toggles and small selections inline. The KM/Mi toggle should be
 * slightly bigger. Adaptive full concise. Cherry selection rule. Add an app
 * update tab. Or search for updates."
 *
 * They were cards of nine different heights floating over a dimmed list, and
 * the things THEY opened were a further two kinds of card. The Coach page
 * already had the answer (.hq-full); these laws hold Settings to it.
 */

const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.slice(SRC.indexOf('<style>'), SRC.indexOf('</style>'));
const fnBody = (name) => {
  const at = SRC.indexOf('\nfunction ' + name + '(');
  assert.ok(at > -1, name + '() is gone');
  return SRC.slice(at, SRC.indexOf('\n}\n', at) + 3);
};
const rule = (sel) => {
  const at = CSS.indexOf('\n  ' + sel + '{');
  assert.ok(at > -1, 'no rule for ' + sel);
  return CSS.slice(at, CSS.indexOf('}', at) + 1);
};
const TODAY = '2026-11-12';
function athlete() {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -14), distanceKey: 'half' });
  return a;
}
function opened(a) {
  const calls = [];
  a.openModal = (html, cls, key) => { calls.push({ html, cls, key }); };
  return calls;
}

/* ---------- one page, whichever row it started on ---------- */

test('a Settings page is the Coach page: the same full-screen class, and cherry', () => {
  const a = athlete();
  const cls = a.STG_PAGE.split(' ');
  ['hq-panel', 'stg-panel', 'hq-full', 'rp-cherry'].forEach(c =>
    assert.ok(cls.indexOf(c) > -1, 'a Settings page is missing .' + c));
  /* hq-full is the Coach panels' own class, taken rather than copied. */
  assert.match(fnBody('openHQPanel'), /coachPanel \? ' hq-full' : ''/,
    'the Coach page stopped using the class Settings borrows from it');
});

test('every Settings panel opens as that page', () => {
  const a = athlete();
  const calls = opened(a);
  Object.keys(a.ACTION_PANELS).forEach((key) => {
    a.checkForAppUpdate = () => Promise.resolve('idle');
    a.openSettingsPanel(key);
    const last = calls[calls.length - 1];
    assert.ok(last, key + ' opened nothing');
    assert.equal(last.cls, 'modal-themed builder-light ' + a.STG_PAGE,
      key + ' is not a full-screen Settings page');
  });
});

test('Start a New Block is the same page through the Coach door', () => {
  const a = athlete();
  const calls = opened(a);
  a.openHQPanel('newblock');
  assert.equal(calls.length, 1);
  assert.match(calls[0].cls, /\bstg-panel\b/, 'New Block opened as a Coach card, not a Settings page');
  assert.match(calls[0].cls, /\bhq-full\b/);
});

test('the workflows Settings leads into are pages too, so nothing opens a card over a page', () => {
  ['openRestrictionModal', 'openRecalibrateModal', 'openPacingModal', 'openRestoreModal',
   'openPasteBackupModal', 'openBackupTextModal', 'openImportModal'].forEach((fn) => {
    assert.match(fnBody(fn), /'modal-themed builder-light '\+STG_PAGE/,
      fn + '() still opens as a card of its own kind');
  });
});

test('the close ring is the Coach page’s, not a neutral one of Settings’ own', () => {
  /* ---- CHANGED SIDES ----
     A Settings sheet's X was held to the plain .icon-btn -- founder: "I want
     the X in the top corner to be the same as we have just done in the
     build." That was a card. It is a Coach page now, and the instruction
     that made it one says "Same close button position. Same cherry and gold
     colour language." */
  assert.doesNotMatch(CSS, /\n  \.hq-panel\.stg-panel \.icon-btn\{/,
    'Settings pages have a close ring of their own again');
  /* Both rules that draw the Coach ring say cherry, one by name and one
     through the page's accent, which rp-cherry sets. */
  const rings = CSS.match(/\n  \.hq-panel \.icon-btn\{[^}]*\}/g) || [];
  assert.ok(rings.length >= 1, 'the Coach page\u2019s close ring is gone');
  rings.forEach(r => assert.match(r, /var\(--cherry\)|var\(--rp-accent\)/, 'a close ring that is not cherry: ' + r.trim()));
  assert.match(rule('.modal-card.rp-cherry'), /--rp-accent:var\(--cherry\)/);
});

/* ---------- the main action is at the bottom ---------- */

test('a page with something to commit carries it in a foot, outside the body', () => {
  const a = athlete();
  const shell = a.recordPanelShell('T', '<p>b</p>', null, '<button>go</button>');
  assert.match(shell, /<div class="modal-body"><p>b<\/p><\/div><div class="page-foot"><button>go<\/button><\/div>$/,
    'the foot is not a sibling after the body, so the page cannot pin it');
  assert.doesNotMatch(a.recordPanelShell('T', 'b'), /page-foot/, 'a page with nothing to commit grew an empty foot');
  ['resetplan', 'newblock', 'update'].forEach((key) => {
    const html = a.hqPanelHtml(key);
    const body = html.indexOf('<div class="modal-body">');
    const foot = html.indexOf('<div class="page-foot">');
    assert.ok(foot > body && body > -1, key + ' has no pinned action');
    assert.match(html.slice(foot), /class="btn /, key + '’s foot holds no button');
  });
  ['openRestrictionModal', 'openRecalibrateModal', 'openPasteBackupModal', 'openBackupTextModal'].forEach((fn) => {
    assert.match(fnBody(fn), /'<div class="page-foot">'/, fn + '() left its action in the scroll');
    assert.doesNotMatch(fnBody(fn), /class="modal-actions"/, fn + '() still has the old in-flow action row');
  });
});

test('the foot is pinned to the bottom edge, on short pages and long ones', () => {
  assert.match(rule('.hq-full.stg-panel'), /display:flex; flex-direction:column;/,
    'the page is not a column, so a short page leaves its action under the text instead of at the bottom');
  assert.match(rule('.hq-full.stg-panel > .modal-body'), /flex:1 0 auto;/,
    'the body does not take the spare height, so the foot floats up');
  const foot = rule('.page-foot');
  assert.match(foot, /position:sticky; bottom:0;/, 'on a long page the action scrolls away');
  assert.match(foot, /env\(safe-area-inset-bottom/, 'the action sits under the home indicator');
  /* And the heading does not let the page show through it as it scrolls. */
  assert.match(rule('.modal-card.builder-light.hq-full .modal-head'), /background:var\(--t-card\);/,
    'rows run straight through the title on a page longer than the screen');
});

/* ---------- no pop-up over the page: Reset asks on the page ---------- */

test('Reset asks on its own page: the first press clears nothing', () => {
  const a = athlete();
  let asked = 0, redraws = 0;
  a.confirm = () => { asked++; return true; };
  a.refreshOpenRecordPanel = () => { redraws++; };
  a.openRecordPanelKey = 'resetplan';
  assert.match(a.hqPanelHtml('resetplan'), /data-action="reset-plan"/);
  assert.doesNotMatch(a.hqPanelHtml('resetplan'), /reset-plan-confirm/, 'the page opens already armed');

  a.handleResetPlan();
  assert.ok(a.state.setup, 'one press cleared the plan');
  assert.equal(asked, 0, 'a system dialog was stacked on the page');
  assert.equal(a.resetPlanArmed, true);
  assert.equal(redraws, 1, 'the page did not redraw to put the question');
  const armed = a.hqPanelHtml('resetplan');
  assert.match(armed, /Clear your plan and schedule now\?/);
  assert.match(armed, /data-action="reset-plan-keep"[^>]*>Keep my plan/);
  assert.match(armed, /data-action="reset-plan-confirm"[^>]*>Clear my plan/);

  a.handleResetPlanArm(false);
  assert.equal(a.resetPlanArmed, false);
  assert.ok(a.state.setup, 'Keep my plan cleared the plan');
});

test('Reset: the second press clears, with no dialog, and only if the page asked first', () => {
  const a = athlete();
  let asked = 0;
  a.confirm = () => { asked++; return true; };
  a.refreshOpenRecordPanel = () => {};
  a.closeModal = () => {};
  a.openRecordPanelKey = 'resetplan';
  a.handleResetPlanConfirm();
  assert.ok(a.state.setup, 'a confirm that was never asked for cleared the plan');
  a.handleResetPlan();                 // arms
  a.handleResetPlanConfirm();          // clears
  assert.equal(a.state.setup, null, 'the confirmed reset did not clear the plan');
  assert.equal(asked, 0, 'the page’s own confirmation was followed by a system dialog');
  assert.equal(a.resetPlanArmed, false);
  assert.equal(a.resetPlanConfirmedOnPage, false, 'the answer outlived the call it was given to');
});

test('Reset: any other caller is still asked by the system, and opening the page disarms it', () => {
  const a = athlete();
  let asked = 0;
  a.confirm = () => { asked++; return false; };
  a.handleResetPlan();
  assert.equal(asked, 1, 'a reset from outside the page was not confirmed at all');
  assert.ok(a.state.setup);
  a.resetPlanArmed = true;
  a.stgPanelOpening('resetplan');
  assert.equal(a.resetPlanArmed, false, 'the page reopened still armed from last time');
});

/* ---------- swipe to exit ---------- */

test('a page closes on a push to the right, or downwards from its top', () => {
  const a = athlete();
  assert.equal(a.pageSwipeAxis(4, 3, true), null, 'a twitch was treated as a gesture');
  assert.equal(a.pageSwipeAxis(40, 6, false), 'x', 'a push to the right is not a close');
  assert.equal(a.pageSwipeAxis(6, 40, true), 'y', 'a pull down from the top is not a close');
  /* What it must never take: */
  assert.equal(a.pageSwipeAxis(6, 40, false), 'none', 'pulling down while scrolled closed the page instead of scrolling it');
  assert.equal(a.pageSwipeAxis(6, -40, true), 'none', 'scrolling up was claimed');
  assert.equal(a.pageSwipeAxis(-40, 6, true), 'none', 'a push to the left was claimed');
  assert.equal(a.pageSwipeAxis(30, 28, true), 'none', 'a diagonal drag was claimed');
});

test('it can be changed of mind: short and slow settles back, far or flicked leaves', () => {
  const a = athlete();
  assert.equal(a.pageSwipeCommits(60, 390, 0.1), false, 'a short slow drag closed the page');
  assert.equal(a.pageSwipeCommits(140, 390, 0.05), true, 'a drag past a third of the way did not close it');
  assert.equal(a.pageSwipeCommits(50, 390, 0.9), true, 'a flick did not close it');
  assert.equal(a.pageSwipeCommits(20, 390, 0.9), false, 'a twitch at speed closed it');
  assert.equal(a.pageSwipeCommits(0, 390, 2), false);
});

test('the swipe is on full-screen pages only, and leaves through the page’s own X', () => {
  const start = fnBody('pageSwipeStart');
  assert.match(start, /closest\('\.modal-card\.hq-full'\)/, 'the swipe is not scoped to full-screen pages');
  assert.match(start, /e\.touches\.length !== 1/, 'a pinch can close the page');
  assert.match(start, /pageSwipeOwnedElsewhere\(e\.target, card\)/, 'a slider or a wide table cannot be dragged without closing the page');
  assert.match(fnBody('pageSwipeOwnedElsewhere'), /input\[type="range"\], textarea/);
  const end = fnBody('pageSwipeEnd');
  assert.match(end, /querySelector\('\.modal-head \.icon-btn'\)/,
    'the swipe closes by a route of its own, so a page’s exit work can be skipped');
  assert.match(end, /if \(x && x\.click\) x\.click\(\); else closeModal\(\);/,
    'the swipe finds the X and then does not press it');
  assert.match(fnBody('init'), /initPageSwipe\(\);/, 'the swipe is never bound');
  /* The tab pager already stands down under any sheet, so the two cannot both take a drag. */
  assert.match(fnBody('pagerTouchStart'), /document\.querySelector\('\.modal-overlay'\)\) return;/);
});

/* ---------- quick choices stay inline, and are cherry ---------- */

test('Distance units: KM and MI are inside their row, which is not itself a button', () => {
  const a = athlete();
  const html = a.renderSettingsHubView();
  const at = html.indexOf('Distance units');
  const rowStart = html.lastIndexOf('class="ev-card stg-nav stg-row', at);
  assert.match(html.slice(html.lastIndexOf('<', rowStart), rowStart + 60), /^<div class="ev-card stg-nav stg-row is-still">/,
    'the units row is a <button> holding buttons, which the browser breaks apart');
  /* No row anywhere on the screen may be a button that contains a button. */
  const rows = html.match(/<button type="button" class="ev-card stg-nav stg-row[^>]*>[\s\S]*?<\/button>/g) || [];
  assert.ok(rows.length >= 4, 'the Settings rows are not where this law looks');
  rows.forEach(r => assert.equal((r.match(/<button/g) || []).length, 1,
    'a Settings row is a button with a button inside it: ' + r.slice(0, 90)));
  assert.match(html.slice(at, at + 700), /data-action="set-units" data-units="km">KM<\/button>[\s\S]*data-units="mi">MI<\/button>/);
});

test('the KM/MI toggle is bigger in Settings, and the chosen unit is cherry', () => {
  const base = parseFloat(/font-size:([\d.]+)px/.exec(rule('.tb-unit-toggle button'))[1]);
  const here = parseFloat(/font-size:([\d.]+)px/.exec(rule('.stg-row-units .tb-unit-toggle button'))[1]);
  assert.ok(here > base, 'the units toggle is no bigger in Settings (' + here + ' against ' + base + ')');
  assert.ok(here <= 15, '"slightly bigger" was asked for; ' + here + 'px is the row title’s size or more');
  assert.match(rule('.tb-unit-toggle button.active'), /color:var\(--cherry-text\)/);
});

test('Coaching detail and the injury tiles light the chosen answer in cherry, never gold', () => {
  const gl = rule('.gl-opt.active');
  assert.match(gl, /border-color:var\(--cherry\)/, 'the chosen coaching detail is not cherry');
  assert.doesNotMatch(gl, /gold/, 'the chosen coaching detail is still gold');
  const pick = rule('.rs-pick');
  assert.match(pick, /border:1px solid var\(--tile-border\)/,
    'an injury choice nobody has made is outlined in the brand’s gold again');
  const picked = rule('.rs-pick.is-picked');
  assert.match(picked, /border-color:var\(--cherry\)/);
  assert.doesNotMatch(rule('.gl-opt') + pick + picked, /gold/);
});

/* ---------- check for updates ---------- */

test('App Update is always in Settings, on the web and in the app', () => {
  const web = athlete();
  assert.match(web.renderSettingsHubView(), /data-action="open-settings-panel" data-panel="update"/,
    'there is nowhere to ask whether Sacoro is up to date');
  const native = athlete();
  native.Capacitor = { isNativePlatform: () => true };
  native.nativeAppInfo = { build: String(native.LATEST_NATIVE_BUILD), version: '9.9' };
  const html = native.renderSettingsHubView();
  assert.match(html, /data-panel="update"/);
  assert.doesNotMatch(html, /Update Sacoro/, 'a current app is told an update is available');
  assert.match(native.hqPanelHtml('update'), /Installed app[\s\S]*9\.9 \(/, 'the page does not say which app is installed');
});

test('the check compares the served stylesheet and script with the ones running', () => {
  const a = athlete();
  assert.equal(a.appShellDiffers(['s', 'j'], ['s', 'j']), false);
  assert.equal(a.appShellDiffers(['s', 'j'], ['s', 'J']), true);
  assert.equal(a.appShellDiffers(['s', 'j'], ['s']), true);
  assert.equal(a.appShellDiffers(['s'], ['s', 'j']), true, 'a build that gained a marked part reads as the same build');
  /* "Cannot tell" is its own answer: a page with nothing marked in it is the
     sign-in page or an error, not a new build. */
  assert.equal(a.appShellDiffers(['s', 'j'], []), null);
  assert.equal(a.appShellDiffers([], ['s', 'j']), null);
  /* And both halves of this document carry the mark they are found by. */
  const script = SRC.slice(SRC.lastIndexOf('\n<script>\n'));
  assert.ok(CSS.indexOf(a.APP_SHELL_MARK) > -1, 'the stylesheet is not marked, so a CSS-only release is invisible');
  assert.ok(script.indexOf("'" + a.APP_SHELL_MARK + "'") > -1, 'the script is not marked');
  assert.match(fnBody('checkForAppUpdate'), /cache:'no-store'/, 'the check can be answered from the cache it is checking');
});

function checker(live, fresh, opts) {
  const o = opts || {};
  const a = athlete();
  a.refreshOpenRecordPanel = () => {};
  a.appShellTexts = (doc) => (doc && doc.__fresh) ? fresh : live;
  a.DOMParser = function () { this.parseFromString = () => ({ __fresh: true }); };
  a.fetch = () => o.offline ? Promise.reject(new Error('offline'))
    : Promise.resolve({ ok: o.status !== 500, text: () => Promise.resolve('<html></html>') });
  return a;
}

test('the check answers: latest, new version ready, or could not check', async () => {
  assert.equal(await checker(['s', 'j'], ['s', 'j']).checkForAppUpdate(), 'current');
  assert.equal(await checker(['s', 'j'], ['s', 'j2']).checkForAppUpdate(), 'ready');
  /* It never claims an update, or the absence of one, it has no evidence for. */
  assert.equal(await checker(['s', 'j'], []).checkForAppUpdate(), 'failed');
  assert.equal(await checker(['s', 'j'], ['s', 'j'], { offline: true }).checkForAppUpdate(), 'failed');
  assert.equal(await checker(['s', 'j'], ['s', 'j'], { status: 500 }).checkForAppUpdate(), 'failed');
});

test('an Android app behind the store is sent there; a stale page is reloaded first', async () => {
  const behind = checker(['s', 'j'], ['s', 'j']);
  behind.Capacitor = { isNativePlatform: () => true };
  behind.nativeAppInfo = { build: String(behind.LATEST_NATIVE_BUILD - 1), version: '1.0' };
  assert.equal(await behind.checkForAppUpdate(), 'store');
  assert.match(behind.hqPanelHtml('update'), /<a class="btn btn-primary" href="https:\/\/play\.google\.com[^"]*"[^>]*target="_blank"[^>]*>Open Google Play<\/a>/);
  /* The page being newer comes first: the fresh one knows the store's latest. */
  const both = checker(['s', 'j'], ['s', 'j2']);
  both.Capacitor = behind.Capacitor; both.nativeAppInfo = behind.nativeAppInfo;
  assert.equal(await both.checkForAppUpdate(), 'ready');
  assert.match(both.hqPanelHtml('update'), /data-action="apply-app-update"[^>]*>Update now/);
});

test('the page says what it found, and opening it asks without being told to', async () => {
  const a = checker(['s', 'j'], ['s', 'j']);
  const calls = opened(a);
  a.openSettingsPanel('update');
  assert.match(calls[0].html, /Check for updates/);
  assert.equal(a.appUpdateState.status, 'checking', 'opening the page did not start the check');
  assert.match(a.hqPanelHtml('update'), /disabled/, 'the check can be started twice at once');
  let fetches = 0;
  const realFetch = a.fetch;
  a.fetch = function () { fetches++; return realFetch.apply(this, arguments); };
  assert.equal(await a.checkForAppUpdate(), 'checking', 'a second check ran on top of the first');
  assert.equal(fetches, 0, 'the app was downloaded twice for one question');
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.equal(a.appUpdateState.status, 'current');
  assert.match(a.hqPanelHtml('update'), /You have the latest version\./);
  assert.match(a.hqPanelHtml('update'), /data-action="check-app-update">Check again/);
  /* Yesterday's answer is not shown as today's. */
  a.appUpdateState.status = 'ready';
  a.stgPanelOpening('update');
  assert.equal(a.appUpdateState.status, 'idle');
});
