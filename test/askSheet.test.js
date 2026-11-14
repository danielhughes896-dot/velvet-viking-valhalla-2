'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

/* Founder's three interaction styles: "Bottom sheets: Quick choices such as
   Coach Voice, changing your name or confirming an action." No
   confirmation in SACORO uses the phone's own pop-up. */
const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

test('no confirmation uses the system dialog', () => {
  assert.doesNotMatch(CODE, /window\.(confirm|alert|prompt)\(/);
});

test('the question is a glass sheet with the two answers, the dangerous one red', () => {
  const a = loadApp({ pinnedDate: '2026-05-20T09:00:00Z' });
  const html = a.askSacoroHtml({ title: 'Start a New Block', say: 'Start your block?', hint: 'History is kept.', yes: 'Start block', no: 'Not now' });
  assert.match(html, /class="tw-sheet stg-sheet ask-sheet" role="alertdialog"/);
  assert.match(html, /<h2 class="font-head">Start a New Block<\/h2>/);
  assert.match(html, /data-action="ask-no">Not now</);
  assert.match(html, /class="btn btn-primary" data-action="ask-yes">Start block</);
  assert.match(a.askSacoroHtml({ title: 'T', say: 's', yes: 'Delete', danger: true }), /class="btn btn-danger" data-action="ask-yes"/);
});

test('each former system question now asks on the sheet', () => {
  ['handleStartBlock', 'handleResetPlan', 'handleRestorePlan', 'applyBackupJson', 'askSwapThen'].forEach(fn => {
    const i = CODE.indexOf('function ' + fn + '(');
    assert.ok(i > -1, fn);
    const body = CODE.slice(i, CODE.indexOf('\nfunction ', i + 10));
    assert.match(body, /askSacoro\(\{/, fn + ' does not ask on the sheet');
  });
});

test('declining does nothing, accepting does the thing', () => {
  const a = loadApp({ pinnedDate: '2026-05-20T09:00:00Z' });
  let did = 0;
  a.confirm = () => false;
  a.askSacoro({ title: 'T', say: 's', yes: 'Y', onYes: () => did++ });
  assert.equal(did, 0);
  a.confirm = () => true;
  a.askSacoro({ title: 'T', say: 's', yes: 'Y', onYes: () => did++ });
  assert.equal(did, 1);
});

test('quick choices rise as the glass sheet; management opens as a page', () => {
  ['openRunwayOfferModal', 'openAvailabilityOfferModal', 'openRaceGoalEntryModal', 'maybeOpenContextInsight'].forEach(fn => {
    const i = CODE.indexOf('function ' + fn + '(');
    const body = CODE.slice(i, CODE.indexOf('\nfunction ', i + 10));
    assert.match(body, /openModal\([^;]*'modal-themed stg-sheet/, fn + ' is not a glass sheet');
  });
  const i = CODE.indexOf('function openSettingsModal(');
  assert.match(CODE.slice(i, CODE.indexOf('\nfunction ', i + 10)), /openModal\(html, 'modal-themed builder-light '\+STG_PAGE\)/,
    'the onboarding Settings is not a full page');
});
