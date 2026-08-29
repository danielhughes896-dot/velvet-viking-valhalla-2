// Velvet Viking -- the entitlement authority.
//
// ONE QUESTION: may this authenticated athlete use Valhalla Standard right now?
//
// Everything in this file is a PURE function of (facts, now). No network, no
// clock, no environment, no provider SDK. That is deliberate and it is the
// reason the suite can exercise the real decision at every boundary that
// matters -- the minute a trial ends, the hour a grace period lapses, the day
// a cancelled subscription finally runs out -- instead of a paraphrase of it.
// _commercial-store.js does the IO and calls in here for every judgement.
//
// THE THREE CONCEPTS, AND WHY THEY ARE THREE
//
//   ACCOUNT       an athlete. auth.users.id. Immutable, survives an email
//                 change, owns the training history.
//   SUBSCRIPTION  a purchase, mirrored from whichever provider owns it. Facts
//                 about billing. There can be several per account over time,
//                 through different providers.
//   ENTITLEMENT   whether access is granted right now, and why. DERIVED. Not
//                 a column anybody writes.
//
// Collapsing any two of these is the mistake this file exists to prevent. The
// concrete cases:
//
//   A subscription that is CANCELLED still grants access until the period the
//   athlete already paid for runs out. Cancellation stops renewal; it does not
//   confiscate a month someone bought. Anyone who treats "cancelled" as "no
//   access" ships a chargeback generator.
//
//   A subscription in the provider's GRACE PERIOD after a failed payment still
//   grants access. The provider is retrying the card; the athlete is mid
//   training block. We honour the provider's window and -- importantly -- we
//   do not add one of our own on top. When the provider's grace ends, access
//   ends, unless something else grants it.
//
//   A BETA GRANT is not a subscription. A tester is not a paying customer with
//   a strange price; they are an athlete with a non-commercial entitlement
//   source. Modelling them as a fake paid subscription puts fiction into the
//   revenue data and makes "did this person ever pay" unanswerable.
//
//   An athlete may hold MORE THAN ONE source at once -- a beta grant and a new
//   subscription during the changeover. Removing either one must not take
//   access away while the other is still valid. That is why resolution is a
//   fold over sources rather than a single winning column.
//
// FAIL CLOSED, ALWAYS. An unknown provider, an unknown lifecycle condition, an
// unparseable date, a missing account row: every one of them resolves to NO
// ACCESS with a reason, never to access-by-default. A commercial model that
// fails open is a commercial model that gives the product away on the first
// malformed webhook.

'use strict';

const P = require('./_products.js');

/* ---------- provider-neutral subscription lifecycle ----------
   OUR vocabulary. Stripe says `past_due`, Apple says the subscription is in a
   billing retry period, Google sends an RTDN with a SUBSCRIPTION_ON_HOLD type.
   All three normalise to one of these at the provider adapter, so no provider's
   enum ever reaches this file. Six conditions is the whole model, and it is
   small on purpose: every extra condition is another pair that can disagree.

     trialing   introductory period running
     active     paid, auto-renewing
     cancelled  auto-renew off; the paid period is still running
     past_due   payment failed; access depends on a PROVIDER-SUPPLIED grace end
     expired    the period is over, nothing is owed, no access
     revoked    provider pulled it -- refund, chargeback, fraud. No access,
                regardless of any date on the row.

   Note what is NOT here: no 'grace' condition. Grace is a TIMESTAMP the
   provider supplies (grace_period_end), not a state we can enter on our own.
   Making it a condition would let a bug put an athlete into grace forever with
   no provider fact behind it. */
const CONDITIONS = ['trialing', 'active', 'cancelled', 'past_due', 'expired', 'revoked'];

/* Non-commercial entitlement sources. Both are administrative grants issued
   through the owner boundary; neither is a purchase and neither consumes the
   athlete's one introductory trial. */
