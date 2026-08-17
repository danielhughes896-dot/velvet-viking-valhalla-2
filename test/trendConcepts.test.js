'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// Two layers group trend ids into concepts, for two different reasons:
//
//   coachDecision()  keeps only the STRONGEST reading of each concept, so one
//                    underlying fact cannot vote twice;
//   athleteTrends()  stamps each trend with its concept, which the Playbook
//                    counts so "more than one pattern agrees" counts PATTERNS
//                    rather than readings of one pattern.
//
// They used to spell two of those concepts differently. The heartbeat-cost
// signal was `hr` in one map and `hr_cost` in the other; the day-after-a-hard-
// session signal was `recovery_after` in one and `recovery` in the other.
// Their consumers never met, so nothing was broken -- what was broken was that
// editing one map looked complete and was not.
//
// THIS IS A RENAME AND NOTHING ELSE. These tests exist to prove that: the
// partitions below were read off the source BEFORE the change and are asserted
// against it after, so a normalisation that quietly merged or split a concept
// would fail here rather than change what the coach believes.
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'protected', 'velvet-viking-valhalla.html'), 'utf8');

/* Which ids share a concept -- the only thing that affects behaviour. The
   strings are free to change; these groupings are not. Taken verbatim from the
   pre-normalisation source. */
const DECISION_PARTITION_BEFORE = [
  ['easy_hr_elevated', 'easy_efficiency_down'],                 // was 'hr'
  ['rpe_elevated_easy', 'rpe_elevated_quality', 'rpe_elevated_long'],
  ['feel_negative', 'readiness_poor'],
  ['execution_declining'],
  ['post_hard_recovery', 'post_long_run_recovery', 'recovery_slower_than_personal']
];
const TREND_PARTITION_BEFORE = [
  ['easy_hr_elevated', 'easy_hr_improved'],
  ['execution_declining', 'execution_consistent'],
  ['rpe_elevated_easy', 'rpe_lower_easy', 'rpe_elevated_quality', 'rpe_lower_quality',
   'rpe_elevated_long', 'rpe_lower_long'],
  ['feel_negative', 'feel_positive', 'readiness_poor'],
  ['post_hard_recovery', 'post_long_run_recovery', 'post_long_run_recovery_improved',
   'recovery_slower_than_personal', 'recovery_faster_than_personal'],
  ['consistency']
];

/* Read key:'value' pairs, not every quoted run -- the vocabulary's comments
   contain apostrophes ("this athlete's norm"), and a naive quote scan splits
   on them and invents concepts nobody wrote. */
function vocabulary(){
  const at = SRC.indexOf('var EVIDENCE_CONCEPT = {');
  const body = SRC.slice(at, SRC.indexOf('\n};', at));
  const out = {};
  [...body.matchAll(/^\s*(\w+):\s*'([^']+)'/gm)].forEach(m => { out[m[1]] = m[2]; });
  return out;
}

/* The maps live inside their functions, so they are read out of the source and
   resolved against the shared vocabulary. Reading the source rather than
   exporting the maps keeps the production code exactly as it ships. */
function mapIn(name){
  const at = SRC.indexOf('var ' + name + ' = {');
  assert.ok(at !== -1, name + ' not found');
  const body = SRC.slice(at, SRC.indexOf('\n  };', at));
  const vocab = vocabulary();
  const out = {};
  [...body.matchAll(/(\w+)\s*:\s*(?:EVIDENCE_CONCEPT|C)\.(\w+)/g)]
    .forEach(m => { out[m[1]] = vocab[m[2]]; });
  [...body.matchAll(/(\w+)\s*:\s*'([^']+)'/g)]
    .forEach(m => { if (m[1] !== 'hrCost') out[m[1]] = m[2]; });
  return out;
}
const partitionOf = map => {
  const groups = {};
  Object.keys(map).forEach(id => { (groups[map[id]] = groups[map[id]] || []).push(id); });
  return Object.keys(groups).map(k => groups[k].slice().sort()).sort((x, y) => x[0] < y[0] ? -1 : 1);
};
const norm = ps => ps.map(g => g.slice().sort()).sort((x, y) => x[0] < y[0] ? -1 : 1);

