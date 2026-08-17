'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// PHASE 4 CLOSEOUT, PART 1 -- can an accepted Plan Evolution actually be undone?
//
// Restore is currently unreachable: handleCoachRestore() and
// handleRestorePlaybook() exist, the dispatcher routes to them, and NOTHING
// renders a data-action="coach-restore" trigger. So none of what follows is a
// live athlete-facing bug today. It is the reason App must not be handed a
// button until the operation underneath it is safe, and these tests are what
// makes that judgement rather than an opinion.
//
// Three failures were found by reproducing the real acceptance path:
//
//   1. A move writes the SAME snapshot to both days, so restoring one of them
//      duplicates a workout and loses the other one entirely.
//   2. Single-day restore has none of the protections the Playbook week
//      restore has: it will re-prescribe a session the athlete already ran,
//      and overwrite an edit the athlete made afterwards.
//   3. mpSegment is moved by a swap but is not in the snapshot, so a
//      marathon-pace long run comes back without its segment.
const TODAY = '2026-05-20';
const app = () => loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
const D = n => new Date(Date.UTC(2026, 4, 20) + n * 86400000).toISOString().slice(0, 10);
const day = (date, type, km, extra) =>
  Object.assign({ id: date, date, type, km, mpSegment: false }, extra || {});

/* THE MOVE IS DRIVEN THROUGH applyMoveChange(), the production function
   handleAcceptEvolution() calls, and NOT through planEvolution().

   That is not a shortcut, it is the finding. evolutionChanges() only proposes a
   move onto a rest day or a RECOVERY day -- and planEvolution() filters rest
   days out of `pending`, while any RECOVERY day large enough to be a target is
   taken by the cheaper reduce steps before spacing is ever reached. An
   exhaustive search over 9.3 million three- and four-day plan shapes produced
   41,984 moves, every single one of which required a rest day in `pending`,
   and zero without one. So `kind:'move'` is currently unreachable through the
   proposal path, and the defects below are latent rather than live.

   They are still fixed, because App is about to be handed a Restore contract
   and the code underneath it has to be correct -- and because the day the rest-
   day filter changes, a latent defect becomes a live one silently. */
let MOVER_BEFORE = null;
function movedPair(a) {
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -21) });
  a.showToast = () => {};
  a.state.days = [
    day(D(1), 'threshold', 10, { title: 'Threshold Repeats', desc: 'THRESHOLD-DESC',
      prescription: { v: 1, archetype: 'steady_tempo', params: { min: 20 } } }),
    day(D(2), 'interval', 9, { title: 'VO2 Intervals', desc: 'INTERVAL-DESC',
      prescription: { v: 1, archetype: 'vo2_intervals', params: { reps: 6 } } }),
    day(D(3), 'easy', 5, { title: 'Easy Shakeout', desc: 'EASY-DESC',
      prescription: { v: 1, archetype: 'easy_run', params: { km: 5 } } })
  ];
  const mover = a.findDay(D(2)), partner = a.findDay(D(3));
  /* Snapshotted through the same workoutSnapshot() the production accept path
     uses, then applyMoveChange() -- the production function -- performs the
     exchange and writes the partner's record. The mover's record is written by
     its caller, so the test writes exactly what handleAcceptEvolution writes. */
  MOVER_BEFORE = a.workoutSnapshot(mover);
  const c = { kind: 'move', dayId: mover.id, date: mover.date,
              toDate: partner.date, swapWithId: partner.id,
              why: 'Giving the two demanding sessions a day between them.' };
  const ev = { state: 'ADAPT', reasons: ['spacing'] };
  const paired = a.applyMoveChange(mover, c, ev);
  assert.equal(paired, partner.id, 'the production move must report its partner');
  mover.coachAdjust = { at: new Date().toISOString(), reason: c.why, evidence: ev.reasons,
                        state: ev.state, source: 'evolution',
                        from: MOVER_BEFORE, pairedWith: paired };
  return { move: c, mover: a.findDay(mover.id), partner: a.findDay(partner.id) };
}

