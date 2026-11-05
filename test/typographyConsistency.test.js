'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/* TYPOGRAPHY CONSISTENCY
 * ===========================================================================
 * Valhalla has exactly four typographic roles, each with one canonical
 * font-family declaration (see protected/velvet-viking-valhalla.html's own
 * `body`/.font-display/.font-head/.font-mono rules, and the equivalent hand
 * -maintained declarations in assets/vvv-shell.css and the standalone
 * customer-journey pages that do not load it):
 *
 *   brand/display   'Cinzel',serif
 *   condensed/label 'Oswald',sans-serif
 *   primary UI      'Inter',sans-serif (+ the root's fuller -apple-system fallback)
 *   numeric/data    'JetBrains Mono',monospace
 *
 * This file protects the SET of strings a font-family declaration is allowed
 * to be, repo-wide across every athlete-facing surface -- not every element's
 * size or weight, which are free to differ for hierarchy. A new declaration
 * that reads 'Georgia' or bare 'sans-serif' fails immediately, loudly, at the
 * exact file and line, rather than drifting in unnoticed. It also protects
 * the specific rules this pass found using NO family at all despite carrying
 * a label's visual signature (uppercase + letter-spacing) -- those rules are
 * pinned to the family they were found missing. */

const ROOT = path.join(__dirname, '..');

const CANONICAL = [
  /^inherit$/,
  /^'Cinzel',serif$/,
  /^'Oswald',sans-serif$/,
  /^'Inter',sans-serif$/,
  /^'Inter',-apple-system,sans-serif$/,
  /^'Inter',-apple-system,BlinkMacSystemFont,sans-serif$/,
  /^'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif$/,
  /^'JetBrains Mono',monospace$/,
  // The one-label-voice token. It is only allowed here because the test
  // below pins what it resolves to -- if --label-face is ever set to a
  // family outside the four roles, that test fails, so this entry cannot
  // become a hole in the guard.
  /^var\(--label-face\)$/
];

// Extracts every `font-family: ...;` declaration's VALUE (normalised: no
// internal whitespace) from every <style> block in a file, plus its 1-indexed
// line number, so a failure can point straight at the offending rule.
function extractFromCss(css, src, offsetInSrc){
  const out = [];
  const re = /font-family\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(css))){
    // Collapse whitespace AROUND commas only -- "JetBrains Mono" and
    // "Segoe UI" carry a real space inside their own name that must survive.
    const value = m[1].trim().replace(/\s*,\s*/g, ',');
    const absoluteIndex = offsetInSrc + m.index;
    const line = src.slice(0, absoluteIndex).split('\n').length;
    out.push({ value, line });
  }
  return out;
}
function extractFontFamilyDeclarations(filePath){
  const src = fs.readFileSync(filePath, 'utf8');
  // A standalone .css file has no <style> wrapper -- the whole file is CSS.
  if (filePath.endsWith('.css')) return extractFromCss(src, src, 0);
  const styleBlocks = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)];
  let out = [];
  for (const block of styleBlocks){
    const cssStart = block.index + block[0].indexOf(block[1]);
    out = out.concat(extractFromCss(block[1], src, cssStart));
  }
  return out;
}

function assertOnlyCanonicalFamilies(filePath){
  const decls = extractFontFamilyDeclarations(filePath);
  assert.ok(decls.length > 0, filePath + ': expected to find font-family declarations to check');
  const rogue = decls.filter(d => !CANONICAL.some(re => re.test(d.value)));
  assert.deepEqual(rogue.map(d => d.line + ': ' + d.value), [],
    filePath + ' has font-family value(s) outside the four canonical roles');
}

test('the --label-face token resolves to one of the four canonical roles', () => {
  // font-family:var(--label-face) is accepted above as a canonical value.
  // That acceptance is only safe while the token itself is canonical, so
  // the token's own declared value is checked against the same list here.
  const css = appCss();
  const m = css.match(/--label-face\s*:\s*([^;]+);/);
  assert.ok(m, '--label-face is not declared -- the applied label block would resolve to nothing');
  const value = m[1].trim().replace(/\s*,\s*/g, ',');
  assert.ok(CANONICAL.some(re => re.test(value)),
    '--label-face is ' + value + ', which is outside the four canonical typographic roles');
});

