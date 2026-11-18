'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

/* AUDIT IV: THE FOUNDER'S DESIGN DECISIONS.
     Three decision sheets   consolidate into the builder's review stage,
                             all three decisions kept
     1px dividers            removed; spacing and hierarchy instead
     Preparation sheet       the glass treatment, not the photograph
     Injured or Ill?         Report Injury or Illness
     Website buttons         Title Case, no arrows
     Coach ring text         an 11px minimum, circles unchanged */

const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const GET = fs.readFileSync(path.join(__dirname, '..', 'get.html'), 'utf8');

function hostApp(){
  const a = loadApp({ pinnedDate: '2026-11-17T08:00:00Z' });
  const host = { hidden: true, innerHTML: '', closest: () => ({ hidden: false }), scrollIntoView(){} };
  const modalClasses = new Set(['bld-modal']);
  const modal = { classList: { add: c => modalClasses.add(c), remove: c => modalClasses.delete(c) } };
  a.document.getElementById = id => (id === 'bld-decide' ? host : null);
  a.document.querySelector = sel => (sel === '.bld-modal' ? modal : null);
  return { a, host, modalClasses };
}

test('a decision asked from the review stage is drawn there, with the same two answers', () => {
  const { a, host, modalClasses } = hostApp();
  const said = [];
  a.askSacoro = () => said.push('sheet');
  const got = [];
  a.bldDecide({ title: 'Choose Your Pathway', say: 'You run 5km a week now.', hint: 'You can keep Established.',
    yes: 'Switch to Developing', no: 'Keep Established', onYes: () => got.push('yes'), onNo: () => got.push('no') });
  assert.deepEqual(said, [], 'it rose as a sheet over the builder');
  assert.equal(host.hidden, false);
  assert.match(host.innerHTML, /<h3 class="font-head bld-decide-title">Choose Your Pathway<\/h3>/);
  assert.match(host.innerHTML, /data-action="bld-decide-no">Keep Established</);
  assert.match(host.innerHTML, /class="btn btn-primary" data-action="bld-decide-yes">Switch to Developing</);
  assert.ok(modalClasses.has('is-deciding'), 'the Build button did not step aside');
  a.bldDecideAnswer(false);
  assert.deepEqual(got, ['no']);
  assert.equal(host.hidden, true);
  assert.ok(!modalClasses.has('is-deciding'));
  assert.match(CSS, /\.bld-modal\.is-deciding \.bld-actions \[data-action="generate-plan"\]\{display:none;\}/);
});

test('with no builder on screen it is still the glass sheet', () => {
  const a = loadApp({ pinnedDate: '2026-11-17T08:00:00Z' });
  a.document.getElementById = () => null;
  const said = [];
  a.askSacoro = o => said.push(o.title);
  a.bldDecide({ title: 'Make Room for Your Week', say: 'x', yes: 'Add a Running Day', no: 'Keep This Plan' });
  assert.deepEqual(said, ['Make Room for Your Week']);
});

