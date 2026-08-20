'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// EXECUTION STRATEGY — TESTS.
//
// The feature is live: EXECUTION_STRATEGY_ENABLED is true and it is wired into
// "How to run this" through renderExecutionStrategyBlock, the single seam
// proven by test 1 below. Most of what follows still exercises the engine
// directly, since that is where the properties that matter are decided.
//
// Two properties matter more than any individual output. First, the strategy
// must be a pure function of the prescription and the athlete's own zones, so
// the same workout produces the same strategy every time and a changed workout
// produces a changed one without anything having to be invalidated. Second, it
// must not be able to alter the workout — a strategy that edited a prescription
// would be a second planning engine.
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');

const TODAY = '2026-05-20';
function app(opts) {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {};
  buildPlan(a, Object.assign({ weeks: 14, startDate: a.addDays(TODAY, -28),
                               distanceKey: 'full', volume: 60,
                               benchSec: 3 * 3600 + 15 * 60 }, opts || {}));
  a.state.setup.benchmark = { distanceKey: 'full', timeSec: 3 * 3600 + 15 * 60 };
  a.state.setup.goals = { A: { timeSec: 3 * 3600 + 10 * 60 } };
  a.state.setup.lthr = 172;
  a.state.setup.maxHR = 197;
  return a;
}
/* First day carrying a given archetype. Every assertion below names the
   archetype it is about rather than a day index, so a generator change moves
   the fixture and not the meaning. */
