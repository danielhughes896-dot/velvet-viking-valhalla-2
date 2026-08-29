// Velvet Viking -- account gate: flags, delivery cookie, access decision.
//
// WHY THIS FILE EXISTS SEPARATELY. The decision "may this request be handed the
// VVV runtime" is the security boundary of the whole product, so it is written
// once, as pure functions over explicit inputs, and imported by every handler
// that needs it. Nothing here reads global state or the network; the IO helpers
// at the bottom take an explicit config. That is what lets the repository test
// suite exercise the real decision rather than a paraphrase of it.
//
// WHAT IS AUTHORITATIVE, AND WHAT IS NOT
//   authoritative : the entitlements row, read server-side with the service key
//   authoritative : the existence of an unexpired, unrevoked access_leases row
//   NOT            : anything in localStorage
//   NOT            : anything in the JSON body /api/session returns for display
//   NOT            : any header, query parameter or cookie value the client chose
//
// The cookie carries an opaque id and nothing else. It is not a signed token
// with claims inside it, deliberately: an opaque id means revocation is a row
// delete rather than a blocklist, which is what "the lease must not become
// permanent authority" actually requires.

const crypto = require('crypto');

const GATE_COOKIE = 'vvv_gate';

// 12 hours. Settled in the Phase 3A closure: the lease only governs an already
// running instance -- Android cannot cold-start offline and no service worker
// caches the app -- so this is the window an athlete keeps working through a
// long run or a travel day with no signal. Shorter risks locking a paying
// athlete mid-day on patchy signal; longer buys a deliberately offline user
// real value and buys an honest user nothing.
const LEASE_TTL_SEC = 12 * 60 * 60;

/* ---------- activation flags ----------
   Server-side only, and OFF unless a deployment says otherwise in so many
   words. A typo, an unset variable or a failed lookup all mean "not required",
   which for the ACCOUNT gate is the safe direction: the failure mode of a
   mistake is that the product keeps behaving exactly as it does today, not
   that every athlete is locked out at once.

   Reading them through functions rather than constants matters: Vercel
   evaluates module scope once per cold start, so a captured constant would
   keep a stale value alive for the life of a warm instance after the flag is
   flipped. */
function flagOn(v){
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'on' || s === 'yes';
}
function accountRequired(){ return flagOn(process.env.VVV_ACCOUNT_REQUIRED); }
function commercialRequired(){ return flagOn(process.env.VVV_COMMERCIAL_REQUIRED); }
/* A THIRD flag, and deliberately not folded into the other two.
   VVV_COMMERCIAL_REQUIRED asks "is entitlement enforced" -- it locks people
   OUT. This asks "may anyone be charged" -- it lets money IN. They are
   different risks and they get switched on at different moments: enforcement
   first with beta overrides in place, selling second. Collapsing them would
   mean the act of enforcing entitlement also opened the tills. */
function commerceEnabled(){ return flagOn(process.env.VVV_COMMERCE_ENABLED); }

/* ---------- capabilities ----------
   The product asks `can('execution_review')`, never `if (tier === 'standard')`.
   That one indirection is the whole reason Basic and Pro can arrive later as a
   change to this map plus a server-side tier assignment, with no edit anywhere
   in the coaching code.

   Launch ships one tier. The map is not a pricing table and must not become
   one -- it says what a tier may DO, and the commercial meaning of a tier lives
   with the payment provider and the offering, not here. */
const CAPABILITIES = {
  standard: [
    'core_coach', 'plan_generation', 'workout_logging', 'execution_review',
    'next_move', 'adaptation', 'cloud_sync', 'strava_import'
  ]
};
function capabilitiesFor(tier){
  return (CAPABILITIES[tier] || CAPABILITIES.standard).slice();
}

/* ---------- what an athlete keeps when they have nothing ----------
   Phase 3A2. A subscription ending is not a reason to hold somebody's training
   history hostage, and an account they cannot reach is an account they cannot
   close. These four are therefore a POSITIVE contract, stated here, rather
   than whatever happens to survive when access is refused:

     account_manage  see the state, and pay again
     data_export     take the whole training history out, in full
     account_delete  leave entirely, and take the erasure right with them
     legal           privacy and terms, which must never be behind a paywall

   Deliberately absent: everything that produces or interprets training.
   plan_generation, adaptation, execution_review and next_move are the product;
   the list above is the door.

   These are what the LOCKED SHELL is for. account.html is public by
   construction precisely so this set is reachable with zero entitlement -- if
   it lived behind the delivery gate there would be nowhere to resubscribe
   from, which is the failure mode that turns a lapsed subscriber into a
   support ticket and then into a chargeback. */
const LOCKED_CAPABILITIES = ['account_manage', 'data_export', 'account_delete', 'legal'];
function lockedCapabilities(){ return LOCKED_CAPABILITIES.slice(); }

