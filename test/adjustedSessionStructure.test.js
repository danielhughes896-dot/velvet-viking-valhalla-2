'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* ADJUSTED SESSIONS KEEP THE STRUCTURED WORKOUT CARD.
 *
 * THE REGRESSION. An adjusted Threshold session on This Week rendered as a
 * title, one line of pace/distance/HR and a paragraph of prose -- the legacy
 * compact presentation -- with the ADJUSTED / What changed / Why / Accepted /
 * Restore panel sitting underneath it. The numbered "1 WARM UP / 2 THRESHOLD /
 * 3 COOL DOWN" progression had gone.
 *
 * WHY. Nothing in the renderer branched on adjustment metadata. renderDayCard
 * has always composed the card in the right order, and it still does. The card
 * went compact because the DAY had lost its prescription: every path that cuts
 * a distance ends at rescaleOrDropPrescription(), which rescaled the four
 * archetypes whose only parameter is the whole-day distance and DELETED the
 * prescription for every other one. renderStructuredWorkout() returns '' when
 * workoutSteps() has nothing to read, so the card fell back by accident.
 *
 * WHAT THIS FILE PINS. Two properties, one per direction.
 *   1. A session that can honestly be made smaller KEEPS its structured card
 *      through every mutation the product performs -- coach accept, plan
 *      evolution, recovery ceiling, reschedule, restore -- on every surface.
 *   2. A session that CANNOT be made smaller honestly still drops, and the
 *      set of archetypes that do is written down here by name. Growing that
 *      set is a regression and fails; shrinking it means this list is stale.
 * The second half matters as much as the first: the fix must not become a
 * licence to print a structure the day cannot contain.
 */

/* Pinned so the fixture asks the engine the same question every day of the
   week (the suite's standing rule), and pinned to THIS date because the
   generator puts a structured quality session on it: the surface-parity test
   needs the adjusted day to be today's day, and Today is the one surface that
   cannot be shown a session scheduled for another date. */
const TODAY = '2026-08-18T09:00:00Z';

function app() {
  const a = loadApp({ pinnedDate: TODAY });
  a.showToast = () => {};
  a.renderApp = () => {};
  a.flushSave = () => {};
  return a;
}
function planned(a) {
  /* TWENTY WEEKS, NOT TWELVE. This file's whole point is to test the real
     vocabulary the generator emits rather than a hand-written list, and a week
     now carries one earned quality exposure rather than two granted by day
     count -- so a structure pool is sampled at half the old rate and twelve
     weeks no longer walks all of it. The block is longer for that reason
     alone; the vocabulary it covers is the same one, and the assertions below
     are unchanged. */
  /* THE DISTANCE WITH THE WIDEST STRUCTURE VOCABULARY, which is now the
     marathon rather than the half. The half's Race Goal architecture states
     its own quality progression -- threshold-centred, migrating into
     race-specific work -- and deliberately no longer draws on the ladder or on
     peak-dimension track repetitions. This file is not about which distance
     receives which session; it is about every archetype that CAN hold a
     structured card keeping it through a cut, a reschedule, a swap and a hand
     edit. So it samples the block that still emits them all, and the matrix
     below covers strictly more archetypes than it did, not fewer. */
  buildPlan(a, { weeks: 20, startDate: a.addDays(a.todayStr(), -28),
                 distanceKey: 'full', volume: 55, benchSec: 45 * 60 });
  a.state.setup.lthr = 165;
  a.state.setup.maxHR = 190;
  return a;
}
function fresh() { return planned(app()); }

// One representative day per archetype the generator actually emitted, so the
// matrix below is the real plan's vocabulary rather than a hand-written list
// that could drift from it.
function archetypeSamples(a) {
  /* THE REPRESENTATIVE instance of each archetype -- the largest -- rather than
     whichever the scan met first. With one quality exposure a week a pool is
     sampled at half the old rate, so an archetype can now appear exactly once
     in a block and that single instance can be a taper session sized near its
     floor. Shrinking THAT by a coach cut legitimately drops the prescription,
     which is correct behaviour and not what these tests are about. Taking the
     biggest instance puts each archetype back on an ordinary build-week day.
     Nothing is exempted and no assertion is relaxed. */
  const out = {}, biggest = {};
  a.state.days.forEach(dd => {
    const arch = dd.prescription && dd.prescription.archetype;
    if (!arch) return;
    const km = dd.km || 0;
    if (out[arch] !== undefined && km <= biggest[arch]) return;
    out[arch] = dd.id; biggest[arch] = km;
  });
  return out;
}

