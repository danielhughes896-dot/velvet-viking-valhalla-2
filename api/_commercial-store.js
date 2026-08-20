// Velvet Viking -- the commercial core's storage layer.
//
// _entitlement.js decides. This file fetches the facts it decides over and
// writes the ones a verified provider event establishes. The split is the
// point: every judgement in the product is made by a pure function that a test
// can drive to a boundary, and everything here is plumbing around it.
//
// EVERY CALL USES THE SERVICE KEY. These tables deny the browser outright --
// read-own at most, never write -- and this process is the only writer. An
// athlete cannot grant themselves a subscription, reset their trial or issue
// themselves a comp, because there is no policy under which their token may
// write the rows at all. See supabase-commercial-core.sql.
//
// RACE SAFETY, AND ITS HONEST LIMITS. PostgREST gives conditional writes and
// unique constraints, not transactions across statements. So the two places
// where a race actually costs money are protected by the DATABASE rather than
// by a read-then-write in JavaScript:
//
//   the trial allowance   consumed by an UPDATE whose filter requires
//                         trial_consumed_at IS NULL. Two simultaneous
//                         activations both read "eligible"; exactly one UPDATE
//                         matches a row, and the other gets zero rows back and
//                         is told the allowance is gone.
//   provider events       claimed by an INSERT against a unique
//                         (provider, provider_event_id). The second delivery
//                         collides and is reported as a duplicate rather than
//                         applied twice.
//
// Anywhere those two are not enough -- an upsert racing a revocation, say --
// the comments say so rather than implying a guarantee the datastore does not
// give.

'use strict';

const E = require('./_entitlement.js');
const P = require('./_products.js');

function log(what){ try{ console.log('commercial: ' + what); }catch(e){} }

/* PostgREST returns the affected rows when asked; asking is how we learn
   whether a conditional write matched anything. */
const RETURN_REP = 'return=representation';

function q(v){ return encodeURIComponent(String(v == null ? '' : v)); }

async function rows(r){
  if (!r || !r.ok) return null;
  const b = await r.json().catch(function(){ return null; });
  return Array.isArray(b) ? b : (b ? [b] : []);
}

// ===========================================================================
// READING
// ===========================================================================

/* Everything the resolver needs, in three reads. Not a view and not a join:
   the three tables have different write paths and different owners, and a view
   would make it easy to start treating the combination as a stored fact.

   `ok:false` on any read failure, and the caller must treat that as NO ACCESS
   rather than as an empty result. An unreachable database is not an athlete
   with no subscription. */
async function readCommercialFacts(S, cfg, accountId){
  if (!accountId) return { ok: false, reason: 'no_account_id' };

  const [aR, sR, gR] = await Promise.all([
    S.sb(cfg, '/account_commercial?select=*&account_id=eq.' + q(accountId) + '&limit=1'),
    S.sb(cfg, '/subscriptions?select=*&account_id=eq.' + q(accountId) +
              '&order=provider_updated_at.desc.nullslast&limit=100'),
    S.sb(cfg, '/entitlement_grants?select=*&account_id=eq.' + q(accountId) +
              '&revoked_at=is.null&limit=100')
  ]);

  if (!aR.ok || !sR.ok || !gR.ok){
    log('FACTS_READ_FAILED a=' + aR.status + ' s=' + sR.status + ' g=' + gR.status);
    return { ok: false, reason: 'read_failed' };
  }
  const account = (await rows(aR) || [])[0] || null;
  return {
    ok: true,
    account: account,
    subscriptions: (await rows(sR)) || [],
    grants: (await rows(gR)) || []
  };
}

/* THE canonical server-side access decision for one athlete.
   resolveStandardEntitlement(accountId), in this architecture's shape.

   On a read failure it returns an INACTIVE resolution with reason 'invalid'
   rather than throwing, so every caller has one answer type and no caller can
   forget a try/catch and accidentally admit somebody. */
async function resolveStandardEntitlement(S, cfg, accountId, now){
  const facts = await readCommercialFacts(S, cfg, accountId);
  if (!facts.ok){
    return { ok: false, active: false, product: null, reason: 'invalid',
             validUntil: null, commercialState: 'none', managementProvider: null,
             sources: [], readError: facts.reason };
  }
  const res = E.resolveStandardEntitlement({
    account: facts.account,
    subscriptions: facts.subscriptions,
    grants: facts.grants,
    now: now || new Date()
  });
  return Object.assign({ ok: true, facts: facts }, res);
}

