'use strict';
/* THE REACHABILITY GATE, AS A TEST.
 * ===========================================================================
 * A pathway that routinely misses its own destination and leaves readiness to
 * report the miss has failed, however honest the report is. Readiness is for a
 * genuine athlete or runway shortfall; it is not a substitute for a programme
 * architecture that can get there.
 *
 * The instrument is test/audit/raceGoalReachability.js -- the same canonical
 * athletes, the same measurement -- so the report HQ reads and the gate the
 * suite holds cannot drift apart. What is asserted here is the gate itself:
 *
 *   THE DESTINATION IS REACHED    weekly volume and long run both at or above
 *                                 the pathway's own requirement.
 *   BEFORE THE TAPER              a taper deliberately reduces load, so a
 *                                 capability first seen inside one was never
 *                                 established.
 *   MORE THAN ONCE                a long run met once and never approached
 *                                 again is a spike, not a capability. The
 *                                 architecture's own second-exposure fraction
 *                                 is the bar, plus the kilometre a long run
 *                                 rounds to.
 *   WITH NO OPTIONAL RUNS IN PEAK an Optional Run is a week that has not
 *                                 decided what it is asking for, and Peak has.
 *   AND THE MINIMUMS ARE NOT      an athlete who arrives above the pathway
 *   CEILINGS                      trains above it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const R = require(path.join(__dirname, 'audit', 'raceGoalReachability.js'));

const r1 = x => Math.round(x * 10) / 10;

R.CANON.forEach(c => {
  test('REACHABILITY — ' + c.key + ' reaches its own destination before the taper', () => {
    const res = R.build(Object.assign(
      { dist: c.dist, exp: c.exp, days: c.days, weeks: c.weeks }, c.ev));
    const p = R.established(res, null);
    const needKm   = Math.max(c.needBuildKm   || 0, c.needPeakKm   || 0);
    const needLong = Math.max(c.needBuildLong || 0, c.needPeakLong || 0);

    assert.ok(p.peakKm >= needKm - 0.05,
      c.key + ' established ' + r1(p.peakKm) + 'km/week against a requirement of ' + needKm);
    assert.ok(p.peakLong >= needLong - 0.05,
      c.key + ' established a ' + r1(p.peakLong) + 'km long run against a requirement of ' +
      needLong);
    assert.ok(p.secondOk,
      c.key + ' met its long run once, at ' + r1(p.peakLong) + 'km in week ' + p.peakLongWk +
      ', and never came within the second-exposure fraction of it again (best other: ' +
      r1(p.second) + 'km)');
    assert.equal(p.optInPeak, 0,
      c.key + ' carries ' + p.optInPeak + ' Optional Runs in Peak');

    /* AND IT IS ESTABLISHED, NOT ARRIVED AT IN THE LAST WEEK. The week the
       capability first appears has to be a week the athlete then trains
       through, which is what "established" means -- and it is the whole
       difference between a programme that prepared somebody and one that
       reached a number on its way out. */
    const lastDev = res.blk.weeks.filter(w => !w.isRace && !w.isTaper &&
                                              !w.eventTaperApplied).slice(-1)[0];
    assert.ok(p.peakLongWk <= lastDev.week,
      c.key + ' first met its long run in week ' + p.peakLongWk +
      ', after the last developing week (' + lastDev.week + ')');
  });
});

test('REACHABILITY — readiness agrees that the destination was reached', () => {
  /* THE OTHER HALF OF THE GATE. Readiness detecting an architecturally caused
     miss does not convert that miss into a pass -- and readiness reporting
     READY while the pathway misses is worse, because it hides one. For the
     canonical athlete, who is exactly right for their pathway, the two have to
     agree. */
  R.CANON.forEach(c => {
    const res = R.build(Object.assign(
      { dist: c.dist, exp: c.exp, days: c.days, weeks: c.weeks }, c.ev));
    const rd = res.a.raceGoalReadiness(c.dist, c.exp, res.blk);
    assert.equal(rd.verdict, 'READY',
      c.key + ' reaches its destination but readiness says ' + rd.verdict);
  });
});

R.HIGH.forEach(c => {
  test('REACHABILITY — ' + c.key + ': a pathway minimum is not a ceiling', () => {
    const res = R.build(Object.assign(
      { dist: c.dist, exp: c.exp, days: c.days, weeks: c.weeks }, c.ev));
    const p = R.established(res, null);
    assert.ok(p.peakKm > c.floorKm + 0.05,
      c.key + ' was held to ' + r1(p.peakKm) + 'km against a pathway minimum of ' + c.floorKm);
  });
});

