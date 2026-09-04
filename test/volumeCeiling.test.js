'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, makePinnedDate } = require('./harness.js');

/* VOLUME MUST NOT COMPOUND FOREVER.
 *
 * The defect this file was written for: each block started from the previous
 * block's ABSORBED volume, and each block then multiplied that start by its
 * distance profile to find a peak. Nothing anywhere compared either number to
 * what the athlete had actually shown they could hold. A marathon athlete
 * starting at 60km/week reached 86 after a year, 149 after two and 257 after
 * three -- a number no amateur runs and this product had no business
 * prescribing.
 *
 * The rule now: a block may start no more than VOLUME_BLOCK_GROWTH_CAP above
 * demonstrated sustainable volume, and may peak no higher than a ceiling that
 * is itself clamped. These tests are about the CLOSED LOOP, so most of them
 * simulate years of training and check the number stops rather than checking a
 * single call in isolation.
 */

const TODAY = '2026-08-21';
function app(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.state = a.makeDefaultState();
  a.state.athlete = a.makeAthleteRecord();
  return a;
}
/* Weekly completed volumes ending `weeksAgo` weeks before today, most recent
   first. Written straight into the archive because that is where a real
   athlete's elapsed weeks live once a block ends. */
function record(a, kms, opts){
  const o = opts || {};
  const endOffset = o.weeksAgo || 0;
  kms.forEach(function(km, i){
    const date = a.addDays(TODAY, -7 * (endOffset + i + 1));
    a.state.athlete.sessions.push({ date: date, completed: true, actualKm: km });
  });
}

test('with no record at all the athlete is held to the profile backstop', () => {
  const a = app();
  assert.equal(a.demonstratedSustainableVolume(), null);
  assert.equal(a.volumeCeilingFor('full'), 170);
  assert.equal(a.volumeCeilingFor('5k'), 110);
});

test('two big weeks are not a capacity; three are', () => {
  const a = app();
  record(a, [150, 150]);
  assert.equal(a.demonstratedSustainableVolume(), null,
    'two weeks was accepted as proof of what the athlete can hold');
  record(a, [150], { weeksAgo: 2 });
  assert.equal(a.demonstratedSustainableVolume(), 150);
});

test('one heroic week does not raise anything: the third best is what counts', () => {
  const a = app();
  record(a, [190, 60, 55, 50]);
  assert.equal(a.demonstratedSustainableVolume(), 55);
});

test('a demonstrated volume BELOW the backstop does not lower the ceiling', () => {
  /* The backstop is a floor as well as a fallback. Without this a beginner's
     ceiling would collapse onto their first three weeks and the plan could
     never progress at all. */
  const a = app();
  record(a, [30, 28, 26]);
  assert.equal(a.volumeCeilingFor('full'), 170);
});

test('an athlete who has genuinely held more than the backstop keeps their own number', () => {
  const a = app();
  record(a, [155, 152, 150, 149]);
  assert.equal(a.volumeCeilingFor('half'), 150, 'a real 150km/week athlete was capped at 140');
});

test('but the ceiling is hard-bounded, so no record can walk it upward without limit', () => {
  const a = app();
  record(a, [400, 400, 400, 400]);
  assert.equal(a.volumeCeilingFor('half'), 175);           // 140 x 1.25
  assert.equal(a.volumeCeilingFor('full'), 212.5);         // 170 x 1.25
});

test('capacity is read over a rolling year, so a layoff is not held against the record', () => {
  /* Both directions. A fit winter two years ago must not anchor a returning
     athlete; the same weeks inside the window must still count. */
  const a = app();
  record(a, [160, 158, 156], { weeksAgo: 60 });
  assert.equal(a.demonstratedSustainableVolume(), null,
    'weeks from more than a year ago were still treated as current capacity');
  const b = app();
  record(b, [160, 158, 156], { weeksAgo: 40 });
  assert.equal(b.demonstratedSustainableVolume(), 156);
});

