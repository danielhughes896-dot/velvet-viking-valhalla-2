'use strict';
/* HQ — AEROBIC BASE PROGRAMME METHODOLOGY IMPLEMENTATION ATTACK.
 * ===========================================================================
 * The read-only audit found Aerobic Base riding Race Goal's legacy
 * machinery unmodified except for two hand-written carve-outs (entry x 1.25,
 * a quality-progression damper) — no capacity-development destination, a
 * long run coupled to whatever distanceKey happened to be configured, an
 * Experience input that was read and then ignored, calendar-driven quality
 * hardening, and no rolling prescription horizon at all (every week
 * materialised at generation time). This file proves the replacement
 * architecture directly: the evidence hierarchy (F-1), the capacity
 * objective, the Base-native long run (F-2), the readiness-gated Build
 * hardening (F-4), Experience as a narrow secondary prior, and the genuine
 * two-week rolling materialisation horizon with its progression-gate
 * redesign (F-6).
 *
 * Every test here is either a direct trace against production functions or
 * a controlled A/B — no mockups, no assumed values not derived from the
 * running code.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

const TODAY = '2026-09-02T09:00:00Z';
function app(){
  const a = loadApp({ pinnedDate: TODAY });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {}; a.showToast = () => {};
  a.state = a.makeDefaultState();
  return a;
}
function seedCompletedDays(a, weeks, perWeekKm, perWeekSessions){
  const t = a.todayStr();
  const monday = a.addDays(t, -a.isoWeekday(t));
  const days = [];
  for (let w = 1; w <= weeks; w++){
    for (let s = 0; s < perWeekSessions; s++){
      const d = a.addDays(monday, -7 * w + s * 2);
      days.push({ id: d, date: d, week: 0, type: 'easy', title: 'Easy', km: perWeekKm / perWeekSessions,
        completed: true, actual: { km: perWeekKm / perWeekSessions, pace: 400, hr: 135, rpe: 3, notes: '' } });
    }
  }
  a.state.days = days;
  return days;
}

/* ==========================================================
   F-1 — THE EVIDENCE HIERARCHY (baseWeeklyVolumeEvidence)
   ========================================================== */
test('F-1: blank typed volume no longer erases real demonstrated evidence', () => {
  const a = app();
  const t = a.todayStr(), m = a.addDays(t, -a.isoWeekday(t));
  const sessions = [];
  for (let w = 1; w <= 8; w++){
    [0, 2, 4].forEach(d => sessions.push({ date: a.addDays(m, -7 * w + d), completed: true,
      actualKm: 8, plannedKm: 8, type: 'easy', actual: { km: 8, rpe: 3, pace: 400, hr: 135 }, feel: 'good' }));
  }
  a.state.athlete = { sessions, blocks: [] };
  const ev = a.baseWeeklyVolumeEvidence(null);
  assert.equal(ev.source, 'demonstrated');
  assert.ok(ev.km > 0, 'a blank field must resolve to real evidence, not null');

  const blk = a.buildBlockWeeks('half', ev.km, 10, { purpose: 'base', availableDays: 4 });
  assert.ok(blk.weeks[0].volume > 10, 'week 1 must not collapse to the old ~3km/week defect: ' + blk.weeks[0].volume);
});

test('F-1: demonstrated evidence outranks a typed figure, not merely fills gaps', () => {
  const a = app();
  const t = a.todayStr(), m = a.addDays(t, -a.isoWeekday(t));
  const sessions = [];
  for (let w = 1; w <= 8; w++){
    [0, 2, 4].forEach(d => sessions.push({ date: a.addDays(m, -7 * w + d), completed: true,
      actualKm: 15, plannedKm: 15, type: 'easy', actual: { km: 15, rpe: 3, pace: 400, hr: 135 }, feel: 'good' }));
  }
  a.state.athlete = { sessions, blocks: [] };
  // strong demonstrated evidence (~45km/wk) present; typed field says a misleading 10
  const evLow = a.baseWeeklyVolumeEvidence(10);
  assert.equal(evLow.source, 'demonstrated', 'strong evidence must not be erased by a misleading low typed figure');
  assert.ok(evLow.km > 30, 'evidence must win outright: ' + evLow.km);
  // and an aggressive high typed figure cannot buy unsupported capacity either
  const evHigh = a.baseWeeklyVolumeEvidence(200);
  assert.equal(evHigh.source, 'demonstrated');
  assert.ok(evHigh.km < 60, 'a high typed figure must not override demonstrated evidence: ' + evHigh.km);
});

