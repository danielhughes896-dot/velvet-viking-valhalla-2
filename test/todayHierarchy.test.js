'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* TODAY: EVERY CONCEPT ONCE, IN ITS BEST HOME
 * ===========================================================================
 * Today was rich and repetitive at the same time. One concept -- why an easy
 * run is easy -- appeared on three surfaces in three registers:
 *
 *   NEXT MOVE          "Today is about banking aerobic time cheaply..."
 *   HOW TO RUN / WHY   "Aerobic base, and freshness for the hard days."
 *   HEAR TODAY         read the Next Move line aloud, verbatim
 *
 * The cause was that Next Move LED with coachIntentLine() -- the generic
 * purpose of the session archetype. That is a real coaching fact and it is
 * not a fact about TODAY, and it already has a home in the disclosure.
 *
 * THE RESPONSIBILITIES NOW:
 *   NEXT MOVE   why this session, for this athlete, today
 *   DISCLOSURE  what the session is for, and how to execute it
 *   HEAR TODAY  a spoken briefing, not either of the above read out
 *
 * Nothing was deleted. The generic purpose still leads Next Move when there is
 * no adaptive context to lead with, because an empty card is not a
 * simplification.
 */

const TODAY = '2026-08-24';
const TYPES = ['easy','long','tempo','threshold','interval','repetition','checkpoint','race'];
const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');

function app(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.scheduleSave = () => {}; a.flushSave = () => {};
  buildPlan(a, { weeks: 14, startDate: '2026-07-01', distanceKey: '10k', volume: 40,
                 schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } });
  a.voiceSetAvailable(true);
  return a;
}
const firstOf = (a, t) => a.state.days.filter(d => d.type === t)[0];
/* THE CARD ONLY RENDERS FOR TODAY. voiceMayRender() refuses any day whose
   date is not todayStr(), so a render assertion driven off firstOf() would
   be asserting against an empty string and would pass whatever the code did.
   Every render test below uses the day the app is actually pinned to. */
const todayDay = (a) => a.state.days.filter(d => d.date === a.todayStr())[0];
const nextMove = (a, dd) => ((a.coachBrief(dd) || {}).paragraphs || []);
function eachType(a, fn){ TYPES.forEach(t => { const dd = firstOf(a, t); if (dd) fn(dd, t); }); }

// ---------------------------------------------------------------------------
// NEXT MOVE: adaptive context leads, and the card is never empty
// ---------------------------------------------------------------------------
test('adaptive context leads Next Move, and the generic purpose steps aside', () => {
  const a = app();
  const dd = firstOf(a, 'easy');
  const intent = a.coachIntentLine(dd);
  a.coachReadinessLine = () => 'This week is well above your recent average, so today is not the day to add anything to it.';
  const paras = nextMove(a, dd);
  assert.match(paras[0], /well above your recent average/, 'the adaptive line did not lead');
  assert.ok(paras.join(' ').indexOf(intent) === -1,
    'the generic purpose was repeated alongside the adaptive context');
});

test('with no adaptive context, Next Move still says something concrete', () => {
  /* An empty card is not a simplification. */
  const a = app();
  eachType(a, (dd, t) => {
    const paras = nextMove(a, dd);
    assert.ok(paras.length, t + ': Next Move was hollowed out to nothing');
    assert.ok(!a.voiceIsLabelled(paras[0]), t + ': Next Move led with a status label');
  });
});

test('Next Move never leads with evidence-status furniture', () => {
  const a = app();
  eachType(a, (dd, t) => {
    const paras = nextMove(a, dd);
    assert.ok(!/^Insufficient evidence/.test(paras[0]),
      t + ': a status note was promoted to the lead');
  });
});

