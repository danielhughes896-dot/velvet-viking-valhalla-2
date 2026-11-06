'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THE READING, THE RACE OUTLOOK, AND THE ACTION TRIO.
 *
 * The rest of Plan HQ, held to the same three promises THE RECORD is held to:
 * the cards are destinations rather than accordions, the panels host what
 * already existed rather than reimplementing it, and nothing on the screen
 * claims more than the engine underneath it knows.
 *
 * WHAT THESE TESTS ARE ACTUALLY PROTECTING
 *
 *  - THE READING is the five interpretations the coaching engine already
 *    produces, with the engine's own status words and the engine's own tone.
 *    A Reading card MAY carry a verdict and a status colour; that is exactly
 *    what separates it from a Record card, and both rules are asserted.
 *  - Every one of the eleven Plan HQ panels goes through one opener, has one
 *    Cherry Lacquer full-width BACK, one circular X, no build-stage rail, and restores
 *    the scroll offset it was opened from.
 *  - THE RACE OUTLOOK is drawn from measuredFitnessEstimate() and the active
 *    goal, and from nothing else. An ordinary training run cannot move it; a
 *    benchmark cannot move it; a goal cannot move the band. Where there is no
 *    measurement it says so and draws no band, and where the engine withholds
 *    (a marathon without the volume behind it) it repeats the engine's reason.
 *  - All three trio tiles fire distinct, handled actions with real
 *    destinations behind them.
 */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const PINNED = '2026-03-10T09:00:00Z';
/* A block that STARTED SEVEN WEEKS AGO, so there is training behind the
   athlete as well as ahead of them AND the mid-block Fitness Checkpoint has
   already come round. buildPlan() defaults to starting today, which leaves
   nothing loggable, no measurement, and every one of these readings empty. */
function planHQ(opts) {
  const a = loadApp({ pinnedDate: PINNED });
  const started = a.addDays(a.todayStr(), -49);
  buildPlan(a, Object.assign({ distanceKey: 'half', volume: 45, weeks: 12,
                               startDate: started }, opts || {}));
  a.state.view = 'planhq';
  return a;
}
// An athlete a third of the way in, with everything behind them logged and the
// mid-block checkpoint run and recorded through the app's own path.
// Sessions are logged AT THE PACE THEY WERE PRESCRIBED, read back out of the
// engine -- a hard-coded pace scores against whatever zone the day happened to
// be and makes "well executed" mean nothing.
function withHistory(a) {
  const today = a.todayStr();
  a.state.days.forEach(dd => {
    if (dd.type === 'rest' || dd.date >= today) return;
    const tgt = a.getTargetPaceRangeSecPerKm(dd);
    const mid = tgt && tgt.fast != null ? Math.round((tgt.fast + tgt.slow) / 2) : 320;
    dd.completed = true;
    dd.actual = { km: dd.km, pace: a.secToPace(mid), hr: 148, rpe: 5, feel: 'good', notes: '' };
    if (dd.type === 'race' || dd.type === 'checkpoint') a.recordMeasuredPerformance(dd);
  });
  return a;
}
/* The Reading's destinations are the circles on Valhalla now -- the Coach
   tab's list of rectangular rows is gone, and with it the one screen that
   restated what the circles already said. Same action, same panels; a
   different element carries them. */
function readingCards(html) {
  /* The COLUMN, not the button. A Reading circle is the instrument plus the
     name of the instrument, and the name moved out of the face and under the
     circle (it had 46px of a 66px face to live in, which is what forced it
     to 6.4px). Matching only the <button> would capture the circle and call
     the title missing -- which is exactly what it did. */
  // Anchored on the title, not on a closing tag: the column nests spans, so
  // a lazy match to the first '</span></span>' stops inside the face.
  return (html.match(/<span class="b-dial-col">[\s\S]*?<span class="rd-cat">[^<]*<\/span><\/span>/g) || [])
    .filter(c => c.indexOf('data-action="open-reading"') !== -1);
}

// ===========================================================================
// 1. THE READING'S CARDS
// ===========================================================================
/* FOUR CIRCLES AND THE GAUGE. Readiness held the centre of the arc while
   the hero gauge directly above it was showing the same number off the same
   field -- both read report.confidence. The duplication was deliberate once:
   the centre is where the graduation puts the reading that matters most, and
   this is that reading. But it spent the arc's strongest position restating
   a number the athlete had just looked at, so the circle went and the gauge
   became the door to the readiness panel instead. What this test is FOR is
   unchanged and is asserted below in full: nothing the engine interprets can
   be undisplayable. It is only the count that moved. */
