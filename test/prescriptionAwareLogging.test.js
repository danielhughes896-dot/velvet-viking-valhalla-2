'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// PRESCRIPTION-AWARE LOGGING.
//
// The athlete already ran a session Valhalla wrote. Asking them to rebuild it
// as anonymous numbered laps is asking them to do the app's work -- the real
// beta report was someone reconstructing a Garmin interval session by hand.
//
// Two properties matter more than any individual row. First, the structure
// must come from the prescription that already exists, never from a second
// workout schema. Second, a prescribed value may only be shown where one
// genuinely exists: roughly a third of archetypes prescribe recoveries and
// flanks as RULES ("scaled to the rep", "jog/walk back down") rather than
// numbers, and printing a figure there would invent a target the athlete was
// never given.
const TODAY = '2026-05-20';
function app() {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {};
  buildPlan(a, { weeks: 14, startDate: a.addDays(TODAY, -28),
                 distanceKey: 'full', volume: 60, benchSec: 3 * 3600 + 15 * 60 });
  a.state.setup.benchmark = { distanceKey: 'full', timeSec: 3 * 3600 + 15 * 60 };
  a.state.setup.goals = { A: { timeSec: 3 * 3600 + 10 * 60 } };
  a.state.setup.lthr = 172;
  a.state.setup.maxHR = 197;
  return a;
}
const P = (a, arch, params) => ({ v: a.PRESCRIPTION_VERSION, archetype: arch, params: params });

// Every archetype the generator can emit, with representative parameters.
const ARCHETYPE_CASES = {
  easy_run:             { params:{km:9},                        type:'easy' },
  shakeout:             { params:{km:5},                        type:'easy' },
  long_run:             { params:{km:20},                       type:'long' },
  long_run_b2b:         { params:{km:16},                       type:'long' },
  long_run_goal_finish: { params:{km:23, finishKm:6},           type:'long' },
  race:                 { params:{km:42.2},                     type:'race' },
  time_trial:           { params:{ttKm:5, flankKm:2},           type:'checkpoint' },
  threshold_continuous: { params:{km:5},                        type:'threshold' },
  goal_pace_block:      { params:{km:10},                       type:'tempo' },
  steady_tempo:         { params:{min:20},                      type:'tempo' },
  progressive_tempo:    { params:{min:25},                      type:'tempo' },
  split_tempo:          { params:{min:24, split:2},             type:'tempo' },
  track_reps:           { params:{reps:5, m:1000},              type:'interval' },
  short_reps:           { params:{reps:8, m:400},               type:'repetition' },
  goal_pace_reps:       { params:{reps:4, m:1600},              type:'tempo' },
  ladder:               { params:{rungs:[400,800,1200,800,400]},type:'interval' },
  deuce:                { params:{sets:2, reps:4, m:400},       type:'interval' },
  hill_repeats:         { params:{reps:8, sec:45},              type:'interval' },
  fartlek:              { params:{reps:5, min:2},               type:'interval' },
  easy_strides:         { params:{easyKm:8, reps:6, m:100},     type:'easy' }
};
const ARCHETYPES = Object.keys(ARCHETYPE_CASES);
// Archetypes whose prescription genuinely carries no number on some segment.
const QUALIFIER_ONLY = ['steady_tempo','progressive_tempo','goal_pace_reps','ladder',
                        'deuce','hill_repeats','fartlek','easy_strides'];

function dayFor(a, arch, extra) {
  const c = ARCHETYPE_CASES[arch];
  const dd = Object.assign({
    id:'2026-05-25', date:'2026-05-25', week:1, type:c.type, title:arch,
    km: c.params.km || 20, prescription: P(a, arch, c.params)
  }, extra || {});
  a.state.days.push(dd);
  return dd;
}