test('F-1: typed CWV remains useful fallback/on-ramp evidence when nothing stronger exists', () => {
  const a = app();
  a.state.athlete = { sessions: [], blocks: [] };
  const ev = a.baseWeeklyVolumeEvidence(28);
  assert.equal(ev.source, 'typed');
  assert.equal(ev.km, 28);
});

test('F-1: with genuinely no evidence at all, nothing is invented', () => {
  const a = app();
  a.state.athlete = { sessions: [], blocks: [] };
  const ev = a.baseWeeklyVolumeEvidence(null);
  assert.equal(ev.source, 'unknown');
  assert.equal(ev.km, null);
});

/* ==========================================================
   §3 — THE CAPACITY-DEVELOPMENT OBJECTIVE (baseCapacityObjective)
   Replaces entry x BASE_VOLUME_MULT (1.25).
   ========================================================== */
test('destination: with no demonstrated evidence, growth is the conservative one-step rate, not 1.25x', () => {
  const a = app();
  a.state.athlete = { sessions: [], blocks: [] };
  const blk = a.buildBlockWeeks('half', 40, 10, { purpose: 'base', availableDays: 4 });
  assert.equal(blk.peakVolume, a.round1(40 * a.VOLUME_BLOCK_GROWTH_CAP));
  assert.notEqual(blk.peakVolume, a.round1(40 * 1.25), 'must not silently reproduce the old multiplier');
});

test('destination: with demonstrated evidence and an earned step, the destination is dem x PEAK_OVER_DEMONSTRATED', () => {
  const a = app();
  a.state.athlete = { blocks: [{ id: 'prior', purpose: 'base', status: 'closed',
    anchorVolume: 50, startVolume: 50, peakVolume: 50 }] };
  const sessions = [];
  const t = a.todayStr(), m = a.addDays(t, -a.isoWeekday(t));
  for (let w = 1; w <= 10; w++){
    [0, 2, 4, 5].forEach(d => sessions.push({ date: a.addDays(m, -7 * w + d), completed: true,
      actualKm: 12.5, plannedKm: 12.5, type: 'easy', actual: { km: 12.5, rpe: 3, pace: 400, hr: 135 }, feel: 'good' }));
  }
  a.state.athlete.sessions = sessions;
  const dem = a.demonstratedSustainableVolume();
  assert.ok(dem >= 45, 'fixture must produce real demonstrated evidence');
  assert.equal(a.progressionJustification().earned, true, 'fixture must produce an earned step');
  const blk = a.buildBlockWeeks('half', 45, 10, { purpose: 'base', availableDays: 5 });
  assert.equal(blk.peakVolume, a.round1(Math.min(dem * a.PEAK_OVER_DEMONSTRATED, a.volumeCeilingFor('half'))));
});

test('destination: evidence exists but a step is not earned this cycle — holds, does not shrink or invent', () => {
  const a = app();
  // Two prior base blocks: the second already carried the progression step,
  // so the cycle rule blocks a third step immediately after.
  a.state.athlete = { blocks: [
    { id: 'a', purpose: 'base', status: 'closed', anchorVolume: 40, startVolume: 40, peakVolume: 50 },
    { id: 'b', purpose: 'base', status: 'closed', anchorVolume: 44, startVolume: 44, peakVolume: 55, progressionStep: true }
  ] };
  const sessions = [];
  const t = a.todayStr(), m = a.addDays(t, -a.isoWeekday(t));
  for (let w = 1; w <= 10; w++){
    [0, 2, 4, 5].forEach(d => sessions.push({ date: a.addDays(m, -7 * w + d), completed: true,
      actualKm: 55 / 4, plannedKm: 55 / 4, type: 'easy', actual: { km: 55 / 4, rpe: 3, pace: 400, hr: 135 }, feel: 'good' }));
  }
  a.state.athlete.sessions = sessions;
  const justified = a.progressionJustification();
  assert.equal(justified.blockedBy, 'stepped_this_cycle');
  const blk = a.buildBlockWeeks('half', 44, 10, { purpose: 'base', availableDays: 5 });
  const dem = a.demonstratedSustainableVolume();
  assert.equal(blk.peakVolume, a.round1(Math.min(Math.max(44, dem), a.volumeCeilingFor('half'))));
});

