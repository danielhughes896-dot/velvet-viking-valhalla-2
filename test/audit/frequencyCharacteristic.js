'use strict';
/* THE RESPONSE CHARACTERISTIC OF demonstratedRunningFrequency().
 * ===========================================================================
 * The statistic is the third-highest running-day count in the last
 * DEMONSTRATED_WINDOW_WEEKS weeks -- the same robust reading the volume side
 * uses. That choice buys immunity to a bad week, and it is not free: it is
 * asymmetric in time, and this measures the asymmetry rather than asserting
 * it. Run with `node test/audit/frequencyCharacteristic.js`.
 */
const path = require('path');
const { loadApp } = require(path.join(__dirname, '..', 'harness.js'));
const TODAY = '2026-08-31';                       // a Monday
function app(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.renderApp=()=>{}; a.flushSave=()=>{}; a.scheduleSave=()=>{};
  return a;
}
/* Build `weeks` weeks of completed history ending last week, where week i
   (0 = oldest) ran runsPerWeek(i) days. Written into athlete sessions, which
   is where archived training lives. */
function history(a, weeks, runsPerWeek){
  const sess = [];
  for (let i = 0; i < weeks; i++){
    const monday = a.addDays(TODAY, -7 * (weeks - i));
    const n = runsPerWeek(i);
    for (let d = 0; d < n; d++)
      sess.push({ date: a.addDays(monday, d), completed: true, actualKm: 8, plannedKm: 8 });
  }
  a.state.athlete = a.state.athlete || {};
  a.state.athlete.sessions = sess;
  a.state.days = [];
  return a;
}
function freq(weeks, fn){ const a = app(); history(a, weeks, fn); return a.demonstratedRunningFrequency(); }

console.log('WINDOW  DEMONSTRATED_WINDOW_WEEKS =', app().DEMONSTRATED_WINDOW_WEEKS,
            ' SUSTAINED_WEEKS_REQUIRED =', app().SUSTAINED_WEEKS_REQUIRED);
console.log('');
console.log('A. RECOGNISING AN INCREASE  (established 3-day athlete moves to 5)');
for (const k of [0,1,2,3,4,6,10])
  console.log('   after %s week(s) at 5: %s', String(k).padStart(2),
    freq(52, i => (i >= 52 - k ? 5 : 3)));
console.log('');
console.log('B. RECOGNISING A REDUCTION  (established 5-day athlete moves to 3)');
for (const k of [0,3,10,26,40,45,48,49,50,51,52])
  console.log('   after %s week(s) at 3: %s', String(k).padStart(2),
    freq(52, i => (i >= 52 - k ? 3 : 5)));
console.log('');
console.log('C. THE EXACT CROSSING');
let firstDrop = null;
for (let k = 0; k <= 60 && firstDrop === null; k++)
  if (freq(52, i => (i >= 52 - k ? 3 : 5)) < 5) firstDrop = k;
console.log('   the statistic first falls below 5 after', firstDrop, 'weeks at 3');
let settled = null;
for (let k = 0; k <= 60 && settled === null; k++)
  if (freq(52, i => (i >= 52 - k ? 3 : 5)) === 3) settled = k;
console.log('   the statistic reaches 3 after', settled, 'weeks at 3');
console.log('');
console.log('D. NOISE REJECTION  (established 5-day athlete, isolated lapses)');
console.log('   one 4-run week      :', freq(52, i => (i === 51 ? 4 : 5)));
console.log('   one 0-run week      :', freq(52, i => (i === 51 ? 0 : 5)));
console.log('   two 4-run weeks     :', freq(52, i => (i >= 50 ? 4 : 5)));
console.log('   three 4-run weeks   :', freq(52, i => (i >= 49 ? 4 : 5)));
console.log('   a fortnight off     :', freq(52, i => (i >= 50 ? 0 : 5)));
console.log('   an injury month off :', freq(52, i => (i >= 48 ? 0 : 5)));
console.log('');
console.log('E. TOO LITTLE EVIDENCE  (null means: the athlete keeps their stated availability)');
for (const w of [0,1,2,3,4])
  console.log('   %s week(s) of history: %s', w, freq(w, () => 5));
console.log('');
console.log('F. A NEW ATHLETE BUILDING UP  (3,3,4,4,5,5,5 over seven weeks)');
const ramp = [3,3,4,4,5,5,5];
for (let w = 1; w <= 7; w++)
  console.log('   after week %s (%s): %s', w, ramp.slice(0,w).join(','),
    freq(w, i => ramp[i]));

console.log('');
console.log('WHAT THIS MEANS, AND IT IS NOT SYMMETRICAL');
console.log('  An INCREASE is recognised in SUSTAINED_WEEKS_REQUIRED weeks -- three. The');
console.log('  third-highest of the window rises as soon as three weeks in it are high.');
console.log('  A REDUCTION is recognised only once fewer than three weeks in the whole');
console.log('  window are still high, which for a full year of history is fifty weeks.');
console.log('  So within a training year the statistic ratchets up quickly and does not');
console.log('  come down. That is exactly what makes it safe as a CEILING -- it can never');
console.log('  take capacity away from an athlete on the strength of a bad patch -- and it');
console.log('  is exactly why it must not be read as a statement that the athlete is');
console.log('  currently training that often. It is not corrected here: reacting faster');
console.log('  means abandoning the robustness the ceiling is built on, and which of the');
console.log('  two matters more is a coaching decision, not an arithmetic one.');
