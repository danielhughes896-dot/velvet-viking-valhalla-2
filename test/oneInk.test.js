'use strict';
/* ONE INK, AND A COACH PANEL IS A PAGE.
 *
 * Founder, asking for a sweep of "every first layer sister card and end user
 * touch point": "The grey text I'm not keen on. I think white text is best if
 * you agree. I know it says a different message but visually it's busy and
 * off putting? Space needs to do the talking."
 *
 * And then, on the panels the Coach page's circles open: "The dot ... should
 * follow the colour of the cards. Accept evolution ect should be the same as
 * build a program. There should be no raised black boxes. I actually think
 * the cards that open up should be full size? Then that creates ect space.
 * Because even on my big screen that's hard to read. ... No grey text. All
 * white. Scope of we make it full screen. The max the text sizes could be."
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RUNTIME_RELATIVE } = require('./harness.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ');
const SCOPE = ':is(.view-today .day.is-today, .view-week .wk-full .day, .view-plan-session .day, .view-week .wk-overview)';
/* every rule as [selector, body] */
const RULES = [];
CSS.replace(/([^{}]+)\{([^{}]*)\}/g, (m, sel, body) => { RULES.push([sel.trim(), body]); return m; });
const bodyOf = sel => {
  /* Matched on the END of the selector text: a rule that follows a stripped
     comment or sits in a group carries what came before it, and an exact
     match quietly found nothing. The character before must not be part of
     a longer selector. */
  const r = RULES.filter(x => x[0] === sel ||
    (x[0].endsWith(sel) && /[\s,}]/.test(x[0].charAt(x[0].length - sel.length - 1))));
  assert.ok(r.length, 'rule not found: ' + sel);
  return r.map(x => x[1]).join(';');
};