/* ==========================================================
   F-2 — BASE-NATIVE LONG RUN (severed from DISTANCE_PROFILES[distKey])
   ========================================================== */
test('F-2: the long-run destination no longer varies with an arbitrary distanceKey', () => {
  const a = app();
  a.state.athlete = { sessions: [], blocks: [] };
  const targets = ['5k', '10k', 'half', 'full', 'ultra'].map(dk => {
    const blk = a.buildBlockWeeks(dk, 40, 10, { purpose: 'base', availableDays: 4 });
    return blk.weeks.map(w => w.longTarget).join(',');
  });
  targets.slice(1).forEach(t => assert.equal(t, targets[0],
    'Base long-run targets must be distKey-invariant: ' + targets.join(' | ')));
});

test('F-2: the long-run fraction is pinned to the endurance emphasis regardless of distKey', () => {
  const a = app();
  a.state.athlete = { sessions: [], blocks: [] };
  const blk = a.buildBlockWeeks('5k', 40, 10, { purpose: 'base', availableDays: 4 });
  const wk = blk.weeks.find(w => !w.isCutback);
  assert.ok(Math.abs(wk.longTarget / wk.volume - a.LONG_FRACTION.endurance) < 0.05,
    'expected the long run to track the endurance fraction, got ' + (wk.longTarget / wk.volume));
});

/* ==========================================================
   §5/§8 — FREQUENCY AND EXPERIENCE
   ========================================================== */
function week1PrescribedDays(a, exp, days){
  const activeDaysArr = days === 3 ? [1, 3, 6] : days === 4 ? [1, 3, 4, 6] : days === 5 ? [0, 1, 3, 4, 6] : [0, 1, 2, 3, 4, 6];
  const blk = a.buildBlockWeeks('half', 40, 10, { purpose: 'base', availableDays: days, experience: exp });
  const start = a.todayStr();
  const startMonday = a.addDays(start, -a.isoWeekday(start));
  const goalDate = a.addDays(startMonday, 10 * 7 - 1);
  const schedule = { activeDays: activeDaysArr, longRunDay: 6 };
  const built = a.buildDaysFromWeeks(blk, goalDate, schedule, start, false, {});
  return built.filter(d => d.week === 1 && d.type !== 'rest').length;
}

test('frequency: availability is a ceiling, not an instruction — more days never force more volume', () => {
  const a = app();
  a.state.athlete = { sessions: [], blocks: [] };
  [3, 4, 5, 6].forEach(days => {
    const blk = a.buildBlockWeeks('half', 40, 10, { purpose: 'base', availableDays: days });
    assert.equal(blk.peakVolume, a.round1(40 * a.VOLUME_BLOCK_GROWTH_CAP),
      'destination volume must not change with availability at ' + days + ' days');
  });
});

test('frequency: 3/4/5/6-day controls, same evidence — prescribed days are evidence/feasibility-bound, never uncapped', () => {
  const a = app();
  a.state.athlete = { sessions: [], blocks: [] };
  const counts = [3, 4, 5, 6].map(d => week1PrescribedDays(a, 'experienced', d));
  counts.forEach((c, i) => assert.ok(c <= [3, 4, 5, 6][i], 'prescribed days must never exceed availability: ' + c));
  assert.ok(counts[3] >= counts[0], 'more availability must not produce FEWER prescribed days: ' + counts.join(','));
});

