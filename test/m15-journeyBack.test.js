'use strict';
// BACK, ALL THE WAY (founder, 18 November 2026: "I can only go back to build
// a plan not all way to website"). In the first-time journey the builder's
// first page has a Back to What Drives You?, and in a browser the Welcome has
// a back arrow to the website (sacoro.app since 20 November 2026, when SACORO's
// site moved there from velvetviking.co.uk). The installed app has no website behind
// it, so there the Welcome keeps no arrow and Back leaves the app as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

function app(){ return loadApp({ pinnedDate: '2026-11-18T09:00:00Z' }); }

test('in the journey, the builder\'s first page has a Back', () => {
  const a = app();
  a.journeyActive = () => true;
  let html = '';
  a.openModal = (h) => { html = h; };
  a.openSetupModal();
  const first = html.slice(html.indexOf('class="bld-panel" data-stage="0"'), html.indexOf('class="bld-panel" data-stage="1"'));
  assert.match(first, /data-action="bld-back"/, 'the first page has no way back');
});

test('outside the journey, the builder\'s first page still has no Back', () => {
  const a = app();
  a.journeyActive = () => false;
  let html = '';
  a.openModal = (h) => { html = h; };
  a.openSetupModal();
  const first = html.slice(html.indexOf('class="bld-panel" data-stage="0"'), html.indexOf('class="bld-panel" data-stage="1"'));
  assert.doesNotMatch(first, /data-action="bld-back"/);
});

test('Back from the builder\'s first page, in the journey, closes it onto the last slide', () => {
  const a = app();
  const went = []; let closed = 0;
  a.journeyActive = () => true;
  a.journeyGo = (s) => went.push(s);
  a.closeModal = () => { closed++; };
  a.bldStage = () => { throw new Error('the builder moved instead of closing'); };
  a.bldCurrentStage = 0; a.bldReviewReturn = false;
  a.handleBldBack();
  assert.deepEqual(went, ['slides'], 'the slides come before the builder now');
  assert.equal(closed, 1);
});

test('Back from the builder\'s first page outside the journey does nothing', () => {
  const a = app();
  const went = [];
  a.journeyActive = () => false;
  a.journeyGo = (s) => went.push(s);
  a.bldStage = () => went.push('stage');
  a.bldCurrentStage = 0; a.bldReviewReturn = false;
  a.handleBldBack();
  assert.deepEqual(went, []);
});

test('in a browser the Welcome has a back arrow to the website', () => {
  const a = app();
  a.isNativeApp = () => false;
  a.journeyAskProviders = () => {};
  assert.match(a.renderJourneyWelcome(false), /class="jr-back jr-welcome-back" data-action="journey-back" aria-label="Back to sacoro\.app"/);
  const to = [];
  a.journeyStep = () => 'welcome';
  a.journeyNavigate = (u) => { to.push(u); return true; };
  a.journeyBack();
  assert.deepEqual(to, ['https://sacoro.app']);
});

test('in the installed app the Welcome has no arrow and Back does not leave for the website', () => {
  const a = app();
  a.isNativeApp = () => true;
  a.journeyAskProviders = () => {};
  assert.doesNotMatch(a.renderJourneyWelcome(false), /jr-welcome-back/);
  const to = [];
  a.journeyStep = () => 'welcome';
  a.journeyNavigate = (u) => { to.push(u); return true; };
  assert.equal(a.journeyBack(), false);
  assert.deepEqual(to, []);
});
