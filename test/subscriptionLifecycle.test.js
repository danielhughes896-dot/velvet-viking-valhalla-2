'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../api/_billing.js');
const A = require('../api/_access.js');

// Phase 3A2. A payment provider is not a queue: the same event arrives twice
// because the first 200 was lost coming back, a renewal lands after the
// cancellation that supersedes it because two delivery attempts raced, and a
// month of events arrives at once when an outage drains.
//
// These are the cases that cannot be produced on demand from a live provider,
// which is exactly why the lifecycle is a pure function and why the suite --
// not a staging account -- is the evidence.
//
// The model being defended, restated because it is the thing an edit is most
// likely to erode: `state` says what KIND of access this is, `access_until`
// says when it ends, and ACCESS IS DECIDED BY THE TIMESTAMP. "Cancelled but
// paid through Friday" is therefore state='active' + cancel_at_period_end +
// access_until=Friday -- three facts that cannot contradict, rather than a
// fourth state that can.
const NOW = new Date('2026-06-01T12:00:00Z');
const at = h => new Date(NOW.getTime() + h * 3600e3).toISOString();
const days = n => new Date(NOW.getTime() + n * 24 * 3600e3).toISOString();

const UID = 'uid-athlete';
const row = over => Object.assign(B.emptyEntitlement(UID), over || {});
const ev = over => Object.assign({
  type: 'subscription_started', user_id: UID, seq: 1,
  occurred_at: NOW.toISOString(), period_end: days(30)
}, over || {});

const apply = (cur, e, now) => B.applyBillingEvent(cur, e, now || NOW);

// ---------------------------------------------------------------------------
// ORDERING: THE THREE WAYS A WEBHOOK LIES ABOUT TIME
// ---------------------------------------------------------------------------
test('the same event delivered twice is applied once', () => {
  const first = apply(row(), ev({ seq: 7 }));
  assert.equal(first.applied, true);
  const second = apply(first.next, ev({ seq: 7 }));
  assert.equal(second.applied, false);
  assert.equal(second.reason, 'duplicate');
  assert.deepEqual(second.next, first.next, 'a replay must change nothing at all');
});

test('an event that arrives after the one superseding it is dropped', () => {
  const cancelled = apply(row(), ev({ type: 'subscription_cancelled', seq: 9, period_end: days(10) }));
  const lateRenewal = apply(cancelled.next, ev({ type: 'subscription_renewed', seq: 8, period_end: days(40) }));
  assert.equal(lateRenewal.applied, false);
  assert.equal(lateRenewal.reason, 'out_of_order');
  assert.equal(lateRenewal.next.cancel_at_period_end, true,
    'a racing redelivery must not un-cancel a subscription');
});

test('a dropped event is never an error, because a provider retries errors forever', () => {
  ['duplicate', 'out_of_order'].forEach(() => {});
  const r = apply(row({ event_seq: 5 }), ev({ seq: 5 }));
  assert.equal(r.applied, false);
  assert.ok(r.next, 'there is still a row to answer 200 about');
});

test('an unsequenced event still applies, and does not poison the sequence', () => {
  const seeded = apply(row(), ev({ seq: 4, period_end: days(30) }));
  const unseq = apply(seeded.next, ev({ type: 'payment_failed', seq: null }));
  assert.equal(unseq.applied, true, 'some providers sequence only within a subscription');
  assert.equal(unseq.next.event_seq, 4, 'so a later sequenced event can still be judged');
  const stale = apply(unseq.next, ev({ type: 'subscription_renewed', seq: 3 }));
  assert.equal(stale.applied, false, 'and a genuinely stale one is still rejected');
});

test('an event type we do not know is refused rather than guessed at', () => {
  const r = apply(row(), ev({ type: 'invoice.finalized' }));
  assert.equal(r.applied, false);
  assert.equal(r.reason, 'unknown_event');
});

