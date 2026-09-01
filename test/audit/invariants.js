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
 *   DESCRIPTIVE  measured, reported, and never an authority on anything. A
 *             third tier exists because one measure earned its way out of
 *             SUSPECT rather than out of the audit: see below.
 *
 * Every check returns a list of findings; nothing here throws or fixes.
 *
 * ===========================================================================
 * week_over_week_growth_over_10pct IS NOW DESCRIPTIVE, AND IT IS UNCHANGED
 * ===========================================================================
 * It asked one question of every week -- did the total distance rise more than
 * ten per cent -- and answered it identically for +1km on a 6km athlete and
 * +8km on an 80km one. Two facts retired it as a binary authority:
 *
 *   IT CANNOT SEE ABSOLUTE LOAD.  6 -> 7km is +16.7% and one kilometre.
 *                                 80 -> 88km is +10% and eight. The measure
 *                                 flags the first and not the second.
 *   IT MOVED THE WRONG WAY.       The correction that removed the last hidden
 *                                 accounting defect halved the largest
 *                                 absolute jump in the marathon population,
 *                                 emptied the >10km class -- and RAISED this
 *                                 count, because honest weeks are noisier
 *                                 weeks. A measure that worsens when the
 *                                 training improves is not measuring training.
 *
 * It is kept, by name, with its semantics and its rounding untouched, so the
 * historical series stays comparable. What replaces it as the AUTHORITY is
 * test/audit/loadProgression.js, which asks how much changed, how large that
 * is relative to the athlete's own load, WHAT changed, and whether several
 * load levers moved together -- and names a reason for every concern it
 * raises. Its findings enter here as ordinary SUSPECT codes, one per reason,
 * so each family can be held and reduced on its own.
 */