test('the two grey ink tiers resolve to the ink, everywhere they are defined', () => {
  const defs = CSS.match(/--ink-dim:[^;]+;\s*--ink-faint:[^;]+;/g) || [];
  /* :root, .modal-card, the themed modal (inherit) and the decision modal */
  assert.ok(defs.length >= 4, 'only ' + defs.length + ' definitions of the dim tiers were found');
  /* #FFFFFF is the Coach page and its panels, which the founder took to
     pure white before this sweep ("All white"); that is not a grey. */
  defs.forEach(d => assert.match(d, /^--ink-dim:(var\(--ink\)|inherit|#FFFFFF);\s*--ink-faint:(var\(--ink\)|inherit|#FFFFFF);$/,
    'a scope still gives the dim tiers a grey of their own: ' + d));
  assert.doesNotMatch(CSS, /--ink-(dim|faint):#(?!FFFFFF)/, 'a grey hex is back on a dim tier');
  /* the completion card's own pair, for the same instruction */
  assert.match(CSS, /--wc-dim:var\(--wc-ink\); --wc-faint:var\(--wc-ink\);/,
    'the completion card still dims its second and third tiers');
});

test('what keeps a grey is a mark, a placeholder or a control that is off, never copy', () => {
  assert.match(CSS, /--ink-quiet:#9D9787; --mark-faint:#9D9787; --mark-dim:#BBB4A4;/);
  /* a mark is drawn, not read: it is a background or the colour of an icon */
  RULES.forEach(([sel, body]) => {
    if (/var\(--mark-(faint|dim)\)/.test(body)) {
      const asText = /(^|;)\s*color:var\(--mark-(faint|dim)\)/.test(body);
      if (asText) assert.match(sel, /chev|icon-btn|arrow|svg/,
        sel + ' sets WORDS in the mark grey');
    }
    if (/var\(--ink-quiet\)/.test(body)) {
      assert.match(sel, /placeholder|\[disabled\]|is-muted|locked/,
        sel + ' uses the quiet ink on something that is neither a placeholder nor switched off');
    }
    /* and a dot is not painted through a text token any more */
    assert.doesNotMatch(body, /background:var\(--ink-(dim|faint)\)/, sel + ' paints a mark with a text tier');
  });
});

test('no first-layer line is dimmed by opacity or a translucent white instead', () => {
  [['.share-ov span', 'the share overlay names'], ['.share-k', 'the share composer labels'],
   ['.share-row > span', 'the share composer row labels'], ['.wk-day-d', 'the week strip’s day letters'],
   ['.build-tag', 'the build number'], ['.hq-panel .field-hint', 'a panel’s explaining line'],
   ['.hq-panel .rec-lede', 'a panel’s lede']].forEach(([sel, what]) => {
    assert.doesNotMatch(bodyOf(sel), /opacity:\s*\.\d/, what + ' is dimmed by opacity again (' + sel + ')');
  });
  assert.match(bodyOf('.view-planhq .b-dials-hint'), /opacity:1/, 'the hint under the circles is dimmed');
  [[SCOPE + ' .ws-rail .ws-note', 'a stage card’s note'],
   [SCOPE + ' .ws-rail .how-mod .fuel-v-note', 'a fuel card’s note'],
   ['.pp-slide.is-ahead .pp-slide-w', 'a phase still ahead']].forEach(([sel, what]) => {
    assert.match(bodyOf(sel), /color:#fff/, what + ' is a translucent white again');
  });
  assert.match(bodyOf(SCOPE + ' .ws-rail .pair-foot-k'), /color:#fff/, 'the fuel card’s small labels are dimmed');
  assert.match(bodyOf('.day-badge.type-rest'), /color:var\(--ink\)/, 'the Rest badge’s word is the rest grey again');
});

test('the two buttons stand clear of whatever is above them', () => {
  /* "I think there's scope to create space between the bottom of why this
     session and hear today and ask coach." */
  const m = /margin:(\d+)px 0 0/.exec(bodyOf(SCOPE + ' .voice-row'));
  assert.ok(m && +m[1] >= 26, 'Hear Today and Ask Coach sit ' + (m && m[1]) + 'px under the line above');
});

test('a Coach panel opens as a page, and a Settings panel does not', () => {
  assert.match(CODE, /var coachPanel = READING_KEYS\.indexOf\(key\) !== -1 \|\| !!RECORD_PANELS\[key\];/,
    'which panels are pages is no longer decided from the reading and record lists');
  assert.match(CODE, /\+\(coachPanel \? ' hq-full' : ''\)\)/, 'a Coach panel is not marked as a page');
  assert.match(bodyOf('.modal-overlay:has(> .hq-full)'), /align-items:stretch; padding:0/,
    'the overlay still pads and centres a page');
  const page = bodyOf('.modal-overlay:has(> .hq-full) > .hq-full');
  ['width:100%', 'height:100%', 'max-height:none', 'border:0', 'border-radius:0', 'box-shadow:none'].forEach(d =>
    assert.ok(page.indexOf(d) > -1, 'the page lost ' + d + ', so it is a card with an edge again'));
});

test('the page’s type is a step up from the card’s, set once through the tokens', () => {
  const page = bodyOf('.modal-overlay:has(> .hq-full) > .hq-full');
  const rem = name => { const m = new RegExp(name + ':([\\d.]+)rem').exec(page); assert.ok(m, name + ' is not set on the page'); return +m[1] * 16; };
  const root = name => +new RegExp(name + ':([\\d.]+)rem').exec(CSS)[1] * 16;
  [['--fs-label', 14], ['--fs-support', 17], ['--fs-panel-row', 19], ['--fs-body', 20]].forEach(([t, want]) => {
    assert.ok(rem(t) > root(t), t + ' is no larger on the page than in the app');
    assert.equal(rem(t), want, t + ' moved off the measured size');
  });
  /* the row is the ceiling: label and value share a line, and wrap whole */
  assert.match(bodyOf('.hq-full .hq-row'), /flex-wrap:wrap/, 'a long row breaks mid-value instead of dropping it whole');
  assert.match(bodyOf('.hq-full .modal-head h2'), /min-width:0/, 'a long title can run into the close ring');
});

test('no box inside the page, the builder’s buttons, and the dot in the panel’s colour', () => {
  const evo = bodyOf('.hq-full .evo-panel');
  assert.ok(/background:none/.test(evo) && /border:0/.test(evo) && /padding:0/.test(evo),
    'the proposal is a raised box again');
  assert.equal(CSS.indexOf('.hq-panel .btn-primary{'), -1, 'a panel paints its own primary instead of the builder’s');
  assert.match(bodyOf('.builder-light .btn-primary'), /background:var\(--cherry-fill\)/);
  assert.match(bodyOf('.hq-panel .read-val .read-dot'), /background:var\(--rp-accent\)/,
    'the status dot wears the reading’s tone rather than the panel’s colour');
});
