'use strict';
/* PLAN MATHEMATICS AUDIT — the measurement layer.
 * ===========================================================================
 * AUDIT TOOLING, NOT PRODUCTION. Nothing here is loaded by the app, ships to
 * an athlete, or is reachable from the runtime. It drives the engine's own
 * exported functions -- buildBlockWeeks() and buildDaysFromWeeks(), the exact
 * pair handleGeneratePlan() calls -- and measures what comes back.
 *
 * IT ASSERTS NOTHING AND CHANGES NOTHING. It reports. The invariants live in
 * test/planMathematicsInvariants.test.js and read the structures this
 * produces, so the measurement and the judgement are separable: a finding can
 * be re-measured without re-deciding what counts as a fault.
 */

const path = require('path');
const { loadApp } = require('../harness.js');

const AUDIT_DATE = '2026-03-02T09:00:00Z';   // a Monday, so week buckets align

/* One app instance serves the whole sweep. buildBlockWeeks() reads two pieces
   of athlete state -- demonstratedSustainableVolume() and blockRotationFor()
   -- and both answer null/0 against a default state, which is the correct
   answer for a FIRST block and is what the builder actually produces for a new
   athlete. resetState() restores that before every case so no plan can leak
   into the next one. */
let _app = null;
function app(){
  if (!_app) _app = loadApp({ pinnedDate: AUDIT_DATE });
  return _app;
}
function resetState(){
  const a = app();
  a.state = a.makeDefaultState();
  return a;
}

const DISTANCES = ['5k', '10k', 'half', 'full', 'ultra'];

/* The schedules a real athlete can actually choose: BUILDER_SPEC.validation
   .daysRange is [3,6], and the long run day must be one of the chosen days. */
const SCHEDULES = {
  d3: { activeDays: [1, 3, 6], longRunDay: 6 },              // Tue/Thu/Sun
  d4: { activeDays: [1, 3, 5, 6], longRunDay: 6 },           // Tue/Thu/Sat/Sun
  d5: { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 },        // Tue/Wed/Thu/Sat/Sun
  d6: { activeDays: [0, 1, 2, 3, 5, 6], longRunDay: 6 }
};

/* A benchmark that is coherent for the athlete being described, rather than
   one number reused across a 1km/week novice and a 100km/week athlete. The
   engine derives paces from it, so an incoherent benchmark would make every
   pace observation meaningless -- though note it does NOT feed volume: no
   distance or session size below depends on this. */
function benchmarkFor(kind, appRef){
  const c = appRef.clockToSec.bind(appRef);
  if (kind === 'none') return null;
  if (kind === 'slow')   return c('0:60:00');   // 10K in 60:00
  if (kind === 'mid')    return c('0:45:00');
  if (kind === 'fast')   return c('0:35:00');
  return c('0:45:00');
}

/* The generated plan, plus every measurement the audit questions need.
   Deliberately a plain data structure: the sweep writes it to disk, the
   invariant tests read it back, and neither needs the app loaded. */