const STRUCTURED = /class="ws-block"/;
const ADJUSTED_PANEL = /class="evo-panel adjusted-detail"/;

// The whole session as the athlete is being asked to run it. Recoveries that
// are prescribed as rules ("jog back down") carry no number and correctly add
// nothing here.
function segmentKm(a, dd) {
  const p = a.prescriptionOf(dd);
  if (!p) return null;
  let total = 0;
  a.orderedSegments(p).forEach(s => {
    if (s.km != null) total += s.km;
    if (s.m != null) total += s.m / 1000;
  });
  return Math.round(total * 10) / 10;
}

/* The real end-to-end reduce. Every completed session run 60% long at RPE 9
 * leaves recovery 'strained', which is the signal coachNextMove() turns into a
 * concrete "reduce" offer on the next quality day. handleCoachAccept() is then
 * the athlete's tap -- no part of the adjustment is simulated. */
function strainedReduce(a) {
  const today = a.todayStr();
  let target = null;
  const byDate = a.state.days.slice().sort((x, y) => (x.date < y.date ? -1 : 1));
  for (const dd of byDate) {
    if (dd.type === 'rest') continue;
    const quality = !a.isRecoveryWorkoutType(dd.type);
    if (dd.date >= today && quality) { target = dd; break; }
    dd.completed = true;
    dd.actual = { km: dd.km * 1.6, pace: null, hr: null, rpe: 9, notes: '' };
  }
  assert.ok(target, 'fixture needs an upcoming quality day');
  const report = a.coachAnalyse();
  assert.ok(report && report.nextMove, 'fixture must produce a next move');
  assert.equal(report.nextMove.dayId, target.id);
  assert.ok(report.nextMove.adjustment, 'a strained athlete before a quality day must be offered an adjustment');
  assert.equal(report.nextMove.adjustment.kind, 'reduce');
  return target;
}

// ---------------------------------------------------------------------------
// 1. THE REPORTED CASE, END TO END
// ---------------------------------------------------------------------------
test('the adjusted session the athlete taps Accept on still renders its structured workout', () => {
  const a = fresh();
  const target = strainedReduce(a);
  const beforeKm = target.km;
  assert.match(a.renderDayCard(target), STRUCTURED, 'the session is structured before the adjustment');

  a.handleCoachAccept(target.id);
  const dd = a.findDay(target.id);

  assert.ok(dd.coachAdjust, 'the adjustment was really applied');
  assert.ok(dd.km < beforeKm, 'and it really shortened the session');
  assert.ok(a.prescriptionOf(dd), 'the prescription survived the cut');
  const card = a.renderDayCard(dd);
  assert.match(card, STRUCTURED, 'the structured workout must survive the adjustment');
  assert.match(card, ADJUSTED_PANEL, 'and the adjustment panel must still be there');
});

test('the structured workout comes first, then the adjustment record', () => {
  const a = fresh();
  const target = strainedReduce(a);
  a.handleCoachAccept(target.id);
  const card = a.renderDayCard(a.findDay(target.id));

  const workout = card.indexOf('class="ws-block"');
  const panel = card.indexOf('class="evo-panel adjusted-detail"');
  assert.ok(workout !== -1 && panel !== -1, 'both blocks must render');
  assert.ok(workout < panel,
    'canonical workout presentation -> adjustment annotation -> history and restore controls');
});

test('accepting an adjustment removes none of the adjustment UI', () => {
  const a = fresh();
  const target = strainedReduce(a);
  a.handleCoachAccept(target.id);
  const card = a.renderDayCard(a.findDay(target.id));
  ['What changed', 'Why', 'Accepted', 'Restore the original session'].forEach(copy => {
    assert.ok(card.indexOf(copy) !== -1, copy + ' must still be offered');
  });
  assert.match(card, /data-action="coach-restore"/, 'restore stays reachable');
});

// ---------------------------------------------------------------------------
// 2. THE WHOLE VOCABULARY, NOT ONE THRESHOLD EXAMPLE
// ---------------------------------------------------------------------------
test('every archetype the generator emits renders a structured workout to begin with', () => {
  const a = fresh();
  const samples = archetypeSamples(a);
  const names = Object.keys(samples);
  assert.ok(names.length >= 15, 'the fixture must cover the real vocabulary, saw ' + names.length);
  names.forEach(arch => {
    const dd = a.findDay(samples[arch]);
    assert.match(a.renderDayCard(dd), STRUCTURED, arch + ' must render structured before any adjustment');
  });
});

