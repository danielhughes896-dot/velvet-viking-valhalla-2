// Shared server-side Strava helpers. Everything that needs the Client Secret,
// a Supabase service-role key, or a Strava access token lives behind this
// module and never crosses into the browser.
//
// Storage decision: Strava access/refresh tokens are held in
// public.strava_connections, a table with Row Level Security enabled and NO
// policies at all. RLS with no policy denies every request made with the anon
// or authenticated role, so the tokens are unreachable from the browser even
// with a valid signed-in JWT -- only the service_role key used here can read
// them, and that key exists solely inside the Vercel function environment.
// localStorage was the previous home; it is readable by any script on the
// origin, survives a shared device, and travels inside an exported backup.

const crypto = require('crypto');

const STRAVA_AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL     = 'https://www.strava.com/oauth/token';
const STRAVA_DEAUTH_URL    = 'https://www.strava.com/oauth/deauthorize';
const STRAVA_API           = 'https://www.strava.com/api/v3';

// read = profile basics, activity:read_all = the activities themselves,
// including ones the athlete marked private. Nothing is requested that VVV
// does not read, and no write scope is requested at all.
const STRAVA_SCOPE = 'read,activity:read_all';

const STATE_TTL_SEC = 15 * 60;

function env(name){ return process.env[name] || ''; }

function config(){
  return {
    clientId:     env('STRAVA_CLIENT_ID'),
    clientSecret: env('STRAVA_CLIENT_SECRET'),
    verifyToken:  env('STRAVA_WEBHOOK_VERIFY_TOKEN'),
    supabaseUrl:  (env('SUPABASE_URL') || 'https://eqiydxissphygnycpouu.supabase.co').replace(/\/$/, ''),
    serviceKey:   env('SUPABASE_SERVICE_ROLE_KEY')
  };
}

function siteOrigin(req){
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers['x-forwarded-host'] || req.headers.host;
  return proto + '://' + host;
}
function redirectUri(req){ return siteOrigin(req) + '/api/strava-callback'; }

function readBody(req){
  let body = req.body || {};
  if (typeof body === 'string'){ try{ body = JSON.parse(body); }catch(e){ body = {}; } }
  return body && typeof body === 'object' ? body : {};
}

/* ---------- CSRF/binding state ----------
   The state parameter is an HMAC over {VVV user id, nonce, expiry}, keyed by
   the Client Secret that already has to exist. It does two jobs: it proves the
   callback belongs to an authorization THIS server started (so a bare
   /api/strava-callback?code=... cannot be replayed at the athlete), and it
   carries which VVV account the resulting tokens belong to without ever
   putting a Supabase JWT in a URL. */
