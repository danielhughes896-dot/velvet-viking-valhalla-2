'use strict';
/* THE PHASES ARE COACHING CONTRACTS, AND THIS IS WHERE THEY ARE ENFORCED.
 * ===========================================================================
 * HQ: every phase has a defined job and must leave the athlete appropriately
 * prepared for what follows. A generic mileage curve with Base/Build/Peak
 * painted over it would satisfy none of these and would look identical in the
 * week table, so each contract is asked of what the phase actually establishes
 * rather than of the label on it.
 *
 *   BASE  -> ready to Build
 *   BUILD -> ready to Peak
 *   PEAK  -> maximum safely established race preparation
 *   TAPER -> no development of any kind
 *
 * WHERE A REAL CONSTRAINED ATHLETE CANNOT SAFELY MEET A PHASE EXIT STANDARD,
 * safety wins and the shortfall is surfaced -- so these are asked of the
 * canonical athlete for each pathway, who is by construction the athlete the
 * pathway was designed for and has nothing constraining them.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const R = require(path.join(__dirname, 'audit', 'raceGoalReachability.js'));

const r1 = x => Math.round(x * 10) / 10;

/* The delivered weeks of a canonical pathway, with the phase each belongs to
   and what the athlete was actually asked to run. */
function weeksOf(c){
  const res = R.build(Object.assign({ dist:c.dist, exp:c.exp, days:c.days, weeks:c.weeks }, c.ev));
  const byW = {};
  res.blk.weeks.forEach(w => { byW[w.week] = { w:w, d:[] }; });
  res.dd.forEach(x => { if (byW[x.week]) byW[x.week].d.push(x); });
  const rows = Object.keys(byW).map(k => byW[k]).sort((a, b) => a.w.week - b.w.week)
    .map(rw => {
      const runs = rw.d.filter(x => x.km > 0 && x.type !== 'race');
      const longs = runs.filter(x => x.type === 'long');
      const qual = runs.filter(x => ['tempo','threshold','interval','repetition','checkpoint','calibration']
                                    .indexOf(x.type) !== -1);
      return { week: rw.w.week, phase: rw.w.phase, isRace: !!rw.w.isRace,
               isTaper: !!(rw.w.isTaper || rw.w.eventTaperApplied), isCutback: !!rw.w.isCutback,
               km: r1(runs.reduce((t, x) => t + x.km, 0)),
               longKm: longs.length ? Math.max.apply(null, longs.map(x => x.km)) : 0,
               runDays: runs.length, qualityCount: qual.length,
               qualityKm: r1(qual.reduce((t, x) => t + x.km, 0)),
               specificKm: r1(runs.filter(x => x.mpSegment).reduce((t, x) => t + x.km, 0)),
               families: qual.map(x => (x.prescription && x.prescription.archetype) || x.type)
                             .filter(Boolean) };
    });
  return { res, rows, alloc: res.blk.phaseCounts };
}
const phase = (rows, name) => rows.filter(r => r.phase === name && !r.isRace);
const lastOf = a => a[a.length - 1];

/* Both runways HQ admits, at both ends of the window. */
const SETS = [{ label:'15 weeks', cases: R.CANON }, { label:'10 weeks', cases: R.CANON_10 }];