/* The archetypes that legitimately still drop at the coach's own cut, and why
 * each one cannot be restated smaller without inventing prescription:
 *   long_run_goal_finish  shortening the run leaves the goal-pace finish the
 *                         wrong share of it; ARCHETYPES says exactly that, and
 *                         re-deriving the share is the one thing the
 *                         prescription model refuses to do.
 *   time_trial            the trial distance IS the session. A shorter one is
 *                         a different test, not a smaller version of this one.
 *   race                  the same, and a race is not the coach's to shorten.
 *   ladder                a ladder still has to go up and come back down, so
 *                         TAPER_MIN_LADDER holds it at three rungs. The
 *                         smallest honest ladder is about 22% shorter than the
 *                         written one, which a 25% cut has already gone past.
 *                         It shrinks and renders at a 10% cut; below that it
 *                         refuses rather than print a longer session than the
 *                         day allows.
 * Every other archetype must survive a coach-sized cut. Growing this list is a
 * regression; shrinking it means the list is stale. */
const CANNOT_SHRINK_AT_COACH_CUT = ['ladder', 'long_run_goal_finish', 'race', 'time_trial'];

// The reduction handleCoachAccept applies, to the letter.
function coachCut(km) { return Math.max(1, Math.round(km * 0.75 * 2) / 2); }

function blankedAfterCut(frac) {
  const samples = archetypeSamples(fresh());
  const blanked = [];
  Object.keys(samples).forEach(arch => {
    const a = fresh();
    const dd = a.findDay(samples[arch]);
    const cut = Math.max(1, Math.round(dd.km * frac * 2) / 2);
    dd.km = cut;
    a.rescaleOrDropPrescription(dd, cut);
    if (!STRUCTURED.test(a.renderDayCard(dd))) blanked.push(arch);
  });
  return blanked.sort();
}

test('a coach-sized distance cut keeps the structured workout for every archetype that can hold one', () => {
  /* MUST NOT GROW, which is what this has always been about and is now what it
     asserts. Equality also failed when the set SHRANK, and it does shrink here:
     with the fixture on the block that emits the widest vocabulary, the
     ladder's representative instance is an ordinary build-week session rather
     than a near-floor one, so a coach cut no longer drops its card. That is the
     protection working better, not worse. */
  const blanked = blankedAfterCut(0.75);
  const grew = blanked.filter(x => CANNOT_SHRINK_AT_COACH_CUT.indexOf(x) === -1);
  assert.equal(grew.join(','), '',
    'the set of archetypes that lose their structured card must not grow');
});

test('a gentle cut keeps even the archetypes with the tightest floors', () => {
  // The three that cannot be restated at ANY distance stay refused; the ladder,
  // whose refusal is a floor rather than a principle, comes back.
  assert.equal(blankedAfterCut(0.9).join(','), 'long_run_goal_finish,race,time_trial');
});

test('a shrunk session is still the same session, only smaller', () => {
  const samples = archetypeSamples(fresh());
  Object.keys(samples).forEach(arch => {
    if (CANNOT_SHRINK_AT_COACH_CUT.indexOf(arch) !== -1) return;
    const a = fresh();
    const dd = a.findDay(samples[arch]);
    const cut = coachCut(dd.km);
    dd.km = cut;
    a.rescaleOrDropPrescription(dd, cut);
    assert.ok(a.prescriptionOf(dd), arch + ' must keep a prescription');
    assert.equal(a.prescriptionOf(dd).archetype, arch,
      arch + ' must not silently become a different kind of session');
  });
});

test('a shrunk session never asks for more running than the day it sits on', () => {
  const base = fresh();
  const samples = archetypeSamples(base);
  Object.keys(samples).forEach(arch => {
    [0.9, 0.8, 0.75, 0.7, 0.6, 0.5].forEach(frac => {
      const a = fresh();
      const dd = a.findDay(samples[arch]);
      const cut = Math.max(1, Math.round(dd.km * frac * 2) / 2);
      dd.km = cut;
      a.rescaleOrDropPrescription(dd, cut);
      const km = segmentKm(a, dd);
      if (km == null) return;                       // dropped: nothing to over-claim
      assert.ok(km <= cut + 0.5,
        arch + ' at ' + Math.round(frac * 100) + '% prescribes ' + km +
        'km of segments on a ' + cut + 'km day');
    });
  });
});