// ---------------------------------------------------------------------------
// 1. THE ORDERED MODEL
// ---------------------------------------------------------------------------
test('every archetype decomposes without throwing, and never invents a segment', () => {
  const a = app();
  ARCHETYPES.forEach(arch => {
    const segs = a.orderedSegments(P(a, arch, ARCHETYPE_CASES[arch].params));
    assert.ok(Array.isArray(segs) && segs.length, arch + ' must decompose');
    segs.forEach(s => {
      assert.ok(s.segId, arch + ': every segment needs a stable id');
      assert.ok(s.kind === 'work' || s.kind === 'recovery', arch + ': unexpected kind ' + s.kind);
    });
    const ids = segs.map(s => s.segId);
    assert.equal(new Set(ids).size, ids.length, arch + ': segment ids must be unique');
  });
});

test('reps and recoveries interleave in the order they are actually run', () => {
  const a = app();
  const shape = a.orderedSegments(P(a, 'track_reps', { reps:5, m:1000 }))
    .map(s => s.role === 'warmup' ? 'WU' : s.role === 'cooldown' ? 'CD'
            : s.kind === 'recovery' ? 'r' : 'R').join(' ');
  assert.equal(shape, 'WU R r R r R r R r R CD',
    'the existing walkers emit all reps then all recoveries; logging needs running order');
});

test('cardinality is borrowed from repeatChildCount, not restated', () => {
  const a = app();
  // 'between': no recovery after the final rep.
  const f = a.orderedSegments(P(a, 'fartlek', { reps:5, min:2 }));
  assert.equal(f.filter(s => s.kind === 'work' && s.role === 'work').length, 5);
  assert.equal(f.filter(s => s.kind === 'recovery').length, 4, 'fartlek: 5 reps, 4 recoveries');
  // 'after_each': you cannot start the cool-down from the top of the hill.
  const h = a.orderedSegments(P(a, 'hill_repeats', { reps:8, sec:45 }));
  assert.equal(h.filter(s => s.kind === 'work' && s.role === 'work').length, 8);
  assert.equal(h.filter(s => s.kind === 'recovery').length, 8, 'hills: 8 reps, 8 recoveries');
});

test('nested repeats (deuce sets) flatten in the right order', () => {
  const a = app();
  const d = a.orderedSegments(P(a, 'deuce', { sets:2, reps:4, m:400 }));
  const work = d.filter(s => s.kind === 'work' && s.role === 'work').length;
  const rec = d.filter(s => s.kind === 'recovery').length;
  assert.equal(work, 8, '2 sets x 4 reps');
  assert.equal(rec, 7, '3 within each set, plus 1 between the sets');
  assert.equal(d[0].role, 'warmup');
  assert.equal(d[d.length - 1].role, 'cooldown');
});

test('warm-up and cool-down roles survive, and are not numbered as reps', () => {
  const a = app();
  ['track_reps','fartlek','ladder','deuce','hill_repeats'].forEach(arch => {
    const segs = a.orderedSegments(P(a, arch, ARCHETYPE_CASES[arch].params));
    const flanks = segs.filter(s => s.role === 'warmup' || s.role === 'cooldown');
    assert.ok(flanks.length >= 2, arch + ' keeps its flanks');
    flanks.forEach(s => assert.equal(s.repIndex, undefined, arch + ': a flank is not a rep'));
  });
});

// ---------------------------------------------------------------------------
// 2. NO INVENTED PRESCRIPTIONS
// ---------------------------------------------------------------------------
test('a segment prescribed as a rule reports no number', () => {
  const a = app();
  const cases = [
    ['hill_repeats', 'recovery', 'jog/walk back down'],
    ['ladder',       'recovery', 'scaled to the rep'],
    ['easy_strides', 'recovery', 'full recovery']
  ];
  cases.forEach(([arch, role, expected]) => {
    const segs = a.orderedSegments(P(a, arch, ARCHETYPE_CASES[arch].params));
    const s = segs.filter(x => x.kind === role)[0];
    assert.equal(a.segmentPrescribed(s), expected, arch + ': a rule stays a rule');
    assert.equal(s.km, null); assert.equal(s.m, null); assert.equal(s.sec, null);
  });
});

