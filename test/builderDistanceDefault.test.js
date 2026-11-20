'use strict';
/* THE GOAL DISTANCE THE BUILDER SHOWS IS THE ONE IT BUILDS FOR.

   Found walking the first-time journey from the website on 20 November 2026:
   the Goal Distance screen ticked Full Marathon for a new athlete, while the
   hidden <select> the plan is generated from had nothing selected, so the
   browser used its first option, 5K. Accepting the ticked default produced
   "A 14-week build to your 5K". The grid and the select now share one default,
   and these tests hold them together for a new athlete and for every distance.

   Also here: Suggest Goals From Benchmark with no benchmark at all (after
   I Haven't Run One) says what a suggestion needs, rather than explaining how
   to type a time the athlete has just said they do not have. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

const TODAY = '2026-11-20';

function openBuilder(mutate) {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  if (mutate) mutate(a);
  let html = null;
  a.openModal = (h) => { html = h; };
  a.openSetupModal();
  assert.ok(html, 'openSetupModal() did not open anything');
  return { a, html };
}

function shownDistance(html) {
  const grid = html.match(/data-mirror="su-distance"[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(grid, 'no goal distance grid in the builder');
  const ticked = [...grid[1].matchAll(/<button[^>]*data-v="([^"]+)"[^>]*class="active"/g)].map((m) => m[1]);
  assert.equal(ticked.length, 1, 'exactly one distance should be shown as chosen, got ' + JSON.stringify(ticked));
  return ticked[0];
}

function builtDistance(html) {
  const sel = html.match(/<select id="su-distance"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(sel, 'no su-distance select in the builder');
  const selected = [...sel[1].matchAll(/<option value="([^"]+)"\s+selected/g)].map((m) => m[1]);
  // A <select> with nothing marked selected uses its first option.
  if (!selected.length) return sel[1].match(/<option value="([^"]+)"/)[1];
  assert.equal(selected.length, 1, 'more than one distance is marked selected');
  return selected[0];
}

test('a new athlete: the distance the screen ticks is the distance the plan is built for', () => {
  const { html } = openBuilder();
  const shown = shownDistance(html);
  assert.equal(shown, 'full', 'the builder opens on Full Marathon, as the founder set it');
  assert.equal(builtDistance(html), shown,
    'the screen shows ' + shown + ' as chosen but the plan would be built for ' + builtDistance(html));
});

test('every distance: shown and built agree when the athlete already chose one', () => {
  const { a } = openBuilder();
  for (const key of a.DISTANCE_ORDER) {
    const { html } = openBuilder((app) => { app.state.setup = Object.assign({}, app.state.setup, { distanceKey: key }); });
    assert.equal(shownDistance(html), key, 'the screen should show ' + key);
    assert.equal(builtDistance(html), key, 'the plan should be built for ' + key);
  }
});

function suggestWith(benchTime) {
  const a = loadApp({ pinnedDate: TODAY });
  a.state.setup = { distanceKey: 'full' };
  let toast = null;
  const goals = {};
  a.showToast = (m) => { toast = m; };
  a.document.getElementById = (id) => {
    if (id === 'su-bench-dist') return { value: '5k' };
    if (id === 'su-distance') return { value: 'full' };
    if (id === 'su-bench-time') return { value: benchTime };
    if (id.indexOf('su-goal-') === 0) return { set value(v) { goals[id] = v; } };
    return null;
  };
  a.handleSuggestGoals();
  return { toast, goals };
}

test('Suggest Goals with no benchmark says what a suggestion needs, and suggests nothing', () => {
  for (const empty of ['', '   ']) {
    const { toast, goals } = suggestWith(empty);
    assert.match(toast, /Suggestions come from a recent 5K or 10K time/);
    assert.doesNotMatch(toast, /minutes and seconds/, 'not typing help for a time that was never given');
    assert.deepEqual(goals, {}, 'nothing should be filled in');
  }
});

test('Suggest Goals with a time still suggests, and an unreadable time still gets the typing help', () => {
  const ok = suggestWith('23:25');
  assert.ok(Object.keys(ok.goals).length > 0, 'a real benchmark should fill the goals');
  const bad = suggestWith('not a time');
  assert.equal(bad.toast, 'Enter your time as minutes and seconds, e.g. 23.25 or 23:25');
});