// ---------------------------------------------------------------------------
// BASE -> READY TO BUILD
// ---------------------------------------------------------------------------
SETS.forEach(({ label, cases }) => {
  test('BASE EXIT — the athlete is ready to Build (' + label + ')', () => {
    cases.forEach(c => {
      const { rows, alloc } = weeksOf(c);
      const base = phase(rows, 'Base');
      assert.ok(base.length === alloc.base,
        c.key + ': Base is ' + base.length + ' weeks, geometry says ' + alloc.base);
      if (!base.length) return;
      /* ---- READY IS A STATE, NOT A DELTA ----
         Base's job is that the athlete can undertake real Build. For a New
         athlete that means developing the prerequisites; for an Experienced or
         Advanced athlete who already has them HQ is explicit that they must not
         be pushed through artificial low-level progression merely because the
         phase exists. So what is asked is the STATE at Base exit -- the
         capability the phase established or confirmed -- and it is read as the
         phase's high-water mark rather than as whatever its last week happened
         to deliver, because Base legitimately ends on an absorption week and an
         absorbed week is not a lower capability. */
      const est = k => Math.max.apply(null, base.map(r => r[k]));
      const p = R.PATHWAY_OF(c);
      assert.ok(est('longKm') > 0, c.key + ': Base exits with no long run at all');
      assert.ok(est('longKm') >= p.entryLongKm - 0.05,
        c.key + ': Base exits with a ' + est('longKm') + 'km long run, below the ' +
        p.entryLongKm + 'km the pathway opens at');
      assert.ok(est('km') >= p.entryVolumeKm - 0.05,
        c.key + ': Base exits at ' + est('km') + 'km/week, below the pathway entry of ' +
        p.entryVolumeKm);
      assert.ok(est('runDays') >= 3,
        c.key + ': Base exits running ' + est('runDays') + ' days — not a week Build can develop');
      /* AND WHERE THE ATHLETE ARRIVED WITHOUT THE PREREQUISITES, BASE BUILT
         THEM. A New pathway that leaves its athlete exactly where they started
         has not prepared anybody for anything.

         HQ RACE GOAL TIGHT METHODOLOGY CORRECTION -- a two-week Base phase
         is the one case where this now legitimately shows no volume/long-run
         delta between its own two weeks. Selected days are training days
         from the very first week under the new contract (N selected -> N-1
         prescribed immediately, not ramped up to over several weeks), so a
         New athlete's frequency establishment -- reaching the pathway's own
         entry day count -- happens in week 1 rather than climbing across
         Base, and both floor-inflated weeks of a two-week Base can land on
         the identical total. Longer Base phases still show the ordinary
         volume ramp (Build's own weeks below prove the curve did not go
         flat generally), so the exception is scoped to exactly the case
         that structurally cannot show one: two weeks is not enough room for
         a volume curve once the day count itself is no longer what ramps. */
      if (c.exp === 'novice' && base.length > 2)
        assert.ok(est('longKm') > base[0].longKm + 0.05 || est('km') > base[0].km + 0.05,
          c.key + ': Base established nothing for a New athlete');
    });
  });
});

// ---------------------------------------------------------------------------
// BUILD -> READY TO PEAK
// ---------------------------------------------------------------------------
SETS.forEach(({ label, cases }) => {
  test('BUILD EXIT — the athlete is ready to Peak (' + label + ')', () => {
    cases.forEach(c => {
      const { rows, alloc } = weeksOf(c);
      const build = phase(rows, 'Build'), base = phase(rows, 'Base');
      assert.ok(build.length === alloc.build,
        c.key + ': Build is ' + build.length + ' weeks, geometry says ' + alloc.build);
      const exit = lastOf(build);
      assert.ok(exit, c.key + ': no Build phase at all');
      /* BUILD MUST HAVE BUILT. Its job is to develop the athlete materially
         toward the event, so the athlete leaving it must be carrying more than
         the athlete who entered it. */
      const from = base.length ? lastOf(base) : build[0];
      assert.ok(exit.longKm > from.longKm + 0.05,
        c.key + ': Build did not develop the long run (' + from.longKm + ' -> ' + exit.longKm + ')');
      /* AND IT MUST NOT HAND PEAK ITS OWN WORK. Peak's job is race readiness,
         not finishing Build -- so the athlete arriving in Peak carries most of
         the durability the block will ever ask of them. */
      const peakLong = Math.max.apply(null, phase(rows, 'Peak').map(r => r.longKm).concat([0]));
      if (peakLong > 0)
        assert.ok(exit.longKm >= peakLong * 0.7 - 0.05,
          c.key + ': Build exits at ' + exit.longKm + 'km against a Peak long run of ' +
          peakLong + ' — Peak is being asked to do Build\'s work');
    });
  });
});

