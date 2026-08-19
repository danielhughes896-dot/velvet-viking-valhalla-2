'use strict';
/* CONTENT BRIDGE -- the server-side export boundary.
 *
 * This module is the ONLY place in Velvet Viking that knows monday.com exists.
 * The coaching runtime emits a neutral Content Candidate and stops; everything
 * about boards, columns and workflow status lives here, behind an owner-only
 * server route, and nothing here is reachable from a browser.
 *
 * IT IS AN UNDERSCORE MODULE ON PURPOSE. Vercel turns every non-underscore file
 * in /api into a Serverless Function and the budget is full at 12/12. This is a
 * library that api/admin-user.js calls, exactly as _account-delete.js already
 * is, so the integration adds no thirteenth function.
 *
 * WHAT THIS WILL NEVER DO. It creates a candidate row and sets its status to
 * Candidate. It does not select, prepare, format, review, approve, schedule or
 * publish anything, and it never writes Format, AI Content Pack, Review Feedback
 * or Assets -- those belong to the monday agent and to human editors. Valhalla's
 * responsibility ends the moment a candidate exists with status Candidate.
 */

/* ---------------------------------------------------------------------------
 * THE BOARD. Supplied by HQ and treated as configuration, not as something to
 * discover: guessing a column id would write athlete-derived facts into an
 * unknown field on a live board.
 * ------------------------------------------------------------------------- */
const BOARD_ID = '5102476403';

const COL = {
  workflowStatus: 'color_mm6b6sh8',
  candidateId:    'text_mm6bg1dm',
  source:         'text_mm6bqkqv',
  eventType:      'text_mm6bxsvt',
  eventDate:      'date_mm6b4mcm',
  sourceFacts:    'long_text_mm6baqnt',
  marketingEligible: 'boolean_mm6bmfhp'
};

/* Columns Valhalla must NEVER write. Named here so the prohibition is visible
 * at the boundary rather than implied by absence, and asserted by test. */
const NEVER_WRITTEN = {
  format:         'text_mm6bgw2m',
  aiContentPack:  'long_text_mm6b1ffe',
  reviewFeedback: 'long_text_mm6bqk4t',
  assets:         'file_mm6b29rv'
};

const INITIAL_STATUS = 'Candidate';
const SOURCE_LABEL   = 'Founder / Valhalla';

/* The complete permitted payload -- ten fields, mirroring
 * CONTENT_CANDIDATE_FIELDS in the coaching runtime. A test asserts the two lists
 * are identical so they cannot drift apart. */
const ALLOWED = [
  'v', 'candidateId', 'date', 'sessionKind', 'distanceKm',
  'notableBecause', 'executionScore', 'goalDistanceLabel',
  'contentSource', 'marketingEligible'
];

/* Keys whose presence means the payload came from somewhere it should not have.
 * This is a SECOND line of defence, not the mechanism: the allow-list above is
 * what actually protects the boundary. This exists so a rejection can say which
 * prohibited field was seen without echoing its value into a log. */
const PROHIBITED = [
  'hr', 'heartRate', 'pace', 'rpe', 'feel', 'notes', 'notesOriginal',
  'notesSignals', 'splits', 'email', 'uid', 'userId', 'user_id',
  'lat', 'lon', 'coordinates', 'location', 'actual', 'setup', 'days',
  'plan', 'state', 'readiness', 'goals', 'benchmark'
];

/* The only prose permitted to cross. Free text is where personal detail hides,
 * so anything that is not one of the product's own deterministic sentences is
 * refused rather than trusted. */
const ALLOWED_REASONS = [
  'Race completed to plan.',
  'Benchmark effort completed to plan, resetting training paces.',
  'Quality session executed at the fast end of its prescribed window with heart rate controlled.'
];

/* ---------------------------------------------------------------------------
 * CONFIG. Secrets come from the environment and are never logged, never
 * returned to a caller, and never shipped to a browser.
 * ------------------------------------------------------------------------- */
