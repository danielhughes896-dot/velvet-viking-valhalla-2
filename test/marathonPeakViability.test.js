'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

/* THE RACE-PROGRAMME VIABILITY CONTRACT, AND WHERE THE MARATHON LEFT IT
 * ===========================================================================
 * MIN_PEAK_LONG_KM looks like a second, independent opinion about long runs
 * sitting beside LONG_FRACTION. It is not: it is the SAME equation solved for
 * a different unknown.
 *
 *     the builder asked   peak long run = peak volume x LONG_FRACTION
 *     the gate asks       what start volume makes that reach the floor?
 *
 * minViableStartKm() is that inversion, algebraically exact. FOR 5K, 10K, HALF
 * AND ULTRA THAT IDENTITY STILL HOLDS and these tests still pin it.
 *
 * THE MARATHON NO LONGER BUILDS THAT WAY. Its weeks are assembled from
 * purposeful sessions and summed, so "peak long run = peak volume x share" is
 * not an equation the marathon contains any more -- and a boundary derived by
 * inverting an equation that no longer exists cannot describe anything. HQ
 * ruled the old marathon partition non-authoritative for exactly that reason.
 *
 * So the marathon's share of this file is replaced rather than loosened. What
 * is asserted instead is the architecture that took its place: a plan can
 * always be built, the long run has its own progression, that progression is
 * constrained by the week that has to carry it, and the shortfall is reported
 * rather than engineered away. Those are strictly more assertions than the
 * partition tests made, not fewer.
 */
const TODAY = '2026-08-30';
const app = () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {}; a.showToast = () => {};
  a.state = a.makeDefaultState();
  return a;
};
const DISTANCES = ['5k', '10k', 'half', 'full', 'ultra'];
const WEEKS = [12, 14, 16, 20, 24];
const SCHED = { activeDays: [0, 1, 2, 3, 4, 6], longRunDay: 6 };

/* The long run the athlete actually receives. A partial first calendar week
   can hold a single day and is not a training week. */
function deliveredPeakLong(a, distKey, volume, weeks){
  const blk = a.buildBlockWeeks(distKey, volume, weeks, {});
  const end = a.addDays(a.addDays(TODAY, -a.isoWeekday(TODAY)), blk.planWeeks * 7 - 1);
  const ds = a.buildDaysFromWeeks(blk, end, SCHED, TODAY, true);
  /* THE WEEKLY LONG-RUN ALLOCATION, WHICH IS WHAT THE FLOOR IS DEFINED ON --
     and taking the single longest DAY instead was this instrument's own bug,
     found when ultra appeared to miss its floor by 7 km. MIN_PEAK_LONG_KM's own
     comment says it: "defined on longTarget, the weekly long-run ALLOCATION,
     not on any single session ... that distinction matters for ultra alone,
     where longTarget is split 0.62/0.38 across a back-to-back weekend". The
     peak ultra week really is 11 km + 19 km = 30 km, exactly its floor; the
     single 19 km day is the correct reading of an ultra long weekend, not a
     shortfall. Only ultra carries profile.backToBack, so summing the week's
     long days is identical to taking the one long day everywhere else. */
  let best = 0;
  [...new Set(ds.map(d => d.week))].filter(Boolean).forEach(k => {
    const wd = ds.filter(d => d.week === k);
    if (wd.length < 7) return;
    const alloc = wd.filter(d => d.type === 'long').reduce((t, d) => t + (d.km || 0), 0);
    if (alloc > best) best = alloc;
  });
  return best;
}

test('the viability floor is the prescription methodology, inverted — not a second number', () => {
  const a = app();
  DISTANCES.forEach(d => {
    const p = a.DISTANCE_PROFILES[d];
    const frac = a.LONG_FRACTION[p.emphasis];
    WEEKS.forEach(w => {
      const start = a.minViableStartKm(d, w);
      assert.ok(start > 0, d + '/' + w + ': the gate must have an answer');
      /* start x development x fraction === the floor. Exact to the one
         rounding minViableStartKm() itself applies (round1 on the start). */
      const reconstructed = start * a.developmentMultiplierFor(d, w) * frac;
      assert.ok(Math.abs(reconstructed - a.MIN_PEAK_LONG_KM[d]) < 0.06,
        d + '/' + w + 'wk: ' + start + ' km x ' + a.developmentMultiplierFor(d, w) +
        ' x ' + frac + ' = ' + reconstructed.toFixed(3) +
        ', which is not MIN_PEAK_LONG_KM.' + d + ' = ' + a.MIN_PEAK_LONG_KM[d] +
        ' — the gate and the builder have stopped being the same equation');
    });
  });
});

