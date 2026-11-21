'use strict';
/* THE APP'S OWN ADDRESSES.
 * ===========================================================================
 * Founder, 21 November 2026: the app moves to app.sacoro.app, and
 * app.velvetviking.co.uk keeps serving it, unchanged, until it is safe to
 * retire. Both are this one deployment. Builds 13 and earlier load the old
 * address, build 14 loads the new one, and a browser may be on either.
 *
 * WHAT THIS IS FOR. VVV_SITE_ORIGIN is the address the deployment registers
 * with other companies: the Strava redirect_uri and webhook, the Garmin
 * callback. There is one of it, and on switch day it becomes
 * https://app.sacoro.app. Somewhere to send a PERSON back to is a different
 * question: they must come back to the address they were using, because
 * that is where their sign-in and their data are. Sent to the other address
 * they would arrive signed out, and an old build would leave its own app for
 * a browser.
 *
 * WHY A FIXED LIST AND NOT THE HOST HEADER. A return address taken from a
 * request header is an address an attacker can name. This list is the only
 * thing an arrival address is matched against, so a request can choose
 * between the app's own addresses and nothing else. The pinned
 * VVV_SITE_ORIGIN always counts as one of them.
 *
 * Retiring the old address later is one line here, once nothing arrives on
 * it any more (docs: MOVE-TO-SACORO-APP.md in the website repository). */

const APP_ORIGINS = Object.freeze(['https://app.sacoro.app', 'https://app.velvetviking.co.uk']);

function trimOrigin(o){ return String(o || '').trim().replace(/\/+$/, ''); }

/* The address this request actually arrived on, from the forwarded headers
   Vercel sets. '' when there is no host at all. */
function arrivalOrigin(req){
  const h = (req && req.headers) || {};
  const host = h['x-forwarded-host'] || h.host;
  if (!host) return '';
  return String(h['x-forwarded-proto'] || 'https') + '://' + String(host);
}

/* Is this one of the app's own addresses? The pinned origin, when there is
   one, always is. */
function isAppOrigin(origin, pinned){
  const o = trimOrigin(origin);
  if (!o) return false;
  if (APP_ORIGINS.indexOf(o) !== -1) return true;
  const p = trimOrigin(pinned);
  return !!p && o === p;
}

module.exports = { APP_ORIGINS, trimOrigin, arrivalOrigin, isAppOrigin };
