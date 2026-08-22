/* Velvet Viking -- the monday.com OPERATIONAL contract.
 *
 * Supabase is the source of truth. monday is the human operational layer: a
 * board a person looks at to see how the business is doing and to notice when
 * something needs attention. That is the whole of its job, and the two
 * sentences below are what keep it that way.
 *
 *   NOTHING ON THE BOARD IS AN AUTHORITY. No access decision, no entitlement,
 *   no trial, no price is ever read back from monday. If the board is wrong,
 *   stale, edited by hand or deleted entirely, no athlete's access changes by
 *   one second. The sync is one-way by construction: this module has no read
 *   path that returns anything an entitlement could be derived from.
 *
 *   NOTHING COACHING-RELATED CROSSES. Not a session, not a pace, not a heart
 *   rate, not an RPE, not a readiness score, not a note, not a training
 *   history, not a symptom. A third-party board is not where an athlete's
 *   health-indicating data goes, and the way to guarantee that is an ALLOW
 *   LIST plus a refusal, not a habit of being careful.
 *
 * WHY AN OPAQUE REFERENCE RATHER THAN THE ACCOUNT UUID. The uuid is the
 * auth.users id -- the same value that keys every table in the product. Putting
 * it on a third-party board makes that board a lookup table into the database
 * for anybody who can see the board. The reference here is an HMAC of the
 * account id under a salt held only in Vercel: stable (so an item can be found
 * again), unique (so two accounts cannot collide), and useless on its own
 * (because it cannot be turned back into an account id without the salt).
 *
 * It also fails CLOSED. No salt configured means no reference, which means no
 * sync -- never a fallback to the raw uuid, which is exactly the shortcut that
 * would be taken at 2am to get a board working.
 */

'use strict';

const crypto = require('crypto');

/* One line, one code, no payload. Enough to answer "is the board syncing" and
   "why not" from a log search, and not enough to reconstruct anything about an
   athlete: the reference is already opaque and nothing else is interpolated. */
function log(what){ try{ console.log('monday-ops: ' + what); }catch(e){} }

/* ---------------------------------------------------------------------------
 * THE ALLOW LIST -- the entire vocabulary the board may ever receive.
 *
 * Every field is here because a human operating the business needs it to
 * answer a question they actually have: how many people are on trial, is
 * anybody about to convert, has somebody quietly stopped using it, is anyone
 * locked out who should not be.
 * ------------------------------------------------------------------------- */
const ALLOWED = [
  'accountRef',        // opaque, stable, non-reversible
  'accountCreated',    // date -- cohort
  'lastActive',        // date -- the difference between a subscriber and a churn risk
  'trialActive',       // boolean
  'trialEnds',         // date
  'trialStarted',      // date -- when the allowance was spent
  'paidActive',        // boolean
  'billingPeriod',     // 'monthly' | 'yearly' | null
  'paidThrough',       // date
  'commercialState',   // the derived product-facing state
  'cancelling',        // boolean -- set to end, still running
  'cancelledAt',       // date
  'paused',            // boolean
  'pauseResumes',      // date
  'accessState',       // 'open' | 'soft_locked' | 'locked'
  'accessReason',      // the resolver's reason, which is already product-facing
  'provider',          // 'web' | 'apple' | 'google' -- the rail, not the processor
  'adminGrant',        // boolean -- beta or comp, so a tester is not read as a customer
  'syncedAt'
];

/* THE REFUSAL LIST. Not a substitute for the allow list -- the allow list is
 * what actually decides -- but a named set so a violation produces a sentence
 * that says what rule was broken rather than "unknown field". */
const PROHIBITED = [
  'email', 'name', 'firstName', 'lastName', 'phone', 'address', 'dob',
  'session', 'sessions', 'workout', 'workouts', 'training', 'trainingHistory',
  'pace', 'paces', 'heartRate', 'hr', 'rpe', 'readiness', 'athleteState',
  'notes', 'note', 'evidence', 'coachingEvidence', 'symptom', 'symptoms',
  'injury', 'weight', 'restingHr', 'hrv', 'sleep', 'vdot', 'distance',
  'plan', 'planData', 'race', 'goal', 'strava', 'garmin', 'activity', 'activities',
  'ip', 'ipAddress', 'userAgent', 'device', 'location', 'latitude', 'longitude',
  'cardLast4', 'pan', 'stripeCustomerId', 'customerId', 'accountId', 'userId'
];

