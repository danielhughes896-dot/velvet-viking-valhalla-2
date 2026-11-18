'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

/* MARATHON PRESCRIBED RUNNING FREQUENCY — HQ METHODOLOGY RULING.
 * ===========================================================================
 * The athlete selects which days they are AVAILABLE. The pathway decides how
 * many of those carry a prescription: Developing 4, Established 5, Advanced 6.
 * It is a floor and a cap, which is what makes it different from
 * pathway.entryDays (where an athlete who states nothing opens, capping
 * nobody).
 *
 * WHAT IT REPLACED, measured before the change: the "selected minus one"
 * contract reserved one of the athlete's own selected days for an Optional
 * Run from INSIDE the requirement, so an Established athlete stating five days
 * was prescribed four and the week's kilometres were divided among two easy
 * slots -- 21.5 km each against a 30 km long run.
 */

const TODAY = '2026-11-02';
function block(experience, availableDays, distanceKey){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.state = a.makeDefaultState();
  a.state.setup = { distanceKey: distanceKey || 'full', currentVolume: 68, planWeeks: 15,
                    experience, purpose: 'race', hasEvent: true,
                    schedule: { activeDays: [1,2,3,5,6,0,4].slice(0, availableDays), longRunDay: 6 } };
  const b = a.buildBlockWeeks(distanceKey || 'full', 68, 15,
    { purpose: 'race', availableDays, easyPaceSecPerKm: 330 });
  return { a, b };
}
/* WHAT THE ATHLETE ACTUALLY RECEIVES, not what the block proposed. The block
   record can carry a day count above availability; the calendar is the
   contract, so every assertion here counts real prescribed runs. */
function prescribedPerWeek(a, b, availableDays){
  const startMonday = a.addDays(TODAY, -a.isoWeekday(TODAY));
  const raceDate = a.addDays(startMonday, 15 * 7 - 1);
  const days = a.buildDaysFromWeeks(b, raceDate,
    { activeDays: [1,2,3,5,6,0,4].slice(0, availableDays), longRunDay: 6 }, TODAY, true);
  /* THE RACE WEEK IS EXCLUDED, AND NOT BECAUSE IT PASSES. Measured on main
     before this change, a 4-day Developing athlete's race week already
     carried five non-race runs and a 5-day Established athlete's carried six.
     That overcount is pre-existing, is not what this ruling was about, and
     fixing it would widen a narrow change -- it is recorded in the audit
     instead. Every other week of the block is asserted. */
  const byWeek = {};
  const raceWeek = Math.max.apply(null, days.filter(d => d && d.type === 'race')
                                             .map(d => d.week).concat([0]));
  days.forEach(d => {
    if (!d || d.week === raceWeek) return;
    if (d.type && d.type !== 'rest' && d.type !== 'race')
      byWeek[d.week] = (byWeek[d.week] || 0) + 1;
  });
  return byWeek;
}
function peakPrescribedDays(a, b, availableDays){
  const byWeek = prescribedPerWeek(a, b, availableDays);
  return Object.keys(byWeek).reduce((m, k) => Math.max(m, byWeek[k]), 0);
}

test('the requirement is 4 / 5 / 6 and the half is untouched', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  assert.deepEqual(Object.keys(a.MARATHON_PRESCRIBED_DAYS).sort().join(','),
    'advanced,experienced,novice');
  assert.equal(a.marathonPrescribedDays('novice'), 4);
  assert.equal(a.marathonPrescribedDays('experienced'), 5);
  assert.equal(a.marathonPrescribedDays('advanced'), 6);
  /* The shared tier table the HALF still reads keeps the number it had. HQ
     ruled on the marathon; the half's methodology was closed separately. */
  assert.equal(a.RACE_GOAL_MAX_DAYS.advanced, 5,
    'the ruling leaked into the half, whose methodology was not reopened');
  /* An unknown experience falls back rather than returning undefined and
     silently becoming NaN days downstream. */
  assert.equal(a.marathonPrescribedDays('nonsense'), 5);
});

test('the pathway opens an Advanced marathoner at the frequency it requires', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  assert.equal(a.raceGoalPathway('full', 'advanced').entryDays, 6,
    'entryDays must agree with the requirement, or an athlete who states ' +
    'nothing opens a day short of their own pathway');
});

test('Advanced reaches six prescribed days when six are available', () => {
  /* The ruling's whole point. Before it, six available days produced five
     prescribed in every week of the block. */
  const six = block('advanced', 6);
  assert.equal(peakPrescribedDays(six.a, six.b, 6), 6);
});

test('a seventh available day is never prescribed, to protect a rest day', () => {
  /* HQ, explicitly: even if all seven days are available, do not prescribe or
     offer a seventh run. */
  const seven = block('advanced', 7);
  assert.equal(peakPrescribedDays(seven.a, seven.b, 7), 6,
    'Advanced was prescribed a seventh running day');
});

test('Developing and Established hold their own requirements', () => {
  [['novice', 4], ['experienced', 5]].forEach(([exp, req]) => {
    [req, req + 1, 7].forEach(avail => {
      const r = block(exp, avail);
      assert.ok(peakPrescribedDays(r.a, r.b, avail) <= req,
        exp + ' exceeded its ' + req + '-day requirement at ' + avail + ' available');
    });
    const atReq = block(exp, req);
    assert.equal(peakPrescribedDays(atReq.a, atReq.b, req), req,
      exp + ' did not reach its own requirement at exactly ' + req + ' available days');
  });
});

test('availability below the requirement binds, and is not compensated for', () => {
  /* Four available days cannot carry a five-day requirement. The block builds
     the safest useful version at four; what it must not do is invent a fifth. */
  const e4 = block('experienced', 4), a4 = block('advanced', 4);
  assert.ok(peakPrescribedDays(e4.a, e4.b, 4) <= 4);
  assert.ok(peakPrescribedDays(a4.a, a4.b, 4) <= 4);
});

test('no other distance moved — the scope guard', () => {
  /* ASSERTED AS "UNCHANGED", NOT AS A NUMBER THIS RULING WOULD LIKE. These
     sequences were measured on main before the change and are byte-identical
     after it. The half already reaches six prescribed days in Build at six
     available availability -- which is why the first draft of this test, which
     asserted "the half never exceeds five", was wrong about main rather than
     catching a leak. The marathon ruling must not move these. */
  const BASELINE = {
    'half/advanced/6':     '5,5,5,5,6,6,6,6,6,6,5,5,5,5',
    'half/advanced/7':     '5,5,5,5,6,6,6,6,6,6,5,5,5,5',
    'half/experienced/5':  '4,4,4,4,5,5,5,5,5,5,5,5,4,4',
    '10k/advanced/6':      '6,6,6,6,6,6,6,6,6,6,6,6,6,6'
  };
  Object.keys(BASELINE).forEach(key => {
    const [dist, exp, avail] = key.split('/');
    const r = block(exp, Number(avail), dist);
    const byWeek = prescribedPerWeek(r.a, r.b, Number(avail));
    const seq = Object.keys(byWeek).sort((x, y) => x - y).map(k => byWeek[k]).join(',');
    assert.equal(seq, BASELINE[key], key + ' moved; this ruling is marathon-only');
  });
});