// ---------------------------------------------------------------------------
// THE LIFECYCLE
// ---------------------------------------------------------------------------
test('a trial grants access until it ends and not one hour longer', () => {
  const r = apply(row(), ev({ type: 'trial_started', period_end: days(14) }));
  assert.equal(r.next.state, 'trial');
  assert.equal(r.next.access_until, days(14));
  assert.equal(allowed(r.next, days(13)), true);
  assert.equal(allowed(r.next, days(15)), false);
});

test('cancelling is not ending', () => {
  const active = apply(row(), ev({ type: 'subscription_started', seq: 1, period_end: days(20) })).next;
  const r = apply(active, ev({ type: 'subscription_cancelled', seq: 2, period_end: days(20) }));
  assert.equal(r.next.state, 'active', 'the athlete has paid for these twenty days');
  assert.equal(r.next.cancel_at_period_end, true);
  assert.equal(r.next.access_until, days(20));
  assert.equal(allowed(r.next, days(19)), true,
    'taking the product away the moment somebody clicks cancel earns a chargeback');
  assert.equal(allowed(r.next, days(21)), false);
});

test('un-cancelling before it lands clears the flag', () => {
  const cancelled = apply(row(), ev({ type: 'subscription_cancelled', seq: 1, period_end: days(20) })).next;
  const r = apply(cancelled, ev({ type: 'subscription_resumed', seq: 2, period_end: days(50) }));
  assert.equal(r.next.cancel_at_period_end, false);
  assert.equal(r.next.access_until, days(50));
});

test('a failed payment buys a full training week, measured from what was paid for', () => {
  const active = apply(row(), ev({ seq: 1, period_end: days(20) })).next;
  const r = apply(active, ev({ type: 'payment_failed', seq: 2 }));
  assert.equal(r.next.state, 'grace');
  assert.equal(r.next.access_until, days(20 + B.GRACE_DAYS),
    'grace runs from the end of the paid period, not from the moment it failed');
});

test('a payment that fails after the period lapsed still gets its grace', () => {
  const lapsed = row({ state: 'active', access_until: days(-3), event_seq: 1 });
  const r = apply(lapsed, ev({ type: 'payment_failed', seq: 2 }));
  assert.equal(r.next.state, 'grace');
  assert.equal(r.next.access_until, days(B.GRACE_DAYS), 'measured from now, because now is later');
});

test('a failure notice can only ever lengthen the window, never shorten it', () => {
  // The rule is one rule at every distance: grace ends GRACE_DAYS after
  // whatever was already paid for. An athlete paid up ninety days out is an
  // odd thing for a provider to report a failure about, but applying the rule
  // consistently gives them ninety-seven -- which is harmless. Applying it
  // *inconsistently* to make the number tidier would mean a failure notice
  // could take access away, and that is the direction that must be impossible.
  const generous = row({ state: 'active', access_until: days(90), event_seq: 1 });
  const r = apply(generous, ev({ type: 'payment_failed', seq: 2 }));
  assert.ok(new Date(r.next.access_until) >= new Date(days(90)),
    'a notice arriving late must never SHORTEN a window the athlete already had');
  assert.equal(r.next.access_until, days(90 + B.GRACE_DAYS), 'the same rule, applied');
});

test('recovering from grace does not inherit the grace window', () => {
  const grace = row({ state: 'grace', access_until: days(7), event_seq: 1 });
  const r = apply(grace, ev({ type: 'payment_recovered', seq: 2, period_end: days(30) }));
  assert.equal(r.next.state, 'active');
  assert.equal(r.next.access_until, days(30),
    'stacking grace on top of the new period hands out a free week per retry');
});

test('ending takes access away now, not at a stored timestamp', () => {
  const active = row({ state: 'active', access_until: days(45), event_seq: 1 });
  const r = apply(active, ev({ type: 'subscription_ended', seq: 2, occurred_at: at(1) }));
  assert.equal(r.next.state, 'expired');
  assert.equal(r.next.access_until, at(1));
  assert.equal(allowed(r.next, at(2)), false,
    'an ended subscription with a future access_until is the disagreement this model forbids');
});