/* Anything that merely LOOKS like health or training data, so a field nobody
 * thought to add to PROHIBITED still cannot arrive by accident. */
const SUSPICIOUS = /(pace|heart|hr\b|rpe|readiness|fatigue|soreness|sleep|hrv|vo2|vdot|calor|weight|injur|symptom|session|workout|training|activity|effort|zone|split|lap|cadence|watt|power)/i;

const ACCESS_STATES = ['open', 'soft_locked', 'locked'];

function config(env){
  const e = env || process.env;
  const salt = String(e.MONDAY_OPERATIONAL_SALT || '').trim();
  return {
    enabled: String(e.VVV_MONDAY_OPERATIONAL || '').trim().toLowerCase() === 'on',
    hasToken: !!String(e.MONDAY_API_TOKEN || '').trim(),
    token: function(){ return String(e.MONDAY_API_TOKEN || '').trim(); },
    boardId: String(e.MONDAY_OPERATIONAL_BOARD_ID || '').trim(),
    groupId: String(e.MONDAY_OPERATIONAL_GROUP_ID || '').trim(),
    /* Read through a function so a rotation is picked up, and never returned
       from anything that gets logged or serialised. */
    hasSalt: !!salt,
    salt: function(){ return salt; }
  };
}

/* THE OPAQUE REFERENCE. Truncated to 20 hex characters -- 80 bits, which makes
 * a collision across every account this product will ever have unreachable,
 * and keeps the item name short enough for a human to read out loud.
 *
 * Prefixed so an operator can tell at a glance that it is a Valhalla reference
 * and not something they can paste into a database. */
function accountRef(accountId, cfg){
  const c = cfg || config();
  if (!accountId) return null;
  if (!c.hasSalt) return null;      // fail closed. Never the raw uuid.
  return 'VVV-' + crypto.createHmac('sha256', c.salt())
    .update(String(accountId)).digest('hex').slice(0, 20).toUpperCase();
}

function isoDate(v){
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

/* ---------------------------------------------------------------------------
 * THE PROJECTION
 *
 * FIELD BY FIELD, from the operational view and the resolver's answer -- never
 * by copying an object and deleting what should not be there. A projection that
 * subtracts leaks every field somebody adds upstream later; a projection that
 * names what it takes cannot.
 * ------------------------------------------------------------------------- */
function operationalPayload(input, cfg){
  const i = input || {};
  const c = cfg || config();
  const state = i.operational || {};        // a row of account_operational_state
  const ent = i.entitlement || {};          // resolveStandardEntitlement()'s answer
  const sub = i.subscription || {};         // the current subscription row, if any

  const ref = accountRef(state.account_id || i.accountId, c);
  if (!ref) return { ok: false, reason: 'no_account_reference' };

  const payload = {
    accountRef: ref,
    accountCreated: isoDate(state.account_created_at),
    lastActive: isoDate(state.last_active_at),

    trialActive: !!state.trial_active,
    trialEnds: isoDate(state.trial_ends_at),
    trialStarted: isoDate(state.trial_consumed_at),

    paidActive: state.subscription_condition === 'active',
    billingPeriod: sub.billing_period || null,
    paidThrough: isoDate(state.paid_through),

    commercialState: ent.commercialState || null,
    cancelling: !!sub.cancel_at_period_end,
    cancelledAt: isoDate(sub.cancelled_at),

    paused: !!sub.paused_at && !!sub.pause_resumes_at,
    pauseResumes: isoDate(sub.pause_resumes_at),

    accessState: accessStateOf(ent),
    accessReason: ent.reason || null,
    provider: state.subscription_provider || null,
    adminGrant: !!state.admin_grant_active,

    syncedAt: isoDate(i.now || new Date())
  };

  const problems = validatePayload(payload);
  if (problems.length) return { ok: false, reason: 'payload_rejected', problems: problems };
  return { ok: true, payload: payload };
}

/* The three states an operator actually needs to tell apart:
 *   open         they can use it
 *   soft_locked  they cannot, but the door is a purchase away -- expired,
 *                trial over, nothing owed. This is who to talk to.
 *   locked       revoked or on a payment hold. A different conversation. */
function accessStateOf(ent){
  const e = ent || {};
  if (e.active) return 'open';
  if (e.reason === 'revoked' || e.reason === 'payment_hold' || e.reason === 'invalid') return 'locked';
  return 'soft_locked';
}

/* ---------------------------------------------------------------------------
 * THE GATE. Nothing reaches monday without passing this.
 * ------------------------------------------------------------------------- */
function validatePayload(payload){
  const p = payload || {};
  const problems = [];

  for (const k of Object.keys(p)){
    if (ALLOWED.indexOf(k) === -1) problems.push('field not on the allow list: ' + k);
    if (PROHIBITED.indexOf(k) !== -1) problems.push('prohibited field: ' + k);
    if (SUSPICIOUS.test(k)) problems.push('field looks like training or health data: ' + k);
  }
  if (!p.accountRef) problems.push('no account reference');
  if (p.accountRef && !/^VVV-[0-9A-F]{20}$/.test(String(p.accountRef)))
    problems.push('the account reference is not an opaque reference');
  if (p.accessState != null && ACCESS_STATES.indexOf(p.accessState) === -1)
    problems.push('unknown access state: ' + p.accessState);

  /* A UUID ANYWHERE IN THE VALUES is the failure this whole design exists to
     prevent, and it would arrive as a "helpful" extra field rather than as a
     deliberate decision. Checked over values, not just keys. */
  for (const k of Object.keys(p)){
    const v = p[k];
    if (typeof v !== 'string') continue;
    if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(v))
      problems.push('a uuid appears in ' + k);
    if (/@/.test(v)) problems.push('an email address appears in ' + k);
  }
  return problems;
}

