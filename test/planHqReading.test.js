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
function readingCards(html) {
  return (html.match(/<button type="button" class="ev-card"[\s\S]*?<\/button>/g) || [])
    .filter(c => c.indexOf('data-action="open-reading"') !== -1);
}

// ===========================================================================
// 1. THE READING'S CARDS
// ===========================================================================
test('READING: five destination cards, one per interpretation the engine produces', () => {
  const a = withHistory(planHQ());
  a.planhqTab = 'coach';
  const html = a.renderPlanHQView();
  const cards = readingCards(html);
  assert.equal(cards.length, 5, 'expected five Reading cards, found ' + cards.length);

  const keys = cards.map(c => (c.match(/data-reading="([^"]+)"/) || [])[1]);
  assert.equal(keys.join(','), 'readiness,recovery,evolution,patterns,adaptation');
  // The set is the engine's, not a list typed twice.
  assert.equal(a.readingSections(a.coachAnalyse()).map(s => s.key).join(','), keys.join(','));

  cards.forEach(c => {
    assert.match(c, /class="rs-dial"/, 'a Reading card states no conclusion');
    assert.match(c, /class="rs-head-text"/, 'a Reading card carries no explanatory text');
    assert.match(c, /<svg/, 'a Reading card has no chevron affordance');
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

test('READING: a card may carry a verdict, and a Record card may not', () => {
  const a = withHistory(planHQ());
  // The Reading now lives on the Coach tab, the Record on its own tab -- both
  // rules still hold, just checked against the tab each one actually renders
  // on. A verdict is now carried by the dial's own tone-coloured ring rather
  // than a separate coloured span; a fact never gets that ring at all.
  a.planhqTab = 'coach';
  const coachHtml = a.renderPlanHQView();
  // Recovery is the one the engine always classifies, so it always has a tone.
  const rec = readingCards(coachHtml).filter(c => c.indexOf('data-reading="recovery"') !== -1)[0];
  const report = a.coachAnalyse();
  const secs = a.readingSections(report);
  const recTone = secs.filter(s => s.key === 'recovery')[0].tone;
  assert.ok(['good', 'watch', 'bad'].indexOf(recTone) !== -1, 'recovery lost its tone');
  assert.match(rec, new RegExp('stroke="' + a.toneRingColor(recTone).replace(/[()]/g, '\\$&') + '"'),
    'recovery\'s dial does not carry its tone');

  a.planhqTab = 'record';
  const recordHtml = a.renderPlanHQView();
  const recordCards = (recordHtml.match(/<button type="button" class="ev-card"[\s\S]*?<\/button>/g) || [])
    .filter(c => c.indexOf('data-action="open-record"') !== -1);
  assert.equal(recordCards.length, 4);
  recordCards.forEach(c => {
    assert.doesNotMatch(c, /rs-dial|read-dot|read-val/, 'a Record card grew a verdict dial');
  });
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
  const readinessCard = html => readingCards(html).filter(c => c.indexOf('data-reading="readiness"') !== -1)[0];
  const before = readinessCard(a.renderPlanHQView());

  const pct = s => Number((s.match(/>(\d+)%</) || [])[1]);
  const confBefore = pct(before);
  assert.ok(confBefore > 0, 'the readiness card states no confidence at all');

  // Confidence is execution fidelity, so running every session a long way off
  // what was prescribed has to move it -- downwards.
  a.state.days.filter(d => d.completed).forEach(d => { d.actual.pace = '9:30'; });
  const after = readinessCard(a.renderPlanHQView());
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
    assert.match(panel, /The evidence/);
  });
});

test('PANEL: all eleven go through one opener, one BACK, one X, no rail', () => {
  const a = withHistory(planHQ());
  const keys = a.READING_KEYS
    .concat(Object.keys(a.RECORD_PANELS))
    .concat(Object.keys(a.ACTION_PANELS));
  assert.equal(keys.length, 11);
  keys.forEach(key => {
    const panel = a.hqPanelHtml(key);
    assert.ok(panel, key + ' produced no panel');
    assert.match(panel, /<div class="modal-head"><h2 class="font-head">[^<]+<\/h2>/, key);
    assert.match(panel, /class="icon-btn" data-action="close-record-panel"/, key + ' has no X');
    // Exactly one primary in the navigation. A panel MAY carry a content
    // primary of its own -- Plan evolution hosts the proposal's Accept -- and
    // .hq-panel is what stops that one wearing the accent of the way out.
    const nav = panel.slice(panel.indexOf('rec-panel-nav'));
    assert.equal((nav.match(/class="btn btn-primary[^"]*"/g) || []).length, 1,
      key + ' has more than one primary in its navigation');
    assert.match(panel,
      /<button type="button" class="btn btn-primary btn-block" data-action="close-record-panel">← BACK<\/button>/,
      key + ' does not end on a full-width ← BACK');
    assert.doesNotMatch(panel, /bld-progress|bld-stage-no/, key + ' grew a build-stage rail');
    // Two exits, and both the same action.
    assert.equal((panel.match(/data-action="close-record-panel"/g) || []).length, 2, key);
  });
  // The rule that keeps a content primary off the navigation colour.
  assert.match(CODE, /\.hq-panel \.btn-primary\{[^}]*var\(--bronze\)/,
    'a Plan HQ panel repaints every primary in the accent again');
  assert.match(CODE, /\.hq-panel \.rec-panel-nav \.btn-primary\{[^}]*var\(--cherry\)/,
    'BACK lost the Cherry Lacquer that marks it as the way out');
  assert.match(CODE, /openModal\([\s\S]{0,80}?hq-panel/, 'the panels stopped carrying .hq-panel');
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
test('OUTLOOK: no measurement produces an honest empty state and no band', () => {
  const a = planHQ();                       // built, nothing logged
  const html = a.renderRaceOutlook();
  assert.match(html, /Race Outlook/);
  assert.match(html, /Nothing measured yet/);
  assert.doesNotMatch(html, /oi-band/, 'a band was drawn from no measurement');
  assert.doesNotMatch(html, /oi-goal/, 'a goal marker was drawn with no band to place it on');
  assert.equal(a.raceOutlook().state, 'none');
  // And Programme Status still carries it, so the empty state is visible
  // rather than the section silently disappearing.
  assert.match(a.renderProgrammeStatus(), /id="outlook-mount"/);
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
  assert.equal(a.measuredPerformances().length, 0, 'a training run became a measurement');
  assert.equal(a.raceOutlook().state, 'none');
  assert.doesNotMatch(a.renderRaceOutlook(), /oi-band/);
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
  assert.ok(ps.indexOf('id="confidence-gauge-mount"') < ps.indexOf('id="outlook-mount"'),
    'the outlook was placed above the gauge it sits beneath');
});

test('OUTLOOK: logging a race repaints it through the same patch path as the gauge', () => {
  assert.match(CODE, /function patchDerivedStats\(\)[\s\S]{0,700}outlook-mount/,
    'patchDerivedStats() no longer refreshes the outlook');
});

// ===========================================================================
// 4. THE ACTION TRIO
// ===========================================================================
test('TRIO: three tiles, three distinct actions, all of them handled', () => {
  const a = withHistory(planHQ());
  // New Block/Plan Settings re-homed to Valhalla (programme-level), Checkpoint
  // to Record (a measurement action) -- still three tiles, three real
  // destinations, just no longer on one screen at once.
  a.planhqTab = 'valhalla';
  const valhallaTiles = a.renderPlanHQView().match(/<button type="button" class="act-tile"[\s\S]*?<\/button>/g) || [];
  a.planhqTab = 'record';
  const recordTiles = a.renderPlanHQView().match(/<button type="button" class="act-tile"[\s\S]*?<\/button>/g) || [];
  const tiles = valhallaTiles.concat(recordTiles);
  assert.equal(tiles.length, 3, 'expected three action tiles across Valhalla and Record, found ' + tiles.length);

  const actions = tiles.map(t => (t.match(/data-action="([^"]+)"/) || [])[1]);
  assert.equal(new Set(actions).size, 3, 'two tiles fire the same action: ' + actions.join(','));
  assert.equal(actions.join(','), 'open-new-block,open-setup,open-checkpoint');
  actions.forEach(x => assert.match(CODE, new RegExp("case '" + x + "':"), x + ' is not handled'));

  const labels = tiles.map(t => (t.match(/class="act-lab">([^<]+)</) || [])[1]);
  assert.equal(labels.join(' | '), 'New block | Plan settings | Checkpoint');
  tiles.forEach(t => assert.match(t, /<svg/, 'an action tile has no icon'));
  // 76px of tile, so the whole thing clears every platform's touch target.
  assert.match(CODE, /\.act-tile\{[^}]*min-height\s*:\s*7[0-9]px/);
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
  const html = a.renderPlanHQView();
  // the window has to clear the inline SVG between the action and the label
  assert.match(html, /data-action="open-setup"[^>]*>[\s\S]{0,600}?Plan settings/,
    'the PLAN SETTINGS tile does not fire open-setup');
  // Settings has called openSetupModal() "Edit Plan Settings" all along -- the
  // tile is a second door onto the same real surface, not a new one.
  assert.match(CODE, /data-action="open-setup"[^>]*>'\+ICONS\.target\+' Edit Plan Settings/);
  assert.match(CODE, /case 'open-setup': openSetupModal\(\);/);
});

test('TRIO: CHECKPOINT is about measured evidence, and always has a real action', () => {
  const a = withHistory(planHQ());
  const panel = a.ACTION_PANELS.checkpoint();
  assert.match(panel, /<h2 class="font-head">Fitness Checkpoint<\/h2>/);
  assert.match(panel, /maximal effort over a known distance/);
  // Never generic scheduling.
  assert.doesNotMatch(panel, /schedule a (workout|session|run)/i);
  assert.doesNotMatch(panel, /add a session/i);

  // Run and measured -> the action is to use it.
  assert.match(panel, /data-action="open-recalibrate"/);

  // Not yet run -> the action is to go and find it in the plan.
  const b = planHQ();
  const chk = b.state.days.filter(d => d.type === 'checkpoint')[0];
  assert.ok(chk, 'the generator scheduled no checkpoint to test against');
  const ahead = b.ACTION_PANELS.checkpoint();
  assert.match(ahead, /Ahead of you/);
  assert.match(ahead, /data-action="go-checkpoint"/);
  assert.match(ahead, new RegExp('Open week ' + chk.week));
});

test('TRIO: CHECKPOINT navigates to the real session, and says so honestly when a block has none', () => {
  const a = planHQ();
  const chk = a.state.days.filter(d => d.type === 'checkpoint')[0];
  a.state.view = 'planhq';
  a.openHQPanel('checkpoint');
  a.handleGoToCheckpoint();
  assert.equal(a.state.view, 'full', 'CHECKPOINT did not open the plan');
  assert.equal(a.expandedWeeks[chk.week], true, 'the checkpoint week was left collapsed');

  // A block with no checkpoint in it says so rather than offering a dead door.
  const b = planHQ();
  b.state.days.forEach(d => { if (d.type === 'checkpoint') d.type = 'tempo'; });
  const none = b.ACTION_PANELS.checkpoint();
  assert.match(none, /no Fitness Checkpoint/);
  assert.doesNotMatch(none, /data-action="go-checkpoint"/, 'a door to a session that is not there');
});

// ===========================================================================
// 5. THE WHOLE SCREEN
// ===========================================================================
test('HQ: Valhalla, Coach and Record each open on the right question, in the right order within themselves', () => {
  const a = withHistory(planHQ());
  // The single long scroll is gone -- VALHALLA/COACH/RECORD are three tabs
  // now, so "summary first, interpretation second, record third, actions
  // last" is a rule about ordering WITHIN each tab, not down one page.
  a.planhqTab = 'valhalla';
  const valhalla = a.renderPlanHQView();
  const atV = s => valhalla.indexOf(s);
  assert.ok(atV('class="v-hero"') < atV('id="outlook-mount"'), 'the outlook is above the gauge');
  assert.ok(atV('id="outlook-mount"') < atV('class="act-trio'), 'the actions are below the hero');

  a.planhqTab = 'coach';
  const coach = a.renderPlanHQView();
  assert.ok(coach.indexOf('>The Reading<') !== -1, 'THE READING left the Coach tab');

  a.planhqTab = 'record';
  const record = a.renderPlanHQView();
  const atR = s => record.indexOf(s);
  assert.ok(atR('Active Goal') < atR('>The Record<'), 'Active Goal is above THE RECORD');
  assert.ok(atR('>The Record<') < atR('class="act-trio'), 'the actions are below THE RECORD');
});

test('HQ: nothing on Valhalla/Coach/Record expands inline, and every card is a destination', () => {
  const a = withHistory(planHQ());
  a.planhqTab = 'coach';
  const readingCardsHtml = a.renderPlanHQView().match(/<button type="button" class="ev-card"[\s\S]*?<\/button>/g) || [];
  assert.equal(readingCardsHtml.length, 5, 'expected five Reading cards on Coach');
  a.planhqTab = 'record';
  const recordCardsHtml = a.renderPlanHQView().match(/<button type="button" class="ev-card"[\s\S]*?<\/button>/g) || [];
  assert.equal(recordCardsHtml.length, 4, 'expected four Record cards on Record');
  readingCardsHtml.concat(recordCardsHtml).forEach(c => {
    assert.match(c, /data-action="open-(reading|record)"/, 'a card that goes nowhere');
    assert.doesNotMatch(c, /aria-expanded/, 'a card that expands rather than opens');
  });
});

test('HQ: the coaching that has no depth behind it stays on the page', () => {
  const a = withHistory(planHQ());
  a.planhqTab = 'coach';
  const html = a.renderPlanHQView();
  const report = a.coachAnalyse();
  // Athlete Status is the headline and is rendered verbatim.
  assert.ok(html.indexOf(a.renderAthleteStatusCard(report)) !== -1,
    'Athlete Status left the Coach tab');
  // And the coach cards are still the ones the coach panel produces.
  assert.ok(html.indexOf(a.renderCoachPanel()) !== -1);
  assert.ok(a.renderCoachPanel().indexOf(a.renderBreakthroughCard(report)) !== -1,
    'Breakthrough Sessions left the coach panel');
  assert.ok(a.renderCoachPanel().indexOf(a.renderCoachWatchCard(report)) !== -1,
    'Coach Watch left the coach panel');
});

test('HQ: an athlete with no plan is never asked to render any of this', () => {
  const a = loadApp({ pinnedDate: PINNED });
  a.state = a.makeDefaultState();
  assert.equal(a.renderReadingSection(), '');
  assert.equal(a.renderRaceOutlook(), '');
  assert.equal(a.raceOutlook(), null);
  a.openHQPanel('recovery');
  assert.equal(a.openRecordPanelKey, null, 'a panel opened for an athlete with no plan');
});
