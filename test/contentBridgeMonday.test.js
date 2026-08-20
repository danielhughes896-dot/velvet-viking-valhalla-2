'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');
const CB = require('../api/_content-bridge.js');

// CONTENT BRIDGE -- SERVER BOUNDARY TESTS.
//
// This is the only code path in Velvet Viking by which anything derived from an
// athlete can leave the system. Almost every test is adversarial: they assume
// somebody will one day widen the payload, trust a client flag, or point the
// export at a beta tester, and exist to make that impossible quietly.
const ROOT = path.join(__dirname, '..');
const RUNTIME = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const BRIDGE_SRC = fs.readFileSync(path.join(ROOT, 'api/_content-bridge.js'), 'utf8');
const ADMIN_SRC = fs.readFileSync(path.join(ROOT, 'api/admin-user.js'), 'utf8');
const TODAY = '2026-08-17';

const GOOD = {
  v: 1,
  candidateId: 'vv-2026-06-04-threshold_continuous',
  date: '2026-06-04',
  sessionKind: 'threshold_continuous',
  distanceKm: 7,
  notableBecause: 'Quality session executed at the fast end of its prescribed window with heart rate controlled.',
  executionScore: 99,
  goalDistanceLabel: 'Half Marathon',
  contentSource: 'founder',
  marketingEligible: true
};
const clone = (over) => Object.assign({}, GOOD, over || {});

/* Runs exportCandidate against a scripted monday, with the environment set the
 * way a configured deployment would have it. Restores everything afterwards. */
async function withMonday(script, fn, env) {
  const realFetch = globalThis.fetch;
  const saved = {
    MONDAY_API_TOKEN: process.env.MONDAY_API_TOKEN,
    MONDAY_CONTENT_BOARD_ID: process.env.MONDAY_CONTENT_BOARD_ID,
    MONDAY_CONTENT_GROUP_ID: process.env.MONDAY_CONTENT_GROUP_ID,
    MONDAY_CONTENT_SOURCE_LABEL: process.env.MONDAY_CONTENT_SOURCE_LABEL,
    VVV_CONTENT_BRIDGE_ENABLED: process.env.VVV_CONTENT_BRIDGE_ENABLED
  };
  process.env.MONDAY_API_TOKEN = 'test-token-never-real';
  process.env.MONDAY_CONTENT_BOARD_ID = '5102476403';
  // The destination group, "APP DATA — Valhalla Evidence". Required config.
  process.env.MONDAY_CONTENT_GROUP_ID = 'group_test_valhalla_evidence';
  delete process.env.MONDAY_CONTENT_SOURCE_LABEL;
  process.env.VVV_CONTENT_BRIDGE_ENABLED = 'on';
  Object.assign(process.env, env || {});
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, headers: opts.headers, query: body.query, variables: body.variables });
    return script(body, calls.length);
  };
  try { return { result: await fn(), calls }; }
  finally {
    globalThis.fetch = realFetch;
    Object.keys(saved).forEach(k => {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    });
  }
}
const reply = (data) => ({ ok: true, status: 200, text: async () => JSON.stringify({ data }) });
const EMPTY_SEARCH = { items_page_by_column_values: { items: [] } };

// ---------------------------------------------------------------------------
// 1-5. THE CONTRACT AND THE ALLOW-LIST
// ---------------------------------------------------------------------------
test('1. the Content Candidate contract is exactly ten named fields', () => {
  assert.equal(CB.ALLOWED.length, 10);
  assert.equal(
    CB.ALLOWED.slice().sort().join(','),
    ['candidateId','contentSource','date','distanceKm','executionScore',
     'goalDistanceLabel','marketingEligible','notableBecause','sessionKind','v'].join(',')
  );
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  assert.equal(
    a.CONTENT_CANDIDATE_FIELDS.slice().sort().join(','),
    CB.ALLOWED.slice().sort().join(','),
    'runtime and server boundary must agree, or one of them is wrong'
  );
});

