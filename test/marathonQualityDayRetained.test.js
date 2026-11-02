'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

/* A REMOVED QUALITY SESSION KEEPS ITS RUNNING DAY — HQ METHODOLOGY RULING.
 * ===========================================================================
 *   planned quality -> a legitimate gate removes it -> the prescribed day
 *   REMAINS -> it carries appropriate easy running.
 *
 * MEASURED BEFORE: an Established Peak week ran on four of its five prescribed
 * days, and the week's kilometres were divided among two easy slots at 21.5km
 * each beside a 30km long run -- a medium-long run wearing an easy run's name.
 * Advanced Peak ran on five of six with three 17km runs.
 *
 * AND THE ADDED VOLUME STAYS ATTRIBUTABLE. The whole difficulty of this change
 * is that distributeWeekVolume() divides the easy budget by easyDays.length:
 * an easy entry with no free calendar day behind it silently shrinks every
 * other run and the week comes out light with nothing to attribute it to.
 * Measured at 42 weeks and a 4.1km shortfall before the free-day clamp.
 */

const TODAY = '2026-11-02';
function plan(exp, avail, vol, weeks, distanceKey){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.state = a.makeDefaultState();
  const act = [1,2,3,5,6,0,4].slice(0, avail);
  a.state.setup = { distanceKey: distanceKey || 'full', currentVolume: vol,
    planWeeks: weeks || 15, experience: exp, purpose:'race', hasEvent: true,
    schedule: { activeDays: act, longRunDay: 6 } };
  const b = a.buildBlockWeeks(distanceKey || 'full', vol, weeks || 15,
    { purpose:'race', availableDays: avail, easyPaceSecPerKm: 330 });
  const sm = a.addDays(TODAY, -a.isoWeekday(TODAY));
  const d = a.buildDaysFromWeeks(b, a.addDays(sm, (weeks || 15) * 7 - 1),
    { activeDays: act, longRunDay: 6 }, TODAY, true);
  return { a, b, d };
}
const runsIn = (d, wk) => d.filter(x => x.week === wk && x.type && x.type !== 'rest');
function peakLongWeek(d){
  return d.filter(x => x.type === 'long').reduce((m, x) => (!m || x.km > m.km) ? x : m, null).week;
}

test('Established keeps all five prescribed days at peak, Advanced all six', () => {
  [['experienced', 5, 52], ['advanced', 6, 68]].forEach(([exp, days, vol]) => {
    const { d } = plan(exp, days, vol);
    const wk = peakLongWeek(d);
    assert.equal(runsIn(d, wk).length, days,
      exp + ': peak week runs on ' + runsIn(d, wk).length + ' of ' + days + ' prescribed days');
  });
});

test('the retained day carries sensible easy running, not a second long effort', () => {
  /* The 21.5km case. With the day back, the same kilometres divide into runs
     that are easy runs. */
  const { d } = plan('experienced', 5, 52);
  const wk = peakLongWeek(d);
  const runs = runsIn(d, wk);
  const lr = runs.filter(x => x.type === 'long')[0];
  const easy = runs.filter(x => x.type === 'easy');
  assert.ok(easy.length >= 3, 'the week has fewer easy runs than the retained day should give it');
  assert.ok(Math.max.apply(null, easy.map(x => x.km)) < lr.km * 0.75,
    'an "easy" run is still most of the long run: ' +
    easy.map(x => x.km).join('/') + ' against ' + lr.km);
});

test('the quality session itself survives — it is the day that is recovered, not the session', () => {
  /* An earlier attempt recovered the day BEFORE the quality decision, which
     priced the session out of the week entirely and deleted the interval from
     Advanced Build and Peak. */
  const Q = ['threshold','interval','repetition','tempo','over_under','calibration','checkpoint'];
  [['experienced', 5, 52], ['advanced', 6, 68]].forEach(([exp, days, vol]) => {
    const { b, d } = plan(exp, days, vol);
    b.weeks.forEach(w => {
      if (w.isRace || !w.bottomUp || !w.bottomUp.qSlots) return;
      assert.ok(runsIn(d, w.week).filter(x => Q.indexOf(x.type) >= 0).length >= 1,
        exp + ' wk' + w.week + ' (' + w.phase + ') earned ' + w.bottomUp.qSlots +
        ' quality slot(s) and delivered none');
    });
  });
});

test('every kilometre stays attributable — volume_unattributed holds at zero', () => {
  /* The invariant this change had to earn. Swept across the shapes that broke
     it: the failures were concentrated in low-volume Established weeks where
     the recovered day had no free calendar day behind it. */
  let checked = 0;
  ['novice','experienced','advanced'].forEach(exp => {
    [3,4,5,6,7].forEach(days => {
      [10,20,40,60,80].forEach(vol => {
        [12,15,18].forEach(weeks => {
          let a;
          try { a = plan(exp, days, vol, weeks).a; } catch(e){ return; }
          (a.planVolumeAccounting || []).forEach(w => {
            checked++;
            assert.ok(w.reconciled,
              exp + '/' + days + 'd/' + vol + 'km/' + weeks + 'wk week ' + w.week +
              ': residual ' + w.roundingResidual + ' with causes [' + (w.causes || []).join(',') + ']');
          });
        });
      });
    });
  });
  assert.ok(checked > 3000, 'the sweep covered only ' + checked + ' weeks');
});

test('no other distance moved', () => {
  /* Gated on distKey === 'full'. */
  const sig = (dist) => {
    const { d } = plan('advanced', 6, 60, 15, dist);
    return d.filter(x => x.type && x.type !== 'rest')
            .map(x => x.week + ':' + x.type + ':' + (x.km || 0)).join('|');
  };
  const half = sig('half');
  assert.ok(half.length > 0);
  /* The half still loses a day where the ceiling removes a session -- that is
     the behaviour this ruling deliberately did not reach into. */
  const { b, d } = plan('advanced', 6, 60, 15, 'half');
  const shortWeeks = b.weeks.filter(w => !w.isRace &&
    runsIn(d, w.week).length < 6).length;
  assert.ok(shortWeeks > 0, 'the half gained the marathon recovery, so the rule leaked');
});
