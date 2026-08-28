'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RUNTIME_RELATIVE } = require('./harness.js');

/* THE RECORD'S LIST-ROW SHELL IS GONE, AND MUST NOT COME BACK HALF-WAY
 * ===========================================================================
 * The Record used to be rows: subject on the left, value on the right, built
 * from .plan-summary-bar's shell --
 *
 *   .rec-card  .rec-top  .rec-subject  .rec-right  .rec-val  .rec-syn
 *
 * Record cards became .ev-card buttons -- headline value, then subject, then a
 * synopsis in .rs-syn -- and nothing emitted any of those classes afterwards.
 * The rules stayed anyway, describing a component the product no longer had.
 * That is worse than nothing: the next person to change how a Record card
 * looks would have edited them and watched nothing happen.
 *
 * The general guard below is the one that matters. It is not about these six
 * names -- it is about the .rec-* namespace never again carrying a rule for
 * something the app cannot render.
 */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');

/* The runtime is one file: a <style> block, then markup and script. Splitting
   them is what lets "is this selector styled" and "is this class emitted" be
   two different questions -- and comments are stripped from both, because a
   comment naming a class is documentation, not a rule and not an emission.
   This file's own prose names every class it forbids. */
const STYLE_OPEN = SRC.indexOf('<style>');
const STYLE_CLOSE = SRC.indexOf('</style>');
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = decomment(SRC.slice(STYLE_OPEN, STYLE_CLOSE));
const REST = decomment(SRC.slice(0, STYLE_OPEN) + SRC.slice(STYLE_CLOSE))
  .replace(/^\s*\/\/.*$/gm, '');

const REMOVED = ['rec-card', 'rec-top', 'rec-subject', 'rec-right', 'rec-val', 'rec-syn'];

test('one <style> block, so the CSS/markup split above is real', () => {
  assert.ok(STYLE_OPEN > -1 && STYLE_CLOSE > STYLE_OPEN, 'the style block moved');
  assert.equal(SRC.split('<style>').length - 1, 1,
    'a second <style> block appeared -- this file only reads the first');
});

test('the dead list-row shell has no rules left', () => {
  REMOVED.forEach(cls => {
    assert.ok(!new RegExp('\\.' + cls + '\\b').test(CSS),
      '.' + cls + ' is styled again, and nothing renders it');
  });
});

test('and nothing emits it either -- which is why the rules went', () => {
  REMOVED.forEach(cls => {
    assert.ok(REST.indexOf(cls) === -1,
      cls + ' is emitted again, and now has no styling at all -- ' +
      'if the shell is coming back, its CSS has to come back with it');
  });
});

test('every .rec-* class the stylesheet styles is one the app can render', () => {
  /* THE GENERAL RULE, and the only one of these tests worth keeping in five
     years. A .rec-* selector with no producer is a rule that cannot paint --
     it is either a component that was deleted, or one that was renamed and
     left a stub behind, and both mislead the next reader in the same way. */
  const styled = [...new Set((CSS.match(/\.rec-[a-z-]+/g) || []).map(s => s.slice(1)))];
  assert.ok(styled.length >= 6, 'the .rec-* namespace vanished entirely -- check this test');
  const orphans = styled.filter(cls => REST.indexOf(cls) === -1);
  assert.equal(orphans.join(', '), '',
    'these .rec-* rules style something the app never renders: ' + orphans.join(', '));
});

test('the surviving Record classes are all still styled and still rendered', () => {
  /* The other direction: the deletion must not have taken a live class with
     it. These are the ones the Record actually uses today. */
  ['rec-lede', 'rec-headline', 'rec-context', 'rec-empty', 'rec-empty-subject',
   'rec-empty-state', 'rec-none', 'rec-panel-nav'].forEach(cls => {
    assert.ok(new RegExp('\\.' + cls + '\\b').test(CSS), '.' + cls + ' lost its styling');
    assert.ok(REST.indexOf(cls) > -1, '.' + cls + ' is no longer rendered');
  });
});

test('the fact-not-verdict law survived the deletion', () => {
  /* The rules went; the reason they existed did not. A Record value states a
     fact and never carries a status hue; .read-val is the surface allowed to
     carry tone. That distinction was written into the block that was deleted,
     so it had to be rehomed rather than deleted with it. */
  const record = /---------- THE RECORD ----------[\s\S]*?\*\//.exec(SRC);
  assert.ok(record, 'THE RECORD section comment is gone');
  assert.match(record[0], /VALUE, NOT A VERDICT/,
    'the fact-not-verdict law was deleted along with the shell it happened to be written above');
  assert.match(record[0], /\.read-val/,
    'the law no longer names the surface it draws the contrast against');
  /* And the Reading half of the contrast must still point at something real.
     It used to point at .rec-val, which no longer exists. */
  const reading = /---------- THE READING ----------[\s\S]*?\*\//.exec(SRC);
  assert.ok(reading, 'THE READING section comment is gone');
  assert.ok(!/\.rec-val\b/.test(reading[0]),
    'THE READING still explains itself by contrast with .rec-val, which no longer exists');
});

test('no Record value carries a status hue', () => {
  /* THE LAW, ASSERTED RATHER THAN ONLY WRITTEN DOWN. A Record value states a
     fact; .read-val is the surface allowed to carry the coaching engine's tone.
     Before this, the law was enforced only on .rec-val -- a class nothing had
     rendered for some time -- so in practice nothing enforced it at all.
     The status tokens are the ones .read-val itself uses for good/watch/bad. */
  const STATUS = ['--c-easy', '--c-tempo', '--c-threshold', '--c-interval',
                  '--gold\\b', '--c-rest'];
  ['\\.b-plate \\.val', '\\.rec-headline b', '\\.rec-empty-state'].forEach(sel => {
    const rules = CSS.match(new RegExp(sel + '(?:\\.[a-z-]+)?\\{[^}]*\\}', 'g')) || [];
    assert.ok(rules.length, sel + ' has no rule at all');
    rules.forEach(r => {
      STATUS.forEach(tok => {
        assert.ok(!new RegExp('color\\s*:\\s*var\\(' + tok).test(r),
          sel + ' paints a Record value with a status hue: ' + r.trim());
      });
    });
  });
  /* And the surface that IS allowed to carry tone still does, or the contrast
     this law depends on has quietly gone. */
  assert.match(CSS, /\.read-val\.good\{color:var\(--c-easy\)/,
    '.read-val no longer carries the engine\'s tone, so the contrast is gone');
});
