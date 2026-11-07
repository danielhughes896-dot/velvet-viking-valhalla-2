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
  /* The WORDS differ on purpose and the arithmetic does not. The standalone
     card keeps the full copy -- two guards in coachCopyDiscipline require it
     to say "drink to thirst", "adjust for the heat" and "starting guide, not
     a target", which is the line between coaching an athlete and prescribing
     to them -- and Today takes the short line. So each renderer is checked
     against its own set, and the figures above are checked against both. */
  facts.hints.forEach(h => {
    assert.ok(stack.includes(h), 'a hint is missing from the standalone Fueling card');
  });
  /* ---------- THE CAVEATS LEFT THE RAIL FOR THE COACH'S NOTE ----------
     They trailed under the fuel rail as the only unlit prose on the screen.
     They are coaching -- "drink to thirst", "build up to that carb range"
     -- so they sit with the coaching now. What matters has not changed: the
     athlete must still read them. Checked against the RENDERED CARD rather
     than against fuelRailHtml(), which is a stronger question than the one
     this asked before: it does not care which function emits them, only
     that they are on the screen. */
  assert.ok(!facts.railHints.some(h => rail.includes(h)),
    'the fuel caveats are back under the rail as well as in the note — one of the two ' +
    'copies will drift');
  const card = a.renderDayCard(dd);
  facts.railHints.forEach(h => {
    assert.ok(card.includes(h),
      'a fuel caveat has been lost from the session card entirely: ' + JSON.stringify(h.slice(0, 40)));
  });
  const note = card.slice(card.indexOf('class="how-note"'));
  facts.railHints.forEach(h => {
    assert.ok(note.includes(h), 'a fuel caveat is on the card but not inside the Coach\'s Note');
  });
  assert.notDeepEqual(facts.hints, facts.railHints,
    'the two surfaces are sharing one set of words again — Today wants one line and the ' +
    'standalone card has to keep the full caveats');
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
  /* THREE HEADINGS NOW, AND THE FIRST TWO SHARE ONE DECLARATION. The
     execution rail's phase name joined the fuel heading's rule rather than
     copying it, so the selector is a list and the old regex -- which
     required '{' straight after '.k' -- no longer matched. Read the rule by
     its list, and assert the execution label is IN that list, which is a
     stronger statement than the equality below: they cannot disagree
     because they are the same declaration. */
  const fuelK = new RegExp(esc(F) + ' \\.how-mod \\.fuel-row \\.k[,{][^{]*\\{([^}]*)\\}').exec(CSS);
  const howK = new RegExp(esc(F) + ' \\.how-mod \\.how-row \\.k\\{([^}]*)\\}').exec(CSS);
  assert.ok(fuelK && howK, 'one of the two module heading rules is gone');
  assert.match(CSS, new RegExp(esc(F) + ' \\.how-mod \\.fuel-row \\.k,[\\s\\S]{0,200}?\\.strat-phase-label\\{'),
    'the execution phase name no longer shares the fuel heading declaration, so the ' +
    'three rails can print three different headings');
  [['font-size', /font-size:([^;]+)/], ['text-align', /text-align:([^;]+)/], ['color', /color:([^;]+)/]].forEach(([what, re]) => {
    const a2 = re.exec(fuelK[1]), b = re.exec(howK[1]);
    assert.ok(a2 && b, 'cannot read ' + what + ' from both module heading rules');
    assert.equal(a2[1].trim(), b[1].trim(),
      'a fuel panel and a coaching panel disagree on ' + what + ' (' + a2[1] + ' vs ' + b[1] +
      '). They sit a centimetre apart and the whole point of this change was that they read as one thing.');
  });
  /* SUPERSEDED, AND THE REASON IS THE SCREENSHOT THAT FOLLOWED IT.
     This used to require the fuel column to be WIDER than the coaching one
     (40% against 34%), so its headings would not wrap. It bought that at a
     price nobody had looked at: at 40% only two and a half panels fit, so
     the third arrived cut in half by the viewport — TOTAL CARBS sliced down
     the middle, which reads as broken rather than as "there is more
     sideways". Three whole panels is worth a two-line heading, and on a
     430px phone nothing wraps at a third anyway. Both rails are one number
     now, asserted below where the shared rule lives. */
  assert.ok(!new RegExp(esc(F) + ' \\.how-fuel \\.how-mod\\{[^}]*flex:').test(CSS),
    'the fuel rail has taken a width of its own again');
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

