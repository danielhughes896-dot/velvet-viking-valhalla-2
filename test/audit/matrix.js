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
const WEEKS = [4, 8, 12, 16, 24];      // min, common, max supported
const SCHEDULES = ['d3', 'd5'];        // fewest and a typical week

function runMatrix(){
  const tally = {};        // code -> count
  const cases = [];        // ids only, so this stays small
  let plans = 0, weeks = 0, sessions = 0;
  for (const distanceKey of DISTANCES)
    for (const volume of VOLUMES)
      for (const w of WEEKS)
        for (const scheduleKey of SCHEDULES){
          const c = auditCase({ distanceKey, volume, weeks: w, scheduleKey });
          plans++;
          if (!c.error){ weeks += c.weeks.length; sessions += c.sessions.length; }
          cases.push(c.id);
          checkCase(c).forEach(f => { tally[f.code] = (tally[f.code] || 0) + 1; });
        }
  return { tally, plans, weeks, sessions, caseCount: cases.length };
}

module.exports = { runMatrix, VOLUMES, WEEKS, SCHEDULES, DISTANCES };
