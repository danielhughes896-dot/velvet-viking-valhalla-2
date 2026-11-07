'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* TODAY'S HERO, AND FUEL AS FIVE FACTS RATHER THAN A LEDGER
 * ===========================================================================
 * Two instructed changes to the focused session card.
 *
 * The hero: the session title up 15% and the distance up 20%. Both are plain
 * instructions, so what these guards hold is not the taste but the arithmetic
 * -- 19 -> 21.85, and all three of the distance's clamp stops scaled together
 * so the figure's response to screen width stays proportional rather than
 * arriving as a step at one width.
 *
 * The fuel: it rendered as a five-row ledger, label left and number right,
 * directly beneath WHY / EXECUTION / FEEL, which are panels of light the
 * athlete swipes through. Two registers for the same kind of thing, a
 * centimetre apart. Fuel is five short label/value pairs -- the shape of a
 * module -- so it takes the same rail, the same swipe and the same light.
 *
 * The risky parts are not the look. They are (a) that renderDayCard() must
 * keep emitting ONE string for all three views, (b) that the standalone
 * Fueling card still renders the stack, and (c) that two rails inside one
 * <details> must not share a set of dots. Each has a guard.
 */
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
const F = ':is(.view-today .day.is-today, .view-week .wk-full .day, .view-plan-session .day, .view-week .wk-overview)';

const longDay = () => {
  const today = new Date().toISOString().slice(0, 10);
  const a = loadApp({ pinnedDate: today + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 14, startDate: a.addDays(today, -9 * 7), distanceKey: 'full',
    volume: 46, benchSec: 45 * 60, lthr: 165, maxHR: 190,
    schedule: { activeDays: [0, 1, 2, 3, 4, 5, 6], longRunDay: 6 } });
  const dd = a.state.days.filter(d => d.type === 'long')[0];
  assert.ok(dd, 'the fixture built no long run, so there is no fuelled session to test');
  return { a, dd };
};

test('the hero title carries the instructed 15%', () => {
  const m = new RegExp(F.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    ' \\.th-hero-title\\{[^}]*font-size:([\\d.]+)px').exec(CSS);
  assert.ok(m, 'the focused hero title rule is gone');
  assert.equal(m[1], '21.85',
    'the hero title moved off 19px + 15%. If that is deliberate the note beside it has to change too.');
});

test('the distance carries the instructed 20% at every clamp stop', () => {
  const span = /\.th-dist span\{[^}]*font-size:clamp\(([\d.]+)px, ([\d.]+)vw, ([\d.]+)px\)/.exec(CSS);
  assert.ok(span, 'the distance figure no longer clamps');
  assert.deepEqual(span.slice(1, 4), ['45.6', '14.4', '57.6'],
    'the distance figure is no longer 38/12vw/48 scaled by 1.2. Scaling only the ceiling ' +
    'would leave every phone under ~400px at the old size and make the increase a step.');
  const em = /\.th-dist em\{[^}]*font-size:clamp\(([\d.]+)px, ([\d.]+)vw, ([\d.]+)px\)/.exec(CSS);
  assert.ok(em, 'the distance unit no longer clamps');
  assert.deepEqual(em.slice(1, 4), ['28.8', '9.6', '38.4'],
    'the unit did not travel with the number — "15km" is one figure, and leaving "km" ' +
    'behind changes the proportion between them.');
});

test('fuel renders as a rail of one module per fact', () => {
  const { a, dd } = longDay();
  const html = a.fuelRailHtml(dd);
  const facts = a.fuelFacts(dd);
  assert.match(html, /<div class="fuel-body" data-hswipe="1">/,
    'the fuel rail lost its rail container, or the marker that makes the page pager stand down');
  const mods = html.match(/class="how-mod" data-mod="fuel-\d+"/g) || [];
  assert.equal(mods.length, facts.rows.length,
    'one module per fact: expected ' + facts.rows.length + ', found ' + mods.length);
  assert.ok(facts.rows.length >= 2, 'a rail needs at least two panels to be a rail');
  assert.match(SRC, /class="how-table how-fuel"[\s\S]{0,80}?fuelRailHtml\(dd\)/,
    'the card no longer builds its fuel section from the rail');
});

test('the standalone Fueling card still renders the stack, untouched', () => {
  const { a, dd } = longDay();
  const stack = a.fuelSectionBody(dd);
  assert.ok(!/how-mod|fuel-body|how-dots/.test(stack),
    'the stacked renderer picked up rail markup. The Fueling & Hydration card is a ' +
    'different surface and was not part of this change.');
  const rows = stack.match(/<div class="fuel-row">/g) || [];
  assert.equal(rows.length, a.fuelFacts(dd).rows.length, 'the stack lost or gained a row');
  assert.match(a.renderFuelingCard(dd), /<div class="fuel-body">/,
    'the standalone card no longer renders its body');
});

