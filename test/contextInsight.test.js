'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* CONTEXT INSIGHT V1.
 * ===========================================================================
 * An insight explains something that has just become TRUE FOR THIS ATHLETE.
 * Every rule in this file is a rule about NOT speaking: earned by a
 * transition rather than a date, shown once, one a day, never queued, never
 * in the opening week, never over a decision the athlete owes an answer to,
 * and abandoned entirely once they have shown three times that they are not
 * interested.
 */

const TODAY = '2026-11-01';
function app(startOffset){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey:'half', volume:55, weeks:14, lthr:172, maxHR:188,
                 startDate: a.addDays(TODAY, startOffset == null ? -35 : startOffset) });
  a.state.setup.purpose = 'race';
  return a;
}
const blockKey = a => 'programme:' + a.insightBlockKey();
/* Clear the programme insight the way an athlete would -- by answering it --
   and let the day roll, so the next transition can be examined. */
function pastTheFirst(a){
  a.insightRecord(blockKey(a), true);
  a.state.insights.shownOn = null;
  return a;
}

// ===========================================================================
// 1. IT IS EARNED BY A TRANSITION
// ===========================================================================

test('a freshly built programme earns the first explanation', () => {
  const a = app();
  const ins = a.contextInsightDue();
  assert.ok(ins, 'nothing offered at all');
  assert.equal(ins.kind, 'programme');
  assert.ok(ins.paras.length >= 2 && ins.title);
});

test('a phase boundary is explained, and only on the week it happens', () => {
  // the fixture's first boundary is Base -> Build
  const probe = app();
  let boundary = null;
  for (let w = 2; w <= 14; w++)
    if (probe.trainingPhase(w) !== probe.trainingPhase(w - 1)) { boundary = w; break; }
  assert.ok(boundary, 'the fixture has no phase boundary to find');

  const on = pastTheFirst(app(-((boundary - 1) * 7 + 1)));
  assert.equal(on.currentWeekNum(), boundary);
  const ins = on.contextInsightDue();
  assert.ok(ins && ins.kind === 'phase', 'the boundary week explains nothing');
  assert.match(ins.title, /different/i);

  // the week after is not a boundary and says nothing
  const after = pastTheFirst(app(-(boundary * 7 + 1)));
  assert.equal(after.currentWeekNum(), boundary + 1);
  const none = after.contextInsightDue();
  assert.ok(!none || none.kind !== 'phase', 'a non-boundary week explained a phase change');
});

test('a workout family the athlete has never met is explained the day BEFORE', () => {
  const a = pastTheFirst(app());
  const tomorrow = a.addDays(TODAY, 1);
  const d = a.state.days.filter(x => x.date === tomorrow)[0];
  assert.ok(d, 'the fixture has no day tomorrow');
  d.type = 'over_under'; d.title = 'Over-Under: 3x(1km/1km)';
  d.prescription = { v:a.PRESCRIPTION_VERSION, archetype:'over_under', params:{ cycles:3 } };
  const ins = a.contextInsightDue();
  assert.ok(ins && ins.kind === 'workout', 'an unfamiliar session arrived unannounced');
  assert.match(ins.paras[0], /first Over-Under/);
  // and never twice: once the athlete has run one, it is not new any more
  const b = pastTheFirst(app());
  const done = b.state.days.filter(x => x.date < TODAY && x.type !== 'rest')[0];
  done.completed = true;
  done.prescription = { v:b.PRESCRIPTION_VERSION, archetype:'over_under', params:{ cycles:3 } };
  const dTom = b.state.days.filter(x => x.date === tomorrow)[0];
  dTom.prescription = { v:b.PRESCRIPTION_VERSION, archetype:'over_under', params:{ cycles:3 } };
  const again = b.contextInsightDue();
  assert.ok(!again || again.kind !== 'workout', 'a family they have already run was introduced again');
});

