'use strict';
// Velvet Viking -- Coach Memory, the stored half.
//
//   GET  /api/coach-memory                         read: every kept line, and
//                                                  the few that go to the coach
//   POST /api/coach-memory {action:'record', ...}  keep one line
//   POST /api/coach-memory {action:'clear'}        forget every line
//
//   Authorization: Bearer <supabase access token>, always.
//
// Founder-approved wording, on the consent sheet: "Each note is one line, kept
// in your SACORO account and seen only by you and your coach ... You can read
// or clear the notes here at any time, and they're deleted with your account."
//
// THE ONLY FILE THAT TOUCHES public.coach_memory, and it does so with the
// service key, scoped to a uid that comes from a verified token and from
// nowhere else -- the same shape as _account-data.js. There is no user_id
// parameter. The voice routes that read memory into a model packet hold no
// database access at all: the browser fetches the packet here and sends it
// with the question, and _voice-ask.js re-checks every line through the pure
// rules in _coach-memory-lines.js before anything is sent.
//
// WHY CLEARING IS HERE AND NOT A BROWSER DELETE. The table has no client write
// policy of any kind (supabase-coach-memory.sql), so every row in it is one
// the server built and checked. One door to prove instead of two, and the same
// clearForUser() is what account deletion calls.
//
// FAIL CLOSED, AND HARMLESSLY. Coach Memory is part of the voice coach, which
// is switched off in production (VVV_VOICE_ENABLED). With it off, a write is a
// no-op that never touches the database. A missing table -- a deployment that
// has not run the migration yet -- reads as "nothing kept" and a write as
// "not kept", both with 200, because a note that could not be kept must never
// cost the athlete their answer. Reading and clearing still work with the
// voice coach off: notes already kept are the athlete's to read and remove
// whatever the deployment's switches say.

const S = require('./_strava.js');
const V = require('./_voice.js');
const H = require('./_health-consent.js');
const L = require('./_coach-memory-lines.js');

const TABLE = '/coach_memory';
const LIST_LIMIT = 100;

/* Value-free, like every other log line in api/: what happened, never which
   athlete or what the line said. A question can carry health information. */
function log(what){ try{ console.log('coach-memory: ' + what); }catch(e){} }

/* PostgREST answers a missing relation with 404. That is a deployment that
   has not applied supabase-coach-memory.sql yet, not an outage. */
function absent(r){ return !!(r && r.status === 404); }

async function listForUser(Sx, cfg, uid, opts){
  const o = opts || {};
  if (!uid) return { ok: false, absent: false, rows: [] };
  let r;
  try{
    r = await Sx.sb(cfg, TABLE + '?select=id,day,kind,line,health,created_at&user_id=eq.' +
      encodeURIComponent(uid) + '&order=created_at.desc,id.desc&limit=' + (o.limit || LIST_LIMIT));
  }catch(e){ return { ok: false, absent: false, rows: [] }; }
  if (absent(r)) return { ok: true, absent: true, rows: [] };
  if (!r || !r.ok) return { ok: false, absent: false, rows: [] };
  const rows = await r.json().catch(function(){ return null; });
  return { ok: Array.isArray(rows), absent: false, rows: Array.isArray(rows) ? rows : [] };
}

/* Every line, or only the health ones. Returns how many went. */
async function clearForUser(Sx, cfg, uid, opts){
  const o = opts || {};
  if (!uid) return { ok: false, cleared: 0 };
  let r;
  try{
    r = await Sx.sb(cfg, TABLE + '?user_id=eq.' + encodeURIComponent(uid) +
      (o.healthOnly ? '&health=is.true' : '') + '&select=id',
      { method: 'DELETE', prefer: 'return=representation' });
  }catch(e){ return { ok: false, cleared: 0 }; }
  if (absent(r)) return { ok: true, absent: true, cleared: 0 };
  if (!r || !r.ok) return { ok: false, cleared: 0 };
  const rows = await r.json().catch(function(){ return null; });
  return { ok: true, cleared: Array.isArray(rows) ? rows.length : 0 };
}

/* FOR AN ERASURE REQUEST. Lines marked health, and any line the health rule
   recognises even if it was not marked when it was kept -- the rule may have
   grown since. Everything else the athlete chose to keep stays. Dry run by
   default, like the erasure it belongs to. */
async function eraseHealthLines(Sx, cfg, uid, opts){
  const o = opts || {};
  const dryRun = o.dryRun !== false;
  const list = await listForUser(Sx, cfg, uid, { limit: 1000 });
  if (!list.ok) return { ok: false, reason: 'memory_read_failed' };
  if (list.absent) return { ok: true, examined: 0, removed: 0, absent: true };
  const covered = list.rows.filter(function(r){ return r.health === true || L.isHealthLine(r.line); });
  if (!dryRun && covered.length){
    const ids = covered.map(function(r){ return Number(r.id); }).filter(Number.isFinite);
    const w = await Sx.sb(cfg, TABLE + '?user_id=eq.' + encodeURIComponent(uid) +
      '&id=in.(' + ids.join(',') + ')', { method: 'DELETE', prefer: 'return=minimal' });
    if (!w || !w.ok) return { ok: false, reason: 'memory_write_failed' };
  }
  return { ok: true, examined: list.rows.length, removed: covered.length };
}

/* What the export and the Settings list show: the athlete's own words and
   choices, without the internal id. */
function publicRow(r){
  return { day: r.day || null, kind: r.kind, line: r.line, created_at: r.created_at || null };
}