// ---------------------------------------------------------------------------
// THE DISCLOSURE KEEPS ITS OWN CONCEPTS
// ---------------------------------------------------------------------------
test('the disclosure still carries why, execution, feel and watch-for for every type', () => {
  /* Audited rather than assumed: these four are distinct for every authored
     session type, which is why they were NOT collapsed into three. */
  const a = app();
  eachType(a, (dd, t) => {
    const gd = a.coachingDisclosureFor(dd, a.athleteExperience(a.state.setup));
    assert.ok(gd, t + ': no disclosure at all');
    ['why', 'how', 'feel', 'avoid'].forEach(f =>
      assert.ok(gd[f] && String(gd[f]).trim(), t + ': disclosure lost its ' + f));
  });
});

test('the four disclosure rows say four different things', () => {
  const a = app();
  eachType(a, (dd, t) => {
    const gd = a.coachingDisclosureFor(dd, a.athleteExperience(a.state.setup));
    const seen = {};
    ['why', 'how', 'feel', 'avoid'].forEach(f => {
      const v = String(gd[f]).toLowerCase().replace(/[^a-z ]/g, '').trim();
      assert.ok(!seen[v], t + ': two disclosure rows are the same sentence');
      seen[v] = true;
    });
  });
});

// ---------------------------------------------------------------------------
// HEAR TODAY IS NOT NEXT MOVE READ ALOUD
// ---------------------------------------------------------------------------
test('the spoken briefing is not the Next Move paragraph narrated', () => {
  /* THE MEASURED DEFECT. Before this pass the briefing ended with
     coachBrief()'s first paragraph verbatim, and with no adaptive context that
     paragraph IS coachIntentLine() -- so for all eight types the last thing
     the athlete heard was, byte for byte, the paragraph on the screen in front
     of them. */
  const a = app();
  eachType(a, (dd, t) => {
    const said = a.voiceScriptText(a.voiceBriefingScript(dd));
    nextMove(a, dd).forEach(p => {
      assert.ok(said.indexOf(p) === -1,
        t + ': the briefing narrates a Next Move paragraph verbatim -- ' + p);
    });
    /* Concept kept, register changed: the authored spoken purpose is still
       there, so nothing was deleted to achieve the above. */
    const authored = a.VOICE_SPOKEN[t];
    if (!authored) return;
    assert.ok(said.indexOf(a.voiceSpeakable(authored.cue)) !== -1,
      t + ': the briefing is not speaking its authored cue');
    assert.ok(said.indexOf(a.voiceSpeakable(authored.purpose)) !== -1,
      t + ': the briefing lost the purpose entirely -- that is deletion, not de-duplication');
  });
});

test('adaptive context is spoken, because no authored sentence can carry it', () => {
  /* De-duplication must not cost a listening athlete today's most important
     fact. Where coachBrief() leads with something the archetype cannot know,
     the briefing speaks THAT rather than the authored purpose. */
  const a = app();
  const line = 'This week is well above your recent average, so today is not the day to add anything to it.';
  a.coachReadinessLine = () => line;
  eachType(a, (dd, t) => {
    const said = a.voiceScriptText(a.voiceBriefingScript(dd));
    assert.ok(said.indexOf(a.voiceSpeakable(line)) !== -1,
      t + ': the adaptive readiness line never reached the ear');
  });
});

test('race says one coaching truth twice, not one sentence twice', () => {
  /* FOUNDER DECISION. The authored spoken race purpose was a punctuation
     variant of the written one, so an athlete who opened the disclosure AND
     played the briefing on race day met the same sentence twice. The spoken
     side was rewritten; the WRITTEN purpose is deliberately unchanged. Two
     presentations of one coaching truth -- not two coaching decisions. */
  const a = app();
  const dd = firstOf(a, 'race');
  const written = a.coachIntentLine(dd);
  const spoken = a.VOICE_SPOKEN.race.purpose;
  assert.match(written, /Everything from here is execution/,
    'the written race purpose was changed -- it must not be');
  /* No sentence of one may be a sentence of the other, punctuation aside. */
  const sentences = (x) => String(x).split(/(?<=[.!?\u2014])\s+/)
    .map(t => t.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' '))
    .filter(t => t.split(' ').length >= 5);
  const w = sentences(written);
  sentences(spoken).forEach(t => assert.ok(w.indexOf(t) === -1,
    'race still says the same sentence on both surfaces: ' + t));
  /* And the concept survived: the block is finished, so execute it. */
  assert.match(spoken, /work is done|trust the training|execute/i,
    'the race purpose lost its coaching meaning');
});

