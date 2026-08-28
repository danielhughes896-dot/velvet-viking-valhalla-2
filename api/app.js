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
const crypto = require('crypto');
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

/* THE VALIDATOR: A HASH OF THE BYTES, AND NOTHING ELSE.
   ---------------------------------------------------------------------------
   Derived from the document's own content, so it is identical for identical
   content and different the moment a single byte of the app changes. It is
   deliberately NOT built from a deployment id, a build timestamp, a file mtime
   or the current time: the first three change on every redeploy even when the
   app did not, throwing away a valid cache for nothing, and the last would
   never match twice and would make revalidation permanently useless.

   Strong, not weak (no W/ prefix): the comparison must mean "these are the
   same bytes", because the whole application -- every line of CSS and every
   line of JavaScript -- is inside this one document. A weak validator says
   "equivalent enough", and there is no such thing as equivalent enough for a
   payload the athlete is about to execute.

   Computed once per warm instance beside the file it describes, so it costs
   one hash per cold start rather than one per request. */
let cachedEtag = null;
function runtimeEtag(){
  if (cachedEtag == null){
    cachedEtag = '"' + crypto.createHash('sha256').update(runtime()).digest('hex').slice(0, 32) + '"';
  }
  return cachedEtag;
}

/* Does this request already hold exactly this document?
   Parses If-None-Match properly rather than comparing strings: the header is a
   LIST, may carry weak markers, and may be `*`. A sloppy comparison here fails
   in the safe direction (a needless 200), but it fails on every launch, which
   is the entire benefit gone. */
function etagMatches(req, tag){
  const raw = req && req.headers && (req.headers['if-none-match'] || req.headers['If-None-Match']);
  if (!raw) return false;
  const want = String(tag);
  return String(raw).split(',').some(function(part){
    const t = part.trim().replace(/^W\//, '');
    return t === '*' || t === want;
  });
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

/* THE ONLY WAY THE RUNTIME IS EVER SENT, and therefore the only place a 304
   can be produced. That is the security argument, and it is structural rather
   than a rule someone has to remember: this function is unreachable except
   after the gate has decided, at the two call sites below (gate off, and
   access granted). A conditional request cannot reach the validator without
   first passing exactly the checks a full request passes -- there is no
   earlier branch to slip through, because there is no earlier branch.

   WHAT CHANGED, AND WHY THE OLD HEADER WAS COSTING MORE THAN IT PROTECTED.

   This used to send `no-store`, with the reasoning that the document is
   personal to an entitled session. Its own comment noted, correctly, that the
   bytes are identical for everyone. `no-store` forbids the BROWSER from
   keeping a copy as well as forbidding intermediaries -- so 1.75 MB (551 KB
   gzipped) of unchanged application crossed the wire on every launch, and on a
   slow connection the athlete waited about eleven seconds to see anything.
   Worse, the app could not open at all without a network, even with a complete
   plan already in localStorage: the shell needed to read it had to be fetched
   first.

   `private, max-age=0, must-revalidate` keeps every protection that mattered
   and drops the one that only cost:

     private          no shared cache, CDN or proxy may store this. Unchanged
                      in force from before; this was always the half doing the
                      real work against intermediaries.
     max-age=0        the stored copy is stale immediately, so it can never be
                      reused without asking.
     must-revalidate  and asking is not optional, even offline or under cache
                      pressure. The gate therefore runs on EVERY launch, exactly
                      as it did under no-store.

   The difference is only what happens after the gate says yes: the server can
   answer "you already have it" in a few hundred bytes instead of resending the
   application. Revocation is unaffected -- a denied athlete never reaches this
   function and so never receives a 304. */
/* THE OFFLINE ENTITLEMENT STAMP.
   ---------------------------------------------------------------------------
   Sent on every SUCCESSFUL gated delivery -- 200 and 304 alike, because a 304
   means the gate ran and said yes just as much as a 200 does. The service
   worker records it and may reuse the cached shell without a live gate for a
   bounded window afterwards.

   IT IS SERVER TIME, and that is the point. A device clock is the athlete's to
   set; this is not. The client cannot extend its own offline window by writing
   a later value here, because it does not write this value at all -- it can
   only ever have received one from a gate that granted it.

   A DENIAL NEVER SENDS IT. toShell() is a different response with no stamp, so
   a revoked athlete's window stops being refreshed the moment they are
   refused, and expires on its own. */
function serveRuntime(req, res){
  const tag = runtimeEtag();
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'private, max-age=0, must-revalidate');
  res.setHeader('etag', tag);
  res.setHeader('x-vvv-entitled-at', String(Date.now()));
  /* The gate cookie is what distinguishes one athlete's authorisation from
     another's, so a cache that ignored it could reuse a stored copy across
     sessions. Unchanged, and more important now that there is a stored copy. */
  res.setHeader('vary', 'Cookie');
  res.setHeader('x-content-type-options', 'nosniff');

  if (etagMatches(req, tag)){
    /* Authorised, and already holding this exact build. No body, no
       Content-Type negotiation, nothing to re-parse. */
    return res.status(304).end();
  }
  res.status(200).send(runtime());
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
    serveRuntime(req, res);
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
  serveRuntime(req, res);
};

// exported for the repository tests, which exercise the decision path without
// a live Supabase or a live filesystem layout
module.exports.RUNTIME_FILE = RUNTIME_FILE;
module.exports.runtimeEtag = runtimeEtag;
module.exports.etagMatches = etagMatches;