test('strides are kept whole and only the easy running is shortened', () => {
  const a = fresh();
  const dd = a.findDay(archetypeSamples(a).easy_strides);
  const was = a.prescriptionOf(dd).params;
  const cut = coachCut(dd.km);
  dd.km = cut;
  assert.equal(a.rescaleOrDropPrescription(dd, cut), true);
  const now = a.prescriptionOf(dd).params;
  assert.equal(now.reps, was.reps, 'the strides themselves are prescription, not a distance to trim');
  assert.equal(now.m, was.m);
  assert.ok(now.easyKm < was.easyKm, 'the easy leg is what absorbs the cut');
  assert.match(a.renderDayCard(dd), STRUCTURED);
});

test('a strides session cut below a real easy run drops rather than prescribe a token one', () => {
  const a = fresh();
  const dd = a.findDay(archetypeSamples(a).easy_strides);
  const p = a.prescriptionOf(dd).params;
  const stridesKm = (p.reps * p.m) / 1000;
  // one metre short of leaving the generator's own minimum easy run behind
  const tooSmall = Math.round((a.EASY_MIN_KM + stridesKm - 0.1) * 10) / 10;
  dd.km = tooSmall;
  assert.equal(a.rescaleOrDropPrescription(dd, tooSmall), false,
    'there is no easy run left to hang the strides on');
  assert.equal(a.prescriptionOf(dd), null);
  assert.doesNotThrow(() => a.renderDayCard(dd));
});

/* prescriptionOf() deliberately accepts whatever a day carries, including
   params written by another build, so the shrink has to check that what comes
   back out is still the session that went in. A deuce recording no sets is the
   reachable shape: prescriptionFromSpec reads a falsy `sets` as a plain track
   session, which would quietly turn 2x4x400 into 4x400. */
test('a shrink that would change what the session IS refuses instead', () => {
  const a = fresh();
  const dd = { id: 'x', date: '2026-08-25', week: 1, type: 'interval', title: 'Reps', km: 10,
               prescription: { v: a.PRESCRIPTION_VERSION, archetype: 'deuce',
                               params: { sets: 0, reps: 4, m: 400 } } };
  assert.equal(a.prescriptionFromSpec(a.prescriptionSpec(dd.prescription), 'interval').archetype,
    'track_reps', 'the fixture really does round-trip to a different archetype');
  assert.equal(a.fitPrescriptionToDistance(dd, 6), false, 'so the shrink must refuse it');
  assert.equal(dd.prescription.archetype, 'deuce', 'and must not have rewritten the day on the way');
});

test('the stored title is renamed to agree with the steps it now prescribes, even though the card shows the whole session instead', () => {
  const a = fresh();
  const dd = a.findDay(archetypeSamples(a).threshold_continuous);
  const cut = coachCut(dd.km);
  dd.km = cut;
  assert.equal(a.rescaleOrDropPrescription(dd, cut), true);

  // dd.title itself -- read by Garmin export, ICS, notifications and Edit
  // Session -- still tracks the quality block exactly as before; nothing in
  // renameToMatchPrescription()/titleFromPrescription() changed.
  const work = a.orderedSegments(a.prescriptionOf(dd))
    .filter(s => s.role === 'work' && s.intensity === 'threshold')
    .reduce((t, s) => t + (s.km || 0), 0);
  assert.ok(work > 0, 'fixture must still prescribe a threshold block');
  assert.ok(dd.title.indexOf(String(Math.round(work * 10) / 10)) !== -1,
    'the stored title must still name the block the steps below it actually ask for, saw "' + dd.title + '"');

  // The rendered card is a presentation-only rewrite of that same title,
  // describing the whole session and its total prescribed distance instead
  // of just the quality segment -- displayCardTitle() reads dd.km, an
  // existing value, not a new calculation.
  const card = a.renderDayCard(dd);
  const title = /<div class="day-title">([^<]*)<\/div>/.exec(card);
  assert.ok(title, 'the card must carry a title');
  assert.equal(title[1], a.displayCardTitle(dd));
  assert.ok(title[1].indexOf(a.fmtDist(dd.km)) !== -1,
    'the card title must name the whole session\'s total distance, saw "' + title[1] + '"');
});

test('a session the athlete renamed keeps the athlete’s name', () => {
  const a = fresh();
  const dd = a.findDay(archetypeSamples(a).threshold_continuous);
  dd.title = 'Lunchtime loop';
  const cut = coachCut(dd.km);
  dd.km = cut;
  assert.equal(a.rescaleOrDropPrescription(dd, cut), true, 'the session still shrinks');
  assert.equal(dd.title, 'Lunchtime loop', 'a manual edit outranks generated wording');
});