test('2. no prohibited field can cross the boundary', () => {
  const prohibited = {
    hr: 152, heartRate: 152, pace: '4:10', rpe: 8, feel: 'poor',
    notes: 'shin sore', notesOriginal: 'shin sore', notesSignals: {}, splits: [1, 2],
    email: 'a@b.com', uid: 'abc', userId: 'abc', user_id: 'abc',
    lat: 53.7, lon: -1.8, coordinates: {}, location: 'Halifax',
    actual: {}, setup: {}, days: [], plan: {}, state: {},
    readiness: {}, goals: {}, benchmark: {}
  };
  Object.keys(prohibited).forEach(k => {
    const bad = clone(); bad[k] = prohibited[k];
    const problems = CB.validateCandidate(bad);
    assert.ok(problems.length > 0, k + ' must be refused');
  });
  assert.equal(CB.validateCandidate(GOOD).length, 0, 'the good case must still pass');
});

test('3. an arbitrary future athlete-state field cannot leak', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {};
  buildPlan(a, { weeks: 12, startDate: '2026-06-01', distanceKey: 'half' });
  const dd = a.state.days.filter(d => d.type === 'threshold' && d.date < TODAY)[0];
  const tr = a.executionPaceTarget(dd), z = a.executionHRTarget(dd);
  dd.completed = true;
  dd.actual = { km: dd.km, pace: a.secToPace(Math.round(tr.fast - 2)),
                hr: z && z.hi ? z.hi - 4 : null, rpe: 7, feel: 'good',
                notes: 'felt strong, shin was a bit sore afterwards' };
  // A feature added next year adds fields nobody revisited this test for.
  dd.futureInjuryFlag = 'suspected stress fracture';
  dd.actual.futureBodyMetric = 'HRV 42';
  a.state.futureAthleteProfile = { dob: '1985-01-01' };

  const c = a.contentCandidate(dd, 'founder');
  const blob = JSON.stringify(c);
  assert.equal(blob.indexOf('stress fracture'), -1);
  assert.equal(blob.indexOf('HRV'), -1);
  assert.equal(blob.indexOf('1985'), -1);
  assert.equal(Object.keys(c).sort().join(','), CB.ALLOWED.slice().sort().join(','));
  // And the server would refuse it too if it somehow arrived widened.
  const widened = Object.assign({}, c, { futureInjuryFlag: 'suspected stress fracture' });
  assert.ok(CB.validateCandidate(widened).length > 0);
});

test('4. neither builder copies a whole object', () => {
  const at = RUNTIME.indexOf('function contentCandidate(dd, source)');
  const runtimeBody = RUNTIME.slice(at, RUNTIME.indexOf('\n}', at));
  for (const bad of ['Object.assign', '...dd', '...a', 'JSON.parse(JSON.stringify']) {
    assert.equal(runtimeBody.indexOf(bad), -1, 'runtime builder must not ' + bad);
  }
  const sAt = BRIDGE_SRC.indexOf('function sanitise(');
  const sBody = BRIDGE_SRC.slice(sAt, BRIDGE_SRC.indexOf('\n}', sAt));
  assert.match(sBody, /ALLOWED\.forEach/, 'the server must rebuild field by field');
  assert.equal(sBody.indexOf('Object.assign'), -1);
});

test('5. marketingEligible must be explicitly true', () => {
  for (const v of [false, undefined, null, 'true', 1, 'yes', {}]) {
    const bad = clone({ marketingEligible: v });
    if (v === undefined) delete bad.marketingEligible;
    assert.ok(CB.validateCandidate(bad).includes('not_marketing_eligible'),
      JSON.stringify(v) + ' must not satisfy eligibility');
  }
});

// ---------------------------------------------------------------------------
// 6-8. FOUNDER ONLY, AND OFF BY DEFAULT
// ---------------------------------------------------------------------------
test('6. a non-founder cannot export, whatever the payload claims', async () => {
  const { result, calls } = await withMonday(() => reply(EMPTY_SEARCH),
    () => CB.exportCandidate(GOOD, false));
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.code, 'not_founder');
  assert.equal(calls.length, 0, 'nothing may be sent for a non-founder');
  // A client-controlled flag is never sufficient on its own.
  const forged = await withMonday(() => reply(EMPTY_SEARCH),
    () => CB.exportCandidate(clone({ marketingEligible: true }), false));
  assert.equal(forged.result.code, 'not_founder');
  assert.equal(forged.calls.length, 0);
});

