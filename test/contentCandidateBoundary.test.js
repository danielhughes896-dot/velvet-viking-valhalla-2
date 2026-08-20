'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');
const bridge = require('../api/_content-bridge.js');

// CONTENT CANDIDATE BOUNDARY TESTS.
//
// This is the only place in the product where anything about an athlete is
// shaped to leave. Almost every test here is adversarial: they assume somebody
// will one day widen the payload, wire the emitter to a render path, or point it
// at a beta tester, and they are written to stop that being possible quietly.
const ROOT = path.join(__dirname, '..');
const RUNTIME = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const TODAY = '2026-08-17';

function founderApp() {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {};
  buildPlan(a, { weeks: 12, startDate: '2026-06-01', distanceKey: 'half' });
  const dd = a.state.days.filter((d) => d.type === 'threshold' && d.date < TODAY)[0];
  const tr = a.executionPaceTarget(dd);
  const z = a.executionHRTarget(dd);
  dd.completed = true;
  dd.actual = {
    km: dd.km,
    pace: a.secToPace(Math.round(tr.fast - 2)),
    hr: z && z.hi ? z.hi - 4 : null,
    rpe: 7,
    feel: 'good',
    notes: 'felt strong, shin was a bit sore afterwards'
  };
  return { a, dd };
}