test('the briefing still says the prescription and the watch-for', () => {
  const a = app();
  eachType(a, (dd, t) => {
    const said = a.voiceScriptText(a.voiceBriefingScript(dd));
    const dist = a.voiceSpokenDistance(dd.km);
    if (dist) assert.ok(said.indexOf(a.voiceSpeakable(dist)) !== -1,
      t + ': the briefing dropped how far');
  });
});

// ---------------------------------------------------------------------------
// THE TRANSCRIPT, AND THE IMPLEMENTATION NOTE
// ---------------------------------------------------------------------------
test('the briefing is on screen from the moment HEAR TODAY is pressed', () => {
  /* FOUNDER REVERSAL, FROM LIVE DEVICE TESTING. This pass originally hid the
     transcript while the coach was speaking and revealed it only once playback
     ENDED -- to stop Today carrying a third copy of the same coaching. On the
     phone that read as a defect: the words the athlete was listening to were
     nowhere on screen until the coach had finished saying them. The card now
     opens on the press, at the same moment speech starts.
     The rest of this file's hierarchy work is unaffected -- see
     test/hearTodayTiming.test.js for the timing guarantee itself. */
  const a = app();
  const dd = todayDay(a);
  a.state.view = 'today';
  a.voiceSetStatus('speaking', { kind: 'briefing', dayId: dd.id });
  const html = a.renderVoiceCard(dd);
  assert.match(html, /class="voice-said"/,
    'the briefing is hidden while it is being spoken');
  assert.match(html, /Playing briefing/, 'there is no feedback that it is playing');
});

test('a screen reader still receives every spoken word', () => {
  /* The guarantee did not change, only where it is attached: the briefing used
     to be announced from a visually-hidden twin, and is now announced from the
     block the athlete can also read. A second copy would make a screen reader
     say the whole briefing twice. */
  const a = app();
  const dd = todayDay(a);
  a.state.view = 'today';
  a.voiceSetStatus('speaking', { kind: 'briefing', dayId: dd.id });
  const html = a.renderVoiceCard(dd);
  assert.match(html, /class="voice-said" role="status" aria-live="polite"/,
    'the briefing is not exposed to assistive technology');
  const script = a.voiceScriptFor(dd);
  script.lines.forEach(l =>
    assert.ok(html.indexOf(l.replace(/&/g, '&amp;').replace(/</g, '&lt;')) !== -1 ||
              html.indexOf(l) !== -1, 'a spoken line is missing from the card'));
  assert.equal((html.match(/aria-live/g) || []).length, 1,
    'the briefing is announced twice -- the hidden twin was left behind');
  assert.ok(!/class="voice-live"/.test(html),
    'the visually-hidden copy is still rendered alongside the visible one');
});

test('a device that cannot speak still shows the words', () => {
  /* Where the words ARE the feature, the transcript remains visible. */
  const a = app();
  const dd = todayDay(a);
  a.state.view = 'today';
  a.voiceSetStatus('shown', { kind: 'briefing', dayId: dd.id });
  assert.match(a.renderVoiceCard(dd), /class="voice-said"/,
    'a device with no synthesiser lost the briefing entirely');
});

