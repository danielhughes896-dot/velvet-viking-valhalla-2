// Velvet Viking -- the purchases ledger and its reads.
//
// WHY A LEDGER EXISTS AT ALL. The entitlements table answers one question --
// may this athlete use Valhalla -- and answers it with one row per athlete.
// That is the right shape for the question and the wrong shape for evidence:
// it cannot express "this athlete bought on the web in March, lapsed, and
// bought again through Apple in June", and it cannot say why access changed at
// 04:12 on a Tuesday.
//
// So purchases are recorded separately, one row per provider subscription, and
// billing events are recorded separately again. The entitlement stays the
// single answer; the ledger is the audit trail underneath it.
//
// PROVIDER-NEUTRAL BY CONSTRUCTION. `provider` is a plain string with a check
// constraint of stripe|apple|google. Nothing in this file is Stripe-shaped:
// Apple's originalTransactionId and Play's purchase token lineage both land in
// provider_sub_id, and the uniqueness constraint that stops one subscription
// being attached to two accounts works identically for all three.

'use strict';

const S = require('./_strava.js');

function log(what){ try{ console.log('ledger: ' + what); }catch(e){} }

/* ---------- reads ---------- */

async function entitlementOf(cfg, uid){
  if (!uid) return null;
  const r = await S.sb(cfg, '/entitlements?user_id=eq.' + encodeURIComponent(uid) + '&select=*&limit=1');
  if (!r || !r.ok) return null;
  const rows = await r.json().catch(function(){ return null; });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/* The provider customer id we already hold for this athlete, so a returning
   athlete is never given a second customer record. Read from the entitlement
   row where the existing schema already carries it. */
async function customerIdOf(cfg, uid){
  const ent = await entitlementOf(cfg, uid);
  return (ent && ent.provider_customer_id) || null;
}

async function rememberCustomer(cfg, uid, customerId){
  if (!uid || !customerId) return { ok: false, code: 'missing_args' };
  const r = await S.sb(cfg, '/entitlements?on_conflict=user_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: JSON.stringify([{ user_id: uid, provider: 'stripe', provider_customer_id: customerId }])
  });
  return { ok: !!(r && r.ok), code: r && r.ok ? null : 'customer_persist_failed' };
}

/* ---------- idempotency ----------
   The question a webhook must answer before it does anything: have I already
   applied this exact provider event? Answered by a UNIQUE constraint rather
   than by a read-then-write, because two concurrent deliveries of the same
   event would both pass a read and both write. */
async function claimEvent(cfg, ev){
  const row = {
    provider: ev.provider,
    provider_event_id: ev.provider_event_id,
    event_type: ev.type || null,
    user_id: ev.user_id || null,
    provider_sub_id: ev.sub_id || null,
    provider_customer_id: ev.customer_id || null,
    occurred_at: ev.occurred_at || null,
    note: ev.note || null
  };
  const r = await S.sb(cfg, '/billing_events', {
    method: 'POST',
    prefer: 'return=representation',
    body: JSON.stringify([row])
  });
  /* A duplicate violates the unique index and comes back 409. That is not an
     error condition -- it is the answer "already seen", and it must not be a
     5xx, because a provider reads 5xx as "retry" and would send it again. */
  if (r && r.status === 409) return { ok: true, duplicate: true };
  if (!r || !r.ok) return { ok: false, code: 'event_claim_failed', status: r && r.status };
  const rows = await r.json().catch(function(){ return null; });
  return { ok: true, duplicate: false, id: Array.isArray(rows) && rows.length ? rows[0].id : null };
}

async function recordConsequence(cfg, eventRowId, consequence){
  if (!eventRowId) return { ok: true, skipped: true };
  const r = await S.sb(cfg, '/billing_events?id=eq.' + encodeURIComponent(eventRowId), {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: JSON.stringify({
      applied: !!consequence.applied,
      resulting_state: consequence.state || null,
      resulting_access_until: consequence.access_until || null
    })
  });
  return { ok: !!(r && r.ok) };
}

/* ---------- purchases ----------
   Upserted on (provider, provider_sub_id). The unique constraint on that pair
   is what prevents one store subscription being attached to two Valhalla
   accounts -- the commonest real abuse and the commonest honest accident. */
async function upsertPurchase(cfg, p){
  if (!p.provider || !p.provider_sub_id) return { ok: true, skipped: true };
  const row = {
    user_id: p.user_id,
    provider: p.provider,
    provider_sub_id: p.provider_sub_id,
    provider_customer_id: p.provider_customer_id || null,
    billing_period: p.billing_period || null,
    tier: p.tier || 'standard',
    status: p.status || null,
    current_period_end: p.current_period_end || null,
    cancel_at_period_end: !!p.cancel_at_period_end,
    trial_end: p.trial_end || null,
    updated_at: new Date().toISOString()
  };
  const r = await S.sb(cfg, '/purchases?on_conflict=provider,provider_sub_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: JSON.stringify([row])
  });
  return { ok: !!(r && r.ok), code: r && r.ok ? null : 'purchase_upsert_failed' };
}

/* Is this provider subscription already attached to a DIFFERENT athlete?
   Checked before linking, because moving one silently would be an
   account-takeover primitive rather than a convenience. */
async function purchaseOwner(cfg, provider, subId){
  if (!provider || !subId) return null;
  const q = '/purchases?provider=eq.' + encodeURIComponent(provider) +
            '&provider_sub_id=eq.' + encodeURIComponent(subId) + '&select=user_id&limit=1';
  const r = await S.sb(cfg, q);
  if (!r || !r.ok) return null;
  const rows = await r.json().catch(function(){ return null; });
  return Array.isArray(rows) && rows.length ? rows[0].user_id : null;
}

module.exports = {
  entitlementOf, customerIdOf, rememberCustomer,
  claimEvent, recordConsequence, upsertPurchase, purchaseOwner
};