/* Non-subscription entitlement sources. Both are administrative grants issued
 * through the owner boundary; neither is a purchase and neither consumes the
 * athlete's trial.
 *
 * 'trial' WAS a third source here, for a card-free trial with no provider
 * behind it. HQ replaced that with a trial that takes a payment method upfront
 * and converts automatically, which makes it a real provider subscription --
 * and subscriptionAccess() already grants on condition='trialing' until
 * trial_end, already keeps granting when somebody cancels mid-trial, and
 * already reports the reason as 'trial'. So the standalone source is gone
 * rather than kept alongside: two trial authorities is exactly the duplication
 * this model has spent three phases removing. */
const GRANT_SOURCES = ['admin_beta', 'admin_comp'];

/* RETIRED AT COMMERCIAL LAUNCH, AND KEPT RATHER THAN DELETED.
 *
 * The private beta is over. A beta grant is no longer a way into the product,
 * and there is no longer any beta route into it at all -- an account either
 * holds a commercial entitlement or it does not.
 *
 * WHY THE SOURCE STAYS IN GRANT_SOURCES. The rows are history: who was given
 * what, by whom, and when. Deleting the vocabulary would make those rows
 * unreadable and turn an audit record into a column of orphaned strings. So
 * the source remains VALID and stops being ACTIVE, which is a different
 * statement and the one that is true.
 *
 * WHY IT IS DONE HERE. grantAccess() is the one place a grant becomes access.
 * Retiring it at the resolver means the delivery gate, the projection onto the
 * entitlements row, the subscription screen and the checkout eligibility rules
 * all stop honouring it in the same instant, because all four read this. */
const RETIRED_GRANT_SOURCES = ['admin_beta'];

/* Why access is granted or refused. Product-facing, stable, and deliberately
   NOT one-per-provider-lifecycle-state -- there are more provider states than
   there are reasons an athlete needs to be given. */
const REASONS = [
  'trial', 'paid', 'grace_period', 'admin_beta', 'admin_comp',
  'none', 'expired', 'payment_hold', 'revoked', 'invalid', 'paused'
];

/* Product-facing commercial states, derived. See derivedCommercialState(). */
const COMMERCIAL_STATES = ['none', 'trial', 'paid', 'paused', 'cancelled_active', 'expired'];

const DAY_MS = 24 * 60 * 60 * 1000;

/* Null for anything that is not a real instant. An invalid date must never
   compare as "in the future" -- `new Date('nonsense') > now` is false, which
   happens to be safe, but `null` makes the safety explicit rather than
   incidental. */
