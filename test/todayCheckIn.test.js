'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THE "HOW ARE YOU TODAY?" CHECK-IN
   =========================================================================
   THE DEFECT THIS FILE EXISTS FOR. The panel asks three questions -- legs,
   sleep, health -- and its visibility was gated on `!ready`, where `ready` is
   coachReadinessToday(). That function is truthy on the FIRST of the three
   answers. So the first tap closed the panel over the two questions still
   unanswered, and the app recorded a one-third-answered morning as a finished
   readiness check.

   It is not only a UX defect. coachDecision() weights `health === 'under'` at
   10 and treats it as SAFETY -- the heaviest single input it takes from the
   athlete. Health is the third question. An athlete who tapped Legs first
   could not reach it. The interface was structurally suppressing the coach's
   strongest safety signal.

   WHAT MUST NOT DRIFT BACK, and each has a test below:
     * one answer must not close the panel, or mark the check-in complete;
     * a dimension nobody answered must stay MISSING -- never "normal",
       "good", healthy or any other favourable default;
     * a dimension somebody DID answer must still reach the coach even when
       the other two are blank, because a lone "under the weather" is real
       safety evidence and dropping it would be the worse bug;
     * a finished check-in must confirm rather than vanish, and must reopen;
     * an amendment must be what the coach then reads. */

const PINNED = '2026-08-24T09:00:00Z';   // a Monday, matching the rest of the suite
const app0 = () => loadApp({ pinnedDate: PINNED });

function fillNormally(app, dd) {
  const target = app.executionPaceTarget(dd);
  const band = app.expectedRPEBand(dd);
  const zone = app.executionHRTarget(dd);
  dd.completed = true;
  dd.actual = {
    km: dd.km,
    pace: target ? app.secToPace((target.slow + target.fast) / 2) : null,
    hr: zone && zone.lo != null ? Math.round((zone.lo + (zone.hi != null ? zone.hi : zone.lo + 20)) / 2) : null,
    rpe: band ? Math.round((band[0] + band[1]) / 2) : null,
    notes: '',
  };
}

/* The check-in is EARNED, not permanent: it appears only when the recent
   evidence already says something and a quality session is next. That rule is
   deliberately unchanged by this work, so every test here has to build an
   athlete who has actually earned it -- the same corroborated-fatigue fixture
   coachDecision.test.js uses to reach MODIFY. */
function athleteWhoEarnedTheCheckIn() {
  const app = app0();
  const startDate = app.addDays(app.todayStr(), -10);
  const { days } = buildPlan(app, { lthr: 172, maxHR: 188, weeks: 12, startDate });
  const today = app.todayStr();

  days.filter(d => d.date <= today && d.type !== 'rest').forEach(dd => fillNormally(app, dd));

  const last7 = days.filter(d => d.date <= today && d.date >= app.addDays(today, -6) && d.type !== 'rest');
  const overBand = last7.find(d => ['interval', 'threshold', 'tempo'].includes(d.type)) || last7[0];
  const band = app.expectedRPEBand(overBand);
  const z1 = app.executionHRTarget(overBand);
  overBand.actual.rpe = band[1] + 2;
  overBand.actual.hr = (z1.hi != null ? z1.hi : z1.lo + 20) + 15;

  const second = last7.find(d => d.id !== overBand.id && d.type === 'easy') || last7[1];
  const z2 = app.executionHRTarget(second);
  second.actual.hr = (z2.hi != null ? z2.hi : z2.lo + 20) + 15;

  const nextQuality = days.find(d => d.date > today && ['interval', 'threshold', 'tempo'].includes(d.type));
  days.filter(d => d.date > today && d.date < nextQuality.date && d.type !== 'rest')
      .forEach(dd => fillNormally(app, dd));

  const dec = app.coachDecision();
  assert.ok(dec && dec.readinessEarned,
    'fixture must actually earn the check-in, or every test in this file is vacuous');
  return { app, days, today };
}

const panel = app => app.renderReadinessCheck(app.coachDecision());
/* `reasons` is the top THREE evidence lines -- what the card has room to
   print -- so a readiness answer can be genuinely counted and still not
   appear there. `evidenceCount` is the whole weighted set, which is what the
   decision is actually made from, so that is what these tests read when the
   question is "did the coach receive it". */
const evidence = app => app.coachDecision().evidenceCount;
const selectedCount = html => (html.match(/class="readiness-btn on"/g) || []).length;

// =====================================================================
// 1. THE DEFECT: one answer must not close the panel
// =====================================================================