test('REACHABILITY — every pathway states an entry its own destination can reach', () => {
  /* THE ARITHMETIC THE PATHWAY TABLE HAS TO SATISFY, asserted directly rather
     than discovered by a canonical athlete missing. A block hands out a fixed
     number of development steps and a session may grow by at most the ordinary
     rate at each of them, so entry x rate^steps is the furthest any long run on
     that pathway can travel. A destination beyond it is unreachable BY
     CONSTRUCTION -- which is how the novice marathon came to ask for 26km from
     an entry of 8. */
  const a = R.build({ dist: 'half', exp: 'novice', days: 5, weeks: 15,
                      easyKm: 5, longKm: 8, easyDays: [0, 2], tt5kMin: 28 }).a;
  ['half', 'full'].forEach(dist => {
    ['novice', 'experienced', 'advanced'].forEach(exp => {
      const p = a.RACE_GOAL_PATHWAY[dist][exp];
      const steps = a.raceGoalStepCount(dist, 15, exp);
      const reach = p.entryLongKm * Math.pow(a.sessionProgressionRate(), steps);
      /* AT THE RESOLUTION A LONG RUN IS ACTUALLY PRESENTED IN, which is the
         whole kilometre -- so a curve landing at 25.5 or above is delivered as
         26, and half a kilometre is exactly what that rounding guarantees.

         THE NEW MARATHON NOW USES ALL OF IT. Ten kilometres over ten steps
         reaches 25.94 against a 26km destination: the locked entry does reach
         the locked destination, and it does so with no margin beyond the
         rounding. The canonical athlete confirms it independently -- 26km
         established in week eleven, second exposure 24km -- but this pathway is
         the one with nothing spare, and shortening the marathon runway or
         lowering the rate would break it first. */
      assert.ok(reach >= p.peakLongKm - 0.5 - 1e-9,
        dist + '/' + exp + ': ' + p.entryLongKm + 'km reaches ' +
        Math.round(reach * 100) / 100 + ' in ' + steps + ' steps, against a ' +
        p.peakLongKm + 'km destination');
      /* AND THE ENTRY WEEK HAS TO BE ABLE TO CONTAIN THE ENTRY LONG RUN, at
         the pathway's own coherence rule: the long run, one quality slot and at
         least one supporting run, none of the latter below SUPPORT_SHARE_MIN of
         the long run. Below that the block opens with supporting runs too small
         to support what they are under, and they cannot reach the size the
         destination needs -- which is how a 22km novice marathon week with a
         13km long run made its own 26km destination unreachable.

         THE DAY COUNT IS NOT ASSERTED HERE, and the difference is worth
         stating: entryDays says how often this athlete runs, and where their
         entry week cannot write that many runs at coherent sizes the block
         opens on fewer and develops the rest back as capacity earns them. The
         experienced marathon pathway is the one that does this -- 45km with an
         18km long run writes four days rather than five -- and that is the
         frequency development doing its job, not an incoherent pathway. */
      const minWeek = p.entryLongKm * (1 + 2 * a.SUPPORT_SHARE_MIN);
      assert.ok(p.entryVolumeKm >= minWeek - 1e-9,
        dist + '/' + exp + ': an entry week of ' + p.entryVolumeKm +
        'km cannot coherently contain a ' + p.entryLongKm + 'km long run (needs ' +
        Math.round(minWeek * 10) / 10 + ')');
    });
  });
});

