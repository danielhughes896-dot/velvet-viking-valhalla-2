// Velvet Viking -- Phase 3A2: the payment-provider webhook.
//
//   POST /api/billing-webhook
//     x-vvv-billing-timestamp: <unix seconds>
//     x-vvv-billing-signature: <hex HMAC-SHA256 of "<timestamp>.<raw body>">
//
// PROVIDER-AGNOSTIC ON PURPOSE. No provider's SDK, no provider's event names,
// no provider's signature scheme inside the application. The adapter that
// translates a real provider into the shape below is the ONLY thing that has
// to change when a provider is chosen, and it lives at the top of this file
// where it can be read in one screen. Everything after normalisation is
// _billing.js, which is pure and fully tested.
//
// WHAT THIS ENDPOINT WILL NOT DO
//   - trust an unsigned request. If the secret is not configured the endpoint
//     answers 503. "No secret set" must never mean "accept everything", which
//     is the direction that mistake usually fails in.
//   - trust a request body about WHO it concerns beyond the subject id, which
//     is matched against a real entitlements row.
//   - answer 500 to a duplicate. A provider treats 5xx as "try again", so an
//     endpoint that errors on a replay receives that replay until it gives up.
//     Already-applied is a 200 with applied:false.
//   - write an override. Billing owns nine columns and no others.
//   - log an email address, a signature, a secret, or a full provider id.
//
// INERT UNTIL ACTIVATED. Nothing here runs unless a provider is configured and
// pointed at it, and nothing it writes has any effect on access until
// VVV_COMMERCIAL_REQUIRED is switched on. Both are deliberate: the machinery
// is deployable, testable and reversible before it is load-bearing.

const crypto = require('crypto');
const S = require('./_strava.js');     // canonical Supabase access layer
const A = require('./_access.js');
const B = require('./_billing.js');

const SIGNATURE_HEADER = 'x-vvv-billing-signature';
const TIMESTAMP_HEADER = 'x-vvv-billing-timestamp';
/* Five minutes. Long enough for a provider retry that queued behind an
   outage, short enough that a request captured off the wire is useless by the
   time anyone replays it. */
const MAX_SKEW_SEC = 5 * 60;

function log(what){ try{ console.log('billing: ' + what); }catch(e){} }
/* Provider ids are not secrets but they are somebody's customer reference.
   Enough of one to correlate a log line, never enough to be one. */
function ref(v){ return v ? String(v).slice(0, 8) + '…' : '-'; }

/* ---------- the adapter ----------
   A real provider's payload arrives with its own vocabulary. This is the one
   place that knows any of it, and today it knows only Velvet Viking's own
   shape -- which is what a provider adapter will produce. Adding a provider
   means adding a branch here and nothing else. */
function normaliseEvent(body){
  const b = body || {};
  const ev = {
    type: b.type || null,
    user_id: b.user_id || null,
    seq: b.seq == null ? null : Number(b.seq),
    occurred_at: b.occurred_at || null,
    period_end: b.period_end || null,
    tier: b.tier || null,
    provider: b.provider || 'manual',
    customer_id: b.customer_id || null,
    sub_id: b.sub_id || null
  };
  return ev;
}
function normaliseSnapshot(body){
  const b = body || {};
  return {
    user_id: b.user_id || null,
    state: b.state || null,
    access_until: b.access_until || null,
    cancel_at_period_end: !!b.cancel_at_period_end,
    tier: b.tier || null,
    provider: b.provider || 'manual',
    customer_id: b.customer_id || null,
    sub_id: b.sub_id || null,
    as_of: b.as_of || null
  };
}

/* ---------- signature ----------
   HMAC over "<timestamp>.<raw body>" rather than over the body alone, so a
   valid signature cannot be lifted from one request and replayed on a later
   one with a fresh timestamp. Compared in constant time; length-checked first
   because timingSafeEqual throws on a mismatch, and throwing on a wrong length
   would itself leak the length. */
function verifySignature(rawBody, timestamp, signature, secret, nowSec){
  if (!secret) return { ok: false, reason: 'not_configured' };
  if (!signature || !timestamp) return { ok: false, reason: 'unsigned' };
  const ts = Number(timestamp);
  if (!isFinite(ts)) return { ok: false, reason: 'bad_timestamp' };
  if (Math.abs(nowSec - ts) > MAX_SKEW_SEC) return { ok: false, reason: 'stale_timestamp' };

  const expected = crypto.createHmac('sha256', secret)
    .update(String(timestamp) + '.' + rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature).trim().toLowerCase(), 'utf8');
  if (a.length !== b.length) return { ok: false, reason: 'bad_signature' };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  return { ok: true, reason: 'verified' };
}

