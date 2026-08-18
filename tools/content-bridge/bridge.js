#!/usr/bin/env node
'use strict';
/* CONTENT BRIDGE — PROTOTYPE. Operator-run, outside Valhalla, no automatic egress.
 *
 * This file is the boundary. Everything on the Valhalla side of it is a coaching
 * product that knows nothing about marketing; everything on the far side is
 * editorial work that never sees an athlete's body data or their words.
 *
 * THE RULE THIS FILE ENFORCES, and the reason it is written as an allow-list:
 * a deny-list is a promise to remember every future field somebody adds to a
 * training day. This refuses anything it was not explicitly told to accept, so a
 * new field in Valhalla cannot leak by default — it fails the gate instead.
 */
const fs = require('fs');
const path = require('path');

const STATE = path.join(__dirname, '.state.json');

/* The complete permitted payload. Mirrors CONTENT_CANDIDATE_FIELDS in the
 * runtime; a test asserts the two lists are identical, so they cannot drift. */
const ALLOWED = [
  'v', 'candidateId', 'date', 'sessionKind', 'distanceKm',
  'notableBecause', 'executionScore', 'goalDistanceLabel',
  'contentSource', 'marketingEligible'
];

/* Named so a rejection message can say WHAT was refused without echoing the
 * value back into a log. These are the fields whose presence means the export
 * came from somewhere it should not have. */
const FORBIDDEN = [
  'hr', 'heartRate', 'pace', 'rpe', 'feel', 'notes', 'notesOriginal',
  'notesSignals', 'splits', 'email', 'uid', 'userId', 'user_id', 'lat', 'lon',
  'actual', 'setup', 'days', 'plan', 'state', 'readiness', 'goals', 'benchmark'
];

const readState = () =>
  fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { candidates: {} };
const writeState = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
const die = (msg) => { console.error('REFUSED: ' + msg); process.exit(1); };

/* ---------------------------------------------------------------------------
 * 1. INGEST — the gate. Nothing reaches monday.com without passing this.
 * ------------------------------------------------------------------------- */
function validate(c) {
  const problems = [];
  if (!c || typeof c !== 'object' || Array.isArray(c)) return ['not an object'];

  const keys = Object.keys(c);
  const extra = keys.filter((k) => !ALLOWED.includes(k));
  if (extra.length) problems.push('fields not on the allow-list: ' + extra.join(', '));

  const hit = keys.filter((k) => FORBIDDEN.includes(k));
  if (hit.length) problems.push('fields that must never cross the boundary: ' + hit.join(', '));

  // Founder only. Both flags must be explicitly true — absence is a refusal,
  // never a default.
  if (c.contentSource !== 'founder') problems.push('contentSource must be exactly "founder"');
  if (c.marketingEligible !== true) problems.push('marketingEligible must be explicitly true');

  if (!c.candidateId || typeof c.candidateId !== 'string') problems.push('missing candidateId');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date || '')) problems.push('date must be ISO yyyy-mm-dd');

  // Free text is where personal detail hides. The only prose permitted is the
  // product's own deterministic sentence, so anything unrecognised is refused
  // rather than trusted.
  const ALLOWED_REASONS = [
    'Race completed to plan.',
    'Benchmark effort completed to plan, resetting training paces.',
    'Quality session executed at the fast end of its prescribed window with heart rate controlled.'
  ];
  if (!ALLOWED_REASONS.includes(c.notableBecause))
    problems.push('notableBecause is not one of the product\'s own deterministic sentences');

  return problems;
}

function ingest(file) {
  if (!file) die('ingest needs a candidates file');
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return die('could not read ' + file + ': ' + e.message); }

  const list = Array.isArray(raw) ? raw : [raw];
  const st = readState();
  let accepted = 0;

  list.forEach((c, i) => {
    const problems = validate(c);
    if (problems.length) {
      console.error('  [' + i + '] REFUSED — ' + problems.join('; '));
      return;
    }
    // Rebuild rather than store what arrived: even a validated object is copied
    // field by field, so nothing unexpected survives ingestion.
    const clean = {};
    ALLOWED.forEach((k) => { if (c[k] !== undefined) clean[k] = c[k]; });
    st.candidates[clean.candidateId] = {
      candidate: clean,
      status: 'ingested',
      mondayItemId: null,
      draft: null,
      approvedBy: null,
      approvedAt: null
    };
    accepted++;
    console.log('  [' + i + '] accepted ' + clean.candidateId);
  });

  writeState(st);
  console.log('ingested ' + accepted + ' of ' + list.length);
  if (accepted) pushToMonday();
}

/* ---------------------------------------------------------------------------
 * 2. PUSH TO monday.com — MOCK. See J_MONDAY_CONTRACT.md for the real shape.
 * ------------------------------------------------------------------------- */