test('6b. founder identity is decided server-side, never by the payload', () => {
  // exportCandidate takes the verdict as an argument; it must not derive it.
  const at = BRIDGE_SRC.indexOf('async function exportCandidate(');
  const body = BRIDGE_SRC.slice(at, BRIDGE_SRC.indexOf('\n}', at));
  assert.match(body, /founderVerified !== true/);
  assert.equal(body.indexOf('candidate.contentSource ==='), -1,
    'the payload must not be the source of truth for identity');
  // The route passes the result of the server-side owner comparison.
  assert.match(ADMIN_SRC, /CB\.exportCandidate\(body\.candidate, who\.uid === ownerId\)/);
  // And it sits behind the same gate as the existing owner actions.
  assert.ok(ADMIN_SRC.indexOf('if (who.uid !== ownerId)') <
            ADMIN_SRC.indexOf("action === 'content_export'"),
    'the export must sit behind the owner check, not before it');
});

test('7. the founder exports only what deterministic coaching eligibility allows', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {};
  buildPlan(a, { weeks: 12, startDate: '2026-06-01', distanceKey: 'half' });
  const dd = a.state.days.filter(d => d.type === 'threshold' && d.date < TODAY)[0];
  const tr = a.executionPaceTarget(dd), z = a.executionHRTarget(dd);
  dd.completed = true;
  dd.actual = { km: dd.km, pace: a.secToPace(Math.round(tr.fast - 2)),
                hr: z && z.hi ? z.hi - 4 : null, rpe: 7, feel: 'good', notes: '' };
  a.CONTENT_CANDIDATE_ENABLED = true;
  assert.equal(a.coachBreakthroughs().length, 1);
  assert.equal(a.contentCandidates('founder').length, 1);
  // Degrade the same session: eligibility is the coaching engine's call.
  dd.actual.pace = a.secToPace(Math.round(tr.slow + 30));
  assert.equal(a.coachBreakthroughs().length, 0);
  assert.equal(a.contentCandidates('founder').length, 0,
    'marketing has no parallel scoring system');
});

