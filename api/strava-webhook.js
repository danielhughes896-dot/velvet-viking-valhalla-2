// Strava push subscription endpoint. This is what makes ingestion automatic:
// the athlete finishes a run, their watch uploads to Strava, Strava POSTs here
// within seconds, and VVV fetches and stages the activity before the athlete
// has opened the app.
//
//   GET  ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
//        Strava's one-time subscription handshake. Must echo the challenge.
//
//   POST { object_type, aspect_type, object_id, owner_id, updates }
//        An activity or athlete event. The fetch completes before the 200 goes
//        out (see below); a Strava retry costs nothing because staging is keyed
//        on the activity id and is idempotent.
//
// Subscription management is NOT here. It is owner-only administration and
// lives behind an authenticated POST in api/strava-admin.js.

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

module.exports = async function handler(req, res){
  const cfg = S.config();

  if (req.method === 'GET'){
    const q = req.query || {};
    if (q['hub.mode'] === 'subscribe' && cfg.verifyToken && q['hub.verify_token'] === cfg.verifyToken){
      return S.json(res, 200, { 'hub.challenge': q['hub.challenge'] });
    }
    // Nothing else is served here. Subscription management used to live on
    // this route, authorised by the verify token in the query string -- which
    // made a callback-verification value double as a reusable administrative
    // credential, in a URL, mutating on GET. It now lives behind an
    // authenticated owner-only POST in api/strava-admin.js, and this token has
    // no authority beyond the handshake above.
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
