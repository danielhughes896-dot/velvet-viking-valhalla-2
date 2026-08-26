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
  /^'JetBrains Mono',monospace$/
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