test('a measured threshold, and a return from a restriction, both explain themselves', () => {
  const a = pastTheFirst(app());
  a.state.setup.thresholdPaceSource = 'calibration';
  a.state.setup.thresholdPaceSecPerKm = 277;
  const t = a.contextInsightDue();
  assert.ok(t && t.kind === 'threshold');
  assert.ok(t.paras.join(' ').indexOf(a.fmtPaceFromSecPerKm(277)) !== -1,
    'the measured pace itself is not in the copy');

  const b = pastTheFirst(app());
  b.declareRestriction('none', b.addDays(TODAY, 10));
  b.state.setup.restriction.from = b.addDays(TODAY, -14);
  b.endRestriction();
  const r = b.contextInsightDue();
  assert.ok(r && r.kind === 'restriction_return');
  assert.match(r.paras.join(' '), /not a debt/);
});

// ===========================================================================
// 2. EVERY RULE ABOUT NOT SPEAKING
// ===========================================================================

test('nothing is said in the opening week of a plan', () => {
  assert.equal(app(-3).contextInsightDue(), null);
  assert.equal(app(-3).insightSuppressed(), 'opening_week');
});

test('one a day, however many became true', () => {
  const a = app();
  assert.ok(a.contextInsightDue());
  a.insightRecord(blockKey(a), true);
  assert.equal(a.contextInsightDue(), null);
  assert.equal(a.insightSuppressed(), 'one_a_day');
});

test('the same transition is never explained twice', () => {
  const a = app();
  const key = a.contextInsightDue().key;
  a.insightRecord(key, true);
  a.state.insights.shownOn = null;                 // a new day
  const next = a.contextInsightDue();
  assert.ok(!next || next.key !== key, 'the same transition came back');
  assert.ok(a.insightSeen(key));
});

test('there is no queue: what did not fire is dropped, not stored', () => {
  const a = app();
  const all = a.insightCandidates();
  // make a second trigger true alongside the programme one
  a.state.setup.thresholdPaceSource = 'calibration';
  a.state.setup.thresholdPaceSecPerKm = 277;
  assert.ok(a.insightCandidates().length >= 2, 'the fixture has only one candidate');
  const first = a.contextInsightDue();
  assert.equal(first.kind, 'programme', 'priority order is not largest-change-first');
  a.insightRecord(first.key, true);
  a.state.insights.shownOn = null;
  // the second is shown only because it is STILL true, not because it queued
  const second = a.contextInsightDue();
  assert.equal(second.kind, 'threshold');
  a.state.setup.thresholdPaceSource = null;        // it stops being true
  a.state.insights.shownOn = null;
  assert.equal(a.contextInsightDue(), null, 'a trigger that stopped being true was still delivered');
});

test('a decision the athlete owes an answer to owns the screen', () => {
  const r = app();
  r.declareRestriction('easy', r.addDays(TODAY, 10));
  assert.equal(r.insightSuppressed(), 'restriction_open');
  assert.equal(r.contextInsightDue(), null);

  const o = app();
  o.state.setup.raceDate = o.addDays(TODAY, -1);    // goal day has passed, unanswered
  assert.equal(o.insightSuppressed(), 'race_outcome_pending');
  assert.equal(o.contextInsightDue(), null);
});

test('three dismissals without a single acknowledgement ends them for the block', () => {
  const a = app();
  for (let i = 0; i < 2; i++){ a.insightRecord('k' + i, false); a.state.insights.shownOn = null; }
  assert.ok(a.contextInsightDue(), 'gave up too early');
  a.insightRecord('k2', false);
  a.state.insights.shownOn = null;
  assert.equal(a.contextInsightDue(), null);
  assert.equal(a.insightSuppressed(), 'athlete_declined');
  // acknowledging resets the patience counter
  const b = app();
  b.insightRecord('x1', false); b.insightRecord('x2', true); b.insightRecord('x3', false);
  b.state.insights.shownOn = null;
  assert.ok(b.contextInsightDue(), 'an acknowledgement did not reset the count');
});

// ===========================================================================
// 3. THE SURFACE, AND WHAT IT TRAVELS WITH
// ===========================================================================