function mondayClient() {
  /* The live client would go here. It is deliberately absent: the monday.com
   * connector was unavailable when this was built, so no board schema was
   * guessed at and nothing was written to a real workspace. */
  return {
    live: false,
    createItem(boardHint, name, columnValues) {
      const id = 'mock-' + Buffer.from(name).toString('hex').slice(0, 10);
      console.log('    [MOCK monday.com] create item on ' + boardHint);
      console.log('      name    : ' + name);
      console.log('      columns : ' + JSON.stringify(columnValues));
      return { id };
    }
  };
}

function pushToMonday() {
  const st = readState();
  const client = mondayClient();
  Object.values(st.candidates).forEach((rec) => {
    if (rec.status !== 'ingested') return;
    const c = rec.candidate;
    const item = client.createItem('Content Candidates', c.candidateId, {
      date: c.date,
      session_kind: c.sessionKind,
      distance_km: c.distanceKm,
      execution_score: c.executionScore,
      goal: c.goalDistanceLabel,
      why_notable: c.notableBecause,
      source: c.contentSource,
      status: 'Needs review'
    });
    rec.mondayItemId = item.id;
    rec.status = 'awaiting_review';
  });
  writeState(st);
}

/* ---------------------------------------------------------------------------
 * 3. GENERATE — MOCK. The AI step never sees more than the allow-listed record.
 * ------------------------------------------------------------------------- */
function generate(id) {
  const st = readState();
  const rec = st.candidates[id];
  if (!rec) return die('unknown candidate ' + id);
  if (rec.status !== 'awaiting_review') return die(id + ' is ' + rec.status + ', not awaiting review');

  /* WHAT THE MODEL WOULD BE GIVEN — exactly the stored candidate and nothing
   * assembled alongside it. Printed here so the payload is auditable before any
   * provider is ever connected. */
  const promptPayload = rec.candidate;
  console.log('  [MOCK generate] model input would be exactly:');
  console.log('  ' + JSON.stringify(promptPayload));

  rec.draft = {
    generatedBy: 'mock',
    angles: [
      'The session itself: what a ' + rec.candidate.sessionKind + ' is for and why this one landed.',
      'The method: a plan that reads what actually happened rather than what was scheduled.',
      'The build: training toward ' + (rec.candidate.goalDistanceLabel || 'the goal') + '.'
    ],
    /* No caption, no hashtags, no platform, no schedule. Angles are editorial
     * starting points for a human, not finished posts, and this prototype does
     * not decide where anything would go. */
    note: 'Suggested angles only. A human writes the material.'
  };
  rec.status = 'drafted';
  writeState(st);
  console.log('  drafted ' + id + ' — returned to monday.com item ' + rec.mondayItemId);
}

/* ---------------------------------------------------------------------------
 * 4. APPROVE — the mandatory human gate.
 * ------------------------------------------------------------------------- */
function approve(id, who) {
  const st = readState();
  const rec = st.candidates[id];
  if (!rec) return die('unknown candidate ' + id);
  if (rec.status !== 'drafted') return die(id + ' is ' + rec.status + '; only a drafted candidate can be approved');
  if (!who) return die('approval must name a person');
  rec.approvedBy = who;
  rec.approvedAt = new Date().toISOString();
  rec.status = 'approved';
  writeState(st);
  console.log('  approved ' + id + ' by ' + who);
  console.log('  NOTE: approval authorises a human to publish. Nothing is published by this tool.');
}

/* ---------------------------------------------------------------------------
 * 5. PUBLISH — NOT BUILT, AND REFUSES.
 * ------------------------------------------------------------------------- */
function publish(id) {
  console.error('REFUSED: automatic publication is not implemented in this prototype.');
  console.error('  Approval (' + (id || 'n/a') + ') authorises a HUMAN to publish.');
  console.error('  A publishing integration must be demonstrated in a non-production account');
  console.error('  and signed off by HQ before it exists at all.');
  process.exit(2);
}

function review() {
  const st = readState();
  const rows = Object.values(st.candidates);
  if (!rows.length) return console.log('no candidates');
  rows.forEach((r) => {
    console.log([
      r.candidate.candidateId.padEnd(28),
      String(r.status).padEnd(16),
      'monday:' + (r.mondayItemId || '-'),
      r.approvedBy ? 'approved by ' + r.approvedBy : ''
    ].join(' '));
  });
}

const [cmd, arg, arg2] = process.argv.slice(2);
switch (cmd) {
  case 'ingest':   ingest(arg); break;
  case 'review':   review(); break;
  case 'generate': generate(arg); break;
  case 'approve':  approve(arg, arg2); break;
  case 'publish':  publish(arg); break;
  default:
    console.log('usage: bridge.js ingest <file> | review | generate <id> | approve <id> <who> | publish <id>');
}

module.exports = { validate, ALLOWED, FORBIDDEN };