test('an unquantified flank exposes no distance at all', () => {
  const a = app();
  ['fartlek','hill_repeats','steady_tempo','progressive_tempo'].forEach(arch => {
    const segs = a.orderedSegments(P(a, arch, ARCHETYPE_CASES[arch].params));
    const wu = segs.filter(s => s.role === 'warmup')[0];
    assert.ok(wu, arch + ' has a warm-up');
    assert.equal(a.segmentPrescribed(wu), null,
      arch + ': the warm-up is prescribed as "easy jog" with no distance, so none may be shown');
  });
});

test('no rendered structured row shows a prescribed value the model does not hold', () => {
  const a = app();
  ARCHETYPES.forEach(arch => {
    const dd = dayFor(a, arch, { completed:true, actual:a.emptyActual() });
    const plan = a.structuredLoggingPlan(dd);
    a.state.days.pop();
    if (!plan) return;
    plan.rows.forEach(r => {
      if (r.prescribed == null) return;
      assert.notEqual(r.prescribed, '', arch + ': empty prescribed string is worse than none');
      assert.doesNotMatch(String(r.prescribed), /NaN|undefined|null/,
        arch + '/' + r.label + ': malformed prescribed value');
    });
  });
});

// ---------------------------------------------------------------------------
// 3. SOURCE-OF-TRUTH MAPPING
// ---------------------------------------------------------------------------
test('the mapping routes each archetype to the source that actually helps', () => {
  const a = app();
  const expected = {
    easy_run:'flat', shakeout:'flat',
    long_run:'phases', long_run_b2b:'phases', long_run_goal_finish:'phases', race:'phases',
    time_trial:'segments', threshold_continuous:'segments', goal_pace_block:'segments',
    steady_tempo:'segments', progressive_tempo:'segments', split_tempo:'segments',
    track_reps:'segments', short_reps:'segments', goal_pace_reps:'segments',
    ladder:'segments', deuce:'segments', hill_repeats:'segments', fartlek:'segments',
    easy_strides:'segments'
  };
  ARCHETYPES.forEach(arch => {
    const dd = dayFor(a, arch);
    const plan = a.structuredLoggingPlan(dd);
    a.state.days.pop();
    assert.equal(plan ? plan.source : 'flat', expected[arch], arch + ' routed to the wrong source');
  });
});

test('a flanked continuous session uses segments, because phases would invent boundaries', () => {
  const a = app();
  const dd = dayFor(a, 'steady_tempo');
  const plan = a.structuredLoggingPlan(dd);
  assert.equal(plan.source, 'segments');
  const wu = plan.rows[0];
  assert.equal(wu.label, 'Warm up');
  assert.equal(wu.prescribed, null,
    'Strategy would report "from 0km" here, derived from the day total and prescribed nowhere');
});

test('a long run and a race use phases, because segments give them one row', () => {
  const a = app();
  [['long_run', 2], ['race', 4]].forEach(([arch, atLeast]) => {
    const raw = a.orderedSegments(P(a, arch, ARCHETYPE_CASES[arch].params));
    assert.equal(raw.length, 1, arch + ': raw segments really are one row');
    const dd = dayFor(a, arch);
    const plan = a.structuredLoggingPlan(dd);
    a.state.days.pop();
    assert.equal(plan.source, 'phases');
    assert.ok(plan.rows.length >= atLeast, arch + ' gains real grain from phases');
  });
});

