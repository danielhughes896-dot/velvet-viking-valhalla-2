'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// PHASE 4 WORKSTREAM 2 -- Q, R, S and the proposal lifecycle under attack.
//
// A proposal is a promise made on a screen and kept some seconds later. In
// between, an athlete can log a session, edit a distance, answer a readiness
// question, cross midnight, or have Strava import a run. The question these
// tests ask is not "does accept work" but "can accept ever do something the
// athlete did not agree to, or refuse something they did".
const TODAY = '2026-05-20';
const app = () => loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
const D = n => new Date(Date.UTC(2026, 4, 20) + n * 86400000).toISOString().slice(0, 10);
const day = (date, type, km, extra) =>
  Object.assign({ id: date, date, type, km, mpSegment: false }, extra || {});

/* A horizon that reliably produces a hierarchy proposal: a KEY session with a
   cheap optional run in front of it, and enough missed key work to move the
   engine off HOLD without inventing an internal state. */
function proposingPlan(a) {
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -21) });
  a.state.days = [
    day(a.addDays(TODAY, -1), 'threshold', 10),      // missed KEY -> recoverable
    day(D(1), 'easy', 5),                            // OPTIONAL, the safe slot
    day(D(2), 'rest', 0),
    day(D(4), 'long', 20)
  ];
  return a;
}
const toastsOf = a => { const t = []; a.showToast = m => t.push(m); return t; };

// ---------------------------------------------------------------------------
// Q. A DECLINE IS RESPECTED UNTIL THE EVIDENCE MOVES
// ---------------------------------------------------------------------------
test('Q. the same evidence does not ask twice', () => {
  const a = proposingPlan(app());
  toastsOf(a);
  const ev = a.planEvolution();
  assert.ok(ev.changes.length, 'the fixture must actually propose something');
  assert.equal(a.evolutionProposalVisible(ev), true);

  a.handleDeclineEvolution();
  assert.equal(a.state.evolution.declinedHash, ev.evidenceHash);
  assert.equal(a.evolutionProposalVisible(a.planEvolution()), false,
    'never asked again for the same reasons, and never counted against the athlete');
});

test('Q. a decline survives a reload', () => {
  const a = proposingPlan(app());
  toastsOf(a);
  a.handleDeclineEvolution();
  a.persistStateLocalOnly();
  const raw = a.localStorage.getItem('velvet-viking-generator-v2');

  const b = app();
  b.localStorage.setItem('velvet-viking-generator-v2', raw);
  b.loadState();
  assert.equal(b.evolutionProposalVisible(b.planEvolution()), false,
    'a decline the athlete gave yesterday is still theirs today');
});

test('Q. materially changed evidence legitimately asks again', () => {
  const a = proposingPlan(app());
  toastsOf(a);
  const declined = a.planEvolution().evidenceHash;
  a.handleDeclineEvolution();

  // a second key session goes unlogged -- genuinely new evidence
  a.state.days.push(day(a.addDays(TODAY, -2), 'interval', 9));
  const next = a.planEvolution();
  assert.notEqual(next.evidenceHash, declined, 'the evidence really did change');
  assert.equal(a.evolutionProposalVisible(next), true,
    'a decline is a statement about one proposal, not a permanent veto');
});

test('Q. a trivial change does not manufacture a fresh question', () => {
  const a = proposingPlan(app());
  toastsOf(a);
  a.handleDeclineEvolution();
  // nothing about the training changes: a render, a tab switch, a repaint
  for (let i = 0; i < 5; i++)
    assert.equal(a.evolutionProposalVisible(a.planEvolution()), false,
      'proposal churn is how an athlete learns to ignore the coach');
});

test('Q. the two decline ledgers are independent', () => {
  const a = proposingPlan(app());
  toastsOf(a);
  a.handleDeclineEvolution();
  assert.ok(a.state.evolution.declinedHash);
  assert.equal((a.state.playbook || {}).declinedHash, undefined,
    'a Playbook proposal keeps its own record so the two never overwrite each other');
});