test('8. the integration flag off means nothing is sent', async () => {
  const { result, calls } = await withMonday(() => reply(EMPTY_SEARCH),
    () => CB.exportCandidate(GOOD, true), { VVV_CONTENT_BRIDGE_ENABLED: '' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'bridge_disabled');
  assert.equal(calls.length, 0);
  // And with no token configured it fails closed rather than trying.
  const noTok = await withMonday(() => reply(EMPTY_SEARCH),
    () => CB.exportCandidate(GOOD, true), { MONDAY_API_TOKEN: '' });
  assert.equal(noTok.result.code, 'bridge_not_configured');
  assert.equal(noTok.calls.length, 0);
});

// ---------------------------------------------------------------------------
// 9-14. THE MONDAY MAPPING
// ---------------------------------------------------------------------------
test('9. the mapping uses the approved board and the exact column ids', async () => {
  assert.equal(CB.BOARD_ID, '5102476403');
  assert.equal(CB.COL.workflowStatus, 'color_mm6b6sh8');
  assert.equal(CB.COL.candidateId, 'text_mm6bg1dm');
  assert.equal(CB.COL.source, 'text_mm6bqkqv');
  assert.equal(CB.COL.eventType, 'text_mm6bxsvt');
  assert.equal(CB.COL.eventDate, 'date_mm6b4mcm');
  assert.equal(CB.COL.sourceFacts, 'long_text_mm6baqnt');
  assert.equal(CB.COL.marketingEligible, 'boolean_mm6bmfhp');

  const { calls } = await withMonday((b, n) =>
    reply(n === 1 ? EMPTY_SEARCH : { create_item: { id: '99' } }),
    () => CB.exportCandidate(GOOD, true));
  assert.equal(calls[1].variables.board, '5102476403');
  const cols = JSON.parse(calls[1].variables.cols);
  assert.equal(cols[CB.COL.candidateId], GOOD.candidateId);
  // HQ's upstream mapping names this value. It was 'Founder / Valhalla' while
  // the bridge was a manual founder export; the destination group now carries
  // that meaning and the column says which SYSTEM supplied the evidence.
  assert.equal(cols[CB.COL.source], 'Valhalla');
  assert.equal(CB.SOURCE_LABEL, 'Valhalla');
  // And it lands in the evidence group, never the board's default editorial one.
  assert.equal(calls[1].variables.group, 'group_test_valhalla_evidence');
  assert.match(calls[1].query, /group_id:\s*\$group/, 'create_item must target a group');
  assert.equal(cols[CB.COL.eventType], 'threshold_continuous');
  assert.deepEqual(cols[CB.COL.eventDate], { date: '2026-06-04' });
  assert.deepEqual(cols[CB.COL.marketingEligible], { checked: 'true' });
  // Source Facts is the complete candidate and nothing else.
  assert.deepEqual(JSON.parse(cols[CB.COL.sourceFacts]), GOOD);
});

test('10. a new candidate is created with Workflow Status = Candidate', async () => {
  assert.equal(CB.INITIAL_STATUS, 'Candidate');
  const { calls } = await withMonday((b, n) =>
    reply(n === 1 ? EMPTY_SEARCH : { create_item: { id: '99' } }),
    () => CB.exportCandidate(GOOD, true));
  const cols = JSON.parse(calls[1].variables.cols);
  assert.deepEqual(cols[CB.COL.workflowStatus], { label: 'Candidate' });
  // Valhalla never sets any later state.
  for (const forbidden of ['Selected', 'Preparing', 'Review', 'Approved', 'Rejected', 'Changes Requested']) {
    assert.equal(BRIDGE_SRC.indexOf("'" + forbidden + "'"), -1,
      'Valhalla must never set status ' + forbidden);
  }
});

test('11-14. Valhalla never writes Format, AI Content Pack, Review Feedback or Assets', async () => {
  assert.equal(CB.NEVER_WRITTEN.format, 'text_mm6bgw2m');
  assert.equal(CB.NEVER_WRITTEN.aiContentPack, 'long_text_mm6b1ffe');
  assert.equal(CB.NEVER_WRITTEN.reviewFeedback, 'long_text_mm6bqk4t');
  assert.equal(CB.NEVER_WRITTEN.assets, 'file_mm6b29rv');

  const { calls } = await withMonday((b, n) =>
    reply(n === 1 ? EMPTY_SEARCH : { create_item: { id: '99' } }),
    () => CB.exportCandidate(GOOD, true));
  const sent = calls[1].variables.cols;
  const cols = JSON.parse(sent);
  Object.values(CB.NEVER_WRITTEN).forEach(id => {
    assert.equal(cols[id], undefined, id + ' must be absent from the payload');
    assert.equal(sent.indexOf(id), -1, id + ' must not appear in the request at all');
  });
  // columnValues() must not even be able to name them.
  const at = BRIDGE_SRC.indexOf('function columnValues(');
  const body = BRIDGE_SRC.slice(at, BRIDGE_SRC.indexOf('\n}', at));
  Object.values(CB.NEVER_WRITTEN).forEach(id => assert.equal(body.indexOf(id), -1));
});

// ---------------------------------------------------------------------------
// 15-16. IDEMPOTENCY
// ---------------------------------------------------------------------------
test('15. Candidate ID is the idempotency key, never athlete identity', async () => {
  const { calls } = await withMonday((b, n) =>
    reply(n === 1 ? EMPTY_SEARCH : { create_item: { id: '99' } }),
    () => CB.exportCandidate(GOOD, true));
  assert.match(calls[0].query, /items_page_by_column_values/);
  assert.equal(calls[0].variables.col, CB.COL.candidateId);
  assert.deepEqual(calls[0].variables.val, [GOOD.candidateId]);
  // Nothing identifying the athlete is used as the key.
  const key = JSON.stringify(calls[0].variables);
  ['email', 'uid', 'user'].forEach(w => assert.equal(key.toLowerCase().indexOf(w), -1));
});

test('16. a retry after a successful create does not create a duplicate', async () => {
  // Second attempt: the search now finds the item the lost-response attempt made.
  const { result, calls } = await withMonday(() =>
    reply({ items_page_by_column_values: { items: [{ id: '99', name: 'x' }] } }),
    () => CB.exportCandidate(GOOD, true));
  assert.equal(result.ok, true);
  assert.equal(result.created, false, 'a retry must report that it created nothing');
  assert.equal(result.itemId, '99');
  assert.equal(calls.length, 1, 'no create mutation may be sent');
  assert.ok(!calls.some(c => /create_item/.test(c.query)), 'no create_item on a retry');
});

// ---------------------------------------------------------------------------
// 17-19. FAILURE ISOLATION, SECRETS, LOGS
// ---------------------------------------------------------------------------
test('17. a monday failure does not break coaching, logging or plan behaviour', async () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {};
  buildPlan(a, { weeks: 12, startDate: '2026-06-01', distanceKey: 'half' });
  // Log a session FIRST, so the baseline is the state we expect to be preserved.
  // (Logging legitimately changes the plan signature; the question this test
  // asks is whether a monday failure changes it, not whether logging does.)
  const logged = a.state.days.filter(d => d.type === 'easy')[0];
  logged.completed = true;
  logged.actual = { km: logged.km, pace: '5:30', hr: 140, rpe: 4, feel: 'good', notes: '' };
  const before = a.planContentSignature(a.state);

  for (const failure of [
    () => { throw new Error('network down'); },
    () => ({ ok: false, status: 500, text: async () => 'boom' }),
    () => ({ ok: false, status: 429, text: async () => 'rate limited' }),
    () => ({ ok: true, status: 200, text: async () => 'not json' }),
    () => reply(null)
  ]) {
    let out;
    try {
      out = (await withMonday(failure, () => CB.exportCandidate(GOOD, true))).result;
    } catch (e) {
      out = { threw: true };
    }
    // Whatever monday does, the export reports a code; it never takes the app with it.
    assert.ok(out.threw || out.ok === false, 'a monday failure must be a handled outcome');
  }
  // The coaching product is entirely unaffected by every one of those failures.
  assert.equal(a.planContentSignature(a.state), before, 'the plan is untouched');
  assert.equal(logged.completed, true, 'the logged session survived');
  assert.equal(logged.actual.pace, '5:30', 'logged data survived');
  assert.ok(a.renderTodayView().length > 0, 'the app still renders');
  const next = a.state.days.filter(d => !d.completed && d.type !== 'rest')[0];
  assert.ok(a.coachIntentLine(next), 'coaching still speaks');
  assert.ok(a.computeExecutionScore(logged) != null, 'scoring still works');
});

