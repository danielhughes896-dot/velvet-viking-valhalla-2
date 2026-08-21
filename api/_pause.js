// Velvet Viking -- the monthly pause, as a policy rather than as a provider call.
//
// WHY THIS IS ITS OWN FILE. A pause is two separate things that are easy to
// confuse: a RULE about what Valhalla will allow, and an INSTRUCTION to whoever
// is collecting the money. If those live together, the rule ends up expressed
// in whatever vocabulary the current provider happens to use, and the day a
// second provider arrives there is no rule left to port -- only a Stripe call
// with some conditions round it.
//
// So everything here is pure and provider-neutral. It reads a subscription row
// and a clock and returns a decision. It makes no network call, knows no
// provider's field names, and cannot be made to charge or refund anybody.
// _stripe.js carries out what this file decides; if that carrying-out fails,
// nothing here has been written and the athlete is exactly where they started.
//
// THE POLICY, AND THE REASONING BEHIND EACH LINE
//
//   MONTHLY ONLY. An annual subscriber has already paid for the year. There is
//   no collection to suspend, so a "pause" could only mean extending the term
//   -- a different product, a different price and a different promise. Refused
//   rather than approximated.
//
//   UP TO THREE MONTHS. Long enough for the injury, the operation or the winter
//   that this exists for. Beyond that the honest answer is to cancel and come
//   back, because a subscription nobody is paying for and nobody is using is
//   not a subscription.
//
//   ONCE PER ROLLING YEAR. Not per calendar year -- a calendar boundary lets
//   somebody pause in December and again in January and take six months off
//   inside eight weeks. Measured from last_pause_started_at, which is why that
//   column SURVIVES the resume: it is not a copy of paused_at, it is the memory
//   that makes the rule enforceable at all.
//
//   ACCESS STOPS WITH BILLING. A pause that keeps the product working is a free
//   month with extra steps. Both stop, and both come back together.
//
//   IT RESUMES ITSELF. A pause that needs the athlete to come back and press
//   something is a cancellation with a friendly name, and it is the version
//   that quietly keeps somebody's money.
//
//   THE AGREEMENT SURVIVES. Nothing here touches agreed_price_minor,
//   agreed_currency, catalogue_version or price_locked_at. A founding
//   subscriber who pauses is the same founding subscriber when they come back;
//   that is the whole difference between pausing and cancelling.

'use strict';

const E = require('./_entitlement.js');

const DAY_MS = 24 * 60 * 60 * 1000;

const PAUSE_POLICY = {
  /* Whole months only. "Six weeks" is a negotiation, and a policy that
     negotiates is a policy with no edges to test. */
  minMonths: 1,
  maxMonths: 3,
  billingPeriod: 'monthly',
  /* 365 days, not "a calendar year". See above. */
  rollingWindowDays: 365,
  accessWhilePaused: false,
  automaticResume: true
};

/* Refusals, named. Product-facing and stable, because these are the sentences
   an athlete reads -- not an enum leaked from a provider. */
const PAUSE_REFUSALS = [
  'no_subscription', 'not_monthly', 'not_active', 'already_paused',
  'used_this_year', 'bad_duration', 'cancelling'
];

/* Adding months to an instant, without a date library and without the classic
   bug. Adding 90 days is not three months, and setMonth() on the 31st silently
   lands in the month after next. Clamping to the last valid day of the target
   month is what a human means by "three months from the 31st". */
