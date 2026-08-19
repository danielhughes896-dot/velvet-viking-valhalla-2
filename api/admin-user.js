// Owner-only beta-tester deletion. This exists for exactly one commitment:
// a tester emails support@velvetviking.co.uk to withdraw, and their account and
// server-side training data have to go even though they will never open the app
// again to press Delete Account themselves.
//
//   POST { action:"user_lookup", email }                  -> what we hold
//   POST { action:"user_delete", email, confirm:"DELETE" } -> erase it
//   POST { action:"content_export", candidate }          -> owner-only content
//                                                           candidate export; see
//                                                           _content-bridge.js
//
// Authorization is the same three server-side requirements as strava-admin.js,
// which this deliberately mirrors rather than inventing a second notion of
// "owner":
//   1. a valid Supabase access token in the Authorization header, verified
//      against Supabase itself, so a forged or expired JWT cannot pass and this
//      server never needs the project's JWT secret;
//   2. that token's user id must equal VVV_OWNER_USER_ID;
//   3. the service-role key never leaves this process.
//
// An ordinary signed-in athlete calling this route gets the same 404 an unknown
// route would give. It is reachable from no control in the app.
//
// WHAT THIS CANNOT DELETE, and never claims to: the copy on the tester's own
// device. localStorage (the plan, vvv_plan_archive, the session snapshot) and
// any Android Auto Backup of it are on hardware we do not control and cannot
// reach. The response says so explicitly rather than reporting a clean sweep.

const S = require('./_strava.js');
const CB = require('./_content-bridge.js');

function log(what){ try{ console.log('admin-user: ' + what); }catch(e){} }

/* Find the auth user for an address.
   GoTrue's admin list endpoint has changed its filtering support across
   versions, so this pages and matches exactly rather than trusting a query
   parameter to mean what it meant last release. Bounded: a five-person beta
   never needs more, and an unbounded loop against someone else's project is
   not a thing this should be able to do. */
async function findUserByEmail(cfg, email){
  const PER_PAGE = 200, MAX_PAGES = 10;
  for (let page = 1; page <= MAX_PAGES; page++){
    let r;
    try{
      r = await fetch(cfg.supabaseUrl + '/auth/v1/admin/users?page=' + page + '&per_page=' + PER_PAGE, {
        headers: { 'apikey': cfg.serviceKey, 'Authorization': 'Bearer ' + cfg.serviceKey }
      });
    }catch(e){ return { error: 'AUTH_ADMIN_UNREACHABLE' }; }
    if (!r.ok) return { error: 'AUTH_ADMIN_STATUS_' + r.status };
    const b = await r.json().catch(() => null);
    const users = (b && (b.users || b)) || [];
    if (!Array.isArray(users) || !users.length) return { found: false };
    const hit = users.find(u => String(u && u.email || '').trim().toLowerCase() === email);
    if (hit) return { found: true, user: hit };
    if (users.length < PER_PAGE) return { found: false };
  }
  return { found: false, truncated: true };
}

/* How many rows a table holds for this user. Used to report before/after
   honestly rather than asserting the cascade worked.

   Counted from the Content-Range header rather than by measuring the returned
   array: PostgREST caps how many rows it will return, so a length would silently
   under-report exactly the case that matters -- an athlete with a lot of staged
   activities. `count=exact` answers about the table, not about the page. */
async function countFor(cfg, table, uid){
  const r = await S.sb(cfg, '/' + table + '?select=user_id&user_id=eq.' + encodeURIComponent(uid) +
    '&limit=1', { prefer: 'count=exact' });
  if (!r.ok) return null;
  const range = (r.headers && r.headers.get && r.headers.get('content-range')) || '';
  const total = /\/(\d+)\s*$/.exec(String(range));
  if (total) return parseInt(total[1], 10);
  // No header (a proxy stripped it, or an older PostgREST): fall back to the
  // body, and say nothing we cannot support.
  const rows = await r.json().catch(() => null);
  return Array.isArray(rows) ? rows.length : null;
}

async function holdings(cfg, uid){
  const [plans, conns, acts] = await Promise.all([
    countFor(cfg, 'plans', uid),
    countFor(cfg, 'strava_connections', uid),
    countFor(cfg, 'strava_activities', uid)
  ]);
  return { plans: plans, stravaConnections: conns, stravaActivities: acts };
}

