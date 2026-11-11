'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* WHAT THE SCREEN BECOMES ONCE THE SESSION IS DONE.
 * ===========================================================================
 * Everything below the Coach's Note used to be the old app showing through
 * the new one: boxed inputs on a tile, a bordered Execution Review card, a
 * right-aligned underlined link. The session above had already stopped being
 * a card, so the completed state read as a different product. These guards
 * hold the completed surface to the same rules as the rest of the page --
 * lit rather than framed, tokens rather than hand-set values, and the same
 * markup in all three places a session is shown in full.
 */
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
/* Read out of the sheet, not retyped: the arms change when another screen
   adopts the hierarchy, and a stale copy here reports "rule not found" for
   every rule in this file instead of for the one that broke. The arms
   themselves are asserted in coachingRail. */
const F = (CSS.match(/:is\(\.view-today \.day\.is-today[^)]*\)/) || [])[0];
assert.ok(F, 'the focused-session selector is gone from the sheet');
const rule = sel => {
  const i = CSS.indexOf(sel + '{');
  assert.ok(i > -1, 'rule not found: ' + sel);
  return CSS.slice(i + sel.length + 1, CSS.indexOf('}', i));
};

function app(){
  const a = loadApp({ pinnedDate: '2026-08-24T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.scheduleSave = () => {}; a.flushSave = () => {}; a.replaceCard = () => {};
  buildPlan(a, { weeks: 14, startDate: '2026-07-01', distanceKey: '10k',
    volume: 40, lthr: 165, maxHR: 190,
    schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } });
  return a;
}
function completedDay(a){
  const d = a.state.days.filter(x => x.type === 'threshold')[0];
  d.completed = true;
  d.actual = { km: d.km };
  return d;
}
/* THE LOG IS BEHIND ITS OWN TAB NOW, closed until asked, so a test about
   what the FIELDS look like has to open it first -- otherwise it renders
   nothing and the assertion passes or fails on an empty string rather than
   on the thing it names. The tab's own placement is asserted separately. */
function completedDayWithLogOpen(a){
  const d = completedDay(a);
  a.logOpenFor[d.id] = true;
  return d;
}

test('a completed session states that it is complete, once, before the log', () => {
  const a = app();
  const html = a.renderDayCard(completedDayWithLogOpen(a));
  assert.equal((html.match(/class="actual-done"/g) || []).length, 1,
    'the completion statement is missing or duplicated');
  assert.ok(html.indexOf('actual-done') < html.indexOf('data-field="km"'),
    'the log no longer opens under a statement of fact');
  assert.match(html, /actual-done-k">Session complete</,
    'the completion statement lost its words');
});

test('the completion statement is the same markup in all three views', () => {
  /* renderDayCard() emits ONE string; CSS decides whether it is a quiet line
     or a lit banner. This is the rule the whole focused-session design rests
     on, and a view-conditional branch here would break it silently. */
  const a = app();
  const d = completedDay(a);
  const views = ['today', 'week', 'full'].map(v => { a.state.view = v; return a.renderDayCard(d); });
  assert.equal(views[0], views[1], 'Today and This Week render different cards');
  assert.equal(views[1], views[2], 'This Week and Full Plan render different cards');
});

test('a focused session is not capped by the drawer holding its log and analysis', () => {
  /* WHY THIS GUARD EXISTS, AND WHAT CHANGED UNDER IT.
     .day-detail was already uncapped in the focused views, on the reasoning
     that a focused session is never shut, so its ceiling animates nothing
     and can only cut things off. The drawer was not, and kept
     max-height:4000px. Measured on a completed interval with the log
     detail, the splits and the analysis all open: 3421px -- 579px of
     headroom. A card past that limit paints below the box without
     extending it, so the page stops scrolling with the rest of the session
     still visible underneath.

     THAT 3421px WAS MEASURED WHILE THE PRESCRIPTION RENDERED INSIDE THE
     DRAWER, under the log. That ordering has since been reverted -- see
     renderDayCard -- so the drawer is lighter than it was by the whole
     prescription, and the number above is history rather than the current
     height. The cap stays off regardless: the drawer still carries the
     voice card, the entire log with its detail and splits, and the
     Execution Review, and a ceiling over a section that is never collapsed
     in these views has nothing to animate and everything to lose. Removed
     rather than raised, because raising only moves the cliff. */
  const drawer = rule(F + ' .day-drawer');
  assert.match(drawer, /max-height:none/,
    'the focused drawer has a ceiling again, and the prescription is inside it');
  assert.match(drawer, /overflow:visible/, 'the focused drawer clips again');

  /* And the accordion it exists for is untouched where cards DO shut. */
  assert.match(CSS, /\.day\.open \.day-drawer\{max-height:4000px/,
    'the list accordion lost the ceiling that animates it open');
  assert.match(CSS, /\.day-detail, \.day-drawer\{max-height:0/,
    'the list accordion lost the closed state it animates from');
});

test('nothing on the completed surface is drawn as a box', () => {
  /* The session above it is not a card, so neither is the log under it. */
  const fields = rule(F + ' .actual-field :is(input, textarea)');
  assert.match(fields, /background:none/, 'the log fields are tiles again');
  assert.match(fields, /border:0; border-bottom:1px solid var\(--line-soft\)/,
    'the log fields are boxed again instead of ruled');
  /* AND THE RULE IS NOT GOLD. It was, on the inputs only -- the notes
     textarea beside them was already drawn on --line-soft -- so one panel
     carried two line treatments and the louder of the two was a column of
     yellow underlines running down a screen whose subject is the session
     above it. Gold marks the brand and the one thing being offered, not
     every box an athlete can type in. One hairline, every field. */
  assert.doesNotMatch(fields, /--gold/, 'the log fields are underlined in gold again');
  /* The vertical hairline between figures is gone too: it was a white
     separator, and it was placed by sibling order rather than by column, so
     on a row with an odd number of fields it indented the field that STARTS
     column one. The grid gap is the separation. */
  assert.doesNotMatch(CSS, /\.actual-field:not\(\.full\) \+ \.actual-field:not\(\.full\)/,
    'the field separator is back, and with it the broken grid row');
  const review = rule(F + ' .exec-review-card');
  assert.match(review, /background:none/, 'the Execution Review is a card again');
  assert.match(review, /border:0/, 'the Execution Review has its border back');
  assert.match(review, /box-shadow:none/, 'the Execution Review is lifted again');
});

/* The one definition of the done light, read from :root. */
const DONE_GLOW = (() => {
  const i = CSS.indexOf('--glow-done:');
  assert.ok(i > -1, 'the shared done light is gone');
  return CSS.slice(i, CSS.indexOf(';', CSS.indexOf('transparent 100%', i)));
})();

test('SESSION COMPLETE is lit the way the Coach\'s Note is lit', () => {
  const glow = rule(F + ' .actual-done::before');
  assert.match(glow, /filter:blur\(/,
    'the glow is a hard gradient again -- a stop list always shows its edge');
  assert.match(glow, /left:calc\(50% - 50vw\); width:100vw/,
    'the glow no longer overspills the content it lights');
  assert.doesNotMatch(glow, /border:/, 'the completion banner grew a border');
  /* A radial ending-shape percentage is read against the BOX, not the half
     box: anything over 50% still carries colour at the edge and gets cut,
     which is the rectangle this technique exists to avoid. */
  /* THE GRADIENT MOVED INTO A TOKEN and the rule now reads
     background:var(--glow-done) -- because a finished session and the marks
     that stand for one were being lit by three separately written recipes.
     The claims are unchanged; they are simply asserted where the gradient
     now lives. */
  assert.match(glow, /background:var\(--glow-done\)/,
    'the completion banner stopped drinking from the shared done light');
  const shape = /radial-gradient\((\d+)% (\d+)%/.exec(DONE_GLOW);
  assert.ok(shape, 'the glow is no longer a radial');
  assert.ok(Number(shape[1]) < 50 && Number(shape[2]) < 50,
    'the glow reaches the box edge (' + shape[1] + '% x ' + shape[2] + '%) and will be cut square');
});

test('the completion green is a named token, not an invented colour', () => {
  assert.match(CSS, /--ok:#7AA06E;/, '--ok is gone or changed');
  assert.match(CSS, /--ok-text:#9BC08C;/, '--ok-text is gone or changed');
  assert.match(DONE_GLOW, /var\(--ok-text\)/, 'the glow stopped naming its colour');
  assert.match(DONE_GLOW, /var\(--ok\)/, 'the glow stopped naming its colour');
  assert.doesNotMatch(DONE_GLOW, /#[0-9A-Fa-f]{3,6}|rgba?\(/,
    'the glow hand-sets a colour that belongs to no token');
});

test('clearing a log comes last inside the log it would undo', () => {
  /* THIS ASSERTION FOLLOWED THE CARD. It used to require Clear log AFTER
     the execution review -- correct while both were loose on the card and
     the review sat directly above the fields: undoing a log is a recovery
     from a mistake, and it should not be wedged between the fields and the
     reading of them.

     The card is four tabs now and the founder's order is Share, Session
     Details, Your Log, Valhalla Analysis -- so the analysis comes after the
     log rather than before it, and "after the review" is no longer a place
     Clear log can be without leaving the tab it belongs to. The intent is
     unchanged and is what is asserted: last, under everything the log
     produced, and inside the tab that holds it. */
  const a = app();
  const html = a.renderDayCard(completedDayWithLogOpen(a));
  const clear = html.indexOf('actual-clear');
  assert.ok(clear > -1, 'Clear log is gone');
  assert.ok(clear > html.indexOf('data-field="km"'),
    'Clear log is wedged above the fields it would undo');
  assert.ok(clear > html.indexOf('splits-block') || html.indexOf('splits-block') === -1,
    'Clear log no longer comes after the splits');
  /* Inside Your Log: the tab opens before it and closes after it. */
  const logTab = html.indexOf('class="log-tab"');
  assert.ok(logTab > -1 && logTab < clear,
    'Clear log escaped Your Log and is loose on the card again');
  assert.match(rule(F + ' .actual-clear'), /text-align:center/,
    'Clear log drifted back to the edge of the screen');
});

test('both disclosures are a label with its explanation under it', () => {
  const a = app();
  const html = a.renderDayCard(completedDayWithLogOpen(a));
  assert.match(html, /<span class="st-k">\+ Add detail<\/span><span class="st-sub">/,
    'Add detail is one long sentence wearing a plus sign again');
  /* Chrome that repeats on every card is excluded by name in copyRepetition
     by a leading "+ Add detail" -- the plus has to stay inside the text, not
     become a CSS pseudo-element. */
  assert.match(html.replace(/<[^>]+>/g, ''), /\+ Add detail/,
    'the stripped text no longer reads as the chrome it is');
  /* A STRUCTURED session renders a breakdown summary card here rather than a
     toggle, so the laps and breakdown disclosures are checked against the
     templates: there is no fixture on which both can be rendered at once. */
  assert.match(SRC, /<span class="st-k">\+ Add laps \/ splits<\/span><span class="st-sub">Optional</,
    'the unstructured laps disclosure lost its structure');
  assert.match(SRC, /<span class="st-k">\+ Log the session breakdown<\/span><span class="st-sub">Optional</,
    'the structured breakdown disclosure lost its structure');
});

test('pace is still offered as optional on the completed surface', () => {
  /* The design drops the word; the promise does not. A missing pace narrows
     what Valhalla will CLAIM and is never a failure, so the label says so. */
  const a = app();
  const html = a.renderDayCard(completedDayWithLogOpen(a));
  assert.match(html, /Avg Pace[^<]*optional/i, 'pace reads as compulsory again');
});

test('the header is one height on every view, so the page under it cannot shift', () => {
  /* Today used to render .topbar-inner-today while the other four rendered
     .topbar-inner-brand-only, and a difference between the two moved the
     whole page on every swipe to or from Today -- measured at 4px before it
     was fixed. There is one header now (see the law below), so the pair
     cannot disagree; the padding is still asserted because the cheapest way
     to bring that bug back is to give one view a bar of its own again. */
  const base = /padding:calc\((\d+)px \+ env\(safe-area-inset-top, 0px\)\) 16px (\d+)px/.exec(rule('.topbar-inner'));
  const brand = /padding-top:calc\((\d+)px \+ env\(safe-area-inset-top, 0px\)\); padding-bottom:(\d+)px/
    .exec(rule('.topbar-inner-brand-only'));
  assert.ok(base && brand, 'the header padding rules changed shape');
  assert.equal(base[1], brand[1], 'the header is a different height on Today (top padding)');
  assert.equal(base[2], brand[2], 'the header is a different height on Today (bottom padding)');
  assert.doesNotMatch(rule('.topbar'), /border-bottom:1px solid var\(--line\)/,
    'the redundant rule under the header is back');
});

test('one header, the same one, on every view', () => {
  /* ---- CHANGED SIDES: THE DATE WENT TOO ----
     Founder: "No date. Stuck on every page."
     This held that Today rendered a header of its own, carrying the date on
     the right and an empty left slot to keep the wordmark centred, and its
     own comment defended the date as "the one thing in that bar the athlete
     cannot read off anything else on the screen". That was true and it is
     not what was asked: a date on one screen of five is precisely what made
     the header change as you moved between tabs.
     THE STRONGEST FORM OF "STUCK ON EVERY PAGE" is that the five views
     return the SAME STRING, so this compares them rather than checking each
     for the absence of a date. */
  const a = app();
  const views = ['today', 'week', 'full', 'planhq', 'settings'];
  const bars = views.map(v => { a.state.view = v; return a.renderTopbar(); });
  assert.equal(new Set(bars).size, 1,
    'the header is not identical across the five tabs: ' +
    views.filter((v, i) => bars[i] !== bars[0]).join(', ') + ' differ from today');
  const bar = bars[0];
  assert.match(bar, /topbar-inner-brand-only/, 'the one header is not the brand-only bar');
  assert.equal(bar.indexOf('tb-date'), -1, 'the date is back in the header');
  assert.equal(bar.indexOf('tb-today'), -1, 'the header says "Today" again');
  assert.equal(bar.indexOf('topbar-inner-today'), -1,
    'Today has its own header again, which is how the heights came to differ');
  /* And no date by any other route: the bar must not carry today's day or
     date in any spelling. */
  const t = a.todayStr();
  [a.dow(t), a.dShort(t), t].forEach(frag =>
    assert.equal(bar.indexOf(frag), -1, 'the header still prints ' + frag));
  a.state.view = 'today';
});

test('the mark is VALHALLA, signed by the company, with one gold dot each side', () => {
  /* Founder, with a mock-up: "I want the title at the top changing to that.
     No date. Stuck on every page. No hairline. Just 1 gold dot either side.
     Valhalla is the apps name so should be big. Velvet viking is the
     company so small accent under it." */
  const a = app();
  a.state.view = 'today';
  const bar = a.renderTopbar();
  assert.match(bar, />Valhalla</, 'the app name is not in the mark');
  assert.match(bar, />By Velvet Viking</, 'the company no longer signs the mark');
  assert.equal((bar.match(/class="bm-dot"/g) || []).length, 2,
    'the mark does not carry exactly one dot either side');
  /* THE DOTS ARE DECORATION AND MUST NOT BE READ ALOUD. Two bullets
     announced between the name and the byline is the mark made worse for
     the athletes most likely to need it plain. */
  assert.equal((bar.match(/class="bm-dot" aria-hidden="true"/g) || []).length, 2,
    'a decorative dot is exposed to a screen reader');

  const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
  /* GOLD, AND ONLY HERE. The wordmark used to BE gold; the founder's
     hierarchy keeps gold for the brand and the mock-up spends it on two
     points instead of eight letters. */
  assert.match(/\.bm-dot\{([^}]*)\}/.exec(CSS)[1], /background:var\(--gold-bright\)/,
    'the dots are not the brand gold');
  const word = /\.bm-word\{([^}]*)\}/.exec(CSS)[1];
  assert.match(word, /color:#FFFFFF/i, 'the app name is not white');
  /* THE TRAILING TRACK IS CANCELLED, and this is the whole reason the mark
     sits centred. letter-spacing adds a full track AFTER the last letter, so
     without the negative margin the right dot sits one track further from
     the A than the left dot does from the V -- measured in Chromium at 412,
     360 and 320: 15px against 15px with it, 15px against 22.7px without.
     The two must move together, so the law reads one off the other. */
  const track = /letter-spacing:\.(\d+)em/.exec(word);
  const pull  = /margin-right:-\.(\d+)em/.exec(word);
  assert.ok(track && pull, 'the name no longer states both its track and the pull that cancels it');
  assert.equal(pull[1], track[1],
    'the negative margin stopped matching the letter-spacing, so the mark is off-centre by ' +
    'the difference');
  /* THE HAIRLINE IS GONE. Founder: "No hairline." */
  assert.doesNotMatch(CSS, /\.brandmark::after/,
    'the decorative rule under the mark is back');
});

test('the breakdown disclosure is not the one tile left on the page', () => {
  /* A structured session renders its breakdown as an .ev-card summary rather
     than a plain toggle, so two controls doing the same job -- open a
     disclosure -- sat three lines apart drawn as different species. Boxes
     are not banned (Hear Today and Ask Coach are deliberately obvious), but
     those are outlined pills; this was the filled, rimmed, shadowed tile the
     focused session removed everywhere else. */
  const r = rule(F + ' .splits-summary');
  assert.match(r, /background:none/, 'the breakdown card has its fill back');
  assert.match(r, /border:0/, 'the breakdown card has its rim back');
  assert.match(r, /box-shadow:none/, 'the breakdown card is lifted again');
  assert.match(r, /border-radius:0/, 'the breakdown card has its corners back');
  assert.match(rule(F + ' .splits-summary-title'), /var\(--label-face\)/,
    'the breakdown eyebrow is no longer on the label tier with its sibling');
});

test('de-tiling the breakdown did not delete its press feedback', () => {
  /* .ev-card:hover is two classes; the focused-session rule is four, so
     box-shadow:none would have beaten it and silently removed the state --
     the one thing test/themeSystem says must never happen to it. It comes
     back as illumination alone, with no tile shadow to sit beside. */
  ['hover', 'active'].forEach(state => {
    const r = rule(F + ' .splits-summary:' + state);
    assert.match(r, /box-shadow:0 0 \d+px color-mix\(in srgb, var\(--gold\)/,
      '.splits-summary:' + state + ' gives no feedback on a focused session');
    assert.doesNotMatch(r, /--tile-shadow/,
      'the tile shadow came back with the press state');
  });
});

/* FEEL WAS THE LAST CONTROL BUILT OUT OF BOXES AND FILLS.
 * ===========================================================================
 * A 9px label at 0.5px tracking inside a 6px-radius slab, which selected
 * itself by turning solid gold and flipping its text dark. Every comparable
 * control in the product had since settled on the opposite grammar -- a
 * pill, the one label voice, the word staying put, and the state carried by
 * light. The phase chips say it in as many words: gold means SELECTED, and
 * the word stays crisp white at every state.
 */
test('FEEL: the pills speak the product\'s own language, not the old one', () => {
  const btn = rule('.feel-btn');
  // the one label voice, not a 9px variant of it
  ['--label-face', '--label-size', '--label-track', '--label-weight'].forEach(tok =>
    assert.ok(btn.indexOf('var(' + tok + ')') > -1,
      'the Feel pills are off the label voice (' + tok + ')'));
  assert.doesNotMatch(btn, /font-size:9px/, 'the 9px label is back');
  /* ---- THIS ASSERTION HAS CHANGED SIDES, AND SO HAS THE LAW ABOVE IT ----
     It used to require a 99px pill: that was this control's step AWAY from
     a 6px slab, and at the time the pill was what every comparable control
     wore. They have all since gone further. The bottom nav, the KM / MI
     toggle, the goal options and the share segments now draw NO container
     at all -- the chosen one is said with light on the word itself, and
     Feel was the last rimmed pill left in the product.
     What the test was protecting is unchanged and still asserted below:
     one label voice, gold means SELECTED, and the state is carried by
     light rather than by a fill. Only the vessel went. */
  assert.match(btn, /background:none/, 'the Feel options grew a ground again');
  assert.match(btn, /border:0/, 'the Feel options grew a rim again');
  assert.match(btn, /color:#FFFFFF/, 'the resting word is crisp white, as everywhere else');

  const on = rule('.feel-btn.on');
  /* THE WORD IS THE THING LIT. A solid fill with inverted text shouts louder
     than the figures logged above it, and this is the quiet answer at the
     end of a log rather than the headline of one. */
  assert.match(on, /color:var\(--gold-bright\)/, 'the selected feel is no longer gold');
  assert.match(on, /text-shadow:[^;]*rgba\(227,177,90/,
    'the selected feel is no longer lit -- gold alone sits BELOW white in ' +
    'luminance, so colour without illumination makes the chosen one the ' +
    'quietest word in the row');
  /* background:none is not a fill, so the old blanket /background:/ would now
     fail on the very rule that satisfies the law. The thing forbidden is a
     GROUND behind the chosen word, which is what a value other than none is. */
  assert.doesNotMatch(on, /background:\s*(?!none)[^;]+;/,
    'the selected feel fills itself solid again instead of lighting up');
  assert.doesNotMatch(on, /box-shadow:\s*(?!none)[^;]+;/,
    'the gold ring is back around a control that no longer has an edge to ring');

  /* ONE SELECTION COLOUR, NOT A SCALE. Tinting POOR red and V.GOOD green
     would be the app grading an answer the athlete has just given about
     their own body. Feel is reported, not assessed. */
  assert.doesNotMatch(on, /var\(--ok\)|var\(--bad\)|var\(--warn\)/,
    'the feel scale is being colour-graded by the app');
});

/* THE FOUNDER'S HIERARCHY FOR A FINISHED SESSION.
 * ===========================================================================
 *   Session complete
 *   Share
 *   Session Details      -- why / execution / feel / coach's note, and the
 *                           session's own targets, description and steps
 *   Valhalla Analysis    -- the verdict / execution review / next steps
 *   <verdict> · <n>% execution
 *
 * Stated as positions rather than as markup, so the guard survives the next
 * restyle and only fails if the ORDER changes.
 */
test('a finished session leads with what you did, then the two tabs', () => {
  const a = app();
  /* Logged in full, not just a distance. A day with km and no pace cannot be
     scored, so the analysis falls to its unscored prompt instead of the tab
     -- a real branch, and not the one this hierarchy is about. */
  /* A CURRENT-week day. A past week opens its analysis by default -- see
     renderExecutionReview -- so the verdict line is legitimately on screen
     there, and "nothing is loose" could never hold. */
  const cur = a.currentWeekNum();
  const d = a.state.days.filter(x => x.week === cur && x.type !== 'rest')[0];
  assert.ok(d, 'no current-week session in the fixture');
  logAsPrescribed(a, d, { quality: 1 });
  const html = a.renderDayCard(d);
  const at = (re, what) => {
    const i = html.search(re);
    assert.ok(i > -1, what + ' is missing from a completed session');
    return i;
  };
  const done   = at(/actual-done-k">Session complete/,        'the completion statement');
  const share  = at(/sess-tab-k">Share</,                     'the Share tab');
  const detail = at(/sess-tab-k">Session Details</,           'the Session Details tab');
  const anal   = at(/sess-tab-k">Valhalla Analysis</,         'the Valhalla Analysis tab');
  const log    = at(/sess-tab-k">Your Log</,                  'the Your Log tab');
  assert.ok(done < share,   'Share no longer follows the completion statement');
  assert.ok(share < detail, 'Session Details no longer follows Share');
  assert.ok(detail < log,   'Your Log no longer follows Session Details');
  assert.ok(log < anal,     'Valhalla Analysis no longer comes last');

  /* NOTHING IS LOOSE. Everything on a finished session is one of the four
     tabs: the fields, the verdict line and Clear log are all behind one, so
     a card whose tabs are all shut shows the completion statement and four
     rows and nothing else. */
  assert.doesNotMatch(html, /data-field="km"/,
    'the log fields render outside Your Log, so the card ends on a form again');
  assert.doesNotMatch(html, /wc-line/,
    'the verdict line is loose again instead of leading the analysis');
  assert.doesNotMatch(html, /clear-actual/,
    'Clear log is loose at the foot of the card again');
});

test('all four tabs are the same object, drawn from one helper', () => {
  /* They drifted into near-misses once already -- a bordered disclosure
     above a plain text button -- which is why there is a helper at all. If
     either stops using it, they are free to drift again. */
  const src = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
  assert.match(src, /function sessionTabHtml\(title\)/,
    'the shared session tab is gone');
  assert.match(src, /sessionTabHtml\('Session Details'/,
    'Session Details is no longer drawn from the shared tab');
  assert.match(src, /sessionTabHtml\('Valhalla Analysis'/,
    'Valhalla Analysis is no longer drawn from the shared tab');
  assert.match(src, /sessionTabHtml\('Share'/,
    'Share is no longer drawn from the shared tab');
  assert.match(src, /sessionTabHtml\('Your Log'/,
    'Your Log is no longer drawn from the shared tab');
  assert.equal((src.match(/class="sess-tab-k"/g) || []).length, 1,
    'the tab title is emitted in more than one place again');
});

/* WHEN YOUR LOG IS OPEN, AND WHEN IT IS NOT.
 * ===========================================================================
 * Open on a completed session that carries nothing yet -- the athlete has
 * just run, and asking them to press for the box they obviously want is a
 * tap for nothing. Shut everywhere else, because the log is a CORRECTION
 * once there are figures in it.
 *
 * The hard part is the middle. The default is derived from whether the day
 * carries figures, so the first value typed flips it -- and typing does not
 * re-render, so the tab is still open on screen when it does. Press
 * "+ Add detail" next, which DOES re-render, and the tab closes under the
 * athlete's hands. Asking at re-render time cannot fix it: by then the
 * default already says shut. The answer is written down at the moment the
 * tab is drawn open, and dropped again when the session is no longer the one
 * in front of them.
 */
const logDrawn = (a, d) => /class="log-body"/.test(a.renderDayCard(d));

test('Your Log opens on a session with nothing logged, and not otherwise', () => {
  const a = app();
  const d = a.state.days.filter(x => x.type === 'threshold')[0];

  assert.equal(logDrawn(a, d), false, 'an unrun session drew a log tab open');

  d.completed = true; d.actual = a.emptyActual();
  assert.equal(logDrawn(a, d), true,
    'a session just ticked complete makes the athlete press for the empty box');

  delete a.logOpenFor[d.id];
  d.actual.km = 11.5;
  assert.equal(a.isLogOpen(d), false,
    'the derived default still says open once there are figures in it');
});

test('typing does not shut the log the next time the card re-renders', () => {
  /* THE SEQUENCE THAT BROKE. Open the card with nothing logged, type a
     distance -- which only patches -- then press anything that re-renders. */
  const a = app();
  const d = a.state.days.filter(x => x.type === 'threshold')[0];
  d.completed = true; d.actual = a.emptyActual();
  assert.equal(logDrawn(a, d), true, 'it did not open to begin with');
  d.actual.km = 11.5;
  assert.equal(logDrawn(a, d), true,
    'the log shut under the athlete as soon as they typed a figure');
  d.actual.hr = 150;
  assert.equal(logDrawn(a, d), true, 'it shut once the detail was filled in');
});

test('the log is shut again the next time the athlete comes to the session', () => {
  const a = app();
  const d = a.state.days.filter(x => x.type === 'threshold')[0];
  d.completed = true; d.actual = a.emptyActual();
  logDrawn(a, d);                 // drawn open, which records it
  d.actual.km = 11.5;
  a.state.view = 'today';         // the card is no longer the focused session
  a.forgetLogPins();
  assert.equal(logDrawn(a, d), false,
    'the log stayed open on a session the athlete already finished with');
});

test('closing the log on purpose keeps it closed, empty or not', () => {
  /* An explicit false, not a delete -- deleting hands it back to a default
     that says open, and the tab would spring back on the next render. */
  const a = app();
  const d = a.state.days.filter(x => x.type === 'threshold')[0];
  d.completed = true; d.actual = a.emptyActual();
  a.handleToggleLog(d.id);
  assert.equal(a.isLogOpen(d), false, 'it would not close');
  assert.equal(logDrawn(a, d), false, 'it sprang back open on the next render');
});

/* THE ANALYSIS TAB IS THE CONSTANT; WHAT IT OPENS IS NOT.
 * ===========================================================================
 * A session logged with a distance and no pace cannot be scored, and that
 * branch used to return a bare card with no tab at all -- so a card that
 * should have shown four tabs showed three, and the missing one was the one
 * that would have said what was missing.
 */
const tabsOn = (a, d) => [...a.renderDayCard(d).matchAll(/sess-tab-k">([^<]*)</g)].map(m => m[1]);
/* THE SUB IS GONE FROM EVERY TAB -- the founder's call: a row names what
   it opens and a contents list under it is the row describing itself. What
   this helper read no longer exists, so what it returns is the ANALYSIS
   BODY: the panel is where scored and unscored now differ. */
const analysisBody = (a, d) => {
  const c = a.renderDayCard(d);
  const i = c.indexOf('Valhalla Analysis');
  return i < 0 ? '' : c.slice(i).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
};

test('every finished session gets all four tabs, however little is logged', () => {
  const a = app();
  const ds = a.state.days.filter(x => x.type !== 'rest');
  const WANT = ['Share', 'Session Details', 'Your Log', 'Valhalla Analysis'];

  const nothing = ds[0];
  nothing.completed = true; nothing.actual = a.emptyActual();
  assert.deepEqual(tabsOn(a, nothing), WANT, 'a session with nothing logged lost a tab');

  const distOnly = ds[1];
  distOnly.completed = true;
  distOnly.actual = Object.assign(a.emptyActual(), { km: distOnly.km });
  assert.deepEqual(tabsOn(a, distOnly), WANT,
    'a distance-only session lost the analysis tab -- the one that says what is missing');

  const full = ds[2];
  logAsPrescribed(a, full, { quality: 1 });
  assert.deepEqual(tabsOn(a, full), WANT, 'a fully logged session lost a tab');
});

test('the analysis tab does not promise a verdict it has not got', () => {
  /* "The verdict / Execution review / Next steps" on a session with none of
     them is a promise the panel cannot keep. */
  const a = app();
  const ds = a.state.days.filter(x => x.type !== 'rest');

  const distOnly = ds[0];
  distOnly.completed = true;
  distOnly.actual = Object.assign(a.emptyActual(), { km: distOnly.km });
  /* THE PROMISE WAS THE SUB, AND IT WENT WITH IT. This guarded against
     "The verdict . Execution review . Next steps" appearing on a session
     with none of them -- a promise made by the contents list under the tab
     name. With no contents list the tab makes no claim about what is
     inside, so the defect this was written for cannot occur: it is not
     that the promise is now kept, it is that none is made.
     WHAT IS LEFT TO PROTECT is that the panel still tells the two apart,
     and it does -- an unscored session gets the completion assessment and
     not an execution verdict. Worth recording plainly: the CLOSED row no
     longer distinguishes them, which it used to. */
  assert.ok(a.renderDayCard(distOnly).indexOf('sess-tab-s') === -1,
    'the analysis tab is advertising its contents again');
  assert.doesNotMatch(analysisBody(a, distOnly), /Execution Review[\s\S]{0,200}Verdict/,
    'an unscored session is showing an execution verdict it cannot produce');

  const full = ds[1];
  logAsPrescribed(a, full, { quality: 1 });
  assert.match(analysisBody(a, full), /Execution Review/,
    'a scored session stopped showing its execution review');

  /* And opening the unscored one says what would score it. */
  a.analysisOpenFor[distOnly.id] = true;
  assert.match(a.renderDayCard(distOnly), /average pace/,
    'the unscored analysis no longer says what is missing');
});

/* ---------------------------------------------------------------------------
 * A FINISHED RUN LOOKS FINISHED ON EVERY SCREEN
 * ---------------------------------------------------------------------------
 * Founder: "A completed run on today should be moved on this week and full
 * plan. Just the tabs."
 * Today and Full Plan's SESSION screen both build from renderDayCard and so
 * carried the whole stack. This Week and Full Plan's WEEK screen build their
 * day from weekSlideHtml() instead, and carried only the Session Details
 * disclosure -- the same run reading as two different things depending on
 * which way in you took. The panel is one function now and both call it.
 */
function slideApp() {
  const a = loadApp({ pinnedDate: '2026-11-08T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 11, startDate: '2026-09-04', distanceKey: 'full', volume: 46,
    benchSec: 45 * 60, lthr: 165, maxHR: 190,
    schedule: { activeDays: [0, 1, 2, 3, 4, 5, 6], longRunDay: 6 } });
  a.state.athlete = a.makeAthleteRecord();
  return a;
}
const slideTabs = h => (h.match(/sess-tab-k[^>]*>([^<]*)</g) || [])
  .map(x => /> ?([^<]*)</.exec(x)[1]);

test('the week slide carries a finished session’s tabs, in the founder’s order', () => {
  const a = slideApp();
  const d = a.state.days.filter(x => x.type !== 'rest' && x.km > 0)[0];
  logAsPrescribed(a, d, { quality: 1 });
  const slide = a.weekSlideHtml(d, a.state.days.indexOf(d));

  assert.match(slide, /actual-done-k">Session complete/,
    'the week slide does not say the session is complete');
  const tabs = slideTabs(slide);
  assert.deepEqual(tabs, ['Share', 'Session Details', 'Your Log', 'Valhalla Analysis'],
    'the week slide does not carry the finished session’s four tabs in order: ' +
    JSON.stringify(tabs));

  /* ---- ONE SESSION DETAILS, NOT TWO ----
     The slide already built its own disclosure; it is handed to the panel
     as the mount rather than printed beside it. */
  assert.equal((slide.match(/sess-tab-k[^>]*>Session Details</g) || []).length, 1,
    'the slide prints Session Details twice');

  /* ---- "JUST THE TABS" ----
     Today wraps the panel in things that are Today's business, and the
     instruction was explicit that only the tabs come across. */
  assert.doesNotMatch(slide, /Hear what’s next|Hear What’s Next/i,
    'the slide grew Today’s voice button');
  assert.doesNotMatch(slide, /can still help with what’s next/i,
    'the slide grew Today’s Ask Coach caveat');
});

test('every shape of finished session gets the same four tabs on the slide', () => {
  /* SWEPT, BECAUSE ONE DAY IS NOT THE CLAIM. The first version of this
     change passed a single-day check while being wrong on two days in
     eight: a completed NON-SOLO BLUEPRINT session got three tabs, not four.
     renderCoachingDepth only builds the Session Details tab when it is
     handed a preamble to put behind it, and the slide was calling it with
     none -- so the rail sat loose above the panel and the tab that should
     have held it did not exist. A solo-note day hid the gap, because its
     disclosure builds the tab from its own body instead.
     So every completed day in the block is asked, and the shapes are
     counted to make sure the sweep contains the one that broke. */
  const a = slideApp();
  const want = ['Share', 'Session Details', 'Your Log', 'Valhalla Analysis'];
  let solo = 0, blueprint = 0, other = 0;
  a.state.days.forEach(d => {
    if (d.type === 'rest' || !(d.km > 0) || d.type === 'race') return;
    logAsPrescribed(a, d, { quality: 1 });
    const slide = a.weekSlideHtml(d, a.state.days.indexOf(d));
    const tabs = slideTabs(slide);
    assert.deepEqual(tabs, want,
      d.date + ' (blueprint=' + (a.hasWorkoutBlueprint(d) ? 1 : 0) +
      ', solo=' + (a.soloNoteSession(d) ? 1 : 0) + '): the finished slide shows ' +
      JSON.stringify(tabs));
    /* AND THE PRESCRIPTION IS BEHIND THE TAB, not loose above it -- the day
       card's own rule once a session is reference. */
    const ws = slide.indexOf('ws-block'), panel = slide.indexOf('actual-panel');
    if (ws > -1) assert.ok(ws > panel,
      d.date + ': the rail is still loose above the completion panel');
    if (a.soloNoteSession(d)) solo++;
    else if (a.hasWorkoutBlueprint(d)) blueprint++;
    else other++;
  });
  assert.ok(solo >= 3 && blueprint >= 3 && other >= 1,
    'the sweep saw ' + solo + ' solo, ' + blueprint + ' blueprint and ' + other +
    ' other finished sessions \u2014 it no longer covers the shape that broke');
});

test('an unrun day on the week slide is untouched by any of it', () => {
  const a = slideApp();
  const d = a.state.days.filter(x => x.type !== 'rest' && x.km > 0 && !x.completed &&
    x.date > a.todayStr())[0];
  assert.ok(d, 'the fixture has no unrun day ahead');
  const slide = a.weekSlideHtml(d, a.state.days.indexOf(d));
  assert.equal(slide.indexOf('actual-panel'), -1,
    'an unrun session is showing a completion panel');
  assert.doesNotMatch(slide, /Session complete/, 'an unrun session says it is complete');
});

test('the finished panel is one function, and its ids are unique on the week screen', () => {
  /* THE SLIDE IS NOT THE ONLY COPY. This Week keeps the canonical
     renderDayCard inside .wk-full behind the carousel, so every id the
     panel carries existed twice the moment the slide grew one -- measured
     before the fix: share-inline-2026-11-02 and exec-review-2026-11-02,
     both doubled. getElementById returns the first, which is the hidden
     one, so Share opened into a card nobody could see and the visible
     analysis never refreshed. Same failure the ring gradient and the
     execution captions had on this same slide, fixed the same way. */
  const a = slideApp();
  a.state.days.filter(x => x.date < a.todayStr() && x.type !== 'rest')
    .forEach(d => logAsPrescribed(a, d, { quality: 1 }));
  const cur = a.currentWeekNum();
  const done = a.state.days.filter(x => x.week === cur && x.completed)[0];
  assert.ok(done, 'the fixture has no completed day in the current week to select');
  if (a.handleWeekPickDay) a.handleWeekPickDay(done.date);

  const html = a.renderWeekView();
  assert.ok((html.match(/actual-panel/g) || []).length >= 2,
    'the week screen is not showing the panel in both places, so this proves nothing');
  const ids = (html.match(/\sid="([^"]+)"/g) || []).map(x => /id="([^"]+)"/.exec(x)[1]);
  const seen = {}, dup = [];
  ids.forEach(i => { if (seen[i]) dup.push(i); seen[i] = true; });
  assert.deepEqual(dup, [], 'the week screen has duplicate ids: ' + dup.join(', '));

  /* AND EVERY COPY IS STILL REACHABLE BY ITS PATCH. Suffixing the ids would
     be a silent way to make the slide's analysis unpatchable, so the hook
     patchExecutionUI actually reads is counted instead. */
  const hooks = (html.match(/data-exec-review="/g) || []).length;
  assert.ok(hooks >= (html.match(/actual-panel/g) || []).length,
    'only ' + hooks + ' execution mounts carry the hook their patch reads');
});