/* ---------------------------------------------------------------------------
 * ONE RAIL LANGUAGE, THREE PANELS IN VIEW, AND ONE LINE OF GUIDANCE
 * The fuel rail ran wider than the coaching rail, which put its third panel
 * half off the screen — TOTAL CARBS arrived cut in half, which reads as
 * broken rather than as "there is more sideways". Both rails are a third
 * each now, so three land whole and the fourth peeks.
 * ------------------------------------------------------------------------ */
const escF = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('both rails are the same width, and three panels fit', () => {
  const mod = new RegExp(escF(F) + ' \\.how-mod\\{([^}]*)\\}').exec(CSS);
  assert.ok(mod, 'the module rule is gone');
  assert.match(mod[1], /flex:0 0 33%/,
    'a rail went off a third. At 40% the third panel is cut by the viewport; at 34% ' +
    'only two and a half fit. Found: ' + (/flex:[^;]*/.exec(mod[1]) || [''])[0]);
  assert.ok(!new RegExp(escF(F) + ' \\.how-fuel \\.how-mod\\{[^}]*flex:').test(CSS),
    'the fuel rail has taken a width of its own again — the two rails are the same ' +
    'component a centimetre apart and the whole point of this pass was that they match');
  assert.match(mod[1], /min-width:122px/,
    'the 122px floor is gone. A third of a 360px screen is 83px of text and EXECUTION ' +
    'is one word with nowhere to break.');
});

test('a fuel panel and a coaching panel differ only where figures differ from sentences', () => {
  /* Measured in Chromium rather than read off the sheet: the headings match
     on size, weight, face, colour, tracking and alignment, and the values
     match on everything except the face — mono for figures, which is the
     product's convention for every number it prints. The one thing that had
     drifted was colour: the fuel value hand-set --ink-dim while the coaching
     value inherited --ink, so a figure read dimmer than a sentence beside
     it. Neither sets a colour now. */
  const fuelV = new RegExp(escF(F) + ' \\.how-mod \\.fuel-row \\.v\\{([^}]*)\\}').exec(CSS);
  const howV = new RegExp(escF(F) + ' \\.how-mod \\.how-row \\.v\\{([^}]*)\\}').exec(CSS);
  assert.ok(fuelV && howV, 'one of the two value rules is gone');
  assert.ok(!/(^|;)\s*color\s*:/.test(fuelV[1]),
    'the fuel value hand-sets a colour again, so it will drift from the coaching value ' +
    'beside it the next time the focused card changes its ink');
  const size = r => (/font-size:([^;]+)/.exec(r) || [])[1];
  assert.equal(size(fuelV[1]), size(howV[1]),
    'the two rails disagree on value size (' + size(fuelV[1]) + ' vs ' + size(howV[1]) + ')');
});

test('the fuel section has no title of its own', () => {
  const i = SRC.indexOf('function renderDayCard(');
  const src = SRC.slice(0, i > -1 ? i : SRC.length);
  assert.ok(!/class="how-table how-fuel">'\+'<div class="how-row-heading">Fuel/.test(SRC),
    'the "FUEL" heading is back. Every panel under it names itself, so a word above a ' +
    'row of labels that already say what they are is a label on labels.');
  assert.match(SRC, /'<div class="how-table how-fuel">'\+fuelRailHtml\(dd\)/,
    'the fuel section no longer goes straight from its wrapper into the rail');
});

test('the guidance under the figures is one line, and the carb caveat survives where it matters', () => {
  /* BOTH BRANCHES, AND THAT IS THE POINT. The first version of this guard
     took whatever long run the fixture produced first, which was not a
     prolonged one -- so it only ever ran the "no caveat" branch and a
     mutation that deleted the caveat outright passed it. It now finds a day
     on each side of fuelCarbRange()'s own threshold and asserts both.
     The caveat is not general advice and is not decoration: it exists so the
     top of a range the athlete can SEE is not read as a target to hit, which
     is the one thing on this card that could have someone eat to a number
     their gut has never practised. */
  const today = new Date().toISOString().slice(0, 10);
  const a = loadApp({ pinnedDate: today + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 14, startDate: a.addDays(today, -9 * 7), distanceKey: 'full',
    volume: 46, benchSec: 45 * 60, lthr: 165, maxHR: 190,
    schedule: { activeDays: [0, 1, 2, 3, 4, 5, 6], longRunDay: 6 } });

  const byBand = want => a.state.days.filter(d => {
    if (d.type === 'rest' || !d.km) return false;
    const h = a.getDayDurationSec(d) / 3600;
    return !!a.fuelCarbRange(h).prolonged === want;
  })[0];

  const longOne = byBand(true), shortOne = byBand(false);
  assert.ok(longOne, 'the fixture built no session long enough to be prolonged, so the ' +
    'caveat branch cannot be tested — lengthen the plan rather than deleting this');
  assert.ok(shortOne, 'the fixture built no session short enough to be un-prolonged');

  const shortHints = a.fuelFacts(shortOne).railHints;
  assert.equal(shortHints.length, 1,
    'an ordinary session is showing more than the one standing line of guidance');
  assert.match(shortHints[0], /Adjust fluid for heat and thirst/,
    'the standing line of guidance changed wording');
  assert.match(shortHints[0], /nothing new on/,
    'the "nothing new on race day" half of the standing line is gone');

  const longHints = a.fuelFacts(longOne).railHints;
  assert.equal(longHints.length, 2,
    'a prolonged session (' + longOne.km + 'km) lost the caveat about the top of the carb range');
  assert.match(longHints[1], /practised gut/,
    'the carb-range caveat changed into something that no longer says why the top of ' +
    'the range is not a target');
});