test('renewal extends, and clears a cancellation that never landed', () => {
  const cancelled = row({ state: 'active', cancel_at_period_end: true, access_until: days(5), event_seq: 1 });
  const r = apply(cancelled, ev({ type: 'subscription_renewed', seq: 2, period_end: days(35) }));
  assert.equal(r.next.cancel_at_period_end, false);
  assert.equal(r.next.access_until, days(35));
});

// ---------------------------------------------------------------------------
// BILLING NEVER TOUCHES AN OVERRIDE
// ---------------------------------------------------------------------------
test('a beta tester whose card is declined is still a beta tester', () => {
  const tester = row({ override: 'beta', override_note: 'wave 1', state: 'active',
                       access_until: days(10), event_seq: 1 });
  const r = apply(tester, ev({ type: 'subscription_ended', seq: 2 }));
  assert.equal(r.next.override, 'beta');
  assert.equal(r.next.override_note, 'wave 1');
  assert.equal(allowed(r.next, days(30)), true,
    'an override outranks every commercial rule, which is the point of having one');
});

test('no transition writes an override field, in either direction', () => {
  const owner = row({ override: 'owner', override_expires_at: days(365), override_note: 'hq' });
  B.EVENTS.forEach(type => {
    const r = apply(owner, ev({ type, seq: 99 }));
    assert.equal(r.next.override, 'owner', type + ' moved the override');
    assert.equal(r.next.override_expires_at, days(365), type + ' moved the override expiry');
    assert.equal(r.next.override_note, 'hq', type + ' moved the override note');
  });
});

test('the write patch carries billing columns and nothing else', () => {
  const patch = B.billingPatch(apply(row(), ev()).next);
  assert.deepEqual(Object.keys(patch).sort(),
    B.BILLING_COLUMNS.concat(['updated_at']).sort());
  ['override', 'override_expires_at', 'override_note', 'user_id']
    .forEach(k => assert.ok(!(k in patch),
      k + ' in the patch would let an in-flight event clobber a concurrent change'));
});

// ---------------------------------------------------------------------------
// SELF-HEALING AFTER MISSED EVENTS
// ---------------------------------------------------------------------------
test('a snapshot converges a row that missed a month of events', () => {
  const stale = row({ state: 'active', access_until: days(-40), event_seq: 3,
                      last_event_at: days(-45) });
  const r = B.reconcileEntitlement(stale, {
    user_id: UID, state: 'active', access_until: days(20), as_of: NOW.toISOString()
  }, NOW);
  assert.equal(r.applied, true);
  assert.equal(r.reason, 'snapshot_applied');
  assert.equal(r.next.access_until, days(20));
  assert.equal(allowed(r.next, days(10)), true);
});

test('a snapshot may move a row backwards, because it is about now', () => {
  const generous = row({ state: 'active', access_until: days(90), last_event_at: days(-1) });
  const r = B.reconcileEntitlement(generous, {
    state: 'expired', access_until: days(-1), as_of: NOW.toISOString() }, NOW);
  assert.equal(r.next.state, 'expired');
  assert.equal(allowed(r.next, NOW.toISOString()), false,
    'events are about a moment; a snapshot is about the present, and only it may do this');
});

test('a snapshot older than the last event we processed is refused', () => {
  const current = row({ state: 'active', access_until: days(30), last_event_at: days(-1) });
  const r = B.reconcileEntitlement(current, {
    state: 'expired', access_until: days(-10), as_of: days(-5) }, NOW);
  assert.equal(r.applied, false);
  assert.equal(r.reason, 'snapshot_stale');
  assert.equal(r.next.access_until, days(30));
});

test('a snapshot does not advance the event sequence', () => {
  const cur = row({ event_seq: 4, last_event_at: days(-1) });
  const r = B.reconcileEntitlement(cur, { state: 'active', access_until: days(30), as_of: NOW.toISOString() }, NOW);
  assert.equal(r.next.event_seq, 4,
    'a redelivered stale event must still be judgeable after a reconcile');
});