// ---------------------------------------------------------------------------
// BEHAVIOURAL EQUIVALENCE
// ---------------------------------------------------------------------------
test('the decision groups exactly the ids it grouped before', () => {
  assert.deepEqual(partitionOf(mapIn('CONCEPT_OF_TREND')), norm(DECISION_PARTITION_BEFORE),
    'a rename that merged or split a concept would change what one fact is worth');
});

test('the trend layer groups exactly the ids it grouped before', () => {
  assert.deepEqual(partitionOf(mapIn('TREND_CONCEPT')), norm(TREND_PARTITION_BEFORE),
    'and would change what the Playbook counts as two agreeing patterns');
});

// ---------------------------------------------------------------------------
// ONE NAME PER FACT
// ---------------------------------------------------------------------------
test('the two maps no longer disagree about any shared id', () => {
  const dec = mapIn('CONCEPT_OF_TREND'), tr = mapIn('TREND_CONCEPT');
  const shared = Object.keys(dec).filter(id => id in tr);
  assert.ok(shared.length >= 8, 'the maps genuinely overlap, so agreement is worth asserting');
  shared.forEach(id => assert.equal(dec[id], tr[id],
    id + ' still has two names — the maintenance trap this pass closed'));
});

test('both maps name their concepts from the one vocabulary', () => {
  const vocab = new Set(Object.keys(vocabulary()).map(k => vocabulary()[k]));
  [mapIn('CONCEPT_OF_TREND'), mapIn('TREND_CONCEPT')].forEach(map => {
    Object.keys(map).forEach(id =>
      assert.ok(vocab.has(map[id]), map[id] + ' is not in the shared vocabulary'));
  });
});

test('the retired spellings are gone from the code', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(!/'recovery_after'/.test(code), 'recovery_after was one of the two names');
  assert.ok(!/add\('hr',/.test(code), "and add('hr', ...) was the other");
});

