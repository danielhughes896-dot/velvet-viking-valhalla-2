// Velvet Viking -- one serverless entry point for the whole Strava integration.
//
//   /api/strava-auth       start / status / disconnect        POST
//   /api/strava-callback   the OAuth redirect_uri              GET
//   /api/strava-enabled    availability probe                  GET, HEAD
//   /api/strava-sync       pull / sync / ack                   POST
//   /api/strava-webhook    Strava's handshake and deliveries   GET, POST
//   /api/strava-admin      owner-only subscription management  POST
//
// WHY. Vercel turns every non-underscore file in /api into its own Serverless
// Function, and the Hobby plan allows twelve per deployment. Strava alone held
// six of them, which left the deployment sitting at exactly 12/12 -- no room
// for the Garmin integration, and one new file away from the same outright
// deployment failure Phase 3A2 hit (`exceeded_serverless_functions_per_
// deployment`, no deployment at all, nothing slow and nothing broken).
//
// The fix is packaging, not capability. This is the same decision api/account.js
// already made for the athlete's own account routes, in the same shape, for the
// same reason.
//
// NOTHING ABOUT BEHAVIOUR CHANGES. Each handler moved to a _-prefixed module
// with its logic, its comments and its exports untouched; the only edit inside
// them was the export line. Every public URL is unchanged, which matters more
// here than it did for account.js because two of these paths are registered
// with a third party and cannot move:
//
//   /api/strava-callback  is the OAuth redirect_uri, computed by
//                         S.redirectUri() and registered on the Strava app.
//   /api/strava-webhook   is the subscription callback_url Strava POSTs to.
//
// Both are hardcoded strings rather than anything derived from req.url, so
// they keep resolving correctly no matter which function serves them -- and
// vercel.json rewrites the original paths onto this file, so from outside
// nothing has moved at all.
//
// This file is a ROUTER and nothing else. Each concern keeps its own module,
// its own comments and its own tests; the only thing that lives here is the
// decision about which one is being asked for.

const S = require('./_strava.js');

const ROUTES = {
  'strava-auth':     require('./_strava-auth.js'),
  'strava-callback': require('./_strava-callback.js'),
  'strava-enabled':  require('./_strava-enabled.js'),
  'strava-sync':     require('./_strava-sync.js'),
  'strava-webhook':  require('./_strava-webhook.js'),
  'strava-admin':    require('./_strava-admin.js')
};

/* Which route is being asked for, resolved from the request rather than
   trusted from a body -- the same three sources api/account.js uses, in the
   same order of reliability:
     1. the `route` query parameter vercel.json rewrites onto the request
     2. the same parameter parsed out of req.url, when the platform has not
        populated req.query
     3. the last path segment, so a direct hit on /api/strava-callback still
        resolves if a rewrite is ever removed

   The third source is why ROUTES is keyed by the PUBLIC path segment rather
   than by a short internal name: the fallback then needs no translation table,
   and an OAuth callback arriving without its rewrite still lands on the right
   handler instead of 404ing an athlete mid-authorization.

   An unrecognised value resolves to null and is refused. Guessing would mean a
   typo in a route silently reaching the wrong handler, and one of these six
   writes OAuth tokens. */
function resolveRoute(req){
  const q = (req && req.query && req.query.route) || null;
  if (q && Object.prototype.hasOwnProperty.call(ROUTES, q)) return q;

  const url = String((req && req.url) || '');
  const m = /[?&]route=([^&#]+)/.exec(url);
  if (m){
    let v = m[1];
    try{ v = decodeURIComponent(v); }catch(e){ /* keep raw */ }
    if (Object.prototype.hasOwnProperty.call(ROUTES, v)) return v;
  }

  const path = url.split('?')[0].replace(/\/+$/, '');
  const last = path.slice(path.lastIndexOf('/') + 1);
  if (Object.prototype.hasOwnProperty.call(ROUTES, last)) return last;

  return null;
}

module.exports = async function handler(req, res){
  const route = resolveRoute(req);
  if (!route){
    /* 404 rather than 400: from outside, an unroutable path under this
       function is a path that does not exist, and saying anything more
       specific would describe the internal shape of a router to a stranger. */
    return S.json(res, 404, { error: 'not_found' });
  }
  return ROUTES[route].handle(req, res);
};

module.exports.resolveRoute = resolveRoute;
module.exports.ROUTES = Object.keys(ROUTES);
