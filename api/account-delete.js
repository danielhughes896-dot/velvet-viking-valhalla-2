// Velvet Viking -- Phase 3A2: closing an account from the locked shell.
//
//   POST /api/account-delete   Authorization: Bearer <supabase access token>
//
// The `account_delete` half of the locked-shell contract in _access.js. An
// account the athlete cannot reach is an account they cannot close, and a
// lapsed subscriber locked out of the app has no other route to the erasure
// right. So this is deliberately reachable WITHOUT access.
//
// IT ADDS NO NEW AUTHORITY. The deletion itself is still
// delete_own_account() -- the same SECURITY DEFINER function the in-app
// Settings button has always called, still authorised by auth.uid() inside
// Postgres. This endpoint FORWARDS the athlete's own token to it and never
// substitutes the service key, so the database's answer to "whose account is
// this" is unchanged and unchangeable from here. There is no user_id
// parameter, because there must be no way to name somebody else.
//
// ORDER MATTERS, and it is the app's order for the app's reason: Strava is
// disconnected FIRST, while the account that authorises reading its tokens
// still exists. delete_own_account() is a Postgres function and cannot call
// Strava, so deleting first would strand the authorization -- the tokens gone
// from VVV while Strava still lists VVV as connected, with nothing left to
// revoke it with. Non-fatal: an athlete who has asked to be deleted must not
// be blocked by a third party being down.

const S = require('./_strava.js');
const A = require('./_access.js');

function log(what){ try{ console.log('account-delete: ' + what); }catch(e){} }

/* The athlete's OWN token, not the service key. Reaching for S.sb() here would
   silently promote a self-service deletion into an administrative one. */
function asAthlete(cfg, token, path, opts){
  const o = opts || {};
  return fetch(cfg.supabaseUrl + path, {
    method: o.method || 'GET',
    headers: {
      'apikey': cfg.anonKey,
      'Authorization': 'Bearer ' + token,
      'content-type': 'application/json'
    },
    body: o.body
  });
}

function bearer(req){
  const m = /^Bearer\s+(.+)$/i.exec(req.headers['authorization'] || '');
  return m ? m[1].trim() : null;
}

module.exports = async function handler(req, res){
  if (req.method !== 'POST'){
    res.setHeader('Allow', 'POST');
    return S.json(res, 405, { error: 'method_not_allowed' });
  }
  const cfg = S.config();
  const token = bearer(req);

  const who = await S.verifyUser(req, cfg);
  if (!who.uid || !token){
    log(S.diagLine(who.code, who.diag));
    return S.json(res, 401, { error: 'not_authenticated', code: who.code });
  }

  /* Strava first, and deliberately best-effort. strava-disconnect is reached
     through the ordinary endpoint rather than a second, parallel notion of
     "remove Strava", so it deauthorizes AND purges staged activities through
     one already-tested path. */
  try{
    await fetch(S.siteOrigin(req) + '/api/strava-auth', {
      method: 'POST',
      headers: { 'authorization': 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'disconnect' })
    });
  }catch(e){ log('STRAVA_DISCONNECT_UNREACHABLE'); }

  const r = await asAthlete(cfg, token, '/rest/v1/rpc/delete_own_account',
                            { method: 'POST', body: '{}' });
  if (!r.ok){
    log('DELETE_FAILED status=' + r.status);
    return S.json(res, 502, { error: 'delete_failed', code: 'RPC_REFUSED' });
  }

  /* The rows cascade from auth.users, so the database removes the leases
     regardless. This is here so revocation does not DEPEND on the cascade,
     and the cookie is cleared because a cookie is not a database row -- until
     it goes, this browser still presents a credential for an account that no
     longer exists. */
  if (cfg.serviceKey){
    try{ await A.revokeLeasesForUser(S, cfg, who.uid); }catch(e){ log('LEASE_REVOKE_FAILED'); }
  }
  res.setHeader('Set-Cookie', A.clearCookie());

  log('DELETED');
  return S.json(res, 200, { deleted: true });
};

module.exports.asAthlete = asAthlete;
module.exports.bearer = bearer;
