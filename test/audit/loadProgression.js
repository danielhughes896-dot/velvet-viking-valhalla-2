'use strict';
/* WEEKLY LOAD PROGRESSION — what actually changed in the athlete's training.
 * ===========================================================================
 * THIS REPLACES A PERCENTAGE, AND THE PERCENTAGE IS KEPT.
 *
 * The instrument it replaces asked one question of every week: did the total
 * distance rise more than ten per cent? That treats 6 -> 7km (+1km) as worse
 * than 80 -> 88km (+8km), and it counted a change UP in the same pass that
 * halved the largest absolute jump in the population -- because the correction
 * that removed a hidden accounting defect also stopped the easy runs absorbing
 * a phantom quality surplus, which made the weeks honest and the percentages
 * noisier. A measure that moves the wrong way when the training gets better is
 * not measuring the training.
 *
 * SO THIS ASKS FOUR QUESTIONS INSTEAD OF ONE:
 *
 *   HOW MUCH changed        absolute kilometres, reported always
 *   HOW LARGE relative to   the ratio, reported always -- still evidence, no
 *   the athlete's own load  longer a verdict
 *   WHAT changed            which of the athlete's load levers moved, each
 *                           measured against its OWN presentation quantum and
 *                           its OWN progression authority
 *   WHY                     the structural context: phase, cutback geometry,
 *                           runway compression, taper, race week
 *
 * AND IT JUDGES THE COMBINATION, because that is where coaching lives. A long
 * run stepping on its own is development. A long run stepping in the same week
 * a quality session arrives and a fourth running day is added is three
 * decisions taken at once, and the generator's own architecture says it should
 * not be: "the week a purpose arrives is a week the doses hold".
 *
 * =========================================================================
 * EVERY THRESHOLD HERE ALREADY EXISTED AND ALREADY MEANT THIS
 * =========================================================================
 * There is no new constant, no `>10% AND >X km`, and no risk score.
 *
 *   VOLUME_BLOCK_GROWTH_CAP (1.10)   the ORDINARY step. The marathon's own
 *                                    session progression is
 *                                    min(VOLUME_BLOCK_GROWTH_CAP,
 *                                    sqrt(SESSION_TWO_WEEK_GROWTH_CAP)) per
 *                                    developing week, so a lever moving faster
 *                                    than this is moving faster than the
 *                                    architecture says it develops.
 *   SESSION_TWO_WEEK_GROWTH_CAP      Nielsen 2014, and the only externally
 *   (1.30)                           evidenced ceiling this product has: a
 *                                    distance increase above ~30% across two
 *                                    weeks is where the injury signal is. It
 *                                    is a BACKSTOP, which is why it is the one
 *                                    rule here that fires on the total alone.
 *   CUTBACK_FACTOR (0.78)            what a cutback week is. The rebound after
 *                                    one is designed, so it is measured
 *                                    against the week BEFORE the cutback --
 *                                    the trend -- rather than exempted.
 *   the presentation quanta          a long run renders to the kilometre and
 *   (1km / EASY_QUANTUM_KM)          everything else to the half. A lever that
 *                                    moved by one quantum did not progress; it
 *                                    was rounded. This is what stops 6 -> 7,
 *                                    which is a 3km long run becoming a 4km
 *                                    one, being read as a 33% escalation.
 *
 * NOTHING HERE PREDICTS INJURY. It identifies training decisions that warrant
 * inspection, with named reasons, and says so in those words.
 */

const path = require('path');
const { app } = require(path.join(__dirname, 'planAudit.js'));

/* EVERY AUTHORITY IS READ FROM THE RUNTIME, NEVER RESTATED HERE. Where a
   runtime does not state one -- comparing this branch against main, which
   predates the marathon session-progression work -- the rule that depends on
   it is not applied rather than being given a number of its own. An audit that
   invents the constant it is auditing against has stopped being an audit. */
const A = app();
const ORDINARY_STEP  = A.VOLUME_BLOCK_GROWTH_CAP;        // 1.10
const TWO_WEEK_CAP   = A.SESSION_TWO_WEEK_GROWTH_CAP;    // 1.30, Nielsen; may be absent
const EASY_QUANTUM   = A.EASY_QUANTUM_KM;                // 0.5
const LONG_QUANTUM   = 1;                                // roundWorkoutKm('long')
const SESSION_RATE   = typeof A.sessionProgressionRate === 'function'
  ? A.sessionProgressionRate() : ORDINARY_STEP;
