'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/* RETIRED (founder, 16 November 2026, item 9: "Can it be removed? Yeh"): the web builder on /start is removed; the plan is built in the app (/get). */
// THE BUILDER'S VISUAL LANGUAGE.
//
// This file compared the in-app builder with its copy on /start, value by
// value. The copy is gone, so there is one surface left and nothing to drift
// from. What it held of the app's own builder is kept: the Cherry Lacquer
// accent for forward motion and progress, a chosen option lined in cherry
// rather than filled, the weekday circles, the review rows.

const ROOT = path.join(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'protected', 'velvet-viking-valhalla.html'), 'utf8');
const START_SRC = fs.readFileSync(path.join(ROOT, 'start.html'), 'utf8');

function tokenValue(src, selectorBlockRe, token) {
  const m = selectorBlockRe.exec(src);
  if (!m) return undefined;
  const tm = new RegExp('--' + token + ':\\s*([^;]+);').exec(m[1]);
  return tm ? tm[1].trim() : undefined;
}

const CHERRY_TOKENS = ['cherry', 'cherry-fill', 'cherry-soft', 'cherry-line', 'cherry-dim', 'cherry-text', 'cherry-ink', 'cherry-btn-ink'];
const OTHER_TOKENS = ['fs-meta', 'fs-label', 'fs-support', 'fs-data', 'fs-body', 'fs-title', 'lh-body', 'lh-support', 'line-soft', 'danger-text', 'c-gold-soft'];

test('every Cherry Lacquer token the builder reads is defined in the app', () => {
  CHERRY_TOKENS.concat(OTHER_TOKENS).forEach((tok) => {
    assert.ok(tokenValue(APP_SRC, /:root\{([\s\S]*?)\n  \}/, tok), '--' + tok + ' is not defined in the app\'s :root');
  });
});

test('the app\'s primary builder action is Cherry Lacquer, scoped to .builder-light', () => {
  const appRule = /\.builder-light \.btn-primary\{([^}]*)\}/.exec(APP_SRC);
  assert.ok(appRule, 'the app no longer scopes Cherry Lacquer to .builder-light .btn-primary');
  assert.match(appRule[1], /var\(--cherry-fill\)/);
});

test('a chosen option is lined in cherry, not filled, and glows cherry', () => {
  /* A FILLED cherry option was tried and gives a choice the same weight as
     Continue, which carries --cherry-fill at the foot of the same screen. */
  const appRule = /\.opt-grid button\.active\{([^}]*)\}/.exec(APP_SRC);
  assert.ok(appRule, 'the .opt-grid button.active rule is missing');
  assert.match(appRule[1], /border-color:var\(--cherry\)/, 'the app no longer lines a chosen option in cherry');
  assert.doesNotMatch(appRule[1], /background:var\(--cherry/, 'the app fills a chosen option cherry');
  assert.doesNotMatch(appRule[1], /gold/i, 'the app selection is drifting back to gold');
  const glow = (/box-shadow:([^;]*)/.exec(appRule[1]) || [, 'none'])[1].trim();
  assert.match(glow, /var\(--cherry-dim\)/, 'the chosen option is not wearing the product’s own cherry glow');
});

test('the weekday picker is a real checkbox circle, filled cherry, with no wash behind it', () => {
  assert.ok(/\.weekday-grid\{([^}]*)\}/.exec(APP_SRC), '.weekday-grid is gone');
  const checked = /\.wd-check input:checked\{([^}]*)\}|\.day-check input:checked, \.wd-check input:checked\{([^}]*)\}/.exec(APP_SRC);
  assert.ok(checked, '.wd-check input:checked rule missing');
  assert.match(checked[1] || checked[2], /var\(--cherry\)/);
  assert.doesNotMatch(APP_SRC, /\.wd-check\.checked\{[^}]*background/, 'no background/wash may sit behind the selected weekday column in the app');
});

test('the review screen and the progress rail keep the app\'s own classes', () => {
  ['.bld-review-hero', '.bld-review-row', '.bld-review-k', '.bld-review-v', '.bld-step.done', '.bld-step.now'].forEach((sel) => {
    assert.ok(new RegExp(sel.replace(/\./g, '\\.') + '\\{([^}]*)\\}').exec(APP_SRC), sel + ' is missing from the app');
  });
});

test('/start carries no second copy of the builder to drift from', () => {
  assert.doesNotMatch(START_SRC, /id="pane-build"/);
  assert.doesNotMatch(START_SRC, /\.bld-|\.opt-grid|\.weekday-grid|--cherry-fill/);
});
