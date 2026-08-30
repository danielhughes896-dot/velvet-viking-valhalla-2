'use strict';
/* WHAT A SESSION ACTUALLY COSTS, DERIVED FROM ITS OWN COMPOSITION.
 * ===========================================================================
 * coachDayLoad() prices a day as km x a factor, and the factor comes from
 * dd.type -- the UI taxonomy. For nineteen of twenty archetypes the type is a
 * fair statement of intent. For two it is not, and ARCHETYPES[...].exec exists
 * precisely so those two can declare their own.
 *
 * This recomputes both declared figures from the delivered population, using
 * only COACH_LOAD_FACTOR and the app's own segment walker: each segment's
 * kilometres at the factor its intensity's zone bucket already carries, with
 * the unnumbered warm-up and cool-down attributed to easy running the way
 * structuredZoneTime() attributes them.
 *
 * It exists so that neither declared number can quietly become a figure
 * somebody chose.
 *
 * Run with `node test/audit/loadFactorDerivation.js`.
 */
const path = require('path');
const { app, SCHEDULES, DISTANCES } = require(path.join(__dirname, 'planAudit.js'));
const { buildPlan } = require(path.join(__dirname, '..', 'fixtures.js'));

const A = app();
A.renderApp = () => {}; A.flushSave = () => {}; A.scheduleSave = () => {}; A.showToast = () => {};

const F = A.COACH_LOAD_FACTOR, BUCKET = A.INTENSITY_ZONE_BUCKET;
/* segmentZoneTime()'s buckets and COACH_LOAD_FACTOR's keys are the same four
   ideas under two names; this is the only place they meet. */
const BUCKET_TYPE = { easy: 'easy', threshold: 'threshold', interval: 'interval', mp: 'tempo' };

function derivedFactor(dd){
  let segs;
  try { segs = A.orderedSegments(A.prescriptionOf(dd)); } catch (e){ return null; }
  if (!segs) return null;
  const mix = A.segmentDistanceMix(segs);
  let num = 0, den = 0;
  Object.keys(mix.byIntensity).forEach(i => {
    const km = mix.byIntensity[i];
    num += km * F[BUCKET_TYPE[BUCKET[i] || 'easy'] || 'easy'];
    den += km;
  });
  const rest = Math.max(0, (dd.km || 0) - den);
  num += rest * F.easy; den += rest;
  return den > 0 ? num / den : null;
}

function scan(){
  const by = {};
  for (const dist of DISTANCES)
    for (const vol of [30, 45, 60, 80])
      for (const wk of [10, 14, 20])
        for (const sk of ['d3', 'd5']){
          buildPlan(A, { distanceKey: dist, volume: vol, weeks: wk,
                         startDate: A.todayStr(), schedule: SCHEDULES[sk] });
          const start = A.todayStr();
          const end = A.addDays(A.addDays(start, -A.isoWeekday(start)), wk * 7 - 1);
          let blk, days;
          try { blk = A.buildBlockWeeks(dist, vol, wk, { purpose: 'race' });
                days = A.buildDaysFromWeeks(blk, end, SCHEDULES[sk], start, false); }
          catch (e){ continue; }
          days.forEach(d => {
            if (!(d.km > 0) || !d.prescription) return;
            const f = derivedFactor(d);
            if (f == null) return;
            (by[d.prescription.archetype] = by[d.prescription.archetype] || []).push(f);
          });
        }
  return by;
}

const q = (xs, p) => { const s = xs.slice().sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
const by = scan();

console.log('COACH_LOAD_FACTOR by type: %s', JSON.stringify(F));
console.log('');
console.log('archetype             type says   declares   derives (median)   min     max      n');
Object.keys(by).sort().forEach(k => {
  const v = by[k];
  const meta = A.ARCHETYPES[k] || {};
  const declared = (meta.exec && meta.exec.load != null) ? meta.exec.load : null;
  /* What the broad type would charge, for comparison. */
  const sample = { type: null };
  console.log('  %s %s %s %s %s %s %s',
    k.padEnd(20),
    ''.padEnd(10),
    String(declared == null ? '-' : declared).padStart(8),
    q(v, 0.5).toFixed(3).padStart(17),
    q(v, 0).toFixed(3).padStart(7),
    q(v, 1).toFixed(3).padStart(7),
    String(v.length).padStart(6));
});

console.log('');
console.log('THE TWO DECLARED FIGURES, AGAINST THEIR OWN DERIVATION');
[['easy_strides', 1.05], ['hill_repeats', 1.08]].forEach(([k, declared]) => {
  const v = by[k] || [];
  if (!v.length){ console.log('  %s: not delivered in this population', k); return; }
  const med = q(v, 0.5);
  console.log('  %s  declared %s   derived %s   difference %s%%   %s',
    k.padEnd(14), declared.toFixed(2), med.toFixed(3),
    (100 * Math.abs(med - declared) / declared).toFixed(1),
    Math.abs(med - declared) / declared <= 0.05 ? 'within 5%' : 'OUT OF LINE');
  console.log('     the broad type would have charged %s, which is %s%% above what the ' +
              'session is made of',
    F.interval.toFixed(2), (100 * (F.interval - med) / med).toFixed(0));
});
console.log('');
console.log('  Every other archetype keeps its type factor and is listed only so a future');
console.log('  change that pushes one of them far from its own composition is visible.');
