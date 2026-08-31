'use strict';
/* CROSS-DISTANCE INVARIANCE, BY OUTPUT HASH. READ-ONLY.
 * ===========================================================================
 * A marathon-only change has to be provable, not asserted. This builds 168
 * plans per distance -- fourteen starting volumes x six block lengths x two
 * schedules -- and hashes every week's phase, volume and long-run target
 * together with every day's week, type, distance and title. Two runtimes that
 * agree on this hash cannot differ in anything a runner sees.
 *
 *   node test/audit/crossDistanceHash.js
 *
 * Compare against the same command run in a worktree at main. Where only the
 * `full` line differs, no other distance moved.
 */
const crypto = require('crypto');
const path = require('path');
const { loadApp } = require(path.join(__dirname, '..', 'harness.js'));

const TODAY = '2026-08-30';
const DAYSETS = { d3: [1, 3, 6], d5: [0, 1, 3, 4, 6] };
const VOLUMES = [6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 70, 80, 100];
const WEEKS = [4, 8, 12, 16, 20, 24];
const SCHEDULES = ['d3', 'd5'];

function hashDistance(distKey){
  const lines = [];
  VOLUMES.forEach(v => WEEKS.forEach(n => SCHEDULES.forEach(sk => {
    const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
    a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {}; a.showToast = () => {};
    a.state = a.makeDefaultState();
    let blk, ds;
    try {
      blk = a.buildBlockWeeks(distKey, v, n, { purpose: 'race' });
      const end = a.addDays(a.addDays(TODAY, -a.isoWeekday(TODAY)), blk.planWeeks * 7 - 1);
      ds = a.buildDaysFromWeeks(blk, end, { activeDays: DAYSETS[sk], longRunDay: 6 }, TODAY, true, {});
    } catch (e){ lines.push([distKey, v, n, sk, 'ERR:' + e.message].join('|')); return; }
    lines.push([distKey, v, n, sk, 'PW' + blk.planWeeks,
      blk.weeks.map(w => w.week + ':' + w.phase + ':' + w.volume + ':' + w.longTarget).join(','),
      ds.map(d => d.week + ':' + d.type + ':' + d.km + ':' + (d.title || '')).join(',')].join('|'));
  })));
  return { n: lines.length,
           hash: crypto.createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16) };
}

if (require.main === module){
  console.log('distance  plans  output hash');
  ['5k', '10k', 'half', 'full', 'ultra'].forEach(dk => {
    const r = hashDistance(dk);
    console.log(dk.padEnd(10) + String(r.n).padStart(5) + '  ' + r.hash);
  });
}
module.exports = { hashDistance, VOLUMES, WEEKS, SCHEDULES };