test('Experience: a novice prior only fires with zero frequency evidence, and evidence outranks it', () => {
  const a = app();
  a.state.athlete = { sessions: [], blocks: [] };
  const novice = week1PrescribedDays(a, 'novice', 6);
  const established = week1PrescribedDays(a, 'experienced', 6);
  const advanced = week1PrescribedDays(a, 'advanced', 6);
  assert.equal(novice, established - 1, 'a first-block novice opens one day below the default');
  assert.equal(established, advanced, 'established and advanced must not differ with no evidence — no fixed pathway table');
});

test('Experience: cannot override real frequency evidence (Developing+strong vs Advanced+weak)', () => {
  const withEvidence = (exp) => {
    const a = app();
    const t = a.todayStr();
    const days = [];
    for (let i = 1; i <= 30; i++){
      const d = a.addDays(t, -i);
      days.push({ id: d, date: d, week: 0, type: 'easy', title: 'Easy', km: 10, completed: true,
        actual: { km: 10, pace: 400, hr: 135, rpe: 3, notes: '' } });
    }
    a.state.days = days;
    a.state.athlete = { sessions: [], blocks: [] };
    return week1PrescribedDays(a, exp, 6);
  };
  const developingStrong = withEvidence('novice');
  const advancedStrong = withEvidence('advanced');
  assert.equal(developingStrong, advancedStrong,
    'once real frequency evidence exists, Experience must not move the answer');
});

/* ==========================================================
   F-4 — BUILD-PHASE INTENSITY IS EARNED BY READINESS, NOT WEEK NUMBER
   ========================================================== */
/* BASE CARRIES ONE QUALITY SLOT PER WEEK (soloKind alternates
   interval/tempo on week parity), so the session actually written to
   state.days comes from the "single-exposure cadence" path
   (buildBlockWeeks()'s soloSpec/soloKind), not the two-slot qSpec/tSpec
   bookkeeping values a dual-slot block (a marathon) would use. The first
   version of this test read wk.tSpec directly and passed while the actual
   materialised session still hardened on calendar position alone, because
   the readiness gate had only been wired into the two-slot path -- reading
   soloSpec (what buildDaysFromWeeks() actually consumes for a one-slot
   week, confirmed directly against its materialised output during
   development) is what catches that. soloSpec.type/soloSpec.archetype is
   used directly rather than round-tripping through buildDaysFromWeeks(),
   because the day-level affordability ladder (session-cost/day-count
   trimming, unrelated to this gate) can independently substitute a
   session for unrelated cost reasons and would confound a materialised-
   output comparison with a second, unrelated mechanism. */
function buildWeekSoloSpec(persistent){
  const a = app();
  if (persistent){
    const t = a.todayStr();
    const days = [];
    for (let i = 1; i <= 12; i++){
      const d = a.addDays(t, -i);
      const ran = (i % 5 === 0);
      days.push({ id: d, date: d, week: 0, type: 'easy', title: 'Easy', km: 8, completed: ran,
        actual: ran ? { km: 8, pace: 400, hr: 135, rpe: 3, notes: '' } : { km: null, pace: null, hr: null, rpe: null, notes: '' } });
    }
    a.state.days = days;
  } else {
    a.state.days = [];
  }
  a.state.athlete = { sessions: [], blocks: [] };
  const blk = a.buildBlockWeeks('half', 40, 10, { purpose: 'base', availableDays: 4 });
  const buildWeek = blk.weeks.find(w => w.phase === 'Build');
  return buildWeek.soloSpec.type;
}

/* TEMPO_STRUCTURE_POOL.Base = [structSteadyTempo, structThresholdContinuous]
   (own `.type` fields 'steady'/'threshold'); .Build = [structProgressiveTempo,
   structSplitTempo] (own `.type` fields 'progressive'/'tempo' -- confirmed
   directly against the structure functions, not assumed from the name).
   pickQualityStructure() rotates between a pool's members by occurrence, so
   the test has to check POOL MEMBERSHIP, not one specific rotation member. */
const BASE_TEMPO_TYPES = ['steady', 'threshold'];
const BUILD_TEMPO_TYPES = ['progressive', 'tempo'];