/* The packet the coach is given. Health lines only while health consent is
   in force on the SERVER's record -- a consent withdrawn after a line was kept
   stops that line being used, and leaves it for the athlete to read or clear. */
async function packetFor(Sx, cfg, uid, rows){
  if (!V.voiceEnabled()) return [];
  let usable = rows;
  if (rows.some(function(r){ return r.health === true || L.isHealthLine(r.line); })){
    const granted = await H.isGranted(cfg, Sx.sb, uid);
    if (!granted) usable = rows.filter(function(r){ return r.health !== true && !L.isHealthLine(r.line); });
  }
  return L.selectForPacket(usable);
}

/* The day a line is kept against: the athlete's own date if it is within a
   day of the server's (a phone in another time zone is not lying), otherwise
   the server's. */
function dayFor(body){
  const today = new Date().toISOString().slice(0, 10);
  const d = String((body && body.day) || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return today;
  const diff = Math.abs(Date.parse(d + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z'));
  return (Number.isFinite(diff) && diff <= 86400000) ? d : today;
}

async function handle(req, res, deps){
  const D = deps || {};
  const Sx = D.S || S;
  if (req.method !== 'GET' && req.method !== 'POST'){
    res.setHeader('Allow', 'GET, POST');
    return Sx.json(res, 405, { error: 'method_not_allowed' });
  }
  const cfg = (D.config || Sx.config)();

  /* A KNOWN ATHLETE FIRST, whatever else is true. Nothing below is reachable
     without a verified token, including the no-op answers. */
  const who = await Sx.verifyUser(req, cfg);
  if (!who || !who.uid){
    log('REJECTED ' + ((who && who.code) || 'no_user'));
    return Sx.json(res, 401, { error: 'not_authenticated', code: (who && who.code) || 'AUTH_UNKNOWN' });
  }
  if (!cfg.serviceKey){
    log('UNAVAILABLE no_service_key');
    return req.method === 'GET'
      ? Sx.json(res, 200, { available: false, lines: [], packet: [] })
      : Sx.json(res, 200, { stored: false, cleared: 0, reason: 'unavailable' });
  }

  if (req.method === 'GET'){
    const list = await listForUser(Sx, cfg, who.uid);
    if (list.absent) return Sx.json(res, 200, { available: false, lines: [], packet: [] });
    if (!list.ok){ log('READ_FAILED'); return Sx.json(res, 503, { error: 'unavailable' }); }
    const packet = await packetFor(Sx, cfg, who.uid, list.rows);
    return Sx.json(res, 200, { available: true, lines: list.rows.map(publicRow), packet: packet });
  }

  const body = Sx.readBody(req) || {};
  if (body.action === 'clear'){
    const c = await clearForUser(Sx, cfg, who.uid);
    if (!c.ok){ log('CLEAR_FAILED'); return Sx.json(res, 503, { error: 'unavailable' }); }
    log('CLEARED n=' + c.cleared);
    return Sx.json(res, 200, { cleared: c.cleared, lines: [], packet: [] });
  }
  if (body.action !== 'record') return Sx.json(res, 400, { error: 'unknown_action' });

  /* THE VOICE COACH IS THE FEATURE. Off, nothing is kept and the database is
     not asked anything. */
  if (!V.voiceEnabled()) return Sx.json(res, 200, { stored: false, reason: 'voice_off' });
  /* The browser's statement that the athlete turned Coach Memory on, against
     this wording. Anything else -- no statement, an old version -- keeps
     nothing. */
  if (body.consent !== L.COACH_MEMORY_VERSION) return Sx.json(res, 200, { stored: false, reason: 'memory_off' });

  /* HEALTH NEEDS BOTH SIDES TO SAY YES. The server's own consent record,
     asked only when the line needs it and failing closed (an unreachable
     consent table keeps nothing) -- AND the browser's, because withdrawing on
     the phone takes effect there at once while the audit row that tells the
     server is best-effort. Either one saying no keeps nothing. */
  let entry = L.buildEntry(body, { healthGranted: false });
  if (!entry.ok && entry.why === 'health_without_consent' && body.healthConsent === true){
    const granted = await H.isGranted(cfg, Sx.sb, who.uid);
    entry = L.buildEntry(body, { healthGranted: granted });
  }
  if (!entry.ok){
    log('NOT_KEPT why=' + entry.why);
    return Sx.json(res, 200, { stored: false, reason: entry.why });
  }

  const row = { user_id: who.uid, day: dayFor(body), kind: entry.row.kind,
                line: entry.row.line, health: entry.row.health };
  let w;
  try{
    w = await Sx.sb(cfg, TABLE + '?on_conflict=user_id,day,line', {
      method: 'POST', body: JSON.stringify(row),
      prefer: 'resolution=ignore-duplicates,return=minimal'
    });
  }catch(e){ w = null; }
  if (absent(w)) return Sx.json(res, 200, { stored: false, reason: 'unavailable' });
  if (!w || !w.ok){
    log('WRITE_FAILED status=' + (w ? w.status : 'none'));
    return Sx.json(res, 200, { stored: false, reason: 'write_failed' });
  }
  log('KEPT kind=' + row.kind + (row.health ? ' health=1' : ''));
  const list = await listForUser(Sx, cfg, who.uid);
  const packet = list.ok ? await packetFor(Sx, cfg, who.uid, list.rows) : [];
  return Sx.json(res, 200, { stored: true, packet: packet });
}

module.exports = {
  handle, listForUser, clearForUser, eraseHealthLines, publicRow, packetFor, dayFor, TABLE
};