const DEDICATED_WEEKS = A.MARATHON_DEDICATED_WEEKS || null;
const r1 = n => Math.round(n * 10) / 10;
const r2 = n => Math.round(n * 100) / 100;

const QUALITY_TYPES = ['tempo', 'threshold', 'interval', 'repetition', 'checkpoint'];
const isQuality = s => QUALITY_TYPES.indexOf(s.type) !== -1 && s.km > 0;

/* ---------- WHAT A WEEK CONTAINS, AS LOAD ----------
   Measured from the sessions the athlete actually receives. The race itself is
   not training progression and is held apart; the training inside race week is
   not, and is measured like any other week -- so a race-week exemption cannot
   hide a pre-race training step. */
function weekLoad(w){
  const runs = w.sessions.filter(s => s.km > 0);
  const race = runs.filter(s => s.type === 'race');
  const longs = runs.filter(s => s.type === 'long');
  const qual = runs.filter(isQuality);
  const ml = runs.filter(s => s.mediumLong);
  const support = runs.filter(s => s.type === 'easy' || s.mediumLong);
  return {
    week: w.week, phase: w.phase,
    isCutback: !!w.isCutback, isTaper: !!w.isTaper, isRace: !!w.isRace,
    trainingKm: r1(runs.reduce((t, s) => t + s.km, 0) - race.reduce((t, s) => t + s.km, 0)),
    raceKm: r1(race.reduce((t, s) => t + s.km, 0)),
    longKm: longs.length ? Math.max.apply(null, longs.map(s => s.km)) : 0,
    supportKm: r1(support.reduce((t, s) => t + s.km, 0)),
    qualityKm: r1(qual.reduce((t, s) => t + s.km, 0)),
    qualityCount: qual.length,
    qualityMaxKm: qual.length ? Math.max.apply(null, qual.map(s => s.km)) : 0,
    qualityShapes: qual.map(s => s.type + ':' + (s.archetype || '?')).sort().join(','),
    checkpointKm: r1(qual.filter(s => s.type === 'checkpoint').reduce((t, s) => t + s.km, 0)),
    mediumLongKm: r1(ml.reduce((t, s) => t + s.km, 0)),
    specificKm: r1(runs.filter(s => s.mpSegment && s.type !== 'race').reduce((t, s) => t + s.km, 0)),
    runDays: runs.length
  };
}

/* ---------- HAS THIS LEVER ACTUALLY PROGRESSED? ----------
   Two conditions, and both are the architecture's own. It must have moved by
   more than the quantum it is PRESENTED in -- below that the number on the
   card changed and the training did not -- and it must have moved faster than
   the ordinary step the generator develops sessions at. Appearing where it did
   not exist is always a progression: a session the athlete did not have is not
   a bigger version of anything. */
function lever(name, from, to, quantum){
  if (!(to > 0)) return null;
  if (!(from > 0)) return { name: name, from: r1(from), to: r1(to), delta: r1(to - from),
                            ratio: null, introduced: true };
  const delta = to - from, ratio = to / from;
  if (delta <= quantum + 1e-9) return null;
  if (ratio <= ORDINARY_STEP + 1e-9) return null;
  return { name: name, from: r1(from), to: r1(to), delta: r1(delta),
           ratio: r2(ratio), introduced: false };
}
/* ---- AND A WEAKER QUESTION: DID IT MOVE AT ALL? ----
   `lever()` above asks whether something progressed FASTER than the
   architecture develops it. This asks only whether it moved by more than the
   quantum it is presented in -- which is the difference between a week where
   one thing developed and a week where everything did. An 80km athlete going
   to 88 moves the long run two kilometres, the supporting work four and the
   quality session two; not one of those exceeds the ordinary step on its own,
   and together they are eight kilometres of new running in a week. A test that
   only ever asks about single levers cannot see that, and a percentage cannot
   see it either -- it reads 1.10 and stops. */
function moved(from, to, quantum){
  return to > 0 && (to - from) > quantum + 1e-9;
}
function countLever(name, from, to){
  if (to > from) return { name: name, from: from, to: to, delta: to - from,
                          ratio: null, introduced: from === 0 };
  return null;
}