function config(){
  const token   = process.env.MONDAY_API_TOKEN || '';
  const boardId = String(process.env.MONDAY_CONTENT_BOARD_ID || BOARD_ID);
  const enabled = /^(on|true|1|yes|enabled)$/i.test(
    String(process.env.VVV_CONTENT_BRIDGE_ENABLED || '').trim());
  return {
    boardId,
    enabled,
    hasToken: !!token,
    // Deliberately a getter rather than a field on the returned object, so a
    // careless JSON.stringify(cfg) in a future log line cannot serialise it.
    token: function(){ return token; }
  };
}

/* ---------------------------------------------------------------------------
 * VALIDATION -- the gate. Nothing reaches monday without passing this.
 * ------------------------------------------------------------------------- */
function validateCandidate(c){
  const problems = [];
  if (!c || typeof c !== 'object' || Array.isArray(c)) return ['not_an_object'];

  const keys = Object.keys(c);
  if (keys.filter(k => !ALLOWED.includes(k)).length) problems.push('field_not_allow_listed');
  if (keys.filter(k => PROHIBITED.includes(k)).length) problems.push('prohibited_field_present');

  // Founder only, and both flags explicit. Absence is a refusal, never a default.
  if (c.contentSource !== 'founder')  problems.push('source_not_founder');
  if (c.marketingEligible !== true)   problems.push('not_marketing_eligible');

  if (typeof c.candidateId !== 'string' || !c.candidateId) problems.push('missing_candidate_id');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c.date || ''))) problems.push('bad_date');
  if (typeof c.sessionKind !== 'string' || !c.sessionKind) problems.push('missing_session_kind');
  if (!ALLOWED_REASONS.includes(c.notableBecause)) problems.push('reason_not_recognised');
  if (c.v !== 1) problems.push('unknown_schema_version');
  if (c.executionScore != null && typeof c.executionScore !== 'number') problems.push('bad_score');
  if (c.distanceKm != null && typeof c.distanceKm !== 'number') problems.push('bad_distance');

  return problems;
}

/* Rebuild rather than forward. Even a validated object is copied field by field
 * into a fresh one, so nothing unexpected survives the boundary -- and a field
 * added to a training day in future cannot ride along by default. */
function sanitise(c){
  const clean = {};
  ALLOWED.forEach(k => { if (c[k] !== undefined) clean[k] = c[k]; });
  return clean;
}

/* ---------------------------------------------------------------------------
 * MAPPING. Identification, not marketing copy: the item name is assembled from
 * facts already inside the allow-listed candidate and nothing else. No hook, no
 * caption, no angle -- Valhalla does not know what those are.
 * ------------------------------------------------------------------------- */
function itemName(c){
  const parts = [c.date, String(c.sessionKind).replace(/_/g, ' ')];
  if (c.distanceKm != null) parts.push(c.distanceKm + 'km');
  return parts.join(' · ');
}

function columnValues(c){
  const v = {};
  v[COL.candidateId]  = c.candidateId;
  v[COL.source]       = SOURCE_LABEL;
  v[COL.eventType]    = c.sessionKind;           // the candidate's own representation
  v[COL.eventDate]    = { date: c.date };
  v[COL.marketingEligible] = { checked: 'true' };
  v[COL.workflowStatus]    = { label: INITIAL_STATUS };
  /* The complete ten-field candidate, stored verbatim for auditability -- and
     ONLY that object. The surrounding athlete, day and plan state is never
     serialised anywhere near this. */
  v[COL.sourceFacts]  = JSON.stringify(c, null, 2);
  return v;
}

/* ---------------------------------------------------------------------------
 * TRANSPORT
 * ------------------------------------------------------------------------- */
async function mondayQuery(cfg, query, variables){
  const r = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Authorization': cfg.token(),
      'Content-Type': 'application/json',
      'API-Version': '2024-10'
    },
    body: JSON.stringify({ query, variables })
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* handled below */ }
  if (!r.ok || !json || json.errors){
    // The monday error is summarised, never echoed wholesale: a GraphQL error
    // can quote the query, and the query carries candidate facts.
    const code = !r.ok ? ('http_' + r.status)
               : (json && json.errors && json.errors[0] && json.errors[0].message
                  ? 'graphql_error' : 'unparseable_response');
    return { ok: false, code };
  }
  return { ok: true, data: json.data };
}

