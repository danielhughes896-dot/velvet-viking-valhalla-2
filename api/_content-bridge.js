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
 * publish anything, and it writes none of the downstream creative fields
 * (Format, AI Content Pack, Review Feedback, Assets, Final Caption, Content
 * Pillar) or publishing fields (Publish Status, Publish At, Publish Channel,
 * Published URL, Publish Notes) -- those belong to the monday agent, to human
 * editors and to the publisher. Valhalla's responsibility ends the moment a
 * candidate exists with status Candidate.
 */

/* ---------------------------------------------------------------------------
 * THE BOARD. Supplied by HQ and treated as configuration, not as something to
 * discover: guessing a column id would write athlete-derived facts into an
 * unknown field on a live board.
 * ------------------------------------------------------------------------- */
const BOARD_ID = '5102476403';
/* "APP DATA — Valhalla Evidence" on that board. A documented default rather than
 * a required variable: it is a structural fact of the destination, not a secret,
 * and a deployment that forgot to set it would otherwise fail closed for a
 * reason nobody could see. Still overridable by environment. */
const GROUP_ID = 'group_mm6bbdp2';

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
 * at the boundary rather than implied by absence, and asserted by test.
 *
 * Being on this list is belt and braces, not the mechanism: columnValues() only
 * ever builds the seven ids in COL, so a column that is not there cannot be
 * written whether or not it is named here. The list exists so that a human
 * reading this file can see WHICH fields are somebody else's, and so that a
 * future edit adding one of them to the mapping fails a test instead of quietly
 * writing into editorial work.
 *
 * Every id below was read back from the live board (5102476403) rather than
 * assumed. Final Caption and Content Pillar were added after that read: they
 * exist on the board and are downstream creative fields, so they belong on the
 * prohibition list even though they were already unreachable. */
const NEVER_WRITTEN = {
  format:         'text_mm6bgw2m',
  aiContentPack:  'long_text_mm6b1ffe',
  reviewFeedback: 'long_text_mm6bqk4t',
  assets:         'file_mm6b29rv',
  finalCaption:   'long_text_mm6cs4p5',
  contentPillar:  'dropdown_mm6c1y7x'
};

/* The publishing-authority columns, likewise read from the live board. Valhalla
 * has no publishing capability at all, so these are listed for the same reason:
 * a reader can see the whole set of fields this boundary refuses, and a future
 * mapping edit that reached one would fail rather than schedule a post. */
const PUBLISH_COLUMNS = {
  publishStatus:  'color_mm6bbheh',
  publishAt:      'date_mm6bp6jk',
  publishChannel: 'text_mm6b33ak',
  publishedUrl:   'link_mm6b3wv1',
  publishNotes:   'long_text_mm6b2h52'
};

const INITIAL_STATUS = 'Candidate';

/* HQ's upstream mapping names this value as `Valhalla`. It was `Founder /
 * Valhalla` while the bridge was a founder-only manual export; the destination
 * group now carries that meaning ("APP DATA — Valhalla Evidence") and the
 * column says which SYSTEM supplied the evidence. Overridable by environment so
 * a downstream automation keyed to the older string can be reconciled without a
 * deploy. */