// ---------------------------------------------------------------------------
// R. ACCEPTANCE
// ---------------------------------------------------------------------------
test('R. accepting writes the adjustment, the history and the ledger', () => {
  const a = proposingPlan(app());
  toastsOf(a);
  const ev = a.planEvolution();
  const target = ev.changes[0];
  a.handleAcceptEvolution();

  const dd = a.findDay(target.dayId);
  assert.ok(dd.coachAdjust, 'the day records that a coaching decision changed it');
  assert.equal(dd.coachAdjust.source, 'evolution');
  assert.equal(dd.coachAdjust.state, ev.state);
  assert.ok(dd.coachAdjust.from, 'and what it was before, so it stays reversible');

  const h = a.state.evolutionHistory.slice(-1)[0];
  assert.equal(h.accepted, true);
  assert.equal(h.evidenceHash, ev.evidenceHash);
  assert.equal(h.originalPlanHash, ev.originalPlanHash);
  assert.ok(h.evolvedPlanHash);
  assert.equal(a.state.evolution.lastAcceptedHash, ev.evidenceHash);
  assert.equal(a.state.evolution.declinedHash, null, 'accepting clears any earlier decline');
});

test('R. accepting never touches a logged session', () => {
  const a = proposingPlan(app());
  toastsOf(a);
  const logged = day(D(1), 'easy', 5, { completed: true,
    stravaActivityId: '55443322',
    actual: { km: 5.2, pace: '5:31', hr: 141, rpe: 4, notes: 'steady' } });
  a.state.days = [a.state.days[0], logged, a.state.days[2], a.state.days[3]];
  const before = JSON.stringify(logged);
  a.handleAcceptEvolution();
  assert.equal(JSON.stringify(a.findDay(D(1))), before,
    'the athlete\'s own record of a run is not the coach\'s to edit');
});

test('R. an accepted change survives persistence and reload intact', () => {
  const a = proposingPlan(app());
  toastsOf(a);
  a.handleAcceptEvolution();
  const adjusted = a.state.days.filter(d => d.coachAdjust)[0];
  assert.ok(adjusted);
  a.persistStateLocalOnly();

  const b = app();
  b.localStorage.setItem('velvet-viking-generator-v2',
    a.localStorage.getItem('velvet-viking-generator-v2'));
  b.loadState();
  const back = b.findDay(adjusted.id);
  assert.equal(back.km, adjusted.km);
  assert.equal(back.type, adjusted.type);
  assert.ok(back.coachAdjust, 'and it is still recorded as a coaching decision');
  assert.equal(b.state.evolutionHistory.length, 1);
});

test('R. accepting creates no duplicate day and loses none', () => {
  const a = proposingPlan(app());
  toastsOf(a);
  const before = a.state.days.map(d => d.id).sort();
  a.handleAcceptEvolution();
  const after = a.state.days.map(d => d.id).sort();
  assert.deepEqual(after, before, 'a reshape moves content between days; it never adds or drops one');
  assert.equal(new Set(after).size, after.length);
});

test('R. a reschedule carries the workout, not the log', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -21) });
  a.state.days = [
    day(a.addDays(TODAY, -1), 'threshold', 10, { desc: 'thr desc',
      prescription: { v: 1, archetype: 'steady_tempo', params: { min: 20 } } }),
    day(D(1), 'easy', 5),
    day(D(4), 'long', 20)
  ];
  toastsOf(a);
  const ev = a.planEvolution();
  const resched = ev.changes.filter(c => c.kind === 'reschedule')[0];
  assert.ok(resched, 'the fixture must produce a reschedule');
  a.handleAcceptEvolution();
  const slot = a.findDay(resched.dayId);
  assert.equal(slot.type, 'threshold');
  assert.equal(slot.desc, 'thr desc');
  assert.equal(slot.prescription.archetype, 'steady_tempo', 'the structure travels with the session');
  assert.ok(!slot.completed, 'and no completion is invented on the way');
  assert.ok(!slot.stravaActivityId, 'and no attachment is fabricated');
});

// ---------------------------------------------------------------------------
// S. HIERARCHY AND PLAYBOOK NEVER SPEAK AT ONCE
// ---------------------------------------------------------------------------
test('S. one proposal object, one source, never both', () => {
  const a = proposingPlan(app());
  const ev = a.planEvolution();
  if (ev.playbook){
    assert.ok(ev.state === 'PROGRESS' || ev.state === 'ADAPT');
    assert.equal(ev.changes.length, 1, 'a Playbook proposal is exactly one change');
  } else {
    assert.equal(ev.playbook, undefined);
  }
});