// ===========================================================================
// ACCOUNT COMMERCIAL STATE
// ===========================================================================

/* Make sure the athlete has a commercial row, WITHOUT giving them anything.
   No trial timestamps, no entitlement, no grant -- the row exists so that
   "have they used their introductory trial" has somewhere to be answered, and
   its answer starts as "no, and they have not started one either".

   Idempotent: a second call collides on the primary key and is ignored. */
async function ensureAccountCommercial(S, cfg, accountId){
  if (!accountId) return { ok: false, reason: 'no_account_id' };
  const r = await S.sb(cfg, '/account_commercial', {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId }),
    prefer: 'resolution=ignore-duplicates,return=minimal'
  });
  // 409 means the row is already there, which is the whole point of "ensure".
  if (r.status === 409) return { ok: true, reason: 'already_present' };
  return { ok: r.ok, reason: r.ok ? 'ensured' : ('status_' + r.status) };
}

/* CONSUME THE ONE INTRODUCTORY TRIAL.
//
   Called by a future verified purchase activation and by nothing else. Never
   by account creation, never by a migration, never by a client.
//
   Two guards, and both are needed:
     1. the pure decision in E.consumeTrial(), which refuses when the account
        row already records a consumption -- this is what makes a REPLAYED
        activation cheap and obviously correct;
     2. `trial_consumed_at=is.null` in the UPDATE filter, which is what makes
        two SIMULTANEOUS activations safe. The first matches the row; the
        second matches nothing and is told so by an empty representation.
//
   Returns { ok, consumed, idempotent, reason, trialEnd }. `consumed:false`
   with `idempotent:true` means this same subscription already consumed it --
   a success for the caller, not a clash. */
async function consumeTrialForAccount(S, cfg, accountId, opts){
  const o = opts || {};
  const facts = await readCommercialFacts(S, cfg, accountId);
  if (!facts.ok) return { ok: false, consumed: false, idempotent: false, reason: 'read_failed' };

  const decision = E.consumeTrial(facts.account, {
    provider: o.provider, subscriptionId: o.subscriptionId, now: o.now
  });
  if (!decision.consume){
    return { ok: true, consumed: false, idempotent: !!decision.idempotent, reason: decision.reason };
  }

  const r = await S.sb(cfg,
    '/account_commercial?account_id=eq.' + q(accountId) + '&trial_consumed_at=is.null', {
      method: 'PATCH',
      body: JSON.stringify(decision.patch),
      prefer: RETURN_REP
    });
  if (!r.ok) return { ok: false, consumed: false, idempotent: false, reason: 'write_failed' };

  const updated = (await rows(r)) || [];
  if (!updated.length){
    /* Lost the race. Somebody else consumed the allowance between our read and
       our write. Not an error -- the correct outcome is "the trial is gone",
       which is what the athlete's account now says. */
    log('TRIAL_RACE_LOST account=' + String(accountId).slice(0, 8));
    return { ok: true, consumed: false, idempotent: false, reason: 'already_used' };
  }
  log('TRIAL_CONSUMED provider=' + o.provider);
  return { ok: true, consumed: true, idempotent: false, reason: 'consumed', trialEnd: decision.trialEnd };
}

// ===========================================================================
// SUBSCRIPTIONS
// ===========================================================================

/* Columns a provider adapter owns. Anything not in this list is ours and is
   never written from a provider payload -- which is what stops a webhook body
   from setting, say, account_id and re-pointing a purchase at another athlete. */
const SUBSCRIPTION_COLUMNS = [
  'provider', 'provider_subscription_id', 'provider_customer_id',
  'product_code', 'offer_code', 'billing_period', 'provider_product_id',
  'trial_start', 'trial_end', 'current_period_start', 'current_period_end',
  'auto_renew', 'cancel_at_period_end', 'cancelled_at', 'grace_period_end',
  'condition', 'environment', 'provider_updated_at'
];