test('17b. there is no retry loop inside the bridge', () => {
  for (const bad of ['setTimeout', 'setInterval', 'while (', 'for (;;)', 'retry(']) {
    assert.equal(BRIDGE_SRC.indexOf(bad), -1, 'no unbounded retry machinery: ' + bad);
  }
});

test('18. monday credentials stay server-side', () => {
  // Never in the coaching runtime, which is served to browsers.
  for (const w of ['MONDAY_API_TOKEN', 'MONDAY_CONTENT_BOARD_ID', 'api.monday.com', '5102476403']) {
    assert.equal(RUNTIME.indexOf(w), -1, w + ' must never reach the client bundle');
  }
  for (const f of ['account.html', 'get.html', 'admin.html', 'privacy.html', 'terms.html']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.equal(src.indexOf('MONDAY'), -1, f + ' must not carry monday configuration');
  }
  // The token is read from the environment and never hard-coded or returned.
  assert.match(BRIDGE_SRC, /process\.env\.MONDAY_API_TOKEN/);
  assert.equal(BRIDGE_SRC.indexOf('NEXT_PUBLIC'), -1);
  const cfg = CB.config();
  assert.equal(typeof cfg.token, 'function', 'the token is a getter, not a serialisable field');
  assert.equal(JSON.stringify(cfg).indexOf('token'), -1,
    'stringifying the config must not expose the token');
});

