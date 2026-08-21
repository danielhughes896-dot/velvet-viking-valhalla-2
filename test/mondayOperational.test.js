'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// THE OPERATIONAL BOARD.
//
// Supabase is the source of truth. monday is where a human looks to see how the
// business is doing. Two rules make that safe, and both are enforced here
// rather than remembered:
//
//   nothing on the board is an authority -- no access decision is ever read
//   back from it, so a wrong, stale, hand-edited or deleted board changes
//   nobody's access by one second;
//
//   nothing coaching-related crosses -- not a session, a pace, a heart rate, an
//   RPE, a readiness score, a note or a training history. A third-party board
//   is not where health-indicating data goes.

const ROOT = path.join(__dirname, '..');
const M = require(path.join(ROOT, 'api', '_monday-operational.js'));
const E = require(path.join(ROOT, 'api', '_entitlement.js'));

const ACC = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CFG = M.config({
  VVV_MONDAY_OPERATIONAL: 'on', MONDAY_API_TOKEN: 'token',
  MONDAY_OPERATIONAL_BOARD_ID: '900', MONDAY_OPERATIONAL_GROUP_ID: 'ops',
  MONDAY_OPERATIONAL_SALT: 'a-salt-that-lives-in-vercel'
});

const view = (over) => Object.assign({
  account_id: ACC,
  account_created_at: '2026-01-15T09:00:00Z',
  last_active_at: '2026-08-19T07:30:00Z',
  trial_consumed_at: null, trial_blocked_at: null,
  trial_ends_at: null, trial_active: false, admin_grant_active: false,
  subscription_condition: null, subscription_provider: null, paid_through: null
}, over || {});

const build = (over) => M.operationalPayload(Object.assign({
  operational: view(), entitlement: { active: false, reason: 'none', commercialState: 'none' },
  subscription: {}, now: '2026-08-21T12:00:00Z'
}, over || {}), CFG);

// ===========================================================================
// THE OPAQUE REFERENCE
// ===========================================================================
test('the account uuid never leaves the database', () => {
  // The uuid is the auth.users id -- the value that keys every table. On a
  // third-party board it turns that board into a lookup into the database for
  // anybody who can see it.
  const p = build().payload;
  assert.match(p.accountRef, /^VVV-[0-9A-F]{20}$/);
  assert.equal(JSON.stringify(p).indexOf(ACC), -1);
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    .test(JSON.stringify(p)), false);
});

test('the reference is stable, and different accounts do not collide', () => {
  assert.equal(M.accountRef(ACC, CFG), M.accountRef(ACC, CFG),
    'an unstable reference means a second board item every sync');
  assert.notEqual(M.accountRef(ACC, CFG), M.accountRef(OTHER, CFG));
});

test('a different salt gives a different reference, so the board cannot be reversed', () => {
  const other = M.config({ MONDAY_OPERATIONAL_SALT: 'a-different-salt' });
  assert.notEqual(M.accountRef(ACC, CFG), M.accountRef(ACC, other));
});

test('no salt means no sync -- never a fallback to the raw uuid', () => {
  // This is the shortcut that would be taken at 2am to get a board working.
  const noSalt = M.config({ VVV_MONDAY_OPERATIONAL: 'on', MONDAY_API_TOKEN: 't',
                            MONDAY_OPERATIONAL_BOARD_ID: '900' });
  assert.equal(M.accountRef(ACC, noSalt), null);
  const r = M.operationalPayload({ operational: view() }, noSalt);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_account_reference');
});

// ===========================================================================
// WHAT MAY CROSS, AND WHAT MAY NOT
// ===========================================================================
test('the payload is exactly the allow list, and nothing else', () => {
  const p = build().payload;
  for (const k of Object.keys(p)) assert.ok(M.ALLOWED.indexOf(k) !== -1, 'unexpected field ' + k);
});