/* ---------- the decision ----------
   Pure. Given the flags, an entitlement row (or null) and a clock, decide
   whether this athlete may be handed the product.

   Order matters and is deliberate:
     1. an override outranks everything, so an owner or a tester is never
        locked out by a commercial rule that does not apply to them;
     2. while COMMERCIAL_REQUIRED is off, any authenticated account is admitted
        -- that is the 3A1 migration policy, and it is what makes the account
        gate deployable without selling anything;
     3. only then do the commercial rules apply, and they are driven by
        access_until rather than by `state`, so a row whose state and timestamp
        disagree fails closed rather than open.

   `now` is injected rather than read, because a decision function that reads
   the clock cannot be tested at a boundary. */
function resolveAccess(input){
  const o = input || {};
  const now = o.now instanceof Date ? o.now : new Date(o.now || Date.now());
  const ent = o.entitlement || null;
  const acctReq = !!o.accountRequired;
  const commReq = !!o.commercialRequired;

  // Not signed in. Before the gate is switched on this is still allowed --
  // that is exactly what "deploy without locking current users" means.
  if (!o.uid){
    return acctReq
      ? deny('no_account', ent)
      : allow('account_gate_off', ent, 'anonymous');
  }

  const ov = overrideOf(ent, now);
  if (ov) return allow('override_' + ov, ent, tierOf(ent));

  if (!commReq) return allow('pre_commercial', ent, tierOf(ent));

  // --- everything below here is inert until 3A2 activates the commercial flag
  if (!ent) return deny('no_entitlement', ent);
  const until = ent.access_until ? new Date(ent.access_until) : null;
  if (!until || !(until > now)) return deny('expired', ent);
  if (['trial','active','grace'].indexOf(ent.state) === -1) return deny('state_' + ent.state, ent);
  return allow('subscription_' + ent.state, ent, tierOf(ent));
}

/* Does this row currently grant access, ignoring the flags entirely?
   Used by the checkout seam to refuse a second purchase. Deliberately reads
   access_until first, exactly as resolveAccess does, so the two can never
   disagree about what "still has access" means. */
function hasLiveAccess(ent, now){
  if (!ent) return false;
  const t = now instanceof Date ? now : new Date(now || Date.now());
  if (overrideOf(ent, t)) return true;
  const until = ent.access_until ? new Date(ent.access_until) : null;
  if (!until || !(until > t)) return false;
  return ['trial', 'active', 'grace'].indexOf(ent.state) !== -1;
}

/* WHICH OVERRIDES STILL OPEN THE DOOR.
 *
 * An override outranks every commercial rule, so the set of overrides that do
 * that is the most security-relevant list in this file, and it is stated here
 * rather than implied by "the column is not empty".
 *
 *   owner   the operator's own account. Kept: locking the operator out of the
 *           product to enforce a commercial rule they wrote helps nobody.
 *   promo   a complimentary grant, decided per account and deliberately.
 *
 * BETA IS NOT ON THIS LIST, and that is the commercial launch. The private
 * beta is over and there is no beta route into the product any more: previous
 * beta status, an address on the allowlist, an old plan on the device and the
 * mere existence of an account are all, now, exactly nothing.
 *
 * WHY THE COLUMN IS CHECKED HERE AS WELL AS AT THE RESOLVER. _entitlement.js
 * has already retired admin_beta, so no NEW projection can write 'beta' into
 * this column. Rows written BEFORE that change still carry it, and they are
 * re-projected only when something happens to that account. A gate that
 * trusted the column would keep honouring every one of those rows until an
 * event that may never come. This is the line that makes the retirement true
 * on the deployment rather than true in principle. */
var ACCESS_OVERRIDES = ['owner', 'promo'];

function overrideOf(ent, now){
  if (!ent || !ent.override) return null;
  if (ACCESS_OVERRIDES.indexOf(ent.override) === -1) return null;
  if (ent.override_expires_at && !(new Date(ent.override_expires_at) > now)) return null;
  return ent.override;
}
function tierOf(ent){ return (ent && ent.tier) || 'standard'; }
function allow(reason, ent, tier){
  return { allow: true, reason: reason,
           state: (ent && ent.state) || null,
           override: (ent && ent.override) || null,
           tier: tier || tierOf(ent),
           capabilities: capabilitiesFor(tier || tierOf(ent)),
           access_until: (ent && ent.access_until) || null,
           cancel_at_period_end: !!(ent && ent.cancel_at_period_end) };
}
function deny(reason, ent){
  return { allow: false, reason: reason,
           state: (ent && ent.state) || null,
           override: (ent && ent.override) || null,
           /* No tier, because a tier is a thing you are paying for. But the
              locked set is stated rather than empty: "you may still export
              your training and close your account" is a promise the product
              makes, and a promise expressed as an absence is one nobody can
              test. */
           tier: null, capabilities: [],
           locked_capabilities: lockedCapabilities(),
           access_until: (ent && ent.access_until) || null,
           cancel_at_period_end: !!(ent && ent.cancel_at_period_end) };
}

/* ---------- cookies ---------- */
function parseCookies(header){
  const out = {};
  String(header || '').split(';').forEach(function(part){
    const i = part.indexOf('=');
    if (i < 1) return;
    const k = part.slice(0, i).trim();
    if (!k) return;
    let v = part.slice(i + 1).trim();
    try{ v = decodeURIComponent(v); }catch(e){ /* keep raw */ }
    out[k] = v;
  });
  return out;
}