/* ---------- ONE TRANSITION, FROM TWO WEEKS ----------
   Lifted out so the instrument can be pointed at a PAIR OF WEEKS that no
   generator produced. An audit nobody can hand a deliberately bad week to is
   an audit nobody can check: the fixtures in
   test/weeklyLoadProgression.test.js build compound steps, quality-structure
   steps and phase jumps by hand and require this to catch them. */
function transitionBetween(a, b, ctx){
  const o = ctx || {};
  const levers = [];
  const push = x => { if (x) levers.push(x); };
  push(lever('long_run',      a.longKm,       b.longKm,       LONG_QUANTUM));
  push(lever('easy_support',  a.supportKm,    b.supportKm,    EASY_QUANTUM));
  push(lever('quality_dose',  a.qualityKm,    b.qualityKm,    EASY_QUANTUM));
  push(lever('medium_long',   a.mediumLongKm, b.mediumLongKm, EASY_QUANTUM));
  push(lever('race_specific', a.specificKm,   b.specificKm,   EASY_QUANTUM));
  push(lever('checkpoint',    a.checkpointKm, b.checkpointKm, EASY_QUANTUM));
  push(countLever('quality_frequency', a.qualityCount, b.qualityCount));
  push(countLever('running_days',      a.runDays,      b.runDays));
  const growth = a.trainingKm > 0 ? b.trainingKm / a.trainingKm : null;
  return {
    case: o.case || 'synthetic', distanceKey: o.distanceKey || 'full',
    volume: o.volume != null ? o.volume : a.trainingKm,
    weeks: o.weeks || null, schedule: o.schedule || null,
    fromWeek: a.week, toWeek: b.week, fromPhase: a.phase, toPhase: b.phase,
    phaseTransition: a.phase !== b.phase,
    afterCutback: !!a.isCutback, isCutback: !!b.isCutback,
    isTaper: !!b.isTaper, isRace: !!b.isRace, shortRunway: !!o.shortRunway,
    fromKm: r1(a.trainingKm), toKm: r1(b.trainingKm),
    absoluteKm: r1(b.trainingKm - a.trainingKm),
    relative: growth == null ? null : r2(growth),
    levers: levers, leverCount: levers.length, leverNames: levers.map(x => x.name),
    before: a, after: b,
    growthOver10pct: growth != null && r2(growth) > 1.10 && !b.isRace && !a.isCutback,
    twoWeek: o.twoWeek != null ? o.twoWeek : null,
    twoWeekFromKm: o.twoWeekFromKm != null ? o.twoWeekFromKm : null,
    preCutbackKm: o.preCutbackKm != null ? o.preCutbackKm : 0,
    reasons: []
  };
}

/* A week's load as a plain object, for fixtures. Same field names weekLoad()
   produces, so a hand-built week and a generated one are the same shape. */
function synthWeek(o){
  return Object.assign({
    week: 1, phase: 'Build', isCutback: false, isTaper: false, isRace: false,
    trainingKm: 0, raceKm: 0, longKm: 0, supportKm: 0, qualityKm: 0,
    qualityCount: 0, qualityMaxKm: 0, qualityShapes: '', checkpointKm: 0,
    mediumLongKm: 0, specificKm: 0, runDays: 0
  }, o);
}