test('a marathon plan can always be built, whatever the starting volume', () => {
  /* THE FIRST THING THE OLD BOUNDARY GOT WRONG. "Admissible" and "can be made
     ready" are different questions, and only the second one has a threshold. */
  const a = app();
  [5, 8, 12, 20, 30, 50, 80].forEach(v => {
    const o = a.marathonPreparationOutlook(v, 15, 330);
    assert.equal(o.canBuild, true, v + ' km/week must still get a programme');
    const blk = a.buildBlockWeeks('full', v, 15, { availableDays: 6, easyPaceSecPerKm: 330 });
    assert.ok(blk.weeks.length === 15, v + ' km/week must generate fifteen weeks');
  });
});

test('a low start produces an honest shortfall, not a refusal and not a fiction', () => {
  const a = app();
  const bench = a.MIN_PEAK_LONG_KM.full;
  const low = a.marathonPreparationOutlook(12, 15, 330);
  const high = a.marathonPreparationOutlook(80, 15, 330);
  assert.ok(low.longShortfallKm > 0, 'a 12 km/week athlete is short of the benchmark');
  assert.equal(high.longShortfallKm, 0, 'an 80 km/week athlete is not');
  assert.ok(low.reachableLongKm < bench && low.reachableLongKm > 0,
    'and what they CAN reach is stated rather than refused: ' + low.reachableLongKm);
});

test('long-run reachability alone does not authorise a dominating long run', () => {
  /* THE MEASUREMENT THAT MADE THE COHERENCE GATE NECESSARY. Asked in
     isolation, a 30 km/week athlete's long run can reach 30 km. The week it
     would land in is 60, so that one run is half of everything they do. */
  const a = app();
  const reachAlone = a.marathonLongRunDestination(
    a.marathonSessionStart(30, 4).longKm, 10).km;
  const withWeek = a.marathonPreparationOutlook(30, 15, 330).reachableLongKm;
  assert.ok(reachAlone > withWeek,
    'reachability said ' + reachAlone + ', the whole week says ' + withWeek);
  const blk = a.buildBlockWeeks('full', 30, 15, { availableDays: 6, easyPaceSecPerKm: 330 });
  const nr = blk.weeks.filter(w => !w.isRace && w.phase !== 'Taper');
  const peakLong = Math.max.apply(null, nr.map(w => w.longTarget));
  const peakWk = Math.max.apply(null, nr.map(w => w.volume));
  assert.ok(peakLong / peakWk < 0.4,
    'the long run is ' + Math.round(100 * peakLong / peakWk) + '% of the week');
});

test('the coherence gate only ever holds back — it never generates', () => {
  const a = app();
  /* It is a ceiling on a candidate and nothing else: no long run, no weekly
     volume and no share is ever solved for. */
  assert.equal(a.longRunCoherenceCeiling(0), Infinity, 'with no support it has no opinion');
  assert.ok(a.longRunCoherenceCeiling(10) > a.longRunCoherenceCeiling(8),
    'more support permits more long run, and permits is the whole verb');
  // and it is the frequency band read in the other direction, not a new number
  assert.equal(a.longRunCoherenceCeiling(10), 10 / a.SUPPORT_SHARE_MIN);
});

test('no share equation generates the long run or the week', () => {
  const a = app();
  const f = a.LONG_FRACTION.endurance;
  [20, 30, 40, 50, 60, 80].forEach(v => {
    const blk = a.buildBlockWeeks('full', v, 15, { availableDays: 6, easyPaceSecPerKm: 330 });
    const nr = blk.weeks.filter(w => !w.isRace && w.phase !== 'Taper');
    /* THE CLAIM IS ABOUT THE BLOCK, NOT EVERY WEEK. Week one can coincide --
       the athlete's own starting long run is read from the shape of the week
       they arrived with, so at some volumes it lands on the share exactly, and
       one coincidence proves nothing either way. What the old architecture
       guaranteed is that the identity held EVERYWHERE, and that is what is
       gone: the long run and the week now develop on separate authorities and
       drift apart across the block. */
    const onShare = nr.filter(w => Math.abs(w.longTarget - w.volume * f) <= 0.05).length;
    assert.ok(onShare < nr.length / 2,
      v + ' km: ' + onShare + ' of ' + nr.length + ' weeks still sit exactly on volume x share');
    const peak = nr.reduce((m, w) => w.volume > m.volume ? w : m, nr[0]);
    assert.ok(Math.abs(peak.longTarget - peak.volume * f) > 0.05,
      v + ' km: the peak week is still exactly volume x share');
  });
});