// ---------------------------------------------------------------------------
// PEAK -> MAXIMUM SAFELY ESTABLISHED RACE PREPARATION
// ---------------------------------------------------------------------------
SETS.forEach(({ label, cases }) => {
  test('PEAK — the longest run lands in its final seven days (' + label + ')', () => {
    cases.forEach(c => {
      const { rows, alloc } = weeksOf(c);
      const peak = phase(rows, 'Peak');
      assert.ok(peak.length === alloc.peak,
        c.key + ': Peak is ' + peak.length + ' weeks, geometry says ' + alloc.peak);
      if (!peak.length) return;
      const dev = rows.filter(r => !r.isRace && !r.isTaper);
      const longest = Math.max.apply(null, dev.map(r => r.longKm));
      const finalPeak = lastOf(peak);
      /* HQ: the longest appropriate long run occurs within the final seven days
         of Peak, immediately before taper begins. That is the last Peak week. */
      assert.ok(finalPeak.longKm >= longest - 0.05,
        c.key + ': the longest run is ' + longest + 'km but the final Peak week (week ' +
        finalPeak.week + ') runs ' + finalPeak.longKm + 'km');
      /* AND IT IS NOT A REDUCED WEEK. */
      assert.ok(!finalPeak.isCutback,
        c.key + ': the final Peak week is an absorption week');
    });
  });
});

// ---------------------------------------------------------------------------
// TAPER -> DEVELOPMENT HAS ENDED
// ---------------------------------------------------------------------------
SETS.forEach(({ label, cases }) => {
  test('TAPER — the last day of Peak is a hard development boundary (' + label + ')', () => {
    cases.forEach(c => {
      const { rows } = weeksOf(c);
      const peak = phase(rows, 'Peak');
      if (!peak.length) return;
      const finalPeak = lastOf(peak);
      /* Race week has its own architecture -- a shakeout, a strides session and
         the race -- and HQ's boundary is about DEVELOPMENT leaking into the
         wind-down. It is asked of the taper weeks; race week is asked its own
         question in the volume assertion below and in the load audit. */
      const after = rows.filter(r => r.week > finalPeak.week && !r.isRace);
      const devFamilies = new Set();
      rows.filter(r => r.week <= finalPeak.week).forEach(r =>
        r.families.forEach(f => devFamilies.add(f)));
      after.forEach(r => {
        /* NO LONG-RUN DEVELOPMENT. */
        assert.ok(r.longKm <= finalPeak.longKm + 0.05,
          c.key + ' week ' + r.week + ': long run ' + r.longKm + 'km after a Peak that ended at ' +
          finalPeak.longKm);
        assert.ok(r.km <= finalPeak.km + 0.05,
          c.key + ' week ' + r.week + ': ' + r.km + 'km after a Peak that ended at ' + finalPeak.km);
        /* AND NO NEW INTENSITY FAMILY. A taper reveals fitness already
           developed; a family the athlete has not met is new development. */
        r.families.forEach(f => assert.ok(devFamilies.has(f),
          c.key + ' week ' + r.week + ': the taper introduced ' + f +
          ', a session family the block never prescribed'));
      });
    });
  });
});