/* Mirror a provider's subscription into our shape. VALIDATED, not trusted:
   an unknown provider, condition, product or environment is refused outright
   rather than stored and puzzled over later by the resolver.

   Upsert keys on (provider, provider_subscription_id), which is the provider's
   own identity for the purchase and the only thing guaranteed stable across
   redeliveries. */
function normaliseSubscription(input){
  const s = input || {};
  if (!P.isProvider(s.provider)) return { ok: false, reason: 'unknown_provider' };
  if (!s.provider_subscription_id) return { ok: false, reason: 'no_provider_subscription_id' };
  if (!s.account_id) return { ok: false, reason: 'no_account_id' };
  if (E.CONDITIONS.indexOf(s.condition) === -1) return { ok: false, reason: 'unknown_condition' };
  if (s.product_code !== P.STANDARD) return { ok: false, reason: 'unknown_product' };
  if (s.offer_code != null && !P.isOffer(s.offer_code)) return { ok: false, reason: 'unknown_offer' };
  if (s.billing_period != null && P.BILLING_PERIODS.indexOf(s.billing_period) === -1)
    return { ok: false, reason: 'unknown_billing_period' };
  const environment = s.environment == null ? 'production' : s.environment;
  if (!P.isEnvironment(environment)) return { ok: false, reason: 'unknown_environment' };

  /* Every timestamp is parsed here, once. A string that is not an instant is
     rejected at the boundary instead of becoming a row the resolver has to
     defend itself against. */
  const row = { account_id: s.account_id, environment: environment };
  const stamps = ['trial_start', 'trial_end', 'current_period_start',
                  'current_period_end', 'cancelled_at', 'grace_period_end',
                  'provider_updated_at'];
  for (let i = 0; i < stamps.length; i++){
    const k = stamps[i];
    if (s[k] == null){ row[k] = null; continue; }
    const d = E.asDate(s[k]);
    if (!d) return { ok: false, reason: 'malformed_date_' + k };
    row[k] = d.toISOString();
  }
  SUBSCRIPTION_COLUMNS.forEach(function(k){
    if (row[k] !== undefined) return;
    row[k] = s[k] === undefined ? null : s[k];
  });
  row.auto_renew = !!s.auto_renew;
  row.cancel_at_period_end = !!s.cancel_at_period_end;
  return { ok: true, row: row };
}

async function upsertSubscription(S, cfg, input){
  const n = normaliseSubscription(input);
  if (!n.ok) return { ok: false, reason: n.reason };
  const r = await S.sb(cfg, '/subscriptions?on_conflict=provider,provider_subscription_id', {
    method: 'POST',
    body: JSON.stringify(n.row),
    prefer: 'resolution=merge-duplicates,' + RETURN_REP
  });
  if (!r.ok) return { ok: false, reason: 'write_failed_' + r.status };
  const out = (await rows(r)) || [];
  return { ok: true, subscription: out[0] || null };
}

// ===========================================================================
// ADMINISTRATIVE GRANTS
// ===========================================================================

/* Issue a beta or comp entitlement. Requires an already-authorised caller --
   this function does no authorisation of its own and must only be reached
   through the existing owner boundary (VVV_OWNER_USER_ID plus a token verified
   against Supabase), the same one admin-user.js and strava-admin.js use. There
   is deliberately no second notion of "admin" in this codebase.

   DOES NOT TOUCH THE TRIAL. A tester who later subscribes still gets their
   fourteen days; being useful to us is not a discount we claw back.

   Idempotent through a partial unique index on (account_id, source) where
   revoked_at is null: an account cannot hold two live grants of the same kind,
   so re-running a migration adds nothing. */
