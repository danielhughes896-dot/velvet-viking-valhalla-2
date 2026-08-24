// Velvet Viking -- the session bridge.
//
// The problem this solves: a browser fetching a DOCUMENT cannot send an
// Authorization header, so the Supabase access token sitting in localStorage
// -- which every other VVV endpoint authenticates with perfectly well -- is
// useless for protecting delivery of the runtime itself. Something the browser
// attaches automatically is required, and that means a cookie.
//
//   POST   /api/session   Authorization: Bearer <supabase access token>
//                         -> verifies the token against Supabase (the same
//                            verifyUser() every admin/Strava route uses)
//                         -> resolves entitlement server-side
//                         -> mints an access_leases row
//                         -> Set-Cookie: vvv_gate=<opaque id>
//                         -> returns UI metadata that is NOT authoritative
//
//   DELETE /api/session   revokes the lease and clears the cookie
//
// A dedicated cookie rather than Supabase's own cookie mechanisms, and the
// reason is not preference: this app does not use the Supabase SDK's storage
// model at all -- sessions live in localStorage and the native path returns
// through a custom URL scheme. Adopting SSR cookies would mean rewriting the
// whole auth layer, which is currently green and carries the Phase 1 recovery
// guarantees. A small purpose-built credential is the smaller change and the
// smaller risk.

const S = require('./_strava.js');     // canonical Supabase access layer
const A = require('./_access.js');
const Agree = require('./_agreements.js');   // the canonical documents and versions

function log(what){ try{ console.log('session: ' + what); }catch(e){} }

/* The readable half of the answer. Everything here is for RENDERING -- what to
   put on the account card, whether to show a beta badge -- and none of it is
   trusted on the way back in. The client cannot promote itself by editing this
   object, because /api/app re-resolves the same decision server-side from the
   cookie before it hands over a single byte of the runtime. */
function uiPayload(decision, uid, email){
  return {
    signed_in: !!uid,
    email: email || null,
    access: decision.allow,
    reason: decision.reason,
    state: decision.state,
    override: decision.override,
    tier: decision.tier,
    capabilities: decision.capabilities,
    access_until: decision.access_until,
    cancel_at_period_end: decision.cancel_at_period_end,
    // so the client knows how long it may run before revalidating, without
    // having to know anything about the lease itself
    revalidate_after_sec: A.LEASE_TTL_SEC,
    account_required: A.accountRequired(),
    commercial_required: A.commercialRequired(),
    /* THE CANONICAL LEGAL DOCUMENTS, so Settings opens the same Terms the
       checkout consent links to and the same Terms the stored evidence names.
       Sent from the one module that owns all three, rather than left to a
       constant in the app shell that nobody would think to update when the
       website publishes. */
    agreements: Agree.currentAgreements()
  };
}

module.exports = async function handler(req, res){
  const cfg = S.config();

  if (req.method === 'DELETE') return signOut(req, res, cfg);
  if (req.method !== 'POST'){
    res.setHeader('Allow', 'POST, DELETE');
    return S.json(res, 405, { error: 'method_not_allowed', code: 'METHOD_NOT_ALLOWED' });
  }
  if (!cfg.serviceKey){
    log('SUPABASE_KEY_UNUSABLE source=' + cfg.serviceKeySource);
    return S.json(res, 503, { error: 'unavailable', code: 'SUPABASE_KEY_UNUSABLE' });
  }

  const who = await S.verifyUser(req, cfg);
  if (!who.uid){
    log(S.diagLine(who.code, who.diag));
    // No cookie is issued and any existing one is cleared: presenting a bad
    // token must never leave an older, still-valid credential in place.
    res.setHeader('Set-Cookie', A.clearCookie());
    return S.json(res, 401, { error: 'not_authenticated', code: who.code });
  }

  const ent = await A.readEntitlement(S, cfg, who.uid);
  if (!ent.ok){
    // Supabase reachable enough to verify a token but not to read the row.
    // Fail closed rather than guess -- an unknown entitlement is not an
    // entitlement, and the athlete sees a retry rather than a wrong answer.
    log('ENTITLEMENT_READ_FAILED');
    return S.json(res, 503, { error: 'unavailable', code: 'ENTITLEMENT_UNREADABLE' });
  }

  const decision = A.resolveAccess({
    uid: who.uid,
    entitlement: ent.row,
    accountRequired: A.accountRequired(),
    commercialRequired: A.commercialRequired(),
    now: new Date()
  });

  if (!decision.allow){
    res.setHeader('Set-Cookie', A.clearCookie());
    log('DENIED reason=' + decision.reason);
    return S.json(res, 403, Object.assign({ error: 'no_access' }, uiPayload(decision, who.uid, who.email)));
  }

  const lease = await A.createLease(S, cfg, who.uid, A.LEASE_TTL_SEC);
  if (!lease.ok){
    log('LEASE_CREATE_FAILED');
    return S.json(res, 503, { error: 'unavailable', code: 'LEASE_UNWRITABLE' });
  }

  res.setHeader('Set-Cookie', A.buildSetCookie(lease.id, { maxAge: lease.ttl }));

  /* THE ACTIVITY SIGNAL. A lease is minted when an athlete actually opens the
     product, which is the only moment worth recording -- and the function
     refuses to write again inside the same hour, so this costs one row update
     a day per athlete rather than one per request.
     
     Deliberately not awaited for the response's sake, but deliberately awaited
     at all: an unawaited promise in a serverless function is a promise the
     platform may kill mid-flight. A failure here is logged and ignored, because
     a metrics timestamp must never be the reason an athlete cannot get in. */
  try{
    await S.sb(cfg, '/rpc/touch_last_active', {
      method: 'POST', body: JSON.stringify({ p_account_id: who.uid })
    });
  }catch(e){ log('LAST_ACTIVE_TOUCH_FAILED'); }

  log('ISSUED reason=' + decision.reason + ' ttl=' + lease.ttl);
  return S.json(res, 200, uiPayload(decision, who.uid, who.email));
};

/* Sign-out. Revokes THIS lease rather than every lease for the account, so
   signing out of a shared laptop does not sign the athlete out of their phone
   mid-block. Revoking everything is a separate, deliberate action. */
async function signOut(req, res, cfg){
  const id = A.readGateCookie(req);
  res.setHeader('Set-Cookie', A.clearCookie());
  if (id && cfg.serviceKey){
    try{ await A.revokeLease(S, cfg, id); }catch(e){ /* cookie is already gone */ }
  }
  return S.json(res, 200, { signed_out: true });
}