function auditCase(opts){
  const a = resetState();
  const distanceKey = opts.distanceKey;
  const volume = opts.volume;
  const weeks = opts.weeks;
  const schedule = SCHEDULES[opts.scheduleKey] || SCHEDULES.d5;
  const purpose = opts.purpose || 'race';

  const startDate = a.todayStr();
  const startMonday = a.addDays(startDate, -a.isoWeekday(startDate));
  const raceDate = a.addDays(startMonday, weeks * 7 - 1);

  let blockResult, days, error = null;
  try {
    blockResult = a.buildBlockWeeks(distanceKey, volume, weeks, { purpose: purpose });
    days = a.buildDaysFromWeeks(blockResult, raceDate, schedule, startDate, false);
  } catch (e){
    return { id: caseId(opts), inputs: opts, error: String(e && e.message || e) };
  }

  const profile = a.DISTANCE_PROFILES[distanceKey];
  const notes = (a.planBuildNotes || []).slice();
  const accounting = (a.planVolumeAccounting || []).slice();
  const invariantFailures = (a.planInvariantFailures || []).slice();

  /* Every day, with its structure resolved the same way a card resolves it:
     segmentsFor() from the stored prescription, which is what the athlete
     actually reads underneath the title. */
  const sessions = days.map(dd => {
    const p = dd.prescription || null;
    let segs = null, segKmTotal = null, segErr = null;
    if (p){
      try {
        segs = a.segmentsFor(p) || null;
      } catch (e){ segErr = String(e && e.message || e); }
    }
    if (segs){
      const withKm = segs.filter(s => s.km != null);
      segKmTotal = withKm.length ? round1(withKm.reduce((t, s) => t + s.km, 0)) : null;
    }
    return {
      date: dd.date, week: dd.week, type: dd.type, title: dd.title,
      km: dd.km,
      archetype: p ? p.archetype : null,
      params: p ? p.params : null,
      segments: segs ? segs.map(s => ({
        kind: s.kind, intensity: s.intensity,
        km: s.km != null ? s.km : null, m: s.m != null ? s.m : null,
        sec: s.sec != null ? s.sec : null, reps: s.reps != null ? s.reps : null
      })) : null,
      segKmTotal: segKmTotal,
      segErr: segErr,
      desc: dd.desc
    };
  });

  /* Weekly roll-up, computed from the days themselves rather than from the
     generator's intent, so the two can be compared. */
  const byWeek = {};
  blockResult.weeks.forEach(wk => {
    byWeek[wk.week] = {
      week: wk.week, phase: wk.phase,
      isCutback: !!wk.isCutback, isTaper: !!wk.isTaper, isRace: !!wk.isRace,
      isCheckpoint: !!wk.isCheckpoint, isCalibration: !!wk.isCalibration,
      targetVolume: wk.volume,
      longTarget: wk.longTarget, goalSegKm: wk.goalSegKm,
      hasGoalSegment: !!wk.hasGoalSegment,
      qKm: wk.qKm, tKm: wk.tKm,
      accounting: accounting.filter(x => x.week === wk.week)[0] || null,
      sessions: [], actualVolume: 0,
      easyKm: 0, longKm: 0, qualityKm: 0, raceKm: 0, restDays: 0, runDays: 0
    };
  });
  sessions.forEach(s => {
    const w = byWeek[s.week];
    if (!w) return;
    w.sessions.push(s);
    w.actualVolume = round1(w.actualVolume + (s.km || 0));
    if (s.km > 0) w.runDays++;
    if (s.type === 'rest') w.restDays++;
    if (s.type === 'long') w.longKm = round1(w.longKm + s.km);
    else if (s.type === 'easy') w.easyKm = round1(w.easyKm + s.km);
    else if (s.type === 'race') w.raceKm = round1(w.raceKm + s.km);
    else if (s.km > 0) w.qualityKm = round1(w.qualityKm + s.km);
  });

  const weekList = Object.keys(byWeek).map(k => byWeek[k])
    .sort((x, y) => x.week - y.week);
  weekList.forEach((w, i) => {
    w.volumeDelta = i === 0 ? null : round1(w.actualVolume - weekList[i - 1].actualVolume);
    w.volumeGrowth = (i === 0 || weekList[i - 1].actualVolume === 0) ? null
      : round2(w.actualVolume / weekList[i - 1].actualVolume);
    w.longDelta = i === 0 ? null : round1(w.longKm - weekList[i - 1].longKm);
    w.longFraction = w.actualVolume > 0 ? round2(w.longKm / w.actualVolume) : null;
    w.qualityFraction = w.actualVolume > 0 ? round2(w.qualityKm / w.actualVolume) : null;
    w.volumeMiss = round1(w.actualVolume - w.targetVolume);
  });

  return {
    id: caseId(opts),
    inputs: { distanceKey, volume, weeks, scheduleKey: opts.scheduleKey || 'd5',
              purpose, benchmarkKind: opts.benchmarkKind || 'none',
              experience: opts.experience || 'experienced' },
    profile: { raceKm: profile.raceKm, longCapKm: profile.longCapKm,
               volMult: profile.volMult, emphasis: profile.emphasis },
    peakVolume: blockResult.peakVolume,
    buildWeeks: blockResult.buildWeeks,
    taperWeeks: blockResult.taperWeeks,
    planWeeks: blockResult.planWeeks,
    weeks: weekList,
    sessions: sessions,
    buildNotes: notes,
    accounting: accounting,
    invariantFailures: invariantFailures
  };
}

function caseId(o){
  return [o.distanceKey, o.volume, o.weeks + 'w', o.scheduleKey || 'd5',
          o.purpose || 'race'].join('|');
}

function round1(n){ return Math.round(n * 10) / 10; }
function round2(n){ return Math.round(n * 100) / 100; }

module.exports = { auditCase, DISTANCES, SCHEDULES, AUDIT_DATE, app, resetState,
                   benchmarkFor, round1, round2 };