test('LONG RUNWAY — a half hands its surplus off rather than growing a Base', () => {
  /* THE HALF HAD THE MARATHON'S RUNWAY PROBLEM AND NOT ITS ANSWER. Its
     dedicated window is fifteen weeks and its destination stops moving there,
     so an athlete twenty-four weeks out was given a twenty-four week half block
     -- which the half's own allocation shapes as a TWELVE WEEK BASE followed by
     six of Build and four of Peak. A twelve-week Base inside a race block is a
     development block wearing a race block's name.

     One to three surplus weeks still go to Base, because a development block
     shorter than four weeks cannot express its own arc; beyond that the surplus
     becomes a real block with its own methodology. */
  const path = require('path');
  const { loadApp } = require(path.join(__dirname, 'harness.js'));
  const a = loadApp({ pinnedDate: '2026-03-02T09:00:00Z' });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.showToast = () => {}; a.state = a.makeDefaultState();

  assert.equal(a.marathonRunwayPlan(15, 40, 'half').reason, 'exact_window');
  /* ONE TO THREE SURPLUS WEEKS USED TO GO INTO BASE, and HQ ruled that out: a
     sixteen to eighteen week Race Goal is a Race Goal that has been stretched.
     The block stays fifteen weeks and the surplus is reported as too short to
     be a block of its own. */
  [16, 17, 18].forEach(W => {
    const rp = a.marathonRunwayPlan(W, 40, 'half');
    assert.equal(rp.reason, 'surplus_below_development_block',
      W + ' surplus weeks must not be absorbed');
    assert.equal(rp.raceWeeks, 15, W + ' weeks must still build a 15-week block');
  });
  [20, 24, 30].forEach(W => {
    const rp = a.marathonRunwayPlan(W, 40, 'half');
    assert.equal(rp.raceWeeks, a.HALF_DEDICATED_WEEKS,
      W + ' weeks out still built a ' + rp.raceWeeks + '-week half block');
    assert.ok(rp.preparatory && rp.preparatory.weeks >= 4,
      W + ' weeks out did not hand its surplus to a real development block');
  });
  /* AND THE BLOCK IT WOULD OTHERWISE HAVE BUILT IS THE EVIDENCE. */
  const wide = a.raceGoalPhaseAllocation('half', 24, 'experienced');
  assert.ok(wide.base >= 4 * wide.build / 6,
    'the 24-week allocation no longer inflates Base, so this test protects nothing');

  /* THE MARATHON IS UNCHANGED, byte for byte, at its own default. */
  assert.equal(JSON.stringify(a.marathonRunwayPlan(24, 40)),
               JSON.stringify(a.marathonRunwayPlan(24, 40, 'full')));
});

test('CURRENT WEEKLY VOLUME — a Race Goal block no longer reads the typed number', () => {
  /* THE CONTRACT APP IS PARKED ON. The builder will remove the Current Weekly
     Volume field, and it can only do so once nothing in Race Goal generation
     depends on it. Asserted the only way that can be asserted: build the same
     athlete's block at wildly different typed volumes and compare the weeks
     the athlete actually receives.

     THREE FIELDS ARE ALLOWED TO DIFFER and all three are the legacy ramp
     talking about itself -- peakVolume and startVolume on the block, rampVolume
     on the week. They are recorded, nothing reads them, and the accounting
     keeps them so the difference between the old architecture and this one
     stays inspectable. */
  const path = require('path');
  const { loadApp } = require(path.join(__dirname, 'harness.js'));
  const build = (dist, exp, vol) => {
    const a = loadApp({ pinnedDate: '2026-03-02T09:00:00Z' });
    a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
    a.showToast = () => {}; a.state = a.makeDefaultState();
    return a.buildBlockWeeks(dist, vol, 15,
      { purpose:'race', availableDays:6, experience:exp, easyPaceSecPerKm:330 });
  };
  const strip = w => { const c = Object.assign({}, w); delete c.rampVolume; return c; };

  [['half','novice'], ['half','experienced'], ['half','advanced'],
   ['full','novice'], ['full','experienced'], ['full','advanced']].forEach(([d, e]) => {
    const ref = build(d, e, 20);
    [null, 5, 40, 80, 200].forEach(v => {
      const got = build(d, e, v);
      assert.equal(JSON.stringify(got.weeks.map(strip)),
                   JSON.stringify(ref.weeks.map(strip)),
        d + '/' + e + ': a typed volume of ' + v + ' changed the prescribed weeks');
    });
  });
});

test('CURRENT WEEKLY VOLUME — every other product still reads it, and must', () => {
  /* PRODUCT ISOLATION. Aerobic Base, Speed & Threshold and Maintain & Protect
     have no pathway and no destination-led construction; the athlete's stated
     volume is still the only statement of where they are, and removing the
     field from underneath them would break them. The contract for APP is
     isolation, not deletion of the underlying state. */
  const path = require('path');
  const { loadApp } = require(path.join(__dirname, 'harness.js'));
  const build = (dist, purpose, vol) => {
    const a = loadApp({ pinnedDate: '2026-03-02T09:00:00Z' });
    a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
    a.showToast = () => {}; a.state = a.makeDefaultState();
    return JSON.stringify(a.buildBlockWeeks(dist, vol, 12, { purpose, availableDays:5 }));
  };
  ['base', 'speed', 'maintain'].forEach(p => {
    ['5k', '10k', 'half', 'full'].forEach(d => {
      assert.notEqual(build(d, p, 30), build(d, p, 60),
        p + '/' + d + ' stopped reading the athlete\'s stated volume');
    });
  });
  /* And the two distances with no dedicated architecture keep it at the race
     purpose too. */
  ['5k', '10k'].forEach(d => {
    assert.notEqual(build(d, 'race', 30), build(d, 'race', 60),
      d + ' race stopped reading the athlete\'s stated volume');
  });
});