test('a snapshot with a state nothing recognises changes nothing', () => {
  const cur = row({ state: 'active', access_until: days(30) });
  const r = B.reconcileEntitlement(cur, { state: 'past_due', as_of: NOW.toISOString() }, NOW);
  assert.equal(r.applied, false);
  assert.equal(r.reason, 'snapshot_invalid');
  assert.equal(r.next.access_until, days(30));
});

test('a snapshot leaves an override alone too', () => {
  const tester = row({ override: 'beta', state: 'active', access_until: days(5) });
  const r = B.reconcileEntitlement(tester, { state: 'expired', access_until: days(-1), as_of: NOW.toISOString() }, NOW);
  assert.equal(r.next.override, 'beta');
  assert.equal(allowed(r.next, days(30)), true);
});

// ---------------------------------------------------------------------------
// WHEN CREDENTIALS MUST DIE IMMEDIATELY
// ---------------------------------------------------------------------------
test('losing access revokes leases rather than waiting twelve hours for them', () => {
  const before = row({ state: 'active', access_until: days(30) });
  const after = apply(before, ev({ type: 'subscription_ended', seq: 2 })).next;
  assert.equal(B.endsAccessNow(before, after, NOW), true,
    '"revoked within twelve hours" is not what revoked means');
});

test('gaining or keeping access revokes nothing', () => {
  const before = row({ state: 'active', access_until: days(10) });
  assert.equal(B.endsAccessNow(before, apply(before, ev({ type: 'subscription_renewed', seq: 2, period_end: days(40) })).next, NOW), false);
  assert.equal(B.endsAccessNow(before, apply(before, ev({ type: 'payment_failed', seq: 2 })).next, NOW), false,
    'grace is access — an athlete mid-block is not logged out over a declined card');
  assert.equal(B.endsAccessNow(row(), apply(row(), ev({ seq: 1, period_end: days(30) })).next, NOW), false);
});

test('an override still standing means access did not end', () => {
  const before = row({ override: 'owner', state: 'active', access_until: days(2) });
  const after = apply(before, ev({ type: 'subscription_ended', seq: 2 })).next;
  assert.equal(B.endsAccessNow(before, after, NOW), false,
    'revoking an owner’s leases because a subscription lapsed is how HQ locks itself out');
});

// ---------------------------------------------------------------------------
// THE GATE READS WHAT THE LIFECYCLE WRITES
// ---------------------------------------------------------------------------
function allowed(ent, now){
  return A.resolveAccess({ uid: UID, entitlement: ent, accountRequired: true,
                           commercialRequired: true, now: new Date(now) }).allow;
}

test('every lifecycle outcome is legible to the access decision', () => {
  const cases = [
    ['trial_started',        days(14), true],
    ['subscription_started', days(30), true],
    ['subscription_renewed', days(30), true],
    ['payment_failed',       null,     true],
    ['subscription_ended',   null,     false]
  ];
  cases.forEach(([type, periodEnd, expect], i) => {
    const seeded = row({ state: 'active', access_until: days(20), event_seq: i });
    const r = apply(seeded, ev({ type, seq: i + 100, period_end: periodEnd }));
    assert.equal(allowed(r.next, NOW.toISOString()), expect,
      type + ' should ' + (expect ? '' : 'not ') + 'grant access');
  });
});

test('a state and a timestamp that disagree fail closed', () => {
  assert.equal(allowed(row({ state: 'active', access_until: days(-1) }), NOW.toISOString()), false,
    'the timestamp is the authority');
  assert.equal(allowed(row({ state: 'expired', access_until: days(30) }), NOW.toISOString()), false,
    'and a state that says expired is not overruled by a generous timestamp');
});

test('a malformed access_until is refused, not parsed optimistically', () => {
  assert.equal(allowed(row({ state: 'active', access_until: 'whenever' }), NOW.toISOString()), false);
});