const identity = dd => [dd.type, dd.title, dd.km, dd.desc,
  dd.prescription ? dd.prescription.archetype : null].join('|');

// ---------------------------------------------------------------------------
// C. MOVE-PAIR ATOMICITY
// ---------------------------------------------------------------------------
test('C. a move records the right snapshot on each side', () => {
  /* THE DEFECT. The old code captured the MOVER's content twice and wrote it
     to both days, so the partner's own original was never stored anywhere and
     restoring the mover put the mover's workout on top of the copy the partner
     was already holding: one workout duplicated, the other lost. */
  const a = app();
  const r = movedPair(a);
  const m = a.findDay(r.mover.id), p = a.findDay(r.partner.id);
  assert.ok(m.coachAdjust && p.coachAdjust, 'both sides of a move are adjusted days');
  assert.equal(m.coachAdjust.from.title, 'VO2 Intervals', 'the mover remembers the mover');
  assert.equal(p.coachAdjust.from.title, 'Easy Shakeout',
    'and the partner remembers the PARTNER — not a second copy of the mover');
  assert.notEqual(m.coachAdjust.from.title, p.coachAdjust.from.title);
});

test('C. restoring one side of a move restores both', () => {
  const a = app();
  const r = movedPair(a);
  const d1Before = identity(a.findDay(D(1)));
  a.handleCoachRestore(r.mover.id);
  assert.equal(a.findDay(D(2)).title, 'VO2 Intervals', 'the day asked about is back');
  assert.equal(a.findDay(D(3)).title, 'Easy Shakeout',
    'and so is its partner — a logical move is one change, so undoing it is one change');
  assert.equal(identity(a.findDay(D(1))), d1Before, 'and nothing else moved');
});

test('C. no workout is duplicated and none is lost', () => {
  const a = app();
  const r = movedPair(a);
  a.handleCoachRestore(r.mover.id);
  const ids = a.state.days.map(identity);
  assert.equal(new Set(ids).size, ids.length,
    'two days holding the same workout means one workout was overwritten by another');
  assert.ok(ids.some(i => /VO2 Intervals/.test(i)), 'the intervals still exist somewhere');
  assert.ok(ids.some(i => /Threshold Repeats/.test(i)), 'and so does the threshold');
});

test('C. restoring from the partner side gives the identical result', () => {
  const fromMover = (() => { const a = app(); const r = movedPair(a);
    a.handleCoachRestore(r.mover.id); return a.state.days.map(identity).join('#'); })();
  const fromPartner = (() => { const a = app(); const r = movedPair(a);
    a.handleCoachRestore(r.partner.id); return a.state.days.map(identity).join('#'); })();
  assert.equal(fromMover, fromPartner,
    'which end of a pair the athlete taps is not a product decision');
});

test('C. both sides lose their adjustment record together', () => {
  const a = app();
  const r = movedPair(a);
  a.handleCoachRestore(r.mover.id);
  assert.ok(!a.findDay(r.mover.id).coachAdjust);
  assert.ok(!a.findDay(r.partner.id).coachAdjust,
    'a half-restored pair would show one day as still adjusted forever');
});

test('C. the partner is named explicitly, never inferred from content', () => {
  const a = app();
  const r = movedPair(a);
  const adj = a.findDay(r.mover.id).coachAdjust;
  assert.equal(adj.pairedWith, r.partner.id, 'an explicit day id');
  assert.equal(a.findDay(r.partner.id).coachAdjust.pairedWith, r.mover.id, 'and it points back');
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const at = src.indexOf('function handleCoachRestore(');
  const body = src.slice(at, src.indexOf('\n}', at));
  [/\.type ?===/, /\.title ?===/, /\.km ?===/].forEach(rx =>
    assert.ok(!rx.test(body),
      'matching a partner by workout text would pair two identical easy runs'));
});