test('F-4: two athletes at the same Build week with different readiness draw from a different family pool', () => {
  const onTrack = buildWeekSoloSpec(false);
  const persistentMiss = buildWeekSoloSpec(true);
  assert.ok(BASE_TEMPO_TYPES.indexOf(persistentMiss) !== -1,
    'a persistent miss pattern must hold the gentler Base tempo pool, got ' + persistentMiss);
  assert.ok(BUILD_TEMPO_TYPES.indexOf(onTrack) !== -1,
    'on-track readiness must reach the calendar-driven Build tempo pool, got ' + onTrack);
});

test('F-4: a genuinely first block (no pattern to read at all) still reaches the calendar-driven transition', () => {
  const type = buildWeekSoloSpec(false);
  assert.ok(BUILD_TEMPO_TYPES.indexOf(type) !== -1,
    'withholding hardening is a readiness WITHDRAWAL, not a promotion that must be separately earned, got ' + type);
});

test('F-4: the readiness gate is proven end-to-end against the real materialised session (single case)', () => {
  /* One deterministic, isolated end-to-end check -- confirms soloSpec is
     genuinely what buildDaysFromWeeks() writes for a persistent-miss
     athlete, without the two-fixture-in-one-process comparison above. */
  const a = app();
  const t = a.todayStr();
  const days = [];
  for (let i = 1; i <= 12; i++){
    const d = a.addDays(t, -i);
    const ran = (i % 5 === 0);
    days.push({ id: d, date: d, week: 0, type: 'easy', title: 'Easy', km: 8, completed: ran,
      actual: ran ? { km: 8, pace: 400, hr: 135, rpe: 3, notes: '' } : { km: null, pace: null, hr: null, rpe: null, notes: '' } });
  }
  a.state.days = days;
  a.state.athlete = { sessions: [], blocks: [] };
  const blk = a.buildBlockWeeks('half', 40, 10, { purpose: 'base', availableDays: 4 });
  const buildWeek = blk.weeks.find(w => w.phase === 'Build');
  assert.ok(BASE_TEMPO_TYPES.indexOf(buildWeek.soloSpec.type) !== -1);
  const start = a.todayStr();
  const startMonday = a.addDays(start, -a.isoWeekday(start));
  const goalDate = a.addDays(startMonday, 10 * 7 - 1);
  const schedule = { activeDays: [1, 3, 4, 6], longRunDay: 6 };
  const built = a.buildDaysFromWeeks(blk, goalDate, schedule, start, false, { horizonThroughWeek: buildWeek.week });
  /* threshold_continuous carries day type 'threshold', not 'tempo' -- its
     TYPE_META family is 'threshold' while every other tempo structure's is
     'tempo' (confirmed directly against TYPE_META), so the day-type filter
     has to include it too or a rotation landing on the threshold structure
     is silently missed here. */
  const session = built.find(d => d.week === buildWeek.week &&
    (d.type === 'tempo' || d.type === 'interval' || d.type === 'threshold'));
  assert.ok(session, 'the build week must still carry a real quality session');
  assert.ok(['steady_tempo', 'threshold_continuous'].indexOf(session.prescription.archetype) !== -1,
    'the materialised session must reflect the gentler, readiness-gated Base tempo pool, got ' +
    session.prescription.archetype);
});

/* ==========================================================
   F-6 / §15 — THE PROGRESSION GATE MUST NOT DEPEND ON FULL MATERIALISATION,
   AND PROJECTED INTENTION MUST NOT MASQUERADE AS ACHIEVED EVIDENCE
   ========================================================== */
test('F-6: a block records its intended peak immediately, before any week is materialised', () => {
  const a = app();
  a.state.athlete = { sessions: [], blocks: [] };
  const blk = a.buildBlockWeeks('half', 40, 10, { purpose: 'base', availableDays: 4 });
  // Zero materialised days -- the rolling-horizon case.
  const peak = a.blockPeakVolumeFor('base', blk, []);
  assert.equal(peak, blk.peakVolume, 'the recorded peak must be the intended figure, not null or zero');
});

