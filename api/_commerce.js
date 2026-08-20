// Velvet Viking -- the commercial offering, server-side.
//
// WHY THIS FILE EXISTS. Price is a fact about what we charge, and it must be
// established somewhere the browser cannot reach. The website renders prices so
// a human can read them; this file decides what a human is actually charged.
// Those are different jobs and they must not share a source, because the moment
// they do, an edit to marketing copy becomes an edit to a bill.
//
// WHAT IS AUTHORITATIVE HERE, AND WHAT IS NOT
//   authoritative : the set of billing periods that exist at all
//   authoritative : the tier and trial length attached to each
//   NOT           : any amount in this file. The amounts below are DISPLAY and
//                   RECONCILIATION values -- what we believe we are selling.
//                   The provider charges whatever its own price object says,
//                   and the webhook records what it reports having charged. If
//                   those two ever disagree, the provider is right and this
//                   file is a bug.
//   NOT           : which provider sells this, or what its price object is
//                   called. That mapping belongs to the adapter, and this file
//                   would read identically if the offering were sold through
//                   an app store.
//
// Resolving a period to a provider's price object lives with that provider; see
// the adapter's own priceFor.

'use strict';

const CURRENCY = 'GBP';
const TRIAL_DAYS = 14;

/* The two approved periods, and nothing else is a period. This array is the
   allow-list the checkout seam validates against -- not a regex, not a
   truthiness check on a string the browser sent. */
const PERIODS = ['monthly', 'yearly'];

/* The offering. `amount` is in minor units because that is how every payment
   provider counts money and how it must be compared. */
const OFFERING = {
  monthly: {
    period: 'monthly',
    interval: 'month',
    tier: 'standard',
    amountMinor: 1199,
    currency: CURRENCY,
    trialDays: TRIAL_DAYS
  },
  yearly: {
    period: 'yearly',
    interval: 'year',
    tier: 'standard',
    amountMinor: 8999,
    currency: CURRENCY,
    trialDays: TRIAL_DAYS
  }
};

/* Is this a period we sell? Deliberately strict: an unknown value is not
   coerced, defaulted or trimmed into a known one. A checkout for a period we
   do not recognise is a bug or an attack, and both want the same answer. */
function isPeriod(v){
  return typeof v === 'string' && PERIODS.indexOf(v) !== -1;
}

/* The plan for a period, or null. Never a fallback to monthly: silently
   charging the cheaper thing is still charging the wrong thing. */
function planFor(period){
  return isPeriod(period) ? OFFERING[period] : null;
}

/* What the account and pricing surfaces may be told. No env values, no price
   ids: a price id is not secret, but it is operational plumbing and a screen
   that shows one invites a support conversation about it. */
function publicOffering(isConfigured){
  const probe = typeof isConfigured === 'function' ? isConfigured : function(){ return false; };
  return PERIODS.map(function(p){
    const plan = OFFERING[p];
    return {
      period: plan.period,
      tier: plan.tier,
      amountMinor: plan.amountMinor,
      currency: plan.currency,
      trialDays: plan.trialDays,
      configured: !!probe(p)
    };
  });
}

module.exports = {
  CURRENCY, TRIAL_DAYS, PERIODS, OFFERING,
  isPeriod, planFor, publicOffering
};