test('the projection names what it takes rather than deleting what it should not', () => {
  // A projection that SUBTRACTS leaks every field somebody adds upstream later.
  // Proven by handing it a view row stuffed with things that must not cross.
  const poisoned = view({
    email: 'athlete@example.test', notes: 'felt awful, hip pain',
    pace: '4:32', heart_rate: 168, rpe: 9, readiness: 'poor',
    training_history: [1, 2, 3], vdot: 52, stripe_customer_id: 'cus_123'
  });
  const p = M.operationalPayload({ operational: poisoned,
    entitlement: { active: true, reason: 'paid', commercialState: 'paid' } }, CFG).payload;
  for (const k of ['email','notes','pace','heart_rate','rpe','readiness',
                   'training_history','vdot','stripe_customer_id']){
    assert.equal(Object.prototype.hasOwnProperty.call(p, k), false, k + ' crossed');
  }
  assert.equal(JSON.stringify(p).indexOf('athlete@example.test'), -1);
  assert.equal(JSON.stringify(p).indexOf('hip pain'), -1);
});

test('the gate refuses anything that even looks like training or health data', () => {
  for (const field of ['pace', 'heartRate', 'rpe', 'readiness', 'sessionCount',
                       'weeklyDistance', 'sleepScore', 'hrv', 'injuryNote']){
    const bad = {}; bad.accountRef = M.accountRef(ACC, CFG); bad[field] = 'x';
    const problems = M.validatePayload(bad);
    assert.ok(problems.length > 0, field + ' was allowed through');
  }
});

test('the gate refuses a uuid or an email hiding in a value', () => {
  const ref = M.accountRef(ACC, CFG);
  assert.ok(M.validatePayload({ accountRef: ref, accessReason: ACC }).length > 0);
  assert.ok(M.validatePayload({ accountRef: ref, accessReason: 'a@b.test' }).length > 0);
  assert.equal(M.validatePayload({ accountRef: ref, accessReason: 'trial' }).length, 0);
});

test('a raw uuid cannot be passed off as an account reference', () => {
  assert.ok(M.validatePayload({ accountRef: ACC }).length > 0);
  assert.ok(M.validatePayload({ accountRef: 'anything-else' }).length > 0);
});

test('every prohibited name is genuinely prohibited', () => {
  for (const field of M.PROHIBITED){
    const bad = { accountRef: M.accountRef(ACC, CFG) };
    bad[field] = 'x';
    assert.ok(M.validatePayload(bad).length > 0, field + ' passed the gate');
  }
});

// ===========================================================================
// WHAT THE BOARD ACTUALLY SAYS
// ===========================================================================
test('a live provider trial reads as a live trial', () => {
  const p = build({
    operational: view({ trial_active: true, trial_ends_at: '2026-09-04T00:00:00Z',
                        trial_consumed_at: '2026-08-21T00:00:00Z',
                        subscription_condition: 'trialing', subscription_provider: 'web' }),
    entitlement: { active: true, reason: 'trial', commercialState: 'trial' },
    subscription: { billing_period: 'monthly' }
  }).payload;
  assert.equal(p.trialActive, true);
  assert.equal(p.trialEnds, '2026-09-04');
  assert.equal(p.trialStarted, '2026-08-21');
  assert.equal(p.paidActive, false);
  assert.equal(p.billingPeriod, 'monthly');
  assert.equal(p.accessState, 'open');
});

test('a paused subscriber is not reported as active, and the resume date shows', () => {
  const sub = { billing_period: 'monthly', paused_at: '2026-08-01T00:00:00Z',
                pause_resumes_at: '2026-11-01T00:00:00Z' };
  const ent = E.resolveStandardEntitlement({
    subscriptions: [Object.assign({ provider: 'web', product_code: 'VALHALLA_STANDARD',
      condition: 'active', current_period_end: '2027-01-01T00:00:00Z' }, sub)],
    grants: [], now: '2026-09-01T00:00:00Z'
  });
  const p = build({ subscription: sub, entitlement: ent,
    operational: view({ subscription_condition: 'active', subscription_provider: 'web' }) }).payload;
  assert.equal(p.paused, true);
  assert.equal(p.pauseResumes, '2026-11-01');
  assert.equal(p.commercialState, 'paused');
  assert.equal(p.accessState, 'soft_locked');
  assert.equal(p.accessReason, 'paused');
});