/* Vercel parses JSON bodies before a handler sees them, which destroys the
   bytes a signature was computed over. req.rawBody is preferred when the
   platform preserves it; the deterministic re-serialisation is the fallback
   and is why the adapter above is the only thing allowed to reshape a body. */
function rawBodyOf(req){
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  try{ return JSON.stringify(req.body == null ? {} : req.body); }catch(e){ return ''; }
}

module.exports = async function handler(req, res){
  if (req.method !== 'POST'){
    res.setHeader('Allow', 'POST');
    return S.json(res, 405, { error: 'method_not_allowed' });
  }
  const cfg = S.config();
  const secret = process.env.VVV_BILLING_WEBHOOK_SECRET || '';

  if (!secret){
    log('NOT_CONFIGURED');
    return S.json(res, 503, { error: 'unavailable', code: 'BILLING_NOT_CONFIGURED' });
  }
  if (!cfg.serviceKey){
    log('SUPABASE_KEY_UNUSABLE source=' + cfg.serviceKeySource);
    return S.json(res, 503, { error: 'unavailable', code: 'SUPABASE_KEY_UNUSABLE' });
  }

  const raw = rawBodyOf(req);
  /* `check` rather than `sig`: what this holds is the VERDICT, and its
     .reason is a classification -- unsigned, stale_timestamp, bad_signature --
     never any signature material. That distinction is what makes it safe to
     log, and naming it after the thing it is not would invite somebody to log
     the thing it is. */
  const check = verifySignature(raw, req.headers[TIMESTAMP_HEADER],
                                req.headers[SIGNATURE_HEADER], secret,
                                Math.floor(Date.now() / 1000));
  if (!check.ok){
    log('REJECTED reason=' + check.reason);
    return S.json(res, 401, { error: 'not_authenticated', code: 'BAD_SIGNATURE' });
  }

  const body = S.readBody(req);
  const isSnapshot = body && body.kind === 'snapshot';
  const subject = body && body.user_id;
  if (!subject) return S.json(res, 400, { error: 'bad_request', code: 'NO_SUBJECT' });

  const ent = await A.readEntitlement(S, cfg, subject);
  if (!ent.ok){
    /* The one place a 5xx is right: we could not read, so we do not know, so
       the provider SHOULD try again. */
    log('ENTITLEMENT_READ_FAILED user=' + ref(subject));
    return S.json(res, 503, { error: 'unavailable', code: 'ENTITLEMENT_UNREADABLE' });
  }

  const now = new Date();
  const before = ent.row;
  const result = isSnapshot
    ? B.reconcileEntitlement(before, normaliseSnapshot(body), now)
    : B.applyBillingEvent(before, normaliseEvent(body), now);

  if (!result.applied){
    log('NOOP reason=' + result.reason + ' user=' + ref(subject));
    return S.json(res, 200, { received: true, applied: false, reason: result.reason });
  }

  const patch = B.billingPatch(result.next);
  const write = before
    ? await S.sb(cfg, '/entitlements?user_id=eq.' + encodeURIComponent(subject),
        { method: 'PATCH', body: JSON.stringify(patch) })
    : await S.sb(cfg, '/entitlements',
        { method: 'POST', body: JSON.stringify(Object.assign({ user_id: subject }, patch)) });

  if (!write.ok){
    log('WRITE_FAILED status=' + write.status + ' user=' + ref(subject));
    return S.json(res, 503, { error: 'unavailable', code: 'ENTITLEMENT_UNWRITABLE' });
  }

  /* Access just ended. The lease is the credential that actually delivers the
     runtime, so it is killed here rather than left to expire -- otherwise
     "revoked" means "revoked within twelve hours", which is not what the word
     means. Failure to revoke is logged and not fatal: the entitlement is
     already written, so the next revalidation refuses anyway. */
  if (B.endsAccessNow(before, result.next, now)){
    try{
      await A.revokeLeasesForUser(S, cfg, subject);
      log('LEASES_REVOKED user=' + ref(subject));
    }catch(e){ log('LEASE_REVOKE_FAILED user=' + ref(subject)); }
  }

  log('APPLIED reason=' + result.reason + ' state=' + result.next.state + ' user=' + ref(subject));
  return S.json(res, 200, { received: true, applied: true, reason: result.reason });
};

module.exports.verifySignature = verifySignature;
module.exports.normaliseEvent = normaliseEvent;
module.exports.normaliseSnapshot = normaliseSnapshot;
module.exports.rawBodyOf = rawBodyOf;
module.exports.SIGNATURE_HEADER = SIGNATURE_HEADER;
module.exports.TIMESTAMP_HEADER = TIMESTAMP_HEADER;
module.exports.MAX_SKEW_SEC = MAX_SKEW_SEC;