test('an unanswered check-in asks all three questions', () => {
  const { app } = athleteWhoEarnedTheCheckIn();
  const dec = app.coachDecision();
  assert.equal(dec.needsReadiness, true);
  assert.equal(dec.readinessComplete, false);

  const html = panel(app);
  assert.match(html, /How are you today\?/);
  ['Legs', 'Sleep', 'Health'].forEach(l =>
    assert.ok(html.includes('>' + l + '</span>'), 'the ' + l + ' row must be asked'));
  assert.equal((html.match(/data-action="set-readiness"/g) || []).length, 8,
    'three legs options + three sleep + two health = eight');
  assert.equal(selectedCount(html), 0);
});

test('THE REGRESSION: one answer leaves the panel open, with that answer shown selected', () => {
  const { app } = athleteWhoEarnedTheCheckIn();
  app.handleSetReadiness('legs', 'heavy');

  const dec = app.coachDecision();
  assert.equal(dec.readinessComplete, false, 'one of three answers is not a complete check-in');
  assert.equal(dec.needsReadiness, true, 'the panel must still be asking the other two');

  const html = panel(app);
  assert.match(html, /How are you today\?/, 'the check-in must not disappear after the first tap');
  assert.ok(html.includes('data-rk="sleep"'), 'sleep must still be answerable');
  assert.ok(html.includes('data-rk="health"'), 'health must still be answerable');
  assert.equal(selectedCount(html), 1, 'the answer given must stay visibly selected');
  assert.match(html, /data-rk="legs" data-rv="heavy"/);
});

test('two answers still leave the panel open, with both shown selected', () => {
  const { app } = athleteWhoEarnedTheCheckIn();
  app.handleSetReadiness('legs', 'heavy');
  app.handleSetReadiness('sleep', 'poor');

  assert.equal(app.coachDecision().readinessComplete, false);
  assert.equal(app.coachDecision().needsReadiness, true);
  const html = panel(app);
  assert.match(html, /How are you today\?/);
  assert.equal(selectedCount(html), 2);
});

test('the three dimensions can be answered in any order', () => {
  const { app } = athleteWhoEarnedTheCheckIn();
  app.handleSetReadiness('health', 'good');
  assert.equal(app.coachDecision().readinessComplete, false, 'health alone is not complete');
  app.handleSetReadiness('sleep', 'ok');
  assert.equal(app.coachDecision().readinessComplete, false, 'health + sleep is not complete');
  app.handleSetReadiness('legs', 'normal');
  assert.equal(app.coachDecision().readinessComplete, true, 'all three, in any order, completes it');
});

test('an answer can be changed by choosing another option in the same dimension', () => {
  const { app } = athleteWhoEarnedTheCheckIn();
  app.handleSetReadiness('legs', 'heavy');
  app.handleSetReadiness('legs', 'fresh');
  assert.equal(app.coachReadinessToday().legs, 'fresh', 'the second choice replaces the first');
  const html = panel(app);
  assert.equal(selectedCount(html), 1, 'changing an answer must not leave two lit at once');
  assert.match(html, /data-rk="legs" data-rv="fresh"/);
});

test('readinessIsComplete refuses a value that is not one of the offered options', () => {
  const { app } = athleteWhoEarnedTheCheckIn();
  assert.equal(app.readinessIsComplete({ legs: 'heavy', sleep: 'poor', health: 'good' }), true);
  assert.equal(app.readinessIsComplete({ legs: 'heavy', sleep: 'poor', health: 'excellent' }), false,
    'a value outside the option set is not a valid answer');
  assert.equal(app.readinessIsComplete({ legs: 'heavy', sleep: 'poor', health: null }), false);
  assert.equal(app.readinessIsComplete(null), false);
});

// =====================================================================
// 2. THE COMPLETED STATE: confirm, do not vanish
// =====================================================================

test('a completed check-in collapses to a confirmation, not to nothing', () => {
  const { app } = athleteWhoEarnedTheCheckIn();
  app.handleSetReadiness('legs', 'heavy');
  app.handleSetReadiness('sleep', 'poor');
  app.handleSetReadiness('health', 'good');

  const dec = app.coachDecision();
  assert.equal(dec.readinessComplete, true);
  assert.equal(dec.needsReadiness, false, 'a complete check-in stops asking');
  assert.equal(dec.readinessEarned, true, 'but the block itself is still on the card');

  const html = panel(app);
  assert.notEqual(html, '', 'THE DEFECT: the completed check-in must not render as nothing');
  assert.doesNotMatch(html, /How are you today\?/, 'it should no longer be asking');
  assert.match(html, /check-in/i, 'it must say what it is');
  assert.match(html, /✓/, 'and confirm that it is done');
  assert.ok(html.includes('Heavy legs'), 'the recorded answers are shown back');
  assert.ok(html.includes('Poor sleep'));
  assert.ok(html.includes('Health good'));
});