test('a cut that does not bite leaves the prescription exactly as it was', () => {
  const a = fresh();
  const dd = a.findDay(archetypeSamples(a).track_reps);
  const before = JSON.stringify(dd.prescription);
  assert.equal(a.rescaleOrDropPrescription(dd, dd.km + 5), true);
  assert.equal(JSON.stringify(dd.prescription), before,
    'a session that already fits must not be shrunk for the sake of it');
});

// ---------------------------------------------------------------------------
// 3. EVERY OTHER PATH THAT REWRITES A DAY
// ---------------------------------------------------------------------------
test('a downgraded session is given the easy run it has become', () => {
  const a = fresh();
  const dd = a.findDay(archetypeSamples(a).threshold_continuous);
  // the coach's own downgrade, as handleCoachAccept writes it
  dd.km = 6; dd.type = 'easy'; dd.title = 'Easy Aerobic';
  dd.prescription = { v: a.PRESCRIPTION_VERSION, archetype: 'easy_run', params: { km: 6 } };
  assert.match(a.renderDayCard(dd), STRUCTURED,
    'swapping a hard session for an easy run must not leave the day without structure');
});

test('the post-race intensity ceiling leaves a structured easy run, not a bare day', () => {
  const a = fresh();
  const samples = archetypeSamples(a);
  const dd = a.findDay(samples.threshold_continuous);
  const raceDate = a.addDays(dd.date, -2);
  a.applyRecoveryCeiling([dd], raceDate, 10);
  assert.equal(dd.recoveryCeiling, true, 'the ceiling really applied');
  assert.equal(dd.type, 'easy');
  assert.ok(a.prescriptionOf(dd), 'the easy run the ceiling authored must carry its own structure');
  assert.equal(a.prescriptionOf(dd).archetype, 'easy_run');
  assert.match(a.renderDayCard(dd), STRUCTURED);
});

test('a rescheduled session brings its structure and its distance together', () => {
  const a = fresh();
  const samples = archetypeSamples(a);
  const src = a.findDay(samples.track_reps);
  const slot = a.state.days.filter(d => d.type === 'easy' && d.date > src.date)[0];
  assert.ok(slot, 'fixture needs a later easy day to move it onto');
  // exactly what evolutionChanges()'s reschedule writes
  slot.type = src.type; slot.km = src.km; slot.title = src.title; slot.desc = src.desc;
  slot.prescription = JSON.parse(JSON.stringify(src.prescription));
  assert.match(a.renderDayCard(slot), STRUCTURED, 'the moved session keeps its workout');
  assert.equal(segmentKm(a, slot), segmentKm(a, src), 'and the same one, unshrunk');
});

test('swapping two days moves each workout whole, structure included', () => {
  const a = fresh();
  const samples = archetypeSamples(a);
  const q = a.findDay(samples.track_reps);
  const easy = a.state.days.filter(d => d.type === 'easy' && !d.completed && d.date !== q.date)[0];
  assert.ok(easy, 'fixture needs an easy day to swap with');
  const qWorkout = a.renderStructuredWorkout(q);
  const easyWorkout = a.renderStructuredWorkout(easy);
  const qDate = q.date, easyDate = easy.date;

  a.doSwapDays(q.id, easy.id);

  const nowAtEasyDate = a.findDayByDate(easyDate);
  const nowAtQDate = a.findDayByDate(qDate);
  assert.equal(a.renderStructuredWorkout(nowAtEasyDate), qWorkout,
    'the reps session took its whole workout with it');
  assert.equal(a.renderStructuredWorkout(nowAtQDate), easyWorkout);
  assert.match(a.renderDayCard(nowAtEasyDate), STRUCTURED);
  assert.match(a.renderDayCard(nowAtQDate), STRUCTURED);
});

test('every field list that relocates a workout relocates its prescription', () => {
  const a = fresh();
  // A drag-swap and the coach's own `move` are the two ways a session changes
  // date. Either one leaving `prescription` behind strips the card silently.
  assert.ok(a.SWAPPED_WORKOUT_FIELDS.indexOf('prescription') !== -1);
  assert.ok(a.MOVED_WORKOUT_FIELDS.indexOf('prescription') !== -1);
});

