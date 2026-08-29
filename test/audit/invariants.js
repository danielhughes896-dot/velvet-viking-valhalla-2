'use strict';
/* WHAT COUNTS AS A FAULT — separated from how a plan is measured.
 * ===========================================================================
 * Two tiers, kept apart on purpose:
 *
 *   HARD      arithmetic or structural facts that are wrong on any reading:
 *             a negative distance, a component that does not reconcile with
 *             its session, a prescription an athlete cannot perform. These
 *             need no coaching judgement and no methodology decision.
 *
 *   SUSPECT   mathematically valid, coaching-suspicious. A 3km "long run" is
 *             not a broken calculation; it is a defensible calculation that
 *             produces an indefensible session. These are REPORTED and never
 *             asserted, because deciding what to do about them is a
 *             methodology decision that belongs to the founder.
 *
 * Every check returns a list of findings; nothing here throws or fixes.
 */

const HARD = 'hard', SUSPECT = 'suspect';

function num(x){ return typeof x === 'number' && isFinite(x); }

/* Segments carry km, m, sec or nothing at all -- "Easy warm-up jog" is
   deliberately unquantified (see segmentsFor). Only a segment that states a
   km can be arithmetically wrong about one. */
function segKm(s){ return s && s.km != null ? s.km : null; }