// ---------------------------------------------------------------------------
// 4. WHAT THE ATHLETE IS ASKED FOR
// ---------------------------------------------------------------------------
test('one prescribed dimension is never asked for again', () => {
  const a = app();
  ARCHETYPES.forEach(arch => {
    const dd = dayFor(a, arch);
    const plan = a.structuredLoggingPlan(dd);
    a.state.days.pop();
    if (!plan || plan.source !== 'segments') return;
    const segs = a.orderedSegments(P(a, arch, ARCHETYPE_CASES[arch].params));
    plan.rows.forEach((r, i) => {
      const s = segs[i];
      if (s.km != null || s.m != null)
        assert.equal(r.asks.dist, false, arch + '/' + r.label + ': distance is prescribed, do not re-ask');
      if (s.sec != null)
        assert.equal(r.asks.time, false, arch + '/' + r.label + ': time is prescribed, do not re-ask');
    });
  });
});

test('a segment with nothing prescribed asks for both, having nothing to derive from', () => {
  const a = app();
  const dd = dayFor(a, 'hill_repeats');
  const plan = a.structuredLoggingPlan(dd);
  const rec = plan.rows.filter(r => r.role === 'recovery')[0];
  // JSON round-trip: objects from the VM sandbox carry the sandbox's own
  // prototype, so deepStrictEqual fails on identity even when values match.
  assert.deepEqual(JSON.parse(JSON.stringify(rec.asks)), { dist:true, time:true });
});

// ---------------------------------------------------------------------------
// 5. ENTRY, DERIVATION, VALIDATION
// ---------------------------------------------------------------------------
function fartlekDay(a) {
  const dd = dayFor(a, 'fartlek', { completed:true, actual:a.emptyActual() });
  dd.actual.km = 8; dd.actual.pace = '5:00';
  return dd;
}
const REP_IDS = ['s.1.0.0.0','s.1.1.0.0','s.1.2.0.0','s.1.3.0.0','s.1.4.0.0'];
const REC_IDS = ['s.1.0.1.0','s.1.1.1.0','s.1.2.1.0','s.1.3.1.0'];

test('an untouched structured session stores nothing at all', () => {
  const a = app();
  const dd = fartlekDay(a);
  assert.equal(a.loggingModeFor(dd).mode, 'structured');
  a.renderSplitsBlock(dd);
  assert.ok(!dd.actual.splits || !dd.actual.splits.length, 'rendering is not logging');
});

test('a time-prescribed rep logged by distance alone still yields a pace', () => {
  const a = app();
  const dd = fartlekDay(a);
  a.handleStructuredSplitChange(dd.id, REP_IDS[0], 'km', '0.58');
  const s = dd.actual.splits[0];
  assert.equal(s.km, 0.58);
  assert.equal(s.sec, 120, 'the prescribed two minutes is the time that was run');
  assert.equal(s.paceSec, Math.round(120 / 0.58));
});

test('rep distance round-trips at rep precision, not session precision', () => {
  const a = app();
  const dd = fartlekDay(a);
  a.handleStructuredSplitChange(dd.id, REP_IDS[0], 'km', '0.55');
  assert.equal(dd.actual.splits[0].km, 0.55, 'one decimal would make this 0.6 -- a 9% error');
  assert.match(a.renderSplitsBlock(dd), /value="0\.55"/, 'and it must redisplay as entered');
});

test('invalid values are refused without creating a phantom segment', () => {
  const a = app();
  const dd = fartlekDay(a);
  ['-1', '0', 'abc', ''].forEach(v => a.handleStructuredSplitChange(dd.id, REP_IDS[0], 'km', v));
  assert.ok(!dd.actual.splits || !dd.actual.splits.length);
  a.handleStructuredSplitChange(dd.id, REP_IDS[0], 'hr', '-5');
  assert.ok(!dd.actual.splits || !dd.actual.splits.length);
});

test('emptying a row removes it, so a blank segment is never counted as evidence', () => {
  const a = app();
  const dd = fartlekDay(a);
  a.handleStructuredSplitChange(dd.id, REP_IDS[0], 'km', '0.58');
  assert.equal(dd.actual.splits.length, 1);
  a.handleStructuredSplitChange(dd.id, REP_IDS[0], 'km', '');
  assert.equal(dd.actual.splits.length, 0);
});

