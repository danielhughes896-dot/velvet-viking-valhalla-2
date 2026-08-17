'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// PHASE 4 WORKSTREAM 2 -- the additional adversarial matrix, 1 through 25.
//
// These are the shapes of evidence that are individually plausible and jointly
// awkward: a hot week that looks like fitness loss, a good report over bad
// physiology, a bad report over good execution, half the sensors missing, a
// week with three sessions gone. The engine must not be clever about any of
// them. It must be safe, and it must be the same twice.
const TODAY = '2026-05-20';
const app = () => loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
const D = n => new Date(Date.UTC(2026, 4, 20) + n * 86400000).toISOString().slice(0, 10);
const day = (date, type, km, extra) =>
  Object.assign({ id: date, date, type, km, mpSegment: false }, extra || {});

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
const todayDay = a => a.state.days.filter(d => d.date === TODAY)[0];

// ---------------------------------------------------------------------------
// 1. HEAT IS NOT FITNESS LOSS
// ---------------------------------------------------------------------------
test('1. a hot week with elevated HR is not read as fitness decline', () => {
  const a = plan(app());
  pastRuns(a, 4).forEach(dd => log(a, dd, {
    pace: '5:05', hr: 168, rpe: 5, notes: 'brutal heat and humidity today, HR through the roof'
  }));
  const said = (a.coachDecision().reasons || []).join(' ') + ' ' +
               (a.athleteTrends() || []).map(t => t.detail).join(' ');
  [/losing fitness/i, /fitness is declining/i, /detrain/i, /out of shape/i]
    .forEach(rx => assert.ok(!rx.test(said), 'heat costs beats for reasons that are not fatigue: ' + rx));
});

test('1. heat-affected heart rate is excluded from the HR baseline', () => {
  const a = plan(app());
  pastRuns(a, 5).forEach(dd => log(a, dd, { pace: '5:05', hr: 172, notes: 'very hot, heat all week' }));
  const recs = a.athleteMemory(120).filter(r => r.completed);
  const readable = recs.filter(r => a.hrIsReadable(r));
  assert.ok(readable.length < recs.length,
    'a hot run is not a physiological reading and must not set the norm');
});

// ---------------------------------------------------------------------------
// 2-4. WHAT THE ATHLETE SAYS vs WHAT THE NUMBERS SAY
// ---------------------------------------------------------------------------
test('2. repeated genuine fatigue is acted on', () => {
  const a = plan(app());
  pastRuns(a, 5).forEach(dd => log(a, dd, {
    pace: '5:40', hr: 170, rpe: 9, feel: 'bad', notes: 'legs completely flat again'
  }));
  const dec = a.coachDecision();
  assert.ok(['check', 'modify', 'recover'].indexOf(dec.state) !== -1,
    'five hard, flat sessions is exactly when the coach should say something: ' + dec.state);
});

test('3. a good report does not erase poor physiology', () => {
  const a = plan(app());
  pastRuns(a, 5).forEach(dd => log(a, dd, {
    pace: '5:45', hr: 175, rpe: 9, feel: 'good', notes: 'felt great!'
  }));
  const dec = a.coachDecision();
  assert.notEqual(dec.state, 'proceed',
    'enthusiasm is not evidence of readiness, and the numbers were not good');
});

test('4. a heavy-legs report does not by itself override strong execution', () => {
  const a = plan(app());
  pastRuns(a, 5).forEach(dd => log(a, dd, { pace: '4:45', hr: 148, rpe: 4, feel: 'good' }));
  todayDay(a).readiness = { legs: 'heavy' };
  const dec = a.coachDecision();
  assert.notEqual(dec.state, 'recover',
    'one morning of heavy legs is a reason to watch, not to dismantle the week');
  assert.equal(a.planEvolution().changes.length <= 1, true, 'and at most one small change');
});

// ---------------------------------------------------------------------------
// 5-7. MISSING SENSORS
// ---------------------------------------------------------------------------
test('5. no heart rate anywhere still produces a coherent decision', () => {
  const a = plan(app());
  pastRuns(a, 5).forEach(dd => log(a, dd, { pace: '5:10', rpe: 5 }));
  const dec = a.coachDecision();
  assert.ok(dec && typeof dec.score === 'number');
  assert.ok(!(dec.reasons || []).join(' ').match(/heart rate/i),
    'a coach must not cite a number it does not have');
});

