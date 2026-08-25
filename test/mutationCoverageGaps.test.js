'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

// AUDIT REPRO (Final Full Product Audit, Part 22, findings C10-C13). The
// mutation harness (test/mutation/run.js) found 4 genuine survivors -- the
// mutation was applied and the full suite still passed -- meaning these
// four facts had no regression-catching test at all:
//   - Race Outlook's measured-band colour token (--cherry)
//   - Race Outlook's goal-marker colour token (--gold)
//   - the two Valhalla action tiles dispatching to distinct actions
//   - the action tile's minimum touch-target height
// These are pinned directly here. Not exhaustive re-implementations of the
// mutation harness's own cases -- narrow, targeted assertions on exactly
// the facts that were unguarded.

const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');

test('the Race Outlook measured band keeps the brand accent colour', () => {
  assert.match(SRC, /\.outlook-band\{[^}]*background:var\(--cherry\)/,
    'the measured band must render in the canonical brand accent, not a mutated colour');
});

test('the Race Outlook goal marker stays gold', () => {
  assert.match(SRC, /\.outlook-goal\{[^}]*background:var\(--gold\)/,
    'the goal marker must stay gold -- distinguishable from the cherry measured band');
});

test('Valhalla\'s two action tiles dispatch to two distinct actions, never the same one twice', () => {
  const a = loadApp();
  const row = a.renderValhallaActionsRow();
  const actions = Array.from(row.matchAll(/data-action="([^"]+)"/g)).map((m) => m[1]);
  assert.equal(actions.length, 2, 'sanity: exactly two action tiles');
  assert.notEqual(actions[0], actions[1],
    'two visually distinct tiles ("New block" / "Plan settings") must not fire the identical action');
  assert.equal(actions[0], 'open-new-block');
  assert.equal(actions[1], 'open-setup');
});

test('action tiles keep a real touch-target minimum height', () => {
  assert.match(SRC, /min-height:76px; padding:10px 6px;/,
    'action tiles must keep their real minimum touch-target height');
});