test('S. the Playbook is never consulted from ADAPT or RECOVER', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -21) });
  const today = a.state.days.filter(d => d.date === TODAY)[0];
  today.readiness = { health: 'under' };
  const ev = a.planEvolution();
  assert.equal(ev.state, 'RECOVER');
  assert.equal(ev.playbook, undefined,
    'a second opinion arriving beside a reduction is the two-engine problem');
});

test('S. a Playbook PROGRESS cannot come from an unclean coach state', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -21) });
  const today = a.state.days.filter(d => d.date === TODAY)[0];
  today.readiness = { legs: 'heavy', sleep: 'poor' };
  const ev = a.planEvolution();
  assert.notEqual(ev.state, 'PROGRESS');
});

// ---------------------------------------------------------------------------
// STALENESS -- WHAT HAPPENS BETWEEN THE SCREEN AND THE TAP
// ---------------------------------------------------------------------------
test('accepting after the target session was completed changes nothing', () => {
  const a = proposingPlan(app());
  const toasts = toastsOf(a);
  const ev = a.planEvolution();
  const target = a.findDay(ev.changes[0].dayId);
  const km = target.km;
  target.completed = true;
  target.actual = { km: km, pace: '5:30', hr: 140, rpe: 4, notes: '' };

  a.handleAcceptEvolution();
  assert.equal(a.findDay(target.id).km, km, 'a run that happened is not reshaped');
  assert.ok(!a.findDay(target.id).coachAdjust);
  assert.ok(!/Plan evolved/.test(toasts.join(' ')),
    'and the athlete is not told the plan evolved when nothing did');
});

test('accepting applies only what the athlete agreed to', () => {
  const a = proposingPlan(app());
  toastsOf(a);
  const shown = a.planEvolution();
  const shownId = shown.proposalId;

  // Between render and tap the plan changes materially: the safe slot the
  // proposal was going to use gets logged, so the engine's answer moves.
  a.findDay(D(1)).completed = true;
  a.findDay(D(1)).actual = { km: 5, pace: '5:30', hr: 140, rpe: 4, notes: '' };

  const now = a.planEvolution();
  if (now.changes.length && JSON.stringify(now.changes) !== JSON.stringify(shown.changes)){
    a.handleAcceptEvolution(shownId);
    const applied = a.state.days.filter(d => d.coachAdjust);
    assert.equal(applied.length, 0,
      'the proposal on screen is the only thing an Accept may apply');
  }
});

test('the proposal identity changes when the proposal does', () => {
  const a = proposingPlan(app());
  const first = a.planEvolution();
  assert.ok(first.proposalId, 'a proposal an athlete can accept must be identifiable');
  a.state.days.push(day(a.addDays(TODAY, -2), 'interval', 9));
  const second = a.planEvolution();
  assert.notEqual(second.proposalId, first.proposalId);
});

test('the identity is stable while nothing changes', () => {
  const a = proposingPlan(app());
  assert.equal(a.planEvolution().proposalId, a.planEvolution().proposalId,
    'an id that moved on its own would make every accept fail');
});

test('declining something that is no longer on screen records nothing', () => {
  const a = proposingPlan(app());
  toastsOf(a);
  const stale = a.planEvolution().proposalId;
  a.state.days.push(day(a.addDays(TODAY, -2), 'interval', 9));
  const before = (a.state.evolution || {}).declinedHash || null;
  a.handleDeclineEvolution(stale);
  assert.equal((a.state.evolution || {}).declinedHash || null, before,
    'recording a decline against evidence the athlete never saw silences a question never asked');
});

test('a manual edit between proposal and acceptance is never overwritten', () => {
  const a = proposingPlan(app());
  toastsOf(a);
  const shown = a.planEvolution();
  const targetId = shown.changes[0].dayId;
  const dd = a.findDay(targetId);
  dd.km = 3;                                   // the athlete shortened it themselves
  dd.manualEdit = { at: 'x', fields: ['km'], from: { km: 5 } };

  a.handleAcceptEvolution(shown.proposalId);
  assert.equal(a.findDay(targetId).km, 3,
    'the athlete already answered this question with their own edit');
});