test('6. no pace still produces a coherent decision and no score', () => {
  const a = plan(app());
  const runs = pastRuns(a, 5);
  runs.forEach(dd => log(a, dd, { hr: 150, rpe: 5 }));
  assert.ok(a.coachDecision());
  runs.forEach(dd => assert.equal(a.computeExecutionScore(dd), null,
    'without pace there is nothing to judge execution against'));
});

test('7. no RPE anywhere is not read as effort within band', () => {
  const a = plan(app());
  pastRuns(a, 5).forEach(dd => log(a, dd, { pace: '5:10', hr: 150 }));
  const rec = a.coachRecovery();
  assert.equal(rec.overRPE, 0);
  assert.equal(rec.counted, 0, 'absent is absent — it is not a passing grade');
});

test('5-7. an empty log produces no claim the data cannot support', () => {
  /* My first assumption here was wrong and the engine was right. Five sessions
     logged with no numbers at all still carry one real fact -- they happened,
     in a week following weeks of nothing -- and the coach reads that as an
     acute:chronic load spike, which it is. What must NOT happen is a claim
     about pace, heart rate or effort that no data supports. */
  const a = plan(app());
  pastRuns(a, 5).forEach(dd => { dd.completed = true; dd.actual = a.emptyActual(); });
  const dec = a.coachDecision();
  const said = dec.reasons.join(' | ');
  [/heart rate/i, /\beffort\b/i, /pace/i, /execution/i].forEach(rx =>
    assert.ok(!rx.test(said), 'a coach must not cite a number it does not have: ' + said));
  assert.ok(/week is [\d.]+x/.test(said) || dec.state === 'proceed',
    'the only thing it may say is the thing it can actually see');
  assert.ok(a.planEvolution().changes.length <= 1, 'and it stays a small answer');
});

// ---------------------------------------------------------------------------
// 8-11. MISSED TRAINING
// ---------------------------------------------------------------------------
test('8. several missed sessions in one window produce at most one proposal', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -28) });
  a.showToast = () => {};
  a.state.days = [
    day(a.addDays(TODAY, -3), 'threshold', 10),
    day(a.addDays(TODAY, -2), 'easy', 8),
    day(a.addDays(TODAY, -1), 'interval', 9),
    day(D(1), 'easy', 5),
    day(D(3), 'rest', 0),
    day(D(5), 'long', 20)
  ];
  const ev = a.planEvolution();
  assert.ok(ev.changes.length <= 1,
    'a bad week is not a reason to rebuild the next one: ' + JSON.stringify(ev.changes));
  assert.ok(!/debt|owe|make up|catch up/i.test(ev.reasons.join(' ')));
});

test('9. a missed long run is not crammed back in', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -28) });
  a.showToast = () => {};
  a.state.days = [
    day(a.addDays(TODAY, -1), 'long', 22),
    day(D(1), 'easy', 5),
    day(D(3), 'threshold', 10)
  ];
  const m = a.missedStimulus().filter(x => x.dayId === a.addDays(TODAY, -1))[0];
  assert.ok(m);
  assert.equal(m.stimulusStillUseful, false,
    'a long run is KEY by distance but rescheduling one is not a small change');
});

test('10. a missed threshold is recoverable only where it fits safely', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -28) });
  a.showToast = () => {};
  a.state.days = [
    day(a.addDays(TODAY, -1), 'threshold', 10),
    day(D(1), 'easy', 5),
    day(D(4), 'long', 20)
  ];
  const m = a.missedStimulus().filter(x => x.dayId === a.addDays(TODAY, -1))[0];
  assert.equal(m.stimulusStillUseful, true);
  const ev = a.planEvolution();
  assert.equal(ev.changes[0].kind, 'reschedule');
  assert.equal(a.stackedQualityPairs(
    a.applyChangesToCopy(a.state.days.filter(d => d.date >= TODAY), ev.changes)).length, 0,
    'and never into a stack');
});

test('11. a taper interruption is absorbed, never repaid', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -28) });
  a.showToast = () => {};
  const recoverable = [{ dayId: 'lost', date: a.addDays(TODAY, -1), type: 'threshold',
                         km: 10, importance: 'KEY', stimulusStillUseful: true }];
  ['Taper', 'Race Week', 'Final Week'].forEach(ph => {
    const out = a.evolutionChanges('ADAPT', ph, [day(D(1), 'easy', 5), day(D(2), 'easy', 6)], recoverable);
    assert.ok(!out.some(c => c.kind === 'reschedule'), ph + ' repaid missed work');
  });
});