/* ---------------------------------------------------------------------------
 * THE BOARD
 *
 * IDEMPOTENCY. The opaque reference is the key, and it is looked up before
 * anything is created. One item per account, ever -- a retry after a lost
 * response finds the existing item and UPDATES it rather than adding a second.
 *
 * RACE LIMITATION, stated rather than hidden: monday has no unique constraint
 * on a text column and no upsert, so two genuinely simultaneous syncs of the
 * same account could both read "absent" and both create. The sync is serial and
 * operator-triggered, so the window is not reachable in practice -- but it is
 * real, and the fix is a monday-side uniqueness automation, not more retries.
 * ------------------------------------------------------------------------- */
const COLUMN_IDS = {
  accountRef: 'text_account_ref',
  accountCreated: 'date_account_created',
  lastActive: 'date_last_active',
  trialActive: 'boolean_trial_active',
  trialEnds: 'date_trial_ends',
  trialStarted: 'date_trial_started',
  paidActive: 'boolean_paid_active',
  billingPeriod: 'status_billing_period',
  paidThrough: 'date_paid_through',
  commercialState: 'status_commercial_state',
  cancelling: 'boolean_cancelling',
  cancelledAt: 'date_cancelled_at',
  paused: 'boolean_paused',
  pauseResumes: 'date_pause_resumes',
  accessState: 'status_access_state',
  accessReason: 'text_access_reason',
  provider: 'status_provider',
  adminGrant: 'boolean_admin_grant',
  syncedAt: 'date_synced_at'
};

/* monday's column_values JSON. Dates take {date}, checkboxes {checked},
   statuses {label}, text a bare string. A null date is sent as an empty object,
   which CLEARS the cell -- omitting the key would leave a stale value behind,
   which is how a resumed athlete keeps showing a pause end date. */