test('partial logging is valid, and rows are stored in the order they were run', () => {
  const a = app();
  const dd = fartlekDay(a);
  a.handleStructuredSplitChange(dd.id, REP_IDS[2], 'km', '0.56');
  a.handleStructuredSplitChange(dd.id, REP_IDS[0], 'km', '0.58');
  assert.deepEqual(JSON.parse(JSON.stringify(dd.actual.splits.map(s => s.segId))),
    [REP_IDS[0], REP_IDS[2]],
    'stored in plan order regardless of the order they were typed');
});

test('an unknown segment id is ignored rather than invented', () => {
  const a = app();
  const dd = fartlekDay(a);
  a.handleStructuredSplitChange(dd.id, 'nope.42', 'km', '5');
  assert.ok(!dd.actual.splits || !dd.actual.splits.length);
});

// ---------------------------------------------------------------------------
// 6. EXECUTION REVIEW -- HONEST CLAIMS ONLY
// ---------------------------------------------------------------------------
function loggedFartlek(a, repKms, recKms) {
  const dd = fartlekDay(a);
  repKms.forEach((km, i) => a.handleStructuredSplitChange(dd.id, REP_IDS[i], 'km', String(km)));
  (recKms || []).forEach((km, i) => a.handleStructuredSplitChange(dd.id, REC_IDS[i], 'km', String(km)));
  return dd;
}

test('rep consistency and fade are reported from real reps', () => {
  const a = app();
  const dd = loggedFartlek(a, [0.58, 0.57, 0.56, 0.55, 0.54]);
  const se = a.structuredExecutionEvidence(dd);
  assert.equal(se.reps, 5);
  assert.ok(se.repConsistencyPct > 90);
  assert.ok(se.repFadePct > 0, 'each rep shorter than the last is a fade');
  assert.ok(se.claims.some(c => /consistency across 5 reps/.test(c)));
});

test('fewer than three reps produces no rep claim', () => {
  const a = app();
  const dd = loggedFartlek(a, [0.58, 0.57]);
  const se = a.structuredExecutionEvidence(dd);
  assert.ok(!se || !se.claims.some(c => /consistency/.test(c)),
    'two numbers is a difference, not a trend');
});

test('no structured log produces no structured claim', () => {
  const a = app();
  const dd = fartlekDay(a);
  assert.equal(a.structuredExecutionEvidence(dd), null);
  assert.doesNotMatch(a.renderExecutionReview(dd), /Execution by segment/);
});

test('work-vs-recovery separation is described, never judged for compliance', () => {
  const a = app();
  const dd = loggedFartlek(a, [0.58,0.57,0.56,0.55,0.54], [0.34,0.33,0.33,0.32]);
  const se = a.structuredExecutionEvidence(dd);
  assert.ok(se.workRecoveryGapSec > 0);
  const text = se.claims.join(' ');
  assert.match(text, /genuinely different efforts/);
  assert.doesNotMatch(text, /too slow|too fast|should have|failed to/i,
    'no prescribed recovery pace exists anywhere, so no adherence verdict is possible');
});

test('structured claims never become medical claims', () => {
  const a = app();
  const dd = loggedFartlek(a, [0.58,0.57,0.56,0.55,0.54], [0.34,0.33,0.33,0.32]);
  const html = a.renderExecutionReview(dd);
  assert.doesNotMatch(html, /injur|illness|arrhythmia|abnormal heart|medical|see a doctor/i);
});

test('the structured read reaches the review card once there is evidence', () => {
  const a = app();
  const dd = loggedFartlek(a, [0.58,0.57,0.56,0.55,0.54]);
  assert.match(a.renderExecutionReview(dd), /Execution by segment/);
});