function checkCase(c){
  const out = [];
  const add = (tier, code, detail) => out.push({ tier, code, case: c.id, ...detail });

  if (c.error){ add(HARD, 'generator_threw', { message: c.error }); return out; }

  const inputs = c.inputs;

  c.sessions.forEach(s => {
    // ---- arithmetic sanity, on every number the athlete can see ----
    if (s.km != null && !num(s.km)) add(HARD, 'session_km_not_finite', { week: s.week, date: s.date, type: s.type, km: s.km });
    if (num(s.km) && s.km < 0)      add(HARD, 'session_km_negative',   { week: s.week, date: s.date, type: s.type, km: s.km });
    if (s.segErr)                   add(HARD, 'segments_threw',        { week: s.week, date: s.date, archetype: s.archetype, message: s.segErr });

    if (s.segments){
      s.segments.forEach((g, i) => {
        const k = segKm(g);
        if (k != null && !num(k)) add(HARD, 'segment_km_not_finite', { week: s.week, date: s.date, archetype: s.archetype, index: i, km: k });
        if (num(k) && k < 0)      add(HARD, 'segment_km_negative',   { week: s.week, date: s.date, archetype: s.archetype, index: i, km: k, intensity: g.intensity, sessionKm: s.km });
        /* A WORK segment of exactly zero is a component the athlete is asked
           to perform and cannot: it is printed, it is part of the described
           session, and it has no size. A recovery segment of zero would be a
           different question and does not occur. */
        if (g.kind === 'work' && k === 0)
          add(HARD, 'zero_km_work_segment', { week: s.week, date: s.date, archetype: s.archetype, index: i, intensity: g.intensity, sessionKm: s.km });
      });

      /* RECONCILIATION, only where every segment states a distance. A session
         whose flanks are qualitative cannot be summed and is not asked to be.
         Tolerance is one rounding step at each end. */
      const all = s.segments.length > 0 && s.segments.every(g => segKm(g) != null);
      if (all && num(s.km)){
        const total = Math.round(s.segments.reduce((t, g) => t + g.km, 0) * 10) / 10;
        if (Math.abs(total - s.km) > 0.15)
          add(HARD, 'segments_do_not_reconcile', { week: s.week, date: s.date, archetype: s.archetype, sessionKm: s.km, segmentTotal: total, diff: Math.round((total - s.km) * 10) / 10 });
      }
    }

    /* A LONG RUN THAT IS NOT ONE. Reported, not asserted: the threshold below
       is an observation about what the session contains, not a new rule. */
    if (s.type === 'long' && num(s.km) && s.km <= 0)
      add(HARD, 'long_run_zero_distance', { week: s.week, date: s.date, km: s.km });
  });

  c.weeks.forEach(w => {
    const longS = w.sessions.filter(s => s.type === 'long');
    const easyS = w.sessions.filter(s => s.type === 'easy' && s.km > 0);
    const maxEasy = easyS.length ? Math.max(...easyS.map(s => s.km)) : 0;
    const qual = w.sessions.filter(s => s.km > 0 && ['tempo','threshold','interval','repetition','checkpoint'].indexOf(s.type) !== -1);
    const maxQual = qual.length ? Math.max(...qual.map(s => s.km)) : 0;
    const longKm = longS.length ? Math.max(...longS.map(s => s.km)) : 0;

    if (!w.isRace){
      // ---- the long run against the week it sits in ----
      if (longS.length && longKm > 0 && longKm < maxEasy)
        add(SUSPECT, 'long_run_shorter_than_easy_run', { week: w.week, phase: w.phase, longKm, maxEasyKm: maxEasy });
      if (longS.length && longKm > 0 && longKm < maxQual)
        add(SUSPECT, 'long_run_shorter_than_quality', { week: w.week, phase: w.phase, longKm, maxQualityKm: maxQual });
      if (longS.length && longKm > 0 && longKm < 5 && ['half','full','ultra'].indexOf(inputs.distanceKey) !== -1)
        add(SUSPECT, 'long_run_implausible_for_distance', { week: w.week, phase: w.phase, longKm, raceKm: c.profile.raceKm });

      // ---- the goal-pace finish against the run it finishes ----
      longS.forEach(s => {
        if (s.archetype === 'long_run_goal_finish' && s.params){
          const f = s.params.finishKm, k = s.params.km;
          if (num(f) && num(k)){
            if (f >= k)  add(HARD,    'goal_segment_consumes_whole_long_run', { week: w.week, longKm: k, finishKm: f, easyRemainder: Math.round((k - f) * 10) / 10 });
            else if (f > k * 0.5) add(SUSPECT, 'goal_segment_over_half_of_long_run', { week: w.week, longKm: k, finishKm: f, fraction: Math.round(f / k * 100) / 100 });
          }
        }
      });

      // ---- the week against the target it was built to ----
      if (w.targetVolume > 0){
        const ratio = w.actualVolume / w.targetVolume;
        if (ratio > 1.35) add(HARD, 'week_overshoots_target', { week: w.week, phase: w.phase, target: w.targetVolume, actual: w.actualVolume, ratio: Math.round(ratio * 100) / 100 });
        else if (ratio < 0.75) add(HARD, 'week_undershoots_target', { week: w.week, phase: w.phase, target: w.targetVolume, actual: w.actualVolume, ratio: Math.round(ratio * 100) / 100 });
      }

      if (w.qualityFraction != null && w.qualityFraction > 0.40)
        add(SUSPECT, 'quality_dominates_week', { week: w.week, phase: w.phase, qualityFraction: w.qualityFraction, qualityKm: w.qualityKm, actual: w.actualVolume });
    }

    /* ---- progression, week to week ----
       RETURNING TO TREND AFTER A CUTBACK IS NOT A JUMP. A cutback week is
       deliberately 78% of trend, so the week after it necessarily grows by
       about 28% and doing so is the design, not a progression fault. Only
       growth measured against a week that was itself on trend counts. */
    const prevW = c.weeks[c.weeks.indexOf(w) - 1];
    if (w.volumeGrowth != null && w.volumeGrowth > 1.10 && !w.isRace &&
        !(prevW && prevW.isCutback))
      add(SUSPECT, 'week_over_week_growth_over_10pct', { week: w.week, phase: w.phase, growth: w.volumeGrowth, from: Math.round((w.actualVolume / w.volumeGrowth) * 10) / 10, to: w.actualVolume });
    if (w.isTaper && w.volumeDelta != null && w.volumeDelta > 0.5)
      add(HARD, 'taper_week_increases_volume', { week: w.week, delta: w.volumeDelta, actual: w.actualVolume });
  });

  /* THE VOLUME ACCOUNTING (S0 onward). Every kilometre of the difference
     between what a week was asked for and what it was given must be
     attributable to a named cause. An unattributed difference is a generation
     failure -- not a tolerated one, and not one with a threshold. */
  c.weeks.forEach(w => {
    const acc = w.accounting;
    if (!acc){ add(HARD, 'week_has_no_volume_accounting', { week: w.week }); return; }
    if (!acc.reconciled)
      add(HARD, 'volume_unattributed', { week: w.week, residual: acc.roundingResidual,
        bound: acc.roundingBound, target: acc.revisedTarget, prescribed: acc.prescribedTotal });
    if (acc.allocatorRevision > 0 && !(acc.causes || []).some(x => x.indexOf('allocator') === 0))
      add(HARD, 'allocator_revision_undeclared', { week: w.week, km: acc.allocatorRevision });
    if (acc.deliberateReduction > 0 && !acc.reductionCause)
      add(HARD, 'deliberate_reduction_unnamed', { week: w.week, km: acc.deliberateReduction });
    if (acc.floorExcess > 0 && !(acc.floorCauses || []).length)
      add(HARD, 'floor_excess_unnamed', { week: w.week, km: acc.floorExcess });
  });

  /* THE ATHLETE'S OWN STARTING POINT. The first week of a first block is the
     one week whose size the athlete stated themselves. */
  const w1 = c.weeks[0];
  if (w1 && !w1.isRace && inputs.volume > 0){
    const jump = w1.actualVolume / inputs.volume;
    if (jump > 1.30) add(HARD, 'week_one_exceeds_stated_volume', { stated: inputs.volume, weekOne: w1.actualVolume, ratio: Math.round(jump * 100) / 100 });
  }

  return out;
}

module.exports = { checkCase, HARD, SUSPECT };
