// Velvet Viking -- Phase 3A2: the subscription lifecycle.
//
// WHY THIS IS A SEPARATE, PURE FILE. Whether an athlete may be handed the
// product is decided in _access.js. This file decides something narrower and
// noisier: what the entitlement row should say after a payment provider tells
// us something happened. Those are different jobs, and mixing them would put
// webhook vocabulary -- retries, replays, out-of-order deliveries, provider
// enum names -- inside the security boundary.
//
// Everything here is a pure function of (current row, event, now). No network,
// no clock, no environment. That is what lets the suite exercise the real
// lifecycle at its boundaries rather than a paraphrase of it, including the
// cases that are impossible to produce on demand from a live provider: a
// duplicate delivery, an event that arrives after the one that supersedes it,
// and a month of missed events.
//
// THE MODEL, restated from supabase-entitlement.sql because it is the thing
// most likely to be eroded by a future edit:
//
//   `state` says what KIND of access this is. `access_until` says when it
//   ends. Those two are never allowed to disagree, because ACCESS IS DECIDED
//   BY THE TIMESTAMP -- _access.js checks access_until first and treats the
//   state as a label. So "cancelled but paid through Friday" is
//   state='active' + cancel_at_period_end=true + access_until=Friday. Three
//   facts that cannot contradict each other, rather than a fourth state that
//   can.
//
//   `override` is ORTHOGONAL and this file never writes it. An owner is not a
//   kind of subscriber, and a beta tester whose card is declined must not
//   quietly stop being a beta tester. Every function below copies the override
//   fields through untouched, and a test asserts it.
//
//   `provider` and the provider_* ids are opaque strings. No payment
//   provider's vocabulary is allowed to become this application's access
//   model, which is why the events below are OUR names, normalised at the
//   edge, and not any provider's.

'use strict';

/* How long access survives a failed payment. A card that expires on a Sunday
   should not end a training block on a Sunday: the athlete gets long enough to
   notice an email and fix it, and the coach keeps working meanwhile. Seven
   days is the shortest window that spans a full training week, which is the
   unit an athlete actually plans in. */
const GRACE_DAYS = 7;

const STATES = ['trial', 'active', 'grace', 'expired'];

/* OUR event vocabulary. A provider that calls it `invoice.payment_failed` or
   `BILLING_RETRY_EXHAUSTED` is normalised to one of these at the edge, in the
   webhook handler, so this file never learns a provider's names. */
const EVENTS = [
  'trial_started',
  'subscription_started',
  'subscription_renewed',
  'subscription_cancelled',      // cancel at period end -- access continues
  'subscription_resumed',        // the cancellation was undone before it landed
  'payment_failed',              // -> grace
  'payment_recovered',           // <- grace
  'subscription_ended'           // access ends now
];

const DAY_MS = 24 * 60 * 60 * 1000;