test('an admin grant is not read as a customer', () => {
  // A beta tester on the board looking like a paying subscriber is how a
  // revenue number becomes wrong.
  const p = build({ operational: view({ admin_grant_active: true }),
                    entitlement: { active: true, reason: 'admin_beta', commercialState: 'none' } }).payload;
  assert.equal(p.adminGrant, true);
  assert.equal(p.paidActive, false);
  assert.equal(p.trialActive, false);
});

test('the three access states an operator needs to tell apart', () => {
  assert.equal(M.accessStateOf({ active: true, reason: 'paid' }), 'open');
  // A purchase away -- this is who to talk to.
  assert.equal(M.accessStateOf({ active: false, reason: 'expired' }), 'soft_locked');
  assert.equal(M.accessStateOf({ active: false, reason: 'none' }), 'soft_locked');
  assert.equal(M.accessStateOf({ active: false, reason: 'paused' }), 'soft_locked');
  // A different conversation entirely.
  assert.equal(M.accessStateOf({ active: false, reason: 'revoked' }), 'locked');
  assert.equal(M.accessStateOf({ active: false, reason: 'payment_hold' }), 'locked');
});

test('cancellation shows as cancelling while it is still running', () => {
  const p = build({ subscription: { billing_period: 'yearly', cancel_at_period_end: true },
                    operational: view({ subscription_condition: 'active',
                                        paid_through: '2026-12-31T00:00:00Z' }),
                    entitlement: { active: true, reason: 'paid', commercialState: 'cancelled_active' } }).payload;
  assert.equal(p.cancelling, true);
  assert.equal(p.paidActive, true);
  assert.equal(p.paidThrough, '2026-12-31');
  assert.equal(p.commercialState, 'cancelled_active');
});

// ===========================================================================
// THE BOARD WRITE
// ===========================================================================
test('a cleared value clears the cell rather than leaving a stale one', () => {
  // Omitting a key leaves whatever was there, which is how a resumed athlete
  // keeps showing a pause end date forever.
  const cols = M.columnValues(build().payload);
  assert.deepEqual(cols[M.COLUMN_IDS.pauseResumes], {});
  assert.deepEqual(cols[M.COLUMN_IDS.trialEnds], {});
  assert.deepEqual(cols[M.COLUMN_IDS.paused], { checked: 'false' });
  const set = M.columnValues(build({
    subscription: { paused_at: '2026-08-01T00:00:00Z', pause_resumes_at: '2026-11-01T00:00:00Z' }
  }).payload);
  assert.deepEqual(set[M.COLUMN_IDS.pauseResumes], { date: '2026-11-01' });
  assert.deepEqual(set[M.COLUMN_IDS.paused], { checked: 'true' });
});

test('every allowed field has a column, and every column an allowed field', () => {
  for (const k of M.ALLOWED) assert.ok(M.COLUMN_IDS[k], k + ' has no column on the board');
  for (const k of Object.keys(M.COLUMN_IDS)) assert.ok(M.ALLOWED.indexOf(k) !== -1, k + ' is not allowed');
  const ids = Object.values(M.COLUMN_IDS);
  assert.equal(new Set(ids).size, ids.length, 'two fields share a column id');
});

test('the sync is idempotent: one account, one item, ever', async () => {
  const calls = [];
  const fetchStub = (existing) => async (u, init) => {
    const q = JSON.parse(init.body);
    calls.push(q.query);
    if (/items_page_by_column_values/.test(q.query)){
      return { ok: true, status: 200, json: async () => ({ data: { items_page_by_column_values:
        { items: existing ? [{ id: '77', name: q.variables.val[0] }] : [] } } }) };
    }
    if (/change_multiple_column_values/.test(q.query))
      return { ok: true, status: 200, json: async () => ({ data: { change_multiple_column_values: { id: '77' } } }) };
    return { ok: true, status: 200, json: async () => ({ data: { create_item: { id: '77' } } }) };
  };
  const input = { operational: view(), entitlement: { active: false, reason: 'none' }, subscription: {} };

  const first = await M.syncAccount(input, { config: CFG, fetch: fetchStub(false) });
  assert.equal(first.ok, true);
  assert.equal(first.created, true);

  const second = await M.syncAccount(input, { config: CFG, fetch: fetchStub(true) });
  assert.equal(second.ok, true);
  assert.equal(second.created, false, 'a re-sync must update, never create a second item');
  assert.equal(second.itemId, '77');
  assert.ok(calls.some(c => /items_page_by_column_values/.test(c)),
    'the board is asked before anything is created');
});