function columnValues(payload){
  const p = payload || {};
  const out = {};
  const dates = ['accountCreated','lastActive','trialEnds','trialStarted',
                 'paidThrough','cancelledAt','pauseResumes','syncedAt'];
  const bools = ['trialActive','paidActive','cancelling','paused','adminGrant'];
  const stats = ['billingPeriod','commercialState','accessState','provider'];

  out[COLUMN_IDS.accountRef] = String(p.accountRef || '');
  out[COLUMN_IDS.accessReason] = String(p.accessReason || '');
  dates.forEach(function(k){ out[COLUMN_IDS[k]] = p[k] ? { date: p[k] } : {}; });
  bools.forEach(function(k){ out[COLUMN_IDS[k]] = { checked: p[k] ? 'true' : 'false' }; });
  stats.forEach(function(k){ out[COLUMN_IDS[k]] = p[k] ? { label: String(p[k]) } : {}; });
  return out;
}

function itemName(payload){ return String((payload || {}).accountRef || ''); }

async function mondayQuery(cfg, query, variables, deps){
  const doFetch = (deps && deps.fetch) || globalThis.fetch;
  let r;
  try{
    r = await doFetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': cfg.token(),
                 'API-Version': '2024-01' },
      body: JSON.stringify({ query: query, variables: variables || {} })
    });
  }catch(e){ return { ok: false, code: 'network' }; }

  let json = null;
  try{ json = await r.json(); }catch(e){ json = null; }
  if (!r.ok || !json) return { ok: false, code: 'http_' + r.status };
  if (json.errors && json.errors.length){
    /* Summarised, never echoed: a GraphQL error body repeats the request, and
       the request carries the whole payload. */
    return { ok: false, code: 'graphql_error' };
  }
  return { ok: true, data: json.data };
}

async function findItem(cfg, ref, deps){
  const query = `query ($board: ID!, $col: String!, $val: [String]!) {
    items_page_by_column_values (limit: 1, board_id: $board,
      columns: [{column_id: $col, column_values: $val}]) { items { id name } } }`;
  const res = await mondayQuery(cfg, query,
    { board: cfg.boardId, col: COLUMN_IDS.accountRef, val: [ref] }, deps);
  if (!res.ok) return { ok: false, code: res.code };
  const items = (((res.data || {}).items_page_by_column_values || {}).items) || [];
  return { ok: true, existing: items.length ? items[0] : null };
}

/* ---------------------------------------------------------------------------
 * THE SYNC. One account, one board item, one direction.
 *
 * FAILURE IS NEVER FATAL TO THE ATHLETE. This is called after the thing that
 * actually mattered has already happened and been written to Supabase. A monday
 * outage produces a stale board, which an operator can see and re-sync; it must
 * never produce a failed purchase, a refused sign-in or a lost webhook. Every
 * return here is a report, and no caller is expected to abort on it.
 * ------------------------------------------------------------------------- */
async function syncAccount(input, deps){
  const cfg = (deps && deps.config) || config();

  if (!cfg.enabled)  return { ok: false, code: 'operational_sync_disabled' };
  if (!cfg.hasToken){ log('OPS_NOT_CONFIGURED'); return { ok: false, code: 'not_configured' }; }
  if (!cfg.boardId){  log('OPS_BOARD_NOT_CONFIGURED'); return { ok: false, code: 'board_not_configured' }; }
  if (!cfg.hasSalt){  log('OPS_SALT_NOT_CONFIGURED'); return { ok: false, code: 'salt_not_configured' }; }

  const built = operationalPayload(input, cfg);
  if (!built.ok){
    /* The COUNT of problems, never the problems themselves: a rejection message
       names the offending field, and the offending field is the thing that must
       not be written down. */
    log('OPS_PAYLOAD_REJECTED reason=' + built.reason +
        ' problems=' + ((built.problems && built.problems.length) || 0));
    return { ok: false, code: built.reason, problems: built.problems || null };
  }
  const payload = built.payload;

  const found = await findItem(cfg, payload.accountRef, deps);
  if (!found.ok){
    log('OPS_UNAVAILABLE detail=' + found.code);
    return { ok: false, code: 'monday_unavailable', detail: found.code };
  }

  const cols = JSON.stringify(columnValues(payload));

  if (found.existing){
    const res = await mondayQuery(cfg, `mutation ($board: ID!, $item: ID!, $cols: JSON!) {
      change_multiple_column_values (board_id: $board, item_id: $item, column_values: $cols) { id } }`,
      { board: cfg.boardId, item: found.existing.id, cols: cols }, deps);
    if (!res.ok){
      log('OPS_UPDATE_FAILED detail=' + res.code);
      return { ok: false, code: 'monday_write_failed', detail: res.code };
    }
    log('OPS_UPDATED ref=' + payload.accountRef + ' state=' + payload.accessState);
    return { ok: true, created: false, itemId: found.existing.id, accountRef: payload.accountRef };
  }

  if (!cfg.groupId){ log('OPS_GROUP_NOT_CONFIGURED'); return { ok: false, code: 'group_not_configured' }; }
  const res = await mondayQuery(cfg, `mutation ($board: ID!, $group: String!, $name: String!, $cols: JSON!) {
    create_item (board_id: $board, group_id: $group, item_name: $name,
                 column_values: $cols, create_labels_if_missing: false) { id } }`,
    { board: cfg.boardId, group: cfg.groupId, name: itemName(payload), cols: cols }, deps);
  if (!res.ok){
    log('OPS_CREATE_FAILED detail=' + res.code);
    return { ok: false, code: 'monday_write_failed', detail: res.code };
  }
  const id = ((res.data || {}).create_item || {}).id || null;
  if (!id){ log('OPS_NO_ITEM_ID'); return { ok: false, code: 'no_item_id' }; }
  log('OPS_CREATED ref=' + payload.accountRef + ' state=' + payload.accessState);
  return { ok: true, created: true, itemId: id, accountRef: payload.accountRef };
}

