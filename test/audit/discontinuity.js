'use strict';
/* CONTINUITY ACROSS ADJACENT STATED VOLUMES.
 * ===========================================================================
 * The question is not whether a plan is bigger when the athlete says they run
 * more -- it is whether ONE extra kilometre a week can change the plan by more
 * than one extra kilometre a week is worth. Where it does, the report names
 * the rule responsible if there is one, and says "unattributed" if there is
 * not: an unattributed discontinuity is a rounding artefact wearing a
 * threshold's clothes.
 *
 * Compared for every adjacent pair v, v+1, at every distance / length /
 * schedule: total prescribed distance, week-one size, peak week, the largest
 * long run, the number of active sessions, and the number of quality days.
 */

const fs = require('fs');
const path = require('path');
const { auditCase, DISTANCES } = require('./planAudit.js');

const MAX_VOLUME = 120;
const WEEKS = [4, 8, 12, 16, 20, 24];
const SCHEDULES = ['d3', 'd4', 'd5', 'd6'];

/* A one-km step is worth about one km a week, so the plan-total step it
   justifies is roughly weeks x 1km, plus rounding. Anything past this
   multiple of that is a jump rather than a slope. */
const JUMP_FACTOR = 4;

function summarise(c){
  const nonRace = c.weeks.filter(w => !w.isRace);
  const longs = c.sessions.filter(s => s.type === 'long' && s.km > 0).map(s => s.km);
  const quality = c.sessions.filter(s => s.km > 0 &&
    ['tempo','threshold','interval','repetition','checkpoint'].indexOf(s.type) !== -1);
  return {
    totalKm: Math.round(c.sessions.reduce((t, s) => t + (s.km || 0), 0) * 10) / 10,
    weekOne: nonRace.length ? nonRace[0].actualVolume : 0,
    peakWeek: nonRace.length ? Math.max(...nonRace.map(w => w.actualVolume)) : 0,
    maxLong: longs.length ? Math.max(...longs) : 0,
    minLong: longs.length ? Math.min(...longs) : 0,
    activeSessions: c.sessions.filter(s => s.km > 0).length,
    qualitySessions: quality.length,
    goalFinishWeeks: c.sessions.filter(s => s.archetype === 'long_run_goal_finish').length,
    zeroLongRuns: c.sessions.filter(s => s.type === 'long' && !(s.km > 0)).length
  };
}

/* The named gates the engine actually has, so a step can be attributed rather
   than merely noticed. Each returns a rule name when the pair straddles it. */
function attribute(a, b, ctx){
  const names = [];
  const prof = ctx.profile;
  const longFrac = { speed: 0.24, threshold: 0.28, endurance: 0.32, timeonfeet: 0.36 }[prof.emphasis];
  // profile.longCapKm -- the long run stops growing
  const lc = prof.longCapKm;
  if (a.maxLong < lc && b.maxLong >= lc) names.push('profile.longCapKm reached');
  // the goal-pace floor: clamp(..., 3, longTarget*0.5) binds while longTarget < 6
  if (a.goalFinishWeeks !== b.goalFinishWeeks) names.push('hasGoalSegment / goalSegKm floor');
  // EASY_MIN_KM = 3 stops binding once the easy budget clears the floor
  if (a.zeroLongRuns !== b.zeroLongRuns) names.push('roundWorkoutKm long-run rounding to whole km');
  if (a.qualitySessions !== b.qualitySessions) names.push('quality structure shrink floors');
  return names;
}

function run(){
  const out = { meta: { generatedAt: new Date().toISOString(), maxVolume: MAX_VOLUME,
                        weeks: WEEKS, schedules: SCHEDULES, jumpFactor: JUMP_FACTOR },
                pairs: 0, jumps: [], reversals: [], structural: [], byRule: {} };
  for (const distanceKey of DISTANCES)
    for (const weeks of WEEKS)
      for (const scheduleKey of SCHEDULES){
        let prev = null, prevCase = null;
        for (let v = 1; v <= MAX_VOLUME; v++){
          const c = auditCase({ distanceKey, volume: v, weeks, scheduleKey });
          const s = summarise(c);
          if (prev){
            out.pairs++;
            const budget = weeks * JUMP_FACTOR;
            const dTotal = s.totalKm - prev.totalKm;
            const rules = attribute(prev, s, { profile: c.profile });
            const key = distanceKey + '|' + weeks + 'w|' + scheduleKey;
            /* A REVERSAL is the serious one: more stated volume, less plan. */
            if (dTotal < -0.05)
              out.reversals.push({ case: key, from: v - 1, to: v, dTotalKm: r1(dTotal),
                                   fromTotal: prev.totalKm, toTotal: s.totalKm, rules });
            else if (dTotal > budget)
              out.jumps.push({ case: key, from: v - 1, to: v, dTotalKm: r1(dTotal),
                               fromTotal: prev.totalKm, toTotal: s.totalKm, budget, rules });
            /* STRUCTURAL steps: the SHAPE of the plan changed, not its size. */
            if (prev.qualitySessions !== s.qualitySessions ||
                prev.goalFinishWeeks !== s.goalFinishWeeks ||
                prev.zeroLongRuns !== s.zeroLongRuns)
              out.structural.push({ case: key, from: v - 1, to: v,
                qualitySessions: [prev.qualitySessions, s.qualitySessions],
                goalFinishWeeks: [prev.goalFinishWeeks, s.goalFinishWeeks],
                zeroLongRuns: [prev.zeroLongRuns, s.zeroLongRuns], rules });
            rules.forEach(r => out.byRule[r] = (out.byRule[r] || 0) + 1);
          }
          prev = s; prevCase = c;
        }
      }
  return out;
}
function r1(n){ return Math.round(n * 10) / 10; }

if (require.main === module){
  const t = Date.now();
  const o = run();
  o.meta.runtimeMs = Date.now() - t;
  const dest = path.join(__dirname, 'out', 'discontinuity.json');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(o, null, 2));
  console.log('adjacent pairs compared: ' + o.pairs);
  console.log('REVERSALS  (more stated volume, smaller plan): ' + o.reversals.length);
  console.log('JUMPS      (step > ' + JUMP_FACTOR + 'km/week of plan): ' + o.jumps.length);
  console.log('STRUCTURAL (plan shape changed): ' + o.structural.length);
  console.log('attributions:', JSON.stringify(o.byRule, null, 2));
  console.log('\nfirst reversals:');
  o.reversals.slice(0, 10).forEach(x => console.log('   ', JSON.stringify(x)));
  console.log('\nfirst jumps:');
  o.jumps.slice(0, 6).forEach(x => console.log('   ', JSON.stringify(x)));
  console.log('\nwritten to ' + dest);
}
module.exports = { run };