test('it renders as a modal with one acknowledgement and one close', () => {
  const a = app();
  const html = a.renderContextInsight(a.contextInsightDue());
  assert.match(html, /data-action="insight-ack"/);
  assert.match(html, /data-action="insight-dismiss"/);
  assert.match(html, /class="ci-para"/);
  // it carries no training controls: it explains, it does not ask for a decision
  ['start-block','checkpoint-accept','restriction-confirm','race-outcome','save-edit']
    .forEach(act => assert.doesNotMatch(html, new RegExp('data-action="' + act + '"'),
      'the explanation carries the ' + act + ' control'));
});

test('the ledger travels between devices', () => {
  const a = app();
  const before = a.planContentSignature(a.state);
  a.insightRecord(blockKey(a), true);
  assert.notEqual(a.planContentSignature(a.state), before,
    'an insight shown on one device would be shown again on another');
});

test('no insight invents a training claim or an absolute', () => {
  /* HQ: confident where the methodology supports confidence, never more.
     The absolutes below are the shapes that slipped into the first draft. */
  const kinds = [];
  const a = app();
  kinds.push(a.contextInsightDue());
  const b = pastTheFirst(app());
  b.state.setup.thresholdPaceSource = 'calibration'; b.state.setup.thresholdPaceSecPerKm = 277;
  kinds.push(b.contextInsightDue());
  const c = pastTheFirst(app());
  c.declareRestriction('none', c.addDays(TODAY, 10));
  c.state.setup.restriction.from = c.addDays(TODAY, -14); c.endRestriction();
  kinds.push(c.contextInsightDue());
  const text = kinds.filter(Boolean).map(i => i.title + ' ' + i.paras.join(' ')).join(' ');
  assert.ok(text.length > 0);
  [/the most useful/i, /the best way/i, /guarantee/i, /always works/i, /never fails/i,
   /scientifically/i, /proven to/i].forEach(re =>
    assert.doesNotMatch(text, re, 'an exaggerated coaching claim got in'));
});

test('no insight is ever offered with nothing in it', () => {
  /* Swept across the whole block rather than sampled, because the hole this
     catches was at the very end of one: Taper -> Race Week has no phase copy
     written for it, insightPhaseParas returned null, and null.length threw
     inside insightCopy. renderApp's try/catch swallowed that, so the symptom
     was not a blank card but SILENCE -- no insight of any kind for the rest of
     the block, with nothing in the log to say so. */
  const phasesSeen = {};
  for (let off = -7; off >= -104; off -= 7){
    const c = app(off);
    const wk = c.currentWeekNum();
    if (wk) phasesSeen[c.trainingPhase(wk)] = true;
    c.insightCandidates().forEach(cand => {
      const copy = c.insightCopy(cand);
      assert.ok(copy && copy.paras.length,
        'a ' + cand.kind + ' insight would open an empty card in week ' + wk);
      copy.paras.forEach(t => assert.ok(t && t.trim(),
        'a blank paragraph reached the ' + cand.kind + ' card in week ' + wk));
    });
  }
  assert.ok(phasesSeen['Race Week'] || phasesSeen['Final Week'],
    'the sweep never reached the end of the block, so it proves nothing about it');
});

test('the week an athlete races is not interrupted by a phase insight', () => {
  /* Either label: the plan calls the last week Race Week when it has a real
     event on it and Final Week when the goal is a date rather than a start
     line. Neither has phase copy, so neither may be offered one. */
  const last = p => p === 'Race Week' || p === 'Final Week';
  let raceWeek = null;
  for (let off = -70; off >= -119 && !raceWeek; off--){
    const c = app(off);
    const wk = c.currentWeekNum();
    if (wk && wk > 1 && last(c.trainingPhase(wk)) && !last(c.trainingPhase(wk - 1)))
      raceWeek = c;
  }
  assert.ok(raceWeek, 'the fixture never put today in the week it races');
  assert.equal(raceWeek.insightCandidates().filter(c => c.kind === 'phase').length, 0,
    'race week was offered a phase insight. If copy has since been written for it, ' +
    'that is a new athlete-facing screen in the worst week to get one wrong — it ' +
    'needs a frame and a decision, not a passing test.');
});
