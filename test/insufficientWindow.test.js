'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

/* CURRENT CAPACITY -> SAFE DEVELOPMENT PATH -> REQUIRED RACE PREPARATION
 * ===========================================================================
 * The audit found 175 low-volume readiness cases of which 32 fell short of the
 * product's own MIN_PEAK_LONG_KM, every one at twelve or sixteen weeks, and
 * insufficient_time never fired.
 *
 * The cause was a MISMATCH, not a missing rule. raceProgrammeViability() asks
 * minViableStartKm() about the whole window; a routed athlete's race block is
 * only what is left after the on-ramp, and a shorter block earns a smaller
 * share of the distance multiplier. So the on-ramp ramped to the volume a
 * twelve-week block needs and handed the athlete to a ten-week one.
 */
function app(){
  const a = loadApp({ pinnedDate: '2026-03-02T09:00:00Z' });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {}; a.showToast = () => {};
  a.state = a.makeDefaultState();
  return a;
}
const DISTS = ['5k', '10k', 'half', 'full', 'ultra'];

test('the on-ramp ramps to what the block it hands over to actually needs', () => {
  const a = app();
  for (const distKey of DISTS)
    for (const volume of [5, 10, 15, 20, 30])
      for (const weeks of [12, 16, 20, 28, 40]){
        const p = a.athletePathway(distKey, volume, weeks);
        if (p.route === 'race_programme' || p.route === 'insufficient_time') continue;
        assert.equal(p.raceBlockStartKm, a.minViableStartKm(distKey, p.raceBlockWeeks),
          distKey + ' ' + volume + 'km/' + weeks + 'w: the destination must be the ' +
          'requirement of the ' + p.raceBlockWeeks + '-week block that follows');
        assert.equal(p.onRampToKm, p.raceBlockStartKm);
      }
});

test('every previously short case now reaches the required peak long run', () => {
  /* The same 175 cases the audit swept, asserted rather than tabulated. */
  const a = app();
  let checked = 0;
  for (const distKey of DISTS)
    for (const volume of [5, 10, 15, 20, 30])
      for (const weeks of [12, 16, 20, 28, 40, 52]){
        const p = a.athletePathway(distKey, volume, weeks);
        if (p.route === 'insufficient_time') continue;
        /* ---- THE ON-RAMP'S HANDOVER IS WHAT THIS ASKS ABOUT ----
           This computed the race block's reach from the TYPED weekly volume
           whenever the athlete got a race programme outright. Destination-led
           construction removed that authority: a half or marathon block opens at
           its pathway's entry week, not at what the athlete typed, so reading
           the typed figure here measures a block nobody is given. Whether a
           dedicated pathway reaches its own destination is asked directly, by
           the reachability gate, which builds the real fifteen-week plan for
           each of the six pathways and measures the capability it establishes.

           What is left here is the question this file was written for, and the
           only one it can still answer: the on-ramp must hand over at a volume
           from which the block that follows reaches the peak long run REQUIRED
           OF IT -- the pathway's own destination where there is one, and
           MIN_PEAK_LONG_KM where there is not. */
        if (p.route === 'race_programme') continue;
        const need = (p.viability && p.viability.peakLongKm > 0)
          ? p.viability.peakLongKm : a.MIN_PEAK_LONG_KM[distKey];
        const reach = a.raceBlockPeakLongKm(distKey, p.raceBlockStartKm, p.raceBlockWeeks);
        checked++;
        assert.ok(reach + 0.05 >= need,
          distKey + ' ' + volume + 'km/' + weeks + 'w reaches ' + reach +
          'km against a required ' + need + 'km');
      }
  assert.ok(checked > 40, 'only ' + checked + ' cases were checked');
});

test('an adequate window is never rejected', () => {
  const a = app();
  for (const distKey of DISTS)
    for (const volume of [5, 10, 15, 20, 30])
      for (const weeks of [20, 24, 28, 40, 52]){
        const p = a.athletePathway(distKey, volume, weeks);
        assert.notEqual(p.route, 'insufficient_time',
          distKey + ' ' + volume + 'km with ' + weeks + ' weeks was rejected: ' + p.reason);
      }
});

