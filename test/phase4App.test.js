'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// PHASE 4 -- THE APP HALF.
//
// The System pass proved the engine is right. None of that is re-litigated
// here. What these tests hold is the layer between a correct decision and an
// athlete who has to act on it: whether the five states are said in words a
// runner uses, whether a reshape explains itself as well as a step-up does,
// whether an accepted change is still visible afterwards, whether the coach's
// adjustment is distinguishable from the athlete's own edit, and whether the
// Restore the interface now offers is the same Restore the handler will honour.
//
// The rule throughout: the interface may not claim anything the System did not
// compute, and may not withhold anything the System did.
const TODAY = '2026-05-20';
const app = () => loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
function plan(a, opts) {
  buildPlan(a, Object.assign({ weeks: 12, startDate: a.addDays(TODAY, -28) }, opts || {}));
  a.showToast = () => {};
  return a;
}
const pastRuns = (a, n) => a.state.days
  .filter(d => d.date < TODAY && d.type !== 'rest').slice(-n);
function log(a, dd, actual) {
  dd.completed = true;
  dd.actual = Object.assign(a.emptyActual(), { km: dd.km }, actual || {});
  return dd;
}
/* TWO DIFFERENT ENGINES REACH THIS UI, and the tests have to be explicit about
   which one they are exercising.

   `fatigued` is accumulated fatigue: the coach lands on `check`, which is a
   state the hierarchy has nothing to do about, so the Playbook is consulted
   and a REGRESS step-down comes back. That is the proposal that already
   explained itself.

   `hurting` is a reported pain signal, which the coach answers with `recover`
   -- and `recover` never reaches the Playbook by design, so the change is
   produced by evolutionChanges() itself. That is the hierarchy proposal, the
   one that used to render no explanation at all, and it is the fixture every
   parity test below uses. Each asserts the routing rather than trusting it. */
function fatigued(a) {
  pastRuns(a, 5).forEach(dd => log(a, dd, {
    pace: '5:40', hr: 172, rpe: 9, feel: 'bad', notes: 'legs completely flat again'
  }));
  return a;
}
function hurting(a) {
  pastRuns(a, 3).forEach(dd => log(a, dd, {
    pace: '5:20', hr: 158, rpe: 7, notes: 'sharp pain in my left knee'
  }));
  return a;
}
/* A plan whose past is empty is not a quiet plan -- 28 days of unlogged KEY
   sessions is a missed-stimulus case, and the coach is right to reshape for
   it. A block that starts today is the genuinely undecided one. */
const quiet = a => (buildPlan(a, { weeks: 12, startDate: TODAY }), a.showToast = () => {}, a);
const text = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const stripComments = s => s
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ---------------------------------------------------------------------------
// 1. FIVE STATES, SAID OUT LOUD
// ---------------------------------------------------------------------------
test('1. the engine keeps its five state names', () => {
  const a = app();
  assert.deepEqual(Object.keys(a.EVOLUTION_META).sort(),
    ['ADAPT', 'HOLD', 'MONITOR', 'PROGRESS', 'RECOVER'],
    'renaming an engine state would invalidate every hash, ledger and decline record');
});

test('1. each state is given a phrase an athlete would use, not a verdict on them', () => {
  const a = app();
  assert.deepEqual({
    HOLD: a.EVOLUTION_META.HOLD.label,
    MONITOR: a.EVOLUTION_META.MONITOR.label,
    PROGRESS: a.EVOLUTION_META.PROGRESS.label,
    ADAPT: a.EVOLUTION_META.ADAPT.label,
    RECOVER: a.EVOLUTION_META.RECOVER.label
  }, {
    HOLD: 'On track',
    MONITOR: 'Worth watching',
    PROGRESS: 'Ready to progress',
    ADAPT: 'A small evolution',
    RECOVER: 'Recovery first'
  });
});