test('the guidance-level implementation note is gone from Today', () => {
  const a = app();
  const dd = todayDay(a);
  a.state.view = 'today';
  a.setGuidanceLevel('adaptive');
  a.voiceSetStatus('speaking', { kind: 'briefing', dayId: dd.id });
  const html = a.renderVoiceCard(dd);
  /* Guard the guard: an empty card would satisfy every absence assertion
     below without the code doing anything. */
  assert.match(html, /voice-row/, 'the card did not render, so absence proves nothing');
  assert.ok(!/Fuller detail/.test(html), 'the adaptive-reason line is still on Today');
  assert.ok(!/class="voice-why"/.test(html), 'the adaptive-reason element is still rendered');
});

test('Guidance Level itself is unchanged', () => {
  /* Only the surfacing was removed -- the rule still resolves as before. */
  const a = app();
  const dd = firstOf(a, 'easy');
  a.setGuidanceLevel('adaptive');
  assert.ok(['full', 'concise'].indexOf(a.resolvedGuidanceLevel(dd)) !== -1);
  assert.equal(typeof a.guidanceAdaptiveReason, 'function',
    'the reason function was deleted rather than just unsurfaced');
});

/* ===========================================================================
 * THE COACH BUTTONS SAY THEIR WORDS IN WHITE
 * ---------------------------------------------------------------------------
 * Founder: "The words hear today and ask coach. Bright white bold. Keep
 * everything else the boarder the same."
 * The cherry pass gave these two the accent whole -- rim, glow and label. The
 * label is the part that has to be read rather than recognised, so it comes
 * back to white; everything the founder named as staying stays.
 * ===========================================================================
 */
test('the coach buttons read white, and only the words moved', () => {
  const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
  const m = /\.voice-row \.voice-btn\{([^}]*)\}/.exec(CSS);
  assert.ok(m, 'the coach button rule is gone');
  const r = m[1];
  /* THE WORDS. --cherry-btn-ink is the token that already means white ink on
     a cherry control; a raw #FFFFFF here would be a second white with no
     name, which is how two controls come to disagree about one colour. */
  assert.match(r, /color:var\(--cherry-btn-ink\)/,
    'the coach button labels are not white');
  assert.doesNotMatch(r, /color:var\(--cherry-text\)/,
    'the labels are still the accent-as-text');
  assert.match(r, /font-weight:700/, 'the labels are no longer bold');
  /* AND EVERYTHING THE FOUNDER SAID TO KEEP. Asserted here because "keep
     everything else the same" is the half of the instruction a colour change
     is most likely to break in passing. */
  assert.match(r, /border:1\.5px solid var\(--cherry\)/, 'the cherry rim moved');
  assert.match(r, /box-shadow:0 0 16px var\(--cherry-dim\)/, 'the glow moved');
  assert.match(r, /background:#121316/, 'the fill moved');
  /* The token itself is white, so the rule above means what it says. */
  assert.match(CSS, /--cherry-btn-ink:#FFFFFF/i,
    '--cherry-btn-ink is no longer white, so the labels are not either');
});

/* ===========================================================================
 * A REST DAY'S COACH'S NOTE CLEARS THE RING
 * ---------------------------------------------------------------------------
 * Founder: "Rest day coaches note appears very close to the hero? Easy
 * aerobic is good for reference."
 * Measured at 412: the easy aerobic's note is the [data-solo] kind and opens
 * 24px below the hero's bottom edge. A rest day's note is the plain .how-note
 * with no top margin at all, and .day-detail starts at that same edge -- so
 * the note's border sat 10px under the ring. Hero bottom 211, note top 211.
 * ===========================================================================
 */
