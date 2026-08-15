// Strava connection control plane. Every route here is POST + Supabase JWT,
// so it always knows WHICH VVV athlete it is acting for, and it never returns
// a Strava token to the browser.
//
//   POST { action: "start" }      -> { url }  the real Strava authorize page
//   POST { action: "status" }     -> { connected, athleteName, since }
//   POST { action: "disconnect" } -> { connected:false }
//
// "connected" is answered from the server-side connection row plus a live
// token check, never from anything the browser stores.

const S = require('./_strava.js');

async function handleStart(req, res, cfg, uid){
  if (!cfg.clientId || !cfg.clientSecret)
    return S.json(res, 503, { error: 'Strava is not configured on this server.' });
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: S.redirectUri(req),
    response_type: 'code',
    // "force" so reconnecting after a revoke always re-asks rather than
    // silently reusing a grant the athlete may have removed on Strava's side.
    approval_prompt: 'force',
    scope: S.STRAVA_SCOPE,
    state: S.signState(uid, cfg.clientSecret)
  });
  S.json(res, 200, { url: S.STRAVA_AUTHORIZE_URL + '?' + params.toString() });
}

async function handleStatus(req, res, cfg, uid){
  const conn = await S.getConnection(cfg, uid);
  if (!conn) return S.json(res, 200, { connected: false });
  // A row is not proof of a usable authorization. Ask for a token: if the
  // access token is live it is returned as-is, and if it is stale the refresh
  // runs here. A refusal deletes the row, so a revoked grant reports
  // disconnected on the very next status call instead of lingering.
  const token = await S.accessTokenFor(cfg, conn);
  if (!token){
    S.log('auth', 'STATUS authorization_revoked');
    return S.json(res, 200, { connected: false, reason: 'authorization_revoked' });
  }
  S.json(res, 200, {
    connected: true,
    athleteName: conn.athlete_name || null,
    since: conn.connected_at || null
  });
}

async function handleDisconnect(req, res, cfg, uid){
  const conn = await S.getConnection(cfg, uid);
  let deauthorized = false;
  if (conn){
    // Best effort: tell Strava too, so VVV disappears from the athlete's own
    // Strava settings rather than just being forgotten on this side.
    const token = await S.accessTokenFor(cfg, conn);
    if (token){
      try{
        const d = await fetch(S.STRAVA_DEAUTH_URL, {
          method: 'POST', headers: { 'Authorization': 'Bearer ' + token }
        });
        deauthorized = !!(d && d.ok);
      }catch(e){}
    }
    await S.deleteConnection(cfg, uid);
  }
  /* Unconditional, and deliberately not gated on `conn`. Staged rows can
     outlive the connection row -- a half-finished disconnect, or a connection
     removed by a revoke webhook -- and leaving Strava-derived payloads behind
     after the athlete pressed Disconnect is exactly the retention problem this
     closes. Running it either way makes the endpoint self-healing. */
  const purge = await S.deleteStagedActivities(cfg, uid);
  const purged = !!(purge && purge.ok);
  S.log('auth', 'DISCONNECT had_connection=' + (conn ? 1 : 0) +
        ' deauthorized=' + (deauthorized ? 1 : 0) + ' staged_purged=' + (purged ? 1 : 0));
  // Reported honestly rather than always claiming a clean sweep: the athlete's
  // VVV side is disconnected regardless, but a failed purge is a fact the
  // caller (and the log) should see.
  S.json(res, 200, { connected: false, deauthorized: deauthorized, purged: purged });
}

module.exports = async function handler(req, res){
  const cfg = S.config();

  if (req.method !== 'POST'){
    res.setHeader('Allow', 'POST');
    S.log('auth', 'BAD_METHOD ' + req.method);
    return S.json(res, 405, { error: 'Method not allowed' });
  }
  if (!cfg.serviceKey){
    S.log('auth', 'SUPABASE_KEY_UNUSABLE source=' + cfg.serviceKeySource);
    return S.json(res, 503, { error: 'supabase_key_unusable', code: 'SUPABASE_KEY_UNUSABLE' });
  }

  const action = S.readBody(req).action;
  const who = await S.verifyUser(req, cfg);
  if (!who.uid){
    S.log('auth', 'REJECTED action=' + (action || 'none') + ' ' + who.code);
    return S.json(res, 401, { error: 'Sign in to VVV before connecting Strava.', code: who.code });
  }
  const uid = who.uid;

  if (action === 'start')      return handleStart(req, res, cfg, uid);
  if (action === 'status')     return handleStatus(req, res, cfg, uid);
  if (action === 'disconnect') return handleDisconnect(req, res, cfg, uid);
  return S.json(res, 400, { error: 'Unknown action' });
};