/* ---------- THE TRANSITIONS OF ONE PLAN ---------- */
function transitions(c){
  if (c.error || !c.weeks || c.weeks.length < 2) return [];
  const L = c.weeks.map(weekLoad);
  const out = [];
  for (let i = 1; i < L.length; i++){
    const a = L[i - 1], b = L[i];
    /* THE RUNWAY THIS BLOCK IS ON, carried as context and never as an excuse.
       A marathon block shorter than the dedicated window has compressed its
       phases, which is authorised -- and HQ's instruction is explicit that
       compression does not exempt a transition, so this only ever labels. */
    const shortRunway = c.inputs.distanceKey === 'full' && DEDICATED_WEEKS != null &&
                        c.planWeeks < DEDICATED_WEEKS;
    const levers = [];
    const push = x => { if (x) levers.push(x); };
    push(lever('long_run',        a.longKm,      b.longKm,      LONG_QUANTUM));
    push(lever('easy_support',    a.supportKm,   b.supportKm,   EASY_QUANTUM));
    push(lever('quality_dose',    a.qualityKm,   b.qualityKm,   EASY_QUANTUM));
    push(lever('medium_long',     a.mediumLongKm, b.mediumLongKm, EASY_QUANTUM));
    push(lever('race_specific',   a.specificKm,  b.specificKm,  EASY_QUANTUM));
    push(lever('checkpoint',      a.checkpointKm, b.checkpointKm, EASY_QUANTUM));
    push(countLever('quality_frequency', a.qualityCount, b.qualityCount));
    push(countLever('running_days',      a.runDays,      b.runDays));

    const growth = a.trainingKm > 0 ? b.trainingKm / a.trainingKm : null;
    const t = {
      case: c.id, distanceKey: c.inputs.distanceKey, volume: c.inputs.volume,
      weeks: c.inputs.weeks, schedule: c.inputs.scheduleKey,
      fromWeek: a.week, toWeek: b.week,
      fromPhase: a.phase, toPhase: b.phase,
      phaseTransition: a.phase !== b.phase,
      afterCutback: a.isCutback, isCutback: b.isCutback,
      isTaper: b.isTaper, isRace: b.isRace, shortRunway: shortRunway,
      fromKm: a.trainingKm, toKm: b.trainingKm,
      absoluteKm: r1(b.trainingKm - a.trainingKm),
      relative: growth == null ? null : r2(growth),
      levers: levers, leverCount: levers.length,
      leverNames: levers.map(x => x.name),
      before: a, after: b,
      /* THE OLD MEASURE, PRESERVED BY NAME AND SEMANTICS so the historical
         series stays comparable. Descriptive from here on. */
      /* THE OLD MEASURE, PRESERVED TO THE DECIMAL. It compared a ratio already
         rounded to two places, so 1.104 did not count; keeping that rounding is
         what makes the historical series comparable rather than merely
         similarly named. */
      growthOver10pct: growth != null && r2(growth) > 1.10 && !b.isRace && !a.isCutback,
      reasons: []
    };
    out.push(t);
  }
  /* Two-week context needs the whole list, so it is attached afterwards. */
  out.forEach((t, i) => {
    t.twoWeek = twoWeekGrowth(L, i + 1);
    t.twoWeekFromKm = (i >= 1) ? L[i - 1].trainingKm : null;
  });
  return out;
}

/* Nielsen's window is TWO weeks, so it is asked over two weeks. A cutback in
   between is designed geometry and makes the comparison meaningless, so it is
   not asked there rather than being excused there. */
function twoWeekGrowth(L, idx){
  if (idx < 2) return null;
  const a = L[idx - 2], b = L[idx];
  if (a.isCutback || L[idx - 1].isCutback || b.isRace) return null;
  if (!(a.trainingKm > 0)) return null;
  return r2(b.trainingKm / a.trainingKm);
}

/* ---------- THE JUDGEMENT ----------
   Named reasons only. Nothing is called unsafe: these identify a training
   decision that warrants review, which is what an audit can honestly claim. */