test('the requirement is stated, and it is the product\'s own', () => {
  const a = app();
  for (const distKey of DISTS){
    const p = a.athletePathway(distKey, 10, 40);
    assert.equal(p.requiredPeakLongKm, a.MIN_PEAK_LONG_KM[distKey],
      'the pathway names the requirement it is being held to');
  }
  /* And the requirement is inverted through the same expression the builder
     uses to reach it, so the two cannot disagree. */
  for (const distKey of DISTS)
    for (const weeks of [8, 10, 12, 14]){
      const start = a.minViableStartKm(distKey, weeks);
      const reach = a.raceBlockPeakLongKm(distKey, start, weeks);
      assert.ok(Math.abs(reach - a.MIN_PEAK_LONG_KM[distKey]) <= 0.1,
        distKey + '/' + weeks + 'w: starting at the stated minimum reaches ' + reach);
    }
});

test('a genuinely short window is still refused, structurally', () => {
  const a = app();
  /* Below the New Half's locked 15km entry week but above the on-ramp floor, so
     an on-ramp is the whole route -- and four weeks is not enough for one. */
  const short = a.athletePathway('half', 14, 4);
  assert.equal(short.route, 'insufficient_time');
  assert.equal(short.reason, 'not_enough_time_for_an_on_ramp');
  assert.ok(short.minimumWeeks > 4, 'and says how many weeks it would take');
});

test('current mileage does not become a permanent cap on the requirement', () => {
  /* THE ERROR THIS GUARDS AGAINST, which the first version of the check made:
     peakVolume is bounded by volumeCeilingFor() and by demonstrated capacity x
     PEAK_OVER_DEMONSTRATED, and BOTH rise as the athlete trains. Reading them
     into a question about the whole path declared a 25km/week athlete with
     forty weeks insufficient. */
  const a = app();
  const today = a.todayStr();
  const monday = a.addDays(today, -a.isoWeekday(today));
  const sessions = [];
  for (let i = 0; i < 52; i++){
    const m = a.addDays(monday, -7 * (52 - i));
    for (let d = 0; d < 4; d++)
      sessions.push({ date: a.addDays(m, d), completed: true, actualKm: 6, plannedKm: 6 });
  }
  a.state.athlete = { sessions };
  assert.ok(a.demonstratedSustainableVolume() > 0, 'the athlete has real evidence');
  [['half', 25], ['full', 30], ['ultra', 40]].forEach(([distKey, volume]) => {
    const p = a.athletePathway(distKey, volume, 40);
    assert.notEqual(p.route, 'insufficient_time',
      distKey + ': forty weeks is not an insufficient window for a ' + volume +
      'km/week athlete — their capacity is where they START, not where they end');
  });
  /* And the bound is still applied where it belongs: to each block as it is
     built, against the evidence that exists then. */
  const blk = a.buildBlockWeeks('half', 25, 14, {});
  assert.ok(blk.peakVolume <= a.demonstratedSustainableVolume() * a.PEAK_OVER_DEMONSTRATED + 0.05,
    'buildBlockWeeks still bounds the peak by demonstrated capacity');
});

test('Maintain, Base and Speed are not subjected to race-readiness rejection', () => {
  /* athletePathway() answers a RACE question. The other three purposes do not
     culminate in an event and are never routed through it. */
  const a = app();
  ['maintain', 'base', 'speed'].forEach(purpose => {
    const blk = a.buildBlockWeeks('half', 8, 8, { purpose });
    assert.ok(blk.weeks.length > 0, purpose + ' still builds at 8km/week');
    assert.ok(blk.peakVolume > 0);
  });
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const fn = src.slice(src.indexOf('function buildBlockWeeks'));
  assert.equal(fn.slice(0, fn.indexOf('\n}\n')).indexOf('athletePathway'), -1,
    'the builder must not consult the race pathway');
});