test('the one label voice is the label Today actually renders, not the base rule under it', () => {
  // The standard was taken from the WHY/EXECUTION/FEEL/WATCH FOR label as
  // it renders on Today's card -- which is a FOCUSED session, so the
  // :is(.view-today .day.is-today, ...) .how-row .k override is what shows.
  // Pinning both ends here means a future edit to either the override or
  // the tokens cannot silently put the product's standard back onto a
  // label that appears on no screen.
  const css = appCss();
  const tok = sel => {
    const m = css.match(new RegExp('--label-' + sel + '\\s*:\\s*([^;]+);'));
    return m ? m[1].trim() : null;
  };
  // .71875rem is 11.5px at the 16px root -- the scale moved to rem so an
  // athlete's text-size setting reaches it, and the measured value is
  // unchanged.
  assert.equal(tok('size'), '.71875rem');
  assert.equal(tok('weight'), '700');
  assert.equal(tok('track'), '.04em');
  // And the rule the standard was measured OFF no longer re-states it in
  // px. It cannot: a px copy here would hold this one label out of the rem
  // scale while every other label followed it. The override keeps only the
  // layout and the gold ink it actually exists for.
  const override = css.match(/:is\(\.view-today \.day\.is-today[^)]*\) \.how-row \.k\{([^}]*)\}/);
  assert.ok(override, "Today's focused .how-row .k override not found");
  assert.doesNotMatch(override[1], /font-size/, 'the focused label is pinned out of the rem scale again');
  assert.doesNotMatch(override[1], /letter-spacing/);
  assert.match(override[1], /color:var\(--gold-text\)/, 'the gold ink the override is for was lost');
});

test('the whole type scale is in rem, so a reader\'s text-size setting reaches it', () => {
  // Every one of these was a fixed px, which meant the app ignored a
  // setting it was told about. Each rem value is the old px over 16 exactly,
  // so default rendering is unchanged.
  const css = appCss();
  const EXPECTED = {
    'fs-meta': ['.6875rem', 11], 'fs-label': ['.6875rem', 11],
    'fs-support': ['.84375rem', 13.5], 'fs-data': ['.9375rem', 15],
    'fs-body': ['1rem', 16], 'fs-title': ['1.25rem', 20],
    'label-size': ['.71875rem', 11.5]
  };
  Object.keys(EXPECTED).forEach(name => {
    const m = css.match(new RegExp('--' + name + '\\s*:\\s*([^;]+);'));
    assert.ok(m, '--' + name + ' is not declared');
    const value = m[1].trim();
    assert.equal(value, EXPECTED[name][0], '--' + name + ' left the rem scale');
    // and the arithmetic: the rem value must still be the px it replaced.
    assert.equal(parseFloat(value) * 16, EXPECTED[name][1],
      '--' + name + ' no longer resolves to its original ' + EXPECTED[name][1] + 'px at a 16px root');
  });
});

test('a line of prose takes one of the two tiers -- no rule hand-sets its own', () => {
  // 47 rules used to set a sentence, between them in 29 different
  // size-and-leading combinations, ten sizes from 9.5px to 14px. The pass
  // that fixed it did not merely override them from the end of the sheet:
  // it DELETED the size and leading at each rule, so there is one
  // declaration per tier rather than 47 losers and 2 winners. This guard is
  // what keeps that true -- a rule that sets both a px size and a leading
  // loose enough to wrap is a sentence, and a sentence belongs to a tier.
  const css = appCss();
  const offenders = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  while ((m = re.exec(stripped))){
    const sel = m[1].replace(/\s+/g, ' ').trim(), body = m[2];
    if (/uppercase/.test(body)) continue;               // a label, not a sentence
    const size = body.match(/font-size:\s*([\d.]+)px/);
    const lead = body.match(/line-height:\s*([\d.]+)\s*;/);
    if (!size || !lead) continue;
    if (parseFloat(lead[1]) < 1.3) continue;            // set solid: a figure, not prose
    offenders.push(sel.slice(0, 60) + ' (' + size[1] + 'px/' + lead[1] + ')');
  }
  // The workout ladder's quantities are the one survivor: they are numbers
  // in a structure diagram, sized by the row they sit in, not sentences.
  const allowed = /ws-k-ladder/;
  assert.deepEqual(offenders.filter(o => !allowed.test(o)), [],
    'these rules hand-set a sentence instead of taking --fs-body or --fs-support');
});