// ---------------------------------------------------------------------------
// 7. FALLBACKS AND LEGACY STATE
// ---------------------------------------------------------------------------
test('a day with no prescription falls back to the flat editor', () => {
  const a = app();
  const dd = { id:'2026-05-25', date:'2026-05-25', week:1, type:'interval', title:'Hand written',
               km:8, completed:true, actual:a.emptyActual() };
  a.state.days.push(dd);
  assert.equal(a.loggingModeFor(dd).mode, 'flat');
  assert.match(a.renderSplitsBlock(dd), /Add laps \/ splits/);
});

test('an edited-down workout that dropped its prescription falls back cleanly', () => {
  const a = app();
  const dd = dayFor(a, 'fartlek', { completed:true, actual:a.emptyActual() });
  assert.equal(a.loggingModeFor(dd).mode, 'structured');
  a.rescaleOrDropPrescription(dd, 6);           // fartlek is not rescalable -> dropped
  assert.equal(a.prescriptionOf(dd), null);
  assert.equal(a.loggingModeFor(dd).mode, 'flat');
  assert.doesNotThrow(() => a.renderSplitsBlock(dd));
});

test('a legacy flat log keeps the flat editor and is never rebuilt as segments', () => {
  const a = app();
  const dd = dayFor(a, 'fartlek', { completed:true, actual:a.emptyActual() });
  dd.actual.splits = [{paceSec:300},{paceSec:305},{paceSec:310},{paceSec:315}];
  assert.equal(a.loggingModeFor(dd).mode, 'flat', 'guessing which lap was which rep would invent history');
  assert.ok(a.coachSplitMetrics(dd), 'and the old rows still compute');
  assert.match(a.renderSplitsBlock(dd), /split-row/);
});

test('a rest day and an easy run are never given a structured form', () => {
  const a = app();
  const rest = { id:'2026-05-25', date:'2026-05-25', week:1, type:'rest', title:'Rest', km:0 };
  a.state.days.push(rest);
  assert.equal(a.structuredLoggingPlan(rest), null);
  a.state.days.pop();
  const easy = dayFor(a, 'easy_run');
  assert.equal(a.structuredLoggingPlan(easy), null, 'one row is a worse flat editor, not a better one');
});

test('malformed prescription params do not crash the editor', () => {
  const a = app();
  const dd = { id:'2026-05-25', date:'2026-05-25', week:1, type:'interval', title:'Broken', km:8,
               completed:true, actual:a.emptyActual(),
               prescription:{ v:a.PRESCRIPTION_VERSION, archetype:'ladder', params:{} } };
  a.state.days.push(dd);
  assert.doesNotThrow(() => a.loggingModeFor(dd));
  assert.doesNotThrow(() => a.renderSplitsBlock(dd));
});

// ---------------------------------------------------------------------------
// 8. PERSISTENCE, SYNC, HISTORY
// ---------------------------------------------------------------------------
test('structured splits are ordinary members of the existing contract', () => {
  const a = app();
  assert.ok(a.ACTUAL_SYNCED_FIELDS.indexOf('splits') !== -1,
    'no new synced field is required, so no migration is either');
  const dd = loggedFartlek(a, [0.58,0.57,0.56,0.55,0.54]);
  assert.ok(a.coachSplitMetrics(dd), 'the analysis layer reads them unchanged');
});

test('a structured log survives a persistence round-trip intact', () => {
  const a = app();
  const dd = loggedFartlek(a, [0.58,0.57,0.56,0.55,0.54], [0.34,0.33,0.33,0.32]);
  const before = JSON.parse(JSON.stringify(dd.actual.splits));
  const b = app();
  b.state = JSON.parse(JSON.stringify(a.state));
  const back = b.findDay(dd.id);
  assert.deepEqual(back.actual.splits, before);
  assert.ok(b.structuredExecutionEvidence(back), 'and still reads as structured evidence');
});

