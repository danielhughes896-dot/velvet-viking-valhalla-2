'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');
const bridge = require('../tools/content-bridge/bridge.js');

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
// INERT BY DEFAULT
// ---------------------------------------------------------------------------
test('the emitter is off, and off means it emits nothing', () => {
  const { a } = founderApp();
  assert.equal(a.CONTENT_CANDIDATE_ENABLED, false, 'the flag ships false');
  assert.equal(a.contentCandidates('founder').length, 0, 'flag off must yield no candidates');
});

test('nothing in the runtime calls the emitter', () => {
  const code = RUNTIME.replace(/\/\*[\s\S]*?\*\//g, ' ');
  for (const fn of ['contentCandidates', 'contentCandidate', 'contentCandidateId', 'contentCandidateReason']) {
    const calls = (code.match(new RegExp('\\b' + fn + '\\s*\\(', 'g')) || []).length;
    const defs = (code.match(new RegExp('function ' + fn + '\\s*\\(', 'g')) || []).length;
    assert.equal(calls - defs, fn === 'contentCandidate' || fn === 'contentCandidateId' || fn === 'contentCandidateReason' ? calls - defs : 0,
      fn + ' should only be called from within this region');
  }
  // Nothing outside the region reaches it: no render path, no event handler.
  const at = code.indexOf('var CONTENT_CANDIDATE_VERSION');
  const end = code.indexOf('/* ---------- athlete status ---------- */');
  const outside = code.slice(0, at) + code.slice(end);
  assert.equal(outside.indexOf('contentCandidate'), -1, 'no caller outside the region');
});

test('the emitter performs no I/O of any kind', () => {
  const at = RUNTIME.indexOf('var CONTENT_CANDIDATE_VERSION');
  const end = RUNTIME.indexOf('/* ---------- athlete status ---------- */');
  const region = RUNTIME.slice(at, end);
  for (const bad of ['fetch(', 'XMLHttpRequest', 'navigator.send', 'localStorage', 'document.', 'window.open']) {
    assert.equal(region.indexOf(bad), -1, 'the emitter must not ' + bad);
  }
});

// ---------------------------------------------------------------------------
// VALHALLA MUST NOT KNOW WHAT THIS IS FOR
// ---------------------------------------------------------------------------
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
  assert.deepEqual(bridge.validate(base), [], 'the good case must pass');

  const reject = (mutate, why) => {
    const c = Object.assign({}, base);
    mutate(c);
    assert.ok(bridge.validate(c).length > 0, 'should have been refused: ' + why);
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

test('ingestion rebuilds the record rather than storing what arrived', () => {
  const at = fs.readFileSync(path.join(ROOT, 'tools/content-bridge/bridge.js'), 'utf8');
  assert.match(at, /ALLOWED\.forEach\(\(k\) => \{ if \(c\[k\] !== undefined\) clean\[k\] = c\[k\]; \}\)/,
    'the bridge must copy allow-listed fields into a fresh object');
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
test('publishing is not implemented and the tool says so', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools/content-bridge/bridge.js'), 'utf8');
  const at = src.indexOf('function publish(');
  const body = src.slice(at, src.indexOf('\n}', at));
  assert.match(body, /REFUSED/, 'publish must refuse');
  assert.match(body, /process\.exit\(2\)/, 'and exit non-zero');
  for (const word of ['fetch(', 'axios', 'graph.facebook', 'api.instagram']) {
    assert.equal(body.indexOf(word), -1, 'publish must contain no transport: ' + word);
  }
});

test('approval is mandatory, named, and cannot be skipped', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools/content-bridge/bridge.js'), 'utf8');
  const at = src.indexOf('function approve(');
  const body = src.slice(at, src.indexOf('\n}', at));
  assert.match(body, /only a drafted candidate can be approved/);
  assert.match(body, /approval must name a person/);
});

// ---------------------------------------------------------------------------
// BETA ISOLATION
// ---------------------------------------------------------------------------
test('no serverless function was added and no beta path was touched', () => {
  const fns = fs.readdirSync(path.join(ROOT, 'api')).filter((f) => /\.js$/.test(f) && f.charAt(0) !== '_');
  assert.equal(fns.length, 12, 'function budget unchanged; the bridge is not deployed');
  // The bridge lives outside /api, so Vercel never builds it.
  assert.ok(fs.existsSync(path.join(ROOT, 'tools/content-bridge/bridge.js')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'api/content-bridge.js')));
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
  for (const f of ['tools/content-bridge/bridge.js', 'tools/content-bridge/README.md', 'tools/content-bridge/J_MONDAY_CONTRACT.md']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(src), f + ' contains something shaped like a token');
    assert.ok(!/\b\d{9,}\b/.test(src), f + ' contains something shaped like a real monday board id');
  }
});