test('C. a marathon-pace segment survives the round trip', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -21) });
  a.showToast = () => {};
  a.state.days = [
    day(D(2), 'long', 24, { title: 'Long Run', mpSegment: true,
      prescription: { v: 1, archetype: 'long_run', params: { km: 24 } } }),
    day(D(3), 'easy', 5, { title: 'Easy Shakeout' })
  ];
  const mover = a.findDay(D(2)), partner = a.findDay(D(3));
  const before = a.workoutSnapshot(mover);
  const paired = a.applyMoveChange(mover, { kind: 'move', dayId: mover.id,
    swapWithId: partner.id, why: 'spacing' }, { state: 'ADAPT', reasons: [] });
  mover.coachAdjust = { at: 'x', reason: 'spacing', source: 'evolution',
                        from: before, pairedWith: paired };
  assert.equal(a.findDay(D(3)).mpSegment, true, 'the segment travelled with the workout');
  a.handleCoachRestore(D(2));
  assert.equal(a.findDay(D(2)).mpSegment, true,
    'a marathon-pace segment is what makes that long run that long run');
  assert.equal(a.findDay(D(3)).mpSegment, false);
});

test('C. repeated restore is a no-op, not a second restore', () => {
  const a = app();
  const r = movedPair(a);
  a.handleCoachRestore(r.mover.id);
  const after = a.state.days.map(identity).join('#');
  a.handleCoachRestore(r.mover.id);
  a.handleCoachRestore(r.partner.id);
  assert.equal(a.state.days.map(identity).join('#'), after,
    'a restore with nothing to restore must do nothing at all');
});

test('C. the pair relationship survives persistence and reload', () => {
  const a = app();
  const r = movedPair(a);
  a.persistStateLocalOnly();
  const b = app();
  b.showToast = () => {};
  b.localStorage.setItem('velvet-viking-generator-v2',
    a.localStorage.getItem('velvet-viking-generator-v2'));
  b.loadState();
  assert.equal(b.findDay(r.mover.id).coachAdjust.pairedWith, r.partner.id);
  b.handleCoachRestore(r.mover.id);
  assert.ok(!b.findDay(r.partner.id).coachAdjust, 'and it still restores atomically');
});

test('C. the pair relationship survives archive and restore', () => {
  const a = app();
  const r = movedPair(a);
  a.archivePlanFor('uid-old', JSON.parse(JSON.stringify(a.state)));
  const back = a.takeArchivedPlan('uid-old');
  const mover = back.days.filter(d => d.id === r.mover.id)[0];
  assert.equal(mover.coachAdjust.pairedWith, r.partner.id);
});

test('C. an old record with no pair reference still restores its own day', () => {
  /* BACKWARD COMPATIBILITY. Every coachAdjust written before this pass, and
     every non-move adjustment written after it, has no pairedWith. Those must
     behave exactly as they always did: restore the one day, touch nothing
     else. */
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -21) });
  a.showToast = () => {};
  a.state.days = [
    day(D(1), 'threshold', 6, { title: 'Reduced', desc: 'small',
      coachAdjust: { at: 'x', reason: 'legacy', source: 'evolution',
        from: { km: 10, type: 'threshold', title: 'Threshold Repeats', desc: 'THRESHOLD-DESC',
                prescription: { v: 1, archetype: 'steady_tempo', params: { min: 20 } } } } }),
    day(D(2), 'easy', 6, { title: 'Easy' })
  ];
  const otherBefore = identity(a.findDay(D(2)));
  a.handleCoachRestore(D(1));
  assert.equal(a.findDay(D(1)).km, 10);
  assert.equal(a.findDay(D(1)).title, 'Threshold Repeats');
  assert.ok(!a.findDay(D(1)).coachAdjust);
  assert.equal(identity(a.findDay(D(2))), otherBefore, 'and no other day is involved');
});

// ---------------------------------------------------------------------------
// D. A SESSION THE ATHLETE ALREADY RAN
// ---------------------------------------------------------------------------
/* An adjusted day, then logged. The question is whether Restore may change the
   prescription underneath a run that has already happened -- which would make
   the record say the athlete executed something they were never given. */