/* ---------------------------------------------------------------------------
 * THE CALL SITE'S HELPER — read the facts, project, sync.
 *
 * Every lifecycle change already ends by re-deriving the entitlement from the
 * canonical rows. This reads the same rows one more time and mirrors them. It
 * is deliberately a SEPARATE read rather than a parameter threaded through the
 * webhook: the board must show what the database says after the write, not what
 * the writer believed it was writing. Those are the same thing right up until
 * they are not, and the version that mirrors the writer's intention is the one
 * that hides a bug.
 *
 * NEVER THROWS, NEVER FAILS A CALLER. Every path returns a report. The board is
 * a mirror; a mirror being late is not a reason to fail a purchase.
 * ------------------------------------------------------------------------- */
async function syncAccountFromStore(S, Store, E, cfg, accountId, deps){
  const c = (deps && deps.config) || config();
  if (!c.enabled) return { ok: false, code: 'operational_sync_disabled' };
  try{
    const facts = await Store.readCommercialFacts(S, cfg, accountId);
    if (!facts.ok) return { ok: false, code: 'facts_unreadable', detail: facts.reason };

    const view = await S.sb(cfg, '/account_operational_state?select=*&account_id=eq.' +
      encodeURIComponent(accountId) + '&limit=1');
    if (!view || !view.ok) return { ok: false, code: 'view_unreadable' };
    const row = ((await view.json().catch(function(){ return null; })) || [])[0] || null;
    if (!row) return { ok: false, code: 'no_operational_row' };

    const ent = E.resolveStandardEntitlement({
      account: facts.account, subscriptions: facts.subscriptions,
      grants: facts.grants, now: new Date()
    });

    /* The subscription the athlete is actually living under, which is the one
       the resolver is granting from -- not simply the newest row. A cancelled
       leftover sorted above a live one would put the wrong period and the wrong
       pause state on the board. */
    const at = new Date();
    const live = (facts.subscriptions || []).filter(function(sub){
      const a = E.subscriptionAccess ? E.subscriptionAccess(sub, at) : null;
      return a ? (a.active || a.reason === 'paused') : false;
    })[0] || (facts.subscriptions || [])[0] || {};

    return await syncAccount({ operational: row, entitlement: ent, subscription: live,
                               now: at }, Object.assign({ config: c }, deps || {}));
  }catch(e){
    log('OPS_SYNC_THREW');
    return { ok: false, code: 'sync_threw' };
  }
}

module.exports = {
  ALLOWED, PROHIBITED, SUSPICIOUS, ACCESS_STATES, COLUMN_IDS,
  config, accountRef, operationalPayload, validatePayload, accessStateOf,
  columnValues, itemName, findItem, syncAccount, syncAccountFromStore
};
