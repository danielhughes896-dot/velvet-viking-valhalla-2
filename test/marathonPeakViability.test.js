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
  /* THE TEST IS THE COHERENCE RELATION, NOT A SHARE OF THE WEEK. A share
     threshold would be the hidden universal rule the methodology prohibits --
     a lower-frequency athlete legitimately carries a larger share, because the
     same relationship between the long run and the runs beside it produces a
     bigger fraction when there are fewer of them. What must hold is that the
     supporting runs are still supporting: at or above SUPPORT_SHARE_MIN of the
     long run. */
  const wk = blk.weeks.filter(w => w.bottomUp && !w.isRace && w.phase !== 'Taper')
                      .reduce((m, w) => w.volume > m.volume ? w : m);
  assert.ok(wk.bottomUp.supportKm >= wk.longTarget * a.SUPPORT_SHARE_MIN - 0.05,
    'supporting runs are ' + Math.round(100 * wk.bottomUp.supportKm / wk.longTarget) +
    '% of the long run');
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
      /* THE WEEK'S OWN RECORD, not a re-derivation. Which family a one-slot
         week carries, and whether the slot was refused for capacity, deferred
         under the long-run bound or given back to the aerobic work, are four
         separate decisions inside buildBlockWeeks -- this test reproduced one
         of them and silently disagreed with the other three. bottomUp.qualityKm
         is what the week counted, so the identity is asserted against the
         generator's answer rather than against a copy of part of it. */
      const q = b.qualityKm;
      /* countedSupportDays, not supportDays: where the structured session was
         deferred its slot became an ordinary supporting run and the week
         carries one more of them. */
      const sum = w.longTarget + q + (b.countedSupportDays || b.supportDays) * b.supportKm;
      assert.ok(Math.abs(sum - w.volume) < 0.15,
        v + ' km wk' + w.week + ': sessions sum to ' + Math.round(sum * 10) / 10 +
        ', week reports ' + w.volume);
      assert.equal(w.intendedVolume, w.volume,
        'and there is no separate intent left to reconcile against');
    });
  });
});

/* ---- WHAT DECIDES THE PEAK LONG RUN, AND WHAT NO LONGER DOES ----
   This asserted that an athlete's STATED WEEKLY VOLUME decided whether the
   30km benchmark was reached: 80km/week got there, 25km/week was held under
   70% of it. That is the authority destination-led construction removed. The
   event's requirement is now stated by the PATHWAY the athlete's experience
   selects, raised by their own demonstrated long run and never by a weekly
   figure they typed; how fast they may travel toward it is bounded by the
   ordinary session rate from where they actually are.

   So the protection is re-stated on the authorities that survive: each pathway
   reaches its own long-run requirement, demonstrated evidence raises it, a
   typed weekly volume does not, and the result is still monotone with nothing
   cliffed or reversed. */
test('the long-run destination is the pathway\'s, raised by evidence and not by a typed number', () => {
  const a = app();
  const peakLongOf = (v, exp, pace) => {
    a.state = a.makeDefaultState();
    const blk = a.buildBlockWeeks('full', v, 15,
      { purpose: 'race', availableDays: 6, easyPaceSecPerKm: pace || 330, experience: exp });
    const nr = blk.weeks.filter(w => !w.isRace && w.phase !== 'Taper');
    return Math.max.apply(null, nr.map(w => w.longTarget));
  };
  /* THE PATHWAY IS THE AUTHORITY. Each one states a peak long run, and an
     athlete entering on it at its own entry volume reaches it -- at every easy
     pace that athlete plausibly runs. */
  /* The easy-pace band each pathway's athlete actually runs in. It matters
     because session COST is one of the bounds on a supporting run, and a
     supporting run is what a long run is allowed to be 2.5 times: a 32km long
     run needs 12.8km supporting runs, which is 90 minutes at 7:00/km. An
     advanced marathoner does not run easy at 7:40, and a novice does not run
     easy at 4:00. */
  const BAND = { novice: [360, 420, 480], experienced: [300, 330, 390],
                 advanced: [240, 300, 330] };
  ['novice', 'experienced', 'advanced'].forEach(exp => {
    const p = a.RACE_GOAL_PATHWAY.full[exp];
    BAND[exp].forEach(pace => {
      assert.ok(peakLongOf(p.entryVolumeKm, exp, pace) >= p.peakLongKm - 0.55,
        exp + ' at ' + pace + 's/km does not reach its own pathway long run of ' +
        p.peakLongKm);
    });
  });
  /* AND WHERE THE ATHLETE GENUINELY CANNOT SUPPORT IT, IT IS NOT PRESCRIBED.
     A nine-minute-kilometre easy pace puts the supporting runs a 32km long run
     needs past an hour and a half apiece, so the destination comes down --
     which is the session-cost bound doing exactly its job. That is an athlete
     shortfall, honestly measured, and it is the one thing readiness is for. */
  assert.ok(peakLongOf(a.RACE_GOAL_PATHWAY.full.advanced.entryVolumeKm, 'advanced', 540) <
            a.RACE_GOAL_PATHWAY.full.advanced.peakLongKm - 1,
    'session cost no longer bounds the long run for a slow athlete');
  /* AND EXPERIENCE, NOT VOLUME, IS WHAT SEPARATES THEM. The same typed number
     on three pathways gives three different destinations. */
  const same = ['novice', 'experienced', 'advanced'].map(e => peakLongOf(50, e));
  assert.ok(same[2] > same[1] && same[1] > same[0],
    'experience did not separate the destinations: ' + same.join(','));
  /* AND NOTHING CLIFFS OR REVERSES ACROSS THE STATED-VOLUME DOMAIN. */
  const seq = [12, 20, 25, 30, 40, 50, 60, 70, 80].map(v => peakLongOf(v, 'experienced'));
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