test('11. Final Week is a taper phase everywhere, not just in some of the rules', () => {
  /* THE DEFECT. blockDimensionRelevance() and the block-evidence minimum both
     named all three taper phases. missedStimulus() and evolutionChanges() named
     only Taper and Race Week -- so the last week before the race, where
     cramming a threshold session back in does the most damage, was the one
     week not protected. Reachable end to end: the missed session was marked
     still-useful and the hierarchy rescheduled it. */
  const a = app();
  assert.equal(a.isTaperPhase('Taper'), true);
  assert.equal(a.isTaperPhase('Race Week'), true);
  assert.equal(a.isTaperPhase('Final Week'), true);
  ['Base', 'Build', 'Peak'].forEach(p => assert.equal(a.isTaperPhase(p), false));
});

// ---------------------------------------------------------------------------
// 12-15. AWKWARD SHAPES
// ---------------------------------------------------------------------------
test('12. two KEY sessions that cannot both move safely: one change, or none', () => {
  const a = app();
  const out = a.evolutionChanges('ADAPT', 'Build', [
    day(D(1), 'threshold', 10),
    day(D(2), 'interval', 9),
    day(D(3), 'long', 22)
  ], []);
  assert.ok(out.length <= 1, 'the engine proposes the smallest change, never a slate of them');
  out.forEach(c => assert.ok(c.kind !== 'drop' && (c.toKm || 0) > 0));
});

test('13. repeated declines never escalate and never nag', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -28) });
  a.showToast = () => {};
  a.state.days = [
    day(a.addDays(TODAY, -1), 'threshold', 10),
    day(D(1), 'easy', 5), day(D(4), 'long', 20)
  ];
  for (let i = 0; i < 3; i++){
    const ev = a.planEvolution();
    if (a.evolutionProposalVisible(ev)) a.handleDeclineEvolution(ev.proposalId);
  }
  assert.equal(a.evolutionProposalVisible(a.planEvolution()), false);
  const said = (a.state.evolutionHistory || []).map(h => h.reasons.join(' ')).join(' ');
  assert.ok(!/should have|failed to|again|ignoring/i.test(said),
    'a decline is never counted against the athlete');
});

test('14. a trivial change does not create proposal churn', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -28) });
  a.showToast = () => {};
  a.state.days = [
    day(a.addDays(TODAY, -1), 'threshold', 10),
    day(D(1), 'easy', 5), day(D(4), 'long', 20)
  ];
  const ev = a.planEvolution();
  a.handleDeclineEvolution(ev.proposalId);
  a.findDay(D(4)).title = 'Sunday Long Run';        // cosmetic
  a.state.view = 'planhq';
  assert.equal(a.evolutionProposalVisible(a.planEvolution()), false,
    'renaming a session is not new evidence');
});

test('15. a phase boundary does not itself produce a proposal', () => {
  /* The block must start TODAY. My first fixture started four weeks back, so
     it carried an unlogged interval session from yesterday -- and the proposal
     it produced was the correct recovery of that stimulus, not anything to do
     with a phase boundary. Testing the wrong thing would have passed just as
     easily. */
  const a = app();
  buildPlan(a, { weeks: 12, startDate: TODAY });
  a.showToast = () => {};
  const phases = a.state.days.filter(d => d.week).map(d => a.trainingPhase(d.week));
  assert.ok(new Set(phases).size > 1, 'the block genuinely crosses a boundary');
  assert.equal(a.missedStimulus().length, 0, 'and nothing has been missed');
  assert.equal(a.planEvolution().changes.length, 0,
    'a calendar transition is not evidence about an athlete');
});

test('16. a goal-distance block with no event behaves identically', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -28) });
  a.showToast = () => {};
  assert.equal(a.state.setup.hasEvent, false);
  const ev = a.planEvolution();
  assert.ok(['HOLD', 'MONITOR', 'ADAPT', 'RECOVER', 'PROGRESS'].indexOf(ev.state) !== -1);
  assert.ok(ev.phase);
});

