'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/* ============================================================
   A CHOICE IN THE BUILD IS DRAWN AS A BOX, ON BOTH SURFACES
   ============================================================

   The builder exists twice -- inside the app, and as the public /start
   funnel -- from two copies of the same CSS. /start kept drawing each
   option as a rimmed tile; the in-app copy drifted to bare words on a gold
   pool, so the same question looked like two different products depending
   on how the athlete reached it. These laws hold the two together and hold
   the box in place.

   WHAT IS NOT HERE, AND WHY. The thing that actually broke is a pixel fit:
   a label wider than its grid cell. `1fr` is `minmax(auto,1fr)`, so an
   unbreakable word does not shrink or wrap -- the TRACK grows, and the grid
   bursts the card it sits in. ESTABLISHED is 103px of mono and never had
   more than 93px, so the third experience option hung off the edge of the
   modal at every phone width. Measuring that needs a real viewport, which
   this suite does not have; the measurements live in the CSS comments
   beside the rules they justify. What IS checkable in text is the shape
   that made the fit possible, and that is what these laws pin. */

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'protected', 'velvet-viking-valhalla.html'), 'utf8');
const START = fs.readFileSync(path.join(ROOT, 'start.html'), 'utf8');
const SURFACES = [['app', APP], ['/start', START]];

/* Read a rule body by selector. Two traps, both of which this codebase has
   shipped before and the second of which this file hit while being written:
     1. A later rule with the SAME selector wins the cascade, so a helper
        that returns the first match asserts on the dead one. Hence every
        match is collected and the last is used.
     2. A selector is a SUBSTRING of more specific ones. `.opt-grid button`
        appears inside `.bld-secondary .opt-grid button` and
        `.field.invalid .opt-grid button`, and an unanchored search happily
        returned one of those -- a two-declaration override -- as if it were
        the base rule. So the match must begin a line: nothing but
        whitespace may precede it. */
function bodies(src, selector) {
  const out = [];
  const re = new RegExp('(?:^|\\n)[ \\t]*' +
    selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g');
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}
function winning(src, selector) {
  const all = bodies(src, selector);
  return all.length ? all[all.length - 1] : null;
}
function decl(body, prop) {
  if (body == null) return null;
  const m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:([^;]*)').exec(body);
  return m ? m[1].trim() : null;
}

test('every cols-N written on an option grid is declared in that surface CSS', () => {
  /* THE LAW THAT WOULD HAVE CAUGHT IT. `class="opt-grid cols-4"` was
     written on the day-count grid in both files and declared in neither,
     so eight buttons silently took the two-column default and ran 0..7
     down four rows. A class that the markup relies on and the stylesheet
     never defines fails here, whatever N is. */
  SURFACES.forEach(([name, src]) => {
    const used = new Set();
    const re = /class="opt-grid([^"]*)"/g;
    let m;
    while ((m = re.exec(src))) {
      (m[1].match(/\bcols-(\d+)\b/g) || []).forEach((c) => used.add(c));
    }
    assert.ok(used.size > 0, name + ': no cols-N classes found at all -- the scan is broken, not the CSS');
    used.forEach((cls) => {
      const n = Number(cls.split('-')[1]);
      const body = winning(src, '.opt-grid.' + cls);
      assert.ok(body, name + ': markup uses .' + cls + ' but no `.opt-grid.' + cls + '{...}` rule declares it');
      const cols = decl(body, 'grid-template-columns');
      assert.equal(cols, 'repeat(' + n + ',1fr)',
        name + ': .' + cls + ' must lay out ' + n + ' columns, got ' + cols);
    });
  });
});