test('F-6: once a block is fully materialised, the real scheduled figure is used, not the raw arithmetic ramp', () => {
  const a = app();
  a.state.athlete = { sessions: [], blocks: [] };
  const blk = a.buildBlockWeeks('half', 40, 10, { purpose: 'base', availableDays: 3 });
  const start = a.todayStr();
  const startMonday = a.addDays(start, -a.isoWeekday(start));
  const goalDate = a.addDays(startMonday, 10 * 7 - 1);
  const schedule = { activeDays: [1, 3, 6], longRunDay: 6 };
  const days = a.buildDaysFromWeeks(blk, goalDate, schedule, start, false, {});
  const peak = a.blockPeakVolumeFor('base', blk, days);
  assert.equal(peak, a.largestScheduledWeek(days),
    'a fully materialised block must use the real schedule-realised figure');
});

test('§15: projected intention cannot masquerade as achieved evidence in the progression gate', () => {
  const a = app();
  // Seed a prior block whose INTENDED peak (via blockPeakVolumeFor, no
  // materialisation) is large, but whose athlete never actually trained
  // anywhere near it -- the achieved-evidence side must still refuse.
  a.state.athlete = { blocks: [{ id: 'prior', purpose: 'base', status: 'closed',
    anchorVolume: 40, startVolume: 40, peakVolume: 90 /* an intended figure, never achieved */ }] };
  const sessions = [];
  const t = a.todayStr(), m = a.addDays(t, -a.isoWeekday(t));
  for (let w = 1; w <= 8; w++){
    [0, 2, 4].forEach(d => sessions.push({ date: a.addDays(m, -7 * w + d), completed: true,
      actualKm: 12, plannedKm: 12, type: 'easy', actual: { km: 12, rpe: 3, pace: 400, hr: 135 }, feel: 'good' }));
  }
  a.state.athlete.sessions = sessions;
  const j = a.progressionJustification();
  assert.equal(j.blockedBy, 'peak_not_reached',
    'a recorded intended peak the athlete never actually trained to must still block progression');
});

/* ==========================================================
   §14/§16/§17 — THE ROLLING TWO-WEEK MATERIALISATION HORIZON
   ========================================================== */
function seedBasePlan(a, N, opts){
  const distanceKey = 'half';
  const blk = a.buildBlockWeeks(distanceKey, 45, N, { purpose: 'base', availableDays: 4 });
  const start = a.todayStr();
  const startMonday = a.addDays(start, -a.isoWeekday(start));
  const goalDate = a.addDays(startMonday, N * 7 - 1);
  const schedule = { activeDays: [1, 3, 4, 6], longRunDay: 6 };
  const days = a.buildDaysFromWeeks(blk, goalDate, schedule, start, false,
    Object.assign({ horizonThroughWeek: 2 }, opts || {}));
  a.state.days = days;
  a.state.setup = { distanceKey, currentVolume: 45, raceDate: goalDate, hasEvent: false, startDate: start,
    planWeeks: N, schedule, blockId: 'b1', purpose: 'base', benchmark: null, goals: [], activeGoal: null,
    paceOverrides: {}, lthr: null, maxHR: null, experience: 'experienced', supportWork: 'off' };
  a.state.blocks = [{ id: 'b1', distanceKey, purpose: 'base', goalDate, startVolume: blk.startVolume,
    peakVolume: a.blockPeakVolumeFor('base', blk, days), anchorVolume: blk.startVolume, outcome: null }];
  a.state.athlete = { sessions: [], blocks: a.state.blocks };
  return { blk, days };
}

test('horizon: at creation, only the current week and the next are materialised', () => {
  const a = app();
  const { days } = seedBasePlan(a, 10);
  const weeks = [...new Set(days.map(d => d.week))].sort((x, y) => x - y);
  assert.deepEqual(weeks, [1, 2]);
});

test('horizon: totalWeeksInPlan reports the whole block, independent of materialisation', () => {
  const a = app();
  seedBasePlan(a, 10);
  assert.equal(a.totalWeeksInPlan(), 10);
});

test('horizon: Full Plan still shows every week of the programme', () => {
  const a = app();
  seedBasePlan(a, 10);
  const html = a.renderWeeksList(false);
  for (let w = 1; w <= 10; w++){
    assert.ok(html.indexOf('id="week-' + w + '"') !== -1, 'week ' + w + ' card missing from Full Plan');
  }
});

