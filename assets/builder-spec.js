// Velvet Viking -- THE CANONICAL BUILDER SPECIFICATION.
//
// One source of truth for the nine-stage plan builder's SHAPE: stage names,
// order, headings, field defaults, validation thresholds and the goal-
// ambition mapping. Not the coaching engine -- nothing in this file computes
// a pace, a session or a progression. It is the taxonomy and the rules a UI
// needs to ask the nine questions the same way, wherever it asks them.
//
// CONSUMED THREE WAYS, FROM ONE FILE, WITH NO COPY ANYWHERE:
//   1. The protected app (protected/velvet-viking-valhalla.html) loads this
//      file with a plain <script src="/assets/builder-spec.js"> tag before
//      its own inline script, and reads window.BUILDER_SPEC.
//   2. /start (start.html) loads the identical tag and reads the identical
//      global -- the same request, the same bytes, the same object shape.
//   3. api/_preview.js -- which validates a build request and runs the real
//      engine on it before an athlete has ever authenticated -- requires()
//      this file directly as a CommonJS module.
//   4. test/harness.js injects it into the sandboxed VM the regression suite
//      runs the app in, so the app's own code and the tests that exercise it
//      see the same object a real browser would.
//
// This file is served as a plain static asset (Vercel's filesystem handler,
// same as vvv-shell.css) -- deliberately public, because /start needs it
// before an athlete has an account. That is safe: everything here is field
// taxonomy, UI copy and validation bounds the preview endpoint's own error
// responses already reveal. The coaching methodology -- pace formulas,
// session libraries, block construction, progression rules -- stays exactly
// where it always was, inside the protected runtime and the server-side
// engine the preview loads through test/harness.js. Nothing here decides
// what a training day looks like; it only decides what the builder asks.
//
// CHANGING THIS FILE CHANGES BOTH SURFACES AT ONCE. That is the point: a
// stage renamed, reordered or re-validated here is renamed, reordered and
// re-validated everywhere in the same commit. test/builderSpecParity.test.js
// asserts the app's own builder still agrees with every field below --
// so a hand-edit to the app's copy of a stage name fails the suite instead
// of silently drifting from what the public surface asks.
'use strict';