async function grantEntitlement(S, cfg, input){
  const g = input || {};
  if (!g.account_id) return { ok: false, reason: 'no_account_id' };
  if (E.GRANT_SOURCES.indexOf(g.source) === -1) return { ok: false, reason: 'unknown_source' };
  let expires = null;
  if (g.expires_at != null){
    const d = E.asDate(g.expires_at);
    if (!d) return { ok: false, reason: 'malformed_expires_at' };
    expires = d.toISOString();
  }
  const r = await S.sb(cfg, '/entitlement_grants', {
    method: 'POST',
    body: JSON.stringify({
      account_id: g.account_id,
      source: g.source,
      product_code: P.STANDARD,
      granted_by: g.granted_by || null,
      expires_at: expires,
      note: g.note || null
    }),
    prefer: 'resolution=ignore-duplicates,' + RETURN_REP
  });

  /* TWO SHAPES OF THE SAME IDEMPOTENT OUTCOME, and both have to be handled.
     PostgREST turns `resolution=ignore-duplicates` into ON CONFLICT DO NOTHING
     against the PRIMARY KEY -- which here is a generated `id` and therefore
     never collides. The constraint that actually stops a second live grant is
     the PARTIAL unique index on (account_id, source) where revoked_at is null,
     and a collision on that surfaces as a 23505 from Postgres, i.e. a 409.
     Treating that as a failure would make a rerun of the beta migration look
     broken; it is precisely the outcome the index exists to produce. */
  if (r.status === 409)
    return { ok: true, granted: false, grant: null, reason: 'already_granted' };
  if (!r.ok) return { ok: false, reason: 'write_failed_' + r.status };
  const out = (await rows(r)) || [];
  return { ok: true, granted: out.length > 0, grant: out[0] || null,
           reason: out.length ? 'granted' : 'already_granted' };
}

/* Revocation is a timestamp, never a delete: an audit trail that can be
   deleted is not one. Revoking one source says nothing about any other -- the
   resolver folds over what remains, so an athlete with a beta grant AND a paid
   subscription keeps access when the grant goes. */
async function revokeGrant(S, cfg, input){
  const g = input || {};
  if (!g.account_id || E.GRANT_SOURCES.indexOf(g.source) === -1)
    return { ok: false, reason: 'bad_request' };
  const r = await S.sb(cfg, '/entitlement_grants?account_id=eq.' + q(g.account_id) +
    '&source=eq.' + q(g.source) + '&revoked_at=is.null', {
      method: 'PATCH',
      body: JSON.stringify({ revoked_at: new Date().toISOString(),
                             revoked_by: g.revoked_by || null }),
      prefer: RETURN_REP
    });
  if (!r.ok) return { ok: false, reason: 'write_failed_' + r.status };
  const out = (await rows(r)) || [];
  return { ok: true, revoked: out.length, reason: out.length ? 'revoked' : 'nothing_to_revoke' };
}

// ===========================================================================
// PROVIDER EVENT IDEMPOTENCY
// ===========================================================================

/* CLAIM AN EVENT BEFORE ACTING ON IT.
//
   Every provider redelivers. A web billing webhook retries until it gets a
   2xx; an Apple server notification arrives again because the first response
   was slow; a Google RTDN is redelivered because the Pub/Sub ack was lost.
   Applying the same event twice is how one payment becomes two months of
   access, or one refund becomes two revocations.
//
   The claim is an INSERT against a UNIQUE (provider, provider_event_id). The
   database decides who won, because the database is the only participant that
   sees both requests. A collision returns { claimed:false, duplicate:true },
   and the correct response to the provider is 200 -- an endpoint that answers
   500 to a duplicate receives that duplicate forever.
//
   NOTE ON VERIFICATION. Claiming an event says nothing about whether it is
   AUTHENTIC. Signature verification belongs to each provider's adapter and is
   not built here; nothing in this file should ever be reached by an unverified
   payload. */
async function claimBillingEvent(S, cfg, input){
  const ev = input || {};
  if (!P.isProvider(ev.provider)) return { ok: false, claimed: false, duplicate: false, reason: 'unknown_provider' };
  if (!ev.provider_event_id) return { ok: false, claimed: false, duplicate: false, reason: 'no_event_id' };
  const environment = ev.environment == null ? 'production' : ev.environment;
  if (!P.isEnvironment(environment)) return { ok: false, claimed: false, duplicate: false, reason: 'unknown_environment' };

  const r = await S.sb(cfg, '/billing_events', {
    method: 'POST',
    body: JSON.stringify({
      provider: ev.provider,
      provider_event_id: String(ev.provider_event_id),
      event_type: ev.event_type || null,
      account_id: ev.account_id || null,
      subscription_id: ev.subscription_id || null,
      environment: environment,
      result: 'claimed'
    }),
    prefer: RETURN_REP
  });

  /* 409 is the unique violation -- the event is already claimed. Treated as a
     first-class outcome rather than an error. */
  if (r.status === 409) return { ok: true, claimed: false, duplicate: true, reason: 'duplicate' };
  if (!r.ok) return { ok: false, claimed: false, duplicate: false, reason: 'write_failed_' + r.status };
  const out = (await rows(r)) || [];
  return { ok: true, claimed: true, duplicate: false, event: out[0] || null, reason: 'claimed' };
}