test('horizon: a week beyond the horizon renders as genuinely unshaped, not a fake empty week', () => {
  const a = app();
  seedBasePlan(a, 10);
  const html = a.renderWeekAccordion(6, false);
  assert.ok(html.indexOf('week-unshaped') !== -1);
  assert.ok(html.indexOf('Adapts as you train') !== -1);
  assert.ok(html.indexOf('This week will be shaped by your training.') !== -1);
});

test('horizon: no future session exists as a committed prescription beyond the horizon', () => {
  const a = app();
  const { days } = seedBasePlan(a, 10);
  const beyond = days.filter(d => d.week > 2);
  assert.equal(beyond.length, 0, 'no day objects should exist for weeks beyond the materialised horizon');
});

test('horizon advance: crossing into a new week extends materialisation and preserves history', () => {
  const a1 = app();
  const { days: seedDays } = seedBasePlan(a1, 10);
  const wk1 = seedDays.filter(d => d.week === 1 && d.type !== 'rest');
  wk1[0].completed = true;
  wk1[0].actual = { km: wk1[0].km, pace: 400, hr: 140, rpe: 4, notes: '' };
  const setup = a1.state.setup, block = a1.state.blocks[0];

  // Reopen the app three weeks later.
  const a2 = loadApp({ pinnedDate: '2026-09-23T09:00:00Z' });
  a2.renderApp = () => {}; a2.flushSave = () => {}; a2.showToast = () => {};
  a2.scheduleSave = () => {};
  a2.state = a2.makeDefaultState();
  a2.state.days = seedDays; a2.state.setup = setup; a2.state.blocks = [block];
  a2.state.athlete = { sessions: [], blocks: [block] };

  const before = [...new Set(a2.state.days.map(d => d.week))].sort((x, y) => x - y);
  assert.deepEqual(before, [1, 2]);
  const advanced = a2.ensureBaseHorizonMaterialised();
  assert.equal(advanced, true);
  const after = [...new Set(a2.state.days.map(d => d.week))].sort((x, y) => x - y);
  assert.deepEqual(after, [1, 2, 3, 4, 5], 'week 4 is current, so the horizon should now reach week 5');

  const week1Now = a2.state.days.filter(d => d.week === 1);
  const preserved = week1Now.find(d => d.id === wk1[0].id);
  assert.ok(preserved, 'the completed week-1 session must survive the horizon advance');
  assert.equal(preserved.completed, true);
  assert.equal(preserved.actual.km, wk1[0].km);
});

test('horizon advance: an edited future session inside the horizon is not clobbered', () => {
  const a1 = app();
  const { days: seedDays } = seedBasePlan(a1, 10);
  const wk2 = seedDays.filter(d => d.week === 2 && d.type === 'easy')[0];
  wk2.coachAdjust = { reason: 'test edit' };
  wk2.km = 999; // a deliberately distinctive edited value
  const setup = a1.state.setup, block = a1.state.blocks[0];

  const a2 = loadApp({ pinnedDate: '2026-09-16T09:00:00Z' }); // two weeks later, week 3 current
  a2.renderApp = () => {}; a2.flushSave = () => {}; a2.showToast = () => {}; a2.scheduleSave = () => {};
  a2.state = a2.makeDefaultState();
  a2.state.days = seedDays; a2.state.setup = setup; a2.state.blocks = [block];
  a2.state.athlete = { sessions: [], blocks: [block] };
  a2.ensureBaseHorizonMaterialised();
  const stillEdited = a2.state.days.find(d => d.id === wk2.id);
  assert.equal(stillEdited.km, 999, 'an edited session must survive a horizon advance untouched');
});

/* ==========================================================
   §18 — ADAPTATION THROUGH A HORIZON ADVANCE
   ========================================================== */
