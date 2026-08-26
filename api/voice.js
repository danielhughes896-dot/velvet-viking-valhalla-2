// Velvet Viking -- one serverless entry point for the whole Voice Coach.
//
//   /api/voice-ask       Ask Coach                POST
//   /api/voice-brief     spoken briefing          POST
//   /api/voice-enabled   availability probe       GET, HEAD
//
// WHY A ROUTER FOR TWO ROUTES. Vercel turns every non-underscore file in /api
// into its own Serverless Function, and the Hobby plan allows twelve per
// deployment. The deployment already sat at eight of twelve, and the Strava
// integration had to be consolidated from six functions to one after a
// deployment failed outright with exceeded_serverless_functions_per_deployment
// -- nothing slow and nothing broken, simply no deployment at all.
//
// Two more files would have been ten of twelve for a feature that will grow
// (speech-to-text and a cloud voice are both plausible next routes). One
// router costs one function and has room for them. This is the same decision
// api/strava.js and api/account.js already made, in the same shape.

const V = require('./_voice.js');

const ROUTES = {
  'voice-ask':     require('./_voice-ask.js'),
  'voice-brief':   require('./_voice-brief.js'),
  'voice-enabled': require('./_voice-enabled.js')
};

/* Resolved from the request rather than trusted from a body -- the same three
   sources api/strava.js uses, in the same order of reliability: the `route`
   query parameter vercel.json rewrites on, the same parameter parsed out of
   req.url when the platform has not populated req.query, and finally the last
   path segment so a direct hit still resolves if a rewrite is ever removed.
   An unrecognised value is refused rather than guessed. */
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
  if (!route) return V.json(res, 404, { error: 'not_found' });
  return ROUTES[route].handle(req, res);
};

module.exports.resolveRoute = resolveRoute;
module.exports.ROUTES = Object.keys(ROUTES);
