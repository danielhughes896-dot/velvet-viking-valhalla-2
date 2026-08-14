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

// Deliberately regex-based rather than `new URL()`. These run on every auth
// call and must never throw, whatever a misconfigured value looks like, so
// there is no dependency on a URL implementation being present or on the input
// being parseable at all.
function projectOrigin(u){
  if (!u) return '';
  const m = /^(https?:\/\/[^\/?#]+)/i.exec(String(u).trim());
  return m ? m[1] : String(u).trim().replace(/\/+$/, '');
}
function hostOf(u){
  const m = /^(?:https?:\/\/)?([^\/?#]+)/i.exec(String(u || '').trim());
  return m ? m[1].toLowerCase() : '';
}

/* Read the `iss` claim out of a Supabase JWT WITHOUT verifying it.
   This is used for diagnostics only and never for authorization: a token is
   still only trusted after Supabase itself confirms it. The point is to catch
   the one misconfiguration that is otherwise invisible -- a token minted by
   project A being checked against project B, which returns a plain 401 and is
   indistinguishable from an expired session. The issuer is deliberately never
   followed; doing so would let a caller aim verification at a project they
   control. */
function jwtIssuerHost(token){
  try{
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const json = Buffer.from(parts[1].replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8');
    const claims = JSON.parse(json);
    return claims && claims.iss ? hostOf(claims.iss) : null;
  }catch(e){ return null; }
}

function config(){
  return {
    clientId:     env('STRAVA_CLIENT_ID'),
    clientSecret: env('STRAVA_CLIENT_SECRET'),
    verifyToken:  env('STRAVA_WEBHOOK_VERIFY_TOKEN'),
    // Only the ORIGIN is ever used. The Supabase dashboard shows a REST URL
    // ending in /rest/v1, and pasting that into SUPABASE_URL would send every
    // auth call to /rest/v1/auth/v1/user -- a 404 that looks nothing like the
    // real problem. Normalising here makes that class of misconfiguration
    // harmless instead of mysterious.
    supabaseUrl:  projectOrigin(env('SUPABASE_URL')) || 'https://eqiydxissphygnycpouu.supabase.co',
    serviceKey:   env('SUPABASE_SERVICE_ROLE_KEY'),
    // The publishable key, which is public by design and is the same value the
    // app ships. Used ONLY as the apikey header when verifying a user's own
    // JWT: that is the call the app itself makes, so identity resolves through
    // exactly the path the token was minted for. The service-role key stays for
    // data access, where it belongs.
    anonKey:      env('SUPABASE_ANON_KEY') || 'sb_publishable_PLiExuCqvMmjYwal4DtFQA_m4eZuCd-'
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
/* Returns { uid, code, diag } or { code, diag }.

   `code` is a short, safe classification the owner can read off the screen and
   correlate with the server log:

     AUTH_HEADER_MISSING    no Authorization header arrived at the function
     AUTH_JWT_MALFORMED     the bearer value is not a three-part JWT
     AUTH_PROJECT_MISMATCH  the token was minted by a different Supabase project
                            than this server verifies against
     AUTH_ANON_KEY_REJECTED Supabase refused the apikey, not the user's token
     AUTH_VERIFY_401/403    Supabase rejected the token itself
     AUTH_VERIFY_404        the auth endpoint is not where we are looking
     AUTH_UNAVAILABLE       Supabase could not be reached, or returned 5xx
     AUTH_OK                verified

   `diag` carries facts, never values: booleans, a hostname and an HTTP status.
   No token, key, id or email is in it, so it is safe to log and safe to show. */
async function verifyUser(req, cfg){
  const diag = {
    authHeader: false, jwtShape: false,
    project: hostOf(cfg.supabaseUrl),
    anonKey: !!cfg.anonKey,
    status: null, tokenIssuer: null
  };
  const auth = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return { code: 'AUTH_HEADER_MISSING', diag };
  diag.authHeader = true;

  const token = m[1].trim();
  const parts = token.split('.');
  diag.jwtShape = parts.length === 3;
  if (!diag.jwtShape) return { code: 'AUTH_JWT_MALFORMED', diag };

  // Diagnostic only -- see jwtIssuerHost. Authorization still comes from
  // Supabase's own answer below, never from these claims.
  diag.tokenIssuer = jwtIssuerHost(token);
  if (diag.tokenIssuer && diag.project && diag.tokenIssuer !== diag.project)
    return { code: 'AUTH_PROJECT_MISMATCH', diag };

  let r;
  try{
    r = await fetch(cfg.supabaseUrl + '/auth/v1/user', {
      headers: { 'Authorization': 'Bearer ' + token, 'apikey': cfg.anonKey }
    });
  }catch(e){ return { code: 'AUTH_UNAVAILABLE', diag }; }
  diag.status = r.status;

  if (r.status === 404) return { code: 'AUTH_VERIFY_404', diag };
  if (r.status === 401 || r.status === 403){
    // GoTrue says "Invalid API key" for a bad apikey and "invalid JWT ..." for
    // a bad token. Matched as a pattern so the two are distinguishable; the
    // message itself is never returned or logged.
    let why = '';
    try{ const b = await r.json(); why = String((b && (b.message || b.msg || b.error_description)) || ''); }catch(e){}
    if (/api\s*key/i.test(why)) return { code: 'AUTH_ANON_KEY_REJECTED', diag };
    return { code: r.status === 403 ? 'AUTH_VERIFY_403' : 'AUTH_VERIFY_401', diag };
  }
  if (!r.ok) return { code: 'AUTH_UNAVAILABLE', diag };

  let u;
  try{ u = await r.json(); }catch(e){ return { code: 'AUTH_UNAVAILABLE', diag }; }
  if (!u || !u.id) return { code: 'AUTH_VERIFY_401', diag };
  return { uid: u.id, code: 'AUTH_OK', diag };
}

// One line, facts only: booleans, a hostname, an HTTP status and a code.
function diagLine(code, diag){
  return code +
    ' authHeader=' + (diag.authHeader ? 'yes' : 'no') +
    ' jwtShape=' + (diag.jwtShape ? 'yes' : 'no') +
    ' project=' + (diag.project || 'unset') +
    ' tokenIssuer=' + (diag.tokenIssuer || 'unknown') +
    ' anonKey=' + (diag.anonKey ? 'configured' : 'missing') +
    ' userStatus=' + (diag.status == null ? 'none' : diag.status);
}

// The long-standing shape the other endpoints use, unchanged in behaviour:
// a user id or null.
async function userIdFromRequest(req, cfg){
  const v = await verifyUser(req, cfg);
  return v.uid || null;
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
  signState, verifyState, userIdFromRequest, verifyUser, diagLine,
  projectOrigin, hostOf, jwtIssuerHost,
  sb, getConnection, getConnectionByAthlete, saveConnection, deleteConnection,
  exchangeCode, accessTokenFor, stravaApi, stravaTokenRequest,
  normaliseActivity, stageActivity, json
};