test('both prose tiers exist, are token-only, and split instruction from support', () => {
  // Comments are stripped first, and the LAST occurrence is taken: each of
  // these selectors still has its own earlier rule in the sheet (stripped of
  // its size, keeping its colour and margins), and the tier group is the one
  // at the end that actually carries the declaration.
  const css = appCss().replace(/\/\*[\s\S]*?\*\//g, '');
  const group = tail => {
    const i = css.lastIndexOf(tail + '{');
    assert.ok(i > -1, 'tier group ending ' + tail + ' not found');
    const open = css.lastIndexOf('}', i) + 1;
    return { sel: css.slice(open, i + tail.length), body: css.slice(i + tail.length + 1, css.indexOf('}', i)) };
  };
  const instruction = group('.ci-body .ci-para');
  const support = group('.ws-h-presc');
  assert.match(instruction.body, /font-size:var\(--fs-body\); line-height:var\(--lh-body\);/);
  assert.match(support.body, /font-size:var\(--fs-support\); line-height:var\(--lh-support\);/);
  // The line under Today's label is the instruction tier -- that is the
  // whole premise of the pass, and it is what the athlete reads.
  assert.ok(/(^|,)\s*\.how-row \.v\s*,/.test(instruction.sel),
    "the how-card's sentence is no longer on the instruction tier");
  // ...and a row's subtitle is NOT, or the description would be as loud as
  // the thing it describes.
  assert.ok(/\.stg-row-sub\s*,/.test(support.sel),
    'a row subtitle drifted onto the instruction tier');
  assert.ok(!/\.stg-row-sub\s*,/.test(instruction.sel));
  assert.ok(!/(^|,)\s*\.how-row \.v\s*,/.test(support.sel));
});

test('Today no longer overrides the sentence size it was the standard for', () => {
  // The focused card used to set .how-row .v to 13.5px/1.35. That was the
  // size the whole product was about to be standardised on, measured off
  // this very rule -- and it is gone, removed at the rule rather than
  // beaten from the end of the sheet, so the card takes the one tier.
  const css = appCss();
  const m = css.match(/:is\(\.view-today \.day\.is-today[^)]*\) \.how-row \.v\{([^}]*)\}/);
  assert.ok(m, "Today's focused .how-row .v rule not found");
  assert.doesNotMatch(m[1], /font-size/, 'the focused card hand-sets the sentence size again');
  assert.doesNotMatch(m[1], /line-height/, 'the focused card hand-sets the sentence leading again');
  assert.match(m[1], /color:var\(--ink\)/, 'the brighter ink the override is actually for was lost');
});

test('a number the athlete acts on outranks the prose around it', () => {
  // These four were each set BELOW the body text beside them: the pace of
  // the run just finished at 13.5px, a week's volume at 14px, its
  // completion at 12.5px, a strategy phase's distance band at 13.5px. A
  // runner hunts for the number, not the sentence, so a metric sits on the
  // data tier (--fs-data) or above -- never under the prose it belongs to.
  const css = appCss();
  const rule = sel => {
    const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}'));
    assert.ok(m, sel + ' rule not found');
    return m[1];
  };
  ['.wc-metric', '.strat-phase-span', '.view-plan .pp-body .week-vol .v',
   '.view-plan .pp-body .week-pct', '.week-pct'].forEach(sel => {
    assert.match(rule(sel), /font-size:var\(--fs-data\)/,
      sel + ' is a metric set off the data tier again');
  });
  // --fs-data must stay at or above the support tier, or the rule above
  // would be satisfied by a token that had itself shrunk below the prose.
  const val = n => parseFloat(css.match(new RegExp('--fs-' + n + '\\s*:\\s*([\\d.]+)rem'))[1]);
  assert.ok(val('data') > val('support'),
    'the data tier fell to or below the support tier -- metrics now read quieter than hints');
});

test('the blueprint\'s pace band is no longer shrunk to fit its cell', () => {
  // This rule used to carry a font-size -- 9px, then a re-measured 10px --
  // so that 12 monospace characters would fit a 79px step cell. It made the
  // single number a runner hunts for, mid-session and outdoors, smaller than
  // its own labels. It was a layout problem wearing a type problem's clothes
  // and it is fixed as one: with no size of its own the band takes
  // --fs-support from the tier block, exactly as "Easy" in the cell beside
  // it always has.
  const css = appCss();
  const m = css.match(/\.ws-h-presc\.font-mono\{([^}]*)\}/);
  assert.ok(!m || !/font-size/.test(m[1]),
    'the pace band is being shrunk to fit its cell again');
  // The nowrap moved INWARD. On the span it stopped the unit falling to a
  // second line, which is what forced the shrink. On the range it stops a
  // line turning at the en-dash and stranding "5:17-", which is the one
  // break that would be worse than small type.
  const inner = css.match(/\.ws-h-presc\.font-mono b\{([^}]*)\}/);
  assert.ok(inner, '.ws-h-presc.font-mono b rule not found');
  assert.match(inner[1], /white-space:nowrap/, 'the pace range can break mid-range again');
  assert.match(inner[1], /font-weight:inherit/, 'the <b> is bolding the band');
});

