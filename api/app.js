// Velvet Viking -- protected delivery of the coaching runtime.
//
// This is the acquisition boundary. Everything else in the gate decides what an
// athlete may DO; this decides whether they are handed the product at all.
//
// The rule it enforces is narrow and worth stating exactly, because overstating
// it would be worse than not having it: an unauthenticated party cannot obtain
// the VVV runtime from this deployment, and an athlete without access is sent
// to the account shell instead of being served a paywall painted over a fully
// delivered application. It does NOT make the delivered code secret. Nothing
// can: a payload legitimately received can be saved and re-run, and the Phase
// 3A closure accepts that as a different threat class from ordinary use.
//
// WHY THE RUNTIME MOVED. velvet-viking-valhalla.html used to sit at the site
// root, where Vercel serves it as a static asset and no function can intervene.
// It now lives in protected/, which vercel.json routes to this handler before
// the filesystem is consulted, so there is no second path to the same bytes.
// The file itself is unchanged, which is what keeps the test harness -- and
// every one of the 160 existing tests -- reading exactly what ships.

const fs = require('fs');
const path = require('path');
const S = require('./_strava.js');
const A = require('./_access.js');

function log(what){ try{ console.log('app: ' + what); }catch(e){} }

const RUNTIME_FILE = path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html');

/* Read once per warm instance. The file is ~830KB and never changes within a
   deployment, so re-reading it per request would burn latency for nothing. */
let cachedRuntime = null;
function runtime(){
  if (cachedRuntime == null) cachedRuntime = fs.readFileSync(RUNTIME_FILE);
  return cachedRuntime;
}

/* WHY THIS HEADER EXISTS.

   When the gate was first tested on a real Preview, /protected/…html returned
   the full runtime. Two completely different faults produce that, byte for
   byte identically:

     A. the routes never ran, and Vercel's filesystem served the static file;
     B. the routes ran, /api/app handled it, and VVV_ACCOUNT_REQUIRED was not
        visible to that deployment, so the gate was legitimately open.

   Nothing in the response told them apart, so the failure could only be
   guessed at. A security boundary that cannot be observed cannot be operated:
   the ONE question "did my code even run, and what did it decide" has to be
   answerable from a single request.

   It leaks nothing. The values are the gate's own posture, which is already
   evident from its behaviour, and never an identity, a lease or an entitlement.
   Its PRESENCE is the more important half: if this header is absent, /api/app
   did not handle the request at all. */
function stamp(res, state){
  try{ res.setHeader('x-vvv-gate', state); }catch(e){}
}

function serveRuntime(res){
  const body = runtime();
  res.setHeader('content-type', 'text/html; charset=utf-8');
  /* private, so no shared CDN or proxy ever holds a copy that could be served
     to someone who did not pass this check. no-store rather than a short
     max-age for the same reason: the document is personal to an entitled
     session even though its bytes are identical for everyone, and the moment
     it is cacheable by an intermediary the gate has a hole in it. */
  res.setHeader('cache-control', 'private, no-store, must-revalidate');
  res.setHeader('vary', 'Cookie');
  res.setHeader('x-content-type-options', 'nosniff');
  res.status(200).send(body);
}

/* Sent to the account shell rather than shown an error. 302 rather than 303 or
   a rewrite so the address bar reflects where the athlete actually is, and the
   back button behaves. */
function toShell(res, why){
  res.setHeader('cache-control', 'private, no-store');
  res.setHeader('location', '/account' + (why ? '?why=' + encodeURIComponent(why) : ''));
  res.status(302).end();
}

module.exports = async function handler(req, res){
  if (req.method !== 'GET' && req.method !== 'HEAD'){
    res.setHeader('Allow', 'GET, HEAD');
    return S.json(res, 405, { error: 'method_not_allowed' });
  }

  /* THE GATE IS OFF. Serve exactly what the site serves today. This is the
     whole point of deploying the architecture before activating it: with the
     flag unset, an athlete cannot tell any of this exists, and rollback is
     turning the flag off again rather than reverting code. */
  if (!A.accountRequired()){
    stamp(res, 'off');
    serveRuntime(res);
    return;
  }

  const cfg = S.config();
  if (!cfg.serviceKey){
    /* The gate is ON but the service key is unusable, so entitlement cannot be
       resolved at all. Fail CLOSED: an unverifiable request is not an entitled
       one. Sending the athlete to the shell -- which can explain itself and
       offer a retry -- is kinder than a bare 503 and gives away nothing. */
    log('SUPABASE_KEY_UNUSABLE source=' + cfg.serviceKeySource);
    stamp(res, 'unavailable');
    return toShell(res, 'unavailable');
  }

  const leaseId = A.readGateCookie(req);
  if (!leaseId){ stamp(res, 'no-session'); return toShell(res, 'signin'); }

  let lease = null;
  try{ lease = await A.resolveLease(S, cfg, leaseId); }
  catch(e){ log('LEASE_LOOKUP_FAILED'); stamp(res, 'unavailable'); return toShell(res, 'unavailable'); }

  // missing, revoked and expired are deliberately indistinguishable here
  if (!lease){ stamp(res, 'no-lease'); return toShell(res, 'signin'); }

  /* Re-resolve entitlement on every delivery rather than trusting that a live
     lease implies current access. A lease proves WHO, not WHETHER: an operator
     may have revoked a tester, or a subscription may have lapsed, in the hours
     since it was minted. The revocation trigger in the schema also kills leases
     on downgrade, so this is belt and braces -- but the belt is the part that
     must not be the only thing holding it up. */
  const ent = await A.readEntitlement(S, cfg, lease.user_id);
  if (!ent.ok){ log('ENTITLEMENT_READ_FAILED'); stamp(res, 'unavailable'); return toShell(res, 'unavailable'); }

  const decision = A.resolveAccess({
    uid: lease.user_id,
    entitlement: ent.row,
    accountRequired: true,
    commercialRequired: A.commercialRequired(),
    now: new Date()
  });

  if (!decision.allow){
    log('DENIED reason=' + decision.reason);
    stamp(res, 'denied');
    return toShell(res, decision.reason === 'no_account' ? 'signin' : 'locked');
  }

  stamp(res, 'granted');
  serveRuntime(res);
};

// exported for the repository tests, which exercise the decision path without
// a live Supabase or a live filesystem layout
module.exports.RUNTIME_FILE = RUNTIME_FILE;