// ---------------------------------------------------------------------------
// 17-21. THE PLAN MOVING UNDER THE PROPOSAL
// ---------------------------------------------------------------------------
test('17. an accepted evolution survives archive and restore', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -28) });
  a.showToast = () => {};
  a.state.days = [
    day(a.addDays(TODAY, -1), 'threshold', 10),
    day(D(1), 'easy', 5), day(D(4), 'long', 20)
  ];
  const ev = a.planEvolution();
  a.handleAcceptEvolution(ev.proposalId);
  const adjusted = a.state.days.filter(d => d.coachAdjust)[0];
  assert.ok(adjusted);

  a.archivePlanFor('uid-old', JSON.parse(JSON.stringify(a.state)));
  const back = a.takeArchivedPlan('uid-old');
  assert.ok(back, 'the archive round-trips');
  const restoredDay = (back.days || []).filter(d => d.id === adjusted.id)[0];
  assert.ok(restoredDay.coachAdjust, 'and the coaching decision travels with the plan');
  assert.equal(restoredDay.km, adjusted.km);
});

test('18. a date boundary does not change what already happened', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -28) });
  const dd = pastRuns(a, 1)[0];
  log(a, dd, { pace: '4:50', hr: 155, rpe: 6 });
  const scoreToday = a.computeExecutionScore(dd);

  const b = loadApp({ pinnedDate: a.addDays(TODAY, 1) + 'T09:00:00Z' });
  a.persistStateLocalOnly();
  b.localStorage.setItem('velvet-viking-generator-v2',
    a.localStorage.getItem('velvet-viking-generator-v2'));
  b.loadState();
  assert.equal(b.computeExecutionScore(b.findDay(dd.id)), scoreToday,
    'a run is worth what it was worth, whatever day it is now');
});

test('19. a corrupted or stale proposal object cannot be applied', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -28) });
  a.showToast = () => {};
  a.state.days = [
    day(a.addDays(TODAY, -1), 'threshold', 10),
    day(D(1), 'easy', 5), day(D(4), 'long', 20)
  ];
  const before = JSON.stringify(a.state.days);
  a.handleAcceptEvolution('ev:not-a-real-hash:nor-this');
  assert.equal(JSON.stringify(a.state.days), before);
  a.handleDeclineEvolution('ev:garbage');
  assert.equal((a.state.evolution || {}).declinedHash, undefined);
});

test('20. cloud adoption while a proposal is pending does not apply it', async () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -28) });
  a.showToast = () => {};
  a.state.days = [
    day(a.addDays(TODAY, -1), 'threshold', 10),
    day(D(1), 'easy', 5), day(D(4), 'long', 20)
  ];
  a.cloudSession = { access_token: 't', user_id: 'u', email: 'a@b.c', expires_at: Date.now() + 3600e3 };
  const shown = a.planEvolution();
  assert.ok(shown.changes.length);

  const remote = JSON.parse(JSON.stringify(a.state));
  remote.days = remote.days.map(d => d.id === D(4) ? Object.assign({}, d, { km: 24 }) : d);
  a.writeSyncMark('2026-05-19T00:00:00Z', a.planContentSignature(a.state));
  a.fetch = url => /\/rest\/v1\/plans\?select=/.test(String(url))
    ? Promise.resolve({ ok: true, status: 200,
        json: () => Promise.resolve([{ data: remote, updated_at: '2026-05-20T08:00:00Z' }]) })
    : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([{}]) });
  await a.cloudReconcile();
  await new Promise(r => setTimeout(r, 0));

  assert.equal(a.state.days.filter(d => d.coachAdjust).length, 0,
    'adopting a plan is not accepting a proposal about it');
  a.handleAcceptEvolution(shown.proposalId);
  assert.equal(a.state.days.filter(d => d.coachAdjust).length, 0,
    'and the pending proposal is now stale, so it applies nothing');
});

test('21. a manual edit after the proposal is never silently overwritten', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -28) });
  a.showToast = () => {};
  a.state.days = [
    day(a.addDays(TODAY, -1), 'threshold', 10),
    day(D(1), 'easy', 5), day(D(4), 'long', 20)
  ];
  const shown = a.planEvolution();
  const target = a.findDay(shown.changes[0].dayId);
  target.km = 3;
  target.manualEdit = { at: 'x', fields: ['km'], from: { km: 5 } };
  a.handleAcceptEvolution(shown.proposalId);
  assert.equal(a.findDay(target.id).km, 3);
  assert.equal(a.findDay(target.id).type, 'easy',
    'the athlete already answered this question with their own edit');
});