test('1. no state label ends in a full stop — they are headings, not sentences', () => {
  const a = app();
  Object.keys(a.EVOLUTION_META).forEach(k =>
    assert.ok(!/\.$/.test(a.EVOLUTION_META[k].label), k));
});

test('1. HOLD is silent on Today', () => {
  const a = quiet(app());
  const ev = a.planEvolution();
  assert.equal(ev.state, 'HOLD', 'a fresh plan with nothing logged is the HOLD case');
  assert.equal(a.renderEvolutionLink(), '',
    'nothing to decide means nothing on the screen the athlete came to use');
});

// ---------------------------------------------------------------------------
// 2. ONE COACHING SURFACE ON TODAY
// ---------------------------------------------------------------------------
test('2. the evolution proposal lives inside Next Move, not beside it', () => {
  const a = fatigued(plan(app()));
  const html = a.renderTodayView();
  const cards = (html.match(/class="hub-card/g) || []).length;
  assert.ok(cards <= 1, 'Today grew a second coaching card: ' + cards);
  const next = a.renderCoachNextMoveCard(a.coachAnalyse());
  if (a.renderEvolutionLink())
    assert.ok(next.indexOf('data-action="toggle-evolution"') !== -1,
      'the 7-day proposal is reached through Next Move or it is a competing surface');
});

test('2. the depth budget is untouched — the interface did not buy itself more room', () => {
  const a = app();
  // a plain deepEqual would compare a sandbox object against a host one and
  // fail on prototype identity, not on content
  assert.equal(JSON.stringify(a.COACH_DEPTH_PARAGRAPHS), '{"brief":1,"normal":3,"full":5}');
});

// ---------------------------------------------------------------------------
// 3. "WHY THIS IS BETTER" REACHES PARITY
// ---------------------------------------------------------------------------
test('3. a reshape explains itself, not only a step-up', () => {
  const a = hurting(plan(app()));
  assert.equal(a.coachDecision().state, 'recover', 'the fixture must route past the Playbook');
  const ev = a.planEvolution();
  assert.ok(ev && ev.changes.length, 'the fixture must produce a proposal');
  assert.ok(!ev.playbook, 'and it must be a hierarchy proposal, which is the gap being closed');
  const why = a.evolutionRationale(ev);
  assert.ok(why && why.length > 10,
    'the proposal that TAKES training away owed the athlete a reason and gave none');
  assert.ok(a.renderEvolutionProposal(ev, 'today').indexOf('Why this is better') !== -1,
    'and the section must actually render');
});

test('3. the reason given is the one the engine computed, not a new one', () => {
  const a = hurting(plan(app()));
  const ev = a.planEvolution();
  assert.equal(a.evolutionRationale(ev), ev.changes[0].why,
    'evolutionChanges() already attaches the mechanism to every branch; nothing is authored here');
});

test('3. "Why" and "Why this is better" answer different questions', () => {
  const a = hurting(plan(app()));
  const ev = a.planEvolution();
  assert.notEqual(ev.reasons[0], a.evolutionRationale(ev),
    'the evidence and the benefit are two claims — saying one twice is not depth');
});

test('3. with nothing proposed there is nothing to justify', () => {
  const a = quiet(app());
  const ev = a.planEvolution();
  assert.equal(ev.changes.length, 0);
  assert.equal(a.evolutionRationale(ev), '');
  assert.ok(a.renderEvolutionProposal(ev, 'hq').indexOf('Why this is better') === -1);
});

// ---------------------------------------------------------------------------
// 4. EXPERIENCE CHANGES THE EXPLANATION, NEVER THE DECISION
// ---------------------------------------------------------------------------
const LEVELS = ['novice', 'experienced', 'advanced'];
test('4. the decision is identical at all three experience levels', () => {
  const seen = LEVELS.map(lvl => {
    const a = hurting(plan(app()));
    a.state.setup.experience = lvl;
    const ev = a.planEvolution();
    return JSON.stringify({
      state: ev.state,
      changes: ev.changes.map(c => [c.kind, c.dayId, c.toKm, c.toType].join('/')),
      hash: ev.evidenceHash
    });
  });
  assert.equal(seen[0], seen[1]);
  assert.equal(seen[1], seen[2], 'experience must not be able to move a single change');
});

test('4. a novice is told more, and the extra is about what survives', () => {
  const rationale = lvl => {
    const a = hurting(plan(app()));
    a.state.setup.experience = lvl;
    return a.evolutionRationale(a.planEvolution());
  };
  const nov = rationale('novice'), exp = rationale('experienced');
  assert.ok(nov.length > exp.length, 'the novice explanation must actually be deeper');
  assert.ok(nov.indexOf(exp) === 0, 'and must be the same claim with more said, not a different one');
});

test('4. the novice reassurance never claims a protection the proposal did not give', () => {
  const a = hurting(plan(app()));
  a.state.setup.experience = 'novice';
  const ev = a.planEvolution();
  const said = a.evolutionRationale(ev);
  if (!ev.stimulus.preserved.qualityKept)
    assert.ok(said.indexOf('hard sessions stay where they are') === -1,
      'a reshape that moved quality cannot tell the athlete it did not');
  if (!ev.stimulus.preserved.longKept)
    assert.ok(said.indexOf('long run is untouched') === -1);
});

// ---------------------------------------------------------------------------
// 5. THE REVERSIBILITY PROMISE HAS A BOUNDARY ATTACHED
// ---------------------------------------------------------------------------
test('5. nothing in the product says a change can be undone at any time', () => {
  const code = stripComments(SRC);
  [/put it back at any time/i, /undone at any time/i, /reversed at any time/i,
   /always be (undone|reversed|restored)/i]
    .forEach(rx => assert.ok(!rx.test(code),
      'coachRestoreState() refuses once the session is run or edited, so this promise is false: ' + rx));
});

test('5. the offer is stated with its limit in the same breath', () => {
  const a = app();
  assert.equal(a.RESTORE_WINDOW_COPY, 'Can be restored until you run or edit it.');
});

test('5. the novice explanation carries the limit, not the promise', () => {
  const a = hurting(plan(app()));
  a.state.setup.experience = 'novice';
  const said = a.evolutionRationale(a.planEvolution());
  assert.ok(said.indexOf(a.RESTORE_WINDOW_COPY) !== -1);
  assert.doesNotMatch(said, /at any time/i);
});

// ---------------------------------------------------------------------------
// 6. ADJUSTED IS NOT EDITED
// ---------------------------------------------------------------------------
/* A plain training day. race and checkpoint carry the Key marker, which
   outranks both Adjusted and Edited and would make these tests prove nothing
   about either. */
function futureDay(a) {
  return a.state.days.filter(d => d.date > TODAY && d.type !== 'rest' &&
                                  d.type !== 'race' && d.type !== 'checkpoint')[0];
}
test('6. a coach adjustment reads as Adjusted', () => {
  const a = plan(app());
  const dd = futureDay(a);
  dd.coachAdjust = { at: TODAY + 'T09:00:00Z', reason: 'r', evidence: [], source: 'evolution',
                     from: { km: dd.km, type: dd.type, title: dd.title, desc: dd.desc } };
  assert.match(a.dayStatusLabel(dd), /Adjusted/);
});

test('6. an athlete edit reads as Edited, and never as Adjusted', () => {
  const a = plan(app());
  const dd = futureDay(a);
  dd.manualEdit = { at: TODAY + 'T09:00:00Z', fields: ['km'], from: { km: dd.km } };
  const label = a.dayStatusLabel(dd);
  assert.match(label, /Edited/);
  assert.ok(!/Adjusted/.test(label),
    'telling an athlete the coach made their own edit is the defect');
});

test('6. Edited yields to the things that matter more', () => {
  const a = plan(app());
  const past = a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').pop();
  past.manualEdit = { at: TODAY, fields: ['km'], from: {} };
  assert.match(a.dayStatusLabel(past), /Missed/,
    'an edited session that was then missed is a missed session first');
});

test('6. an edit after an adjustment keeps the Adjusted marker, because that is where the answer is', () => {
  const a = plan(app());
  const dd = futureDay(a);
  dd.coachAdjust = { at: TODAY + 'T09:00:00Z', reason: 'r', evidence: [], source: 'evolution',
                     from: { km: dd.km, type: dd.type, title: dd.title, desc: dd.desc } };
  dd.manualEdit = { at: TODAY + 'T10:00:00Z', fields: ['km'], from: {} };
  assert.match(a.dayStatusLabel(dd), /Adjusted/);
  assert.match(text(a.dayStatusMarker(dd)), /edited this session since/i,
    'and the disclosure is where the athlete learns their edit is why it will not go back');
});

// ---------------------------------------------------------------------------
// 7. THE ADJUSTED MARKER, OPENED
// ---------------------------------------------------------------------------
function adjusted(a, extra) {
  const dd = futureDay(a);
  dd.coachAdjust = Object.assign({
    at: TODAY + 'T09:00:00Z',
    reason: 'Keeping the session and its purpose, with less volume.',
    evidence: [], state: 'ADAPT', source: 'evolution',
    from: { km: dd.km, type: dd.type, title: dd.title, desc: dd.desc, mpSegment: false, prescription: null }
  }, extra || {});
  dd.km = Math.max(1, dd.km - 3);
  return dd;
}

test('7. it is the marker itself that opens, using the disclosure the app already has', () => {
  const a = plan(app());
  const dd = adjusted(a);
  const marker = a.dayStatusMarker(dd);
  assert.match(marker, /^<details/, 'a native disclosure, not a new screen');
  assert.match(marker, /<summary[^>]*>[\s\S]*day-status-label[\s\S]*Adjusted/,
    'and the existing badge is the thing you tap');
});

test('7. it answers what, why, when', () => {
  const a = plan(app());
  const dd = adjusted(a);
  const said = text(a.dayStatusMarker(dd));
  assert.match(said, /Was/);
  assert.match(said, /Now/);
  assert.match(said, /Keeping the session and its purpose/, 'why — the sentence it was accepted on');
  assert.match(said, /When/);
});

test('7. and whether it can go back', () => {
  const a = plan(app());
  const dd = adjusted(a);
  assert.equal(a.coachRestoreState(dd).ok, true);
  const marker = a.dayStatusMarker(dd);
  assert.match(marker, /data-action="coach-restore"/);
  assert.match(text(marker), /Can be restored until you run or edit it\./);
});

test('7. no extra badge appears on the day card', () => {
  const a = plan(app());
  const dd = adjusted(a);
  const labels = (a.dayStatusMarker(dd).match(/day-status-label/g) || []).length;
  assert.equal(labels, 1, 'one marker, opened — not a marker plus a second thing');
});

// ---------------------------------------------------------------------------
// 8. RESTORE IS OFFERED EXACTLY WHERE THE AUTHORITY ALLOWS IT
// ---------------------------------------------------------------------------
const REFUSALS = [
  ['a session that has been run', dd => { dd.completed = true; }, /already been run/i],
  ['a session the athlete edited since', dd => { dd.manualEdit = { at: TODAY, fields: [], from: {} }; }, /edited this session since/i]
];
REFUSALS.forEach(([name, spoil, expected]) => {
  test('8. no Restore button on ' + name, () => {
    const a = plan(app());
    const dd = adjusted(a);
    spoil(dd);
    assert.equal(a.coachRestoreState(dd).ok, false, 'the authority must refuse for this to mean anything');
    const marker = a.dayStatusMarker(dd);
    assert.ok(marker.indexOf('data-action="coach-restore"') === -1,
      'offering a restore the handler would refuse is the failure this rules out');
    assert.match(text(marker), expected, 'and the athlete is told which true thing stopped it');
  });
});

test('8. the button names the scope it actually restores', () => {
  const a = plan(app());
  const dd = adjusted(a);
  assert.match(text(a.dayStatusMarker(dd)), /Restore the original session/);

  const b = plan(app());
  const pb = adjusted(b, { source: 'playbook', weekFrom: [] });
  assert.equal(b.coachRestoreState(pb).scope, 'week');
  assert.match(text(b.dayStatusMarker(pb)), /Restore the original week/,
    'a Playbook evolution rebalanced the week and restores the week — saying "session" would be a smaller promise than the button keeps');
});

test('8. a paired move offers both sides, and restoring gives both back', () => {
  const a = plan(app());
  const one = futureDay(a);
  const two = a.state.days.filter(d => d.date > one.date && d.type !== 'rest' &&
                                      d.type !== 'race' && d.type !== 'checkpoint')[0];
  const snapOne = a.workoutSnapshot(one), snapTwo = a.workoutSnapshot(two);
  a.swapWorkoutFields(one, two, a.MOVED_WORKOUT_FIELDS);
  one.coachAdjust = { at: TODAY + 'T09:00:00Z', reason: 'Giving the two demanding sessions a day between them.',
                      evidence: [], state: 'ADAPT', source: 'evolution', from: snapOne, pairedWith: two.id };
  two.coachAdjust = { at: TODAY + 'T09:00:00Z', reason: 'Giving the two demanding sessions a day between them.',
                      evidence: [], state: 'ADAPT', source: 'evolution', from: snapTwo, pairedWith: one.id };
  assert.match(text(a.dayStatusMarker(one)), /Restore both sessions/);

  a.handleCoachRestore(one.id);
  assert.equal(one.title, snapOne.title);
  assert.equal(two.title, snapTwo.title);
  assert.equal(one.km, snapOne.km);
  assert.equal(two.km, snapTwo.km);
});

test('8. restoring through the rendered control puts the session back and clears the marker', () => {
  const a = plan(app());
  const dd = adjusted(a);
  const was = dd.coachAdjust.from.km;
  a.handleCoachRestore(dd.id);
  assert.equal(dd.km, was);
  assert.equal(dd.coachAdjust, undefined);
  assert.equal(a.dayStatusMarker(dd), '');
});

// ---------------------------------------------------------------------------
// 9. PROGRESS LOOKS LIKE SOMETHING WAS EARNED
// ---------------------------------------------------------------------------
test('9. PROGRESS no longer shares HOLD’s tone', () => {
  const a = app();
  assert.notEqual(a.EVOLUTION_META.PROGRESS.cls, a.EVOLUTION_META.HOLD.cls);
  assert.equal(a.EVOLUTION_META.PROGRESS.cls, 'progress');
});

test('9. its accent is bronze from the existing palette, and it does not move', () => {
  const css = SRC.slice(SRC.indexOf('<style'), SRC.indexOf('</style>'));
  const rule = css.slice(css.indexOf('.coach-state.progress{'));
  const block = rule.slice(0, rule.indexOf('}') + 1);
  assert.match(block, /var\(--/, 'tokens only — no literal colour may be introduced here');
  assert.ok(!/#[0-9a-f]{3,8}/i.test(block), 'a new hex colour is a new colour: ' + block);
  assert.ok(!/animation|@keyframes|transition/i.test(block), 'no animation on a coaching state');
});

test('9. every state renders through the same pill component', () => {
  const a = fatigued(plan(app()));
  const ev = a.planEvolution();
  const html = a.renderEvolutionSection(ev);
  assert.match(html, new RegExp('coach-state ' + a.EVOLUTION_META[ev.state].cls));
  assert.match(html, new RegExp(a.EVOLUTION_META[ev.state].label));
});

// ---------------------------------------------------------------------------
// 10. RECENTLY EVOLVED
// ---------------------------------------------------------------------------
test('10. an accepted change is still visible after it has been applied', () => {
  const a = fatigued(plan(app()));
  const ev = a.planEvolution();
  assert.ok(ev.changes.length);
  a.handleAcceptEvolution(ev.proposalId);
  const html = a.renderEvolutionSection(a.planEvolution());
  assert.match(html, /Recently evolved/,
    'an accepted change used to vanish the instant it was applied');
  assert.equal(a.recentEvolutions(2).length, 1);
});

test('10. only what the athlete agreed to', () => {
  const a = fatigued(plan(app()));
  const ev = a.planEvolution();
  a.handleDeclineEvolution(ev.proposalId);
  assert.equal(a.recentEvolutions(2).length, 0,
    'a declined proposal is not a thing that happened to the plan');
  assert.ok(a.renderEvolutionSection(a.planEvolution()).indexOf('Recently evolved') === -1);
});

test('10. two entries at most, newest first', () => {
  const a = plan(app());
  a.state.evolutionHistory = [
    { at: '2026-05-01T09:00:00Z', date: '2026-05-01', state: 'ADAPT', accepted: true,
      changes: [{ kind: 'reduce', dayId: 'x1', date: '2026-05-01', toKm: 6 }] },
    { at: '2026-05-10T09:00:00Z', date: '2026-05-10', state: 'ADAPT', accepted: true,
      changes: [{ kind: 'reduce', dayId: 'x2', date: '2026-05-10', toKm: 7 }] },
    { at: '2026-05-18T09:00:00Z', date: '2026-05-18', state: 'RECOVER', accepted: true,
      changes: [{ kind: 'downgrade', dayId: 'x3', date: '2026-05-18', toKm: 5 }] }
  ];
  const recent = a.recentEvolutions(2);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].date, '2026-05-18');
  assert.equal(recent[1].date, '2026-05-10');
});

test('10. a ledger entry whose day no longer exists still reads', () => {
  const a = plan(app());
  a.state.evolutionHistory = [{ at: '2026-05-18T09:00:00Z', date: '2026-05-18', state: 'ADAPT',
    accepted: true, changes: [{ kind: 'reduce', dayId: 'gone', date: '2026-05-18', toKm: 6 }] }];
  const line = a.recentEvolutionLine(a.recentEvolutions(2)[0]);
  assert.ok(line && line.length, 'a rebuilt block must not break its own history: ' + line);
  assert.ok(a.renderRecentEvolutions().indexOf('undefined') === -1);
});

test('10. an accepted Playbook step-up appears too', () => {
  const a = plan(app());
  a.state.playbookHistory = [{ at: '2026-05-18T09:00:00Z', date: '2026-05-18', status: 'accepted',
    decision: 'PROGRESS', dayId: 'gone', kind: 'progress', field: 'reps', from: 4, to: 5 }];
  const recent = a.recentEvolutions(2);
  assert.equal(recent.length, 1);
  assert.match(a.recentEvolutionLine(recent[0]), /progressed/);
  assert.match(a.recentEvolutionLine(recent[0]), /reps 4 → 5/);
});

// ---------------------------------------------------------------------------
// 11. THE MOVE PATH IS HANDLED WITHOUT BEING REACHED
// ---------------------------------------------------------------------------
/* The System pass established that evolutionChanges() cannot currently emit a
   `move`: every route to it needs a rest day inside the pending horizon, and
   pending excludes rest days. That is the engine's business and is not changed
   here. What IS this pass's business is that if it ever does emit one, no App
   surface breaks -- so the shape is fed to each of them directly. */
test('11. the move branch is still unreachable from the engine', () => {
  const a = fatigued(plan(app()));
  const ev = a.planEvolution();
  assert.ok(!(ev.changes || []).some(c => c.kind === 'move'),
    'this pass must not have made it reachable');
});

test('11. every App surface renders a move without breaking', () => {
  const a = plan(app());
  const one = futureDay(a);
  const two = a.state.days.filter(d => d.date > one.date && d.type !== 'rest' &&
                                      d.type !== 'race' && d.type !== 'checkpoint')[0];
  const ev = {
    state: 'ADAPT', confidence: 'emerging', horizonDays: 10,
    reasons: ['Two demanding sessions are back to back this week.'],
    changes: [{ kind: 'move', dayId: one.id, date: one.date, toDate: two.date,
                swapWithId: two.id, why: 'Giving the two demanding sessions a day between them.' }],
    protectedSessions: [], displacedSessions: [],
    stimulus: { before: {}, after: {}, preserved: { qualityKept: true, longKept: true, volumeDelta: 0 } },
    proposalId: 'ev:test:test'
  };
  const proposal = a.renderEvolutionProposal(ev, 'hq');
  assert.match(proposal, /Why this is better/);
  assert.match(text(proposal), /Giving the two demanding sessions a day between them/);
  assert.match(text(proposal), new RegExp(a.dShort(two.date).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  a.state.evolutionHistory = [{ at: TODAY + 'T09:00:00Z', date: TODAY, state: 'ADAPT',
    accepted: true, changes: [{ kind: 'move', dayId: one.id, date: one.date, toDate: two.date }] }];
  assert.match(a.recentEvolutionLine(a.recentEvolutions(2)[0]), /moved to/);
});

// ---------------------------------------------------------------------------
// 12. ACCEPT AND KEEP ARE THE SAME SIZE OF QUESTION
// ---------------------------------------------------------------------------
test('12. declining asks nothing further and costs the athlete nothing', () => {
  const a = fatigued(plan(app()));
  let asked = 0;
  a.confirm = () => { asked++; return true; };
  const ev = a.planEvolution();
  a.handleDeclineEvolution(ev.proposalId);
  assert.equal(asked, 0, 'a decline is an answer, not something to be talked out of');
  assert.equal((a.state.evolution || {}).declinedHash, ev.evidenceHash);
});

test('12. the two answers are offered as equals', () => {
  const a = fatigued(plan(app()));
  const html = a.renderEvolutionProposal(a.planEvolution(), 'today');
  assert.match(html, /data-action="accept-evolution"/);
  assert.match(html, /data-action="decline-evolution"/);
  assert.ok(html.indexOf('data-action="accept-evolution"') < html.indexOf('data-action="decline-evolution"'));
  const keep = html.slice(html.indexOf('data-action="decline-evolution"'));
  assert.ok(!/ignore|dismiss|skip|reject|refuse/i.test(text(keep.slice(0, 220))),
    'the word for keeping your own plan must not be a word for failing');
});

// ---------------------------------------------------------------------------
// 13. THE ORDER OF THE PROPOSAL
// ---------------------------------------------------------------------------
test('13. the expanded proposal reads in the order the athlete needs it', () => {
  const a = fatigued(plan(app()));
  const ev = a.planEvolution();
  const html = a.renderEvolutionProposal(ev, 'today');
  const order = ['Why', 'Changes', 'Why this is better', 'Training kept',
                 'accept-evolution', 'decline-evolution'];
  let at = -1;
  order.forEach(k => {
    const i = html.indexOf(k, at + 1);
    assert.ok(i > at, k + ' is out of order or missing');
    at = i;
  });
});

test('13. collapsed, it is one line and no more', () => {
  const a = fatigued(plan(app()));
  if (!a.renderEvolutionLink()) return;   // nothing to show is a legitimate outcome
  const link = a.renderEvolutionLink();
  assert.match(link, /7-day plan · \d+ change/);
  assert.ok(link.indexOf('evo-panel') === -1, 'collapsed means collapsed');
});