function asDate(v){
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function iso(d){ const x = asDate(d); return x ? x.toISOString() : null; }
function future(v, now){ const d = asDate(v); return !!(d && d > now); }

/* Read a date column with a fallback, distinguishing ABSENT from MALFORMED.
   The distinction is the whole point:

     absent    the provider does not use this column -- fall back, which is why
               a trial expressed as a first period still works
     malformed the row is corrupt -- REFUSE, rather than reading a different
               column and granting access on a value nobody was looking at

   Returns { ok, date }. ok:false is a hard fail-closed. */
function boundary(primary, fallback){
  if (primary != null){
    const d = asDate(primary);
    return d ? { ok: true, date: d } : { ok: false, date: null };
  }
  if (fallback != null){
    const d = asDate(fallback);
    return d ? { ok: true, date: d } : { ok: false, date: null };
  }
  return { ok: true, date: null };   // neither supplied: no window, not corrupt
}

/* The later of two instants, where null means OPEN-ENDED and therefore wins.
   An indefinite comp grant outlasts any dated subscription, and folding that
   as "null is smallest" would quietly expire it. */
function laterBound(a, b){
  if (a === null || b === null) return null;
  const da = asDate(a), db = asDate(b);
  if (!da) return db ? iso(db) : null;
  if (!db) return iso(da);
  return iso(da > db ? da : db);
}

// ===========================================================================
// SUBSCRIPTIONS
// ===========================================================================

/* IS THIS SUBSCRIPTION INSIDE A PAUSE WINDOW RIGHT NOW.
 *
 * Lives here rather than in _pause.js because it is an ACCESS question, and
 * because the access decision must not depend on the policy module -- the rules
 * about who may pause and for how long can change without the resolver
 * learning a new way to be wrong. _pause.js imports this; nothing imports
 * _pause.js from here.
 *
 * DERIVED FROM THE WINDOW, NEVER FROM A FLAG. A stored is_paused boolean has to
 * be switched off by something, and that something is a job that can fail, be
 * delayed or run twice -- which is how an athlete stays locked out for a
 * fortnight after their pause ended. A window that simply stops containing
 * `now` cannot fail to expire.
 *
 * A paused_at with no resume date is NOT a pause. An open-ended suspension with
 * no automatic end is exactly what the policy forbids, so a half-written row
 * fails towards the athlete keeping access rather than towards losing it. */
function pausedNow(sub, now){
  const s = sub || {};
  const at = asDate(now) || new Date();
  const started = asDate(s.paused_at);
  const resumes = asDate(s.pause_resumes_at);
  if (!started || !resumes) return null;
  return (started <= at && at < resumes) ? { since: started, until: resumes } : null;
}

/* Does this one subscription grant access right now, and until when?
   Returns { active, reason, until, commercial:true }.

   `until` is the instant access from THIS source ends. null would mean
   open-ended, which a subscription never is -- every branch below either
   supplies a date or refuses. */
function subscriptionAccess(sub, now){
  const at = asDate(now) || new Date();
  const s = sub || {};
  const out = function(active, reason, until){
    return { kind: 'subscription', commercial: true, active: active, reason: reason,
             until: iso(until), provider: s.provider || null,
             subscriptionId: s.id || null, condition: s.condition || null,
             product: s.product_code || null, offer: s.offer_code || null };
  };

  // Fail closed on anything we do not recognise, BEFORE looking at any date.
  if (!P.isProvider(s.provider)) return out(false, 'invalid', null);
  if (CONDITIONS.indexOf(s.condition) === -1) return out(false, 'invalid', null);
  if (s.product_code !== P.STANDARD) return out(false, 'invalid', null);

  /* Revocation outranks every timestamp on the row. A refunded purchase whose
     period_end is next month must not keep granting access for a month. */
  if (s.condition === 'revoked') return out(false, 'revoked', null);

  /* PAUSED. Checked before every date branch below, because a pause suspends
     access regardless of how much of the period is left -- that is the whole
     point of it. `until` is the resume date rather than null: the athlete has
     not lost the subscription, they have an access date in the future, and
     every surface that shows "until" should be able to say so.

     A pause that keeps the product working is a free month with extra steps.
     Billing and access stop together and come back together. */
  const pause = pausedNow(s, at);
  if (pause) return out(false, 'paused', pause.until);

  if (s.condition === 'trialing'){
    /* Trial end, falling back to the period end -- some providers express a
       trial as the first period rather than as a separate window.
       ABSENT falls back; MALFORMED does not. A trial_end of "not-a-date" is a
       corrupt row, and quietly reading the period end instead would let a bad
       value grant access through a column nobody was looking at. */
    const end = boundary(s.trial_end, s.current_period_end);
    if (!end.ok) return out(false, 'invalid', null);
    return end.date && end.date > at ? out(true, 'trial', end.date)
                                     : out(false, 'expired', end.date);
  }

  if (s.condition === 'active' || s.condition === 'cancelled'){
    /* CANCELLED IS NOT ENDED. Both branches are identical on purpose: what
       decides access is the period already paid for, and auto-renew decides
       only whether there will be another one. A cancelled subscription with a
       future current_period_end is ACTIVE entitlement.

       This also covers cancelling DURING a trial: the row keeps
       condition='trialing' until the trial ends (the provider does not move it
       to 'cancelled' merely because auto-renew was switched off), so the trial
       branch above runs and access continues to trial_end. When a provider
       does move it, current_period_end carries the same instant and this
       branch reaches the same answer. */
    const end = boundary(s.current_period_end, s.trial_end);
    if (!end.ok) return out(false, 'invalid', null);
    if (!(end.date && end.date > at)) return out(false, 'expired', end.date);
    /* A cancelled subscription still inside a trial reports 'trial', because
       that is what the athlete is in -- the reason describes the access, not
       the renewal intent. */
    const inTrial = future(s.trial_end, at);
    return out(true, inTrial ? 'trial' : 'paid', end.date);
  }

  if (s.condition === 'past_due'){
    /* THE PROVIDER'S GRACE, AND ONLY THE PROVIDER'S. If the provider has told
       us it is retrying until a date, we honour that date. If it has not, the
       answer is no access -- we do not invent a window, and we do not fall
       back to "well, the period end is next week". A missing grace_period_end
       on a past_due row is missing information, and missing information does
       not grant a product. */
    const grace = asDate(s.grace_period_end);
    if (grace && grace > at) return out(true, 'grace_period', grace);
    /* Still inside the period that was already paid for? That is not grace,
       it is the paid period, and it still counts. A card that fails on day 2
       of a paid month does not end the month. */
    const paid = asDate(s.current_period_end);
    if (paid && paid > at) return out(true, 'paid', paid);
    return out(false, 'payment_hold', grace || paid);
  }

  // expired
  return out(false, 'expired', asDate(s.current_period_end));
}

/* Is this subscription an ORDINARY ACTIVE COMMERCIAL subscription -- the kind
   that should stop the same athlete buying a second one somewhere else?
   Grace counts (they are still a customer, the provider is still retrying);
   expired and revoked do not.

   A PAUSE COUNTS TOO, and this is the one place it is not obvious. A paused
   subscription grants no access, so reading `active` alone would say "not
   blocking" -- and a paused athlete would be free to buy a second subscription
   while still holding the first, ending up with two the day the pause resumes.
   Pausing is not leaving. */
function isBlockingCommercial(sub, now){
  const a = subscriptionAccess(sub, now);
  return a.active === true || a.reason === 'paused';
}

// ===========================================================================
// GRANTS
// ===========================================================================

/* An administrative grant. Not a purchase, not a trial, not a discount.
   Returns the same shape a subscription does so resolution can fold over both
   without caring which it is looking at. */
function grantAccess(grant, now){
  const at = asDate(now) || new Date();
  const g = grant || {};
  const out = function(active, reason, until){
    return { kind: 'grant', commercial: false, active: active, reason: reason,
             until: until === null ? null : iso(until), provider: null,
             grantId: g.id || null, source: g.source || null,
             product: g.product_code || null };
  };

  if (GRANT_SOURCES.indexOf(g.source) === -1) return out(false, 'invalid', null);
  /* NOT 'invalid', AND NOT 'revoked'. The grant was real and nobody withdrew
     it; the programme it belonged to ended. Saying so keeps the row honest and
     keeps a support conversation accurate. */
  if (RETIRED_GRANT_SOURCES.indexOf(g.source) !== -1) return out(false, 'retired', null);
  if (g.product_code !== P.STANDARD) return out(false, 'invalid', null);
  if (g.revoked_at != null) return out(false, 'revoked', null);

  /* No expiry means indefinite -- which is what a beta grant is until somebody
     revokes it. `until: null` propagates through laterBound() as open-ended. */
  if (g.expires_at == null) return out(true, g.source, null);
  const end = asDate(g.expires_at);
  if (!end) return out(false, 'invalid', null);        // a malformed date is not an expiry
  return end > at ? out(true, g.source, end) : out(false, 'expired', end);
}

// ===========================================================================
// THE RESOLVER
// ===========================================================================

/* THE canonical access decision. Everything else in the product that wants to
   know whether an athlete may use Valhalla asks this and nothing else.
   Deliberately takes facts rather than an account id: the store fetches, this
   decides, and the two are separately testable.

   Resolution is a FOLD, not a priority list. Every source is evaluated
   independently and access is the union: if any source grants, access is
   granted. That is what makes "removing one grant must not revoke access when
   another is still valid" true by construction rather than by a rule somebody
   has to remember.

   The `reason` reported is the reason belonging to the source that reaches
   FURTHEST -- open-ended first, then the latest end date. That is the source
   the athlete would still be relying on tomorrow, so it is the one a screen
   should describe. */
function resolveStandardEntitlement(input){
  const o = input || {};
  const at = asDate(o.now) || new Date();
  const subs = Array.isArray(o.subscriptions) ? o.subscriptions : [];
  const grants = Array.isArray(o.grants) ? o.grants : [];

  const evaluated = subs.map(function(s){ return subscriptionAccess(s, at); })
    .concat(grants.map(function(g){ return grantAccess(g, at); }));
  const granting = evaluated.filter(function(e){ return e.active; });

  if (!granting.length){
    /* Why NOT, chosen from the most informative refusal present. 'revoked'
       first because it is the one an athlete will ring up about; then a
       payment hold, which they can fix; then plain expiry. */
    /* 'paused' ranks straight after 'revoked': it is something the athlete
       chose, it has an end date they can be shown, and reporting it as 'none'
       tells somebody who is mid-pause that they never had a subscription. */
    const rank = ['revoked', 'paused', 'payment_hold', 'expired', 'invalid'];
    let reason = 'none';
    rank.forEach(function(r){
      if (reason === 'none' && evaluated.some(function(e){ return e.reason === r; })) reason = r;
    });
    return {
      active: false,
      product: null,
      reason: reason,
      validUntil: null,
      commercialState: derivedCommercialState(subs, at),
      managementProvider: managementProviderFor(subs, at),
      sources: evaluated
    };
  }

  /* The furthest-reaching granting source. null (open-ended) beats every date. */
  let best = granting[0];
  granting.forEach(function(e){
    if (best.until === null) return;
    if (e.until === null){ best = e; return; }
    if (asDate(e.until) > asDate(best.until)) best = e;
  });

  const validUntil = granting.reduce(function(acc, e){
    return laterBound(acc, e.until);
  }, granting[0].until);

  return {
    active: true,
    product: P.STANDARD,
    reason: best.reason,
    validUntil: validUntil,
    commercialState: derivedCommercialState(subs, at),
    managementProvider: managementProviderFor(subs, at),
    sources: evaluated
  };
}

/* Where the athlete goes to change their billing. The provider of the
   currently granting commercial subscription, or null if none is granting --
   an athlete on a beta grant has nothing to manage, and pointing them at a
   provider's portal would be a dead end. */
function managementProviderFor(subs, now){
  const at = asDate(now) || new Date();
  const live = (subs || []).filter(function(s){ return isBlockingCommercial(s, at); });
  return live.length ? (live[0].provider || null) : null;
}

/* ---------- the derived product-facing state ----------
   AUTHORITY ORDERING, stated once and tested:

     1. A commercial subscription that is GRANTING ACCESS RIGHT NOW decides the
        state, and its own condition names it:
             trialing            -> 'trial'
             cancelled (in period)-> 'cancelled_active'
             active / past_due    -> 'paid'
        A trial that has been cancelled but is still running reports 'trial',
        not 'cancelled_active': what the athlete is in matters more than what
        will not happen next month.
     2. Otherwise, if the account has EVER had a commercial subscription ->
        'expired'.
     3. Otherwise -> 'none'.

   ADMINISTRATIVE GRANTS DO NOT APPEAR HERE. A beta tester's commercial state
   is 'none' -- they have bought nothing -- while their ENTITLEMENT is active.
   Those are different questions and this is exactly the pair that a single
   `user_status` column cannot represent without lying about one of them.

   This is DERIVED on every read and never stored. There is therefore no way
   for a stored status to drift out of agreement with the subscription rows,
   because there is no stored status. */
function derivedCommercialState(subs, now){
  const at = asDate(now) || new Date();
  const list = Array.isArray(subs) ? subs : [];
  if (!list.length) return 'none';

  const live = list.filter(function(s){ return isBlockingCommercial(s, at); });
  if (live.length){
    /* Most-generous-first among live rows so a stacked upgrade does not report
       the lesser of the two. */
    /* Paused first: it is the most specific true thing about the relationship,
       and every other branch below would report the state the athlete WOULD be
       in if they were not paused -- which is exactly the sentence that gets a
       paused athlete told they are "active". */
    if (live.some(function(s){ return subscriptionAccess(s, at).reason === 'paused'; })) return 'paused';
    if (live.some(function(s){ return subscriptionAccess(s, at).reason === 'trial'; })) return 'trial';
    if (live.some(function(s){ return s.condition === 'active' || s.condition === 'past_due'; })) return 'paid';
    if (live.some(function(s){ return s.condition === 'cancelled'; })) return 'cancelled_active';
    return 'paid';
  }

  /* Rows exist but none grants. If every one of them is unrecognisable this is
     not an expiry, it is corruption -- and 'none' is the safer story to tell
     than 'expired', which implies they once had something. */
  const realistic = list.some(function(s){ return subscriptionAccess(s, at).reason !== 'invalid'; });
  return realistic ? 'expired' : 'none';
}

// ===========================================================================
// TRIAL ELIGIBILITY
// ===========================================================================

/* ONE INTRODUCTORY TRIAL PER ATHLETE, ACROSS EVERY PROVIDER.
//
   The allowance belongs to the ACCOUNT, not to a provider's record of it. That
   is the entire point: Apple does not know about a trial taken on the web,
   Google does not know about either, and an athlete who could take one of each
   would get six weeks free by changing which button they press.
//
   So eligibility is a fact on account_commercial, and it is consumed exactly
   once by consumeTrial() below. Nothing here starts a trial and nothing here
   is called when an account is created.

   FAIL CLOSED ON A MISSING ACCOUNT ROW. No row means we cannot prove the trial
   is unused, and "cannot prove unused" must not read as "unused". */
function trialEligibility(account, now){
  const at = asDate(now) || new Date();
  if (!account) return { eligible: false, reason: 'unknown_account', consumedAt: null, consumedProvider: null };
  if (account.trial_consumed_at != null){
    const when = asDate(account.trial_consumed_at);
    return { eligible: false, reason: 'already_used',
             consumedAt: iso(when), consumedProvider: account.trial_consumed_provider || null };
  }
  /* An explicit block, for the abuse case, kept separate from ordinary
     consumption so the two are distinguishable in support. */
  if (account.trial_blocked_at != null) return { eligible: false, reason: 'blocked', consumedAt: null, consumedProvider: null };
  return { eligible: true, reason: 'eligible', consumedAt: null, consumedProvider: null, trialDays: P.TRIAL_DAYS, at: iso(at) };
}

/* The patch that consumes the allowance, and the guard that makes consuming it
   twice a no-op. Returns { consume:false } when the allowance is already gone,
   so a redelivered activation is idempotent by inspection before it ever
   reaches the datastore -- and the datastore has a conditional write on top of
   that, because two requests can both read "eligible" before either writes. */
function consumeTrial(account, opts){
  const o = opts || {};
  const el = trialEligibility(account, o.now);
  if (!el.eligible){
    return { consume: false, reason: el.reason,
             /* Already consumed by THIS activation is success, not a clash. */
             idempotent: el.reason === 'already_used' &&
                         !!o.subscriptionId && account &&
                         account.trial_consumed_subscription_id === o.subscriptionId };
  }
  if (!P.isProvider(o.provider)) return { consume: false, reason: 'unknown_provider', idempotent: false };
  const at = asDate(o.now) || new Date();
  return {
    consume: true, reason: 'consumed', idempotent: false,
    patch: {
      trial_consumed_at: iso(at),
      trial_consumed_provider: o.provider,
      trial_consumed_subscription_id: o.subscriptionId || null,
      updated_at: iso(at)
    },
    trialEnd: iso(new Date(at.getTime() + P.TRIAL_DAYS * DAY_MS))
  };
}

// ===========================================================================
// DUPLICATE PURCHASE
// ===========================================================================

/* MAY THIS ATHLETE BEGIN ANOTHER STANDARD PURCHASE?
//
   The one canonical answer for every future checkout -- web, StoreKit, Play
   Billing. All three ask this before they open a purchase flow, so the rule
   lives on the server once instead of three times in three clients that can
   drift apart.

   The failure this prevents is concrete and expensive: an athlete subscribes
   on the web, later installs the iOS app, does not recognise that they are
   already a subscriber, and buys again through the App Store. Now they are
   paying twice, only one of the two is cancellable from where they are
   looking, and the refund goes through a provider we do not control.

   WHAT BLOCKS:  any commercial subscription currently granting access, on ANY
                 provider, including one in a provider grace period -- they are
                 still a customer and the card is still being retried.
   WHAT DOES NOT: an expired subscription (that is a legitimate reactivation
                 and must not be blocked forever), a revoked one, and an
                 administrative grant. A beta tester buying a subscription is
                 the whole point of the beta.

   `allowExceptional` exists for provider migration -- moving a web subscriber
   to Apple deliberately overlaps for a moment. The workflow that would use it
   is NOT built here; the parameter exists so the future one has a documented
   door rather than a reason to weaken the rule. */
function mayStartStandardPurchase(input){
  const o = input || {};
  const at = asDate(o.now) || new Date();
  const subs = Array.isArray(o.subscriptions) ? o.subscriptions : [];

  if (!P.isProvider(o.provider)){
    return { allowed: false, reason: 'unknown_provider', existingProvider: null, trial: null };
  }
  if (o.offerCode != null && !P.isOffer(o.offerCode)){
    return { allowed: false, reason: 'unknown_offer', existingProvider: null, trial: null };
  }

  const blocking = subs.filter(function(s){ return isBlockingCommercial(s, at); });
  const trial = trialEligibility(o.account, at);

  if (blocking.length && !o.allowExceptional){
    const other = blocking[0];
    return {
      allowed: false,
      /* Named separately so a client can say the right sentence: "you already
         subscribe here, manage it in Settings" is a different screen from
         "you subscribe through the App Store, manage it there". */
      reason: other.provider === o.provider ? 'already_subscribed_here'
                                            : 'already_subscribed_elsewhere',
      existingProvider: other.provider || null,
      existingSubscriptionId: other.id || null,
      trial: trial
    };
  }

  return {
    allowed: true,
    reason: blocking.length ? 'exceptional_override' : 'ok',
    existingProvider: blocking.length ? (blocking[0].provider || null) : null,
    /* The caller needs both answers in one round trip: whether they may buy,
       and whether the purchase may include the introductory trial. Splitting
       them into two calls is how a client ends up offering a second free
       fortnight. */
    trial: trial
  };
}

// ===========================================================================
// BRIDGE TO THE LIVE DELIVERY GATE
// ===========================================================================

/* The existing account gate (_access.js) reads one denormalised `entitlements`
   row and is already deployed, already covered and already the single place
   the runtime is handed over. This phase does NOT re-point it at the resolver
   -- swapping the enforcement path and introducing the model it enforces in
   one change is how a beta cohort gets locked out on a Tuesday.
//
   Instead the resolution is PROJECTED onto that row's shape, so the gate keeps
   working unchanged while subscriptions and grants become the source of truth
   behind it. The projection is lossy on purpose: the gate needs an answer and
   a date, not a source list.
//
   Phase 2 replaces this with a direct call. Until then the invariant is that
   `entitlements` is a CACHE of this function's output and never an input to
   it. */
function projectToEntitlementRow(resolution, current){
  const cur = current || {};
  const r = resolution || {};
  const commercial = (r.sources || []).filter(function(s){ return s.commercial && s.active; });
  const grants = (r.sources || []).filter(function(s){ return !s.commercial && s.active; });

  /* `state` describes the COMMERCIAL relationship, so it is read from the
     commercial source that reaches furthest -- not from r.reason.
//
     The two are the same thing whenever an athlete has only subscriptions,
     which is why this read r.reason for so long without anybody noticing. They
     come apart for a BETA TESTER WHO ALSO SUBSCRIBES: the grant is open-ended,
     open-ended reaches furthest, so r.reason is 'admin_beta' and the trial
     underneath it was projected as state='active'. Their screen then said
     "Active until…" during a fortnight that was a trial. Nobody lost access
     over it, but it is the projection describing the wrong source, and the one
     cohort it describes wrongly is the one the commercial launch must be most
     careful with. */
  let state = 'expired';
  if (r.active && commercial.length){
    const lead = commercial.reduce(function(acc, s){
      return laterBound(acc.until, s.until) === s.until && acc.until !== s.until ? s : acc;
    }, commercial[0]);
    if (lead.reason === 'trial') state = 'trial';
    else if (lead.reason === 'grace_period') state = 'grace';
    else state = 'active';
  }
  /* An athlete whose ONLY source is an administrative grant has no commercial
     state at all. state stays 'expired' and the override column carries the
     access -- which is exactly how _access.js already treats a tester, and why
     a beta grant does not have to masquerade as a subscription to work. */

  const beta = grants.filter(function(g){ return g.source === 'admin_beta'; })[0];
  const comp = grants.filter(function(g){ return g.source === 'admin_comp'; })[0];
  const override = beta ? 'beta' : (comp ? 'promo' : null);
  const overrideSrc = beta || comp || null;

  return {
    state: state,
    tier: 'standard',
    /* The commercial window only. An override's own expiry lives in
       override_expires_at, and mixing them would make a beta grant look like
       paid access with a date. */
    access_until: commercial.length
      ? commercial.reduce(function(acc, s){ return laterBound(acc, s.until); }, commercial[0].until)
      : null,
    cancel_at_period_end: !!(r.commercialState === 'cancelled_active'),
    override: override,
    override_expires_at: overrideSrc ? overrideSrc.until : null,
    override_note: cur.override_note == null ? null : cur.override_note,
    provider: commercial.length ? (commercial[0].provider || null) : (cur.provider || null),
    provider_customer_id: cur.provider_customer_id == null ? null : cur.provider_customer_id,
    provider_sub_id: cur.provider_sub_id == null ? null : cur.provider_sub_id
  };
}

/* ---------- what a client may be told ----------
   The structured answer Phase 2's checkout, the account screen and the future
   native clients consume. Deliberately carries no provider customer id, no
   provider subscription id, no event sequence and no raw provider payload:
   those identify the athlete to a third party and belong nowhere near a
   response body. */
function publicEntitlement(resolution){
  const r = resolution || {};
  return {
    active: !!r.active,
    product: r.product || null,
    reason: r.reason || 'none',
    valid_until: r.validUntil || null,
    commercial_state: r.commercialState || 'none',
    management_provider: r.managementProvider || null
  };
}

module.exports = {
  CONDITIONS, GRANT_SOURCES, RETIRED_GRANT_SOURCES, REASONS, COMMERCIAL_STATES, DAY_MS,
  asDate, iso, laterBound, boundary,
  subscriptionAccess, isBlockingCommercial, grantAccess,
  resolveStandardEntitlement, managementProviderFor, derivedCommercialState,
  pausedNow,
  trialEligibility, consumeTrial, mayStartStandardPurchase,
  projectToEntitlementRow, publicEntitlement
};