var BUILDER_SPEC = {
  /* ---------- THE TEN STAGES, IN ORDER ----------
     `key` is the name bldValidateStage()/BLD_STAGE use internally; `name` is
     the short rail label (also what BLD_STAGE_NAMES has always held); `heading`
     and `lede` are the purpose-neutral copy stage 02 (Goal) renames live (via
     bldApplyPurpose()) and every other stage shows verbatim.

     OVERVIEW is a pure orientation screen -- no field, no validation, nothing
     handleGeneratePlan() reads. It exists so the athlete knows what the next
     nine questions are for before the first one arrives. */
  stages: [
    { key: 'OVERVIEW',   name: 'Overview',       heading: 'Build Your Training Block',
      lede: 'A plan, built around you.' },
    { key: 'GOAL',       name: 'Goal',           heading: 'Your goal',
      lede: 'What are we building towards? You do not need an event booked.' },
    { key: 'DISTANCE',   name: 'Distance',        heading: 'Goal distance',
      lede: 'The distance this block prepares you for.' },
    { key: 'EVENT',      name: 'Event',           heading: 'Your event',
      lede: 'Do you have a target event? Either answer builds a full block.' },
    { key: 'YOU',        name: 'You',             heading: 'You',
      lede: 'Where your running is right now — not where you want it to be.' },
    { key: 'BENCHMARK',  name: 'Benchmark',       heading: 'Benchmark',
      lede: 'A recent honest-effort 5K or 10K. Your training paces are built from it.' },
    { key: 'WEEK',       name: 'Week',            heading: 'Your week',
      lede: 'Pick 3–6 days you can run. Workouts land only on these; everything else is rest.' },
    { key: 'TRAINING',   name: 'Training data',   heading: 'Training data',
      lede: 'Optional heart-rate numbers, if you have them.' },
    { key: 'TARGETS',    name: 'Targets',         heading: 'Your targets',
      lede: 'The finish times you are chasing.' },
    { key: 'REVIEW',     name: 'Review',          heading: 'What Valhalla understands',
      lede: 'Check this reads like your training. Step back to change anything.' }
  ],

  /* ---------- WHAT THE BLOCK IS FOR ----------
     Same four objectives the app offers, in the same order. Recovery is
     deliberately absent here too -- it is a coach recommendation made after
     an actual race, never a menu choice, so it can never reach a builder. */
  purposes: {
    order: ['race', 'maintain', 'base', 'speed'],
    meta: {
      race: {
        label: 'Race Goal',
        blurb: 'Train for a distance, with or without an event booked.',
        distanceLabel: 'Goal distance',
        distanceHint: 'The distance this block prepares you for. You do not need an event booked.',
        weeksHint: 'A full distance-specific block, built and tapered to a culminating goal effort in the final week.',
        stageTitle: 'Your goal',
        stageLede: 'What are we building towards? You do not need an event booked.',
        lockDistance: null,
        /* The engine's own default length for this purpose (developmentBlockSpec()
           / builderDefaultWeeks() in the app), echoed here as data so a client
           that has not loaded the engine can still offer the same number. Not a
           second computation -- test/builderSpecParity.test.js asserts this
           equals what the real engine returns. */
        defaultWeeks: 14
      },
      maintain: {
        label: 'Maintain & Protect',
        blurb: 'Hold the fitness you have built, at a lower cost.',
        distanceLabel: 'Fitness to protect',
        distanceHint: 'The shape of running to hold on to. Volume sits below what you have been absorbing; the quality stays.',
        weeksHint: 'Eight weeks is a review point, not a limit — Valhalla asks what is next rather than simply stopping.',
        stageTitle: 'What you are protecting',
        stageLede: 'The fitness you have already built. This block holds it rather than chasing more.',
        lockDistance: null,
        defaultWeeks: 8
      },
      base: {
        label: 'Aerobic Base',
        blurb: 'Build sustainable running capacity.',
        distanceLabel: 'Building towards',
        distanceHint: 'The distance this capacity is for. Base work starts at what you already absorb, and builds from there.',
        weeksHint: 'Long enough for the aerobic work to count. There is no weekly percentage rule — progression follows what you actually absorb.',
        stageTitle: 'What you are building',
        stageLede: 'Sustainable capacity, built from what you already absorb. No event needed.',
        lockDistance: null,
        defaultWeeks: 10
      },
      speed: {
        label: 'Speed & Threshold',
        blurb: 'Sharpen speed and threshold without a race to aim at.',
        distanceLabel: 'Sharpening at',
        distanceHint: 'Speed work uses the 5K block’s existing methodology — no new intensity system, and nothing invented for this purpose.',
        weeksHint: 'Short and sharp. Sharpening is a phase, not a season.',
        stageTitle: 'What you are sharpening',
        stageLede: 'Speed and threshold work, using the 5K block’s existing sessions. No event needed.',
        lockDistance: '5k',
        defaultWeeks: 6
      }
    }
  },

  /* ---------- GOAL DISTANCE ----------
     Naming only -- key, order and athlete-facing label. Not the engine's
     DISTANCE_PROFILES: raceKm, longCapKm, volMult and emphasis are session-
     library methodology and stay inside the protected runtime, never echoed
     here. */
  distances: {
    order: ['5k', '10k', 'half', 'full', 'ultra'],
    labels: {
      '5k': '5K', '10k': '10K', half: 'Half Marathon', full: 'Full Marathon', ultra: 'Ultra (50K)'
    }
  },

  /* ---------- ATHLETE EXPERIENCE ----------
     Coaching-depth preference, not a training input -- same three levels,
     same order, same hint copy the app's EXPERIENCE_META has always held. */
  experience: {
    order: ['novice', 'experienced', 'advanced'],
    default: 'experienced',
    meta: {
      novice: { label: 'New to structured training', short: 'New',
        hint: 'Tell me what to do, how to do it and what it should feel like.' },
      experienced: { label: 'Experienced', short: 'Experienced',
        hint: 'Give me the session, targets and the important coaching cues.' },
      advanced: { label: 'Advanced', short: 'Advanced',
        hint: 'Keep it concise. Give me the prescription and let me run.' }
    }
  },

  /* ---------- BENCHMARK ----------
     The two distances Valhalla accepts as an honest-effort reference. */
  benchmarkDistances: { order: ['5k', '10k'], default: '10k' },

  /* ---------- TARGETS: GOAL A / B / C ----------
     Dream / Solid / Safety Net, and the multiplier handleSuggestGoals() (app)
     and the GOAL_AMBITION_MULT preview echo (server) both already apply to a
     benchmark-derived VDOT. Ambition IS the same choice as Goal A/B/C: rather
     than a fourth surface, /start's single ambition question resolves
     directly to one of these three keys, and adoptPendingBuildIfAny() writes
     it into state.setup.goals under that exact key -- so a pre-auth "Push it"
     choice and an in-app typed Goal A are the same fact, stored the same way. */
  goals: {
    keys: ['A', 'B', 'C'],
    labels: { A: 'Dream Target', B: 'Solid Target', C: 'Safety Net' },
    ambitionMult: { A: 1.06, B: 1.00, C: 0.94 }
  },

  /* ---------- THE TRAINING WEEK ---------- */
  weekdays: { isoNames: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },

  /* ---------- VALIDATION ----------
     THE SAME REQUIREMENTS bldValidateStage()/handleGeneratePlan() enforce in
     the app, and api/_preview.js enforces server-side before an athlete has
     an account. One set of numbers; both surfaces read them from here. */
  validation: {
    weeksRange: [4, 24],
    volumeMustExceed: 0,
    daysRange: [3, 6],
    benchmarkSecondsRange: [300, 40000]
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = BUILDER_SPEC;
if (typeof window !== 'undefined') window.BUILDER_SPEC = BUILDER_SPEC;
