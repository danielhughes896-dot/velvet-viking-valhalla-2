'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THE SETTINGS REVIEW, AGREED.

   Founder, on the review of Settings' order, grouping, navigation, controls
   and colours: "agree with everything!! Every point you made is how I want
   it". Each point is a law below. */

const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

function athlete(){
  const a = loadApp({ pinnedDate: '2026-05-20T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 16, distanceKey: 'half', startDate: '2026-04-08', lthr: 170, maxHR: 190 });
  return a;
}
const groups = html => [...html.matchAll(/class="setup-section-title">([^<]+)</g)].map(m => m[1].replace(/&amp;/g, '&'));
function groupRows(html, name){
  const at = html.indexOf('>' + name.replace(/&/g, '&amp;') + '<');
  assert.ok(at !== -1, name + ' group is missing');
  const ends = [html.indexOf('setup-section-title', at + 10), html.indexOf('stg-solo', at), html.indexOf('build-tag', at)]
    .filter(i => i !== -1);
  const end = Math.min.apply(null, ends);
  return [...html.slice(at, end).matchAll(/stg-row-title">([^<]+)</g)].map(m => m[1].replace(/&amp;/g, '&'));
}

test('ORDER: Account, Training, Preferences, Data & Privacy; Contact and App Update at the foot', () => {
  const a = athlete();
  const html = a.renderSettingsHubView();
  const g = groups(html);
  assert.deepEqual(g.filter(x => x !== 'Connect'), ['Account', 'Training', 'Preferences', 'Data & Privacy']);
  assert.doesNotMatch(html, />App</, 'the App group is back at the top');
  const foot = html.slice(html.indexOf('>Data &amp; Privacy<'));
  assert.ok(foot.indexOf('>Contact<') < foot.indexOf('>App Update<'), 'Contact and App Update are not at the foot');
  assert.ok(foot.indexOf('>App Update<') < foot.indexOf('build-tag'), 'App Update is not beside the build');
});

test('GROUPING: what the plan does under Training, how the app speaks under Preferences', () => {
  const a = athlete();
  const html = a.renderSettingsHubView();
  assert.deepEqual(groupRows(html, 'Training'),
    ['Training & Zones', 'Strength & Mobility', 'Training Availability', 'Start a New Block']);
  assert.deepEqual(groupRows(html, 'Preferences'),
    ['Your Name', 'Coach Voice', 'Daily Reminder', 'Distance Units']);
  assert.deepEqual(groupRows(html, 'Data & Privacy'),
    ['Health & Readiness', 'Export / Import Backup']);
  assert.doesNotMatch(html, /data-panel="prefs"/, 'Preferences is behind a row again');
  assert.equal(a.ACTION_PANELS.prefs, undefined);
});

test('CONTROLS: Strength & Mobility is a switch, like the reminder and Health beside it', () => {
  const a = athlete();
  const row = a.renderSupportWorkRow();
  assert.match(row, /class="switch"><input type="checkbox" data-action="toggle-support-work"/);
  assert.doesNotMatch(row, /data-action="set-support-work"/, 'the lone On/Off button is back');
  assert.match(SRC, /action === 'toggle-support-work'\) handleSetSupportWork\(!!t\.checked\)/);
  a.handleSetSupportWork(true);
  assert.match(a.renderSupportWorkRow(), / checked>/);
  a.handleSetSupportWork(false);
  assert.doesNotMatch(a.renderSupportWorkRow(), / checked>/);
  assert.match(a.renderNotifyToggleRow(), /class="switch"><input type="checkbox" data-action="toggle-notify"/);
});

test('NAVIGATION: name, voice, sign out and delete rise as glass sheets that replace, never stack', () => {
  const a = athlete();
  const calls = [];
  a.openModal = (html, cls, key) => calls.push({ html, cls, key });
  ['name', 'voice', 'signout', 'deleteaccount'].forEach(k => a.openStgSheet(k));
  assert.equal(calls.length, 4);
  calls.forEach(c => {
    assert.match(c.cls, /\bmodal-themed\b/);
    assert.match(c.cls, /\bstg-sheet\b/);
    assert.doesNotMatch(c.cls, /builder-light|hq-full/, 'a sheet became a centred card or a page');
  });
  assert.match(calls[0].html, /id="athlete-name"/);
  assert.match(calls[1].html, /id="coach-voice-row"/);
  assert.match(calls[2].html, /Sign out of/);
  assert.match(calls[3].html, /class="btn btn-danger" data-action="cloud-delete-account-confirmed"/);
  // the sheet docks at the bottom: it does not take builder-light's centring
  assert.match(CSS, /\.modal-card\.stg-sheet\{[^}]*backdrop-filter:blur\(/, 'the sheet is not glass');
  assert.match(CSS, /\.modal-card\.stg-sheet\{[^}]*border-radius:24px 24px 0 0/, 'the sheet is not docked');
});

test('NAVIGATION: Sign Out is confirmed, and Cancel goes back to the Account page', () => {
  const a = athlete();
  a.cloudConfigured = () => true;
  a.cloudSession = { access_token: 't', email: 'athlete@example.com' };
  const card = a.renderCloudCard();
  assert.match(card, /data-action="open-stg-sheet" data-sheet="signout">Sign out</, 'signing out is one tap again');
  assert.doesNotMatch(card, /data-action="cloud-sign-out"/);
  let reopened = null;
  a.openSettingsPanel = k => { reopened = k; };
  a.openModal = () => {};
  a.openStgSheet('signout');
  a.closeStgSheet();
  assert.equal(reopened, 'account', 'Cancel did not return to the Account page');
});

test('NAVIGATION: Delete Account asks on its sheet, not in a system dialog', () => {
  const a = athlete();
  assert.match(SRC, /function handleCloudDeleteAccount\(confirmed\)\{[\s\S]{0,200}var ok = confirmed \|\| window\.confirm\(/);
  assert.match(SRC, /case 'cloud-delete-account-confirmed': closeModal\(\); handleCloudDeleteAccount\(true\); break;/);
  assert.match(a.deleteAccountSheetBody(), /cannot be undone/i);
});

test('ACCOUNT PAGE: Restore a plan comes before the Permanent section', () => {
  const a = athlete();
  a.cloudConfigured = () => true;
  a.cloudSession = { access_token: 't', email: 'athlete@example.com' };
  const card = a.renderCloudCard();
  assert.ok(card.indexOf('open-restore') !== -1);
  assert.ok(card.indexOf('open-restore') < card.indexOf('class="danger-zone"'), 'the permanent action is not last');
});

test('APP UPDATE: the row asks and answers in place; there is no page behind it', () => {
  const a = athlete();
  assert.equal(a.ACTION_PANELS.update, undefined, 'the near-empty page is back');
  assert.match(a.appUpdateRowHtml(), /id="app-update-row"[^>]*data-action="check-app-update"/);
  a.appUpdateState.status = 'checking';
  assert.match(a.appUpdateRowHtml(), /disabled/);
});

test('CONNECT: an unavailable Garmin is not listed, and an empty group has no heading', () => {
  const a = athlete();
  a.stravaSettingsVisible = () => false;
  a.garminCapability = { available: false };
  const html = a.renderSettingsHubView();
  assert.doesNotMatch(html, /Garmin Connect|Not yet available/);
  assert.doesNotMatch(html, />Connect</, 'a Connect heading stands over nothing');
});

test('CONTROLS: Re-calibrate is a row like its neighbours, and the backup words drop the jargon', () => {
  const a = athlete();
  const tz = a.settingsPanelTraining();
  assert.match(tz, /stg-row-title">Re-calibrate Training Zones</);
  assert.doesNotMatch(tz, /btn-recal/, 'Re-calibrate is a cherry button again');
  const bk = a.settingsPanelBackup();
  assert.match(text(bk), /Export Backup File/);
  assert.match(text(bk), /Import Backup File/);
  assert.doesNotMatch(bk, /\(JSON\)|Other exports/);
});

test('WORDS: every row title in Title Case, and the reminder says what it does', () => {
  const a = athlete();
  const titles = [...a.renderSettingsHubView().matchAll(/stg-row-title">([^<]+)</g)].map(m => m[1].replace(/&amp;/g, '&'));
  const small = new Set(['a', 'and', 'or', 'of', 'the', 'to', '/', '&']);
  titles.forEach(t => t.split(' ').forEach((w, i) => {
    if (i && small.has(w)) return;
    assert.ok(/^[A-Z0-9]/.test(w), '"' + t + '" is not in Title Case');
  }));
  assert.match(text(a.renderNotifyToggleRow()), /^ ?Daily Reminder /);
});

test('COLOURS: the sheet’s one action is cherry glass, danger stays red, nothing new is grey', () => {
  assert.match(CSS, /\.stg-sheet \.btn-primary\{[^}]*color-mix\(in srgb, var\(--cherry\) 55%, transparent\)/);
  assert.match(CSS, /\.stg-sheet-say\{[^}]*color:#FFFFFF/);
  assert.match(CSS, /\.stg-sheet \.field-hint\{color:#FFFFFF;\}/);
});