test('the week is the sum of the sessions prescribed in it', () => {
  const a = app();
  [12, 25, 50, 80].forEach(v => {
    const blk = a.buildBlockWeeks('full', v, 15, { availableDays: 6, easyPaceSecPerKm: 330 });
    blk.weeks.filter(w => w.bottomUp).forEach(w => {
      const b = w.bottomUp;
      const q = b.qualityDeferred ? 0
              : (b.qSlots >= 2 ? (w.qKm + w.tKm) : (w.week % 2 === 0 ? w.tKm : w.qKm));
      const sum = w.longTarget + q + b.supportDays * b.supportKm;
      assert.ok(Math.abs(sum - w.volume) < 0.15,
        v + ' km wk' + w.week + ': sessions sum to ' + Math.round(sum * 10) / 10 +
        ', week reports ' + w.volume);
      assert.equal(w.intendedVolume, w.volume,
        'and there is no separate intent left to reconcile against');
    });
  });
});

test('the 30 km benchmark is reached where the athlete supports it, and not forced where they do not', () => {
  const a = app();
  const bench = a.MIN_PEAK_LONG_KM.full;
  const peakLongOf = v => {
    const blk = a.buildBlockWeeks('full', v, 15, { availableDays: 6, easyPaceSecPerKm: 330 });
    const nr = blk.weeks.filter(w => !w.isRace && w.phase !== 'Taper');
    return Math.max.apply(null, nr.map(w => w.longTarget));
  };
  assert.ok(peakLongOf(80) >= bench - 0.55, 'an established athlete reaches it');
  assert.ok(peakLongOf(25) < bench * 0.7, 'a low-volume athlete is not forced to it');
  // monotone in starting workload -- no cliff, no reversal
  const seq = [12, 20, 25, 30, 40, 50, 60, 70, 80].map(peakLongOf);
  for (let i = 1; i < seq.length; i++)
    assert.ok(seq[i] >= seq[i - 1] - 0.05, 'peak long went backwards: ' + seq.join(','));
});

test('genuinely insufficient preparation is still distinguishable', () => {
  const a = app();
  const tooShort = a.athletePathway('full', 51, 4);
  assert.equal(tooShort.route, 'insufficient_time');
  assert.ok(typeof tooShort.reason === 'string' && tooShort.reason.length > 0);
  /* And a window that IS enough is not refused. */
  assert.notEqual(a.athletePathway('full', 51, 16).route, 'insufficient_time');
  assert.notEqual(a.athletePathway('full', 70, 12).route, 'insufficient_time');
});

test('no other race distance depends on the marathon floor', () => {
  /* Each distance's floor is read only through its own key, so the four
     approved values are independent of one another. Asserted by perturbing the
     marathon entry and confirming nothing else answers differently. */
  const a = app();
  const before = ['5k', '10k', 'half', 'ultra'].map(d =>
    d + ':' + a.minViableStartKm(d, 16) + ':' + a.athletePathway(d, 40, 16).route).join('|');
  const real = a.MIN_PEAK_LONG_KM.full;
  a.MIN_PEAK_LONG_KM.full = 28;
  try {
    const after = ['5k', '10k', 'half', 'ultra'].map(d =>
      d + ':' + a.minViableStartKm(d, 16) + ':' + a.athletePathway(d, 40, 16).route).join('|');
    assert.equal(after, before);
    /* And it does move the marathon's own admission volume, which is what
       makes it the single lever. */
    assert.ok(a.minViableStartKm('full', 16) < 51,
      'lowering the marathon floor must lower the marathon admission volume');
  } finally { a.MIN_PEAK_LONG_KM.full = real; }
  assert.equal(a.MIN_PEAK_LONG_KM.full, real);
});
