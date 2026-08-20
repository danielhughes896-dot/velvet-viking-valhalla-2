// Velvet Viking -- one serverless entry point for the Garmin integration.
//
//   /api/garmin-status   is the integration available?   GET, HEAD
//
// ONE ROUTE TODAY, AND A ROUTER ANYWAY. The shape is the same as api/strava.js
// and api/account.js for the same reason: the routes Garmin will need --
// authorization start, OAuth callback, disconnect, activity delivery -- arrive
// together once the contract does, and they must not arrive as four new
// Serverless Functions against a twelve-function limit. Adding them here later
// costs nothing; adding them as files would cost the deployment.
//
// The Strava consolidation is what made room for this file at all: the budget
// went 12/12 -> 7/12, and this is the eighth.
//
// NOTHING HERE REACHES GARMIN. The only route implemented reports availability
// from this deployment's own environment, and _garmin.js refuses everything
// else while unconfigured.

const S = require('./_strava.js');

const ROUTES = {
  'garmin-status': require('./_garmin-status.js')
};

/* The same three-source resolution api/strava.js and api/account.js use --
   rewrite parameter, parameter parsed from req.url, then the last path
   segment -- keyed by the public segment so the path fallback needs no
   translation table. An unrecognised value is refused rather than guessed. */
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
  if (!route) return S.json(res, 404, { error: 'not_found' });
  return ROUTES[route].handle(req, res);
};

module.exports.resolveRoute = resolveRoute;
module.exports.ROUTES = Object.keys(ROUTES);
