// Velvet Viking -- Phase 3A2: taking your training with you.
//
//   GET /api/account-data   Authorization: Bearer <supabase access token>
//
// The `data_export` half of the locked-shell contract in _access.js, and it is
// deliberately reachable WITHOUT access. A subscription ending is not a reason
// to hold somebody's training history hostage, and the athlete who most needs
// an export is precisely the one who can no longer open the app to use the
// export button inside it.
//
// WHY THIS IS SERVER-SIDE AND NOT A localStorage READ IN THE SHELL.
// account.html could read this device's plan out of localStorage, and for an
// athlete standing at their own phone that would work. It fails for the case
// that matters: a lapsed athlete on a new laptop, whose training exists only
// in their account. Reading it here means the export is of the ACCOUNT, works
// from anywhere, and does not require the public shell to carry a copy of the
// Supabase credentials -- which is exactly the duplication that made the
// palette copies drift.
//
// SCOPE. The uid comes from a verified token and from nowhere else. There is
// no user_id parameter to tamper with, and the service key is used only to
// read the row belonging to that verified uid. Everything returned is the
// athlete's own.

const S = require('./_strava.js');
const A = require('./_access.js');

function log(what){ try{ console.log('account-data: ' + what); }catch(e){} }

/* The entitlement row carries provider customer and subscription ids. They are
   references into somebody else's system, they identify this athlete to that
   third party, and they are no part of the athlete's training data -- so the
   export summarises the entitlement rather than dumping it. */
function entitlementSummary(ent){
  if (!ent) return null;
  return {
    state: ent.state || null,
    tier: ent.tier || null,
    access_until: ent.access_until || null,
    cancel_at_period_end: !!ent.cancel_at_period_end,
    override: ent.override || null,
    override_expires_at: ent.override_expires_at || null
  };
}

module.exports = async function handler(req, res){
  if (req.method !== 'GET'){
    res.setHeader('Allow', 'GET');
    return S.json(res, 405, { error: 'method_not_allowed' });
  }
  const cfg = S.config();
  if (!cfg.serviceKey){
    log('SUPABASE_KEY_UNUSABLE source=' + cfg.serviceKeySource);
    return S.json(res, 503, { error: 'unavailable', code: 'SUPABASE_KEY_UNUSABLE' });
  }

  const who = await S.verifyUser(req, cfg);
  if (!who.uid){
    log(S.diagLine(who.code, who.diag));
    return S.json(res, 401, { error: 'not_authenticated', code: who.code });
  }

  const planRes = await S.sb(cfg, '/plans?select=data,updated_at&user_id=eq.' +
    encodeURIComponent(who.uid) + '&limit=1');
  if (!planRes.ok){
    log('PLAN_READ_FAILED status=' + planRes.status);
    return S.json(res, 503, { error: 'unavailable', code: 'PLAN_UNREADABLE' });
  }
  const rows = await planRes.json().catch(function(){ return null; });
  const row = (rows && rows[0]) || null;

  const ent = await A.readEntitlement(S, cfg, who.uid);

  /* An athlete with no cloud copy is not an error -- plenty of athletes have
     never signed in on a second device. The export says so rather than
     failing, so "I exported and got nothing" can never be confused with "the
     export is broken". */
  log('EXPORTED plan=' + (row ? 'yes' : 'none'));
  return S.json(res, 200, {
    exported_at: new Date().toISOString(),
    account: { email: who.email || null },
    entitlement: entitlementSummary(ent.ok ? ent.row : null),
    plan: row ? row.data : null,
    plan_updated_at: row ? row.updated_at : null,
    plan_present: !!row
  });
};

module.exports.entitlementSummary = entitlementSummary;
