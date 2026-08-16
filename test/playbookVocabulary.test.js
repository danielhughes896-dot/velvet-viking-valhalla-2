'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

// "Stimulus" is internal training-science terminology. The file's own
// evolutionFallbackNote() comment already states the intent -- "the words
// 'stimulus', 'fallback', 'tier' and 'selection' stay out of the app" -- but
// several athlete-facing why/reason/text/means/note strings in the
// Playbook/Evolution engine still used it. This suite pins the specific leak
// HQ traced (playbookChangeWhy's PROGRESS fallback, reached whenever a
// proposal's target session was NOT chosen because the evidence matched its
// stimulus -- i.e. sel.selection !== 'matched_stimulus') plus the athlete-
// facing copy immediately around it, so it cannot silently return.

test('sim_fallback: playbookChangeWhy PROGRESS fallback (unmatched selection) never says "stimulus"', () => {
  const app = loadApp();
  const why = app.playbookChangeWhy('PROGRESS', {}, {}, { selection: 'key_session_fallback' });
  assert.doesNotMatch(why, /stimulus/i);
  assert.match(why, /training/i, 'the meaning -- repeated evidence of absorption -- must still be there');
});

test('sim_fallback: playbookChangeWhy REGRESS fallback never says "stimulus"', () => {
  const app = loadApp();
  const why = app.playbookChangeWhy('REGRESS', {}, {}, { selection: 'key_session_fallback' });
  assert.doesNotMatch(why, /stimulus/i);
});

test('sim_fallback: playbookChangeWhy still names the specific work when the evidence genuinely matched it', () => {
  const app = loadApp();
  const why = app.playbookChangeWhy('PROGRESS', {}, {}, { selection: 'matched_stimulus', stimulus: 'threshold' });
  assert.match(why, /threshold work/, 'the named-match path is unaffected -- only the generic fallback text changed');
});

test('voice regression: EVOLUTION_META and PLAYBOOK_DECISIONS athlete-facing copy is jargon-free', () => {
  const app = loadApp();
  Object.keys(app.EVOLUTION_META).forEach((k) => {
    assert.doesNotMatch(app.EVOLUTION_META[k].text, /stimulus/i, `EVOLUTION_META.${k}.text`);
  });
  Object.keys(app.PLAYBOOK_DECISIONS).forEach((k) => {
    assert.doesNotMatch(app.PLAYBOOK_DECISIONS[k].means, /stimulus/i, `PLAYBOOK_DECISIONS.${k}.means`);
  });
  assert.doesNotMatch(app.PLAYBOOK_PHASE_RULES.Peak.note, /stimulus/i, 'PLAYBOOK_PHASE_RULES.Peak.note');
});

test('voice regression: evolutionChanges() why text for every branch is jargon-free', () => {
  const app = loadApp();
  function day(id, type, km, extra) {
    return Object.assign({ id, date: id, type, km, mpSegment: false }, extra || {});
  }
  const scenarios = [
    ['RECOVER', [day('2026-08-10', 'threshold', 8)]],
    ['RECOVER', [day('2026-08-10', 'easy', 10)]],
    ['ADAPT', [day('2026-08-10', 'easy', 5)]],
    ['ADAPT', [day('2026-08-10', 'threshold', 8)]],
  ];
  scenarios.forEach(([state, pending]) => {
    const out = app.evolutionChanges(state, 'Build', pending, []);
    out.forEach((c) => assert.doesNotMatch(c.why, /stimulus/i, `${state} change.why: "${c.why}"`));
  });
});