test('crossing midnight does not let yesterday\'s proposal apply today', () => {
  const a = proposingPlan(app());
  toastsOf(a);
  const yesterdayId = a.planEvolution().proposalId;
  const b = loadApp({ pinnedDate: a.addDays(TODAY, 1) + 'T09:00:00Z' });
  a.persistStateLocalOnly();
  b.localStorage.setItem('velvet-viking-generator-v2',
    a.localStorage.getItem('velvet-viking-generator-v2'));
  b.loadState();
  b.showToast = () => {};
  const todayProposal = b.planEvolution();
  if (todayProposal.proposalId !== yesterdayId){
    b.handleAcceptEvolution(yesterdayId);
    assert.equal(b.state.days.filter(d => d.coachAdjust).length, 0,
      'the horizon moved, so the question moved with it');
  }
});

// ---------------------------------------------------------------------------
// THE HASHES THEMSELVES
// ---------------------------------------------------------------------------
test('the evidence hash ignores the clock and the render count', () => {
  const a = proposingPlan(app());
  const h = a.planEvolution().evidenceHash;
  for (let i = 0; i < 4; i++) a.planEvolution();
  assert.equal(a.planEvolution().evidenceHash, h);
});

test('the plan-shape hash moves when the plan does, and only then', () => {
  const a = proposingPlan(app());
  const before = a.planEvolution().originalPlanHash;
  a.findDay(D(4)).title = 'A different name for the same run';
  assert.equal(a.planEvolution().originalPlanHash, before,
    'a title is not plan shape');
  a.findDay(D(4)).km = 22;
  assert.notEqual(a.planEvolution().originalPlanHash, before,
    'a distance is');
});

test('the evolved hash differs from the original exactly when something changes', () => {
  const a = proposingPlan(app());
  const ev = a.planEvolution();
  if (ev.changes.length) assert.notEqual(ev.evolvedPlanHash, ev.originalPlanHash);
  const b = app();
  buildPlan(b, { weeks: 12, startDate: TODAY });
  const none = b.planEvolution();
  assert.equal(none.changes.length, 0);
  assert.equal(none.evolvedPlanHash, none.originalPlanHash);
});

// ---------------------------------------------------------------------------
// THE WIRING THAT MAKES THE IDENTITY LOAD-BEARING
// ---------------------------------------------------------------------------
/* Source assertions, and deliberately so: whether the card actually hands the
   identity to the handler cannot be observed from the engine, and if it stops
   doing so the protection above silently becomes optional. */
test('both proposal sources put their identity and their source on the buttons', () => {
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const at = src.indexOf("data-action=\"accept-evolution\"");
  const card = src.slice(at - 300, at + 900);
  assert.match(card, /data-source="'\+\(ev\.playbook \? 'playbook' : 'evolution'\)\+'"/,
    'the dispatcher must route on the source, not on whether an id exists');
  assert.match(card, /data-proposal="'\+escapeHtml\(ev\.proposalId\)/);
});

test('the dispatcher sends each source to its own handler', () => {
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  assert.match(src, /data-source'\)==='playbook'\) handleAcceptPlaybook\(shownA\);\s*\n\s*else handleAcceptEvolution\(shownA\)/);
  assert.match(src, /data-source'\)==='playbook'\) handleDeclinePlaybook\(shownD\);\s*\n\s*else handleDeclineEvolution\(shownD\)/);
});

test('a stale accept leaves the ledger untouched as well as the plan', () => {
  const a = proposingPlan(app());
  toastsOf(a);
  const stale = a.planEvolution().proposalId;
  a.state.days.push(day(a.addDays(TODAY, -2), 'interval', 9));
  a.handleAcceptEvolution(stale);
  assert.equal((a.state.evolution || {}).lastAcceptedHash, undefined,
    'a refused accept must not record itself as an acceptance');
  assert.equal((a.state.evolutionHistory || []).length, 0);
});

test('the athlete is told why nothing happened rather than left guessing', () => {
  const a = proposingPlan(app());
  const toasts = toastsOf(a);
  const stale = a.planEvolution().proposalId;
  a.state.days.push(day(a.addDays(TODAY, -2), 'interval', 9));
  a.handleAcceptEvolution(stale);
  assert.match(toasts.join(' '), /Something changed/i);
  assert.ok(!/failed|error|wrong/i.test(toasts.join(' ')),
    'nothing went wrong — the question simply moved');
});