test('a rest day note takes the same clearance the reference surface has', () => {
  const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
  /* THE REFERENCE FIRST, so the number below is anchored to the thing the
     founder pointed at rather than typed from memory. If the solo note ever
     moves, this fails and the two are reconciled deliberately. */
  const solo = /\.how-note\[data-solo\]\{([^}]*)\}/.exec(CSS);
  assert.ok(solo, 'the solo note rule is gone, so there is no reference left');
  const top = /margin:(\d+)px/.exec(solo[1]);
  assert.ok(top, 'the solo note no longer declares a top margin');
  assert.equal(top[1], '24', 'the reference clearance moved and the rest day did not follow');

  const rest = /\.th-hero-rest \+ \.day-detail > \.how-note:not\(\[data-solo\]\)\{([^}]*)\}/.exec(CSS);
  assert.ok(rest, 'the rest day note has gone back to sitting on the hero');
  assert.equal((/margin-top:(\d+)px/.exec(rest[1]) || [])[1], top[1],
    'the rest day clears the hero by a different amount than the reference');

  /* AND IT IS A REST DAY THAT GETS IT. .th-hero-rest is written by the hero
     renderer for exactly that case, so the selector cannot quietly widen to
     every day with a hero. */
  assert.match(SRC, /isRest\s*\?\s*' th-hero-rest'\s*:\s*''/,
    'the rest hero no longer marks itself, so the rule above matches nothing');
});

/* ===========================================================================
 * A REST DAY IS A DAY IN THE PLAN, SO IT LOOKS AND READS LIKE ONE
 * ---------------------------------------------------------------------------
 * Today opened on a rest day with two chips and a line of stage directions.
 * Three things were wrong and all three were holes rather than decisions:
 * the hero returned '' for any day with no ring and no distance; the cue
 * written for rest days was computed BELOW the early return that sends rest
 * days home, so nothing could ever read it; and the description said in
 * stage directions what the coaching says better.
 *
 * Measured on Today at 412px, rest against a long run and an easy run:
 *   title   Oswald 21.85px/600, 26.22px line box, x=20   -- identical
 *   y        136 / 136 / 136                             -- identical
 *   hero h   158 / 158 / 158                             -- identical
 * and across widths: 320 and 360 (the stacked layout) 107/107/107 and
 * 109/109/109; 361, 412 and 430 all equal. At 361 the EASY day's title sits
 * higher because "Pre-Goal Shakeout" wraps to two lines there -- content
 * length, not alignment, and a rest day with a wrapping title does the same.
 * ======================================================================== */