test('19. no prohibited athlete value can appear in a log or an error', async () => {
  const logs = [];
  // The route logs codes only; prove the shape it builds.
  const at = ADMIN_SRC.indexOf("action === 'content_export'");
  const arm = ADMIN_SRC.slice(at, ADMIN_SRC.indexOf('\n  }', at));
  assert.match(arm, /log\('CONTENT_EXPORT ok='/);
  for (const leak of ['candidate.', 'body.candidate,', 'JSON.stringify(body']) {
    assert.equal(arm.indexOf('log(' + leak), -1, 'the log line must not carry the payload');
  }
  // A monday error is summarised to a code, never echoed.
  const { result } = await withMonday(
    () => ({ ok: false, status: 500, text: async () => JSON.stringify({ errors: [{ message: 'query contained shin sore' }] }) }),
    () => CB.exportCandidate(GOOD, true));
  assert.equal(JSON.stringify(result).indexOf('shin'), -1, 'a provider error must not be echoed');
  assert.match(result.detail || result.code, /^(http_\d+|graphql_error|unparseable_response|monday_unavailable)$/);
});

// ---------------------------------------------------------------------------
// 20, 24. THE COACHING PRODUCT STAYS UNAWARE
// ---------------------------------------------------------------------------
test('20. marketing and monday vocabulary never enters the coaching runtime', () => {
  const code = RUNTIME.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1').toLowerCase();
  for (const w of ['instagram', 'facebook', 'tiktok', 'linkedin', 'monday.com', 'monday_api',
                   'hashtag', 'campaign', 'content calendar', 'social post', 'follower',
                   'workflow status', 'ai content pack', 'candidate id']) {
    assert.equal(code.indexOf(w), -1, 'coaching runtime leaked marketing concept: ' + w);
  }
  // Confined to the one server module by design.
  assert.ok(BRIDGE_SRC.indexOf('api.monday.com') !== -1, 'the boundary is where monday lives');
});

test('24. no social publication capability exists anywhere', () => {
  const files = ['api/_content-bridge.js', 'api/admin-user.js', RUNTIME_RELATIVE];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const w of ['graph.facebook', 'api.instagram', 'oauth/authorize?scope=pages',
                     'publish_to_groups', 'ig_user', 'scheduled_publish_time']) {
      assert.equal(src.indexOf(w), -1, f + ' must contain no publishing capability: ' + w);
    }
  }
  // The bridge cannot advance a candidate past Candidate.
  assert.equal(BRIDGE_SRC.indexOf('change_column_value'), -1,
    'the bridge creates; it does not move items through the workflow');
  assert.equal(BRIDGE_SRC.indexOf('change_simple_column_value'), -1);
});

// ---------------------------------------------------------------------------
// 21-23. CURRENT MAIN BEHAVIOUR IS PRESERVED
// ---------------------------------------------------------------------------
test('21-22. the existing cue-distinctness and unit-consistency suites still exist', () => {
  for (const f of ['test/coachSurfaceDistinctness.test.js', 'test/unitConsistencyCopy.test.js']) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' must survive the reconciliation');
  }
});

test('23. the integration changes no coaching prescription or decision', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {};
  buildPlan(a, { weeks: 16, startDate: TODAY, distanceKey: 'half' });
  const sig = a.planContentSignature(a.state);
  const shape = a.state.days.map(d => [d.date, d.type, d.km, d.title, JSON.stringify(d.prescription || null)].join('|')).join('~');
  a.CONTENT_CANDIDATE_ENABLED = true;
  a.contentCandidates('founder');
  assert.equal(a.planContentSignature(a.state), sig);
  assert.equal(a.state.days.map(d => [d.date, d.type, d.km, d.title, JSON.stringify(d.prescription || null)].join('|')).join('~'), shape);
});

test('the function budget is unchanged and the bridge is not a function', () => {
  const fns = fs.readdirSync(path.join(ROOT, 'api')).filter(f => /\.js$/.test(f) && f.charAt(0) !== '_');
  /* Stated as a CEILING rather than a constant. Every one of these
     assertions was written to mean "my feature added no Serverless
     Function", and pinning the absolute total made a legitimate
     CONSOLIDATION look like a regression: the Strava routes moved
     behind one router and the count fell 12 -> 7, which is the same
     claim holding more strongly, not a broken one. The limit is what
     the deployment actually enforces. */
  assert.ok(fns.length <= 12, 'no thirteenth serverless function');
  assert.ok(fs.existsSync(path.join(ROOT, 'api/_content-bridge.js')), 'the bridge is an underscore module');
});