test('adaptation: two initially identical athletes diverge, and week 8 differs once it enters the horizon', () => {
  function runToWeek8(strongEvidence){
    const a1 = app();
    const { days: seedDays } = seedBasePlan(a1, 12);
    const setup = a1.state.setup, block = a1.state.blocks[0];

    const a2 = loadApp({ pinnedDate: '2026-10-21T09:00:00Z' }); // ~7 weeks later, week 8 entering horizon
    a2.renderApp = () => {}; a2.flushSave = () => {}; a2.showToast = () => {}; a2.scheduleSave = () => {};
    a2.state = a2.makeDefaultState();
    a2.state.days = seedDays; a2.state.setup = setup; a2.state.blocks = [block];
    if (strongEvidence){
      const sessions = [];
      const t = a2.todayStr(), m = a2.addDays(t, -a2.isoWeekday(t));
      for (let w = 1; w <= 8; w++){
        [0, 2, 4, 5].forEach(d => sessions.push({ date: a2.addDays(m, -7 * w + d), completed: true,
          actualKm: 16, plannedKm: 16, type: 'easy', actual: { km: 16, rpe: 3, pace: 400, hr: 135 }, feel: 'good' }));
      }
      a2.state.athlete = { sessions, blocks: [block] };
    } else {
      a2.state.athlete = { sessions: [], blocks: [block] };
    }
    a2.ensureBaseHorizonMaterialised();
    const wk8 = a2.state.days.filter(d => d.week === 8);
    return a2.round1(wk8.reduce((s, d) => s + (d.km || 0), 0));
  }
  const plain = runToWeek8(false);
  const strong = runToWeek8(true);
  assert.notEqual(plain, strong,
    'two initially identical athletes who diverge in training evidence must get a different week 8 ' +
    'once it enters the rolling horizon: plain=' + plain + ' strong=' + strong);
});

/* ==========================================================
   §22 / §23 — PRODUCT ISOLATION
   ========================================================== */
test('isolation: Race Goal marathon construction is unaffected by the Base rewrite', () => {
  const a = app();
  a.state.athlete = { sessions: [], blocks: [] };
  const blk = a.buildBlockWeeks('full', 50, 16, { purpose: 'race', availableDays: 5, experience: 'experienced' });
  assert.ok(blk.peakVolume > 0);
  assert.equal(blk.weeks.some(w => w.phase === 'Peak'), true, 'Race Goal must still reach a Peak phase');
});

test('isolation: Maintain & Protect and Speed & Threshold still fully materialise their whole block', () => {
  const a = app();
  a.state.athlete = { sessions: [], blocks: [] };
  ['maintain', 'speed'].forEach(purpose => {
    const distKey = purpose === 'speed' ? '5k' : 'half';
    const N = purpose === 'speed' ? 6 : 8;
    const blk = a.buildBlockWeeks(distKey, 40, N, { purpose, steady: purpose === 'maintain', availableDays: 4 });
    const start = a.todayStr();
    const startMonday = a.addDays(start, -a.isoWeekday(start));
    const goalDate = a.addDays(startMonday, N * 7 - 1);
    const schedule = { activeDays: [1, 3, 4, 6], longRunDay: 6 };
    const days = a.buildDaysFromWeeks(blk, goalDate, schedule, start, false);
    const weeks = new Set(days.map(d => d.week));
    assert.equal(weeks.size, N, purpose + ' must still fully materialise every week');
  });
});

test('isolation: totalWeeksInPlan/weekDateRange changes do not alter a fully materialised plan\'s answers', () => {
  const a = app();
  a.state.athlete = { sessions: [], blocks: [] };
  const blk = a.buildBlockWeeks('full', 50, 16, { purpose: 'race', availableDays: 5, experience: 'experienced' });
  const start = a.todayStr();
  const startMonday = a.addDays(start, -a.isoWeekday(start));
  const goalDate = a.addDays(startMonday, 16 * 7 - 1);
  const schedule = { activeDays: [0, 1, 3, 4, 6], longRunDay: 6 };
  const days = a.buildDaysFromWeeks(blk, goalDate, schedule, start, false);
  a.state.days = days;
  a.state.setup = { planWeeks: 16, startDate: start };
  assert.equal(a.totalWeeksInPlan(), 16);
  const range = a.weekDateRange(1);
  assert.equal(range.start, days.filter(d => d.week === 1)[0].date);
});
