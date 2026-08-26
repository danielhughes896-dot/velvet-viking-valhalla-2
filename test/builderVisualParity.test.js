'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// THE BUILDER'S VISUAL LANGUAGE -- ONE, NOT TWO.
//
// The canonical builder spec (assets/builder-spec.js) proves both surfaces
// ask the same nine questions, in the same order, with the same rules. This
// file proves they LOOK like the same product doing it: the same Cherry
// Lacquer accent for forward motion and progress, the same gold selection
// state, the same option-grid/weekday-checkbox/review-row treatment.
//
// /start cannot literally share a stylesheet with the protected runtime --
// the delivery gate keeps that file server-side only, and the app's CSS is
// inline in a document /start must never receive -- so this is a byte-level
// comparison of the values themselves, read out of each file's own source,
// rather than one file requiring the other. A value changed on one side
// without the other fails here.

const ROOT = path.join(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'protected', 'velvet-viking-valhalla.html'), 'utf8');
const START_SRC = fs.readFileSync(path.join(ROOT, 'start.html'), 'utf8');

// Pull `--token:value;` out of a specific `selector{...}` block's raw text.
function tokenValue(src, selectorBlockRe, token) {
  const m = selectorBlockRe.exec(src);
  if (!m) return undefined;
  const body = m[1];
  const re = new RegExp('--' + token + ':\\s*([^;]+);');
  const tm = re.exec(body);
  return tm ? tm[1].trim() : undefined;
}

// The app's :root is one big block; [data-theme="light"] is a second block
// later in the same stylesheet. Match the FIRST occurrence of each in both
// files -- start.html's own additions use the identical two-block shape.
function rootBlock(src) {
  const i = src.indexOf(':root{');
  return new RegExp(':root\\{([\\s\\S]*?)\\n  \\}').exec(src.slice(i));
}
function lightBlock(src) {
  const i = src.search(/\[data-theme="light"\]\{|:root\[data-theme="light"\]\{/);
  return new RegExp('\\[data-theme="light"\\][^{]*\\{([\\s\\S]*?)\\n  \\}').exec(src.slice(i));
}

const CHERRY_TOKENS = ['cherry', 'cherry-fill', 'cherry-soft', 'cherry-line', 'cherry-dim', 'cherry-text', 'cherry-ink', 'cherry-btn-ink'];
const OTHER_TOKENS = ['fs-meta', 'fs-label', 'fs-support', 'fs-data', 'fs-body', 'fs-title', 'lh-body', 'lh-support', 'line-soft', 'danger-text', 'c-gold-soft'];

test('every Cherry Lacquer token is the same value in the app and in /start, in both themes', () => {
  const appDark = rootBlock(APP_SRC);
  const startDark = rootBlock(START_SRC);
  const appLight = lightBlock(APP_SRC);
  const startLight = lightBlock(START_SRC);
  assert.ok(appDark && startDark && appLight && startLight, 'could not locate one of the four token blocks');

  CHERRY_TOKENS.concat(OTHER_TOKENS).forEach((tok) => {
    const dApp = tokenValue(APP_SRC, /:root\{([\s\S]*?)\n  \}/, tok);
    const dStart = tokenValue(START_SRC, /:root\{([\s\S]*?)\n  \}/, tok);
    assert.ok(dApp, '--' + tok + ' is not defined in the app\'s dark :root');
    assert.equal(dStart, dApp, '--' + tok + ' (dark) diverged: app=' + dApp + ' /start=' + dStart);
  });

  // Light-theme overrides -- only the tokens each side actually re-declares
  // for light (most Cherry Lacquer values are identical in both themes and
  // are not re-declared; see the app's own "nothing there needed solving"
  // comment on --cherry in light).
  CHERRY_TOKENS.concat(OTHER_TOKENS).forEach((tok) => {
    const lApp = tokenValue(APP_SRC, /\[data-theme="light"\]\{([\s\S]*?)\n  \}/, tok);
    if (lApp === undefined) return; // not re-declared for light on the app's side either
    const lStart = tokenValue(START_SRC, /\[data-theme="light"\]\{([\s\S]*?)\n  \}/, tok);
    assert.equal(lStart, lApp, '--' + tok + ' (light) diverged: app=' + lApp + ' /start=' + lStart);
  });
});

test('the app\'s primary builder action is Cherry Lacquer, scoped to .builder-light, and /start reads the identical rule', () => {
  const appRule = /\.builder-light \.btn-primary\{([^}]*)\}/.exec(APP_SRC);
  const startRule = /\.builder-light \.btn-primary\{([^}]*)\}/.exec(START_SRC);
  assert.ok(appRule, 'the app no longer scopes Cherry Lacquer to .builder-light .btn-primary');
  assert.ok(startRule, '/start no longer scopes Cherry Lacquer to .builder-light .btn-primary');
  assert.match(appRule[1], /var\(--cherry-fill\)/);
  assert.match(startRule[1], /var\(--cherry-fill\)/);
  // /start's #pane-build actually carries the .builder-light class its CSS
  // rule depends on -- a matching rule with nothing to scope it is inert.
  assert.match(START_SRC, /id="pane-build" class="vvv-hidden builder-light"/,
    '/start\'s builder container no longer carries .builder-light');
});