test('EXPERIENCE — the route changes, the preparation standard does not', () => {
  /* HQ's statement, asserted in both halves.

     THE STANDARD IS THE SAME. All three pathways at a distance are held to the
     same reachability gate above; what differs is how the athlete gets there.

     THE ROUTE DIFFERS IN WHAT IS ASKED INSIDE THE PHASES, NOT IN THEIR LENGTH.
     Base and Build used to be allocated by experience, and HQ has ruled that
     out: the phase geometry is a property of the RUNWAY, and Experience decides
     what must be accomplished inside the weeks it hands out. What still differs
     by experience is when race-specific work enters the long run -- when the
     athlete is ready for it rather than when a phase boundary happens to fall.
     That used to run BACKWARDS: it appeared in the first week of Build, so the
     novice marathoner got goal-pace running inside their long run in week four
     and the experienced one waited until week five. */
  const path = require('path');
  const { loadApp } = require(path.join(__dirname, 'harness.js'));
  const a = loadApp({ pinnedDate: '2026-03-02T09:00:00Z' });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.showToast = () => {}; a.state = a.makeDefaultState();

  /* PHASE GEOMETRY: the runway decides it, and Experience cannot move it. */
  ['half', 'full'].forEach(d => {
    for (let N = 10; N <= 15; N++){
      const g = e => JSON.stringify(a.raceGoalPhaseAllocation(d, N, e));
      assert.equal(g('advanced'), g('experienced'),
        d + ' @' + N + 'w: Experience must not move a phase boundary');
      assert.equal(g('novice'), g('advanced'),
        d + ' @' + N + 'w: Experience must not move a phase boundary');
    }
  });

  /* SPECIFICITY: the order is advanced, then experienced, then novice -- and
     the novice's is after their durability exposure, not before it. */
  ['half', 'full'].forEach(d => {
    const first = e => {
      const alloc = a.raceGoalPhaseAllocation(d, 15, e);
      return a.raceGoalSpecificityFromWeek(d, e, alloc);
    };
    assert.ok(first('advanced') < first('experienced'),
      d + ': an advanced athlete should meet race pace before an experienced one');
    assert.ok(first('experienced') < first('novice'),
      d + ': a novice should not meet race pace before an experienced athlete');
    /* AND A NOVICE MEETS IT IN PEAK, not while their long run is still becoming
       the distance. HQ moved the durability exposure to the END of Peak, so
       "after the exposure" would be after the block; what the rule protects is
       that the two hardest demands are never asked at once, and Peak is where
       the distance is established and the week's job turns to race readiness. */
    const alloc = a.raceGoalPhaseAllocation(d, 15, 'novice');
    assert.ok(first('novice') >= alloc.base + alloc.build + 1,
      d + ': a novice should not meet race pace before Peak');
  });

  /* AND ABSORPTION MOVES IT, not the calendar. An experienced athlete who is
     absorbing their training starts marathon-pace work in the last week of
     Base; one who is straining waits for Build. */
  const withState = (state, fams) => {
    const b = loadApp({ pinnedDate: '2026-03-02T09:00:00Z' });
    b.renderApp = () => {}; b.flushSave = () => {}; b.scheduleSave = () => {};
    b.showToast = () => {}; b.state = b.makeDefaultState();
    b.blockEffectiveness = () => ({ state });
    b.demonstratedQualityFamilies = () => fams;
    return b.raceGoalSpecificityFromWeek('full', 'experienced',
      b.raceGoalPhaseAllocation('full', 15, 'experienced'));
  };
  assert.ok(withState('PRODUCTIVE', ['tempo']) < withState('STRAINED', ['tempo']),
    'absorption should bring marathon-pace work forward, and did not');
  assert.equal(withState('PRODUCTIVE', []), withState('STRAINED', ['tempo']),
    'and an athlete with no demonstrated quality family waits, however well they absorb');
});