const SOURCE_LABEL = 'Valhalla';

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
  /* The destination group, passed on EVERY create_item and never left to
     monday's default: a group-less create lands in the board's first group,
     which is where human editorial work sits, and machine evidence appearing
     there would be a real defect.

     UNSET means "use the documented default". Set-but-empty means somebody
     deliberately blanked it, and that is a refusal to write rather than a
     silent fallback -- otherwise the guard below could never fire. */
  const rawGroup = process.env.MONDAY_CONTENT_GROUP_ID;
  const groupId = (rawGroup === undefined ? GROUP_ID : String(rawGroup)).trim();
  const enabled = /^(on|true|1|yes|enabled)$/i.test(
    String(process.env.VVV_CONTENT_BRIDGE_ENABLED || '').trim());
  return {
    boardId,
    groupId,
    sourceLabel: String(process.env.MONDAY_CONTENT_SOURCE_LABEL || SOURCE_LABEL),
    enabled,
    hasToken: !!token,
    hasGroup: !!groupId,
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

function columnValues(c, sourceLabel){
  const v = {};
  v[COL.candidateId]  = c.candidateId;
  v[COL.source]       = sourceLabel || SOURCE_LABEL;
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
/* The HTTP call is injectable so the commissioning test can drive the complete
 * upstream path -- eligibility, DTO, validation, idempotency, mapping -- against
 * a recording double instead of a live board. It is the ONLY seam: everything
 * above it is the same code production runs. */
async function mondayQuery(cfg, query, variables, deps){
  const doFetch = (deps && deps.fetch) || fetch;
  const r = await doFetch('https://api.monday.com/v2', {
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
async function findExisting(cfg, candidateId, deps){
  /* THE TYPES HERE ARE NOT COSMETIC. This was written as
       ($board: [ID!], $col: String!, $val: [String])   board: [cfg.boardId]
     which the live API rejects: items_page_by_column_values takes board_id as a
     single ID!, and column_values as a non-null [String]!. Every export would
     have failed the lookup, returned monday_unavailable, and created NOTHING --
     the whole pipeline dead on arrival, in a way a mock that only pattern-matched
     the query string could never reveal. Verified against the live board. */
  const query = `query ($board: ID!, $col: String!, $val: [String]!) {
    items_page_by_column_values (limit: 1, board_id: $board,
      columns: [{column_id: $col, column_values: $val}]) { items { id name } } }`;
  const res = await mondayQuery(cfg, query, {
    board: cfg.boardId, col: COL.candidateId, val: [candidateId]
  }, deps);
  if (!res.ok) return { ok: false, code: res.code };
  const items = (((res.data || {}).items_page_by_column_values || {}).items) || [];
  return { ok: true, existing: items.length ? items[0] : null };
}

async function createItem(cfg, c, deps){
  /* group_id is mandatory here, not optional: see config(). The item must land
     in "APP DATA — Valhalla Evidence", never in the editorial group. */
  const query = `mutation ($board: ID!, $group: String!, $name: String!, $cols: JSON!) {
    create_item (board_id: $board, group_id: $group, item_name: $name,
                 column_values: $cols, create_labels_if_missing: false) { id } }`;
  const res = await mondayQuery(cfg, query, {
    board: cfg.boardId, group: cfg.groupId, name: itemName(c),
    cols: JSON.stringify(columnValues(c, cfg.sourceLabel))
  }, deps);
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
async function exportCandidate(candidate, founderVerified, deps){
  const cfg = config();

  if (founderVerified !== true) return { ok: false, status: 403, code: 'not_founder' };
  if (!cfg.enabled)             return { ok: false, status: 503, code: 'bridge_disabled' };
  if (!cfg.hasToken)            return { ok: false, status: 503, code: 'bridge_not_configured' };
  if (!cfg.hasGroup)            return { ok: false, status: 503, code: 'bridge_group_not_configured' };

  const problems = validateCandidate(candidate);
  if (problems.length) return { ok: false, status: 400, code: 'candidate_rejected', problems };

  const clean = sanitise(candidate);

  const found = await findExisting(cfg, clean.candidateId, deps);
  if (!found.ok) return { ok: false, status: 502, code: 'monday_unavailable', detail: found.code };
  if (found.existing)
    return { ok: true, status: 200, created: false, itemId: found.existing.id,
             candidateId: clean.candidateId };

  const made = await createItem(cfg, clean, deps);
  if (!made.ok) return { ok: false, status: 502, code: 'monday_write_failed', detail: made.code };

  return { ok: true, status: 201, created: true, itemId: made.itemId,
           candidateId: clean.candidateId };
}

module.exports = {
  BOARD_ID, GROUP_ID, COL, NEVER_WRITTEN, PUBLISH_COLUMNS, INITIAL_STATUS, SOURCE_LABEL,
  ALLOWED, PROHIBITED, ALLOWED_REASONS,
  config, validateCandidate, sanitise, itemName, columnValues,
  findExisting, createItem, exportCandidate
};
