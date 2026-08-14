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
  const tag = 'activity=' + activityId + ' aspect=' + event.aspect_type;
  if (athleteId == null || activityId == null){ S.log('webhook', tag + ' INCOMPLETE_EVENT'); return; }

  // Resolution is by Strava athlete id, which is UNIQUE across connections, so
  // an event can only ever land on the one VVV account that authorised it.
  const conn = await S.getConnectionByAthlete(cfg, athleteId);
  if (!conn){ S.log('webhook', tag + ' NO_MATCHING_CONNECTION'); return; }

  if (event.aspect_type === 'delete'){
    // The athlete's own training history is theirs: the logged workout stays
    // exactly as it is. Only the external provenance is retired, so a later
    // sync cannot resurrect the row and nothing claims Strava still backs it.
    await S.sb(cfg, '/strava_activities?user_id=eq.' + encodeURIComponent(conn.user_id) +
                    '&activity_id=eq.' + encodeURIComponent(activityId), {
      method: 'PATCH', body: JSON.stringify({ deleted: true }), prefer: 'return=minimal'
    });
    S.log('webhook', tag + ' PROVENANCE_RETIRED');
    return;
  }

  const token = await S.accessTokenFor(cfg, conn);
  if (!token){ S.log('webhook', tag + ' AUTHORIZATION_UNUSABLE'); return; }

  const r = await S.stravaApi('/activities/' + activityId + '?include_all_efforts=false', token);
  if (!r.ok){ S.log('webhook', tag + ' FETCH_FAILED status=' + r.status); return; }
  const a = S.normaliseActivity(r.data);
  if (!a){ S.log('webhook', tag + ' UNREADABLE_ACTIVITY'); return; }
  if (!a.isRun){ S.log('webhook', tag + ' NOT_A_RUN type=' + a.activityType); return; }
  if (!a.date){ S.log('webhook', tag + ' NO_LOCAL_DATE'); return; }
  // Strava fires `create` before it has processed the upload, so this is the
  // normal first event for a watch upload, not an error. The `update` event
  // that follows carries the real distance and stages it properly.
  if (a.km == null){ S.log('webhook', tag + ' NO_DISTANCE_YET'); return; }

  const saved = await S.stageActivity(cfg, conn.user_id, a);
  S.log('webhook', tag + (saved && saved.ok ? ' STAGED' : ' STAGE_FAILED') +
        ' date=' + a.date + ' km=' + a.km);
}

module.exports = async function handler(req, res){
  const cfg = S.config();

  if (req.method === 'GET'){
    const q = req.query || {};
    if (q['hub.mode'] === 'subscribe' && cfg.verifyToken && q['hub.verify_token'] === cfg.verifyToken){
      S.log('webhook', 'HANDSHAKE_OK');
      return S.json(res, 200, { 'hub.challenge': q['hub.challenge'] });
    }
    if (q['hub.mode']) S.log('webhook', 'HANDSHAKE_REFUSED');
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
  S.log('webhook', 'EVENT type=' + (event && event.object_type) +
        ' aspect=' + (event && event.aspect_type) +
        (cfg.serviceKey ? '' : ' NO_SERVICE_KEY source=' + cfg.serviceKeySource));
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
    }catch(e){ S.log('webhook', 'HANDLER_THREW'); }
  }

  S.json(res, 200, { received: true });
};