const CSS_ALL = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
const CSS_BARE = CSS_ALL.replace(/\/\*[\s\S]*?\*\//g, '');
const restDay = a => a.state.days.filter(d =>
  d.type === 'rest' && a.displayCardTitle(d) === 'Rest Day')[0];

test('a rest day has the run day’s title AND its ring', () => {
  const a = app();
  const dd = restDay(a);
  assert.ok(dd, 'sanity: the fixture has a plain rest day');
  const hero = a.renderDayHeroBlock(dd, a.getDayTargets(dd));
  assert.match(hero, /th-hero-title">Rest Day</, 'the rest day has lost its title again');
  assert.match(hero, /th-hero-rest/, 'the rest hero is unmarked, so it cannot reserve anything');

  /* THE RING IS REAL NOW. It was reserved space with nothing drawn in it,
     which made the rest day the same SHAPE as a run day rather than the
     same thing. A rest day has no pace and no band -- it has one
     instruction, and the ring is where this card states what the session
     is aimed at, so the instruction goes in it. The arc is the ordinary
     one: a rest day is a prescribed session like any other, and a
     different ring would say it is a different KIND of day. */
  assert.match(hero, /th-ring-wrap/, 'the rest day has lost its ring');
  assert.match(hero, /th-row th-row-rest">Full rest</, 'the ring no longer carries the day’s instruction');
  assert.match(hero, /class="th-arc"/, 'the rest ring is drawn differently from every other day’s');

  /* AND NOT EVERY type:'rest' DAY GETS IT. An optional run carries the same
     type and is the opposite instruction -- a run is available on it -- so
     "Full rest" on its ring would be the card contradicting its own offer.
     This shipped to the suite once and three guards in optionalRunProduct
     and optionalRunCard caught it. */
  const opt = a.state.days.filter(d => d.type === 'rest' && a.optionalRunDayState(d))[0];
  if (opt) assert.ok(a.renderDayHeroBlock(opt, a.getDayTargets(opt)).indexOf('Full rest') === -1,
    'an optional run is telling the athlete to rest fully on the same card that offers them a run');

  /* A DAY THAT IS NOT REST AND HAS NEITHER still renders nothing, which is
     what this function did for everything before the rest case existed. */
  const ghost = Object.assign({}, dd, { type: 'easy', km: 0 });
  assert.equal(a.renderDayHeroBlock(ghost, { }), '',
    'the empty-hero return has been widened past rest days');
});

test('the rest hero reserves the real figure, not a number for its height', () => {
  /* The first attempt reserved --th-dist-size (the figure's font-size at
     line-height 1) through a ::after, and landed the title 4px low: .th-dist
     is a BASELINE-ALIGNED flex row and the unit's <em> descends below the
     number's baseline -- 65px measured against 57.6px accounted for. A
     second constant for the descent would have been a number copied out of
     a measurement. An emptied .th-dist is sized by the rules that size the
     real one, so it is exact now and stays exact if either clamp moves. */
  const a = app();
  const hero = a.renderDayHeroBlock(restDay(a), a.getDayTargets(restDay(a)));
  assert.match(hero, /class="th-dist th-dist-hold" aria-hidden="true"/,
    'the rest hero no longer reserves the figure, or no longer hides it from a screen reader');
  assert.match(hero, /th-dist-hold[^>]*><span> <\/span><em> <\/em>/,
    'the reserve is no longer an EMPTY copy of the real figure — it must carry no invented number, ' +
    'and must keep both cells so the unit’s descent is reserved with the number');

  assert.match(CSS_BARE, /\.th-dist-hold\{visibility:hidden;\}/,
    'the reserve is no longer visibility:hidden — display:none would stop it reserving anything');

  /* BOTH RESERVES COME FROM THE RULES THAT DRAW THE THINGS, not from the
     screenshot they were measured on, which is what makes them hold at
     every width rather than at 412px. */
  assert.match(CSS_BARE, /\.th-ring\{--th-ring-size:clamp\(/, 'the ring no longer states its size as a token');
  assert.match(CSS_BARE, /\.th-dist\{--th-dist-size:clamp\(/, 'the figure no longer states its size as a token');
  /* THE RING'S RESERVE IS GONE because the ring is drawn. What is left to
     reserve is the figure, and only the figure: a rest day has no distance
     and never will, and that space is what puts its title on a run day's
     line. */
  assert.ok(!/\.th-hero-rest\{[^}]*min-height/.test(CSS_BARE),
    'the rest hero reserves the ring’s height again, on top of a ring that is now really there');
});

test('the reserve holds at every width', () => {
  /* It used to come off below 360, because the rest hero ALSO reserved the
     ring's height and the two together pushed the title below a run day's
     in the stacked layout. The ring is drawn now, that reserve is gone, and
     in a column the title is first either way -- so the figure's reserve
     moves nothing, and keeping it makes the stacked hero the same height as
     a run day's instead of 55px shorter.
     Measured across the breakpoint, rest / long / easy:
        320  title 107/107/107   hero 224/224/224
        360  title 109/109/109   hero 240/240/240
        412  title 136/136/136   hero 158/158/158
     (At 361 the EASY title sits higher because "Pre-Goal Shakeout" wraps to
     two lines there -- content length, and a rest day whose title wrapped
     would do the same.)
     THERE ARE TWO @media (max-width:360px) BLOCKS in this sheet and the
     first does not stack the hero, so the block is found by the rule it
     must contain and walked back to its own query. */
  const stack = CSS_BARE.indexOf('.th-hero{flex-direction:column;}');
  assert.ok(stack > -1, 'the hero no longer stacks at any width, so this guard is measuring nothing');
  const i = CSS_BARE.lastIndexOf('@media (max-width:360px){', stack);
  assert.ok(i > -1, 'the hero stacks outside the 360px breakpoint now');
  const block = CSS_BARE.slice(i, CSS_BARE.indexOf('\n  }', stack));
  assert.ok(!/\.th-dist-hold/.test(block),
    'the figure reserve is switched off in the stacked layout again, which makes the rest hero shorter than a run day\u2019s');
  assert.ok(!/\.th-hero-rest/.test(block),
    'the rest hero is overridden in the stacked layout again');
});

test('a rest day is coached, and says it once', () => {
  const a = app();
  const dd = restDay(a);
  const card = a.renderDayCard(dd);
  const restLine = a.coachingEntryFor(dd).cue;
  assert.ok(restLine && restLine.length > 20, 'the rest day resolved no coaching at all');

  /* The cue was written for rest days and has been in the product all
     along; it was computed below the early return that sends rest days
     home, so nothing could reach it. */
  /* THE REST CUE IS CONTEXTUAL NOW, so this asks for the line this day
     actually resolves to rather than one particular sentence. A rest day in
     Base and a rest day in Taper are explaining different things on purpose
     -- that is the repetition fix. What the law still protects is that the
     rest day IS coached, in both positions, from the rest pool. */
  assert.ok(new RegExp('class="how-note"[\\s\\S]{0,200}' + a.escapeHtml(restLine).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).test(card),
    'the rest day has lost its Coach’s Note');
  /* BOTH POSITIONS, ONE STRING -- the pattern a run day already uses, and
     the reason this needed no new CSS: .how-note is hidden outside a
     focused session and .coach-cue-inline is hidden inside one. */
  assert.ok(new RegExp('coach-cue-inline[\\s\\S]{0,400}' + a.escapeHtml(restLine).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).test(card),
    'the rest day no longer carries the inline cue, so This Week and Full Plan show nothing');

  /* AND THE STAGE DIRECTIONS GO. "Full rest. Legs up, hydrate" said in
     instructions what the note says as coaching. */
  assert.ok(card.indexOf('day-desc') === -1, 'the rest day is printing a description again, above a note that says it better');
  assert.ok(card.indexOf('Legs up') === -1, 'the rest day description is back');
  /* "Full rest" is not gone -- it MOVED. It is the ring's one row now,
     which is where this card states what a session is aimed at. What went
     is the paragraph of stage directions it used to open. */
  assert.equal((card.match(/Full rest/g) || []).length, 1,
    'the rest instruction is not in exactly one place');

  /* A NOVICE'S REST DAY TAKES THE OTHER PATH through renderCoachingDepth --
     the early return is gated on level!=='novice', so a novice falls all
     the way through to where coachingDisclosureFor() returns nothing for a
     rest day at any level. Without a second answer there it ends with the
     inline cue alone: the same hole by another route, and the first
     mutation run proved no guard here exercised it. */
  const n = app();
  /* athleteExperience() reads state.setup.experience, NOT state.athlete --
     the first version of this guard set the wrong field, found the level
     was not novice and skipped its own assertion, so it passed while the
     novice path stayed unexercised. The level is asserted before it is
     used; a guard that can pass by doing nothing is not a guard. */
  n.state.setup.experience = 'novice';
  assert.equal(n.athleteExperience(), 'novice', 'the fixture is not novice, so this guard proves nothing');
  const nRest = restDay(n), nLine = n.coachingEntryFor(nRest).cue;
  assert.ok(new RegExp('class="how-note"[\\s\\S]{0,200}' + n.escapeHtml(nLine).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).test(n.renderCoachingDepth(nRest)),
    'a novice\u2019s rest day has no Coach\u2019s Note — it reaches the coaching by a different path');

  /* An OPTIONAL RUN is type 'rest' too, and its headline is the one line on
     that card saying a run is available. It is not the line that went. */
  const opt = a.state.days.filter(d => d.type === 'rest' && a.displayCardTitle(d) === 'Optional Run')[0];
  if (opt) assert.match(a.renderDayCard(opt), /day-desc/,
    'the optional run lost its headline with the rest description — that line says a run is available');
});