test('all three decisions go through the review stage', () => {
  ['openWeekFitSheet', 'openEntryPathwaySheet', 'openPathwayOfferSheet'].forEach(fn => {
    const body = SRC.slice(SRC.indexOf('function ' + fn + '('), SRC.indexOf('\n}\n', SRC.indexOf('function ' + fn + '(')));
    assert.match(body, /bldDecide\(\{/, fn + ' still opens its own sheet');
    assert.doesNotMatch(body, /askSacoro\(/, fn);
  });
  /* The preparation and runway offers are drawn there too, and Continue keeps
     the builder rather than closing it. */
  assert.match(SRC, /if \(bldDecideInline\('Your ' \+ lbl \+ ' Preparation', bldDecideBodyOf\(html\)\)\) return;/);
  assert.match(SRC, /if \(bldDecideInline\('You have ' \+ plan\.weeksToRace \+ ' weeks', bldDecideBodyOf\(html\)\)\) return;/);
  assert.match(SRC, /case 'prep-continue': if \(!bldDecideTakeOver\(\)\) closeModal\(\);/);
  assert.match(SRC, /case 'runway-continue': if \(!bldDecideTakeOver\(\)\) closeModal\(\);/);
  /* Make Room for Your Week: the builder stays up and asks there. */
  assert.match(SRC, /var askRoomInBuilder = planBuildNotes\.length > 0 && !!bldDecideHost\(\);\n  if \(!askRoomInBuilder\) closeModal\(\);/);
  assert.match(SRC, /\(askRoomInBuilder \? bldDecide : askSacoro\)\(\{ title: 'Make Room for Your Week',/);
});

test('the Preparation offer is drawn on the review page without its photograph', () => {
  const { a, host } = hostApp();
  a.openModal = () => { throw new Error('opened a sheet over the builder'); };
  a.openRaceGoalPreparationModal({ decision: 'preparation_not_reachable', weeksToRace: 13, recommend: 'base',
    preparation: { verdict: 'INSUFFICIENT', dimensions: [{ key: 'workload', reachedKm: 16.3, requiredKm: 35, shortfallKm: 18.7, met: false }] } }, 'half');
  assert.match(host.innerHTML, /Your Half Marathon Preparation/);
  assert.match(host.innerHTML, /data-action="prep-continue"/);
  assert.match(host.innerHTML, /data-action="prep-route"/);
  assert.doesNotMatch(host.innerHTML, /modal-decision-hero|modal-head/);
  assert.equal(a.bldDecideTakeOver(), true);
  assert.equal(host.hidden, true);
});

test('no 1px dividers between figures or beside headings', () => {
  assert.doesNotMatch(CSS, /\.rs-fig \+ \.rs-fig\{[^}]*border/);
  assert.doesNotMatch(CSS, /\.zcol \+ \.zcol\{[^}]*border/);
  assert.match(CSS, /\.rs-figs\{display:flex; width:100%; gap:14px;\}/);
  assert.match(CSS, /\.sec-rule \.sec-rule-line\{display:none;\}/);
  assert.match(CSS, /\.hq-panel \.setup-section-title::after, \.hq-panel \.evo-k::after\{content:none;\}/);
});

test('Report Injury or Illness, on Today and on the Recovery Check', () => {
  assert.match(SRC, /data-action="recovery-check-injury">Report Injury or Illness</);
  assert.match(SRC, /'aria-haspopup="dialog">Report Injury or Illness<\/button>'/);
  assert.doesNotMatch(SRC, />Injured or [Ii]ll\?</);
});

test('website buttons: Title Case, no arrows', () => {
  const btn = GET.match(/\n\s*\.btn\{[^}]*\}/)[0];
  assert.doesNotMatch(btn, /text-transform:\s*uppercase/);
  const buttons = GET.match(/<a class="btn[^"]*"[\s\S]*?<\/a>/g);
  assert.ok(buttons.length >= 3);
  buttons.forEach(b => assert.doesNotMatch(b, /<svg/, 'an arrow is back: ' + b.replace(/\s+/g, ' ').slice(0, 80)));
  assert.match(GET, />\s*Download the App\s*</);
  assert.match(GET, />\s*Open the App\s*</);
  assert.match(GET, />\s*Launch the App\s*</);
});

test('Coach ring words never draw below 11px; the circle keeps its size', () => {
  const a = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  const word = { style: {}, textContent: 'On track', getBoundingClientRect: () => ({ width: 90 }) };
  const kid = { style: {}, offsetHeight: 30, firstElementChild: word };
  const medal = { clientWidth: 60, clientHeight: 60, children: [kid] };
  a.document = { querySelectorAll: () => [medal] };
  a.window.getComputedStyle = () => ({ fontSize: '12px' });
  a.fitDialValues();
  assert.equal(word.style.fontSize, '11px', 'the word was scaled under the floor');
  assert.equal(kid.style.transform, '', 'the word was scaled as well as floored');
  assert.equal(medal.clientWidth, 60);
  assert.equal(a.DIAL_TEXT_FLOOR_PX, 11);
});
