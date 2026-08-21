// Velvet Viking -- one serverless entry point for the athlete's own account.
//
//   /api/subscription     status, and starting a subscription
//   /api/account-data     export everything this athlete has
//   /api/account-delete   close the account
//
// WHY THESE THREE AND NOT OTHERS. Vercel turns every non-underscore file in
// /api into its own Serverless Function, and the Hobby plan allows twelve per
// deployment. Phase 3A2 added four and took the total to fourteen, so the
// deployment failed outright -- not a slow endpoint or a broken route, but no
// deployment at all.
//
// The fix is packaging, not capability. Nothing here is removed, no boundary is
// relaxed, and every public URL is unchanged: vercel.json rewrites the three
// paths onto this one function and the athlete, the app and the account shell
// cannot tell the difference. What changed is how many files Vercel counts.
//
// These three belong together on their own merits, which is why they are the
// ones chosen. They are the same request in three shapes: a VERIFIED athlete
// acting on their OWN account, scoped by a uid that comes from a token and
// from nowhere else. They are also, exactly, the locked-capability contract in
// _access.js -- account_manage, data_export, account_delete -- the three things
// an athlete keeps when they have no entitlement at all.
//
// WHAT IS DELIBERATELY *NOT* HERE
//   /api/billing-webhook  A third party's server, authenticated by an HMAC
//                         signature rather than by a session. Folding it in
//                         would put a path that never sees a Bearer token
//                         inside the same handler as account deletion, and one
//                         mis-ordered branch would be the whole boundary. It
//                         stays its own function; the plan has room for it.
//   /api/session          Mints the delivery lease and answers 403 when access
//                         has ended, which is precisely why it cannot also be
//                         what talks to a locked-out athlete.
//
// This file is a ROUTER and nothing else. Each concern keeps its own module,
// its own comments and its own tests; the only thing that lives here is the
// decision about which one is being asked for.

const S = require('./_strava.js');

const ROUTES = {
  subscription:     require('./_subscription.js'),
  'account-data':   require('./_account-data.js'),
  'account-delete': require('./_account-delete.js'),
  /* Starting a subscription. Mounted here rather than as its own function
     because the plan allows twelve and twelve are used -- and because this is
     what the router is for. The concern keeps its own module and its own
     tests, exactly like the three above. */
  checkout:         require('./_checkout.js'),
  /* Phase 3 commercial entry. Both mount here rather than as new functions --
     the plan allows twelve and the router is what it is for. */
  preview:          require('./_preview.js')
};

/* Which resource is being asked for, resolved from the request rather than
   trusted from a body. Three sources in order of reliability, because a
   rewrite is a platform behaviour and the pure function is what the suite can
   actually exercise:
     1. the `resource` query parameter vercel.json rewrites onto the request
     2. the same parameter parsed out of req.url, when the platform has not
        populated req.query
     3. the last path segment, so a direct hit on /api/account-data still
        resolves if a rewrite is ever removed

   An unrecognised value resolves to null and is refused. Guessing would mean
   a typo in a route silently reaching the wrong handler, and one of the three
   deletes accounts. */
function resolveResource(req){
  const q = (req && req.query && req.query.resource) || null;
  if (q && Object.prototype.hasOwnProperty.call(ROUTES, q)) return q;

  const url = String((req && req.url) || '');
  const m = /[?&]resource=([^&#]+)/.exec(url);
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
  const resource = resolveResource(req);
  if (!resource){
    /* 404 rather than 400: from outside, an unroutable path under this
       function is a path that does not exist, and saying anything more
       specific would describe the internal shape of a router to a stranger. */
    return S.json(res, 404, { error: 'not_found' });
  }
  return ROUTES[resource].handle(req, res);
};

module.exports.resolveResource = resolveResource;
module.exports.ROUTES = Object.keys(ROUTES);