test('READING: every interpretation the engine produces is reachable', () => {
  const a = withHistory(planHQ());
  const html = a.renderPlanHQView();
  const cards = readingCards(html);
  assert.equal(cards.length, 4, 'expected four Reading circles, found ' + cards.length);

  const keys = cards.map(c => (c.match(/data-reading="([^"]+)"/) || [])[1]);
  // Laid out from the arc's outside in, which is the reading order the
  // graduation is for -- not the order readingSections() happens to build in.
  assert.equal(keys.join(','), 'recovery,evolution,patterns,adaptation');
  // Readiness is still one of the engine's sections and still has to be
  // openable. Its door is the gauge that was already showing it.
  const gaugeTag = (html.match(/<button[^>]*class="gauge-wrap"[^>]*>/) || [])[0] || '';
  assert.ok(gaugeTag, 'the confidence gauge is not a button at all');
  assert.match(gaugeTag, /data-action="open-reading"/,
    'readiness lost its circle and the gauge did not become its door');
  assert.match(gaugeTag, /data-reading="readiness"/,
    'the gauge opens something other than the readiness panel');
  // The SET is still the engine's, not a list typed twice -- the circles
  // plus the gauge, which is the whole of what the screen can reach.
  assert.equal(keys.concat('readiness').sort().join(','),
    a.readingSections(a.coachAnalyse()).map(s => s.key).sort().join(','));

  cards.forEach(c => {
    assert.match(c, /class="rd-cat"/, 'a Reading circle carries no title');
    assert.match(c, /class="rd-val"/, 'a Reading circle states no conclusion');
    // The full title and verdict reach a screen reader even though the face
    // is short enough to fit a 66px circle.
    assert.match(c, /aria-label="[^"]+ \u2014 [^"]+"/, 'a Reading circle is unlabelled');
  });
});

test('READING: nothing expands in place any more', () => {
  const a = withHistory(planHQ());
  const html = a.renderPlanHQView();
  assert.doesNotMatch(html, /data-action="toggle-hq-section"/,
    'the accordions came back');
  assert.doesNotMatch(html, /class="hq-sec/, 'the accordion markup came back');
  assert.doesNotMatch(CODE, /function hqSection\(/, 'the accordion renderer is still here');
  assert.doesNotMatch(CODE, /case 'toggle-hq-section'/, 'a dispatcher case with no handler');
});

test('READING: the ring says which reading, the face says what it says', () => {
  /* THE LAW MOVED CHANNELS, DELIBERATELY, AND THIS IS THE RECORD OF IT.
     Recovery, evolution and adaptation used to take their ring colour from
     the engine's tone, so three of the five circles traffic-lighted
     themselves independently -- and on a good day all three were the same
     green as each other, which made the one circle the row is built around
     indistinguishable from its neighbours. Colour now says WHICH reading a
     circle is; the engine's own word in the face says what it reads.

     Nothing is lost, and that is what this asserts rather than assumes: the
     verdict was always written in the face, so the face must still move when
     the engine moves, and the panel behind the circle must still carry the
     tone in .read-val. What must NOT move is the colour -- on either row. */
  const a = withHistory(planHQ());
  const report = a.coachAnalyse();
  const recTone = a.readingSections(report).filter(s => s.key === 'recovery')[0].tone;
  assert.ok(['good', 'watch', 'bad'].indexOf(recTone) !== -1, 'recovery lost its tone');

  const recDial = s => (s.match(/<button type="button" class="b-dial"[\s\S]*?<\/button>/g) || [])
    .filter(c => c.indexOf('data-reading="recovery"') !== -1)[0];
  const accent = s => (s.match(/--rd-base:([^;]+);/) || [])[1];
  const face = s => (s.match(/<b style="[^"]*">([^<]*)<\/b>/) || [])[1];

  const before = recDial(a.renderValhallaReadingPreview());
  const statusBefore = a.renderValhallaRecordPreview();
  assert.ok(before, 'no recovery circle at all');

  // Drive the engine to the opposite verdict.
  const other = recTone === 'bad' ? 'fresh' : 'strained';
  a.coachAnalyse = (function(orig){
    return function(){ const r = orig.apply(this, arguments); r.recovery.state = other; return r; };
  })(a.coachAnalyse);

  const after = recDial(a.renderValhallaReadingPreview());
  assert.notEqual(face(after), face(before),
    'the recovery circle says the same word for the opposite verdict — the reading is not live');
  assert.equal(accent(after), accent(before),
    'the recovery circle changed colour with the engine — the ring is meant to be its identity');
  assert.equal(a.renderValhallaRecordPreview(), statusBefore,
    'an Athlete Status circle moved when the coaching verdict moved — a fact took a tone');

  // The panel is still where tone is carried, so the verdict is not colourless.
  assert.match(a.readingPanel('recovery'), /class="read-val (good|watch|bad)"/,
    'the recovery panel lost the tone the circle gave up');

  /* And neither map consults the engine at all -- the strongest form of
     "fixed", since a function that cannot see the tone cannot follow it. */
  [a.READING_ACCENT, a.STATUS_ACCENT].forEach(map => {
    Object.keys(map).forEach(k => {
      assert.doesNotMatch(map[k], /tone|good|watch|bad/, k + "'s accent is named after a verdict");
    });
  });
  assert.doesNotMatch(String(a.dialAccentBase), /tone/,
    'dialAccentBase still reads sec.tone');
});

test('READING: tone is borrowed from the engine, never invented here', () => {
  const a = withHistory(planHQ());
  const secs = a.readingSections(a.coachAnalyse());
  const byKey = {};
  secs.forEach(s => { byKey[s.key] = s; });

  /* Recovery: the engine's own fresh/watch/strained, and all three of them.
     Asserting only the state this fixture happens to be in would pass just as
     well against a tone hard-coded to that state. */
  const map = { fresh:'good', watch:'watch', strained:'bad' };
  const report = a.coachAnalyse();
  assert.equal(byKey.recovery.tone, map[report.recovery.state]);
  Object.keys(map).forEach(st => {
    report.recovery.state = st;
    const sec = a.readingSections(report).filter(s => s.key === 'recovery')[0];
    assert.equal(sec.tone, map[st], 'recovery "' + st + '" is not toned ' + map[st]);
    assert.equal(sec.value, { fresh:'Fresh', watch:'Watch', strained:'Strained' }[st]);
  });
  // Evolution and adaptation: their META tables' own proceed/check/modify.
  const evCls = a.EVOLUTION_META[(a.coachAnalyse().evolution || { state:'HOLD' }).state].cls;
  assert.equal(byKey.evolution.tone, a.readingTone(evCls));
  // Readiness and patterns classify themselves nowhere, so they stay neutral
  // rather than being given a colour by this screen.
  assert.equal(byKey.readiness.tone, null);
  assert.equal(byKey.patterns.tone, null);
});

test('READING: every value and synopsis is live, not written into the markup', () => {
  const a = withHistory(planHQ());
  a.planhqTab = 'coach';
  /* Confidence is read off the GAUGE now. The readiness circle this used to
     read was removed for duplicating this very number, so the liveness check
     follows the number to the one place it still appears. */
  const gauge = html => (html.match(/<button[^>]*class="gauge-wrap"[\s\S]*?<\/button>/) || [])[0] || '';
  const before = gauge(a.renderPlanHQView());

  // Anchored on .gauge-num, not on the first '>NN%' in the string: the SVG
  // above it is full of percentage attributes.
  const pct = s => Number((s.match(/class="gauge-num"><b[^>]*>(\d+)%/) || [])[1]);
  const confBefore = pct(before);
  assert.ok(confBefore > 0, 'the gauge states no confidence at all');

  // Confidence is execution fidelity, so running every session a long way off
  // what was prescribed has to move it -- downwards.
  a.state.days.filter(d => d.completed).forEach(d => { d.actual.pace = '9:30'; });
  const after = gauge(a.renderPlanHQView());
  assert.notEqual(after, before, 'a block of badly executed sessions changed no card');
  assert.ok(pct(after) < confBefore,
    'confidence went from ' + confBefore + '% to ' + pct(after) + '% on a ruined block');
});

// ===========================================================================
// 2. THE PANELS
// ===========================================================================
test('PANEL: every Reading card opens the panel that belongs to it', () => {
  const a = withHistory(planHQ());
  a.READING_KEYS.forEach(key => {
    const panel = a.readingPanel(key);
    assert.ok(panel, key + ' has no panel');
    const sec = a.readingSections(a.coachAnalyse()).filter(s => s.key === key)[0];
    // escaped, because "Recovery & fatigue" reaches the heading through
    // escapeHtml like every other athlete-facing string does
    assert.ok(panel.indexOf('<h2 class="font-head">' + a.escapeHtml(sec.title) + '</h2>') !== -1,
      key + "'s panel is titled something else");
    // The body is the accordion's body, rendered verbatim somewhere else.
    assert.ok(panel.indexOf(sec.body) !== -1, key + "'s panel does not host its own evidence");
    assert.match(panel, /The Evidence/, key + ' lost the rule that labels its evidence');
    /* THE PANEL OPENS ON A RESTATEMENT of the reading the athlete pressed,
       so they are never asked to remember which one it was. What carries
       that restatement now depends on the value's shape. A figure gets the
       circle, inert, exactly as before. A word does not: the heading, the
       circle and the toned chip were all saying "Watch" before a line of
       evidence, and of those three the chip is the one shaped for a word --
       so the circle goes and the hero is marked is-wordless. Either way the
       athlete lands on the verdict they pressed. */
    assert.match(panel, /class="rp-hero(?: is-wordless)?"/,
      key + ' does not open on a restatement of itself');
    if (/class="rp-hero is-wordless"/.test(panel)) {
      assert.match(panel, /class="rp-hero-verdict"/,
        key + ' has no circle AND no verdict chip, so it restates nothing');
      assert.doesNotMatch(panel, /class="b-dial/,
        key + ' is marked wordless but still draws a circle');
    } else {
      assert.match(panel, /class="b-dial"/,
        key + ' keeps a circle-bearing hero but draws no circle');
    }
    assert.ok(panel.indexOf('data-action="open-reading"') === -1,
      key + "'s own circle is still a button inside the panel it opened");
  });
});

test('PANEL: all ten go through one opener, one BACK, one X, no rail', () => {
  const a = withHistory(planHQ());
  /* THE COUNT IS NOT THE POINT; THE SHELL IS. This has been ten, then
     eleven when Goal arrived with the Record tab's retirement, and is now
     larger again because Settings became a list of destinations and its
     sections moved into panels of their own. Pinning a number here just
     means editing it every time the product gains a surface, which teaches
     the next reader nothing. What matters is that EVERY panel in the
     registries goes through one shell with one exit -- so the set is
     enumerated and each member is held to it, and the two that must exist
     are named. */
  const keys = a.READING_KEYS
    .concat(Object.keys(a.RECORD_PANELS))
    .concat(Object.keys(a.ACTION_PANELS));
  assert.ok(keys.length >= 11, 'panels vanished from the registries: ' + keys.length);
  assert.ok(keys.indexOf('goal') !== -1, 'the goal panel is not in the registry');
  assert.ok(keys.indexOf('prefs') !== -1, "Settings' preferences panel is not in the registry");
  keys.forEach(key => {
    const panel = a.hqPanelHtml(key);
    assert.ok(panel, key + ' produced no panel');
    assert.match(panel, /<div class="modal-head"><h2 class="font-head">[^<]+<\/h2>/, key);
    assert.match(panel, /class="icon-btn" data-action="close-record-panel"/, key + ' has no X');
    assert.doesNotMatch(panel, /bld-progress|bld-stage-no/, key + ' grew a build-stage rail');
    /* ONE EXIT, NOT TWO. The panel ended on a full-width cherry BACK that
       fired the identical action as the X above it -- the same close, the
       same scroll restoration -- so an athlete had to work out that the two
       were one before discovering they were, and the cherry one was the
       heaviest object on a surface whose job is to show evidence. The X
       remains, because every other sheet in the product closes with it and
       it costs no line of its own. */
    assert.equal((panel.match(/data-action="close-record-panel"/g) || []).length, 1,
      key + ' has more than one way out again');
    assert.doesNotMatch(panel, /← BACK/, key + ' grew a second exit back');
    assert.doesNotMatch(panel, /rec-panel-nav/, key + ' still carries the old nav block');
  });
  // The rule that keeps a content primary off the navigation colour.
  assert.match(CODE, /\.hq-panel \.btn-primary\{[^}]*var\(--bronze\)/,
    'a Plan HQ panel repaints every primary in the accent again');
  /* The cherry exit is gone with BACK, so the rule that painted it is too.
     What the pair of them existed to protect -- that a content primary never
     wears the colour of the way out -- is now unconditional: nothing in a
     panel is cherry, so a proposal's Accept cannot be mistaken for a close. */
  assert.doesNotMatch(CODE, /rec-panel-nav/,
    'the retired BACK button\u2019s styling is back');
  assert.match(CODE, /openModal\([\s\S]{0,80}?hq-panel/, 'the panels stopped carrying .hq-panel');

  /* ---- A MODAL THAT REDRAWS UNDER ITS OWN CONTROLS IS NOT REBUILT ----
     The restriction sheet re-renders on every level and duration pick, on
     purpose, so that what is on screen is always what would be saved. Each
     of those went through openModal(), which tore the overlay out of the
     document and built a new one -- so the card replayed its .22s slideup
     and returned to scroll top, and changing "for how long" made the whole
     sheet jump. A caller that is REFRESHING says so with a key, and then
     only the card's contents change.
     Asserted on the mechanism because the suite's document stub returns
     null from getElementById, so the in-place branch can never be reached
     here; the behaviour itself (same element, no running animation, scroll
     kept) was measured in a browser. */
  const openModalFn = CODE.match(/function openModal\(html, extraClass, key\)\{[\s\S]*?\n\}/);
  assert.ok(openModalFn, 'openModal no longer accepts a refresh key');
  assert.match(openModalFn[0], /getAttribute\('data-modal-key'\) === key/,
    'the in-place path no longer checks it is the same modal');
  assert.match(openModalFn[0], /card\.innerHTML = html/,
    'the in-place path stopped swapping contents');
  assert.match(openModalFn[0], /card\.scrollTop = y/,
    'the in-place path stopped keeping the scroll position');
  assert.match(openModalFn[0], /openRecordPanelKey = null/,
    'the in-place path skips the side effect closeModal() exists for');
  assert.match(CODE, /openModal\(html, 'modal-themed builder-light', 'restriction'\)/,
    'the restriction sheet stopped asking for the in-place redraw, so every ' +
    'level and duration pick rebuilds and re-animates it again');
});

test('PANEL: every action a panel offers is handled somewhere', () => {
  const a = withHistory(planHQ());
  const keys = a.READING_KEYS.concat(Object.keys(a.RECORD_PANELS)).concat(Object.keys(a.ACTION_PANELS));
  keys.forEach(key => {
    (a.hqPanelHtml(key).match(/data-action="([^"]+)"/g) || []).forEach(m => {
      const action = m.slice('data-action="'.length, -1);
      const handled = new RegExp("case '" + action + "':|action === '" + action + "'").test(CODE);
      assert.ok(handled, key + ' fires ' + action + ', which no dispatcher handles');
    });
  });
});

test('PANEL: opening and closing any of them restores the Plan HQ scroll offset', () => {
  const a = withHistory(planHQ());
  const keys = a.READING_KEYS.concat(Object.keys(a.RECORD_PANELS)).concat(Object.keys(a.ACTION_PANELS));
  keys.forEach((key, i) => {
    let landed = null;
    const left = 400 + i * 37;
    a.pageYOffset = left;
    a.scrollTo = (x, y) => { landed = y; };
    a.openHQPanel(key);
    assert.equal(a.openRecordPanelKey, key, key + ' did not open');
    a.pageYOffset = 0;               // what renderApp() would leave behind
    a.closeRecordPanel();
    assert.equal(landed, left, key + ' landed at ' + landed + ', left from ' + left);
    assert.equal(a.openRecordPanelKey, null, key + ' did not close');
  });
});

// ===========================================================================
// 3. THE RACE OUTLOOK
// ===========================================================================
test('OUTLOOK: no measurement produces an honest empty state, no band, but the permanent scale and goal end still show', () => {
  const a = planHQ();                       // built, nothing logged
  const html = a.renderRaceOutlook();
  assert.match(html, /Race Outlook/);
  assert.match(html, /Nothing measured yet/);
  assert.doesNotMatch(html, /oi-band/, 'a band was drawn from no measurement');
  // The scale/line and the gold goal marker exist from the start of the
  // block -- only the measured/current position is withheld until real
  // evidence exists. A goal marker with nothing plotted against it is not a
  // fabricated measurement; it is "where I am trying to get" shown alone.
  assert.match(html, /oi-track/, 'the permanent scale did not render before measurement existed');
  assert.equal(a.raceOutlook().state, 'none');
  if (a.raceOutlook().goalSec != null){
    assert.match(html, /oi-goal/, 'a goal marker was withheld even though a goal time exists');
  }
  /* And it is still CARRIED somewhere, so the empty state is visible rather
     than the section silently disappearing. It left the hero for the panel
     the Goal circle opens -- the hero was showing four readings before The
     Reading's five began -- so that is where the guard now looks. */
  assert.doesNotMatch(a.renderProgrammeStatus(), /id="outlook-mount"/,
    'Race Outlook is still in the hero');
  assert.ok(a.recordPanelGoal().indexOf(html) !== -1,
    'Race Outlook left the hero and is not in the Goal panel either');
});

test('OUTLOOK: ordinary training runs cannot move it, however fast they are', () => {
  const a = planHQ();
  const today = a.todayStr();
  // A block of very fast easy running, logged and completed. None of it is a
  // race and none of it is a checkpoint.
  a.state.days.forEach(dd => {
    if (dd.type === 'rest' || dd.type === 'race' || dd.type === 'checkpoint') return;
    if (dd.date >= today) return;
    dd.completed = true;
    dd.actual = { km: dd.km, pace: '2:55', hr: 130, rpe: 3, feel: 'good', notes: '' };
  });
  /* THE DISTINCTION THIS TEST PROTECTS IS UNCHANGED AND IS STILL ASSERTED: a
     training run, however fast, never becomes a MEASUREMENT.

     WHAT CHANGED, BY INSTRUCTION: this athlete has logged a whole block, and
     HQ's locked rule is that after fourteen days of usable evidence Race
     Outlook must give Valhalla's best assessment, with race/checkpoint data
     explicitly not mandatory. Returning 'none' to somebody who has logged
     eight weeks was the defect -- the week-7 marathon athlete with no estimate
     at all. So the band is drawn, and the honesty lives where it belongs: in
     the STATE, which is 'estimated' and not 'measured', and in the copy, which
     says a race or a checkpoint would sharpen it. */
  assert.equal(a.measuredPerformances().length, 0, 'a training run became a measurement');
  assert.equal(a.raceOutlook().state, 'estimated',
    'a fully logged block still produced no assessment at all');
  assert.notEqual(a.raceOutlook().state, 'measured',
    'training runs were promoted to measured evidence');
  const html = a.renderRaceOutlook();
  assert.match(html, /Estimated from your training so far/);
  assert.doesNotMatch(html, /Training runs do not move it/,
    'an estimate claimed the authority of a measurement');
});

test('OUTLOOK: a benchmark cannot move it either', () => {
  const a = planHQ();
  a.state.setup.benchmark = { distanceKey: '5k', timeSec: a.clockToSec('0:15:00') };
  assert.equal(a.raceOutlook().state, 'none',
    'a benchmark was accepted as measured evidence');
  assert.doesNotMatch(a.renderRaceOutlook(), /oi-band/);
});

test('OUTLOOK: a completed checkpoint draws the band, and the goal marker comes from the active goal', () => {
  const a = withHistory(planHQ());
  const o = a.raceOutlook();
  assert.equal(o.state, 'measured');
  assert.ok(o.fastSec > 0 && o.slowSec > o.fastSec, 'the band is not a range');
  assert.equal(o.goalSec, a.getActiveGoal().timeSec, 'the marker is not the active goal');

  const html = a.renderRaceOutlook();
  assert.match(html, /class="oi-band"/);
  assert.match(html, /class="oi-goal"/);
  assert.match(html, new RegExp('Goal ' + a.state.setup.activeGoal));
  // Violet is the measurement, gold is the goal, and that is a rule in the
  // stylesheet rather than a habit in this render.
  assert.match(CODE, /\.oi-band\{[^}]*var\(--cherry\)/);
  assert.match(CODE, /\.oi-goal\{[^}]*background\s*:\s*var\(--gold\)/);

  // Switching the active goal moves the marker and nothing else.
  const before = html;
  a.state.setup.goals.B = { timeSec: a.getActiveGoal().timeSec + 600 };
  a.state.setup.activeGoal = 'B';
  const after = a.renderRaceOutlook();
  assert.notEqual(after, before);
  assert.equal(a.raceOutlook().fastSec, o.fastSec, 'changing the goal moved the measured band');
});

test('OUTLOOK: it repeats the engine when the engine withholds, and invents nothing', () => {
  // A marathon block: measuredFitnessEstimate() refuses to extrapolate one
  // from a short effort without the sustained volume behind it.
  const a = withHistory(planHQ({ distanceKey: 'full', volume: 30, weeks: 12 }));
  const est = a.measuredFitnessEstimate('full');
  if (est && est.withheld) {
    const o = a.raceOutlook();
    assert.equal(o.state, 'withheld');
    assert.equal(o.reason, est.reason, 'the outlook paraphrased the engine');
    const html = a.renderRaceOutlook();
    assert.ok(html.indexOf(est.reason) !== -1, "the engine's own reason is not shown");
    assert.doesNotMatch(html, /oi-band/, 'a withheld estimate still drew a band');
  } else {
    // The fixture met the volume bar; then it must draw honestly instead.
    assert.equal(a.raceOutlook().state, 'measured');
  }
});

test('OUTLOOK: it is not the confidence gauge, and does not restate it', () => {
  const a = withHistory(planHQ());
  const html = a.renderRaceOutlook();
  assert.doesNotMatch(html, /confidence/i, 'the outlook borrowed the confidence number');
  assert.doesNotMatch(html, /\bchance\b|\bprobabilit|\blikel(y|ihood)\b/i,
    'the outlook made a probability claim');
  // The gauge is untouched above it, and its one-sentence explainer moved
  // with the rest of Readiness's depth into the tap-through evidence panel
  // rather than sitting permanently on the hero.
  const ps = a.renderProgrammeStatus();
  assert.ok(ps.indexOf(a.renderConfidenceGauge()) !== -1);
  assert.match(a.readingPanel('readiness'), /Confidence reflects how closely your logged sessions have matched/);
  /* The two are no longer on one surface at all, which settles the question
     the ordering assertion was asking: the gauge is the hero's, the outlook
     is the Goal panel's. They cannot restate each other from there. */
  assert.doesNotMatch(ps, /outlook-instrument/, 'the outlook is back in the hero');
  assert.match(a.recordPanelGoal(), /outlook-instrument/);
  assert.doesNotMatch(a.recordPanelGoal(), /confidence-gauge-mount/,
    'the gauge followed the outlook into the Goal panel');
});

test('OUTLOOK: logging a race repaints it through the same patch path as the gauge', () => {
  assert.match(CODE, /function patchDerivedStats\(\)[\s\S]{0,700}outlook-mount/,
    'patchDerivedStats() no longer refreshes the outlook');
});

// ===========================================================================
// 4. THE THREE MANAGEMENT/MEASUREMENT ACTIONS -- NO LONGER ONE ROW
// ===========================================================================
test('ACTIONS: New Block and Plan Settings moved to Settings; Checkpoint has no tile or popup left at all', () => {
  const a = withHistory(planHQ());
  // New Block and Plan Settings are programme-management actions, not
  // day-to-day coaching or athlete evidence -- requirement 5 moved both out
  // of the daily Valhalla page and into Settings, at Settings' own
  // restrained button weight rather than as prominent act-tiles. Checkpoint
  // is no longer a tile anywhere -- requirement 9 removed the standalone
  // Fitness Checkpoint popup it used to open, folding "your next checkpoint"
  // directly into Measured Fitness instead.
  a.planhqTab = 'valhalla';
  const valhallaTiles = a.renderPlanHQView().match(/<button type="button" class="act-tile"[\s\S]*?<\/button>/g) || [];
  assert.equal(valhallaTiles.length, 0, 'a management tile is still on the daily Valhalla page');

  a.planhqTab = 'record';
  const recordTiles = a.renderPlanHQView().match(/<button type="button" class="act-tile"[\s\S]*?<\/button>/g) || [];
  assert.equal(recordTiles.length, 0, 'a Checkpoint tile is still on Record');
  assert.doesNotMatch(CODE, /case 'open-checkpoint':/, 'open-checkpoint still has a handler');
  assert.equal(a.ACTION_PANELS.checkpoint, undefined, 'the standalone Fitness Checkpoint popup is still registered');

  const settingsHtml = a.renderSettingsHubView();
  // 400, not 300: these rows are .ev-card.stg-nav now (VALHALLA CONSISTENCY
  // PASS -- icon, label, chevron, same shell Coach's Reading rows use), and
  // an inlined icon SVG between the tag and its label can itself run past
  // 300 characters -- see ICONS.layers, at 311.
  assert.match(settingsHtml, /data-action="open-new-block"[^>]*>[\s\S]{0,400}?Start a New Block/,
    'New Block is not reachable from Settings');
  /* Plan Settings moved one step deeper with the rest of the training
     configuration, behind Settings' Training & Zones row -- Settings is a
     list of destinations now rather than a scroll of open sections. */
  assert.match(settingsHtml, /data-action="open-settings-panel" data-panel="training"/,
    'Settings has no Training & Zones destination');
  assert.match(a.hqPanelHtml('training'),
    /data-action="open-setup"[^>]*>[\s\S]{0,400}?Edit Plan Settings/,
    'Plan Settings is not reachable from Settings');
  assert.match(CODE, /case 'open-new-block':/, 'open-new-block is not handled');
  assert.match(CODE, /case 'open-setup':/, 'open-setup is not handled');
});

test('TRIO: NEW BLOCK reaches the engine’s own block-transition journey', () => {
  const a = withHistory(planHQ());
  const panel = a.ACTION_PANELS.newblock();
  assert.match(panel, /<h2 class="font-head">New Block<\/h2>/);
  assert.match(panel, /Current block/);
  assert.match(panel, /data-action="open-setup"/, 'the builder is not reachable from it');
  // Where the engine has a recommendation it is offered with the engine's own
  // handler; where it does not, the panel says so instead of showing nothing.
  const rec = a.nextBlockRecommendation();
  if (rec && (rec.kind === 'block' || (rec.options || []).length)) {
    assert.match(panel, /data-action="start-block"/);
  } else {
    assert.match(panel, /no recommendation for what comes next yet/);
  }
});

test('TRIO: PLAN SETTINGS goes to the plan editor the product already calls that', () => {
  const a = withHistory(planHQ());
  // Plan Settings lives only in Settings now (requirement 5) -- Settings has
  // called openSetupModal() "Edit Plan Settings" all along, and there is no
  // longer a second door onto it from the daily Valhalla page.
  /* One step deeper, behind Settings' Training & Zones row, with the rest
     of the plan configuration -- Settings lists destinations now. */
  assert.match(a.renderSettingsHubView(),
    /data-action="open-settings-panel" data-panel="training"/);
  assert.match(a.hqPanelHtml('training'),
    /data-action="open-setup"[^>]*>[\s\S]{0,600}?Edit Plan Settings/,
    'Edit Plan Settings does not fire open-setup');
  assert.match(CODE, /case 'open-setup': openSetupModal\(\);/);
  assert.doesNotMatch(a.renderPlanHQView(), /data-action="open-setup"/,
    'Plan Settings is still duplicated on the daily Valhalla page');
});

test('CHECKPOINT: Measured Fitness names it and always has a real action, no separate popup', () => {
  const a = withHistory(planHQ());
  const panel = a.RECORD_PANELS.fitness();
  assert.match(panel, /<h2 class="font-head">Measured Fitness<\/h2>/);
  // "Why races/checkpoints count as measurements" is said once, here, not
  // repeated in a second popup that no longer exists.
  assert.match(panel, /What counts as a measurement/);
  // Never generic scheduling.
  assert.doesNotMatch(panel, /schedule a (workout|session|run)/i);
  assert.doesNotMatch(panel, /add a session/i);

  const chk = a.state.days.filter(d => d.type === 'checkpoint')[0];
  assert.ok(chk, 'the generator scheduled no checkpoint to test against');
  assert.match(panel, /Your (next )?checkpoint/);
  assert.ok(panel.indexOf(chk.title || 'Fitness Checkpoint') !== -1, 'the checkpoint\'s own name is missing');
  assert.match(panel, new RegExp('Week ' + chk.week));
  // The row/action goes directly to Full Plan -- not to another popup.
  assert.match(panel, /data-action="go-checkpoint"/);
  assert.match(panel, new RegExp('Open week ' + chk.week));
});

test('CHECKPOINT: navigates to the real session directly from Measured Fitness', () => {
  const a = planHQ();
  const chk = a.state.days.filter(d => d.type === 'checkpoint')[0];
  a.state.view = 'planhq';
  a.openHQPanel('fitness');
  a.handleGoToCheckpoint();
  assert.equal(a.state.view, 'full', 'CHECKPOINT did not open the plan');
  assert.equal(a.expandedWeeks[chk.week], true, 'the checkpoint week was left collapsed');

  // A block with no checkpoint in it offers no dead door.
  const b = planHQ();
  b.state.days.forEach(d => { if (d.type === 'checkpoint') d.type = 'tempo'; });
  const none = b.RECORD_PANELS.fitness();
  assert.doesNotMatch(none, /data-action="go-checkpoint"/, 'a door to a session that is not there');
});

// ===========================================================================
// 5. THE WHOLE SCREEN
// ===========================================================================
test('HQ: Valhalla opens on the right question, in the right order down one page', () => {
  const a = withHistory(planHQ());
  /* The three tabs are gone and the single scroll is back -- but not the one
     that was split up originally. The order is the order the athlete reads
     in: where am I (the hero band), what is the call, what does it mean (the
     Reading arc), what is it built on (the Athlete Status), then the
     coaching that has no depth behind it. */
  const html = a.renderPlanHQView();
  const at = s => html.indexOf(s);
  assert.ok(at('class="v-hero"') < at('class="v-call'), 'the call is above the hero');
  assert.ok(at('class="v-call') < at('>The Reading<'), 'the Reading arc is above the call');
  assert.ok(at('>The Reading<') < at('>The Athlete Status<'),
    'The Athlete Status is above the Reading arc');
  assert.ok(at('>The Athlete Status<') < at(a.renderCoachPanel()),
    'the coach cards are above the Athlete Status');
  assert.doesNotMatch(html, /class="act-trio/,
    'a management action tile is still on the daily Valhalla page');
});

test('HQ: nothing on Valhalla/Coach/Record expands inline, and every card is a destination', () => {
  const a = withHistory(planHQ());
  const html = a.renderPlanHQView();
  const circles = html.match(/<button type="button" class="b-dial[^"]*"[\s\S]*?<\/button>/g) || [];
  const readingCardsHtml = circles.filter(c => c.indexOf('open-reading') !== -1);
  const recordCardsHtml = circles.filter(c => c.indexOf('open-record') !== -1);
  // Four since readiness left the arc for the gauge, which is itself a
  // destination and is checked for one below.
  assert.equal(readingCardsHtml.length, 4, 'expected four Reading circles');
  // Four now -- Goal joined Measured fitness, Benchmark and Progress when it
  // lost the Record tab it had been living on.
  assert.equal(recordCardsHtml.length, 4, 'expected four Athlete Status circles');
  const gaugeTag = (html.match(/<button[^>]*class="gauge-wrap"[^>]*>/) || [])[0] || '';
  assert.match(gaugeTag, /data-action="open-reading"/, 'the gauge goes nowhere');
  assert.doesNotMatch(gaugeTag, /aria-expanded/, 'the gauge expands rather than opens');
  readingCardsHtml.concat(recordCardsHtml).forEach(c => {
    assert.match(c, /data-action="open-(reading|record)"/, 'a card that goes nowhere');
    assert.doesNotMatch(c, /aria-expanded/, 'a card that expands rather than opens');
  });
});

test('HQ: the coaching that has no depth behind it stays on the page', () => {
  const a = withHistory(planHQ());
  const html = a.renderPlanHQView();
  const report = a.coachAnalyse();
  /* renderAthleteStatusCard() led this and has been deleted: load is the
     hero band's right-hand figure, recovery is a circle with a panel, trend
     is a row inside the Readiness panel, and the sentence it carried is
     Valhalla's Call at the top of the screen. It was the same three readings
     a fourth time, directly beneath them. The REST of the coach's voice --
     the cards with no depth behind them and so nothing to tap into -- is
     what this test has always been about, and it stays on the page. */
  assert.equal(typeof a.renderAthleteStatusCard, 'undefined');
  assert.match(html, /class="v-call /, 'the status sentence lost its surface too');
  assert.ok(html.indexOf(a.renderCoachPanel()) !== -1);
  assert.ok(a.renderCoachPanel().indexOf(a.renderBreakthroughCard(report)) !== -1,
    'Breakthrough Sessions left the coach panel');
  assert.ok(a.renderCoachPanel().indexOf(a.renderCoachWatchCard(report)) !== -1,
    'Coach Watch left the coach panel');
});

test('HQ: an athlete with no plan is never asked to render any of this', () => {
  const a = loadApp({ pinnedDate: PINNED });
  a.state = a.makeDefaultState();
  assert.equal(a.renderValhallaReadingPreview(), '');
  assert.equal(a.renderValhallaRecordPreview(), '');
  assert.equal(a.renderRaceOutlook(), '');
  assert.equal(a.raceOutlook(), null);
  a.openHQPanel('recovery');
  assert.equal(a.openRecordPanelKey, null, 'a panel opened for an athlete with no plan');
});