test('the selected-choice state is gold (--modal-active), not Cherry Lacquer, on both surfaces', () => {
  const appRule = /\.opt-grid button\.active\{([^}]*)\}/.exec(APP_SRC);
  const startRule = /\.opt-grid button\.active\{([^}]*)\}/.exec(START_SRC);
  assert.ok(appRule && startRule, 'the .opt-grid button.active rule is missing on one surface');
  assert.match(appRule[1], /var\(--modal-active\)/);
  assert.match(startRule[1], /var\(--modal-active\)/);
  assert.doesNotMatch(appRule[1], /cherry/i, 'the app now colours a selection cherry, not gold -- this test is stale');
  assert.doesNotMatch(startRule[1], /cherry/i, '/start colours a selection cherry -- selection state must stay gold');
});

test('the weekday picker is the same real-checkbox control, same fill, on both surfaces', () => {
  const appGrid = /\.weekday-grid\{([^}]*)\}/.exec(APP_SRC);
  const startGrid = /\.weekday-grid\{([^}]*)\}/.exec(START_SRC);
  assert.ok(appGrid && startGrid);
  assert.equal(startGrid[1].trim(), appGrid[1].trim(), '.weekday-grid diverged');

  // TRAINING-DAY SELECTOR VISUAL REFINEMENT, corrected: the checkbox itself
  // is styled as a circle (reusing the app's own day-card completion ring,
  // .day-check input) and filled --cherry on checked -- not a gold wash
  // behind the whole label. Both surfaces must agree on that fill, and
  // neither may declare a background on the bare .wd-check.checked label.
  const appCheckedInput = /\.wd-check input:checked\{([^}]*)\}|\.day-check input:checked, \.wd-check input:checked\{([^}]*)\}/.exec(APP_SRC);
  const startCheckedInput = /\.wd-check input:checked\{([^}]*)\}/.exec(START_SRC);
  assert.ok(appCheckedInput && startCheckedInput, '.wd-check input:checked rule missing on one surface');
  const appCheckedBody = appCheckedInput[1] || appCheckedInput[2];
  assert.match(appCheckedBody, /var\(--cherry\)/);
  assert.match(startCheckedInput[1], /var\(--cherry\)/);
  assert.doesNotMatch(APP_SRC, /\.wd-check\.checked\{[^}]*background/, 'no background/wash may sit behind the selected weekday column in the app');
  assert.doesNotMatch(START_SRC, /\.wd-check\.checked\{[^}]*background/, 'no background/wash may sit behind the selected weekday column in /start');

  // /start renders real <input type="checkbox"> inside .wd-check labels --
  // the same control the app uses, not a button standing in for one.
  const wk = START_SRC.slice(START_SRC.indexOf('function renderWeekdayGrid'));
  assert.match(wk.slice(0, wk.indexOf('\n  }\n')), /type = 'checkbox'/);
});

test('the review screen uses the app\'s own hero/row classes, with no extra card wrapper invented around them', () => {
  ['.bld-review-hero', '.bld-review-row', '.bld-review-k', '.bld-review-v'].forEach((cls) => {
    const escaped = cls.replace('.', '\\.');
    const appRule = new RegExp(escaped.replace(/^\\\./, '\\.') + '\\{([^}]*)\\}').exec(APP_SRC);
    const startRule = new RegExp(escaped.replace(/^\\\./, '\\.') + '\\{([^}]*)\\}').exec(START_SRC);
    assert.ok(appRule, cls + ' is missing from the app');
    assert.ok(startRule, cls + ' is missing from /start');
  });
  // No third presentation: /start's review no longer wraps its rows in a
  // bordered .card, the way the old condensed preview screen's summary did.
  const review = START_SRC.slice(START_SRC.indexOf('function renderReviewStage'));
  const body = review.slice(0, review.indexOf('\n  }\n'));
  assert.doesNotMatch(body, /class="card"/, 'the review stage still wraps itself in the page\'s own .card, not the builder\'s hero/row treatment');
});

test('the progress rail is Cherry Lacquer on both surfaces, with the same done/now states', () => {
  ['.bld-step.done', '.bld-step.now'].forEach((sel) => {
    const escaped = sel.replace(/\./g, '\\.');
    const appRule = new RegExp(escaped + '\\{([^}]*)\\}').exec(APP_SRC);
    const startRule = new RegExp(escaped + '\\{([^}]*)\\}').exec(START_SRC);
    assert.ok(appRule, sel + ' is missing from the app');
    assert.ok(startRule, sel + ' is missing from /start');
    assert.equal(startRule[1].trim(), appRule[1].trim(), sel + ' diverged');
  });
});