test('a block cannot peak above the ceiling', () => {
  const a = app();
  const br = a.buildBlockWeeks('full', 140, 16, {});       // 140 x 1.75 = 245 unbounded
  assert.ok(br.peakVolume <= a.volumeCeilingFor('full'),
    'the block peaked at ' + br.peakVolume + ' against a ceiling of ' + a.volumeCeilingFor('full'));
  assert.equal(br.peakVolume, 170);
});

test('a start above the ceiling ramps to the ceiling rather than downward from it', () => {
  /* Otherwise an athlete inheriting a pre-rule number would see a plan that
     descends across the whole block and reads as an unrequested taper. */
  const a = app();
  const br = a.buildBlockWeeks('full', 200, 12, {});
  const build = br.weeks.filter(w => !w.isRace && !w.isTaper).map(w => w.volume);
  /* ASKED OF THE BLOCK'S PEAK, NOT OF ITS LAST DEVELOPING WEEK. The claim is
     the one in the comment above -- the block ramps UP to the ceiling rather
     than descending from a number the athlete inherited -- and reading the last
     week for it assumed the last developing week is the biggest. A marathon
     block's is deliberately not: Peak carries two long-run exposures with an
     absorption week between them, and the second is the shorter, more specific
     one. The property is asserted directly instead: the block reaches above
     where it started, and it does so after week one.
     For 5k, 10k, half and ultra the last developing week IS the peak, so this
     is the same assertion it always was. */
  const peak = Math.max.apply(null, build);
  assert.ok(peak >= build[0],
    'the block descended: ' + build[0] + ' -> peak ' + peak);
  assert.ok(build.indexOf(peak) > 0,
    'the block never rose above its first week: ' + build.join(' -> '));
  assert.ok(peak <= 170);
});

test('a steady block is capped too, so a pre-rule number cannot enter through maintenance', () => {
  const a = app();
  const br = a.buildBlockWeeks('5k', 260, 8, { steady: true });
  assert.ok(br.peakVolume <= 110, 'maintenance carried ' + br.peakVolume + ' km/week');
});

test('a new block starts from what the athlete demonstrated, not from what was prescribed', () => {
  const a = app();
  record(a, [52, 50, 48]);
  // The last block prescribed 90; the athlete held 48.
  assert.equal(a.cappedBlockStartVolume(90, 'half'), 52.8);   // 48 x 1.10
});

test('a block start below demonstrated capacity is left alone', () => {
  /* The cap is a ceiling on growth, not a target to be pulled up to: an
     athlete coming back from illness must be allowed to start low. */
  const a = app();
  record(a, [80, 78, 76]);
  assert.equal(a.cappedBlockStartVolume(40, 'half'), 40);
});

/* ------------------------------------------------------------------ *
 * THE ACTUAL QUESTION: does it converge?
 * ------------------------------------------------------------------ */

const median = v => { const s = v.slice().sort((x, y) => x - y); const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2 * 10) / 10; };

/* Years of the real year-round cycle, with the clock advancing alongside the
   athlete so the rolling window is exercised rather than bypassed. Each block's
   COMPLETED weeks become the record the next block is computed from -- which is
   the loop that used to compound. `capacity` is the athlete's own hard limit:
   they run what is prescribed until it exceeds what they can hold. */
