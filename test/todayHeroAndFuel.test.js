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
  /* THE CLAMP MOVED TO A TOKEN, and the values did not. --th-dist-size is
     stated on .th-dist because the rest-day hero reserves exactly this
     height to put its title on a run day's line -- read, never copied. So
     this reads the token AND checks the figure still uses it: a token with
     the right numbers that nothing consumes is the same defect as the wrong
     numbers. */
  const span = /\.th-dist\{--th-dist-size:clamp\(([\d.]+)px, ([\d.]+)vw, ([\d.]+)px\)/.exec(CSS);
  assert.ok(span, 'the distance figure no longer clamps');
  assert.match(CSS, /\.th-dist span\{[^}]*font-size:var\(--th-dist-size\)/,
    'the figure has stopped reading its own size token, so the rest hero reserves a height nothing uses');
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
  /* ---------- FUEL HANDS BACK PANELS, NOT A RAIL ----------
     On the founder's call SETTLE and CARB INTAKE are one rail, and a rail
     cannot be merged once it has been built -- two tracks and two sets of
     dots concatenate into two rails. So fuelRailPanels() returns the panels
     loose and renderCoachingDepth, the one place that knows about both,
     builds the track and counts the dots from the whole list. */
  const panels = a.fuelRailPanels(dd);
  const facts = a.fuelFacts(dd);
  assert.ok(Array.isArray(panels), 'fuel is building a rail of its own again');
  assert.equal(panels.length, facts.rows.length,
    'one module per fact: expected ' + facts.rows.length + ', found ' + panels.length);
  panels.forEach((m, i) => assert.match(m, new RegExp('class="how-mod" data-mod="fuel-' + i + '"'),
    'fuel panel ' + i + ' is not a rail module'));
  assert.ok(facts.rows.length >= 2, 'a rail needs at least two panels to be a rail');
  /* AND THE CARD PUTS THEM ON THE SAME TRACK AS THE PHASES. */
  /* PAIRED NOW, two facts to a card, on the founder's drawing. The merge
     itself is unchanged -- the fuel rides whichever rail the session has
     -- and what changed is how many cards those facts come to. */
  assert.match(SRC, /\(fuelOn && !hasBlueprint\) \? fuelPairPanels\(dd, lead\) : \[\]/,
    'the card no longer merges the fuel panels into the execution rail');
  /* ---------- AND ON A BLUEPRINT SESSION THEY RIDE THAT RAIL ----------
     A long run with a three-stage blueprint AND fuel drew two photograph
     rails, one under the other. A session has one rail; which one carries
     the fuel is decided by hasWorkoutBlueprint(), in one place, so they
     cannot land on both or on neither. */
  assert.match(SRC, /body = renderStructuredWorkoutSteps\(steps, fuel, dd\);/,
    'the blueprint rail no longer takes the fuel facts, so a long run draws two rails');
  /* ---------- A LONG RUN DRAWS NO RAIL TO MERGE ONTO ----------
     Founder: "Long run should follow the same rules as easy run", with a
     mock-up of a long run as a hero and a cherry note and nothing else. So
     the day this test was written around no longer has a rail at all, and
     the merge law moves to a session that still does. The fuel figures
     leaving the screen with it is asserted, with its cost named, in
     structuredWorkout's "a long run draws no rail, and its fuel figures
     leave the screen with it". */
  const longCard = a.renderDayCard(dd);
  assert.equal((longCard.match(/class="fuel-body ws-rail/g) || []).length, 0,
    'a long run still draws a card rail');
  assert.ok(longCard.indexOf('data-solo') > -1,
    'a long run has lost the cherry note that replaced its rail');

  /* THE MERGE ITSELF, ON GOAL DAY -- five execution phases and the fuel
     facts, one track, one set of dots. */
  const race = a.state.days.filter(d => d.type === 'race')[0];
  assert.ok(race, 'the fixture no longer builds a goal day, so the merge is untested');
  const card = a.renderDayCard(race);
  const tracks = (card.match(/class="fuel-body ws-rail/g) || []).length;
  assert.equal(tracks, 1,
    'goal day shows ' + tracks + ' card rails — the phases and the fuel are one rail');
  const dots = card.match(/<div class="how-dots" aria-hidden="true">((<span class="how-dot"><\/span>)+)<\/div>/);
  assert.ok(dots, 'the merged rail has no dots');
  /* ---------- COUNTED FROM THE CARDS, NOT FROM A FORMULA ----------
     This asserted phases + facts, which was the rail's shape at the time
     and stopped being it the moment the facts started pairing two to a
     card. A formula that encodes one layout has to be rewritten for every
     layout; the LAW is that the indicator cannot disagree with the thing
     it indicates, and that is a comparison with the panels themselves. */
  const panelCount = (card.match(/class="how-mod[^"]*"/g) || []).length;
  assert.equal((dots[1].match(/how-dot/g) || []).length, panelCount,
    'the dots do not count the merged rail — the indicator disagrees with the thing it indicates');
  assert.ok(panelCount >= 2, 'a rail needs at least two cards to be a rail');
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
  const rail = a.fuelRailPanels(dd).join('');
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
  const rail = a.fuelRailPanels(dd).join('');
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

test('a fuel card and a stage card share one title declaration', () => {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /* ---------- THERE IS NO COACHING MODULE TO COMPARE WITH ----------
     This measured a fuel panel against a WHY / FEEL / WATCH FOR panel, on
     the grounds that the two sat a centimetre apart and had to read as one
     thing. The founder has taken the columns off every screen and what
     they said is in the Coach's Note, so that comparison has one side.
     WHAT IT WAS FOR SURVIVES, and as a stronger statement than the
     equality it used to make: a fuel card, a stage card and an execution
     phase are not merely tuned to match, they share ONE declaration for
     their title. They cannot drift because there is nothing to drift from.
     FOUR KINDS NOW. Full Plan's phase carousel is a rail of cards and takes
     the same rule -- joined as a fourth arm, not copied -- so it is read
     here with the other three rather than left to resemble them.
     THE ARMS MUST BE CONTIGUOUS. This walks from one to the next, so a
     comment wedged between them reads as four declarations that merely look
     alike; the explanation lives above the rule for exactly that reason. */
  assert.match(CSS, new RegExp(esc(F) + ' \\.ws-rail \\.ws-h-presc:not\\(\\.font-mono\\),[\\s\\S]{0,300}?' +
    esc(F) + ' \\.how-mod \\.fuel-row \\.k,[\\s\\S]{0,200}?\\.strat-phase-label,\\s*\\n\\s*\\.view-plan \\.pp-slide-k\\{'),
    'the four kinds of card no longer share one title declaration, so they can print ' +
    'four different headings a swipe apart');
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
  /* WAS 33%, so three panels landed whole with a fourth peeking. Every
     rail is one full-width card now, on the founder's call, and the dots
     say there is more -- which is also why they stopped retiring once the
     swipe was learned. Both rails still share the number, which is what
     this test is really for. */
  assert.match(mod[1], /flex:0 0 100%/,
    'a rail went off full width. Found: ' + (/flex:[^;]*/.exec(mod[1]) || [''])[0]);
  /* There is no .how-fuel to take a width of its own any more -- fuel's
     panels are in the merged card rail, which is the same component by
     construction rather than by agreement. That it has no wrapper at all
     is asserted once, in "the fuel section has no title of its own"; this
     test is about the width the rails share, so it stops here. */
  /* THE FLOOR RETIRED WITH THE THIRD IT PROTECTED. 122px existed because a
     third of a 360px screen is 83px of text and EXECUTION is one word with
     nowhere to break. At full width the panel is the rail, so a minimum
     narrower than the rail cannot bind -- and a floor that can never apply
     is a number the next reader has to work out the irrelevance of. */
  assert.ok(!/min-width:122px/.test(mod[1]),
    'the 122px floor is back, and at full width it protects nothing');
});

test('the fuel value still hand-sets nothing', () => {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /* It used to set --ink-dim while the coaching value inherited --ink, so a
     figure read dimmer than a sentence beside it. The coaching value is
     gone with the columns; the discipline that caught that is not, and it
     is what stops the next figure drifting from the ones around it. */
  const fuelV = new RegExp(esc(F) + ' \\.how-mod \\.fuel-row \\.v\\{([^}]*)\\}').exec(CSS);
  assert.ok(fuelV, 'the fuel value rule is gone');
  assert.ok(!/(^|;)\s*color\s*:/.test(fuelV[1]),
    'the fuel value hand-sets a colour again in its base rule, which is how it drifted ' +
    'from every other figure in the card the last time');
});

test('the fuel section has no title of its own', () => {
  const i = SRC.indexOf('function renderDayCard(');
  const src = SRC.slice(0, i > -1 ? i : SRC.length);
  assert.ok(!/<div class="how-row-heading">Fuel/.test(SRC),
    'the "FUEL" heading is back. Every panel under it names itself, so a word above a ' +
    'row of labels that already say what they are is a label on labels.');
  /* .how-fuel went with the wrapper: fuel has no section of its own any
     more, its panels are in the merged card rail. What is still asserted
     is that nothing introduces a heading above that rail either.
     READ WITH THE COMMENTS STRIPPED. The first version of this asserted
     "how-fuel" appears nowhere in SRC -- and failed, because the note
     explaining that .how-fuel went away says the words ".how-fuel is gone
     with it". A guard that reads prose as code answers a question about
     the prose. */
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert.ok(CODE.indexOf('how-fuel') === -1,
    'the fuel wrapper is back, which is a second rail under a second heading');
  /* THE ANCHOR MOVED, THE MERGE DID NOT. A solo-note day short-circuits to
     an empty panel list in front of this ("Long run should follow the same
     rules as easy run"), so the concat is now the else of that ternary.
     What this line is checking is that the two sets are still merged into
     ONE rail wherever a rail is drawn, and they are. */
  const i2 = SRC.indexOf('stratPanels.concat');
  assert.ok(i2 > -1, 'the merged rail is gone');
  assert.ok(SRC.slice(i2, i2 + 700).indexOf('how-row-heading') === -1,
    'the merged rail has grown a heading above it');
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
  assert.match(body, /if \(!cueText && !hints\.length && !caps && !soloHow && !cols\.length && !shape\) return '';/,
    'the Coach\u2019s Note is gated on the cue again, so a day with no cue drops the fuel ' +
    'caveats -- and now the execution sentences -- off the screen entirely');
  assert.match(body, /cueText \? '<span class="v">/,
    'the cue is no longer optional inside the note, so a caveat-only day cannot render');
});