test('an option is a box on both surfaces, not bare words', () => {
  /* The founder's requirement, against a screenshot of Goal Distance: a
     rimmed, filled tile, so the eye can see where one option stops and the
     next begins. A border of 0 or a background of none is the drift this
     catches.
     .bld-purpose IS NOT IN SCOPE and must not be added without being
     asked. The four objectives were moved from tiles to rows in their own
     deliberate pass and test/builderNineStages.test.js holds them that
     way; sweeping them in here would silently overturn it. */
  SURFACES.forEach(([name, src]) => {
    ['.opt-grid button'].forEach((sel) => {
      const body = winning(src, sel);
      assert.ok(body, name + ': no rule for ' + sel);
      const border = decl(body, 'border');
      const bg = decl(body, 'background');
      assert.ok(border && /^1px solid var\(--/.test(border),
        name + ' ' + sel + ': expected a 1px tokenised rim, got ' + border);
      assert.ok(bg && bg !== 'none',
        name + ' ' + sel + ': expected a filled surface, got ' + bg);
      assert.equal(decl(body, 'border-radius'), 'var(--tile-radius)',
        name + ' ' + sel + ': the box takes the product radius');
    });
  });
});

/* NOT A LAW HERE: that the app and /start declare the SAME box.
   They do not, and are not required to. /start draws its chip on
   --t-tile over a --t-tile-rim hairline with --t-lift; the app now draws
   .sess-tab's sheen over --bg-2 on --tile-border. The parity the product
   actually holds is narrower and already has a home --
   test/builderVisualParity.test.js requires the SELECTED state to be gold
   and never cherry on both surfaces, which is the drift that would matter.
   A law asserting an equality the design does not claim is worse than no
   law: it fails on correct work, and it gets deleted rather than read. */

test('a choice stacks by default on both surfaces, and no rule restates it', () => {
  /* THE DEFAULT CARRIES THE RULE NOW, and that is the point of it.
     Both surfaces used to fix this one grid at a time: the distance grid
     had a six-column track with spans, a narrow-phone block re-laid it at
     two, and the experience grid carried an id override to escape
     .cols-3. Three special cases, each correct, none of them the rule.
     One column by default makes the special cases unnecessary, and this
     asserts they are actually GONE -- a rule that restates the default is
     the one a future change forgets to remove, and it would silently win
     over it. */
  SURFACES.forEach(([name, src]) => {
    const base = winning(src, '.opt-grid');
    assert.ok(base, name + ': the .opt-grid base rule is gone');
    assert.equal(decl(base, 'grid-template-columns'), '1fr',
      name + ': a choice is laid out in columns by default again');
    assert.ok(!/\.opt-grid\.opt-grid-32\{/.test(src),
      name + ': the distance grid has a track of its own again');
    assert.ok(!/@media \(max-width:374px\)[\s\S]{0,400}opt-grid-32/.test(src),
      name + ': the narrow-phone distance special case is back');
  });
});

test('a worded grid never asks for columns, on either surface', () => {
  /* The defect this replaces, stated as the rule rather than as its two
     symptoms: .cols-N outranks the single-column default, so writing one
     on a grid of WORDS gives it narrow cells -- and an unbreakable label
     does not wrap in a `1fr` track, it widens the track until the grid
     overflows the card. ESTABLISHED did exactly that at every phone
     width, on both surfaces, before anyone drew a box here.
     The token grids are the eight day counts and the five weekday codes.
     This is the whole list; anything else appearing in it is a worded
     grid that has just been given narrow cells. */
  const EXPECTED = {
    /* The app's eight day counts are a slider now -- founder: "Change build
       a plan to have this 4 areas as the slider options" -- so only the
       weekday codes ask for columns there. /start still draws the tiles. */
    app: ['bld-longday-grid'],
    '/start': ['bld-entry-days', 'bld-longday'],
  };
  SURFACES.forEach(([name, src]) => {
    const found = [];
    const re = /<div class="opt-grid[^"]*\bcols-\d+[^"]*"([^>]*)>/g;
    let m;
    while ((m = re.exec(src))) {
      const id = /id="([^"]+)"/.exec(m[1]);
      const dm = /data-mirror="([^"]+)"/.exec(m[1]);
      const al = /aria-label="([^"]+)"/.exec(m[1]);
      found.push((id && id[1]) || (dm && dm[1]) || (al && al[1]) || '?');
    }
    assert.deepEqual(found.sort(), EXPECTED[name].slice().sort(),
      name + ': the set of grids asking for columns has changed -- ' +
      'a grid of words with narrow cells is how ESTABLISHED left the card. Found: ' +
      found.join(', '));
  });
});

test('every field in the builder is cherry, not the modal\u2019s warm ramp', () => {
  /* Founder: "the selection data input fields should be cherry not gold."
     Every text field in the builder sat on the modal's warm control ramp --
     #24201c on a #3d352b edge, lighting #c5a059 when focused -- which is the
     olive-brown the screenshots showed. The date field had been lifted onto
     the product's cool tile surface BY HAND, one rule at a time, which is
     how the other seven were missed.
     So this pins the mechanism rather than the fields: .builder-light
     re-declares the --ctl-* family once, and every field inherits it. A
     future field added to the builder is covered without anyone
     remembering to cover it. Scoped to the builder, so no other modal
     moves. */
  const body = winning(APP, '.modal-card.builder-light');
  assert.ok(body, 'the builder card rule is gone');
  assert.equal(decl(body, '--ctl-bg'), 'var(--t-tile)',
    'builder fields are back on the modal\u2019s warm input ground');
  assert.equal(decl(body, '--ctl-border'), 'var(--t-tile-rim)',
    'builder fields are back on the modal\u2019s warm edge');
  assert.equal(decl(body, '--ctl-accent'), 'var(--cherry)',
    'a focused builder field is not cherry');
  assert.equal(decl(body, '--ctl-accent-rgb'), '154,84,108',
    'the focus ring alpha is keyed to a colour other than cherry');
});

test('an option chip never lets a long label widen its own track', () => {
  /* overflow:hidden on a grid item is load-bearing here, not cosmetic: it
     drops the item automatic minimum size from min-content to 0, which is
     what stops an unbreakable word growing the track and bursting the
     card. The rules above make every label fit, so nothing is clipped --
     this is the backstop that keeps a future long label a wrapping
     problem rather than a broken-layout one. */
  SURFACES.forEach(([name, src]) => {
    const body = winning(src, '.opt-grid button');
    assert.equal(decl(body, 'overflow'), 'hidden',
      name + ': .opt-grid button must not contribute min-content to its track');
  });
});
