// Strava push subscription endpoint. This is what makes ingestion automatic:
// the athlete finishes a run, their watch uploads to Strava, Strava POSTs here
// within seconds, and VVV fetches and stages the activity before the athlete
// has opened the app.
//
//   GET  ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
//        Strava's one-time subscription handshake. Must echo the challenge.
//
//   POST { object_type, aspect_type, object_id, owner_id, updates }
//        An activity or athlete event. Strava expects 200 within 2 seconds and
//        retries otherwise, so this answers immediately and does the fetch
//        after responding; a lost retry costs nothing because staging is
//        keyed on the activity id and is idempotent.

const S = require('./_strava.js');

async function ingest(cfg, event){
  const athleteId = event.owner_id;
  const activityId = event.object_id;
  if (athleteId == null || activityId == null) return;

  const conn = await S.getConnectionByAthlete(cfg, athleteId);
  if (!conn) return;                       // not a VVV athlete, or already disconnected

  if (event.aspect_type === 'delete'){
    // The athlete's own training history is theirs: the logged workout stays
    // exactly as it is. Only the external provenance is retired, so a later
    // sync cannot resurrect the row and nothing claims Strava still backs it.
    await S.sb(cfg, '/strava_activities?user_id=eq.' + encodeURIComponent(conn.user_id) +
                    '&activity_id=eq.' + encodeURIComponent(activityId), {
      method: 'PATCH', body: JSON.stringify({ deleted: true }), prefer: 'return=minimal'
    });
    return;
  }

  const token = await S.accessTokenFor(cfg, conn);
  if (!token) return;                      // revoked; accessTokenFor has cleared the row

  const r = await S.stravaApi('/activities/' + activityId + '?include_all_efforts=false', token);
  if (!r.ok) return;
  const a = S.normaliseActivity(r.data);
  if (!a || !a.isRun || !a.date) return;   // rides, swims and walks are not VVV evidence

  await S.stageActivity(cfg, conn.user_id, a);
}

const SUBS_URL = 'https://www.strava.com/api/v3/push_subscriptions';

async function admin(req, res, cfg, op){
  if (!cfg.clientId || !cfg.clientSecret)
    return S.json(res, 503, { error: 'Strava is not configured on this server.' });
  const creds = 'client_id=' + encodeURIComponent(cfg.clientId) +
                '&client_secret=' + encodeURIComponent(cfg.clientSecret);
  try{
    if (op === 'view'){
      const r = await fetch(SUBS_URL + '?' + creds);
      return S.json(res, r.status, await r.json().catch(() => []));
    }
    if (op === 'create'){
      const r = await fetch(SUBS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: creds +
          '&callback_url=' + encodeURIComponent(S.siteOrigin(req) + '/api/strava-webhook') +
          '&verify_token=' + encodeURIComponent(cfg.verifyToken)
      });
      return S.json(res, r.status, await r.json().catch(() => ({})));
    }
    if (op === 'delete'){
      const id = String(req.query.id || '').replace(/[^0-9]/g, '');
      if (!id) return S.json(res, 400, { error: 'pass &id= from op=view' });
      const r = await fetch(SUBS_URL + '/' + id + '?' + creds, { method: 'DELETE' });
      return S.json(res, r.status, { deleted: r.ok });
    }
  }catch(e){ return S.json(res, 502, { error: 'could not reach Strava' }); }
  return S.json(res, 400, { error: 'op must be view, create or delete' });
}

module.exports = async function handler(req, res){
  const cfg = S.config();

  if (req.method === 'GET'){
    const q = req.query || {};
    if (q['hub.mode'] === 'subscribe' && cfg.verifyToken && q['hub.verify_token'] === cfg.verifyToken){
      return S.json(res, 200, { 'hub.challenge': q['hub.challenge'] });
    }
    // Owner-only subscription management, so the one-off registration can be
    // done from a phone browser instead of a terminal. Gated on the same
    // verify token the subscription itself is protected by, which the owner
    // has already had to set as a server secret.
    if (q.op && cfg.verifyToken && q.admin === cfg.verifyToken) return admin(req, res, cfg, q.op);
    return S.json(res, 403, { error: 'forbidden' });
  }

  if (req.method !== 'POST'){
    res.setHeader('Allow', 'GET, POST');
    return S.json(res, 405, { error: 'Method not allowed' });
  }

  const event = S.readBody(req);

  // The work is finished BEFORE the 200 goes out. Responding first and then
  // awaiting looks faster, but a serverless function can be frozen the moment
  // it responds, which would silently drop the fetch half the time. Strava
  // wants an answer inside two seconds and retries anything else -- and every
  // path here is keyed on the activity id and idempotent, so a retry after a
  // slow round trip simply does the same work again harmlessly. Correctness
  // under freeze is worth more than shaving a second off the acknowledgement.
  if (cfg.serviceKey && event){
    try{
      if (event.object_type === 'activity'){
        await ingest(cfg, event);
      } else if (event.object_type === 'athlete' && event.updates &&
                 String(event.updates.authorized) === 'false'){
        // The athlete revoked VVV from Strava's own settings page.
        const conn = await S.getConnectionByAthlete(cfg, event.owner_id);
        if (conn) await S.deleteConnection(cfg, conn.user_id);
      }
    }catch(e){}
  }

  S.json(res, 200, { received: true });
};