// ---------------------------------------------------------------------------
// THE COLLISION THAT IS LOAD-BEARING
// ---------------------------------------------------------------------------
test('the acute heart-rate reading still shares a concept with the heart-rate trend', () => {
  /* This collision is deliberate and was fixed into the product once already:
     attributing every `strained` week to `effort` meant a heart-rate excursion
     scored once as hr and again as effort, so heart rate was silently worth
     double. If the rename had moved the acute evidence out of the trend's
     concept, that bug would be back and nothing would have failed. */
  const dec = mapIn('CONCEPT_OF_TREND');
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  const acute = [...code.matchAll(/add\(EVIDENCE_CONCEPT\.(\w+),\s*\d+,\s*'(?:Heart rate|\d)/g)]
    .map(m => m[1]);
  assert.ok(acute.length >= 1, 'the acute heart-rate evidence must still be attributed');
  const vocab = vocabulary();
  acute.forEach(k => assert.equal(vocab[k], dec.easy_hr_elevated,
    'heart rate must count once, whether it arrives acutely or as a trend'));
});

test('effort and heart rate remain different concepts', () => {
  const dec = mapIn('CONCEPT_OF_TREND');
  assert.notEqual(dec.rpe_elevated_easy, dec.easy_hr_elevated,
    'where both really happened the two stand side by side, which is the only ' +
    'case that should score higher than either alone');
});

// ---------------------------------------------------------------------------
// NOTHING ELSE MOVED
// ---------------------------------------------------------------------------
test('a plan with no evidence still decides exactly as it did', () => {
  const a = loadApp({ pinnedDate: '2026-05-20T09:00:00Z' });
  buildPlan(a, { weeks: 10, startDate: a.addDays('2026-05-20', -21) });
  const dec = a.coachDecision();
  assert.ok(dec, 'a decision is still produced');
  assert.ok(['proceed', 'check', 'modify', 'recover'].indexOf(dec.state) !== -1);
  assert.equal(typeof dec.score, 'number');
});

test('every trend still carries a concept, and none is left as its raw id', () => {
  const a = loadApp({ pinnedDate: '2026-05-20T09:00:00Z' });
  buildPlan(a, { weeks: 10, startDate: a.addDays('2026-05-20', -21) });
  const known = new Set(Object.keys(mapIn('TREND_CONCEPT')));
  (a.athleteTrends() || []).forEach(t => {
    assert.ok(t.concept, t.id + ' has no concept');
    if (known.has(t.id)) assert.equal(t.concept, mapIn('TREND_CONCEPT')[t.id]);
  });
});

test('thresholds, confidence and weights were not touched', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(code, /weight: t\.confidence==='established' \? 2 : 1/,
    'trend weighting is unchanged');
  assert.match(code, /if \(!best\[e\.concept\] \|\| e\.weight > best\[e\.concept\]\.weight\)/,
    'the strongest-reading rule is unchanged');
  assert.match(code, /shared >= Math\.ceil\(dates\.length \* 0\.5\)/,
    'the evidence-overlap de-duplication is unchanged');
});

// ---------------------------------------------------------------------------
// THE DROP PATH THAT NOTHING EMITS
// ---------------------------------------------------------------------------
test('drop is still executable, and still emitted by nothing', () => {
  const a = loadApp({ pinnedDate: '2026-05-20T09:00:00Z' });
  const pending = [
    { id: 'd1', date: '2026-05-21', type: 'threshold', km: 10, completed: false },
    { id: 'd2', date: '2026-05-22', type: 'easy', km: 6, completed: false }
  ];
  const out = a.applyChangesToCopy(pending, [{ kind: 'drop', dayId: 'd1' }]);
  assert.equal(out[0].type, 'rest', 'the projection can still model a dropped session');
  assert.equal(out[0].km, 0);
  assert.equal(out[1].type, 'easy', 'and nothing else moves');
});

test('normal Plan Evolution emits no drop, in any state or phase', () => {
  const a = loadApp({ pinnedDate: '2026-05-20T09:00:00Z' });
  const pending = [
    { id: 'd1', date: '2026-05-21', type: 'easy', km: 5, completed: false },
    { id: 'd2', date: '2026-05-22', type: 'threshold', km: 10, completed: false },
    { id: 'd3', date: '2026-05-23', type: 'long', km: 20, completed: false },
    { id: 'd4', date: '2026-05-24', type: 'interval', km: 9, completed: false }
  ];
  ['HOLD', 'PROGRESS', 'MONITOR', 'ADAPT', 'RECOVER'].forEach(st => {
    ['Base', 'Build', 'Peak', 'Taper', 'Race Week', 'Final Week'].forEach(ph => {
      (a.evolutionChanges(st, ph, pending, []) || []).forEach(c => {
        assert.notEqual(c.kind, 'drop',
          st + '/' + ph + ' proposed removing a session — a key session is ' +
          'shortened, never removed, and normal fatigue adaptation does not ' +
          'erase the training the block exists for');
      });
    });
  });
});

test('race and checkpoint sessions are never proposed for change at all', () => {
  const a = loadApp({ pinnedDate: '2026-05-20T09:00:00Z' });
  const pending = [
    { id: 'r1', date: '2026-05-23', type: 'race', km: 21, completed: false },
    { id: 'c1', date: '2026-05-24', type: 'checkpoint', km: 10, completed: false }
  ];
  ['ADAPT', 'RECOVER'].forEach(st => {
    (a.evolutionChanges(st, 'Peak', pending, []) || []).forEach(c => {
      assert.ok(['r1', 'c1'].indexOf(c.dayId) === -1,
        'the day the block is for is not an adaptation candidate');
    });
  });
});

test('the drop branch says why it is there', () => {
  /* Anchored inside applyChangesToCopy: `c.kind==='drop'` also appears in
     planEvolution's protectedSessions filter, which is itself evidence that the
     path is wired end to end and simply never taken. */
  const fnAt = SRC.indexOf('function applyChangesToCopy(');
  const at = SRC.indexOf("c.kind==='drop'", fnAt);
  assert.ok(at > fnAt);
  const preamble = SRC.slice(fnAt, at);
  assert.match(preamble, /EXECUTION SUPPORT THAT NOTHING CURRENTLY EMITS/,
    'an unreachable branch with no explanation is the one a future reader deletes');
  assert.match(preamble, /never removed/);
  assert.match(preamble, /[Rr]ace and checkpoint/);
});