function classify(t){
  const R = t.reasons;
  /* ---- RACE WEEK IS A DIFFERENT KIND OF WEEK, AND ONLY THE LAST ONE ----
     It contains the race, its training is three or four shakeout runs, and it
     is shaped by the event rather than by progression -- so a taper week of six
     kilometres followed by eight kilometres of shakeout across four days is
     race-day geometry, not a load step. Reported descriptively like every other
     transition and never called suspicious. This cannot hide pre-race
     progression: every Build and Peak transition before it is judged normally,
     and the race distance itself is already excluded from trainingKm. */
  if (t.isRace) return t;

  /* A WEEK TOTAL IS A SUM OF ROUNDED SESSIONS, so the smallest difference that
     is certainly training and not presentation is the largest quantum inside
     it -- the long run's kilometre. The same guard the levers use, applied to
     the total where the total is what is being compared. */
  const weekMoved = km => km > LONG_QUANTUM + 1e-9;
  const doseLevers = t.leverNames.filter(n =>
    ['long_run', 'easy_support', 'quality_dose', 'race_specific'].indexOf(n) !== -1);
  const structureLevers = t.leverNames.filter(n =>
    ['quality_frequency', 'running_days', 'medium_long', 'checkpoint'].indexOf(n) !== -1);

  /* A TAPER MAY NOT ADD LOAD. Held here as well as in the hard invariant so
     the progression instrument is complete on its own terms. */
  if (t.isTaper && t.absoluteKm > EASY_QUANTUM) R.push('TAPER_LOAD_INCREASE');

  /* THE ONE EXTERNALLY EVIDENCED CEILING, on the total, over its own window. */
  if (TWO_WEEK_CAP != null && t.twoWeek != null && t.twoWeek > TWO_WEEK_CAP + 1e-9 &&
      weekMoved(t.toKm - t.twoWeekFromKm))
    R.push('EXCEEDS_TWO_WEEK_BACKSTOP');

  /* A REBOUND RETURNS TO TREND. Measured against the week before the cutback,
     which is what "trend" means, rather than exempted because a cutback
     happened. Growth relative to the cutback week itself is designed and is
     not asked.

     OVER THE WEEKS IT ACTUALLY SPANS. The comparison reaches back across the
     absorption week to the week before it, so two weeks of the curve have
     elapsed and the trend it must return to is two steps, not one. Asking a
     two-week change to sit under a one-week ceiling made the rule fire on the
     trend itself: once the curve began stepping THROUGH an absorption week --
     which is what every published methodology does, and what this branch
     corrected -- a rebound landed at 1.10 squared by construction and was
     reported as though it had overshot. This is the span the change covers,
     not a threshold chosen to make anything pass; a rebound that genuinely
     outruns two weeks of trend still fires. */
  if (t.afterCutback && t.preCutbackKm > 0 &&
      t.toKm / t.preCutbackKm >
        Math.pow(ORDINARY_STEP, Math.max(1, t.preCutbackSpan || 1)) + 1e-9 &&
      weekMoved(t.toKm - t.preCutbackKm))
    R.push('REBOUND_EXCEEDS_TREND');

  /* Everything below is about a week that GREW. A descending week cannot be a
     load progression concern. */
  if (t.relative == null || t.absoluteKm <= 0) return t;

  /* DID THE ATHLETE'S LOAD ACTUALLY MOVE? A lever changing while the week
     holds is redistribution -- something else came down to pay for it -- and
     that is a shape decision rather than a progression one. Where the rule
     below is about how much MORE the athlete is doing, it asks this first, and
     it asks it against the architecture's own ordinary step rather than
     against a number chosen for the purpose. */
  const weekStepped = t.relative > ORDINARY_STEP + 1e-9;

  /* THE GENERATOR'S OWN RULE, CHECKED. "The week a purpose arrives is a week
     the doses hold" -- structure is itself a progression and is paid for on
     its own. A week that introduces one AND steps a dose has taken two
     decisions at once. */
  if (structureLevers.length && doseLevers.length && !t.afterCutback)
    R.push('STRUCTURE_INTRODUCED_WITH_DOSE_STEP');

  /* TWO OR MORE LEVERS AT ONCE, in a week that also moved faster than the
     architecture's ordinary step. Either alone is development; together they
     are compound load, and the total says the athlete felt it. */
  if (t.leverCount >= 2 && weekStepped && !t.afterCutback &&
      R.indexOf('STRUCTURE_INTRODUCED_WITH_DOSE_STEP') === -1)
    R.push('COMPOUND_LOAD_PROGRESSION');

  /* ---- EVERYTHING MOVED AT ONCE ----
     Not "one lever ran away" -- that is the rule above -- but "the athlete is
     doing more of everything, and the week is developing at the full ordinary
     rate while they do". Three or more levers each moving by more than their
     own presentation quantum, in a week already stepping at
     VOLUME_BLOCK_GROWTH_CAP, is broad load progression. It is the one thing a
     percentage genuinely cannot see: the percentage is the same whether one
     session grew or five did. */
  const movedLevers = [
    ['long_run',      moved(t.before.longKm,       t.after.longKm,       LONG_QUANTUM)],
    ['easy_support',  moved(t.before.supportKm,    t.after.supportKm,    EASY_QUANTUM)],
    ['quality_dose',  moved(t.before.qualityKm,    t.after.qualityKm,    EASY_QUANTUM)],
    ['medium_long',   moved(t.before.mediumLongKm, t.after.mediumLongKm, EASY_QUANTUM)],
    ['race_specific', moved(t.before.specificKm,   t.after.specificKm,   EASY_QUANTUM)],
    ['checkpoint',    moved(t.before.checkpointKm, t.after.checkpointKm, EASY_QUANTUM)]
  ].filter(x => x[1]).map(x => x[0]);
  t.movedLevers = movedLevers;
  if (movedLevers.length >= 3 && t.relative >= ORDINARY_STEP - 1e-9 && !t.afterCutback &&
      R.indexOf('COMPOUND_LOAD_PROGRESSION') === -1 &&
      R.indexOf('STRUCTURE_INTRODUCED_WITH_DOSE_STEP') === -1)
    R.push('BROAD_LOAD_INCREASE');

  /* THE LONG RUN AGAINST ITS OWN PROGRESSION AUTHORITY. sessionProgressionRate()
     is what the marathon develops a session at; a step beyond it, by more than
     the kilometre a long run is presented in, is the session outrunning its
     own architecture. */
  const lr = t.levers.filter(x => x.name === 'long_run')[0];
  if (lr && !lr.introduced && lr.ratio > SESSION_RATE + 1e-9 && !t.afterCutback)
    R.push('LONG_RUN_STEP_ABOVE_RATE');

  /* QUALITY FREQUENCY UNCHANGED, QUALITY LOAD MATERIALLY LARGER. One session
     becoming a much bigger session is a load progression even though the week
     still says "one quality day", and it is invisible to anything counting
     sessions. Measured on what is DELIVERED -- qualityDeliveredKm() is now the
     shared truth between what the week prices and what the athlete receives --
     rather than on the structure chain the week happens to hold. */
  /* AND IT HAS TO HAVE MOVED THE WEEK. HQ's instruction is that a different
     quality structure matters where it "materially increases total training
     load" -- a 5km session becoming 6km inside a 40km week is the pool
     rotating, and inside a 12km week it is a tenth of everything the athlete
     does. The session's own step is asked first, the athlete's week second,
     and both use the same ordinary step. My first implementation asked only
     the first and flagged 1,030 transitions on session variation that never
     reached the athlete's total; this is the instruction read properly rather
     than a threshold chosen to reduce a count. */
  if (t.before.qualityCount === t.after.qualityCount && t.after.qualityCount > 0 &&
      t.after.qualityKm - t.before.qualityKm > EASY_QUANTUM + 1e-9 &&
      t.before.qualityKm > 0 &&
      t.after.qualityKm / t.before.qualityKm > ORDINARY_STEP + 1e-9 &&
      weekStepped && !t.afterCutback)
    R.push('QUALITY_STRUCTURE_STEP');

  return t;
}