/* IDEMPOTENCY. Candidate ID is the key -- never athlete identity. The board is
 * asked whether an item already carries this candidate id before anything is
 * created, so a retry after a lost response finds the existing item and returns
 * it rather than creating a second one.
 *
 * RACE LIMITATION, stated rather than hidden: monday has no unique constraint on
 * a text column and no upsert, so two genuinely simultaneous exports of the same
 * candidate could both read "absent" and both create. This is a founder-only,
 * manually triggered MVP with serial invocation, so the window is not reachable
 * in practice -- but it is a real limitation and the fix is a monday-side
 * uniqueness automation or a lock, not more retries here. */
async function findExisting(cfg, candidateId){
  const query = `query ($board: [ID!], $col: String!, $val: [String]) {
    items_page_by_column_values (limit: 1, board_id: $board,
      columns: [{column_id: $col, column_values: $val}]) { items { id name } } }`;
  const res = await mondayQuery(cfg, query, {
    board: [cfg.boardId], col: COL.candidateId, val: [candidateId]
  });
  if (!res.ok) return { ok: false, code: res.code };
  const items = (((res.data || {}).items_page_by_column_values || {}).items) || [];
  return { ok: true, existing: items.length ? items[0] : null };
}

async function createItem(cfg, c){
  const query = `mutation ($board: ID!, $name: String!, $cols: JSON!) {
    create_item (board_id: $board, item_name: $name, column_values: $cols,
                 create_labels_if_missing: false) { id } }`;
  const res = await mondayQuery(cfg, query, {
    board: cfg.boardId, name: itemName(c), cols: JSON.stringify(columnValues(c))
  });
  if (!res.ok) return { ok: false, code: res.code };
  const id = ((res.data || {}).create_item || {}).id || null;
  return id ? { ok: true, itemId: id } : { ok: false, code: 'no_item_id' };
}

/* ---------------------------------------------------------------------------
 * THE EXPORT. Called only from an owner-authenticated server route.
 *
 * `founderVerified` is passed in by the caller and must be the result of a
 * SERVER-SIDE identity check against VVV_OWNER_USER_ID. Nothing in the payload
 * is trusted to establish who the athlete is: a client-supplied
 * marketingEligible:true is necessary and never sufficient.
 * ------------------------------------------------------------------------- */
async function exportCandidate(candidate, founderVerified){
  const cfg = config();

  if (founderVerified !== true) return { ok: false, status: 403, code: 'not_founder' };
  if (!cfg.enabled)             return { ok: false, status: 503, code: 'bridge_disabled' };
  if (!cfg.hasToken)            return { ok: false, status: 503, code: 'bridge_not_configured' };

  const problems = validateCandidate(candidate);
  if (problems.length) return { ok: false, status: 400, code: 'candidate_rejected', problems };

  const clean = sanitise(candidate);

  const found = await findExisting(cfg, clean.candidateId);
  if (!found.ok) return { ok: false, status: 502, code: 'monday_unavailable', detail: found.code };
  if (found.existing)
    return { ok: true, status: 200, created: false, itemId: found.existing.id,
             candidateId: clean.candidateId };

  const made = await createItem(cfg, clean);
  if (!made.ok) return { ok: false, status: 502, code: 'monday_write_failed', detail: made.code };

  return { ok: true, status: 201, created: true, itemId: made.itemId,
           candidateId: clean.candidateId };
}

module.exports = {
  BOARD_ID, COL, NEVER_WRITTEN, INITIAL_STATUS, SOURCE_LABEL,
  ALLOWED, PROHIBITED, ALLOWED_REASONS,
  config, validateCandidate, sanitise, itemName, columnValues,
  findExisting, createItem, exportCandidate
};