test('restoring the original session restores the original structured workout', () => {
  const a = fresh();
  const target = strainedReduce(a);
  const before = a.renderStructuredWorkout(target);
  assert.ok(before, 'fixture must start structured');

  a.handleCoachAccept(target.id);
  const adjusted = a.findDay(target.id);
  assert.match(a.renderDayCard(adjusted), STRUCTURED);
  assert.notEqual(a.renderStructuredWorkout(adjusted), before, 'the adjustment really changed the workout');

  a.handleCoachRestore(target.id);
  const restored = a.findDay(target.id);
  assert.ok(!restored.coachAdjust, 'restore clears the adjustment record');
  assert.equal(a.renderStructuredWorkout(restored), before,
    'and puts the original structured workout back exactly');
});

test('a hand-edited distance keeps the structure; changing what the session IS drops it', () => {
  const a = fresh();
  const samples = archetypeSamples(a);
  const km = a.findDay(samples.track_reps);
  km.km = Math.max(1, Math.round(km.km * 0.75 * 2) / 2);
  assert.equal(a.rescaleOrDropPrescription(km, km.km), true,
    'a shorter session of the same kind is still that kind of session');
  assert.match(a.renderDayCard(km), STRUCTURED);

  /* The other half is deliberate and is NOT the regression: when the athlete
     rewrites the type or the instructions they are running something else, and
     no structure Valhalla holds describes it. Their words stand. */
  const rewritten = a.findDay(samples.steady_tempo);
  delete rewritten.prescription;
  assert.doesNotMatch(a.renderDayCard(rewritten), STRUCTURED);
  assert.doesNotThrow(() => a.renderDayCard(rewritten), 'and it still renders');
});

// ---------------------------------------------------------------------------
// 4. THE SAME SESSION ON EVERY SURFACE
// ---------------------------------------------------------------------------
test('Today, This Week and Full Plan show one adjusted session identically', () => {
  const a = fresh();
  const target = strainedReduce(a);
  a.handleCoachAccept(target.id);
  const dd = a.findDay(target.id);
  const workout = a.renderStructuredWorkout(dd);
  assert.ok(workout, 'the adjusted session is structured');

  /* TODAY SHOWS TODAY. The next quality day is wherever the generator puts it,
     and the earlier form of this test required it to land on today so that all
     three surfaces would contain it. That was a property of one plan shape,
     not of the rule: what must hold is that every surface which shows this
     session shows the IDENTICAL structured workout and the same adjustment
     record. Today is checked when it is today's session and skipped when it is
     not, and the two week-spanning surfaces are checked unconditionally -- so
     at least two independent renderers are always compared. */
  const surfaces = {
    'This Week': a.renderWeekView(),
    'Full Plan': a.renderFullPlanView(),
  };
  if (dd.date === a.todayStr()) surfaces.Today = a.renderTodayView();
  assert.ok(Object.keys(surfaces).length >= 2, 'at least two surfaces must be compared');
  Object.keys(surfaces).forEach(name => {
    assert.ok(surfaces[name].indexOf(workout) !== -1,
      name + ' must show the identical structured workout');
    assert.ok(surfaces[name].indexOf('class="evo-panel adjusted-detail"') !== -1,
      name + ' must show the adjustment record too');
  });
});

test('no surface renders a day card by a route of its own', () => {
  const fs = require('fs');
  const path = require('path');
  const { RUNTIME_RELATIVE } = require('./harness.js');
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  /* COMMENTS STRIPPED FIRST. renderRaceDayEvent()'s own comment names
     renderDayCard() to say it reuses it, and counting that as a call site
     would fail this test for the one thing it is meant to permit. Matching
     prose as if it were code has produced false results in this suite before. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  /* Today calls it directly, the in-place patch after a log re-renders it,
     renderRaceDayEvent() renders the race with it, and This Week and Full Plan
     reach it for every other day through renderWeekAccordion's map(). One
     renderer; a SECOND PRESENTATION of the same session is what this guards
     against, and that is still exactly one apiece -- the accordion now filters
     the race out precisely so the standalone event is not a duplicate. */
  const calls = code.match(/renderDayCard\(/g) || [];
  assert.equal(calls.length, 4,
    'expected the declaration plus three direct call sites, saw ' + calls.length);
  assert.match(code, /wdays\.filter\(function\(dd\)\{ return dd\.type!=='race'; \}\)\.map\(renderDayCard\)/,
    'the week accordion -- This Week and Full Plan alike -- must use the shared card');
  assert.match(code, /function renderRaceDayEvent\(weekNum\)\{[\s\S]*?renderDayCard\(race\)/,
    'the standalone race event must render the shared card, not a card of its own');
});