/* preCutbackKm has to be filled before classify() can ask about a rebound. */
function withCutbackTrend(list){
  list.forEach((t, i) => {
    t.preCutbackKm = 0;
    /* HOW MANY WEEKS THE COMPARISON ACTUALLY SPANS, which is what the trend
       has to be raised to. One absorption week between the two makes it two
       weeks of trend; two consecutive absorption weeks make it three. Without
       this the rule asked whether a two-week change exceeded a one-week
       ceiling, which it always does. */
    t.preCutbackSpan = 0;
    if (!t.afterCutback) return;
    for (let j = i - 1; j >= 0; j--){
      t.preCutbackSpan++;
      if (!list[j].isCutback){ t.preCutbackKm = list[j].toKm; break; }
      if (j === 0){ t.preCutbackKm = list[j].fromKm; t.preCutbackSpan++; }
    }
    t.preCutbackSpan = Math.max(1, t.preCutbackSpan);
  });
  return list;
}

function assess(c){
  const list = withCutbackTrend(transitions(c));
  list.forEach(classify);
  return list;
}

const REASON_CODES = ['TAPER_LOAD_INCREASE', 'EXCEEDS_TWO_WEEK_BACKSTOP',
  'REBOUND_EXCEEDS_TREND', 'STRUCTURE_INTRODUCED_WITH_DOSE_STEP',
  'COMPOUND_LOAD_PROGRESSION', 'BROAD_LOAD_INCREASE',
  'LONG_RUN_STEP_ABOVE_RATE', 'QUALITY_STRUCTURE_STEP'];

module.exports = { assess, transitions, weekLoad, lever, classify,
                   transitionBetween, synthWeek,
                   REASON_CODES, ORDINARY_STEP, TWO_WEEK_CAP,
                   EASY_QUANTUM, LONG_QUANTUM };