function adjustedThenLogged(a, opts) {
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -21) });
  a.showToast = () => {};
  const dd = day(TODAY, 'threshold', 6, { title: 'Threshold (eased)', desc: 'EASED',
    prescription: { v: 1, archetype: 'steady_tempo', params: { min: 12 } },
    coachAdjust: { at: 'x', reason: 'eased', source: 'evolution',
      from: { km: 12, type: 'threshold', title: 'Threshold Repeats', desc: 'ORIGINAL',
              prescription: { v: 1, archetype: 'steady_tempo', params: { min: 30 } } } } });
  Object.assign(dd, opts || {});
  a.state.days = [dd, day(D(2), 'easy', 6)];
  return dd;
}

test('D. a completed session is never re-prescribed by Restore', () => {
  const a = app();
  const dd = adjustedThenLogged(a, { completed: true,
    actual: { km: 6.1, pace: '4:35', hr: 162, rpe: 7, notes: 'went well' } });
  a.handleCoachRestore(dd.id);
  assert.equal(a.findDay(dd.id).km, 6, 'the athlete ran 6km against a 6km prescription');
  assert.equal(a.findDay(dd.id).prescription.params.min, 12);
  assert.ok(a.findDay(dd.id).coachAdjust, 'and the record of what happened is kept');
});

test('D. the log itself is untouched by a refused restore', () => {
  const a = app();
  const dd = adjustedThenLogged(a, { completed: true, stravaActivityId: '4242',
    actual: { km: 6.1, pace: '4:35', hr: 162, rpe: 7, notes: 'went well' },
    coachReview: { version: 1, trainingSignal: 'ok' } });
  const before = JSON.stringify(dd);
  a.handleCoachRestore(dd.id);
  assert.equal(JSON.stringify(a.findDay(dd.id)), before,
    'nothing about a performed session is the coach\'s to edit');
});

test('D. the Strava-only drift case is refused too', () => {
  /* WS1 established sessionRan() as the authority on whether a session
     happened. A day with an attachment and no completion flag is a run that
     happened, so it is not re-prescribable either. */
  const a = app();
  const dd = adjustedThenLogged(a, { completed: false, stravaActivityId: '99887766',
    actual: { km: 6.0, pace: '4:40', hr: 158, rpe: null, notes: '' } });
  assert.equal(a.sessionRan(dd), true);
  a.handleCoachRestore(dd.id);
  assert.equal(a.findDay(dd.id).km, 6, 'a real run is a real run whichever flag says so');
});

test('D. actual data without completion or attachment does NOT block restore', () => {
  /* A part-filled log on a day that has not been confirmed and carries no
     attachment is not a performed session -- it is a form the athlete started.
     sessionRan() says no, and Restore is allowed. Drawing the line anywhere
     else would make an accidental keystroke permanent. */
  const a = app();
  const dd = adjustedThenLogged(a, { completed: false,
    actual: { km: 3, pace: null, hr: null, rpe: null, notes: '' } });
  assert.equal(a.sessionRan(dd), false);
  a.handleCoachRestore(dd.id);
  assert.equal(a.findDay(dd.id).km, 12, 'the original prescription comes back');
  assert.equal(a.findDay(dd.id).actual.km, 3, 'and what was typed is left alone');
});

test('D. a move whose partner has been run restores neither side', () => {
  /* The partner here is a future day, where sessionRan() correctly says nothing
     has happened -- so the completion FLAG is what has to block this. Both
     notions are needed and neither alone is enough: sessionRan catches the
     Strava-attached past day whose flag has not caught up, and the flag catches
     a day that claims completion where sessionRan would not. */
  const a = app();
  const r = movedPair(a);
  const p = a.findDay(r.partner.id);
  p.completed = true;
  p.actual = { km: p.km, pace: '4:30', hr: 160, rpe: 7, notes: '' };
  const before = a.state.days.map(identity).join('#');
  a.handleCoachRestore(r.mover.id);
  assert.equal(a.state.days.map(identity).join('#'), before,
    'a partial restore of a move is worse than none');
  assert.equal(a.coachRestoreState(a.findDay(r.mover.id)).reason, 'partner_ran');
});

