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
const HC = require('./_health-consent.js');

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

/* ---------- the canonical Supabase project ----------
   Velvet Viking has exactly one Supabase project, and the app has it
   hardcoded. The server must use the SAME one or nothing lines up: access
   tokens minted by the app are rejected, and strava_connections /
   strava_activities are read and written in a database that does not have
   those tables.

   That is not hypothetical. A Vercel Supabase integration attached to this
   deployment injects SUPABASE_URL, SUPABASE_ANON_KEY and
   SUPABASE_SERVICE_ROLE_KEY for a DIFFERENT project, and those values are
   integration-managed -- they cannot simply be edited or removed in the
   environment variables UI. Reading them silently repointed the entire server
   half of the Strava integration at an unrelated database.

   So the project is pinned here instead of taken from the environment. An
   override is still possible, but only through VVV_-namespaced names that no
   integration writes, so this cannot be captured by accident again. */
const VVV_SUPABASE_URL      = 'https://eqiydxissphygnycpouu.supabase.co';
const VVV_SUPABASE_REF      = 'eqiydxissphygnycpouu';
const VVV_SUPABASE_ANON_KEY = 'sb_publishable_PLiExuCqvMmjYwal4DtFQA_m4eZuCd-';

// Deliberately regex-based rather than `new URL()`. These run on every auth
// call and must never throw, whatever a misconfigured value looks like.
function projectOrigin(u){
  if (!u) return '';
  const m = /^(https?:\/\/[^\/?#]+)/i.exec(String(u).trim());
  return m ? m[1] : String(u).trim().replace(/\/+$/, '');
}
function hostOf(u){
  const m = /^(?:https?:\/\/)?([^\/?#]+)/i.exec(String(u || '').trim());
  return m ? m[1].toLowerCase() : '';
}
function projectRef(u){
  const m = /^([a-z0-9]+)\.supabase\./i.exec(hostOf(u));
  return m ? m[1].toLowerCase() : '';
}

/* Decode a JWT payload WITHOUT verifying it. Used only to read which project a
   token or key belongs to, never as proof of identity or authority. */
function jwtClaims(token){
  try{
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1].replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8'));
  }catch(e){ return null; }
}
function jwtIssuerHost(token){
  const c = jwtClaims(token);
  return c && c.iss ? hostOf(c.iss) : null;
}
/* Legacy Supabase keys are JWTs carrying a `ref` claim naming their project.
   The newer sb_secret_... format is opaque, so the honest answer is null. */
function serviceKeyRef(key){
  const c = jwtClaims(key);
  return (c && typeof c.ref === 'string') ? c.ref.toLowerCase() : null;
}

/* The service-role key is the dangerous one: with another project's key the
   server reads and writes a database that is not ours. It is therefore accepted
   only when explicitly namespaced for VVV, or when it provably belongs to the
   canonical project. An integration-injected key for a different project is
   refused rather than used, and the reason is recorded. */
function resolveServiceKey(){
  const own = env('VVV_SUPABASE_SERVICE_ROLE_KEY');
  if (own) return { key: own, source: 'vvv_namespaced' };
  const injected = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!injected) return { key: '', source: 'absent' };
  const ref = serviceKeyRef(injected);
  if (ref === VVV_SUPABASE_REF) return { key: injected, source: 'env_verified' };
  if (ref) return { key: '', source: 'foreign_project' };
  // Opaque key that cannot be attributed to a project. Refusing is the safe
  // answer -- using a key that might belong to another project is exactly how
  // data ends up in the wrong database.
  return { key: '', source: 'unattributable' };
}

/* ---------- the private-beta availability switch ----------
   Strava is a product requirement and the integration below is intact. What
   this controls is whether it may RUN, while written clarification is sought
   from Strava for the external beta.

   Deliberately its own explicit flag, and deliberately NOT "are the credentials
   set". Unsetting STRAVA_CLIENT_ID would make these endpoints 503 while the
   athlete still saw a Connect button and a broken feature, and it would conflate
   "switched off on purpose" with "misconfigured" in every log line.

   Default OFF. An unset variable is the beta state, so the gate cannot be left
   open by forgetting to close it; turning Strava back on is one environment
   variable and a redeploy, with no source change anywhere.

   Accepts the obvious spellings so a redeploy is not lost to "true" vs "on". */
function stravaEnabled(){
  return /^(on|true|1|yes|enabled)$/i.test(String(env('VVV_STRAVA_ENABLED')).trim());
}

/* =========================================================
   THE PRIVATE BETA, AND WHAT ACTUALLY LIMITS IT

   WHAT CHANGED. This was founder-only: one hard-coded account id, supplied as
   VVV_STRAVA_ALLOWED_USER_IDS, was the single thing permitted to touch Strava
   while a policy question was open. Clarification was requested from Strava and
   their intended use disclosed; Strava declined to give individual feedback and
   referred Valhalla back to the published API Agreement and API Policy. That is
   NEITHER approval NOR rejection, and STRAVA-BETA-STATUS.md records it as
   exactly that. On the strength of it the founder authorised the integration
   for the private beta already available to this application.

   SO ELIGIBILITY IS NO LONGER A LIST. Any athlete with a verified Valhalla
   account may connect Strava. That is not "public": Valhalla accounts are
   themselves a closed beta, so the account IS the first gate, and the seat
   count below is the second.

   WHY A SEAT COUNT AND NOT A CLAIM ABOUT STRAVA. Valhalla cannot see how many
   athletes Strava believes this application has, and must not pretend to.
   What it CAN count exactly is its own roster -- the rows in
   strava_connections, a table it owns. That is what is capped here. Strava
   remains authoritative for its own limit, and a refusal from Strava is handled
   on its own terms at the callback; this cap simply stops Valhalla walking an
   athlete into an authorisation it already knows it has no room for.

   IT FAILS CLOSED, AND ONLY IN ONE DIRECTION. If the roster cannot be counted,
   no NEW connection is allowed -- an unprovable seat is not a free one. An
   athlete who already holds a connection is never affected by any of this:
   they are not counted against admission, not re-checked, and not disconnected.
   Reaching the cap must never disturb the athletes already inside it.
   ========================================================= */

/* Ten, unless the deployment says otherwise. Kept configurable because the
   number belongs to whatever capacity the application currently has, and that
   is not a fact about this source file. A malformed or absent value takes the
   default rather than removing the limit -- there is deliberately no value
   meaning "unlimited", for the same reason the old allowlist had no wildcard:
   a typo in a dashboard field must never be indistinguishable from a decision. */
const STRAVA_BETA_SEATS_DEFAULT = 10;
function stravaBetaSeats(){
  const raw = String(env('VVV_STRAVA_MAX_ATHLETES') || '').trim();
  const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
  return (Number.isFinite(n) && n > 0) ? n : STRAVA_BETA_SEATS_DEFAULT;
}

/* How many athletes this deployment currently has connected. Returns null when
   the count cannot be established, which callers must treat as "no room" --
   never as zero. */
async function stravaSeatsTaken(cfg){
  try{
    const r = await sb(cfg, '/strava_connections?select=user_id', { prefer: 'count=exact' });
    if (!r.ok) return null;
    /* PostgREST reports the total in content-range as "0-9/10"; the part after
       the slash is the count, and "*" means it declined to compute one. */
    const range = String((r.headers && r.headers.get && r.headers.get('content-range')) || '');
    const total = range.split('/')[1];
    if (!total || !/^\d+$/.test(total)) return null;
    return parseInt(total, 10);
  }catch(e){ return null; }
}

/* MAY THIS ATHLETE HOLD A STRAVA CONNECTION. One call, so no route can satisfy
   the deployment flag and forget the roster.

   Returns { ok, reason } rather than a boolean: "no, the beta is full" and
   "no, Strava is switched off here" are different things to say to an athlete,
   and a caller that cannot tell them apart will say the wrong one. */
async function stravaMayConnect(cfg, uid){
  if (!stravaEnabled()) return { ok: false, reason: 'strava_disabled' };
  if (!uid)             return { ok: false, reason: 'signin' };

  /* AN EXISTING CONNECTION ALWAYS WINS, and is checked first so that a
     reconnect, a token refresh or a re-authorisation can never be turned away
     by a full roster the athlete is already part of. */
  const existing = await getConnection(cfg, uid);
  if (existing) return { ok: true, reason: 'existing' };

  const taken = await stravaSeatsTaken(cfg);
  if (taken === null) return { ok: false, reason: 'capacity_unknown' };
  return taken < stravaBetaSeats()
    ? { ok: true, reason: 'seat_available' }
    : { ok: false, reason: 'beta_full' };
}

/* Does this athlete already hold a connection -- the question every route that
   only READS or DELETES needs, and the one that must never consult the cap.
   Sync, disconnect and webhook delivery for an athlete already inside the beta
   are unaffected by how full it is. */
async function stravaHasConnection(cfg, uid){
  if (!stravaEnabled() || !uid) return false;
  return !!(await getConnection(cfg, uid));
}

/* THE DEPLOYMENT-LEVEL QUESTION, unchanged in meaning: is Strava commissioned
   on this deployment at all. It is no longer per-athlete, because eligibility
   no longer is. */
function stravaPermitted(uid){ return stravaEnabled() && !!uid; }

function config(){
  const svc = resolveServiceKey();
  return {
    clientId:     env('STRAVA_CLIENT_ID'),
    clientSecret: env('STRAVA_CLIENT_SECRET'),
    verifyToken:  env('STRAVA_WEBHOOK_VERIFY_TOKEN'),
    stravaEnabled: stravaEnabled(),
    // SUPABASE_URL and SUPABASE_ANON_KEY are deliberately NOT read: those are
    // precisely the names a Vercel Supabase integration claims. Only a
    // VVV_-namespaced override can move the project.
    supabaseUrl:  projectOrigin(env('VVV_SUPABASE_URL')) || VVV_SUPABASE_URL,
    anonKey:      env('VVV_SUPABASE_ANON_KEY') || VVV_SUPABASE_ANON_KEY,
    serviceKey:   svc.key,
    serviceKeySource: svc.source
  };
}

/* WHERE THIS DEPLOYMENT THINKS IT LIVES.

   Derived from the forwarded Host, which is what makes previews, the apex
   domain and localhost all work without configuration -- and which is also a
   value that arrives in a request header. Three call sites consume it and one
   of them matters: _account-delete.js forwards the athlete's own Supabase
   access token to `siteOrigin(req) + '/api/strava-auth'`, so an origin taken
   from a header is, in principle, an origin an attacker could name.

   Whether a spoofed Host can actually reach a Vercel function is a property of
   Vercel's edge routing that cannot be established from this repository, so
   this is not a claim that the hole is reachable. It is the cheap way to stop
   depending on the answer: set VVV_SITE_ORIGIN and the value is pinned, with
   no header consulted at all. Unset -- which is the state today -- behaves
   exactly as it always has, so this changes nothing until it is configured. */
function siteOrigin(req){
  const pinned = String(process.env.VVV_SITE_ORIGIN || '').trim().replace(/\/+$/, '');
  if (pinned) return pinned;
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
    serviceKeySource: cfg.serviceKeySource,
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
  /* The address comes back too, and three callers already asked for it:
     _account-data.js puts it in the athlete's export, and session.js and
     _subscription.js render it on the account card. None of them ever got it,
     because this function returned only the uid -- so `who.email` was
     undefined at every one of those sites and the export has always said
     "email": null. That is a data-export completeness defect, not a display
     nicety: an export that omits the identifier the account is keyed on is not
     the whole of what is held.

     It is returned, never logged. diagLine() below carries booleans, a
     hostname and a status code, and nothing here changes that. */
  return { uid: u.id, email: (typeof u.email === 'string' && u.email) ? u.email : null,
           code: 'AUTH_OK', diag };
}

// One line, facts only: booleans, a hostname, an HTTP status and a code.
function diagLine(code, diag){
  return code +
    ' authHeader=' + (diag.authHeader ? 'yes' : 'no') +
    ' jwtShape=' + (diag.jwtShape ? 'yes' : 'no') +
    ' project=' + (diag.project || 'unset') +
    ' tokenIssuer=' + (diag.tokenIssuer || 'unknown') +
    ' anonKey=' + (diag.anonKey ? 'configured' : 'missing') +
    ' userStatus=' + (diag.status == null ? 'none' : diag.status) +
    (diag.serviceKeySource ? ' serviceKey=' + diag.serviceKeySource : '');
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

/* Every staged activity VVV holds for this athlete. Deleting the connection
   alone used to leave these rows behind indefinitely -- the tokens went, the
   Strava-derived payloads stayed -- which is neither what "disconnect" means to
   an athlete nor defensible under Strava's retention restrictions.

   This clears the SERVER-side store only. Objective values already logged into
   the athlete's own training history are their record of their own run and are
   deliberately not touched here; that boundary is a product decision, not an
   accident, and is documented in the audit. */
async function deleteStagedActivities(cfg, uid){
  return sb(cfg, '/strava_activities?user_id=eq.' + encodeURIComponent(uid), { method: 'DELETE' });
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
  /* Zero is not a measurement. Strava creates the activity record and fires
     the `create` webhook BEFORE the uploaded file is processed, so a device
     upload is routinely readable for a few seconds with distance 0 and moving
     time 0 -- an `update` event follows once the real numbers exist. Recording
     that as a genuine 0 would be inventing a measurement out of its absence,
     and a 0km run would then be offered to the matcher as evidence.

     Distance, times, cadence and heart rate are therefore absent when zero.
     Elevation gain is NOT: a flat run really does climb 0m, and treating that
     as missing would throw away a true reading. */
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
  const pos = v => (typeof v === 'number' && isFinite(v) && v > 0) ? v : null;
  const dist = pos(a.distance);
  const moving = pos(a.moving_time);
  const out = {
    activityId: String(a.id),
    startLocal: (a.start_date_local || a.start_date || '').slice(0, 19) || null,
    date: (a.start_date_local || a.start_date || '').slice(0, 10) || null,
    activityType: type,
    isRun: type === 'Run' || type === 'TrailRun' || type === 'VirtualRun' || type === 'Treadmill',
    km: dist != null ? Math.round(dist / 100) / 10 : null,
    movingTimeSec: moving,
    elapsedTimeSec: pos(a.elapsed_time),
    // Strava reports average_speed in m/s. Pace is derived from the two
    // primitives VVV trusts (distance + moving time) rather than from the
    // rounded average, so it agrees with the imported distance exactly.
    paceSecPerKm: (dist && moving) ? (moving / (dist / 1000)) : null,
    hr: a.has_heartrate && pos(a.average_heartrate) != null ? Math.round(a.average_heartrate) : null,
    maxHR: a.has_heartrate && pos(a.max_heartrate) != null ? Math.round(a.max_heartrate) : null,
    // Strava's average_cadence for a run is one leg: steps/min is twice it.
    cadence: pos(a.average_cadence) != null ? Math.round(a.average_cadence * 2) : null,
    elevationGainM: num(a.total_elevation_gain) != null ? Math.round(a.total_elevation_gain) : null,
    trainer: !!a.trainer,
    manual: !!a.manual
  };
  /* PER-KILOMETRE SPLITS, when Strava gave us any.
   *
   * WHY THESE AND NOT STREAMS. coachSplitMetrics() is the only consumer, it
   * needs four or more paced entries, and what it computes from them is how
   * evenly the session was run: consistency, fade, and whether the second half
   * was faster than the first. splits_metric is exactly that -- one entry per
   * kilometre, already aggregated -- so a stream would be a much larger
   * request for data that would have to be reduced back down to this.
   *
   * FREE ON THE PATH THAT MATTERS. The webhook already reads
   * /activities/{id}, so this costs no additional request for the real-time
   * route every imported run normally arrives by. The list endpoint the
   * manual backfill uses does not return splits, so a backfilled run simply
   * has none and coachSplitMetrics() returns null -- which is what it already
   * did for every Strava run before this existed.
   *
   * FLAT, WITH NO segId, AND THAT IS CORRECT. These are Strava's kilometre
   * markers, not Valhalla's prescribed segments; splitsAreLegacyFlat() already
   * keeps such a log on the flat editor rather than rebuilding it as segments,
   * which would be guessing which kilometre was which rep.
   *
   * The per-split heart rate is covered data and is removed for an athlete who
   * has not consented -- at the boundary, in _health-consent.js, not here. */
  const laps = Array.isArray(a.splits_metric) ? a.splits_metric : null;
  if (laps && laps.length){
    const rows = laps.map(function(sp){
      if (!sp) return null;
      const km = pos(sp.distance) != null ? Math.round(sp.distance / 10) / 100 : null;
      const sec = pos(sp.moving_time) != null ? sp.moving_time : pos(sp.elapsed_time);
      if (km == null || sec == null) return null;
      return {
        km: km,
        sec: sec,
        paceSec: Math.round(sec / km),
        hr: pos(sp.average_heartrate) != null ? Math.round(sp.average_heartrate) : null
      };
    }).filter(Boolean);
    if (rows.length) out.splits = rows;
  }
  /* THE DEVICE'S OWN LAPS, which are NOT the kilometre markers above.
   *
   * WHAT THEY ARE. /activities/{id} returns a `laps` array alongside
   * splits_metric, and it is the watch's own lap list -- for a structured
   * workout run on a Garmin, one entry per lap the watch took, which is where
   * the athlete's actual reps and recoveries live. A prescribed
   * 500/1000/1500/1000/500 ladder arrives here as real 500m and 1000m entries
   * at rep pace with slower entries between them, instead of ten identical
   * kilometres that average the recoveries into the work.
   *
   * WHAT THEY ARE NOT, AND THIS IS THE WHOLE CARE OF IT. Strava's Lap object
   * carries NO work/recovery/warm-up/cool-down classification -- no step type,
   * no intensity, nothing that says which lap was a rep. Distance, time, heart
   * rate and cadence are all it has. So these rows are stored as what they
   * are, RECORDED laps, and nothing here labels one a rep or matches it to a
   * prescribed segment: that would be reading Valhalla's prescription back
   * onto the athlete's watch and calling it evidence. A lap boundary is not
   * reliably a workout-step boundary either -- a single prescribed 1500m rep
   * can arrive as a 1000m lap followed by a 500m lap -- which is exactly why
   * the classification has to come from a source that has it, not from us.
   *
   * FREE, ON THE PATH THAT MATTERS, for the same reason splits_metric is: the
   * webhook already reads the detailed activity. The list endpoint the manual
   * backfill uses returns neither, so a backfilled run simply has no laps.
   *
   * KEPT SEPARATE FROM `splits` DELIBERATELY. coachSplitMetrics() reads
   * `splits` and its consistency/fade arithmetic assumes comparable kilometre
   * rows; handing it laps of 500m, 1000m and 400m would change what it
   * measures. Two different observations, two different fields.
   *
   * Per-lap heart rate is covered data and is removed for an athlete who has
   * not consented -- at the boundary, in _health-consent.js, not here. */
  const devLaps = Array.isArray(a.laps) ? a.laps : null;
  if (devLaps && devLaps.length){
    const lapRows = devLaps.map(function(lp){
      if (!lp) return null;
      const km = pos(lp.distance) != null ? Math.round(lp.distance / 10) / 100 : null;
      const sec = pos(lp.moving_time) != null ? lp.moving_time : pos(lp.elapsed_time);
      if (km == null || sec == null) return null;
      const row = {
        km: km,
        sec: sec,
        paceSec: Math.round(sec / km),
        hr: pos(lp.average_heartrate) != null ? Math.round(lp.average_heartrate) : null
      };
      // Same one-leg-to-two-legs correction the summary cadence gets.
      const cad = pos(lp.average_cadence);
      if (cad != null) row.cadence = Math.round(cad * 2);
      /* Elapsed carries information moving time does not: a lap whose elapsed
         far exceeds its moving time contains a standing recovery. Recorded,
         never interpreted here. */
      if (pos(lp.elapsed_time) != null && lp.elapsed_time !== sec) row.elapsedSec = lp.elapsed_time;
      return row;
    }).filter(Boolean);
    if (lapRows.length){
      out.deviceLaps = lapRows;
      /* PROVENANCE AS A FIELD, NOT AS A SHAPE. Downstream must never have to
         guess what it is looking at by measuring how even the rows are. */
      out.deviceLapSource = 'strava';
    }
  }
  return out;
}

/* An activity is only training evidence once it has a sport, a local date and
   a real distance. Anything short of that cannot populate a workout, cannot be
   scored and cannot be judged by the matcher, so it is not staged at all --
   the `update` event that follows a device upload stages it properly. */
function isUsableRun(a){ return !!(a && a.isRun && a.date && a.km != null && a.km > 0); }

async function stageActivity(cfg, userId, activity){
  /* THE HEALTH BOUNDARY, ENFORCED WHERE THE ROW IS WRITTEN. Authorising Strava
     is permission to read the athlete's activities; it is not their explicit
     agreement to Valhalla processing the health-indicating part of them. Both
     ingest paths -- the manual sync and the webhook -- land here, so stripping
     the heart rate at this one point means an athlete who has not consented
     never has it stored, rather than having it stored and then ignored.
     Fails closed on an unreadable consent table: see api/_health-consent.js. */
  const staged = await HC.forIngest(cfg, sb, userId, activity);
  return sb(cfg, '/strava_activities', {
    method: 'POST',
    body: JSON.stringify({
      user_id: userId,
      activity_id: staged.activityId,
      payload: staged,
      deleted: false,
      received_at: new Date().toISOString()
    }),
    // One row per (user, activity). A second arrival -- webhook after manual
    // sync, or an update event -- refreshes the payload in place instead of
    // adding a duplicate, and deliberately does NOT clear ingested_at.
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
}

/* Value-free operational logging, shared by every endpoint.

   These lines exist so a REAL delivery can be verified after the fact: without
   them a live webhook that silently does nothing is indistinguishable from one
   that never arrived. They record what happened and to what, never who or with
   what credential -- no JWT, refresh token, access token, service-role key,
   anon key, client secret, webhook verify token, Supabase user id or email.
   Strava activity ids ARE included, because they are the only way to correlate
   a log line with the athlete's own Strava feed, and they are the athlete's own
   data in the athlete's own deployment logs. */
function log(scope, what){ try{ console.log('strava-' + scope + ': ' + what); }catch(e){} }

function json(res, status, obj){
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.status(status).send(JSON.stringify(obj));
}

module.exports = {
  stravaPermitted, stravaBetaSeats, stravaSeatsTaken,
  stravaMayConnect, stravaHasConnection,
  STRAVA_AUTHORIZE_URL, STRAVA_TOKEN_URL, STRAVA_DEAUTH_URL, STRAVA_API, STRAVA_SCOPE,
  config, stravaEnabled, siteOrigin, redirectUri, readBody,
  signState, verifyState, userIdFromRequest, verifyUser, diagLine,
  projectOrigin, hostOf, projectRef, jwtIssuerHost, serviceKeyRef, resolveServiceKey,
  VVV_SUPABASE_URL, VVV_SUPABASE_REF,
  sb, getConnection, getConnectionByAthlete, saveConnection, deleteConnection,
  deleteStagedActivities,
  exchangeCode, accessTokenFor, stravaApi, stravaTokenRequest,
  normaliseActivity, isUsableRun, stageActivity, json, log
};