test('the completed state is compact: one line of answers, not three rows of buttons', () => {
  const { app } = athleteWhoEarnedTheCheckIn();
  ['legs', 'sleep', 'health'].forEach((k, i) =>
    app.handleSetReadiness(k, ['fresh', 'good', 'good'][i]));
  const html = panel(app);
  assert.equal((html.match(/data-action="set-readiness"/g) || []).length, 0,
    'the finished state must not still be occupying the card with eight buttons');
  assert.ok(html.length < 500, 'the confirmation should be a line, not a panel');
});

test('the completed state is tappable, and reopens with the saved answers selected', () => {
  const { app } = athleteWhoEarnedTheCheckIn();
  app.handleSetReadiness('legs', 'heavy');
  app.handleSetReadiness('sleep', 'ok');
  app.handleSetReadiness('health', 'under');

  const collapsed = panel(app);
  assert.match(collapsed, /data-action="readiness-edit"/, 'the confirmation must be reopenable');
  assert.match(collapsed, /aria-expanded="false"/);

  app.handleReadinessEdit();
  const reopened = panel(app);
  assert.equal(selectedCount(reopened), 3, 'reopening shows the actual saved selections');
  assert.match(reopened, /data-rk="legs" data-rv="heavy"/);
  assert.match(reopened, /data-rk="sleep" data-rv="ok"/);
  assert.match(reopened, /data-rk="health" data-rv="under"/);
  assert.match(reopened, /aria-expanded="true"/);
  assert.doesNotMatch(reopened, /How are you today\?/,
    'a reopened finished check-in is not asking again, it is showing');

  app.handleReadinessEdit();
  assert.match(panel(app), /aria-expanded="false"/, 'and it folds back up');
});

test('amending a reopened answer persists, and is what the coach then reads', () => {
  const { app } = athleteWhoEarnedTheCheckIn();
  app.handleSetReadiness('legs', 'fresh');
  app.handleSetReadiness('sleep', 'good');
  app.handleSetReadiness('health', 'good');
  app.handleReadinessEdit();

  app.handleSetReadiness('health', 'under');
  assert.equal(app.coachReadinessToday().health, 'under', 'the correction is saved');
  assert.equal(app.coachDecision().readinessComplete, true, 'and it is still a complete check-in');
  assert.ok(app.coachDecision().reasons.some(r => /under the weather/i.test(r)),
    'the coach must act on the corrected value, not the one it was told first');

  assert.match(panel(app), /aria-expanded="true"/,
    'amending an already-complete check-in leaves the panel open under the thumb');
});

test('an amendment that empties a dimension makes the check-in partial again', () => {
  const { app } = athleteWhoEarnedTheCheckIn();
  app.handleSetReadiness('legs', 'heavy');
  app.handleSetReadiness('sleep', 'poor');
  app.handleSetReadiness('health', 'good');
  app.handleReadinessEdit();
  app.handleSetReadiness('health', 'good');   // re-tapping the same option clears it

  assert.equal(app.coachReadinessToday().health, null);
  assert.equal(app.coachDecision().readinessComplete, false,
    'two of three answers is a partial check-in, whichever direction it got there');
  assert.match(panel(app), /How are you today\?/, 'so the panel goes back to asking');
});

// =====================================================================
// 3. COACHING INTEGRITY: missing must stay missing
// =====================================================================

test('zero answers: the coach is given nothing, and invents nothing', () => {
  const { app } = athleteWhoEarnedTheCheckIn();
  assert.equal(app.coachReadinessToday(), null, 'no answers is null, not an empty-but-present record');
  const reasons = app.coachDecision().reasons.join(' | ');
  assert.doesNotMatch(reasons, /this morning/i,
    'nothing was reported this morning, so nothing may be attributed to this morning');
});