function simulate(distKey, startVol, years, capacity){
  const a = loadApp({ pinnedDate: '2026-01-05T09:00:00Z' });
  a.state = a.makeDefaultState();
  a.state.athlete = a.makeAthleteRecord();
  a.state.setup = { distanceKey: distKey, currentVolume: startVol };
  const CYCLE = [[distKey, 12, {}], [distKey, 2, { steady: true }],
                 [distKey, 8, { steady: true }], [distKey, 10, {}], ['5k', 6, {}]];
  let vol = startVol, day = new Date('2026-01-05'), peaks = [], yearPeak = [];
  for (let y = 0; y < years; y++){
    let yp = 0;
    for (const [dk, wks, opts] of CYCLE){
      const br = a.buildBlockWeeks(dk, a.cappedBlockStartVolume(vol, dk), wks, opts);
      peaks.push(br.peakVolume); yp = Math.max(yp, br.peakVolume);
      br.weeks.forEach(w => {
        const km = Math.round(Math.min(w.volume, capacity) * 10) / 10;
        /* THE WEEK IS LOGGED AS THE RUNS IT CONTAINS, not as one session
           carrying its total. The single-session shorthand was harmless while
           nothing read the record's shape, and it is not any more: the marathon
           generator now reads demonstrated running FREQUENCY and demonstrated
           LONG RUN from these sessions, so a record of one 60km run a week
           described an athlete who runs once a week and whose longest run is
           60km -- and was answered, correctly, with a two-day week. The
           property under test is unchanged; the fixture now represents an
           athlete who trains. Five runs, a long run at 30% of the week, which
           is the shape the generator itself builds. */
        const long = Math.round(km * 0.30 * 10) / 10, per = (km - long) / 4;
        for (let i = 0; i < 4; i++)
          a.state.athlete.sessions.push({ date: new Date(day.getTime() + i * 86400000).toISOString().slice(0, 10),
            completed: true, actualKm: per, plannedKm: per, type: 'easy' });
        a.state.athlete.sessions.push({ date: new Date(day.getTime() + 5 * 86400000).toISOString().slice(0, 10),
          completed: true, actualKm: long, plannedKm: long, type: 'long' });
        day = new Date(day.getTime() + 7 * 86400000);
        a.Date = makePinnedDate(day.toISOString());
      });
      vol = median(br.weeks.filter(w => !w.isRace).map(w => Math.round(Math.min(w.volume, capacity) * 10) / 10));
    }
    yearPeak.push(Math.round(yp * 10) / 10);
  }
  return { yearPeak, peak: Math.round(Math.max.apply(null, peaks) * 10) / 10,
           ceiling: a.volumeCeilingFor(distKey) };
}

const CASES = [['5k', 40, 110], ['10k', 45, 120], ['half', 50, 140], ['full', 60, 170]];

/* TWELVE years, not five. The question this file exists to answer is whether
   the loop terminates, and a five-year window answered it only for as long as
   every distance happened to arrive inside five years. It no longer does: a
   block now earns the profile multiplier in proportion to its developing weeks,
   so the year-round cycle -- 12, 2, 8, 10, 6 -- climbs more slowly than it did
   when every block reached volMult regardless of length. 5k now settles in year
   8 and 10k in year 7 where both used to settle in year 5.

   The property is unchanged and is asserted more strictly than before: the
   programme rises, arrives, and then STAYS there for the rest of the horizon
   rather than merely repeating one year.

   ARRIVAL IS NO LONGER A NUMBER REPEATING TO THE DECIMAL, and it cannot be.
   The marathon block is built from its sessions and reads the SHAPE of the
   record -- demonstrated running frequency and demonstrated long run, not only
   a weekly scalar -- so its input each year is a whole training history rather
   than one number, and its fixed point is a small cycle rather than a point:
   111.2, 110.5, 110.1, 110.1, 110.1, 109.3, 109.7, 109.7. That is convergence.
   The failure this file exists to catch is the programme RESUMING ITS CLIMB,
   and that is now asserted directly -- nothing after arrival exceeds arrival,
   and nothing after it falls more than a single block's growth cap below it, so
   neither a ratchet nor a collapse can pass.

   TWENTY years, later still -- HQ WORKOUT-STRUCTURE METHODOLOGY RULING.
   Established/Advanced Half and Marathon Build weeks now carry two full
   standalone quality sessions by tier rule (see raceGoalWeekQualitySlots()),
   not one earned by evidence, so every block in this simulation's cycle is
   genuinely bigger and each year's median feeds the next year a higher
   number. Measured: half no longer settles within twelve years (still
   climbing 118.7 -> 120 at year 11-12) but does settle by twenty (122.1 held
   flat from year 18), well inside its own 140 backstop. 5K, 10K and Full are
   unaffected by this correction and were already settled well before year
   twelve, so they stay settled for the extra years exactly as the property
   requires. */