module.exports = async function handler(req, res){
  const cfg = S.config();
  const ownerId = process.env.VVV_OWNER_USER_ID || '';

  if (req.method !== 'POST'){
    res.setHeader('Allow', 'POST');
    return S.json(res, 405, { error: 'method_not_allowed', code: 'METHOD_NOT_ALLOWED' });
  }
  if (!cfg.serviceKey){
    log('SUPABASE_KEY_UNUSABLE serviceKey=' + cfg.serviceKeySource);
    return S.json(res, 503, { error: 'supabase_key_unusable', code: 'SUPABASE_KEY_UNUSABLE',
                              reason: cfg.serviceKeySource });
  }
  // Fail closed: with no owner configured there is no authorised caller, so
  // this is simply unavailable rather than open to the first account that
  // finds the route.
  if (!ownerId){
    log('OWNER_NOT_CONFIGURED');
    return S.json(res, 503, { error: 'owner_not_configured', code: 'OWNER_NOT_CONFIGURED' });
  }

  const who = await S.verifyUser(req, cfg);
  log(S.diagLine(who.code, who.diag) + ' ownerConfigured=yes ownerMatch=' +
      (who.uid ? (who.uid === ownerId ? 'yes' : 'no') : 'n/a'));

  if (!who.uid){
    const deployment = who.code === 'AUTH_PROJECT_MISMATCH' ||
                       who.code === 'AUTH_ANON_KEY_REJECTED' ||
                       who.code === 'AUTH_VERIFY_404' ||
                       who.code === 'AUTH_UNAVAILABLE';
    return S.json(res, deployment ? 503 : 401,
      { error: deployment ? 'auth_misconfigured' : 'not_signed_in', code: who.code });
  }
  // Indistinguishable from a route that does not exist. The distinction is
  // recorded in the server log, which carries neither id.
  if (who.uid !== ownerId)
    return S.json(res, 404, { error: 'not_found', code: 'OWNER_MISMATCH' });

  const body   = S.readBody(req);
  const action = body.action;
  const email  = String(body.email || '').trim().toLowerCase();

  /* CONTENT CANDIDATE EXPORT -- handled here and returned before the email
     requirement below, because it is the one owner action that is not about a
     tester's account and has no email to look up.

     WHY IT LIVES ON THIS ROUTE. Vercel makes a Serverless Function of every
     non-underscore file in /api and the budget is full at 12/12, so a
     thirteenth route is not available. This one already IS the authenticated
     owner-only surface: the gate above -- POST, service key usable, owner
     configured, token verified against Supabase itself, uid must equal
     VVV_OWNER_USER_ID, 404 otherwise -- is exactly the check the export needs,
     and reusing it is safer than inventing a second notion of "owner"
     somewhere else. The integration logic itself is isolated in
     _content-bridge.js and shares nothing with the deletion path below. */
  if (action === 'content_export'){
    const out = await CB.exportCandidate(body.candidate, who.uid === ownerId);
    // Codes only. A candidate carries no prohibited field by construction, and
    // nothing from the payload is echoed into the log line.
    log('CONTENT_EXPORT ok=' + (out.ok ? 'yes' : 'no') + ' code=' + (out.code || 'created') +
        (out.created === false ? ' idempotent=hit' : ''));
    return S.json(res, out.status, out.ok
      ? { ok: true, created: out.created, itemId: out.itemId, candidateId: out.candidateId }
      : { error: out.code, code: out.code, problems: out.problems || undefined });
  }

  if (action !== 'user_lookup' && action !== 'user_delete')
    return S.json(res, 400, { error: 'unknown_action', code: 'unknown_action' });
  if (!email || email.indexOf('@') < 1)
    return S.json(res, 400, { error: 'bad_email', code: 'bad_email' });

  const hit = await findUserByEmail(cfg, email);
  if (hit.error){
    log('LOOKUP_FAILED ' + hit.error);
    return S.json(res, 502, { error: 'lookup_failed', code: hit.error });
  }
  if (!hit.found){
    log('LOOKUP found=0');
    return S.json(res, 404, { error: 'no_such_user', code: 'no_such_user' });
  }

  const uid  = hit.user.id;
  const held = await holdings(cfg, uid);

  if (action === 'user_lookup'){
    log('LOOKUP found=1 plans=' + held.plans + ' strava_conn=' + held.stravaConnections +
        ' staged=' + held.stravaActivities);
    return S.json(res, 200, {
      found: true,
      email: hit.user.email,          // echoed so the operator can confirm the
                                      // target before the destructive call
      createdAt: hit.user.created_at || null,
      lastSignInAt: hit.user.last_sign_in_at || null,
      holdings: held
    });
  }

  // ---- user_delete ----
  // A typed confirmation, so a mis-click on an owner-authenticated page cannot
  // erase an athlete.
  if (String(body.confirm || '') !== 'DELETE')
    return S.json(res, 400, { error: 'confirmation_required', code: 'confirmation_required' });

  /* Strava FIRST, while the connection row still exists.
     Deleting the auth user cascades the row away, and at that point the grant
     is stranded: VVV has no token left, while Strava still lists VVV as
     connected on the athlete's own settings page with nothing able to revoke
     it. Same ordering, and the same reasoning, as the athlete's own
     self-deletion path in the app.

     Non-fatal by design. A tester has asked to be erased and that must not be
     blocked by a third party being down -- the outcome is reported instead of
     glossed, so HQ knows whether to tell them to remove VVV on Strava's side
     themselves. */
  let stravaFound = false, deauthorized = false;
  const conn = await S.getConnection(cfg, uid);
  if (conn){
    stravaFound = true;
    try{
      const token = await S.accessTokenFor(cfg, conn);
      if (token){
        const d = await fetch(S.STRAVA_DEAUTH_URL, {
          method: 'POST', headers: { 'Authorization': 'Bearer ' + token }
        });
        deauthorized = !!(d && d.ok);
      }
    }catch(e){}
  }

  /* Explicit deletes before the cascade. auth.users ON DELETE CASCADE already
     removes all three, but doing it here as well means a failure to delete the
     auth row cannot leave training data behind -- and it makes each table an
     observable step rather than an assumption about foreign keys. */
  const purgedStaged = await S.deleteStagedActivities(cfg, uid);
  const purgedConn   = await S.deleteConnection(cfg, uid);
  const purgedPlan   = await S.sb(cfg, '/plans?user_id=eq.' + encodeURIComponent(uid), { method: 'DELETE' });

  let authDeleted = false, authStatus = null;
  try{
    const r = await fetch(cfg.supabaseUrl + '/auth/v1/admin/users/' + encodeURIComponent(uid), {
      method: 'DELETE',
      headers: { 'apikey': cfg.serviceKey, 'Authorization': 'Bearer ' + cfg.serviceKey }
    });
    authStatus = r.status;
    authDeleted = r.ok;
  }catch(e){ authStatus = 'unreachable'; }

  // Re-read rather than assume. This is the difference between reporting a
  // deletion and proving one.
  const after = await holdings(cfg, uid);
  const clean = after.plans === 0 && after.stravaConnections === 0 && after.stravaActivities === 0;

  // Counts and booleans only -- no email, no uid, no token.
  log('DELETE strava_conn=' + (stravaFound ? 1 : 0) + ' deauthorized=' + (deauthorized ? 1 : 0) +
      ' staged_purged=' + ((purgedStaged && purgedStaged.ok) ? 1 : 0) +
      ' conn_purged=' + ((purgedConn && purgedConn.ok) ? 1 : 0) +
      ' plan_purged=' + ((purgedPlan && purgedPlan.ok) ? 1 : 0) +
      ' auth_deleted=' + (authDeleted ? 1 : 0) + ' auth_status=' + authStatus +
      ' rows_after=' + [after.plans, after.stravaConnections, after.stravaActivities].join('/'));

  return S.json(res, authDeleted && clean ? 200 : 502, {
    deleted: authDeleted && clean,
    authAccountDeleted: authDeleted,
    serverSideRowsRemaining: after,
    strava: {
      wasConnected: stravaFound,
      deauthorizedWithStrava: deauthorized,
      // The one thing HQ must pass on if this is false and wasConnected is true.
      manualStravaRemovalNeeded: stravaFound && !deauthorized
    },
    /* Stated in the response, not just in a policy document, because this is
       the moment someone decides whether the 30-day promise has been kept. */
    notDeletedByThisAction: [
      'the plan held in localStorage on the tester\'s own browser or phone',
      'vvv_plan_archive, if they ever signed in on a shared device',
      'any Android Auto Backup copy in the tester\'s own Google account',
      'training values already merged into their own log before deletion'
    ]
  });
};