test('the sync is off unless somebody turns it on', async () => {
  const off = M.config({ MONDAY_API_TOKEN: 't', MONDAY_OPERATIONAL_BOARD_ID: '1',
                         MONDAY_OPERATIONAL_SALT: 's' });
  const r = await M.syncAccount({ operational: view() },
    { config: off, fetch: async () => { throw new Error('must not reach monday'); } });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'operational_sync_disabled');
});

test('a monday outage is a stale board, never a failed purchase', async () => {
  const r = await M.syncAccount({ operational: view(), entitlement: {}, subscription: {} },
    { config: CFG, fetch: async () => { throw new Error('network down'); } });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'monday_unavailable');
  // A report, not a throw: no caller is expected to abort on it.
  assert.equal(typeof r.code, 'string');
});

test('a monday error body is summarised, never echoed', async () => {
  // A GraphQL error repeats the request, and the request carries the payload.
  const r = await M.syncAccount({ operational: view(), entitlement: {}, subscription: {} },
    { config: CFG, fetch: async () => ({ ok: true, status: 200,
      json: async () => ({ errors: [{ message: 'board 900 column text_account_ref VVV-DEADBEEF' }] }) }) });
  assert.equal(r.ok, false);
  assert.equal(r.detail, 'graphql_error');
  assert.equal(/DEADBEEF/.test(JSON.stringify(r)), false);
});

// ===========================================================================
// THE BOARD IS NOT AN AUTHORITY
// ===========================================================================
test('nothing reads an entitlement back from monday', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api', '_monday-operational.js'), 'utf8');
  // The only board read is the idempotency lookup, and it returns an item id.
  const reads = src.match(/query \(\$board/g) || [];
  assert.equal(reads.length, 1, 'exactly one read path, and it is the idempotency lookup');
  assert.match(src, /items \{ id name \}/, 'and it asks for an id and a name, nothing else');

  // And no access-deciding module depends on this one, in either direction.
  for (const f of ['_access.js', '_entitlement.js', '_commercial-store.js', '_products.js']){
    const dep = fs.readFileSync(path.join(ROOT, 'api', f), 'utf8');
    assert.equal(/monday/i.test(dep), false, f + ' knows about monday');
  }
});

test('the operational board and the content board stay separate', () => {
  // Different boards, different tokens' worth of blast radius, different rules.
  // A payload that could land on either is a payload nobody is checking.
  const ops = fs.readFileSync(path.join(ROOT, 'api', '_monday-operational.js'), 'utf8');
  const content = fs.readFileSync(path.join(ROOT, 'api', '_content-bridge.js'), 'utf8');
  assert.equal(/_content-bridge/.test(ops), false);
  assert.equal(/_monday-operational/.test(content), false);
  assert.match(ops, /MONDAY_OPERATIONAL_BOARD_ID/);
  assert.equal(/MONDAY_CONTENT_BOARD_ID/.test(ops), false);
});

test('the salt is never returned from anything that gets serialised', () => {
  const cfg = M.config({ MONDAY_OPERATIONAL_SALT: 'the-actual-salt', MONDAY_API_TOKEN: 'the-token' });
  assert.equal(JSON.stringify(cfg).indexOf('the-actual-salt'), -1);
  assert.equal(JSON.stringify(cfg).indexOf('the-token'), -1);
  assert.equal(cfg.hasSalt, true);
  assert.equal(cfg.salt(), 'the-actual-salt');
});
