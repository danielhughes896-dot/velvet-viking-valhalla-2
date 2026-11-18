'use strict';
/* THE MATRIX THE REGRESSION SUITE RUNS.
 * ===========================================================================
 * A deterministic subset of the full sweep -- same generator, same checks,
 * sized to run inside the ordinary test suite rather than as a separate job.
 * The full sweep (test/audit/sweep.js) covers every integer volume 1-120 at
 * every supported block length and day count; this covers every integer volume
 * to 40, where the low-volume defects live, then samples upward.
 *
 * Exported rather than inlined so the sweep, the tests and any future report
 * ask the same question of the same inputs.
 */
const { auditCase, DISTANCES } = require('./planAudit.js');
const { checkCase } = require('./invariants.js');

const VOLUMES = (function(){
  const v = [];
  for (let i = 1; i <= 40; i++) v.push(i);            // dense where it breaks
  [45, 50, 60, 70, 80, 100, 120].forEach(x => v.push(x));
  return v;
})();
/* HQ ADMITS RACE GOAL FROM TEN WEEKS TO FIFTEEN, so the sweep has to walk that
   window or it measures the Half and the Marathon almost nowhere: of the five
   runways this list used to carry, only twelve weeks sits inside it. Ten and
   fifteen are added -- the two ends of the admitted window -- and the original
   five are kept so every other distance, every other product and the refusal
   and handoff paths are still measured exactly as they were. */
const WEEKS = [4, 8, 10, 12, 15, 16, 24];
const SCHEDULES = ['d3', 'd5'];        // the ratchet population: unchanged
/* A5 (founder, 15 November 2026) opened the builder to one to seven running
   days. The ratchet population above is left exactly as it was, so every
   baseline count still compares like with like; the new ends of the range are
   measured by their own sweep (runEdgeMatrix) against flat invariants. */
const EDGE_SCHEDULES = ['d1', 'd2', 'd7'];

/* POPULATION ACCOUNTING. From S3 the race generator no longer owns every case
   in the matrix, and a count that falls because cases LEFT the population is a
   different fact from a count that falls because the defect was fixed.
   Everything is therefore tallied three ways over the same, unchanged input
   list: the whole population, the cases that remain race programmes, and the
   cases routed elsewhere. `tally` stays the whole population so the ratchet
   compares like with like across every stage. */
function runMatrix(){
  const tally = {}, tallyRace = {}, tallyRouted = {};
  let plans = 0, weeks = 0, sessions = 0, racePlans = 0, routedPlans = 0;
  for (const distanceKey of DISTANCES)
    for (const volume of VOLUMES)
      for (const w of WEEKS)
        for (const scheduleKey of SCHEDULES){
          const c = auditCase({ distanceKey, volume, weeks: w, scheduleKey });
          plans++;
          if (c.routed) routedPlans++; else racePlans++;
          if (!c.error){ weeks += c.weeks.length; sessions += c.sessions.length; }
          const into = c.routed ? tallyRouted : tallyRace;
          checkCase(c).forEach(f => {
            tally[f.code] = (tally[f.code] || 0) + 1;
            into[f.code] = (into[f.code] || 0) + 1;
          });
        }
  return { tally, tallyRace, tallyRouted, plans, weeks, sessions,
           racePlans, routedPlans, caseCount: plans };
}

/* The edge sweep: every distance and block length, every other volume, at the
   one, two and seven day schedules. Returns the tally and every run under the
   5km minimum that is not a race-week shakeout or a quality session. */
function runEdgeMatrix(){
  const tally = {}, shortRuns = [];
  let plans = 0;
  for (const distanceKey of DISTANCES)
    for (const volume of VOLUMES.filter((v, i) => i % 2 === 0))
      for (const w of WEEKS)
        for (const scheduleKey of EDGE_SCHEDULES){
          const c = auditCase({ distanceKey, volume, weeks: w, scheduleKey });
          plans++;
          checkCase(c).forEach(f => { tally[f.code] = (tally[f.code] || 0) + 1; });
          (c.sessions || []).forEach(s => {
            if (s.km > 0 && s.km < 5 && (s.type === 'easy' || s.type === 'long') &&
                !/Shakeout/.test(s.title || ''))
              shortRuns.push({ id: c.id, routed: !!c.routed, week: s.week, type: s.type, km: s.km, volume });
          });
        }
  return { tally, shortRuns, plans };
}

module.exports = { runMatrix, runEdgeMatrix, VOLUMES, WEEKS, SCHEDULES, EDGE_SCHEDULES, DISTANCES };