function b64url(buf){ return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function unb64url(s){ return Buffer.from(String(s).replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8'); }

function signState(uid, secret){
  const payload = JSON.stringify({ u: uid, n: crypto.randomBytes(9).toString('hex'),
                                   e: Math.floor(Date.now()/1000) + STATE_TTL_SEC });
  const body = b64url(payload);
  const mac  = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  return body + '.' + mac;
}
function verifyState(state, secret){
  if (!state || typeof state !== 'string') return null;
  const dot = state.lastIndexOf('.');
  if (dot < 1) return null;
  const body = state.slice(0, dot), mac = state.slice(dot+1);
  const want = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  const a = Buffer.from(mac), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p;
  try{ p = JSON.parse(unb64url(body)); }catch(e){ return null; }
  if (!p || !p.u || !p.e || p.e < Math.floor(Date.now()/1000)) return null;
  return p.u;
}

/* ---------- identifying the VVV athlete ----------
   The caller's Supabase access token is verified against Supabase itself
   rather than decoded here, so a forged or expired JWT cannot get through and
   this server never needs the project's JWT secret. */
async function userIdFromRequest(req, cfg){
  const auth = req.headers['authorization'] || '';
  const token = /^Bearer\s+(.+)$/i.exec(auth);
  if (!token) return null;
  try{
    const r = await fetch(cfg.supabaseUrl + '/auth/v1/user', {
      headers: { 'Authorization': 'Bearer ' + token[1], 'apikey': cfg.serviceKey }
    });
    if (!r.ok) return null;
    const u = await r.json();
    return (u && u.id) || null;
  }catch(e){ return null; }
}

/* ---------- Supabase, service role ---------- */
function sb(cfg, path, opts){
  opts = opts || {};
  const headers = {
    'apikey': cfg.serviceKey,
    'Authorization': 'Bearer ' + cfg.serviceKey,
    'content-type': 'application/json'
  };
  if (opts.prefer) headers['Prefer'] = opts.prefer;
  return fetch(cfg.supabaseUrl + '/rest/v1' + path, {
    method: opts.method || 'GET', headers, body: opts.body
  });
}

async function getConnectionBy(cfg, column, value){
  const r = await sb(cfg, '/strava_connections?' + column + '=eq.' + encodeURIComponent(value) + '&limit=1');
  if (!r.ok) return null;
  const rows = await r.json();
  return (rows && rows[0]) || null;
}
const getConnection       = (cfg, uid)       => getConnectionBy(cfg, 'user_id', uid);
const getConnectionByAthlete = (cfg, athleteId) => getConnectionBy(cfg, 'strava_athlete_id', athleteId);

async function saveConnection(cfg, row){
  return sb(cfg, '/strava_connections', {
    method: 'POST', body: JSON.stringify(row),
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
}
async function deleteConnection(cfg, uid){
  return sb(cfg, '/strava_connections?user_id=eq.' + encodeURIComponent(uid), { method: 'DELETE' });
}

/* ---------- tokens ----------
   Refresh is server-side and unconditional once inside the skew window. A
   failed refresh is NEVER papered over by returning the dead token: the caller
   gets null and the connection is marked unusable, which is what stops a
   revoked authorization from displaying as "Connected" forever. */
const EXPIRY_SKEW_SEC = 120;

async function stravaTokenRequest(cfg, payload){
  const r = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(Object.assign({ client_id: cfg.clientId, client_secret: cfg.clientSecret }, payload))
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

async function exchangeCode(cfg, code){
  return stravaTokenRequest(cfg, { code, grant_type: 'authorization_code' });
}

// Returns a usable access token for the connection, refreshing first if the
// stored one is at or near expiry. Returns null when the authorization is no
// longer usable (revoked, refresh rejected) -- and clears it so status stops
// claiming a connection that cannot do any work.
async function accessTokenFor(cfg, conn){
  if (!conn) return null;
  const now = Math.floor(Date.now()/1000);
  if (conn.expires_at && conn.expires_at > now + EXPIRY_SKEW_SEC) return conn.access_token;
  if (!conn.refresh_token) return null;
  const res = await stravaTokenRequest(cfg, { refresh_token: conn.refresh_token, grant_type: 'refresh_token' });
  if (!res.ok || !res.data.access_token){
    // 400/401 from the refresh endpoint means the grant is gone for good.
    if (res.status === 400 || res.status === 401) await deleteConnection(cfg, conn.user_id);
    return null;
  }
  const fresh = {
    user_id: conn.user_id,
    strava_athlete_id: conn.strava_athlete_id,
    access_token: res.data.access_token,
    refresh_token: res.data.refresh_token || conn.refresh_token,
    expires_at: res.data.expires_at,
    scope: conn.scope,
    athlete_name: conn.athlete_name,
    updated_at: new Date().toISOString()
  };
  await saveConnection(cfg, fresh);
  return fresh.access_token;
}

async function stravaApi(path, token){
  const r = await fetch(STRAVA_API + path, { headers: { 'Authorization': 'Bearer ' + token } });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  return { ok: true, status: r.status, data: await r.json() };
}

/* ---------- the Strava -> VVV objective data contract ----------
   Only fields Strava actually supplies, mapped onto names VVV already
   declares in ACTUAL_IMPORTED_FIELDS. Anything Strava omits stays absent --
   never zero, never a guess. Nothing subjective is derived here: RPE, Feel,
   notes, soreness and perceived difficulty are athlete evidence and Strava
   has no opinion about them. */
function normaliseActivity(a){
  if (!a || a.id == null) return null;
  const type = a.sport_type || a.type || null;
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
  const dist = num(a.distance);
  const moving = num(a.moving_time);
  const out = {
    activityId: String(a.id),
    startLocal: (a.start_date_local || a.start_date || '').slice(0, 19) || null,
    date: (a.start_date_local || a.start_date || '').slice(0, 10) || null,
    activityType: type,
    isRun: type === 'Run' || type === 'TrailRun' || type === 'VirtualRun' || type === 'Treadmill',
    km: dist != null ? Math.round(dist / 100) / 10 : null,
    movingTimeSec: moving,
    elapsedTimeSec: num(a.elapsed_time),
    // Strava reports average_speed in m/s. Pace is derived from the two
    // primitives VVV trusts (distance + moving time) rather than from the
    // rounded average, so it agrees with the imported distance exactly.
    paceSecPerKm: (dist && moving) ? (moving / (dist / 1000)) : null,
    hr: a.has_heartrate && num(a.average_heartrate) != null ? Math.round(a.average_heartrate) : null,
    maxHR: a.has_heartrate && num(a.max_heartrate) != null ? Math.round(a.max_heartrate) : null,
    // Strava's average_cadence for a run is one leg: steps/min is twice it.
    cadence: num(a.average_cadence) != null ? Math.round(a.average_cadence * 2) : null,
    elevationGainM: num(a.total_elevation_gain) != null ? Math.round(a.total_elevation_gain) : null,
    trainer: !!a.trainer,
    manual: !!a.manual
  };
  return out;
}

async function stageActivity(cfg, userId, activity){
  return sb(cfg, '/strava_activities', {
    method: 'POST',
    body: JSON.stringify({
      user_id: userId,
      activity_id: activity.activityId,
      payload: activity,
      deleted: false,
      received_at: new Date().toISOString()
    }),
    // One row per (user, activity). A second arrival -- webhook after manual
    // sync, or an update event -- refreshes the payload in place instead of
    // adding a duplicate, and deliberately does NOT clear ingested_at.
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
}

function json(res, status, obj){
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.status(status).send(JSON.stringify(obj));
}

module.exports = {
  STRAVA_AUTHORIZE_URL, STRAVA_TOKEN_URL, STRAVA_DEAUTH_URL, STRAVA_API, STRAVA_SCOPE,
  config, siteOrigin, redirectUri, readBody,
  signState, verifyState, userIdFromRequest,
  sb, getConnection, getConnectionByAthlete, saveConnection, deleteConnection,
  exchangeCode, accessTokenFor, stravaApi, stravaTokenRequest,
  normaliseActivity, stageActivity, json
};