/* Close the loop so an operator can tell an event that was received from one
   that was acted upon. `result` is a short outcome word, never a provider
   payload -- see the logging note in supabase-commercial-core.sql. */
async function markBillingEventProcessed(S, cfg, input){
  const ev = input || {};
  if (!P.isProvider(ev.provider) || !ev.provider_event_id)
    return { ok: false, reason: 'bad_request' };
  const patch = { processed_at: new Date().toISOString(), result: ev.result || 'processed' };
  if (ev.subscription_id) patch.subscription_id = ev.subscription_id;
  if (ev.account_id) patch.account_id = ev.account_id;
  const r = await S.sb(cfg, '/billing_events?provider=eq.' + q(ev.provider) +
    '&provider_event_id=eq.' + q(ev.provider_event_id), {
      method: 'PATCH', body: JSON.stringify(patch), prefer: 'return=minimal'
    });
  return { ok: r.ok, reason: r.ok ? 'marked' : ('status_' + r.status) };
}

// ===========================================================================
// DUPLICATE PURCHASE
// ===========================================================================

/* The one server-side answer every future checkout asks before opening a
   purchase flow. Web, StoreKit and Play Billing all call this; none of them
   re-implements the rule.

   FAILS CLOSED on a read failure: if we cannot see whether the athlete already
   subscribes somewhere, we do not let them buy again. A blocked purchase is an
   inconvenience; a double subscription through two providers is a refund we
   cannot process ourselves. */
async function mayStartStandardPurchase(S, cfg, accountId, opts){
  const o = opts || {};
  const facts = await readCommercialFacts(S, cfg, accountId);
  if (!facts.ok){
    return { allowed: false, reason: 'unavailable', existingProvider: null, trial: null };
  }
  return E.mayStartStandardPurchase({
    account: facts.account,
    subscriptions: facts.subscriptions,
    provider: o.provider,
    offerCode: o.offerCode,
    allowExceptional: !!o.allowExceptional,
    now: o.now || new Date()
  });
}

// ===========================================================================
// PROJECTION ONTO THE LIVE DELIVERY GATE
// ===========================================================================

/* Keep the deployed `entitlements` row in agreement with the resolver.
//
   The gate in _access.js reads that row and is the single place the runtime is
   handed over; this phase does not move it, it feeds it. Subscriptions and
   grants are the source of truth, `entitlements` is their projection, and the
   arrow only ever points one way -- nothing in this file ever reads the
   entitlements row to decide anything.
//
   `override_note` is preserved rather than rewritten: it is an operator's
   sentence about a human being, and no automated projection should overwrite
   one. */
async function syncEntitlementRow(S, cfg, accountId, now){
  const res = await resolveStandardEntitlement(S, cfg, accountId, now);
  if (!res.ok) return { ok: false, reason: res.readError || 'resolve_failed' };

  const cur = await S.sb(cfg, '/entitlements?select=*&user_id=eq.' + q(accountId) + '&limit=1');
  const currentRow = cur.ok ? ((await rows(cur)) || [])[0] || null : null;

  const patch = E.projectToEntitlementRow(res, currentRow);
  patch.updated_at = new Date().toISOString();

  const body = Object.assign({ user_id: accountId }, patch);
  const r = await S.sb(cfg, '/entitlements?on_conflict=user_id', {
    method: 'POST',
    body: JSON.stringify(body),
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
  if (!r.ok) return { ok: false, reason: 'write_failed_' + r.status };
  return { ok: true, resolution: res, projected: patch };
}

module.exports = {
  SUBSCRIPTION_COLUMNS,
  readCommercialFacts, resolveStandardEntitlement,
  ensureAccountCommercial, consumeTrialForAccount,
  normaliseSubscription, upsertSubscription,
  grantEntitlement, revokeGrant,
  claimBillingEvent, markBillingEventProcessed,
  mayStartStandardPurchase, syncEntitlementRow
};