test('D. Playbook week restore keeps its own protections', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -21) });
  a.showToast = () => {};
  const target = day(D(1), 'easy', 4, { title: 'Eased',
    coachAdjust: { at: 'x', reason: 'playbook', source: 'playbook',
      from: { km: 8, type: 'easy', title: 'Easy', desc: 'E' },
      weekFrom: [{ id: D(1), km: 8, type: 'easy', title: 'Easy', desc: 'E' },
                 { id: D(2), km: 10, type: 'easy', title: 'Easy 2', desc: 'E2' },
                 { id: D(3), km: 12, type: 'long', title: 'Long', desc: 'L' }] } });
  a.state.days = [target,
    day(D(2), 'easy', 6, { title: 'Ran it', completed: true,
      actual: { km: 6, pace: '5:20', hr: 145, rpe: 4, notes: '' } }),
    day(D(3), 'long', 9, { title: 'My own edit', manualEdit: { at: 'x', fields: ['km'] } })];
  a.handleRestorePlaybook(D(1));
  assert.equal(a.findDay(D(1)).km, 8, 'the untouched day comes back');
  assert.equal(a.findDay(D(2)).km, 6, 'a day the athlete ran is theirs');
  assert.equal(a.findDay(D(3)).km, 9, 'and so is a day they edited');
});

// ---------------------------------------------------------------------------
// E. STALE RESTORE
// ---------------------------------------------------------------------------
test('E. a manual edit after the adjustment outranks the snapshot', () => {
  /* manualEdit is already the product's marker of athlete ownership -- the
     Playbook week restore has honoured it since it was written. The same rule
     applies here rather than a second, competing notion of ownership. */
  const a = app();
  const dd = adjustedThenLogged(a);
  dd.km = 7;
  dd.manualEdit = { at: 'x', fields: ['km'], from: { km: 6 } };
  a.handleCoachRestore(dd.id);
  assert.equal(a.findDay(dd.id).km, 7, 'the athlete already answered this question');
  assert.ok(a.findDay(dd.id).coachAdjust, 'and nothing was thrown away');
});

test('E. a refused restore mutates nothing anywhere', () => {
  const a = app();
  const dd = adjustedThenLogged(a, { completed: true,
    actual: { km: 6, pace: '4:40', hr: 160, rpe: 7, notes: 'n' } });
  const before = JSON.stringify(a.state);
  a.handleCoachRestore(dd.id);
  assert.equal(JSON.stringify(a.state), before,
    'no day, no log, no ledger, no history');
});

test('E. a later coach adjustment replaces the snapshot rather than stacking', () => {
  const a = app();
  const dd = adjustedThenLogged(a);
  // a second decision on the same day: the record now describes the newer one
  dd.coachAdjust = { at: 'y', reason: 'again', source: 'evolution',
    from: { km: 6, type: 'threshold', title: 'Threshold (eased)', desc: 'EASED', prescription: null } };
  dd.km = 4;
  a.handleCoachRestore(dd.id);
  assert.equal(a.findDay(dd.id).km, 6,
    'restore returns the session to what it was before the LAST decision, not the first');
});

test('E. restore after cloud adoption uses the adopted record, not a remembered one', async () => {
  const a = app();
  const r = movedPair(a);
  a.cloudSession = { access_token: 't', user_id: 'u', email: 'a@b.c', expires_at: Date.now() + 3600e3 };
  const remote = JSON.parse(JSON.stringify(a.state));
  remote.days = remote.days.map(d => d.id === r.mover.id
    ? Object.assign({}, d, { km: (d.km || 0) + 3 }) : d);
  a.writeSyncMark('2026-05-19T00:00:00Z', a.planContentSignature(a.state));
  a.fetch = url => /\/rest\/v1\/plans\?select=/.test(String(url))
    ? Promise.resolve({ ok: true, status: 200,
        json: () => Promise.resolve([{ data: remote, updated_at: '2026-05-20T08:00:00Z' }]) })
    : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([{}]) });
  await a.cloudReconcile();
  await new Promise(res => setTimeout(res, 0));

  const adopted = a.findDay(r.mover.id);
  assert.ok(adopted.coachAdjust, 'the adopted plan carries its own adjustment record');
  assert.equal(adopted.coachAdjust.pairedWith, r.partner.id, 'including the pair reference');
  a.handleCoachRestore(r.mover.id);
  assert.ok(!a.findDay(r.partner.id).coachAdjust, 'and it still restores atomically');
});