const HARD = 'hard', SUSPECT = 'suspect', DESCRIPTIVE = 'descriptive';
const { assess } = require('./loadProgression.js');

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
    /* MEASUREMENT CORRECTION (S4), reported rather than made silently.
       `easy_strides` carries dd.type 'interval' -- deliberately, because in race
       week it IS the quality slot and the athlete should recognise it as one.
       It is not a structured quality session: it is an easy run with six 100m
       strides inside it, and counting it as quality would report an on-ramp
       week as 20% quality when it contains none. Keyed on the ARCHETYPE, which
       is what actually distinguishes them.

       This moves no existing count. Every place it could have applied before
       S4 is a race week, and every check below is already inside `if
       (!w.isRace)`. Verified against the committed baseline. */
    const qual = w.sessions.filter(s => s.km > 0 && s.archetype !== 'easy_strides' &&
      ['tempo','threshold','interval','repetition','checkpoint'].indexOf(s.type) !== -1);
    const maxQual = qual.length ? Math.max(...qual.map(s => s.km)) : 0;
    const longKm = longS.length ? Math.max(...longS.map(s => s.km)) : 0;

    if (!w.isRace){
      /* ---- the long run against the week it sits in ----
         THE `longKm > 0` GUARDS WERE AN UNDERCOUNT, corrected here. A long run
         of zero distance is trivially shorter than every easy run and every
         quality session in its week; excluding it hid the very weeks that were
         worst. The audit's original numbers for these three codes were
         therefore too low by exactly the count of zero-distance long runs, and
         the baseline is re-measured with the correction rather than left to
         appear as a rise when the zero-distance defect is fixed. */
      if (longS.length && longKm < maxEasy)
        add(SUSPECT, 'long_run_shorter_than_easy_run', { week: w.week, phase: w.phase, longKm, maxEasyKm: maxEasy });
      if (longS.length && longKm < maxQual)
        add(SUSPECT, 'long_run_shorter_than_quality', { week: w.week, phase: w.phase, longKm, maxQualityKm: maxQual });
      if (longS.length && longKm < 5 && ['half','full','ultra'].indexOf(inputs.distanceKey) !== -1)
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

      /* ---- the week against the target it was built to ----
         SILENT AND DECLARED ARE DIFFERENT DEFECTS, and only one of them is a
         defect. The rule is no SILENT loss, not no loss: a week that could not
         be distributed and says so, with a named structural cause, is the
         allocator being honest about a real limit. A week that differs from
         its target with nothing accounting for the difference is the failure.
         Counted separately so a fix cannot be credited for turning one into
         the other without saying so. */
      if (w.targetVolume > 0){
        const acc = w.accounting;
        const ratio = w.actualVolume / w.targetVolume;
        const declaredShort = acc && acc.allocatorRevision > 0;
        const declaredOver = acc && acc.floorExcess > 0;
        const detail = { week: w.week, phase: w.phase, target: w.targetVolume,
                         actual: w.actualVolume, ratio: Math.round(ratio * 100) / 100,
                         allocatorRevision: acc ? acc.allocatorRevision : null,
                         floorExcess: acc ? acc.floorExcess : null };
        if (ratio > 1.35)
          add(HARD, declaredOver ? 'week_overshoots_target_declared' : 'week_overshoots_target', detail);
        else if (ratio < 0.75)
          add(HARD, declaredShort ? 'week_undershoots_target_declared' : 'week_undershoots_target', detail);
      }

      if (w.qualityFraction != null && w.qualityFraction > 0.40)
        add(SUSPECT, 'quality_dominates_week', { week: w.week, phase: w.phase, qualityFraction: w.qualityFraction, qualityKm: w.qualityKm, actual: w.actualVolume });
    }

    if (w.isTaper && w.volumeDelta != null && w.volumeDelta > 0.5)
      add(HARD, 'taper_week_increases_volume', { week: w.week, delta: w.volumeDelta, actual: w.actualVolume });
  });

  /* THE VOLUME ACCOUNTING (S0 onward). Every kilometre of the difference
     between what a week was asked for and what it was given must be
     attributable to a named cause. An unattributed difference is a generation
     failure -- not a tolerated one, and not one with a threshold. */
  /* THE GENERATOR'S OWN INVARIANT CHECK (S1 onward). buildDaysFromWeeks
     verifies that every fully quantified session reconciles with its own
     components and records anything that does not. This surfaces what it
     recorded, so a generator-side failure cannot pass unnoticed here. */
  (c.invariantFailures || []).forEach(f =>
    add(HARD, 'generator_invariant_failure', { week: f.week, date: f.date,
      archetype: f.archetype, sessionKm: f.sessionKm, segmentTotal: f.segmentTotal,
      negative: f.negative, zeroWork: f.zeroWork }));

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

  /* ---- WEEKLY LOAD PROGRESSION ----
     The percentage, kept by name and demoted to what it always was; and the
     instrument that replaced it as the authority, one SUSPECT code per named
     reason so no family can hide inside another's total. */
  assess(c).forEach(t => {
    if (t.growthOver10pct)
      add(DESCRIPTIVE, 'week_over_week_growth_over_10pct',
          { week: t.toWeek, phase: t.toPhase, growth: t.relative,
            from: t.fromKm, to: t.toKm });
    t.reasons.forEach(reason => add(SUSPECT, 'load_progression_' + reason.toLowerCase(),
      { week: t.toWeek, fromWeek: t.fromWeek, phase: t.toPhase,
        fromPhase: t.fromPhase, from: t.fromKm, to: t.toKm,
        absoluteKm: t.absoluteKm, relative: t.relative,
        levers: t.leverNames, movedLevers: t.movedLevers || [],
        shortRunway: t.shortRunway }));
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

module.exports = { checkCase, HARD, SUSPECT, DESCRIPTIVE };

/* ---------------------------------------------------------------------------
   THE ON-RAMP (S4) — its own invariants, at zero from its first commit.

   A NEW ARCHITECTURE INHERITS NO DEFECT RECORD. There is no baseline to
   ratchet down from, because none of this has ever shipped; every count below
   is asserted flat at zero.
   --------------------------------------------------------------------------- */
function checkOnRamp(c){
  const out = [];
  const add = (tier, code, detail) => out.push({ tier, code, case: c.id, ...detail });
  if (c.skipped) return out;
  if (c.error){ add(HARD, 'onramp_generator_threw', { message: c.error }); return out; }

  (c.invariantFailures || []).forEach(f =>
    add(HARD, 'onramp_invariant_failure', { week: f.week, archetype: f.archetype }));

  c.sessions.forEach(s => {
    if (s.km != null && !num(s.km)) add(HARD, 'onramp_km_not_finite', { week: s.week, km: s.km });
    if (num(s.km) && s.km < 0)      add(HARD, 'onramp_km_negative',   { week: s.week, km: s.km });
    /* NO STRUCTURED QUALITY. The structured pools cannot be built below 4.3km,
       which at on-ramp volumes is a third of the week. Strides are not that. */
    if (s.km > 0 && s.archetype !== 'easy_strides' &&
        ['tempo','threshold','interval','repetition','checkpoint'].indexOf(s.type) !== -1)
      add(HARD, 'onramp_carries_structured_quality', { week: s.week, type: s.type, archetype: s.archetype, km: s.km });
    if (s.segments) s.segments.forEach((g, i) => {
      if (g.km != null && g.km < 0) add(HARD, 'onramp_segment_negative', { week: s.week, index: i, km: g.km });
      if (g.kind === 'work' && g.km === 0) add(HARD, 'onramp_zero_km_work_segment', { week: s.week, index: i });
    });
  });

  c.weeks.forEach(w => {
    const longS = w.sessions.filter(s => s.type === 'long' && s.km > 0);
    const others = w.sessions.filter(s => s.type !== 'long' && s.km > 0);
    const maxOther = others.length ? Math.max(...others.map(s => s.km)) : 0;
    if (!longS.length) add(HARD, 'onramp_week_has_no_long_run', { week: w.week });
    else if (Math.max(...longS.map(s => s.km)) < maxOther)
      add(HARD, 'onramp_long_run_not_longest', { week: w.week,
        longKm: Math.max(...longS.map(s => s.km)), maxOtherKm: maxOther });
    const acc = w.accounting;
    if (!acc) add(HARD, 'onramp_week_has_no_accounting', { week: w.week });
    else if (!acc.reconciled)
      add(HARD, 'onramp_volume_unattributed', { week: w.week, residual: acc.roundingResidual, bound: acc.roundingBound });
  });

  /* IT MUST ARRIVE, OR SAY THAT IT DOES NOT.
     An on-ramp exists to reach the viable race-programme start. Where it
     cannot -- the athlete has one week, or their day count cannot distribute
     the destination -- that is a real and reportable fact about their
     situation, not a broken block. The rule is the same one S2 established for
     the allocator: no SILENT failure to arrive. A shortfall the accounting
     already names is declared; one nothing accounts for is a defect. */
  const peak = c.weeks.length ? Math.max(...c.weeks.map(w => w.actualVolume)) : 0;
  const target = c.pathway.onRampToKm;
  if (target > 0 && peak < target * 0.95){
    const declared = (c.accounting || []).some(e => e.allocatorRevision > 0)
      || c.pathway.onRampWeeks < 4;   // too few weeks to ramp is stated by the pathway itself
    add(declared ? SUSPECT : HARD,
        declared ? 'onramp_declared_shortfall' : 'onramp_does_not_reach_its_target',
        { peak, target, onRampWeeks: c.pathway.onRampWeeks });
  }

  return out;
}
module.exports.checkOnRamp = checkOnRamp;



/* ---------------------------------------------------------------------------
   FOUNDATION (S5) — its own invariants, at zero from its first commit.
   --------------------------------------------------------------------------- */
function checkFoundation(c){
  const out = [];
  const add = (tier, code, detail) => out.push({ tier, code, case: c.id, ...detail });
  if (c.skipped) return out;
  if (c.error){ add(HARD, 'foundation_generator_threw', { message: c.error }); return out; }

  (c.invariantFailures || []).forEach(f =>
    add(HARD, 'foundation_invariant_failure', { week: f.week, archetype: f.archetype }));

  c.sessions.forEach(s => {
    if (s.km != null && !num(s.km)) add(HARD, 'foundation_km_not_finite', { week: s.week, km: s.km });
    if (num(s.km) && s.km < 0)      add(HARD, 'foundation_km_negative',   { week: s.week, km: s.km });
    /* NOT A MINIATURE RACE BLOCK. No structured quality and no long run: those
       are the two things this athlete's volume cannot express, and shrinking
       either until it fits is the defect the whole programme exists to remove. */
    if (s.km > 0 && s.archetype !== 'easy_strides' &&
        ['tempo','threshold','interval','repetition','checkpoint'].indexOf(s.type) !== -1)
      add(HARD, 'foundation_carries_structured_quality', { week: s.week, type: s.type, km: s.km });
    if (s.type === 'long')
      add(HARD, 'foundation_carries_a_long_run', { week: s.week, km: s.km });
    /* NO TINY ARTIFICIAL WORK. A session either exists at the quantum it is
       presented in, or it does not exist. */
    if (s.km != null && s.km > 0 && s.km < 0.5)
      add(HARD, 'foundation_session_below_quantum', { week: s.week, km: s.km });
    if (s.segments) s.segments.forEach((g, i) => {
      if (g.km != null && g.km < 0) add(HARD, 'foundation_segment_negative', { week: s.week, index: i, km: g.km });
      if (g.kind === 'work' && g.km === 0) add(HARD, 'foundation_zero_km_work_segment', { week: s.week, index: i });
    });
  });

  c.weeks.forEach((w, i) => {
    const acc = w.accounting;
    if (!acc) add(HARD, 'foundation_week_has_no_accounting', { week: w.week });
    else if (!acc.reconciled)
      add(HARD, 'foundation_volume_unattributed', { week: w.week, residual: acc.roundingResidual, bound: acc.roundingBound });
    /* IT OPENS WHERE THE ATHLETE IS. A foundation block that starts above the
       volume the athlete stated has manufactured training, which is the whole
       failure this architecture replaces. */
    if (i === 0){
      const stated = c.inputs.volume;
      if (stated > 0 && w.actualVolume > stated * 1.30 + 0.5)
        add(HARD, 'foundation_week_one_exceeds_stated_volume',
          { stated, weekOne: w.actualVolume, ratio: Math.round(w.actualVolume / stated * 100) / 100 });
    }
  });

  /* IT MUST ARRIVE, OR SAY THAT IT DOES NOT -- the S2 rule again. */
  const peak = c.weeks.length ? Math.max(...c.weeks.map(w => w.actualVolume)) : 0;
  const target = c.pathway.foundationToKm;
  if (target > 0 && peak < target * 0.95){
    /* ROUNDING COUNTS AS DECLARED, because the accounting already names it and
       bounds it. A destination of 13.7km over five days is 2.74 per session,
       which is presented as 2.5 -- the block lands at 12.5 and every kilometre
       of the difference is attributed. That is the quantum, not a failure to
       arrive. */
    const peakWeek = c.weeks.reduce((m, w) => w.actualVolume > m.actualVolume ? w : m, c.weeks[0]);
    const bound = (peakWeek && peakWeek.accounting) ? peakWeek.accounting.roundingBound : 0;
    const declared = (c.accounting || []).some(e => e.allocatorRevision > 0)
      || c.pathway.foundationWeeks < 4
      || (target - peak) <= bound + 0.001;
    add(declared ? SUSPECT : HARD,
        declared ? 'foundation_declared_shortfall' : 'foundation_does_not_reach_its_target',
        { peak, target, foundationWeeks: c.pathway.foundationWeeks });
  }
  return out;
}
module.exports.checkFoundation = checkFoundation;
