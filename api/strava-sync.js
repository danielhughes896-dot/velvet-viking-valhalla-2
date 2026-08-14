// Activity delivery. The plan itself is client-owned (Supabase holds a
// last-writer-wins mirror of it), so this endpoint deliberately does NOT write
// into anyone's training plan. It moves objective activity data as far as the
// athlete's own staging rows and stops; the app performs the canonical
// matching and logging, exactly as it does for a file import.
//
//   POST { action: "pull" }              -> { activities:[...] }   staged, not yet ingested
//   POST { action: "sync", days: 30 }    -> { activities:[...] }   ask Strava, then the same
//   POST { action: "ack", ids: [...] }   -> { acked: n }
//
// "pull" costs no Strava call at all: the webhook has normally already fetched
// and staged the activity, so opening the app is a read of VVV's own rows.

const S = require('./_strava.js');

const MAX_SYNC_DAYS = 400;
const PER_PAGE = 100;

async function pending(cfg, uid){
  const r = await S.sb(cfg,
    '/strava_activities?user_id=eq.' + encodeURIComponent(uid) +
    '&ingested_at=is.null&deleted=is.false&order=activity_id.asc&limit=200');
  if (!r.ok) return [];
  const rows = await r.json();
  return rows.map(x => x.payload).filter(Boolean);
}

async function handleSync(req, res, cfg, uid, body){
  const conn = await S.getConnection(cfg, uid);
  if (!conn){ S.log('sync', 'MANUAL not_connected'); return S.json(res, 409, { error: 'not_connected' }); }
  const token = await S.accessTokenFor(cfg, conn);
  if (!token){ S.log('sync', 'MANUAL authorization_revoked'); return S.json(res, 409, { error: 'authorization_revoked' }); }

  const days = Math.min(MAX_SYNC_DAYS, Math.max(1, parseInt(body.days, 10) || 60));
  const after = Math.floor(Date.now()/1000) - days*86400;
  const r = await S.stravaApi('/athlete/activities?per_page=' + PER_PAGE + '&after=' + after, token);
  if (!r.ok){ S.log('sync', 'MANUAL strava_status=' + r.status); return S.json(res, 502, { error: 'strava_unavailable', status: r.status }); }

  const all = (r.data || []).map(S.normaliseActivity).filter(Boolean);
  const runs = all.filter(S.isUsableRun);
  // Staged one at a time so a single malformed activity cannot lose the batch.
  let staged = 0;
  for (const a of runs){ try{ const w = await S.stageActivity(cfg, uid, a); if (w && w.ok) staged++; }catch(e){} }

  const out = await pending(cfg, uid);
  S.log('sync', 'MANUAL days=' + days + ' returned=' + all.length +
        ' runs=' + runs.length + ' staged=' + staged + ' pending=' + out.length);
  S.json(res, 200, { activities: out, fetched: runs.length });
}

async function handleAck(req, res, cfg, uid, body){
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean).slice(0, 200) : [];
  if (!ids.length) return S.json(res, 200, { acked: 0 });
  const clean = ids.map(id => id.replace(/[^0-9]/g, '')).filter(Boolean);
  if (!clean.length) return S.json(res, 200, { acked: 0 });
  const list = '(' + clean.map(id => '"' + id + '"').join(',') + ')';
  const r = await S.sb(cfg,
    '/strava_activities?user_id=eq.' + encodeURIComponent(uid) + '&activity_id=in.' + list, {
      method: 'PATCH', body: JSON.stringify({ ingested_at: new Date().toISOString() }),
      prefer: 'return=minimal'
    });
  S.log('sync', 'ACK n=' + clean.length + (r.ok ? ' ok' : ' failed'));
  S.json(res, r.ok ? 200 : 502, r.ok ? { acked: ids.length } : { error: 'ack_failed' });
}

module.exports = async function handler(req, res){
  const cfg = S.config();
  if (req.method !== 'POST'){
    res.setHeader('Allow', 'POST');
    S.log('sync', 'BAD_METHOD ' + req.method);
    return S.json(res, 405, { error: 'Method not allowed' });
  }
  if (!cfg.serviceKey){
    S.log('sync', 'SUPABASE_KEY_UNUSABLE source=' + cfg.serviceKeySource);
    return S.json(res, 503, { error: 'supabase_key_unusable', code: 'SUPABASE_KEY_UNUSABLE' });
  }

  const body = S.readBody(req);
  const who = await S.verifyUser(req, cfg);
  if (!who.uid){
    // Previously silent. A sync the athlete actually pressed would leave no
    // trace at all if their session had lapsed, which is indistinguishable
    // from the logging being broken -- exactly the wrong thing to be unsure
    // about while commissioning.
    S.log('sync', 'REJECTED action=' + (body.action || 'pull') + ' ' + who.code);
    return S.json(res, 401, { error: 'not_signed_in', code: who.code });
  }
  const uid = who.uid;

  if (body.action === 'sync') return handleSync(req, res, cfg, uid, body);
  if (body.action === 'ack')  return handleAck(req, res, cfg, uid, body);
  const out = await pending(cfg, uid);
  // Always logged, including pending=0: "the app asked and there was nothing"
  // is a result, and a missing line must only ever mean the request did not
  // arrive.
  S.log('sync', 'PULL pending=' + out.length);
  return S.json(res, 200, { activities: out });
};