test('legs only: the answer given is read, the two not given stay missing', () => {
  const baseline = evidence(athleteWhoEarnedTheCheckIn().app);
  const { app } = athleteWhoEarnedTheCheckIn();
  app.handleSetReadiness('legs', 'heavy');

  const r = app.coachReadinessToday();
  assert.equal(r.legs, 'heavy', 'a partial answer still reaches the coach -- it is real evidence');
  assert.equal(r.sleep, undefined, 'sleep was not answered and must not be filled in');
  assert.equal(r.health, undefined, 'health was not answered and must not be filled in');
  assert.notEqual(r.sleep, 'good');
  assert.notEqual(r.health, 'good');

  assert.equal(evidence(app), baseline + 1, 'the one answer given adds exactly one line of evidence');
  const reasons = app.coachDecision().reasons.join(' | ');
  assert.doesNotMatch(reasons, /sleep/i, 'no sleep claim may be made from an unanswered sleep question');
  assert.doesNotMatch(reasons, /under the weather/i,
    'and no illness claim from an unanswered health question');
});

test('legs + sleep: both are read, health is still missing rather than healthy', () => {
  const baseline = evidence(athleteWhoEarnedTheCheckIn().app);
  const { app } = athleteWhoEarnedTheCheckIn();
  app.handleSetReadiness('legs', 'heavy');
  app.handleSetReadiness('sleep', 'poor');

  const r = app.coachReadinessToday();
  assert.equal(r.health, undefined,
    'an unanswered health question must never resolve to "good" -- that is the favourable default this forbids');

  assert.equal(evidence(app), baseline + 2, 'two answers, two lines of evidence -- and not a third');
  assert.doesNotMatch(app.coachDecision().reasons.join(' | '), /under the weather/i);
  assert.notEqual(app.coachDecision().state, 'recover',
    'an unanswered health question must not reach the safety decision that "under the weather" would');
});

test('all three: every answer reaches the coach with its existing meaning intact', () => {
  const { app } = athleteWhoEarnedTheCheckIn();
  app.handleSetReadiness('legs', 'heavy');
  app.handleSetReadiness('sleep', 'poor');
  app.handleSetReadiness('health', 'under');

  const reasons = app.coachDecision().reasons.join(' | ');
  assert.match(reasons, /under the weather/i, 'health under the weather is the safety line and must appear');
  assert.equal(app.coachDecision().state, 'recover',
    'under the weather is weight-10 safety: it must still reach RECOVER exactly as before');
  assert.equal(evidence(app), evidence(athleteWhoEarnedTheCheckIn().app) + 3,
    'all three answers are counted, each once');
});

test('THE SUPPRESSED SAFETY SIGNAL: health is reachable after answering legs first', () => {
  /* The whole point. Before the fix, tapping Legs closed the panel, so an
     athlete who felt ill could not tell the coach unless they happened to
     answer the third question first. */
  const { app } = athleteWhoEarnedTheCheckIn();
  app.handleSetReadiness('legs', 'fresh');
  assert.ok(panel(app).includes('data-rk="health"'),
    'health must still be on the panel after legs was answered');
  app.handleSetReadiness('health', 'under');
  assert.equal(app.coachDecision().state, 'recover',
    'and answering it must still reach the safety decision');
});

test('a favourable answer is not manufactured from silence anywhere in the record', () => {
  const { app, days, today } = athleteWhoEarnedTheCheckIn();
  app.handleSetReadiness('sleep', 'poor');
  const dd = days.find(d => d.date === today);
  assert.deepEqual(Object.keys(dd.readiness).sort(), ['sleep'],
    'only the dimension actually answered is written to the day record');
  assert.equal(app.readinessIsComplete(dd.readiness), false);
});

// =====================================================================
// 4. PERSISTENCE AND DATE SEMANTICS
// =====================================================================

test('answers are written to today’s day record, and travel in the synced plan', () => {
  const { app, days, today } = athleteWhoEarnedTheCheckIn();
  app.handleSetReadiness('legs', 'heavy');
  app.handleSetReadiness('sleep', 'poor');
  app.handleSetReadiness('health', 'good');

  const dd = days.find(d => d.date === today);
  assert.deepEqual({ ...dd.readiness }, { legs: 'heavy', sleep: 'poor', health: 'good' });

  const sig = String(app.planContentSignature(app.state));
  assert.match(sig, /"legs":"heavy"/, 'readiness is part of the plan the athlete’s account syncs');
  assert.match(sig, /"health":"good"/);
});

test('the answers survive a reload', () => {
  const { app } = athleteWhoEarnedTheCheckIn();
  app.handleSetReadiness('legs', 'heavy');
  app.handleSetReadiness('sleep', 'ok');
  app.handleSetReadiness('health', 'under');

  const restored = loadApp({ pinnedDate: PINNED });
  restored.state = JSON.parse(JSON.stringify(app.state));
  const r = restored.coachReadinessToday();
  assert.equal(r.legs, 'heavy');
  assert.equal(r.sleep, 'ok');
  assert.equal(r.health, 'under');
  assert.equal(restored.readinessIsComplete(r), true);
});