// ---------------------------------------------------------------------------
// THE TAPER IS ANCHORED TO THE EVENT, NOT TO THE WEEK GRID
// ---------------------------------------------------------------------------
test('TAPER ANCHOR — the half winds down around D-10 and the marathon around D-14', () => {
  R.CANON.forEach(c => {
    const res = R.build(Object.assign({ dist:c.dist, exp:c.exp, days:c.days, weeks:c.weeks }, c.ev));
    const race = res.dd.filter(d => d.type === 'race')[0];
    assert.ok(race, c.key + ': no race day');
    const dayOffset = d => Math.round(
      (new Date(race.date + 'T00:00:00Z') - new Date(d.date + 'T00:00:00Z')) / 86400000);
    /* The last day the block asked for a full-sized long run, expressed as days
       before the race. HQ: half D-17..D-10, marathon D-21..D-14. */
    /* THE CULMINATING RUN, not the first time the block touched that distance.
       A pathway whose long run reaches its destination early and then holds it
       -- which is what an Advanced athlete's does -- has its longest run on
       every week from there on, and the one that matters is the LAST. */
    const longs = res.dd.filter(d => d.type === 'long' && d.km > 0);
    const longest = longs.reduce((m, d) => d.km >= m.km ? d : m, longs[0]);
    const off = dayOffset(longest);
    const window = c.dist === 'half' ? [10, 17] : [14, 21];
    assert.ok(off >= window[0] && off <= window[1],
      c.key + ': the longest run (' + longest.km + 'km) falls at D-' + off +
      ', outside HQ\'s D-' + window[1] + ' to D-' + window[0] + ' window');
  });
});

// ---------------------------------------------------------------------------
// AND THE GEOMETRY ITSELF IS THE RUNWAY'S
// ---------------------------------------------------------------------------
test('GEOMETRY — the phase lengths are HQ\'s table, and Experience cannot move them', () => {
  const a = R.build({ dist:'half', exp:'novice', days:5, weeks:15,
                      easyKm:3.5, longKm:8, easyDays:[0,2], tt5kMin:28 }).a;
  const HQ = { 10:[2,4,2], 11:[2,5,2], 12:[3,5,2], 13:[3,5,3], 14:[3,6,3], 15:[4,6,3] };
  Object.keys(HQ).forEach(n => {
    const [base, build, peak] = HQ[n];
    ['half', 'full'].forEach(d => {
      ['novice', 'experienced', 'advanced'].forEach(e => {
        const g = a.raceGoalPhaseAllocation(d, +n, e);
        assert.equal(g.base, base, d + '/' + e + ' @' + n + 'w base');
        assert.equal(g.build, build, d + '/' + e + ' @' + n + 'w build');
        assert.equal(g.peak, peak, d + '/' + e + ' @' + n + 'w peak');
        assert.equal(g.taper + g.final, 2, d + '/' + e + ' @' + n + 'w taper container');
        assert.equal(g.base + g.build + g.peak + g.taper + g.final, +n,
          d + '/' + e + ' @' + n + 'w does not sum to its runway');
      });
    });
  });
});

test('ADMISSION — nine weeks refuses, ten to fifteen builds, sixteen hands off', () => {
  const a = R.build({ dist:'half', exp:'novice', days:5, weeks:15,
                      easyKm:3.5, longKm:8, easyDays:[0,2], tt5kMin:28 }).a;
  ['half', 'full'].forEach(d => {
    [4, 8, 9].forEach(W => {
      const adm = a.raceGoalAdmission(d, W);
      assert.equal(adm.admitted, false, d + ' @' + W + 'w must not be admitted');
      assert.equal(adm.decision, 'too_short');
      assert.equal(adm.recommend, 'aerobic_base',
        d + ' @' + W + 'w must recommend the useful preparation for the time left');
    });
    [10, 12, 15].forEach(W => {
      const adm = a.raceGoalAdmission(d, W);
      assert.equal(adm.admitted, true, d + ' @' + W + 'w must be admitted');
      assert.equal(adm.raceGoalWeeks, W, d + ' @' + W + 'w must build the whole runway');
    });
    [16, 20, 30].forEach(W => {
      const adm = a.raceGoalAdmission(d, W);
      assert.equal(adm.admitted, false, d + ' @' + W + 'w must not stretch');
      assert.equal(adm.decision, 'too_far');
      assert.equal(adm.raceGoalWeeks, 15, d + ' @' + W + 'w opens a 15-week block');
      assert.equal(adm.startInWeeks, W - 15, d + ' @' + W + 'w must say when it opens');
    });
  });
  /* And no other distance is gated by this window. */
  ['5k', '10k', 'ultra'].forEach(d =>
    assert.equal(a.raceGoalAdmission(d, 8).admitted, true, d + ' must not be gated'));
});