// ---------------------------------------------------------------------------
// GATED, SILENT, AND UNABLE TO INTERFERE
//
// These tests replaced an "inert by default" set. The bridge is now commissioned:
// the emitter is on and coachPersistReview() notifies it. What has to hold is no
// longer "nothing happens" but "nothing happens that the athlete can see, that a
// non-founder can cause, or that can break a workout".
// ---------------------------------------------------------------------------
const REGION = (() => {
  const at = RUNTIME.indexOf('var CONTENT_CANDIDATE_VERSION');
  const end = RUNTIME.indexOf('/* ---------- athlete status ---------- */');
  return RUNTIME.slice(at, end);
})();
// The same region with prose removed. The forbidden-substring checks below must
// read CODE, not the comments explaining why the code does not do those things.
const REGION_CODE = REGION.replace(/\/\*[\s\S]*?\*\//g, ' ')
                          .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

test('the emitter is on, and eligibility still decides everything', () => {
  const { a, dd } = founderApp();
  assert.equal(a.CONTENT_CANDIDATE_ENABLED, true, 'the bridge is commissioned');
  assert.ok(a.contentCandidateEligible(dd), 'a breakthrough is eligible');
  const ordinary = a.state.days.filter(d => d.completed && !a.coachBreakthroughs().includes(d))[0];
  if (ordinary) assert.equal(a.contentCandidateEligible(ordinary), false,
    'an ordinary session is not eligible');
});

test('eligibility is coachBreakthroughs() and no second analysis engine', () => {
  // No threshold, score or rule of its own -- it asks the existing judgement.
  const body = REGION.slice(REGION.indexOf('function contentCandidateEligible'));
  const fn = body.slice(0, body.indexOf('\n}'));
  assert.match(fn, /coachBreakthroughs\(\)/, 'it must defer to the existing rule');
  assert.equal(/[<>]=?\s*\d/.test(fn.replace(/-1/g, '')), false,
    'no numeric threshold may be invented here');
});

test('the only caller is the domain hook, never a render path', () => {
  const code = RUNTIME.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const at = code.indexOf('var CONTENT_CANDIDATE_VERSION');
  // A marker that survives comment stripping -- the first function after the
  // region. Using the comment banner here silently matched nothing and made the
  // assertion vacuous, which is exactly the kind of green this test must not be.
  const end = code.indexOf('function coachStatus(');
  assert.ok(at > 0 && end > at, 'region markers must both resolve');
  const outside = code.slice(0, at) + code.slice(end);
  const callers = (outside.match(/\bcontentCandidate[A-Za-z]*\s*\(/g) || []);
  assert.deepEqual([...new Set(callers)], ['contentCandidateNotify('],
    'exactly one entry point may be called from outside the region');
  // and it is called from coachPersistReview, which is not a render path
  const cpr = code.slice(code.indexOf('function coachPersistReview('));
  assert.match(cpr.slice(0, cpr.indexOf('\n}')), /contentCandidateNotify\(dd\)/);
  for (const render of ['renderTodayView', 'renderWeekView', 'renderFullPlanView',
                        'renderPlanHQView', 'renderCoachingDepth', 'renderApp']) {
    const fnAt = code.indexOf('function ' + render + '(');
    if (fnAt === -1) continue;
    const fnBody = code.slice(fnAt, code.indexOf('\n}', fnAt));
    assert.equal(fnBody.indexOf('contentCandidate'), -1, render + ' must not emit');
  }
});

test('the only egress is one POST to our own origin', () => {
  const fetches = REGION_CODE.match(/fetch\(([^,)]*)/g) || [];
  assert.equal(fetches.length, 1, 'exactly one fetch in the whole region');
  assert.match(fetches[0], /'\/api\/admin-user'/, 'own origin only, never monday');
  for (const bad of ['api.monday.com', 'XMLHttpRequest', 'navigator.sendBeacon',
                     'window.open', 'document.']) {
    assert.equal(REGION_CODE.indexOf(bad), -1, 'the emitter must not use ' + bad);
  }
});

test('the emitter can neither throw nor be seen', () => {
  const notify = REGION.slice(REGION.indexOf('function contentCandidateNotify'));
  const body = notify.slice(0, notify.indexOf('\n}\n'));
  assert.match(body, /try\s*{/, 'the whole hook is wrapped');
  assert.match(body, /catch/, 'and every failure is swallowed');
  // Nothing in the region renders, alerts, toasts or navigates.
  for (const bad of ['showToast', 'alert(', 'innerHTML', 'render', 'location.']) {
    assert.equal(REGION_CODE.indexOf(bad), -1, 'the emitter must not ' + bad);
  }
  assert.match(REGION_CODE, /\.catch\(function\(\)\s*{/, 'the request itself cannot reject upward');
});

test('the coaching product contains no marketing or social vocabulary', () => {
  /* Unambiguous product/platform names, plus phrases precise enough not to fire
     on ordinary code. Bare "caption" is deliberately NOT here: the runtime has a
     .gauge-caption CSS class for a chart label, which is a caption in the
     ordinary English sense and has nothing to do with social media. A test that
     cries wolf on that gets deleted by the next person, so it is scoped to the
     marketing meaning instead. */
  const forbidden = [
    'instagram', 'facebook', 'tiktok', 'twitter.com', 'linkedin', 'monday.com',
    'hashtag', 'campaign', 'content calendar', 'social post', 'follower',
    'post caption', 'schedule post', 'publish to'
  ];
  // Shipped code only. The region's own comment names these words in order to
  // forbid them, and that documentation is worth keeping -- so the assertion is
  // about what executes, and a second assertion below keeps the warning itself
  // from being deleted.
  const code = RUNTIME.replace(/\/\*[\s\S]*?\*\//g, ' ')
                      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
                      .toLowerCase();
  for (const word of forbidden) {
    assert.equal(code.indexOf(word), -1,
      'Valhalla must stay unaware of marketing: found "' + word + '" in executable runtime code');
  }
});

test('the prohibition itself is written down in the runtime', () => {
  assert.match(RUNTIME, /WHAT VALHALLA MUST NEVER KNOW/,
    'the next person to read this file must find the rule, not infer it');
});

// ---------------------------------------------------------------------------
// THE ALLOW-LIST
// ---------------------------------------------------------------------------
test('a built candidate has exactly the allow-listed keys, no more', () => {
  const { a, dd } = founderApp();
  const c = a.contentCandidate(dd, 'founder');
  assert.ok(c, 'a founder breakthrough should build');
  assert.equal(Object.keys(c).sort().join(','), a.CONTENT_CANDIDATE_FIELDS.slice().sort().join(','));
});

test('the runtime allow-list and the bridge allow-list are identical', () => {
  const { a } = founderApp();
  assert.equal(
    a.CONTENT_CANDIDATE_FIELDS.slice().sort().join(','),
    bridge.ALLOWED.slice().sort().join(','),
    'the two ends of the boundary must agree, or one of them is wrong'
  );
});

test('nothing about the body or the athlete\'s own words crosses', () => {
  const { a, dd } = founderApp();
  const c = a.contentCandidate(dd, 'founder');
  const blob = JSON.stringify(c);
  // The fixture deliberately logs heart rate, pace, RPE, feel and a note that
  // mentions an injury. None of it may appear.
  /* Word boundaries, not substrings: "hr" appears inside "threshold" and "rpe"
     inside other words, so a naive indexOf reports a leak that is not there.
     The values themselves are checked below, which is the stronger assertion. */
  for (const leak of ['hr', 'pace', 'rpe', 'feel', 'notes', 'sore', 'shin', 'felt strong']) {
    assert.ok(!new RegExp('\\b' + leak + '\\b', 'i').test(blob),
      'candidate leaked "' + leak + '": ' + blob);
  }
  // And no logged VALUE reaches the payload either.
  assert.ok(blob.indexOf(String(dd.actual.hr)) === -1, 'heart-rate value leaked');
  assert.ok(blob.indexOf(dd.actual.pace) === -1, 'pace value leaked');
  assert.ok(blob.indexOf(dd.actual.notes) === -1, 'note text leaked');
  assert.equal(c.hr, undefined);
  assert.equal(c.notes, undefined);
});

test('the candidate is built field by field, never copied from a day', () => {
  const at = RUNTIME.indexOf('function contentCandidate(dd, source)');
  const body = RUNTIME.slice(at, RUNTIME.indexOf('\n}', at));
  for (const bad of ['Object.assign', '...dd', '...a', 'JSON.parse(JSON.stringify']) {
    assert.equal(body.indexOf(bad), -1,
      'copying wholesale is how a future field leaks by default: ' + bad);
  }
});

test('a field added to a training day does not reach the payload', () => {
  const { a, dd } = founderApp();
  dd.secretNewField = 'medical detail added by a future feature';
  dd.actual.newBodyMetric = 42;
  const c = a.contentCandidate(dd, 'founder');
  assert.equal(JSON.stringify(c).indexOf('medical detail'), -1);
  assert.equal(JSON.stringify(c).indexOf('42'), -1);
  assert.equal(Object.keys(c).sort().join(','), a.CONTENT_CANDIDATE_FIELDS.slice().sort().join(','));
});

// ---------------------------------------------------------------------------
// FOUNDER ONLY
// ---------------------------------------------------------------------------
test('no source other than founder can produce a candidate', () => {
  const { a, dd } = founderApp();
  for (const src of [undefined, null, '', 'athlete', 'beta', 'tester', 'FOUNDER', 'founder ', true, 1, {}]) {
    assert.equal(a.contentCandidate(dd, src), null, 'source ' + JSON.stringify(src) + ' must be refused');
    assert.equal(a.contentCandidates(src).length, 0, 'source ' + JSON.stringify(src) + ' must yield nothing');
  }
});

test('the bridge refuses anything not explicitly founder and eligible', () => {
  const base = {
    v: 1, candidateId: 'vv-2026-06-04-threshold_continuous', date: '2026-06-04',
    sessionKind: 'threshold_continuous', distanceKm: 7,
    notableBecause: 'Quality session executed at the fast end of its prescribed window with heart rate controlled.',
    executionScore: 99, goalDistanceLabel: 'Half Marathon',
    contentSource: 'founder', marketingEligible: true
  };
  assert.deepEqual(bridge.validateCandidate(base), [], 'the good case must pass');

  const reject = (mutate, why) => {
    const c = Object.assign({}, base);
    mutate(c);
    assert.ok(bridge.validateCandidate(c).length > 0, 'should have been refused: ' + why);
  };
  reject((c) => { c.contentSource = 'athlete'; }, 'a beta tester as source');
  reject((c) => { delete c.contentSource; }, 'missing source');
  reject((c) => { c.marketingEligible = false; }, 'not eligible');
  reject((c) => { delete c.marketingEligible; }, 'eligibility absent, not defaulted');
  reject((c) => { c.hr = 152; }, 'heart rate smuggled in');
  reject((c) => { c.notes = 'my shin hurts'; }, 'athlete notes smuggled in');
  reject((c) => { c.email = 'someone@example.com'; }, 'an email address');
  reject((c) => { c.extra = 'anything at all'; }, 'any unknown field');
  reject((c) => { c.notableBecause = 'Custom prose written by someone'; }, 'free text');
  reject((c) => { c.date = 'yesterday'; }, 'a malformed date');
});

test('the server rebuilds the record rather than storing what arrived', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/_content-bridge.js'), 'utf8');
  const at = src.indexOf('function sanitise(');
  const body = src.slice(at, src.indexOf('\n}', at));
  assert.match(body, /ALLOWED\.forEach/, 'allow-listed fields copied into a fresh object');
  assert.equal(body.indexOf('Object.assign'), -1);
});

// ---------------------------------------------------------------------------
// ELIGIBILITY IS THE COACHING ENGINE'S, NOT MARKETING'S
// ---------------------------------------------------------------------------
test('only a genuine breakthrough is eligible', () => {
  const { a, dd } = founderApp();
  a.CONTENT_CANDIDATE_ENABLED = true;
  assert.equal(a.coachBreakthroughs().length, 1);
  assert.equal(a.contentCandidates('founder').length, 1);

  // Degrade the same session to an ordinary one: it must stop being eligible.
  dd.actual.pace = a.secToPace(Math.round(a.executionPaceTarget(dd).slow + 30));
  assert.equal(a.coachBreakthroughs().length, 0, 'no longer a breakthrough');
  assert.equal(a.contentCandidates('founder').length, 0, 'and therefore no longer a candidate');
});

test('an incomplete session is never a candidate', () => {
  const { a, dd } = founderApp();
  a.CONTENT_CANDIDATE_ENABLED = true;
  dd.completed = false;
  assert.equal(a.contentCandidate(dd, 'founder'), null);
});

test('the emitter is deterministic', () => {
  const one = founderApp();
  const two = founderApp();
  one.a.CONTENT_CANDIDATE_ENABLED = true;
  two.a.CONTENT_CANDIDATE_ENABLED = true;
  assert.equal(
    JSON.stringify(one.a.contentCandidates('founder')),
    JSON.stringify(two.a.contentCandidates('founder'))
  );
});

// ---------------------------------------------------------------------------
// THE HUMAN GATE, AND THE STOP BEFORE PUBLISHING
// ---------------------------------------------------------------------------
test('the server boundary has no publishing capability', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/_content-bridge.js'), 'utf8');
  // Executable code only: the module's own comment names publishing in order to
  // forbid it, and that sentence is worth keeping. The second assertion makes
  // sure it cannot be quietly deleted.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1').toLowerCase();
  for (const w of ['graph.facebook', 'api.instagram', 'scheduled_publish_time',
                   'publish(', 'schedulepost', 'create_campaign']) {
    assert.equal(code.indexOf(w), -1, 'no publishing capability: ' + w);
  }
  // Whitespace-normalised: the sentence wraps across comment lines.
  const prose = src.replace(/\s*\n\s*\*?\s*/g, ' ');
  assert.match(prose, /does not select, prepare, format, review, approve, schedule or publish/,
    'the prohibition must stay written down');
});

test('approval belongs to monday, and Valhalla cannot grant it', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/_content-bridge.js'), 'utf8');
  assert.equal(src.indexOf("'Approved'"), -1, 'Valhalla must never set Approved');
  assert.equal(src.indexOf("'Selected'"), -1, 'Valhalla must never select a candidate');
});

// ---------------------------------------------------------------------------
// BETA ISOLATION
// ---------------------------------------------------------------------------
test('no serverless function was added and no beta path was touched', () => {
  const fns = fs.readdirSync(path.join(ROOT, 'api')).filter((f) => /\.js$/.test(f) && f.charAt(0) !== '_');
  /* Stated as a CEILING rather than a constant. Every one of these
     assertions was written to mean "my feature added no Serverless
     Function", and pinning the absolute total made a legitimate
     CONSOLIDATION look like a regression: the Strava routes moved
     behind one router and the count fell 12 -> 7, which is the same
     claim holding more strongly, not a broken one. The limit is what
     the deployment actually enforces. */
  assert.ok(fns.length <= 12, 'function budget safe; the bridge is not deployed');
  // The bridge lives outside /api, so Vercel never builds it.
  assert.ok(fs.existsSync(path.join(ROOT, 'api/_content-bridge.js')), 'an underscore module, not a function');
  assert.ok(!fs.existsSync(path.join(ROOT, 'api/content-bridge.js')), 'must not become a 13th function');
  const access = fs.readFileSync(path.join(ROOT, 'api/_access.js'), 'utf8');
  assert.match(access, /flagOn\(process\.env\.VVV_ACCOUNT_REQUIRED\)/);
  assert.match(access, /flagOn\(process\.env\.VVV_COMMERCIAL_REQUIRED\)/);
});

test('the plan an athlete sees is untouched by any of this', () => {
  const { a } = founderApp();
  const sig = a.planContentSignature(a.state);
  a.CONTENT_CANDIDATE_ENABLED = true;
  a.contentCandidates('founder');
  assert.equal(a.planContentSignature(a.state), sig, 'emitting must not touch the plan');
});

test('no credential or board id is committed anywhere', () => {
  for (const f of ['api/_content-bridge.js', 'tools/content-bridge/README.md']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(src), f + ' contains something shaped like a token');
    // The board id is supplied configuration and legitimately appears in the
    // server module; what must never appear is a credential.
    const withoutBoard = src.split('5102476403').join('');
    assert.ok(!/\b\d{12,}\b/.test(withoutBoard), f + ' contains an unexplained long numeric id');
  }
});