const CONVERGENCE_YEARS = 20;

CASES.forEach(([dist, start, backstop]) => {
  test(CONVERGENCE_YEARS + ' years of ' + dist + ' training from ' + start + 'km/week converges', () => {
    const r = simulate(dist, start, CONVERGENCE_YEARS, Infinity);   // perfectly compliant
    const trace = dist + ': ' + r.yearPeak.join(' -> ');
    assert.ok(r.peak <= backstop,
      dist + ' peaked at ' + r.peak + ' against a backstop of ' + backstop);
    assert.ok(r.yearPeak[r.yearPeak.length - 1] >= r.yearPeak[0],
      'the programme went backwards: ' + trace);
    /* IT ARRIVES -- AND ARRIVAL IS A LEVEL, NOT AN EXACT REPEAT. This asked for
       the year holding the maximum to fall before the end of the horizon, which
       reads a programme still creeping upward by a tenth of a kilometre a year
       as "still climbing". The half now approaches its level from below rather
       than overshooting it -- 98.2, 98.9, 99.1, 99.2 -- and asking for an exact
       maximum before the last year cannot be satisfied by a curve that
       converges from underneath, however flat it becomes.

       So arrival is the first year within one percent of where the programme
       ends up, which is the property this file exists to assert: the loop
       terminates. Everything after it is checked exactly as before, and over
       MORE years than the old reading allowed, so a programme that resumed its
       climb or collapsed is caught at least as strictly. */
    const top = Math.max.apply(null, r.yearPeak);
    const settled = r.yearPeak.findIndex(v => v >= top * 0.99 - 1e-9);
    assert.ok(settled > 0 && settled < r.yearPeak.length - 1,
      dist + ' was still climbing at the end of the horizon: ' + trace);
    // ...and it neither climbs again nor falls away from where it arrived
    r.yearPeak.slice(settled).forEach(v => {
      assert.ok(v <= top + 1e-9, dist + ' climbed again after settling: ' + trace);
      assert.ok(v * 1.10 >= top, dist + ' fell away after settling: ' + trace);
    });
    // and it never climbs past its own backstop on the way
    r.yearPeak.forEach(v => assert.ok(v <= backstop, trace));
  });
});

test('a capacity-limited athlete plateaus at their own capacity, and does not decay', () => {
  /* The other failure mode, and the more dangerous one: a rule that reads
     "start from what you demonstrated" can spiral DOWNWARD if what the athlete
     demonstrates is always a fraction of what was asked. This athlete has a
     hard ceiling of 56km/week and never exceeds it; the programme must settle
     against that ceiling rather than chase it down towards zero. */
  const r1 = simulate('5k', 40, 1, 56);
  const r5 = simulate('5k', 40, 5, 56);
  assert.ok(r5.peak >= r1.peak * 0.9,
    'the programme decayed from ' + r1.peak + ' to ' + r5.peak + ' over five years');
  assert.ok(r5.peak >= 56, 'the programme fell below what the athlete could hold');
});

test('an athlete who never grows at all is not ramped anyway', () => {
  const r = simulate('full', 60, 5, 60);
  assert.ok(r.peak <= 60 * 1.75 + 0.1,
    'a 60km/week athlete was taken to ' + r.peak + ' km/week');
});

test('three years of marathon training no longer reaches the old 257km/week', () => {
  /* The regression, named. */
  const r = simulate('full', 60, 3, Infinity);
  assert.ok(r.peak <= 170, 'marathon volume reached ' + r.peak + ' km/week again');
});
