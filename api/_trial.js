// Velvet Viking -- starting the free trial.
//
//   POST /api/trial   Authorization: Bearer <supabase access token>
//                     -> { started, trial_ends_at } | a reason it did not
//
// ONE EXPLICIT ACT. Creating an account does not start a trial. Building a plan
// does not. Viewing the preview does not. Signing back in does not. Only this
// endpoint does, and only when the athlete presses the button.
//
// THE SERVER DECIDES WHO. The account is resolved from the bearer token here;
// the request body is not read at all, so there is no account_id, no expiry and
// no product for a client to supply. The body being ignored is the point.
//
// ATOMICITY IS THE DATABASE'S JOB, not this file's. start_standard_trial()
// consumes the one-time allowance and inserts the entitlement grant in a single
// transaction, so a failure cannot leave the athlete's trial spent with nothing
// granted. Two round trips from here would have exactly that failure mode, and
// no amount of care in JavaScript closes it.

'use strict';

const S = require('./_strava.js');
const A = require('./_access.js');
const P = require('./_products.js');

function log(what){ try{ console.log('trial: ' + what); }catch(e){} }

/* Reasons the database can give, mapped to something an athlete-facing surface
   can say. Anything unrecognised becomes a refusal, never a success. */
const OUTCOME = {
  started:               { status: 200, ok: true },
  already_used:          { status: 409, ok: false },
  trial_blocked:         { status: 409, ok: false },
  no_commercial_account: { status: 409, ok: false },
  bad_trial_days:        { status: 500, ok: false },
  no_account:            { status: 401, ok: false }
};

async function handle(req, res){
  if (String(req.method || '').toUpperCase() !== 'POST')
    return S.json(res, 405, { error: 'method_not_allowed' });

  const cfg = S.config();
  const uid = await S.userIdFromRequest(req, cfg);
  if (!uid) return S.json(res, 401, { error: 'not_signed_in' });
  if (!cfg.serviceKey){
    log('SUPABASE_KEY_UNUSABLE');
    return S.json(res, 503, { error: 'unavailable' });
  }

  /* The duration comes from the offering, which is where the fourteen days are
     decided and where Phase 2's Stripe checkout reads them from too. The
     function bounds it again independently -- a caller and a callee that both
     check is not redundancy, it is the caller not being trusted. */
  const r = await S.sb(cfg, '/rest/v1/rpc/start_standard_trial', {
    method: 'POST',
    body: JSON.stringify({ p_account_id: uid, p_trial_days: P.TRIAL_DAYS })
  });

  if (!r || !r.ok){
    log('RPC_FAILED status=' + (r && r.status));
    return S.json(res, 503, { error: 'unavailable' });
  }

  const rows = r.body;
  const row = Array.isArray(rows) ? rows[0] : rows;
  const reason = (row && row.reason) || 'unavailable';
  const outcome = OUTCOME[reason] || { status: 409, ok: false };

  if (!outcome.ok){
    log('refused uid=' + String(uid).slice(0, 8) + ' reason=' + reason);
    return S.json(res, outcome.status, { started: false, reason: reason });
  }

  log('started uid=' + String(uid).slice(0, 8));
  return S.json(res, 200, {
    started: true,
    trial_ends_at: (row && row.trial_ends_at) || null,
    trial_days: P.TRIAL_DAYS
  });
}

module.exports = { handle, OUTCOME };