test('both renderers read the same arithmetic', () => {
  /* The computation was split out of fuelSectionBody so the rail could reuse
     it. Two renderers over one source is only safe while they genuinely
     share it -- a copied constant here would show up as a session needing a
     different number of gels depending on which surface you read. */
  const { a, dd } = longDay();
  const facts = a.fuelFacts(dd);
  const stack = a.fuelSectionBody(dd);
  const rail = a.fuelRailHtml(dd);
  facts.rows.forEach(r => {
    assert.ok(stack.includes('>' + r.v + '<') || stack.includes(r.v),
      'the stack does not show the computed value ' + JSON.stringify(r.v));
    assert.ok(rail.includes(r.v), 'the rail does not show the computed value ' + JSON.stringify(r.v));
    assert.ok(stack.includes(r.k), 'the stack lost the label ' + JSON.stringify(r.k));
  });
  facts.hints.forEach(h => {
    assert.ok(stack.includes(h) && rail.includes(h), 'a hint is missing from one of the two renderers');
  });
});

test('one string serves every view: both labels travel, CSS picks one', () => {
  const { a, dd } = longDay();
  const rail = a.fuelRailHtml(dd);
  const longs = (rail.match(/class="k-long"/g) || []).length;
  const shorts = (rail.match(/class="k-short"/g) || []).length;
  assert.equal(longs, shorts, 'every fuel module needs both labels; found ' + longs + ' long and ' + shorts + ' short');
  assert.ok(longs >= 2, 'the fuel modules lost their paired labels');

  assert.match(CSS, /\.fuel-row \.k-short\{display:none;\}/,
    'the short label is no longer hidden by default, so the stacked table would print both');
  assert.match(CSS, /\.fuel-v-note\{display:none;\}/,
    'the value note is no longer hidden by default, so the stack would print "25g each" twice in one row');

  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(CSS, new RegExp(esc(F) + ' \\.how-mod \\.fuel-row \\.k-long\\{display:none;\\}'),
    'the long label is no longer hidden inside a rail module — it does not fit the column');
  assert.match(CSS, new RegExp(esc(F) + ' \\.how-mod \\.fuel-row \\.k-short\\{display:block;\\}'),
    'the short label is no longer shown inside a rail module');
});

test('a fuel module is the same panel as a coaching module', () => {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fuelK = new RegExp(esc(F) + ' \\.how-mod \\.fuel-row \\.k\\{([^}]*)\\}').exec(CSS);
  const howK = new RegExp(esc(F) + ' \\.how-mod \\.how-row \\.k\\{([^}]*)\\}').exec(CSS);
  assert.ok(fuelK && howK, 'one of the two module heading rules is gone');
  [['font-size', /font-size:([^;]+)/], ['text-align', /text-align:([^;]+)/], ['color', /color:([^;]+)/]].forEach(([what, re]) => {
    const a2 = re.exec(fuelK[1]), b = re.exec(howK[1]);
    assert.ok(a2 && b, 'cannot read ' + what + ' from both module heading rules');
    assert.equal(a2[1].trim(), b[1].trim(),
      'a fuel panel and a coaching panel disagree on ' + what + ' (' + a2[1] + ' vs ' + b[1] +
      '). They sit a centimetre apart and the whole point of this change was that they read as one thing.');
  });
  assert.match(CSS, new RegExp(esc(F) + ' \\.how-fuel \\.how-mod\\{flex:0 0 40%'),
    'the fuel column went back to the coaching rail\'s 34%, where "TOTAL CARBS" and ' +
    '"GELS / CHEWS" both wrapped to two lines — measured, and the reason the column is wider.');
});

test('two rails in one card do not share a set of dots', () => {
  /* wireCoachingRail() read its dots from the rail's PARENT, which was
     unambiguous while a card held one rail. Fuel is a second rail inside the
     same <details>, so a parent lookup hands the coaching rail both sets and
     lights a fuel dot when the athlete swipes Why. */
  const i = SRC.indexOf('function wireCoachingRail(');
  assert.ok(i > -1, 'wireCoachingRail is gone');
  const body = SRC.slice(i, SRC.indexOf('\n}\n', i));
  assert.match(body, /rail\.nextElementSibling/,
    'the rail no longer reads its dots from its own next sibling');
  assert.ok(!/rail\.parentNode[\s\S]{0,200}querySelectorAll\('\.how-dot'\)/.test(body),
    'the dots are being read from the rail\'s parent again, which two rails in one card share');
  assert.match(SRC, /function railDotCount\(n\)/,
    'the shared dot builder is gone, so the two rails can disagree about how to draw dots');
});

test("the Coach's Note is centred, heading and sentence together", () => {
  /* Centred by instruction. align-items centres the two boxes and text-align
     centres the words inside them -- the heading is a flex item in a column,
     so without the first it would sit centred-looking only while its text
     happened to fill the width. Both are asserted because either alone
     leaves it looking right in one session and off in the next.
     Scoped to the focused-session set rather than Today alone: the note is
     one string from renderDayCard(), and centring it on one of the three
     screens that show it is the per-screen drift this sheet spends its
     length undoing. */
  const esc = s2 => s2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const note = new RegExp(esc(F) + ' \\.how-note\\{([^}]*)\\}').exec(CSS);
  assert.ok(note, "the focused Coach's Note rule is gone");
  assert.match(note[1], /align-items:center/,
    "the Coach's Note heading and sentence are no longer centred as boxes");
  assert.match(note[1], /text-align:center/,
    "the Coach's Note words are no longer centred inside their boxes");
});
