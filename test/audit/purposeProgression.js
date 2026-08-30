'use strict';
/* IS EACH PURPOSE'S RATE OF PROGRESSION DEFENSIBLE?
 * ===========================================================================
 * peak/start is not the question. A block that climbs 50% over eleven weeks
 * and a block that climbs 50% over four weeks are different prescriptions, and
 * comparing purposes at one arbitrary length compares their LENGTHS rather
 * than their methodology. Every purpose is therefore reported twice: at the
 * length the product actually offers for it, and at a common length.
 *
 * The rate reported is the one buildBlockWeeks() itself computes and returns,
 * impliedWeeklyGrowth, so this instrument cannot disagree with the engine.
 *
 * Run with `node test/audit/purposeProgression.js`.
 */
const path = require('path');
const { app, resetState, DISTANCES } = require(path.join(__dirname, 'planAudit.js'));

const A = app();
const KEYS = A.BUILDER_PURPOSE_ORDER.slice();

function row(purpose, weeks, volume){
  const peaks = [], rates = [], bws = [];
  for (const d of DISTANCES){
    resetState();
    const b = A.buildBlockWeeks(d, volume, weeks, { purpose });
    peaks.push(b.peakVolume / volume);
    bws.push(b.buildWeeks);
    /* The rate the block actually implies per DEVELOPING week. buildBlockWeeks
       reports impliedWeeklyGrowth only where it ramps to an explicit
       destination, so for the multiplier purposes it is computed here from the
       block's own peak, start and buildWeeks -- the same expression. */
    if (b.buildWeeks > 1 && volume > 0)
      rates.push(Math.pow(b.peakVolume / volume, 1 / (b.buildWeeks - 1)));
  }
  const mean = xs => xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null;
  return { peak: mean(peaks), rate: mean(rates), bw: mean(bws),
           peakLo: Math.min(...peaks), peakHi: Math.max(...peaks),
           rateLo: rates.length ? Math.min(...rates) : null,
           rateHi: rates.length ? Math.max(...rates) : null };
}

function table(title, weeksFor, volume){
  console.log('\n' + title + '   (start = %dkm/week, mean over the five race distances)', volume);
  console.log('  ' + 'purpose'.padEnd(10) + 'weeks'.padStart(7) + 'build wks'.padStart(11) +
              'peak/start'.padStart(12) + '  (range)'.padEnd(18) +
              'per developing week'.padStart(21) + '  (range)');
  KEYS.forEach(k => {
    const w = weeksFor(k);
    const r = row(k, w, volume);
    console.log('  ' + k.padEnd(10) + String(w).padStart(7) + String(r.bw).padStart(11) +
      r.peak.toFixed(3).padStart(12) + ('  ' + r.peakLo.toFixed(2) + '-' + r.peakHi.toFixed(2)).padEnd(18) +
      (r.rate != null ? ((r.rate - 1) * 100).toFixed(1) + '%' : 'flat').padStart(21) +
      (r.rateLo != null ? ('  ' + ((r.rateLo - 1) * 100).toFixed(1) + '-' + ((r.rateHi - 1) * 100).toFixed(1) + '%') : ''));
  });
}

console.log('THE PRODUCT\'S OWN DEFAULT LENGTH FOR EACH PURPOSE');
KEYS.forEach(k => console.log('  %s  %d weeks', k.padEnd(10),
  A.BUILDER_PURPOSE_META[k].defaultWeeks));

table('AT EACH PURPOSE\'S OWN DEFAULT LENGTH', k => A.BUILDER_PURPOSE_META[k].defaultWeeks, 45);
table('AT A COMMON TWELVE WEEKS', () => 12, 45);
table('AT A COMMON TWELVE WEEKS, low volume', () => 12, 26);

console.log('\nWHY THE LENGTHS DIFFER, from blockArcFor():');
KEYS.forEach(k => {
  const w = A.BUILDER_PURPOSE_META[k].defaultWeeks;
  const arc = A.blockArcFor(k, w);
  console.log('  %s  %d weeks -> %d developing, %d taper, goal effort %s, checkpoint %s',
    k.padEnd(10), w, arc.buildWeeks, arc.taper, !!arc.hasGoalEffort, !!arc.hasCheckpoint);
});
console.log('\n  D-7: a block that develops for fewer weeks receives a proportionally');
console.log('  smaller share of its distance multiplier (developmentMultiplierFor), so a');
console.log('  short block does not compress a long block\'s climb into less time.');