test('E. a restore for a day that no longer exists does nothing', () => {
  const a = app();
  const dd = adjustedThenLogged(a);
  const before = JSON.stringify(a.state);
  a.handleCoachRestore('2099-01-01');
  a.handleCoachRestore(null);
  assert.equal(JSON.stringify(a.state), before);
});

test('E. a record with no snapshot is not restorable', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -21) });
  a.showToast = () => {};
  a.state.days = [day(D(1), 'easy', 5, { coachAdjust: { at: 'x', reason: 'no from' } })];
  const before = JSON.stringify(a.state);
  a.handleCoachRestore(D(1));
  assert.equal(JSON.stringify(a.state), before, 'nothing to restore is not an invitation to guess');
});

test('E. a pair reference pointing at a day that has gone restores the one that remains', () => {
  const a = app();
  const r = movedPair(a);
  const partnerId = r.partner.id;
  a.state.days = a.state.days.filter(d => d.id !== partnerId);   // a regenerated or trimmed plan
  a.handleCoachRestore(r.mover.id);
  assert.ok(!a.findDay(r.mover.id).coachAdjust,
    'a dangling reference must not make a day permanently un-restorable');
});

// ---------------------------------------------------------------------------
// F. THE CONTRACT APP CAN BUILD AGAINST
// ---------------------------------------------------------------------------
test('F. restorability is a question the domain answers, not the interface', () => {
  const a = app();
  assert.equal(typeof a.coachRestoreState, 'function',
    'App must be able to ask whether Restore is offerable without re-deriving the rules');
});

test('F. every refusal reason is nameable', () => {
  const a = app();
  const dd = adjustedThenLogged(a);
  assert.equal(a.coachRestoreState(dd).ok, true);

  const ran = adjustedThenLogged(app(), { completed: true,
    actual: { km: 6, pace: '4:40', hr: 160, rpe: 7, notes: '' } });
  assert.equal(a.coachRestoreState(ran).ok, false);
  assert.equal(a.coachRestoreState(ran).reason, 'session_ran');

  const edited = adjustedThenLogged(app(), { manualEdit: { at: 'x', fields: ['km'] } });
  assert.equal(a.coachRestoreState(edited).reason, 'athlete_edited');

  const bare = { id: 'x', date: D(1), type: 'easy', km: 5 };
  assert.equal(a.coachRestoreState(bare).reason, 'not_adjusted');
});

test('F. the refusal copy claims nothing and blames nobody', () => {
  const a = app();
  Object.keys(a.RESTORE_REFUSAL_COPY).forEach(k => {
    const t = a.RESTORE_REFUSAL_COPY[k];
    assert.ok(t.length < 120, 'copy stays simple: ' + t);
    [/error/i, /failed/i, /cannot be undone/i, /you should/i]
      .forEach(rx => assert.ok(!rx.test(t), 'a refusal is not a fault: ' + t));
  });
});

test('F. a move is reported as a pair so App can say so', () => {
  const a = app();
  const r = movedPair(a);
  const st = a.coachRestoreState(a.findDay(r.mover.id));
  assert.equal(st.ok, true);
  assert.equal(st.pairedWith, r.partner.id);
  assert.equal(st.atomic, true, 'App must be able to tell the athlete two days will change');
});

test('F. a Playbook adjustment reports itself as week-level', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -21) });
  a.showToast = () => {};
  const dd = day(D(1), 'easy', 4, { coachAdjust: { at: 'x', source: 'playbook',
    from: { km: 8, type: 'easy', title: 'Easy', desc: 'E' },
    weekFrom: [{ id: D(1), km: 8, type: 'easy', title: 'Easy', desc: 'E' }] } });
  a.state.days = [dd];
  const st = a.coachRestoreState(dd);
  assert.equal(st.scope, 'week');
  assert.equal(st.source, 'playbook');
});