test('a PARTIAL check-in survives a reload as partial, not promoted to complete', () => {
  const { app } = athleteWhoEarnedTheCheckIn();
  app.handleSetReadiness('legs', 'heavy');

  const restored = loadApp({ pinnedDate: PINNED });
  restored.state = JSON.parse(JSON.stringify(app.state));
  assert.equal(restored.readinessIsComplete(restored.coachReadinessToday()), false);
  assert.equal(restored.coachDecision().needsReadiness, true,
    'a reload must not turn one answer into a finished readiness assessment');
});

test('yesterday’s answers cannot masquerade as today’s', () => {
  const { app, days, today } = athleteWhoEarnedTheCheckIn();
  const yesterday = days.find(d => d.date === app.addDays(today, -1));
  assert.ok(yesterday, 'fixture needs a day record for yesterday');
  yesterday.readiness = { legs: 'heavy', sleep: 'poor', health: 'under' };

  assert.equal(app.coachReadinessToday(), null,
    'a full check-in given yesterday is not this morning’s answer');
  assert.equal(app.coachDecision().readinessComplete, false);
  assert.match(panel(app), /How are you today\?/, 'so today is still asked');
});

test('a device-local answer from another date is not read as today’s either', () => {
  const app = app0();
  buildPlan(app, { weeks: 8 });
  app.state.days = [];                                   // no plan day for today
  app.state.readiness = { date: app.addDays(app.todayStr(), -1), legs: 'heavy' };
  assert.equal(app.coachReadinessToday(), null);
});

test('reopening after a reload shows the saved selections, not blanks', () => {
  const { app } = athleteWhoEarnedTheCheckIn();
  app.handleSetReadiness('legs', 'normal');
  app.handleSetReadiness('sleep', 'good');
  app.handleSetReadiness('health', 'good');

  const restored = loadApp({ pinnedDate: PINNED });
  restored.state = JSON.parse(JSON.stringify(app.state));
  assert.match(panel(restored), /Legs normal/, 'the confirmation reads back what was saved');
  restored.handleReadinessEdit();
  assert.equal(selectedCount(panel(restored)), 3);
});

// =====================================================================
// 5. CONSENT AND VISUAL LANGUAGE
// =====================================================================

test('without health consent the check-in is neither asked nor accepted', () => {
  const app = app0();
  buildPlan(app, { weeks: 8, healthConsent: false });
  assert.equal(app.renderReadinessCheck({ readinessEarned: true, readinessComplete: false }), '',
    'the question is not put to an athlete who has not agreed to it');
  app.handleSetReadiness('legs', 'heavy');
  assert.equal(app.coachReadinessToday(), null, 'and an answer forced past the UI is not stored either');
});

test('the selected state is the brand accent, taken from a token, and is not gold', () => {
  const CODE = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const i = CODE.indexOf('.readiness-btn.on{');
  assert.ok(i > 0, 'the selected-state rule must exist');
  const body = CODE.slice(i, CODE.indexOf('}', i));
  assert.match(body, /var\(--cherry[a-z-]*\)/,
    'a selected control is SELECTED BRAND STATE and must reach its colour through the accent token');
  assert.doesNotMatch(body, /--modal-active/,
    'gold is the identity colour -- headings, cards, borders -- not the colour of a choice the athlete made');
  assert.doesNotMatch(body, /#[0-9a-f]{3,8}/i, 'and it must not hard-code a colour');
});

test('the check-in introduces no purple: the retired violet does not come back through it', () => {
  const CODE = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const start = CODE.indexOf('.readiness{');
  const end = CODE.indexOf('/* ---------- week status');
  assert.ok(start > 0 && end > start);
  const block = CODE.slice(start, end);
  assert.doesNotMatch(block, /--violet|#A88FD8|#4C2A6B|#B79FDF/i,
    'Cherry Lacquer replaced the Valhalla violet; the check-in must not reintroduce it');
});

test('the option chips are a real tap target on a phone', () => {
  const CODE = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const i = CODE.indexOf('.readiness-btn{');
  const body = CODE.slice(i, CODE.indexOf('}', i));
  const m = body.match(/min-height:(\d+)px/);
  assert.ok(m, 'the chips must declare a minimum height');
  assert.ok(Number(m[1]) >= 24,
    'WCAG 2.5.8 asks 24px; these were an 18px target before this change');
});