test('the standalone Fueling card keeps the copy that makes it guidance', () => {
  /* Shortening Today's line took these off BOTH surfaces the first time,
     because one set of words served two renderers. coachCopyDiscipline
     caught it. They are repeated here so the next person shortening copy
     sees the constraint beside the thing they are shortening, rather than
     in a file about copy discipline they have no reason to open. */
  const { a, dd } = longDay();
  const card = a.renderFuelingCard(dd);
  [[/drink to thirst/i, 'the honest caveat'],
   [/adjust for the heat/i, 'the heat caveat'],
   [/starting guide, not a target/i, 'the line that keeps hydration copy guidance rather than instruction']
  ].forEach(([re, what]) => {
    assert.match(card, re, 'the standalone Fueling card lost ' + what +
      '. Today may carry one line; this card is where the full reasoning lives.');
  });
});

test('the ring keeps its heart and pace marks', () => {
  /* THE LAST TWO GLYPHS IN FRONT OF TEXT ON THESE SCREENS, AND THEY STAY.
     Three separate sweeps for "a glyph before a title" have surfaced these,
     and each time the answer was the same, so it is written down here rather
     than re-decided a fourth time.
     What was removed was decoration before a TITLE — a sparkle ahead of
     "What's next", an icon ahead of "Reschedule" — saying nothing the word
     did not. These are kind-markers on a data row: the ring shows 148–156
     and 5:23–6:24, both of which are just digits, and the glyph says which
     is heart rate and which is pace without spending a label on it.
     Confirmed as keep by the founder. */
  const i = SRC.indexOf('function renderDayTargetRing(');
  assert.ok(i > -1, 'renderDayTargetRing is gone');
  const body = SRC.slice(i, SRC.indexOf('\n}\n', i));
  assert.match(body, /class="th-ic">'\+ICONS\.heart/,
    'the heart mark has been stripped from the ring. It is not decoration before a ' +
    'title — it is what distinguishes a BPM range from a pace range at a glance.');
  assert.match(body, /class="th-ic">'\+ICONS\.gauge/,
    'the pace mark has been stripped from the ring; see the note beside the function');
});

test('the Coach\u2019s Note still appears when the only thing to say is the fuel caveat', () => {
  /* THE TRAP IN MOVING THEM. The note used to render only when there was a
     cue to print. Hand it the fuel caveats and gate it on the cue alone and
     every day without a cue silently loses the safety copy -- which is the
     same regression two guards in coachCopyDiscipline were written for after
     I caused it once by sharing one hints array between both renderers. */
  const i = SRC.indexOf('var hints = fuelOn ? (fuelFacts(dd).railHints || []) : [];');
  assert.ok(i > -1, 'the note is no longer offered the fuel caveats');
  /* A fixed 420-char window stopped reaching the gate the moment a comment
     was written between the two lines -- and a window that stopped AT the
     gate then cut off the markup the assertions below it read. The whole
     builder, bounded by the end of its own IIFE. */
  const end = SRC.indexOf('})()+', i);
  assert.ok(end > i, 'the Coach\u2019s Note builder is no longer an IIFE — re-anchor this');
  const body = SRC.slice(i, end);
  assert.match(body, /if \(!cueText && !hints\.length && !caps\) return '';/,
    'the Coach\u2019s Note is gated on the cue again, so a day with no cue drops the fuel ' +
    'caveats -- and now the execution sentences -- off the screen entirely');
  assert.match(body, /cueText \? '<span class="v">/,
    'the cue is no longer optional inside the note, so a caveat-only day cannot render');
});
