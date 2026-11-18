'use strict';
// THE BUILDER RAIL IS A WAY BACK, AND THE TWO-PLANS SHEET ANSWERS IN THE
// JOURNEY (founder, 18 November 2026).
//   * "if you could click on the bars at the top to go back to that page":
//     each rail segment opens its page. Back is free; forward goes no
//     further than the furthest page reached, and checks every page on the
//     way, as Continue does.
//   * "Cannot get past this screen buttons dont work": the two-plans sheet,
//     raised by signing in during the journey, had both of its buttons
//     refused by journey-only mode, and it has no close control.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

const RUNTIME = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const TODAY = '2026-08-22';

function app(){ return loadApp({ pinnedDate: TODAY + 'T09:00:00Z' }); }
function seg(i){ return { getAttribute: (k) => (k === 'data-stage' ? String(i) : null) }; }
/* bldStage and bldValidateStage reach the DOM; the harness document is a
   stub, so both are recorded instead, keeping the rail's own decisions. */
function wire(a, opts){
  const o = opts || {};
  const moves = [], checks = [];
  a.bldStage = (n) => { moves.push(n); a.bldCurrentStage = n; if (n > a.bldFurthestStage) a.bldFurthestStage = n; };
  a.bldValidateStage = (i) => { checks.push(i); return !(o.fails || []).includes(i); };
  a.bldClearErrors = () => {};
  a.bldPreselectWeekFromAnswers = () => {};
  a.journeySkipsGoal = () => !!o.skipGoal;
  a.bldSkipsTargets = () => !!o.skipTargets;
  return { moves, checks };
}

test('the rail draws one tappable segment per stage, named, the first current', () => {
  const a = app();
  let html = null;
  a.openModal = (h) => { html = h; };
  a.openSetupModal();
  const segs = html.match(/<button type="button" class="bld-step[^"]*"[^>]*>/g) || [];
  assert.equal(segs.length, a.BLD_STAGE_NAMES.length);
  segs.forEach((s, i) => {
    assert.match(s, /data-action="bld-rail"/, 'segment ' + i + ' does nothing when tapped');
    assert.match(s, new RegExp('data-stage="' + i + '"'));
    assert.match(s, new RegExp('aria-label="Step ' + (i + 1) + ': '), 'segment ' + i + ' has no name for a screen reader');
  });
  assert.match(segs[0], /aria-current="step"/);
  assert.ok(segs.slice(1).every(s => /aria-disabled="true"/.test(s)), 'a page not yet reached looks reachable');
  assert.match(RUNTIME, /case 'bld-rail': handleBldRail\(target\); break;/);
});

test('the tap area is 44px tall while the bar stays 3px', () => {
  const m = RUNTIME.match(/\.bld-step::after\{[^}]*top:-(\d+)px; bottom:-(\d+)px;\}/);
  assert.ok(m, 'the rail has no enlarged tap area');
  assert.equal(3 + Number(m[1]) + Number(m[2]), 44);
  assert.match(RUNTIME, /\.bld-step\{flex:1 1 0; height:3px;/);
});

test('tapping an earlier page goes straight there, unchecked, as Back does', () => {
  const a = app(); const w = wire(a);
  a.bldCurrentStage = 8; a.bldFurthestStage = 8; a.bldReviewReturn = true;
  a.handleBldRail(seg(1));
  assert.deepEqual(w.moves, [1]);
  assert.deepEqual(w.checks, []);
  assert.equal(a.bldReviewReturn, false, 'a rail move left Continue reading Done');
});

test('a page not yet reached cannot be opened from the rail', () => {
  const a = app(); const w = wire(a);
  a.bldCurrentStage = 3; a.bldFurthestStage = 3;
  a.handleBldRail(seg(4));
  a.handleBldRail(seg(9));
  a.handleBldRail(seg(3));
  assert.deepEqual(w.moves, []);
});

test('forward to a page already reached checks every page on the way', () => {
  const a = app(); const w = wire(a);
  a.bldCurrentStage = 2; a.bldFurthestStage = 7;
  a.handleBldRail(seg(6));
  assert.deepEqual(w.checks, [2, 3, 4, 5]);
  assert.equal(a.bldCurrentStage, 6);
});

test('forward stops on the first page that fails its check, with the page open', () => {
  const a = app(); const w = wire(a, { fails: [4] });
  a.bldCurrentStage = 2; a.bldFurthestStage = 7;
  a.handleBldRail(seg(7));
  assert.deepEqual(w.checks, [2, 3, 4]);
  assert.equal(a.bldCurrentStage, 4, 'the failing page is not the one showing its message');
});

test('a page the build skips is neither a target nor checked on the way', () => {
  const a = app(); const w = wire(a, { skipGoal: true });
  const G = a.BLD_STAGE.GOAL;
  a.bldCurrentStage = G + 3; a.bldFurthestStage = G + 3;
  a.handleBldRail(seg(G));
  assert.deepEqual(w.moves, [], 'the skipped Goal page opened');
  a.bldCurrentStage = G - 1;
  a.handleBldRail(seg(G + 2));
  assert.ok(!w.checks.includes(G), 'the skipped Goal page was checked');
  assert.equal(a.bldCurrentStage, G + 2);
});

test('editing a plan opens with every page reachable; a new build with only the first', () => {
  const at = RUNTIME.indexOf('function openSetupModal(');
  const body = RUNTIME.slice(at, RUNTIME.indexOf('\n}\n', RUNTIME.indexOf('bldStage(0);', at)));
  assert.match(body, /bldFurthestStage = \(typeof planHasContent === 'function' && planHasContent\(\)\) \? BLD_STAGE_NAMES\.length - 1 : 0;/);
  assert.ok(body.indexOf('bldFurthestStage = ') < body.lastIndexOf('bldStage(0);'));
});

test('journey-only mode lets both two-plans buttons through', () => {
  const a = app();
  const at = RUNTIME.indexOf('function openCloudConflictModal(');
  const body = RUNTIME.slice(at, RUNTIME.indexOf('function handleCloudKeepLocal(', at));
  const acts = (body.match(/data-action="([a-z0-9-]+)"/g) || []).map(m => m.slice(13, -1));
  assert.deepEqual(acts.sort(), ['cloud-keep-local', 'cloud-keep-remote']);
  acts.forEach(x => assert.equal(a.journeyOnlyAllows(x), true, x + ' is refused, so the sheet cannot be answered'));
});

test('after the choice, journey-only mode asks the gate again', () => {
  ['handleCloudKeepLocal', 'handleCloudKeepRemote'].forEach((fn) => {
    const a = app();
    let asked = 0;
    a.JOURNEY_ONLY_MODE = true;
    a.closeModal = () => {}; a.patchCloudCard = () => {}; a.showToast = () => {}; a.renderApp = () => {};
    a.cloudPutPlan = () => Promise.resolve();
    a.adoptCloudState = () => {}; a.writeSyncMark = () => {};
    a.establishDeliverySession = () => { asked++; return Promise.resolve(null); };
    a[fn]();
    assert.equal(asked, 1, fn + ' left a granted athlete in the journey');
    assert.equal(a.cloudPendingReconcile, false);
  });
  const a = app();
  let asked = 0;
  a.closeModal = () => {}; a.patchCloudCard = () => {}; a.showToast = () => {};
  a.cloudPutPlan = () => Promise.resolve();
  a.establishDeliverySession = () => { asked++; return Promise.resolve(null); };
  a.handleCloudKeepLocal();
  assert.equal(asked, 0, 'the full app asked the gate again for nothing');
});