test('a structured edit moves the sync signature', () => {
  const a = app();
  const dd = fartlekDay(a);
  const before = a.planContentSignature(a.state);
  a.handleStructuredSplitChange(dd.id, REP_IDS[0], 'km', '0.58');
  assert.notEqual(a.planContentSignature(a.state), before,
    'a change to laps alone must not be invisible to cloud reconciliation');
});

test('Clear Log clears structured splits with everything else', () => {
  const a = app();
  const dd = loggedFartlek(a, [0.58,0.57,0.56,0.55,0.54]);
  a.handleClearActual(dd.id);
  assert.equal(dd.actual.splits, undefined, 'there is one log, not two');
});

test('logging one day never touches another day', () => {
  const a = app();
  const dd = loggedFartlek(a, [0.58,0.57,0.56,0.55,0.54]);
  const other = a.state.days.filter(d => d.id !== dd.id && d.type !== 'rest')[0];
  other.completed = true; other.actual = a.emptyActual(); other.actual.km = 5;
  const snapshot = JSON.stringify(other);
  a.handleStructuredSplitChange(dd.id, REP_IDS[1], 'km', '0.57');
  assert.equal(JSON.stringify(other), snapshot);
});

test('rendering the editor never mutates the plan', () => {
  const a = app();
  ARCHETYPES.forEach(arch => {
    const dd = dayFor(a, arch, { completed:true, actual:a.emptyActual() });
    const before = JSON.stringify(a.state.days);
    a.renderSplitsBlock(dd);
    assert.equal(JSON.stringify(a.state.days), before, arch + ': reading may not write');
    a.state.days.pop();
  });
});

// ---------------------------------------------------------------------------
// 9. EXPERIENCE LEVELS AND CARD SIZE
// ---------------------------------------------------------------------------
test('the logging structure is identical at every experience level', () => {
  const a = app();
  const shapes = ['novice','experienced','advanced'].map(lvl => {
    a.state.setup.experience = lvl;
    const dd = dayFor(a, 'track_reps');
    const plan = a.structuredLoggingPlan(dd);
    a.state.days.pop();
    return plan.rows.map(r => r.label + '|' + r.prescribed).join(',');
  });
  assert.equal(shapes[0], shapes[1]);
  assert.equal(shapes[1], shapes[2], 'experience changes explanation, never what was prescribed');
});

test('the worst-case sessions stay bounded and collapsed by default', () => {
  const a = app();
  ['short_reps','deuce','hill_repeats'].forEach(arch => {
    const dd = dayFor(a, arch, { completed:true, actual:a.emptyActual() });
    const plan = a.structuredLoggingPlan(dd);
    assert.ok(plan.rows.length <= 20, arch + ' must not explode: ' + plan.rows.length);
    const closed = a.renderSplitsBlock(dd);
    assert.doesNotMatch(closed, /slog-row/, arch + ' must be closed until asked for');
    assert.match(closed, /Log the session breakdown/);
    a.state.days.pop();
  });
});

test('a partial structured log is not reported as a discrepancy', () => {
  const a = app();
  const dd = loggedFartlek(a, [0.58, 0.57, 0.56, 0.55, 0.54]);   // reps only
  assert.equal(dd.actual.km, 8, 'the whole-session distance is still 8km');
  const html = a.renderSplitsBlock(dd);
  assert.match(html, /Logged so far/, 'five reps out of eleven segments is normal use');
  assert.doesNotMatch(html, /correct whichever is off/,
    'the athlete has contradicted nothing by leaving recoveries blank');
});

test('a complete structured log that really disagrees still says so', () => {
  const a = app();
  const dd = fartlekDay(a);
  const plan = a.structuredLoggingPlan(dd);
  plan.rows.forEach(r => a.handleStructuredSplitChange(dd.id, r.segId, 'km', '0.2'));
  const html = a.renderSplitsBlock(dd);
  assert.match(html, /Lap total/);
  assert.match(html, /correct whichever is off/,
    'every segment answered and the total is 2.2km against a logged 8km');
});