/* Secure + HttpOnly so no script -- ours, an extension's or an attacker's --
   can read or forge it.

   SameSite=Lax rather than Strict, and the reason is concrete: the magic-link
   sign-in arrives as a top-level navigation from the athlete's email client,
   which is cross-site. Strict would withhold the cookie on exactly that
   navigation and the athlete would bounce back to the sign-in screen they had
   just completed. Lax still withholds it on cross-site subrequests, which is
   the case that matters.

   No CSRF token is needed anywhere, by construction: this cookie authorises
   GET of a document and nothing else. Every state-changing endpoint continues
   to authenticate with a Bearer token, which a browser never attaches on its
   own, so a cross-site form post carries no authority. */
function buildSetCookie(value, opts){
  const o = opts || {};
  const parts = [GATE_COOKIE + '=' + encodeURIComponent(value == null ? '' : value)];
  parts.push('Path=/');
  parts.push('Max-Age=' + (o.maxAge == null ? LEASE_TTL_SEC : o.maxAge));
  parts.push('SameSite=Lax');
  parts.push('HttpOnly');
  if (o.secure !== false) parts.push('Secure');
  return parts.join('; ');
}
function clearCookie(){ return buildSetCookie('', { maxAge: 0 }); }
function readGateCookie(req){
  return parseCookies(req && req.headers && req.headers.cookie)[GATE_COOKIE] || null;
}

/* 256 bits from a CSPRNG. Long enough that guessing is not a threat model, and
   opaque so it leaks nothing about the athlete if it is ever logged by
   accident -- though it should not be logged at all. */
function newLeaseId(){ return crypto.randomBytes(32).toString('base64url'); }

/* ---------- storage ----------
   Every call uses the service key, so RLS is bypassed by design: these tables
   deny the browser outright and this process is the only writer. */
async function readEntitlement(S, cfg, uid){
  const r = await S.sb(cfg, '/entitlements?select=*&user_id=eq.' + encodeURIComponent(uid) + '&limit=1');
  if (!r.ok) return { ok:false, row:null };
  const rows = await r.json().catch(function(){ return null; });
  return { ok:true, row: (rows && rows[0]) || null };
}

async function createLease(S, cfg, uid, ttlSec){
  const id = newLeaseId();
  const ttl = ttlSec == null ? LEASE_TTL_SEC : ttlSec;
  const expires = new Date(Date.now() + ttl * 1000).toISOString();
  const r = await S.sb(cfg, '/access_leases', {
    method: 'POST',
    body: JSON.stringify({ id: id, user_id: uid, expires_at: expires })
  });
  if (!r.ok) return { ok:false, id:null, expiresAt:null, ttl:ttl };
  return { ok:true, id: id, expiresAt: expires, ttl: ttl };
}

/* Resolves a cookie value to the athlete it belongs to, or null. A lease that
   is missing, revoked or past its expiry resolves to null identically -- the
   caller must not be able to tell those apart, and does not need to. */
async function resolveLease(S, cfg, leaseId){
  if (!leaseId) return null;
  const r = await S.sb(cfg, '/access_leases?select=id,user_id,expires_at,revoked_at' +
    '&id=eq.' + encodeURIComponent(leaseId) + '&limit=1');
  if (!r.ok) return null;
  const rows = await r.json().catch(function(){ return null; });
  const row = rows && rows[0];
  if (!row) return null;
  if (row.revoked_at) return null;
  if (!(new Date(row.expires_at) > new Date())) return null;
  return row;
}

async function revokeLease(S, cfg, leaseId){
  if (!leaseId) return false;
  const r = await S.sb(cfg, '/access_leases?id=eq.' + encodeURIComponent(leaseId), {
    method: 'PATCH', body: JSON.stringify({ revoked_at: new Date().toISOString() })
  });
  return r.ok;
}

/* Used on sign-out-everywhere and on account deletion. Deleting the auth user
   cascades these rows anyway; this exists so revocation does not DEPEND on the
   cascade, and so an operator can end a session without ending an account. */
async function revokeLeasesForUser(S, cfg, uid){
  if (!uid) return false;
  const r = await S.sb(cfg, '/access_leases?user_id=eq.' + encodeURIComponent(uid) +
    '&revoked_at=is.null', {
    method: 'PATCH', body: JSON.stringify({ revoked_at: new Date().toISOString() })
  });
  return r.ok;
}

module.exports = {
  commerceEnabled, hasLiveAccess,
  GATE_COOKIE, LEASE_TTL_SEC, CAPABILITIES,
  flagOn, accountRequired, commercialRequired,
  LOCKED_CAPABILITIES, lockedCapabilities,
  capabilitiesFor, resolveAccess, overrideOf, ACCESS_OVERRIDES,
  parseCookies, buildSetCookie, clearCookie, readGateCookie, newLeaseId,
  readEntitlement, createLease, resolveLease, revokeLease, revokeLeasesForUser
};