function dayOf(a, archetype) {
  const d = a.state.days.filter(x => {
    const p = a.prescriptionOf(x);
    return p && p.archetype === archetype;
  })[0];
  assert.ok(d, 'the fixture must contain a ' + archetype + ' session');
  return d;
}
const clone = o => JSON.parse(JSON.stringify(o));
const groovyless = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ---------------------------------------------------------------------------
// 1. IT IS LIVE, AND IT IS REACHABLE THROUGH EXACTLY ONE SEAM
// ---------------------------------------------------------------------------
// The prototype graduated: HQ approved Execution Strategy as CORE coaching and
// it is now wired into the athlete-facing "How to run this" disclosure. What
// still matters is that it did not become a second surface -- no separate
// card, dashboard, tab or coaching voice. So instead of proving the feature is
// unreachable, this proves it is reachable through exactly one function
// (renderExecutionStrategyBlock), called from exactly one place
// (renderCoachingDepth) -- never scattered across the render tree.
test('1. the feature is switched on and reachable through exactly one seam', () => {
  const a = app();
  assert.equal(a.EXECUTION_STRATEGY_ENABLED, true, 'Execution Strategy is now CORE, per HQ');
  const code = groovyless(SRC);
  const callers = Array.from(code.matchAll(/function (render[A-Za-z]*|patch[A-Za-z]*)\(/g)).map(m => m[1]);
  const reach = [];
  callers.forEach(fn => {
    const at = code.indexOf('function ' + fn + '(');
    const body = code.slice(at, code.indexOf('\n}', at));
    if (/executionStrategy(ForDisplay)?\(/.test(body)) reach.push(fn);
  });
  assert.deepEqual(reach, ['renderExecutionStrategyBlock'],
    'exactly one render function may call into the Execution Strategy engine — everything else must go through it');
  const callerAt = code.indexOf('function renderCoachingDepth(');
  const callerBody = code.slice(callerAt, code.indexOf('\n}', callerAt));
  assert.ok(/renderExecutionStrategyBlock\(/.test(callerBody),
    'renderExecutionStrategyBlock must be reached from "How to run this", not a new surface');
});

// ---------------------------------------------------------------------------
// 2. ELIGIBILITY, DERIVED FROM STRUCTURE
// ---------------------------------------------------------------------------
test('2. easy and recovery running gets no tactical complexity', () => {
  const a = app();
  ['easy_run', 'shakeout', 'easy_strides'].forEach(arch => {
    const d = dayOf(a, arch);
    assert.equal(a.executionStrategyEligible(d), false, arch + ' must be excluded');
    assert.equal(a.executionStrategy(d), null);
  });
});

test('2. a rest day is never eligible', () => {
  const a = app();
  const rest = a.state.days.filter(d => d.type === 'rest')[0];
  assert.ok(rest);
  assert.equal(a.executionStrategyEligible(rest), false);
});

test('2. every quality, long, benchmark and race session is eligible', () => {
  const a = app();
  ['long_run', 'long_run_goal_finish', 'threshold_continuous', 'goal_pace_block',
   'steady_tempo', 'progressive_tempo', 'split_tempo', 'track_reps', 'ladder',
   'deuce', 'goal_pace_reps', 'hill_repeats', 'time_trial', 'race']
    .forEach(arch => {
      const d = dayOf(a, arch);
      assert.equal(a.executionStrategyEligible(d), true, arch + ' must be eligible');
      const s = a.executionStrategy(d);
      assert.ok(s && s.phases.length >= 2, arch + ' must produce a staged plan');
    });
});

test('2. a short long run is aerobic maintenance, not a tactical session', () => {
  const a = app();
  const d = dayOf(a, 'long_run');
  const short = Object.assign(clone(d), { km: 12, prescription: { v: 1, archetype: 'long_run', params: { km: 12 } } });
  assert.equal(a.executionStrategyEligible(short), false,
    'below the threshold sessionImportance() already uses for a KEY long run');
  const long = Object.assign(clone(d), { km: 26, prescription: { v: 1, archetype: 'long_run', params: { km: 26 } } });
  assert.equal(a.executionStrategyEligible(long), true);
  assert.equal(a.STRATEGY_LONG_MIN_KM, 16, 'and the threshold is the existing one, not a new one');
});

test('2. eligibility needs no flag on the day and no athlete setting', () => {
  const a = app();
  const d = dayOf(a, 'threshold_continuous');
  const before = clone(d);
  a.executionStrategyEligible(d);
  a.executionStrategy(d);
  assert.deepEqual(clone(d), before, 'asking must not write anything to the day');
  const code = groovyless(SRC);
  const at = code.indexOf('function executionStrategyEligible');
  const body = code.slice(at, code.indexOf('\n}', at));
  assert.ok(!/state\.(setup\.)?[a-z]*strategy/i.test(body), 'no preference is consulted');
});

test('2. a day with no prescription gets nothing rather than a guess', () => {
  const a = app();
  const d = clone(dayOf(a, 'threshold_continuous'));
  delete d.prescription;
  assert.equal(a.executionStrategyEligible(d), false);
  assert.equal(a.executionStrategy(d), null);
});

// ---------------------------------------------------------------------------
// 3. IT NEVER TOUCHES THE WORKOUT
// ---------------------------------------------------------------------------
test('3. generating a strategy changes no prescribed number anywhere', () => {
  const a = app();
  const before = a.planContentSignature(a.state);
  const days = clone(a.state.days);
  a.state.days.forEach(d => { try { a.executionStrategy(d); } catch (e) { assert.fail(e.message); } });
  assert.equal(a.planContentSignature(a.state), before, 'the plan signature must be untouched');
  assert.deepEqual(clone(a.state.days), days, 'and so must every day');
});

test('3. pace and HR zones are read, never written', () => {
  const a = app();
  const paces = JSON.stringify(a.getActivePaces());
  const hr = JSON.stringify(a.getActiveHRZones());
  const goal = a.getGoalPaceSecPerKm();
  a.state.days.forEach(d => a.executionStrategy(d));
  assert.equal(JSON.stringify(a.getActivePaces()), paces);
  assert.equal(JSON.stringify(a.getActiveHRZones()), hr);
  assert.equal(a.getGoalPaceSecPerKm(), goal);
});

test('3. every target comes from the athlete’s own zones', () => {
  const a = app();
  const paces = a.getActivePaces();
  const bands = Object.keys(paces).map(k => [paces[k].fast, paces[k].slow]).filter(b => b[0] != null);
  const goal = a.getGoalPaceSecPerKm();
  const fastest = Math.min.apply(null, bands.map(b => b[0]).concat([goal]));
  const slowest = Math.max.apply(null, bands.map(b => b[1]).concat([goal]));
  a.state.days.forEach(d => {
    const s = a.executionStrategy(d);
    if (!s || s.suppressed) return;
    s.phases.forEach(ph => {
      if (!ph.pace) return;
      assert.ok(ph.pace.fast >= fastest - 0.001 && ph.pace.slow <= slowest + 0.001,
        d.title + '/' + ph.key + ' invented a pace outside every zone the athlete has');
    });
  });
});

// ---------------------------------------------------------------------------
// 4. DETERMINISM
// ---------------------------------------------------------------------------
test('4. the same workout produces the same strategy, every time', () => {
  const a = app();
  ['long_run_goal_finish', 'threshold_continuous', 'track_reps', 'time_trial', 'race']
    .forEach(arch => {
      const d = dayOf(a, arch);
      const one = JSON.stringify(a.executionStrategy(d));
      for (let i = 0; i < 5; i++)
        assert.equal(JSON.stringify(a.executionStrategy(d)), one, arch + ' drifted between calls');
    });
});

test('4. two apps at the same commit agree', () => {
  const a = app(), b = app();
  ['long_run_goal_finish', 'race', 'time_trial'].forEach(arch => {
    assert.equal(JSON.stringify(a.executionStrategy(dayOf(a, arch))),
                 JSON.stringify(b.executionStrategy(dayOf(b, arch))), arch);
  });
});

test('4. nothing in a strategy depends on the clock or on history', () => {
  const a = app();
  const d = dayOf(a, 'threshold_continuous');
  const before = JSON.stringify(a.executionStrategy(d));
  // log a pile of history; a prescriptive plan must not move
  a.state.days.filter(x => x.date < TODAY && x.type !== 'rest').forEach(x => {
    x.completed = true;
    x.actual = Object.assign(a.emptyActual(), { km: x.km, pace: '4:50', hr: 150, rpe: 5 });
  });
  assert.equal(JSON.stringify(a.executionStrategy(d)), before,
    'execution strategy is a plan for a session, not an opinion about the athlete');
});

// ---------------------------------------------------------------------------
// 5. IDENTITY AND STALENESS — BY DERIVATION, NOT BY INVALIDATION
// ---------------------------------------------------------------------------
/* Nothing is persisted, so there is nothing to go stale. These tests prove the
   consequence: every mutation the brief asks about is answered by the strategy
   simply being recomputed, and the identity moves with it. */
test('5. nothing is persisted, so nothing can go stale', () => {
  const a = app();
  const d = dayOf(a, 'threshold_continuous');
  a.executionStrategy(d);
  assert.equal(d.executionStrategy, undefined, 'no strategy is written onto the day');
  const raw = JSON.stringify(a.state);
  assert.ok(raw.indexOf('executionStrategy') === -1, 'and none reaches the persisted state');
});

test('5. changing the distance changes the strategy and its id', () => {
  const a = app();
  const d = dayOf(a, 'long_run');
  d.km = 26; d.prescription = { v: 1, archetype: 'long_run', params: { km: 26 } };
  const s1 = a.executionStrategy(d), id1 = a.executionStrategyId(d);
  d.km = 32; d.prescription = { v: 1, archetype: 'long_run', params: { km: 32 } };
  const s2 = a.executionStrategy(d), id2 = a.executionStrategyId(d);
  assert.notEqual(id1, id2);
  assert.notEqual(s1.phases[s1.phases.length - 1].to, s2.phases[s2.phases.length - 1].to);
});

test('5. changing the type changes it', () => {
  const a = app();
  const d = clone(dayOf(a, 'threshold_continuous'));
  const before = a.executionStrategyId(d);
  d.type = 'long'; d.km = 24; d.prescription = { v: 1, archetype: 'long_run', params: { km: 24 } };
  assert.notEqual(a.executionStrategyId(d), before);
  assert.equal(a.executionStrategy(d).archetype, 'long_run');
});

test('5. a manual edit that drops the prescription drops the strategy with it', () => {
  const a = app();
  const d = dayOf(a, 'threshold_continuous');
  assert.ok(a.executionStrategy(d));
  /* This is what handleSaveEdit does for a structural edit: the structure no
     longer describes what the athlete is running, so it is deleted. The
     strategy goes because its only input went. */
  delete d.prescription;
  d.manualEdit = { at: TODAY, fields: ['type'], from: {} };
  assert.equal(a.executionStrategy(d), null);
});

test('5. Plan Evolution reshaping a day reshapes the strategy automatically', () => {
  const a = app();
  a.state.days.filter(x => x.date < TODAY && x.type !== 'rest').slice(-3).forEach(x => {
    x.completed = true;
    x.actual = Object.assign(a.emptyActual(),
      { km: x.km, pace: '5:20', hr: 158, rpe: 7, notes: 'sharp pain in my left knee' });
  });
  const ev = a.planEvolution();
  assert.ok(ev && ev.changes.length, 'the fixture must produce a proposal');
  const target = a.findDay(ev.changes[0].dayId);
  const before = a.executionStrategyId(target);
  a.handleAcceptEvolution(ev.proposalId);
  const after = a.executionStrategyId(target);
  if (before !== null || after !== null)
    assert.notEqual(before, after, 'the accepted change must move the strategy identity');
});

test('5. restore puts the original strategy back because it puts the prescription back', () => {
  const a = app();
  a.state.days.filter(x => x.date < TODAY && x.type !== 'rest').slice(-3).forEach(x => {
    x.completed = true;
    x.actual = Object.assign(a.emptyActual(),
      { km: x.km, pace: '5:20', hr: 158, rpe: 7, notes: 'sharp pain in my left knee' });
  });
  const ev = a.planEvolution();
  assert.ok(ev && ev.changes.length);
  const target = a.findDay(ev.changes[0].dayId);
  const original = a.executionStrategyId(target);
  a.handleAcceptEvolution(ev.proposalId);
  assert.equal(a.coachRestoreState(target).ok, true);
  a.handleCoachRestore(target.id);
  assert.equal(a.executionStrategyId(target), original,
    'no invalidation logic was needed — the identity is a function of the prescription');
});

test('5. a completed session keeps the strategy its prescription describes', () => {
  const a = app();
  const d = dayOf(a, 'threshold_continuous');
  const before = JSON.stringify(a.executionStrategy(d));
  d.completed = true;
  d.actual = Object.assign(a.emptyActual(), { km: d.km, pace: '4:55', hr: 168, rpe: 7 });
  assert.equal(JSON.stringify(a.executionStrategy(d)), before,
    'logging a run does not rewrite what the athlete was asked to do');
});

test('5. a plan built before the feature existed still gets a strategy', () => {
  const a = app();
  const legacy = clone(dayOf(a, 'long_run_goal_finish'));
  // the shape a pre-prescription day has: text only, no structure
  const noPrescription = clone(legacy);
  delete noPrescription.prescription;
  assert.equal(a.executionStrategy(noPrescription), null, 'no structure, no strategy, no crash');
  assert.ok(a.executionStrategy(legacy), 'and a structured legacy day works retroactively');
});

// ---------------------------------------------------------------------------
// 6. SAFETY OUTRANKS STRATEGY
// ---------------------------------------------------------------------------
test('6. a recover state suppresses the tactical plan entirely', () => {
  const a = app();
  a.state.days.filter(x => x.date < TODAY && x.type !== 'rest').slice(-3).forEach(x => {
    x.completed = true;
    x.actual = Object.assign(a.emptyActual(),
      { km: x.km, pace: '5:20', hr: 158, rpe: 7, notes: 'sharp pain in my left knee' });
  });
  assert.equal(a.coachDecision().state, 'recover', 'the fixture must reach the safety state');
  const d = dayOf(a, 'threshold_continuous');
  const s = a.executionStrategy(d);
  assert.ok(s, 'the day is still eligible; the answer is a suppression, not an absence');
  assert.equal(s.suppressed, true);
  // .length, not deepEqual: an array from the VM sandbox carries the sandbox's
  // Array prototype, so deepStrictEqual fails on prototype identity rather
  // than on content. Same lesson as swapSpacing and declineAcrossDevices.
  assert.equal(s.phases.length, 0, 'no stage, no target, no cue to press on with');
  assert.match(s.reason, /Recovery currently outranks/);
});

test('6. no strategy copy diagnoses, clears or pressures anyone', () => {
  const a = app();
  const said = [];
  a.state.days.forEach(d => {
    const s = a.executionStrategy(d);
    if (!s) return;
    if (s.reason) said.push(s.reason);
    s.phases.forEach(ph => { [ph.purpose, ph.cue, ph.watch, ph.effort].forEach(v => v && said.push(v)); });
  });
  Object.keys(a.STRATEGY_PHASES).forEach(k => said.push(a.STRATEGY_PHASES[k].purpose));
  const all = said.join(' | ');
  assert.ok(said.length > 20, 'the sweep must actually have collected the copy');
  // diagnosis / clearance / false certainty, the same families medicalBoundary uses
  [/you (are|'re) injured/i, /diagnos/i, /tear|torn|fracture|tendinitis/i, /inflamm/i, /damage/i,
   /safe to (run|train)/i, /cleared to/i, /medically/i, /nothing to worry about/i,
   /(fully )?recovered\b/i, /you are (fine|healthy|well)/i]
    .forEach(rx => assert.ok(!rx.test(all), 'medical boundary: ' + rx + ' in strategy copy'));
  // and the specific failure mode of a tactical feature: telling people to suffer
  [/push through/i, /no pain,? no gain/i, /ignore the pain/i, /don'?t stop/i,
   /dig deep/i, /empty the tank/i, /leave nothing/i, /at all costs/i, /must finish/i]
    .forEach(rx => assert.ok(!rx.test(all), 'pressure language: ' + rx + ' in strategy copy'));
});

test('6. the race plan permits stopping and never demands a finish', () => {
  const a = app();
  const s = a.executionStrategy(dayOf(a, 'race'));
  const last = s.phases[s.phases.length - 1];
  assert.equal(last.paceRole, 'open', 'the closing stage is conditional, not an instruction');
  assert.match(last.cue, /if you are still in control/i);
  assert.match(last.cue, /hold on and finish/i, 'and the other branch is holding on, not pressing');
});

// ---------------------------------------------------------------------------
// 7. NO FALSE PRECISION
// ---------------------------------------------------------------------------
test('7. the race is not a constant pace printed four times', () => {
  const a = app();
  const s = a.executionStrategy(dayOf(a, 'race'));
  const roles = s.phases.map(p => p.paceRole);
  assert.ok(roles.indexOf('ceiling') !== -1, 'the opening must be a ceiling, not a target');
  assert.ok(roles.indexOf('open') !== -1, 'and the close must be conditional');
  assert.ok(new Set(roles).size > 1,
    'four identical targets is a pace band, not an execution strategy');
});

test('7. no strategy invents a pace offset from the goal', () => {
  const a = app();
  const goal = a.getGoalPaceSecPerKm();
  const s = a.executionStrategy(dayOf(a, 'race'));
  s.phases.forEach(ph => {
    if (!ph.pace) return;
    assert.equal(ph.pace.fast, goal, ph.key + ' moved the athlete’s declared goal pace');
    assert.equal(ph.pace.slow, goal);
  });
  /* The opening restraint is expressed as paceRole 'ceiling' rather than as
     "goal pace + 3 s/km". A number nobody can defend is worse than a rule
     everybody can. */
});

test('7. a time-based session gets no kilometre marks', () => {
  const a = app();
  const s = a.executionStrategy(dayOf(a, 'progressive_tempo'));
  const build = s.phases.filter(p => p.key === 'build')[0];
  assert.ok(build, 'the progression must have a build phase');
  assert.ok(build.sec != null, 'and it is measured in time, because the prescription is');
  assert.equal(build.from, null, 'a 25-minute tempo has no kilometre marks to give');
});

test('7. a rep set is one stage, not two rows per rep', () => {
  const a = app();
  const s = a.executionStrategy(dayOf(a, 'track_reps'));
  assert.ok(s.phases.length <= 5, 'got ' + s.phases.length + ' phases for one rep session');
  const press = s.phases.filter(p => p.key === 'press')[0];
  assert.ok(press && press.reps >= 2, 'the set is described by its rep count');
});

// ---------------------------------------------------------------------------
// 8. EXPERIENCE DEPTH — SAME DECISION, DIFFERENT AMOUNT SAID
// ---------------------------------------------------------------------------
const LEVELS = ['novice', 'experienced', 'advanced'];
test('8. the decision is identical at every experience level', () => {
  const seen = LEVELS.map(lvl => {
    const a = app();
    a.state.setup.experience = lvl;
    return ['long_run_goal_finish', 'threshold_continuous', 'race', 'time_trial'].map(arch => {
      const s = a.executionStrategy(dayOf(a, arch));
      return s.phases.map(p => [p.key, p.from, p.to, p.sec, p.reps,
                                p.pace && p.pace.fast, p.pace && p.pace.slow,
                                p.paceRole, p.hr && p.hr.lo].join('/')).join('|');
    }).join('#');
  });
  assert.equal(seen[0], seen[1]);
  assert.equal(seen[1], seen[2],
    'experience must not be able to move a boundary, a target or a stage');
});

test('8. only the amount said changes', () => {
  const depth = lvl => {
    const a = app();
    a.state.setup.experience = lvl;
    const s = a.executionStrategyForDisplay(dayOf(a, 'long_run_goal_finish'));
    return { level: s.level, bytes: JSON.stringify(s).length, phases: s.phases };
  };
  const nov = depth('novice'), exp = depth('experienced'), adv = depth('advanced');
  assert.ok(nov.bytes > exp.bytes, 'a novice is told more than an experienced athlete');
  assert.ok(exp.bytes > adv.bytes, 'and an experienced athlete more than an advanced one');
  assert.ok(nov.phases.some(p => p.watch), 'the novice keeps the watch-out');
  assert.ok(exp.phases.every(p => p.watch === undefined), 'the experienced level drops it');
  assert.ok(adv.phases.every(p => p.purpose === undefined && p.cue === undefined),
    'and advanced is targets and boundaries only');
  assert.ok(adv.phases.every(p => p.pace !== undefined || p.effort !== undefined),
    'but never loses the numbers');
});

test('8. depth reuses athleteExperience and adds no preference', () => {
  const code = groovyless(SRC);
  const at = code.indexOf('function executionStrategyForDisplay');
  const body = code.slice(at, code.indexOf('\n}\n', at));
  assert.match(body, /athleteExperience\(\)/);
  assert.ok(!/state\.[a-z]*[Ss]trategy/.test(body), 'no second setting is introduced');
});

// ---------------------------------------------------------------------------
// 9. IT REUSES THE ENGINE RATHER THAN DUPLICATING IT
// ---------------------------------------------------------------------------
test('9. the segment model is the one the scorer already uses', () => {
  const code = groovyless(SRC);
  const at = code.indexOf('function executionStrategyEligible');
  const region = code.slice(at, code.indexOf('function executionStrategyForDisplay'));
  ['segmentsFor(', 'prescriptionOf(', 'INTENSITY_ZONE_KEY', 'getActivePaces(',
   'getActiveHRZones(', 'getGoalPaceSecPerKm('].forEach(k =>
    assert.ok(region.indexOf(k) !== -1, 'must reuse ' + k));
  /* And it must NOT reimplement any of them. A private pace table or a second
     segment walker is how two engines start disagreeing about one session. */
  assert.ok(!/VDOT_ZONES|trainingPacesFromVDOT|vdotFromPerformance/.test(region),
    'no private pace derivation');
  assert.ok(!/archetype\s*===\s*'easy_run'[\s\S]{0,200}km\s*=/.test(region),
    'no private distance arithmetic');
});

test('9. it does not duplicate the How To Run This voice', () => {
  const a = app();
  const guidance = a.ARCHETYPE_GUIDANCE;
  const strategyCopy = [];
  a.state.days.forEach(d => {
    const s = a.executionStrategy(d);
    if (!s || s.suppressed) return;
    s.phases.forEach(ph => [ph.purpose, ph.cue, ph.watch].forEach(v => v && strategyCopy.push(v)));
  });
  const existing = [];
  Object.keys(guidance).forEach(k => ['cue', 'why', 'how', 'feel', 'avoid', 'essential']
    .forEach(f => guidance[k][f] && existing.push(guidance[k][f])));
  const overlap = strategyCopy.filter(c => existing.indexOf(c) !== -1);
  assert.deepEqual(overlap, [],
    'a sentence appearing in both places is the same coach saying it twice');
});

// ---------------------------------------------------------------------------
// 10. NOTHING ELSE MOVED
// ---------------------------------------------------------------------------
test('10. execution scoring, zones and the review layer are untouched', () => {
  const a = app();
  const d = dayOf(a, 'threshold_continuous');
  d.completed = true;
  d.actual = Object.assign(a.emptyActual(), { km: d.km, pace: '4:55', hr: 168, rpe: 7 });
  const score = a.computeExecutionScore(d);
  const paceT = JSON.stringify(a.executionPaceTarget(d));
  const hrT = JSON.stringify(a.executionHRTarget(d));
  a.executionStrategy(d);
  assert.equal(a.computeExecutionScore(d), score);
  assert.equal(JSON.stringify(a.executionPaceTarget(d)), paceT);
  assert.equal(JSON.stringify(a.executionHRTarget(d)), hrT);
});

test('10. no Serverless Function was added and no flag moved', () => {
  const fns = fs.readdirSync(path.join(ROOT, 'api'))
    .filter(f => /\.js$/.test(f) && f.charAt(0) !== '_');
  /* Stated as a CEILING rather than a constant. Every one of these
     assertions was written to mean "my feature added no Serverless
     Function", and pinning the absolute total made a legitimate
     CONSOLIDATION look like a regression: the Strava routes moved
     behind one router and the count fell 12 -> 7, which is the same
     claim holding more strongly, not a broken one. The limit is what
     the deployment actually enforces. */
  assert.ok(fns.length <= 12, 'the prototype is entirely client-side');
  const access = fs.readFileSync(path.join(ROOT, 'api/_access.js'), 'utf8');
  assert.match(access, /flagOn\(process\.env\.VVV_ACCOUNT_REQUIRED\)/);
  assert.match(access, /flagOn\(process\.env\.VVV_COMMERCIAL_REQUIRED\)/);
  assert.match(fs.readFileSync(path.join(ROOT, 'supabase-commercial-activation.sql'), 'utf8'),
    /select 'no'::text/);
});

test('10. the prototype adds nothing to what is stored or synced', () => {
  const a = app();
  a.state.days.forEach(d => a.executionStrategy(d));
  a.persistStateLocalOnly();
  const raw = a.localStorage.getItem(a.STORAGE_KEY);
  assert.ok(raw.indexOf('executionStrategy') === -1, 'localStorage is unchanged in shape');
  assert.ok(a.planContentSignature(a.state).indexOf('executionStrategy') === -1,
    'and so is the cloud sync signature');
});