// ---------------------------------------------------------------------------
// 22-25. EVIDENCE HYGIENE
// ---------------------------------------------------------------------------
test('22. a logged session inside the horizon is not a candidate', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -28) });
  a.showToast = () => {};
  a.state.days = [
    day(D(1), 'easy', 5, { completed: true,
      actual: { km: 5, pace: '5:30', hr: 140, rpe: 4, notes: '' } }),
    day(D(3), 'threshold', 10)
  ];
  (a.planEvolution().changes || []).forEach(c =>
    assert.notEqual(c.dayId, D(1), 'a run that happened is not a proposal'));
});

test('23. a coachAdjust from the Playbook also settles a day for the hierarchy', () => {
  const a = app();
  const settled = day(D(1), 'easy', 5,
    { coachAdjust: { at: 'x', reason: 'playbook eased this', source: 'playbook' } });
  const out = a.evolutionChanges('ADAPT', 'Build', [settled, day(D(3), 'threshold', 10)], []);
  assert.ok(!out.some(c => c.dayId === D(1)),
    'the two engines must not take turns cutting the same day');
});

test('24. PROGRESS is unreachable immediately after a fatigue period', () => {
  const a = plan(app());
  pastRuns(a, 5).forEach(dd => log(a, dd, {
    pace: '5:40', hr: 172, rpe: 9, feel: 'bad', notes: 'shattered' }));
  todayDay(a).readiness = { legs: 'heavy', sleep: 'poor' };
  assert.notEqual(a.planEvolution().state, 'PROGRESS',
    'the Playbook is only consulted from a clean coach state');
});

test('25. one underlying fact never becomes several votes', () => {
  const a = plan(app());
  // an HR-only strained week: heart rate above zone, effort inside its band
  pastRuns(a, 5).forEach(dd => log(a, dd, { pace: '5:00', hr: 185, rpe: 4 }));
  const dec = a.coachDecision();
  const said = dec.reasons.join(' | ');
  const effortClaims = (said.match(/[Ee]ffort/g) || []).length;
  assert.ok(effortClaims === 0 || !/Effort and heart rate have both/.test(said),
    'an HR-only week must not be reported as effort AND heart rate: ' + said);
});

test('25. two readings of one signal are counted once', () => {
  const a = plan(app());
  pastRuns(a, 6).forEach(dd => log(a, dd, { pace: '5:00', hr: 185, rpe: 4 }));
  const dec = a.coachDecision();
  const hrLines = dec.reasons.filter(r => /heart rate/i.test(r)).length;
  assert.ok(hrLines <= 1,
    'heart rate arriving acutely and as a trend is one fact: ' + JSON.stringify(dec.reasons));
});

// ---------------------------------------------------------------------------
// DETERMINISM, ACROSS THE WHOLE MATRIX
// ---------------------------------------------------------------------------
test('every scenario above is deterministic', () => {
  const build = () => {
    const a = plan(app());
    pastRuns(a, 5).forEach(dd => log(a, dd, {
      pace: '5:20', hr: 168, rpe: 8, feel: 'bad', notes: 'hot and heavy' }));
    todayDay(a).readiness = { legs: 'heavy' };
    return a;
  };
  const one = build().planEvolution(), two = build().planEvolution();
  assert.equal(one.state, two.state);
  assert.equal(one.evidenceHash, two.evidenceHash);
  assert.equal(one.proposalId, two.proposalId);
  assert.equal(JSON.stringify(one.changes), JSON.stringify(two.changes));
});

test('no state ever proposes more training than was planned', () => {
  const a = app();
  const shapes = [
    [day(D(1), 'easy', 5), day(D(2), 'threshold', 10)],
    [day(D(1), 'long', 24)],
    [day(D(1), 'interval', 9), day(D(2), 'interval', 9)],
    [day(D(1), 'rest', 0), day(D(2), 'easy', 6)]
  ];
  ['HOLD', 'PROGRESS', 'MONITOR', 'ADAPT', 'RECOVER'].forEach(st => {
    ['Base', 'Build', 'Peak', 'Taper', 'Race Week', 'Final Week'].forEach(ph => {
      shapes.forEach(pending => {
        (a.evolutionChanges(st, ph, pending, []) || []).forEach(c => {
          if (c.toKm != null && c.fromKm != null)
            assert.ok(c.toKm <= c.fromKm, st + '/' + ph + ' proposed more training');
        });
      });
    });
  });
});