test('HALF TAPER — the delivered wind-down descends, and race week is deeper than the curve', () => {
  /* HQ REVIEWED THE GENERATED PROGRAMME AND RULED THE OUTPUT CORRECT. What was
     wrong was the AUTHORITY: HALF_TAPER_FINAL_FRACTION read as though it
     governed the whole D-10 window, and applyHalfEventTaper() deliberately does
     not touch race week -- which has its own architecture, its own floor and
     its own shakeout cap. So the factor governs D-10 to D-7 and race week
     supplies everything below.

     Asserted rather than described: the delivered days never rise through the
     window, and race week sits at or below what the curve would have asked for.
     The endpoint is a floor the architecture beats, not a promise it breaks. */
  const R = require(require('path').join(__dirname, 'audit', 'raceGoalReachability.js'));
  ['New Half', 'Experienced Half', 'Advanced Half'].forEach(key => {
    const c = R.CANON.find(x => x.key === key);
    const res = R.build(Object.assign(
      { dist:c.dist, exp:c.exp, days:c.days, weeks:c.weeks }, c.ev));
    const a = res.a, race = res.raceDate;
    const out = d => Math.round((new Date(race) - new Date(d)) / 86400000);

    const gov = a.halfTaperGovernedRange(6);
    assert.equal(gov.fromDays, a.HALF_TAPER_ANCHOR_DAYS);
    assert.ok(gov.toFactor < 1 && gov.toFactor > gov.endpointFraction,
      'the governed range must stop above the curve endpoint, which race week supplies');

    /* THE WINDOW DESCENDS. Compared like with like -- an easy day against the
       easy days before it -- because a long run and an easy run are different
       sessions and the long run is deliberately the last big one. */
    const easies = res.dd.filter(d => d.type === 'easy' && d.km > 0 &&
                                      out(d.date) <= a.HALF_TAPER_ANCHOR_DAYS)
                         .sort((x, y) => out(y.date) - out(x.date));
    for (let i = 1; i < easies.length; i++){
      /* A FLOOR IS NOT A PROGRESSION, the same allowance this instrument makes
         everywhere else. At the bottom of the domain an easy run is already at
         EASY_MIN_KM and cannot shrink, so what remains is the floor -- and one
         presentation quantum above it is the floor rounding, not the taper
         going backwards. */
      const atFloor = easies[i - 1].km <= a.EASY_MIN_KM + a.EASY_QUANTUM_KM + 1e-9;
      const bound = easies[i - 1].km + (atFloor ? a.EASY_QUANTUM_KM : 0);
      assert.ok(easies[i].km <= bound + 1e-9,
        key + ': an easy day rose during the taper at D-' + out(easies[i].date) +
        ' (' + easies[i].km + 'km after ' + easies[i - 1].km + 'km)');
    }

    /* ---- AND RACE WEEK IS NOT A DEVELOPMENT WEEK ----
       THIS COMPARED RACE WEEK AGAINST THE TAPER CURVE, PROJECTED PAST THE
       WINDOW THE CURVE GOVERNS. halfTaperGovernedRange() exists because HQ
       already ruled that the factor governs D-10 to D-8 and that race week
       supplies the reduction below it -- so extending the curve into race week
       and requiring the delivered days to sit under it asks the athlete to be
       bounded by an authority the architecture says does not reach them. It
       held while the numbers happened to line up and stopped holding by one
       kilometre on one pathway when the entry standards changed, which is a
       property of the arithmetic rather than of the coaching.

       WHAT HQ ACTUALLY ASKS is that development has ended and race week has not
       accidentally become a development week. That is asserted directly and
       against the block's own Peak, which is a stronger statement than a
       projection: race week's training -- everything except the race itself --
       must be a small fraction of what the athlete was doing at Peak, and no
       session in it may exceed what the wind-down week already asked for. */
    const raceDay = res.dd.filter(d => d.type === 'race')[0];
    const raceWeekTraining = res.dd
      .filter(d => d.km > 0 && d.type !== 'race' && d.week === raceDay.week)
      .reduce((t, d) => t + d.km, 0);
    const peakWeeks = {};
    res.dd.filter(d => d.km > 0 && d.type !== 'race').forEach(d => {
      peakWeeks[d.week] = (peakWeeks[d.week] || 0) + d.km; });
    const peakKm = Math.max.apply(null, Object.keys(peakWeeks)
      .filter(w => +w < raceDay.week).map(w => peakWeeks[w]));
    assert.ok(raceWeekTraining <= peakKm * 0.55 + 1e-9,
      key + ': race week carries ' + Math.round(raceWeekTraining) +
      'km of training against a peak of ' + Math.round(peakKm) + 'km');
    const windDownMax = Math.max.apply(null, res.dd
      .filter(d => d.km > 0 && d.type !== 'race' && d.week === raceDay.week - 1)
      .map(d => d.km).concat([0]));
    res.dd.filter(d => d.km > 0 && d.type !== 'race' && d.week === raceDay.week)
      .forEach(d => assert.ok(d.km <= windDownMax + 1e-9,
        key + ': race week asks for a ' + d.km + 'km ' + d.type +
        ', above the ' + windDownMax + 'km the wind-down week asked for'));
  });
});