function addMonths(from, months){
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/* IS THIS SUBSCRIPTION PAUSED RIGHT NOW.
 *
 * Derived from the window, never from a boolean column. A stored `is_paused`
 * flag has to be switched off by something, and the something is a job that can
 * fail, be delayed, or be run twice -- which is how an athlete stays locked out
 * for a fortnight after their pause ended. A window that simply stops
 * containing `now` cannot fail to expire.
 *
 * A paused_at with no resume date is treated as NOT paused: an open-ended
 * suspension with no automatic end is the failure this policy exists to
 * prevent, so a half-written row must fail towards the athlete having access. */
function pauseState(sub, now){
  const s = sub || {};
  const at = E.asDate(now) || new Date();
  /* ONE implementation of "is it paused", and it is the resolver's. If this
     asked the question its own way, the day the two answers diverged would be
     the day an athlete was billed for a month they could not use -- or used a
     month nobody billed. */
  const live = E.pausedNow(s, at);
  const resumes = E.asDate(s.pause_resumes_at);
  return {
    paused: !!live,
    since: live ? live.since.toISOString() : null,
    resumesAt: resumes ? resumes.toISOString() : null,
    daysRemaining: live ? Math.ceil((live.until.getTime() - at.getTime()) / DAY_MS) : 0
  };
}

/* Has this subscription's pause window closed while the row still carries it?
 * The resume sweep's question. Answering it here rather than in the sweep keeps
 * "when is a pause over" in one place. */
function dueToResume(sub, now){
  const s = sub || {};
  const at = E.asDate(now) || new Date();
  const resumes = E.asDate(s.pause_resumes_at);
  return !!(s.paused_at && resumes && resumes <= at);
}

/* MAY THIS SUBSCRIPTION BE PAUSED AT ALL.
 *
 * Order matters here and it is not alphabetical: each refusal is checked before
 * the ones it would otherwise mask, so an athlete is told the most useful true
 * thing rather than the first one the code happened to reach. Somebody on an
 * annual plan should hear "annual plans cannot be paused", not "you already
 * used your pause this year". */
function mayPause(sub, now){
  const s = sub || {};
  const at = E.asDate(now) || new Date();
  if (!s.provider || !s.condition) return { ok: false, reason: 'no_subscription' };

  if (s.billing_period !== PAUSE_POLICY.billingPeriod) return { ok: false, reason: 'not_monthly' };

  /* ACTIVE ONLY, and 'active' means active. A trial has nothing to collect yet,
     so pausing it would only shorten the trial. past_due has a payment problem
     to solve first. expired and revoked have nothing left to pause. */
  if (s.condition !== 'active') return { ok: false, reason: 'not_active' };

  /* Already on the way out. Pausing a subscription that is set to end would
     either quietly cancel the cancellation or produce a pause that outlives the
     subscription -- and both are surprises at the athlete's expense. */
  if (s.cancel_at_period_end) return { ok: false, reason: 'cancelling' };

  if (pauseState(s, at).paused) return { ok: false, reason: 'already_paused' };

  /* THE ROLLING YEAR, measured from the last pause's START. From the start
     rather than the end, so a three-month pause does not push the next
     eligibility fifteen months out -- the rule is one pause per year, not one
     pause per year of continuous payment. */
  const last = E.asDate(s.last_pause_started_at);
  if (last){
    const eligible = new Date(last.getTime() + PAUSE_POLICY.rollingWindowDays * DAY_MS);
    if (at < eligible){
      return { ok: false, reason: 'used_this_year', eligibleFrom: eligible.toISOString() };
    }
  }
  return { ok: true, reason: 'ok' };
}

/* THE WRITE, COMPUTED BUT NOT PERFORMED.
 *
 * Returns the exact patch and the exact instruction for the provider, and
 * writes nothing. The caller applies the provider first and our row second: if
 * the provider refuses, no row has changed and the athlete's subscription is
 * untouched. The other order produces a subscription that Valhalla believes is
 * paused and Stripe is still charging for, which is the version that ends up in
 * a complaint.
 *
 * last_pause_started_at is set to the SAME instant as paused_at here, and is
 * never cleared afterwards. */
function planPause(sub, months, now){
  const at = E.asDate(now) || new Date();
  const n = Number(months);
  if (!isFinite(n) || Math.floor(n) !== n ||
      n < PAUSE_POLICY.minMonths || n > PAUSE_POLICY.maxMonths){
    return { ok: false, reason: 'bad_duration' };
  }
  const may = mayPause(sub, at);
  if (!may.ok) return may;

  const resumes = addMonths(at, n);
  return {
    ok: true,
    reason: 'ok',
    months: n,
    /* Ours. */
    patch: {
      paused_at: at.toISOString(),
      pause_resumes_at: resumes.toISOString(),
      last_pause_started_at: at.toISOString()
    },
    /* Theirs -- provider-neutral, in our words. _stripe.js turns this into
       whatever that provider calls it. */
    providerInstruction: {
      action: 'suspend_collection',
      resumesAt: resumes.toISOString(),
      /* No invoice is to be raised for the paused period and none is to be
         collected afterwards. A pause that accrues a bill is a deferral. */
      chargeForPausedPeriod: false
    }
  };
}

/* THE RESUME. Clears the window and KEEPS THE MEMORY.
 *
 * If last_pause_started_at were cleared here, an athlete could pause, resume
 * the same afternoon and pause again -- three months at a time, indefinitely.
 * The column exists precisely so the resume cannot erase the fact that a pause
 * happened. */
function planResume(sub, now){
  const s = sub || {};
  const at = E.asDate(now) || new Date();
  if (!s.paused_at) return { ok: false, reason: 'not_paused' };
  return {
    ok: true,
    reason: 'ok',
    early: !dueToResume(s, at),
    patch: {
      paused_at: null,
      pause_resumes_at: null
      /* last_pause_started_at is ABSENT, not null. A patch that named it would
         eventually be "tidied up" to null by somebody making the shape
         symmetrical, and the rolling-year rule would silently stop working. */
    },
    providerInstruction: { action: 'resume_collection' }
  };
}

/* CANCELLING WHILE PAUSED is allowed, and it is not a special case -- it is the
 * ordinary cancellation, stated here because it is the question everyone asks.
 * The athlete is paying nothing and receiving nothing, so there is no period
 * left to run out: the relationship ends now rather than at a period end that
 * is not currently advancing. The pause window is cleared with it, and
 * last_pause_started_at still survives -- coming back next month is a NEW
 * agreement at the CURRENT price, and it must not arrive with a fresh pause
 * allowance the athlete did not earn. */
function planCancelWhilePaused(sub, now){
  const s = sub || {};
  const at = E.asDate(now) || new Date();
  if (!pauseState(s, at).paused) return { ok: false, reason: 'not_paused' };
  return {
    ok: true,
    reason: 'ok',
    patch: {
      condition: 'expired',
      cancelled_at: at.toISOString(),
      cancel_at_period_end: false,
      auto_renew: false,
      paused_at: null,
      pause_resumes_at: null
    },
    providerInstruction: { action: 'cancel_now' }
  };
}

module.exports = {
  PAUSE_POLICY, PAUSE_REFUSALS,
  addMonths, pauseState, dueToResume, mayPause, planPause, planResume,
  planCancelWhilePaused
};