function asDate(v){
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function iso(d){ return d ? new Date(d).toISOString() : null; }

/* The row as it would exist for an athlete nothing has ever happened to.
   Deliberately 'expired' with no access_until: an entitlement we know nothing
   about must never be an entitlement that grants something. */
function emptyEntitlement(uid){
  return {
    user_id: uid || null,
    state: 'expired', tier: 'standard',
    access_until: null, cancel_at_period_end: false,
    override: null, override_expires_at: null, override_note: null,
    provider: null, provider_customer_id: null, provider_sub_id: null,
    event_seq: null, last_event_at: null
  };
}

/* The override fields, carried through every transition untouched. Written as
   one function rather than repeated spreads so that "billing never touches an
   override" is a single line somebody would have to deliberately delete. */
function carryOverride(from, onto){
  onto.override = from.override == null ? null : from.override;
  onto.override_expires_at = from.override_expires_at == null ? null : from.override_expires_at;
  onto.override_note = from.override_note == null ? null : from.override_note;
  return onto;
}

/* ---------- ordering ----------
   A webhook endpoint is not a queue. The same event arrives twice because the
   first 200 was lost on the way back; a renewal arrives after the cancellation
   that supersedes it because two delivery attempts raced; an event from last
   month arrives today because the provider drained a backlog.
   `seq` is a provider-assigned monotonic number per subscription, normalised
   at the edge. Strictly greater wins; anything else is DROPPED, not failed --
   a webhook that answers 500 to a duplicate gets that duplicate forever. */
function eventOrder(current, event){
  const have = current && current.event_seq != null ? Number(current.event_seq) : null;
  const got = event && event.seq != null ? Number(event.seq) : null;
  if (got == null || !isFinite(got)) return 'unsequenced';
  if (have == null) return 'apply';
  if (got > have) return 'apply';
  if (got === have) return 'duplicate';
  return 'stale';
}

/* ---------- the transition ----------
   Returns { applied, reason, next }. `applied:false` is a normal outcome, not
   an error: the caller answers 200 and the provider stops retrying. */
function applyBillingEvent(current, event, now){
  const at = asDate(now) || new Date();
  const cur = current ? Object.assign(emptyEntitlement(current.user_id), current)
                      : emptyEntitlement(event && event.user_id);
  const ev = event || {};

  if (EVENTS.indexOf(ev.type) === -1) return drop(cur, 'unknown_event');
  if (!ev.user_id && !cur.user_id) return drop(cur, 'no_subject');

  const order = eventOrder(cur, ev);
  if (order === 'duplicate') return drop(cur, 'duplicate');
  if (order === 'stale') return drop(cur, 'out_of_order');
  /* An unsequenced event is not trusted to move the row backwards, but it must
     still be able to move it forwards -- some providers only sequence within a
     subscription and send lifecycle notices outside it. It is applied and the
     stored seq is left alone, so a later sequenced event still wins. */

  const next = carryOverride(cur, Object.assign({}, cur));
  next.user_id = cur.user_id || ev.user_id;
  if (ev.provider) next.provider = ev.provider;
  if (ev.customer_id) next.provider_customer_id = ev.customer_id;
  if (ev.sub_id) next.provider_sub_id = ev.sub_id;
  if (ev.tier) next.tier = ev.tier;
  if (order === 'apply' && ev.seq != null) next.event_seq = Number(ev.seq);
  next.last_event_at = iso(asDate(ev.occurred_at) || at);

  const periodEnd = asDate(ev.period_end);

  switch (ev.type){
    case 'trial_started':
      next.state = 'trial';
      next.cancel_at_period_end = false;
      next.access_until = iso(periodEnd);
      break;

    case 'subscription_started':
    case 'subscription_renewed':
    case 'payment_recovered':
      next.state = 'active';
      /* Recovering from grace does NOT inherit the grace window: the athlete
         is paid up again, so access runs to the period the payment bought.
         Extending the grace on top would quietly hand out a free week every
         time a card was retried. */
      next.access_until = iso(periodEnd);
      if (ev.type !== 'payment_recovered') next.cancel_at_period_end = false;
      break;

    case 'subscription_cancelled':
      /* NOT an ending. The athlete has paid through a date and keeps every
         capability until it arrives -- taking the product away the moment
         somebody clicks cancel is both wrong and the fastest way to earn a
         chargeback. The state stays what it was; only the flag moves. */
      next.cancel_at_period_end = true;
      if (periodEnd) next.access_until = iso(periodEnd);
      if (next.state === 'expired') next.state = 'active';
      break;

    case 'subscription_resumed':
      next.cancel_at_period_end = false;
      if (periodEnd) next.access_until = iso(periodEnd);
      if (next.state === 'expired') next.state = 'active';
      break;

    case 'payment_failed': {
      /* Grace runs from whichever is later: the end of the period already
         paid for, or now. A card that fails on day one of a month must not
         hand out that whole month again, and a card that fails after the
         period has already lapsed must still get its seven days. */
      next.state = 'grace';
      const paidUntil = asDate(next.access_until);
      const from = (paidUntil && paidUntil > at) ? paidUntil : at;
      const graceEnd = new Date(from.getTime() + GRACE_DAYS * DAY_MS);
      /* Never SHORTEN access. A failure notice arriving late must not claw
         back a window the athlete already had. */
      next.access_until = iso(paidUntil && paidUntil > graceEnd ? paidUntil : graceEnd);
      break;
    }

    case 'subscription_ended':
      /* The only transition that takes access away, and it takes it away NOW
         rather than at a stored timestamp -- an ended subscription with a
         future access_until is exactly the disagreement this model exists to
         make impossible. */
      next.state = 'expired';
      next.access_until = iso(asDate(ev.occurred_at) || at);
      next.cancel_at_period_end = false;
      break;
  }

  if (STATES.indexOf(next.state) === -1) next.state = 'expired';
  return { applied: true, reason: ev.type, next: next };
}

function drop(cur, reason){
  return { applied: false, reason: reason, next: cur };
}

/* ---------- self-healing ----------
   Events get missed. A deploy is mid-flight, a provider has an outage, a
   webhook secret is rotated an hour before anyone updates it. The recovery is
   NOT to replay history -- it is to ask the provider what is true now and
   assert it, which is why a snapshot carries no `seq` and no event type.

   A snapshot wins over the stored row when it is at least as new as the last
   event we processed. It is the one path that may move the row backwards,
   because it is the only input that is authoritative about the present rather
   than about a moment. Overrides are still untouched. */
function reconcileEntitlement(current, snapshot, now){
  const at = asDate(now) || new Date();
  const cur = current ? Object.assign(emptyEntitlement(current.user_id), current)
                      : emptyEntitlement(snapshot && snapshot.user_id);
  const snap = snapshot || {};
  const asOf = asDate(snap.as_of) || at;
  const lastAt = asDate(cur.last_event_at);

  if (lastAt && asOf < lastAt) return { applied: false, reason: 'snapshot_stale', next: cur };
  if (STATES.indexOf(snap.state) === -1) return { applied: false, reason: 'snapshot_invalid', next: cur };

  const next = carryOverride(cur, Object.assign({}, cur));
  next.user_id = cur.user_id || snap.user_id;
  next.state = snap.state;
  next.access_until = iso(asDate(snap.access_until));
  next.cancel_at_period_end = !!snap.cancel_at_period_end;
  if (snap.tier) next.tier = snap.tier;
  if (snap.provider) next.provider = snap.provider;
  if (snap.customer_id) next.provider_customer_id = snap.customer_id;
  if (snap.sub_id) next.provider_sub_id = snap.sub_id;
  /* The snapshot deliberately does NOT advance event_seq. If the provider
     later redelivers the events the snapshot already covers, ordering must
     still be able to reject the ones that are genuinely stale. */
  next.last_event_at = iso(asOf);

  const changed = ['state', 'access_until', 'cancel_at_period_end', 'tier']
    .some(function(k){ return String(cur[k]) !== String(next[k]); });
  return { applied: true, reason: changed ? 'snapshot_applied' : 'snapshot_no_change', next: next };
}

/* Only the columns billing owns. Sending the whole row back would let a
   lifecycle write clobber an override that changed while the event was in
   flight -- which is the same class of bug as the plan-reconciliation races
   this product has already been bitten by once. */
const BILLING_COLUMNS = ['state', 'tier', 'access_until', 'cancel_at_period_end',
                         'provider', 'provider_customer_id', 'provider_sub_id',
                         'event_seq', 'last_event_at'];
function billingPatch(next){
  const out = {};
  BILLING_COLUMNS.forEach(function(k){ out[k] = next[k] === undefined ? null : next[k]; });
  out.updated_at = new Date().toISOString();
  return out;
}

/* Whether a transition means live credentials must die immediately rather than
   at the end of their 12-hour lease. Losing access is the one direction where
   the delay is not acceptable -- it is the difference between "revocation is
   real" and "revocation is eventually". */
function endsAccessNow(before, after, now){
  const at = asDate(now) || new Date();
  const had = asDate(before && before.access_until);
  const has = asDate(after && after.access_until);
  const hadAccess = !!(had && had > at) || !!(before && before.override);
  const hasAccess = !!(has && has > at) || !!(after && after.override);
  return hadAccess && !hasAccess;
}

module.exports = {
  GRACE_DAYS, STATES, EVENTS, BILLING_COLUMNS,
  emptyEntitlement, eventOrder, applyBillingEvent, reconcileEntitlement,
  billingPatch, endsAccessNow
};