test('the pace band gets exactly one break opportunity, before the unit', () => {
  const src = fs.readFileSync(path.join(ROOT, 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const fn = /function paceBandHtml\(pace\)\{[\s\S]*?\n\}/.exec(src);
  assert.ok(fn, 'paceBandHtml is gone -- the band is being emitted raw again');
  // <wbr> is load-bearing and not decoration: UAX #14 permits a line to turn
  // AFTER a solidus, not before one, so "5:17-6:16/km" left to itself breaks
  // as "5:17-6:16/" + "km" or, in a cell too narrow for that, not at all.
  // An element boundary is not a break opportunity either.
  assert.match(fn[0], /<\/b><wbr>/,
    'the explicit break opportunity is gone -- the band will not wrap where it should');
  assert.match(fn[0], /lastIndexOf\('\/'\)/,
    'the split is no longer at the last solidus, so a unit could end up inside the range');
  // Both emitters go through it, or one of them silently keeps the old markup.
  assert.doesNotMatch(src, /<span class="ws-h-presc font-mono">'\+escapeHtml/,
    'a pace band is still being emitted without the break opportunity');
});

test('the runtime app declares only the four canonical typographic roles', () => {
  assertOnlyCanonicalFamilies(path.join(ROOT, 'protected', 'velvet-viking-valhalla.html'));
});

test('the shared customer-journey shell (vvv-shell.css) declares only the canonical roles', () => {
  assertOnlyCanonicalFamilies(path.join(ROOT, 'assets', 'vvv-shell.css'));
});

['start.html', 'get.html', 'privacy.html', 'terms.html'].forEach(page => {
  test('the ' + page + ' entry surface declares only the canonical roles', () => {
    assertOnlyCanonicalFamilies(path.join(ROOT, page));
  });
});

// ---------------------------------------------------------------------------
// THE SPECIFIC GAPS THIS PASS CLOSED -- pinned so they cannot silently drift
// back to inheriting the body's Inter default under a label's visual
// treatment (uppercase + letter-spacing) again.
// ---------------------------------------------------------------------------
function ruleBody(css, selector){
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = css.match(re);
  return m ? m[1] : null;
}
function appCss(){
  const src = fs.readFileSync(path.join(ROOT, 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  return src.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
}

test('every label-styled rule found without a font-family now declares Oswald', () => {
  const css = appCss();
  ['.exec-review-head', '.pzr-tag', '.note-chips-head', '.divider-or'].forEach(sel => {
    const body = ruleBody(css, sel);
    assert.ok(body, sel + ' rule not found');
    assert.match(body, /font-family:'Oswald',sans-serif/, sel + ' should declare the condensed-label font');
  });
});

test('.stat .l and .readiness-label are styled as labels in markup (font-head), not left on the inherited body font', () => {
  const src = fs.readFileSync(path.join(ROOT, 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  assert.match(src, /class="l font-head">Goal /);
  assert.match(src, /class="l font-head">Runs Done</);
  assert.match(src, /class="readiness-label font-head"/);
});

test('start.html\'s plan-preview big figures use the numeric role (JetBrains Mono), not the brand-display serif', () => {
  const src = fs.readFileSync(path.join(ROOT, 'start.html'), 'utf8');
  const body = ruleBody(src.match(/<style[^>]*>([\s\S]*?)<\/style>/g).join('\n'), '.big b');
  assert.ok(body);
  assert.match(body, /font-family:'JetBrains Mono',monospace/);
});

test('no font-family declaration anywhere resolves to a name outside the four canonical roles', () => {
  // The stronger, precise version of a "no rogue font" check: scanning raw
  // CSS text for names like "Times" or "Arial" also matches ordinary English
  // prose in comments ("...reads the same two phrases three times..."), so
  // this asserts against the VALUES actually parsed out of font-family
  // declarations (the same extraction the canonical-role tests above use),
  // not the file text.
  ['protected/velvet-viking-valhalla.html', 'assets/vvv-shell.css', 'start.html', 'get.html', 'privacy.html', 'terms.html']
    .forEach(rel => {
      const decls = extractFontFamilyDeclarations(path.join(ROOT, rel));
      const rogue = decls.filter(d => !CANONICAL.some(re => re.test(d.value)));
      assert.deepEqual(rogue.map(d => d.line + ': ' + d.value), [],
        rel + ' has a font-family value outside the four canonical roles');
    });
});
