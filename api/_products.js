// Velvet Viking -- the product catalogue.
//
// ONE PRODUCT. Valhalla sells Valhalla Standard, monthly or yearly, with a
// fourteen-day introductory trial. That is the whole commercial surface, and
// stating it in one place is what stops it being restated, slightly
// differently, in a checkout page, a paywall, an App Store description and a
// webhook handler.
//
// WHAT A PRODUCT IS AND WHAT AN OFFER IS. These are not the same thing and the
// distinction is load-bearing:
//
//   PRODUCT   VALHALLA_STANDARD -- what the athlete may DO. This is what the
//             entitlement layer grants and what the coaching engine, if it
//             ever asks anything at all, asks about.
//   OFFER     STANDARD_MONTHLY / STANDARD_YEARLY -- how they PAY for it. A
//             billing period and a price. Two athletes on different offers
//             have identical access.
//
// So entitlement is never keyed on an offer, and never on a price. A yearly
// subscriber and a monthly subscriber both resolve to Standard; changing the
// yearly price, adding a quarterly offer or running a regional promotion
// touches this file and nothing downstream.
//
// PRICES ARE DISPLAY, NOT AUTHORITY. The pence figures below are the current
// UK commercial intent, recorded so a screen can render them honestly before
// any provider is wired up. They are NOT what anyone is charged -- the
// provider charges, and the provider's amount is the true one. Nothing in the
// entitlement path may branch on a price.
//
// NO FAKE PROVIDER IDENTIFIERS. There is deliberately no Stripe price id, no
// App Store product id and no Play base plan id anywhere in this file. Those
// are created in a provider's console by a human, and inventing plausible ones
// now would produce a catalogue that looks configured and silently sells
// nothing. `providerRef()` reads them from the environment and returns null
// when they are absent, and every caller is required to treat null as
// "this offer cannot be purchased through this provider yet".

'use strict';

/* The one product code. Written once; imported everywhere. */
const STANDARD = 'VALHALLA_STANDARD';

/* The providers this model is built to normalise. 'web' is whichever web
   billing provider Phase 2 chooses -- the code is deliberately the CHANNEL and
   not the vendor, because an athlete who pays on a website has bought the same
   thing regardless of who processed the card, and a vendor change must not
   become a migration of every subscription row. */
const PROVIDERS = ['web', 'apple', 'google'];

/* Billing environments. Recorded from the first row rather than added later:
   a sandbox Apple notification and a production one are indistinguishable
   once the column does not exist, and telling them apart afterwards means
   guessing from identifiers. */
const ENVIRONMENTS = ['production', 'sandbox'];

/* Fourteen days, one allowance per ATHLETE -- not per provider, not per
   device, not per email address. Enforced in _entitlement.js and owned by the
   account_commercial row; stated here because it is a property of the offer. */
const TRIAL_DAYS = 14;

const OFFERS = {
  STANDARD_MONTHLY: {
    code: 'STANDARD_MONTHLY',
    product: STANDARD,
    billingPeriod: 'monthly',
    /* Integer minor units. A float would eventually be compared, rounded or
       summed, and money that goes through a float is money that is wrong on
       some fraction of rows. */
    priceMinor: 1199,
    currency: 'GBP',
    trialDays: TRIAL_DAYS
  },
  STANDARD_YEARLY: {
    code: 'STANDARD_YEARLY',
    product: STANDARD,
    billingPeriod: 'yearly',
    priceMinor: 8999,
    currency: 'GBP',
    trialDays: TRIAL_DAYS
  }
};

const PRODUCTS = {
  [STANDARD]: {
    code: STANDARD,
    name: 'Valhalla Standard',
    offers: ['STANDARD_MONTHLY', 'STANDARD_YEARLY']
  }
};

const BILLING_PERIODS = ['monthly', 'yearly'];

function isProduct(code){ return Object.prototype.hasOwnProperty.call(PRODUCTS, code); }
function isOffer(code){ return Object.prototype.hasOwnProperty.call(OFFERS, code); }
function isProvider(p){ return PROVIDERS.indexOf(p) !== -1; }
function isEnvironment(e){ return ENVIRONMENTS.indexOf(e) !== -1; }

function offer(code){
  return isOffer(code) ? Object.assign({}, OFFERS[code]) : null;
}
function product(code){
  if (!isProduct(code)) return null;
  const p = PRODUCTS[code];
  return { code: p.code, name: p.name, offers: p.offers.slice() };
}
function offersFor(productCode){
  const p = PRODUCTS[productCode];
  return p ? p.offers.map(offer) : [];
}

/* Which offer does a billing period name? Used when a provider tells us the
   term of a purchase but not our offer code -- Apple and Google both describe
   a subscription by its own product identifier, and the mapping back has to
   land on one of ours or fail. */
function offerForPeriod(period){
  const hit = Object.keys(OFFERS).filter(function(k){
    return OFFERS[k].product === STANDARD && OFFERS[k].billingPeriod === period;
  })[0];
  return hit ? offer(hit) : null;
}

/* ---------- provider identifiers ----------
   The bridge between our offer codes and the identifiers a provider's console
   will eventually hold. Read from the environment, never hardcoded, never
   guessed.

   Naming is mechanical so a new offer needs no code change:
     VVV_PRICE_WEB_STANDARD_MONTHLY
     VVV_PRICE_APPLE_STANDARD_YEARLY
     VVV_PRICE_GOOGLE_STANDARD_MONTHLY

   FAILS CLOSED. An unset variable returns null and `purchasable()` says no.
   The alternative -- a placeholder string that looks like an id -- produces a
   checkout that 404s at the provider, after the athlete has committed, which
   is the worst possible place to discover a configuration gap. */
function providerRefEnvName(provider, offerCode){
  return 'VVV_PRICE_' + String(provider).toUpperCase() + '_' + String(offerCode).toUpperCase();
}
function providerRef(provider, offerCode, env){
  if (!isProvider(provider) || !isOffer(offerCode)) return null;
  const source = env || process.env || {};
  const v = source[providerRefEnvName(provider, offerCode)];
  const s = v == null ? '' : String(v).trim();
  return s === '' ? null : s;
}
function purchasable(provider, offerCode, env){
  return providerRef(provider, offerCode, env) != null;
}

/* The catalogue as a screen would render it. `available` is honest about
   configuration: an offer with no provider identifier is listed, priced, and
   marked unavailable, rather than hidden -- "£89.99/year, not open yet" is
   information; a missing row is a bug report. */
function catalogue(provider, env){
  return {
    product: product(STANDARD),
    trialDays: TRIAL_DAYS,
    offers: offersFor(STANDARD).map(function(o){
      return Object.assign({}, o, {
        available: provider ? purchasable(provider, o.code, env) : false,
        providerRefConfigured: provider ? purchasable(provider, o.code, env) : false
      });
    })
  };
}

module.exports = {
  STANDARD, PRODUCTS, OFFERS, PROVIDERS, ENVIRONMENTS, BILLING_PERIODS, TRIAL_DAYS,
  isProduct, isOffer, isProvider, isEnvironment,
  product, offer, offersFor, offerForPeriod,
  providerRefEnvName, providerRef, purchasable, catalogue
};
