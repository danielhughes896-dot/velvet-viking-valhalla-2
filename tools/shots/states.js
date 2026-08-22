'use strict';
/* THE ATHLETES THE SCREENSHOTS ARE OF.
 *
 * Built through the app's own generator -- buildBlockWeeks, buildDaysFromWeeks,
 * coachPersistReview -- rather than hand-written, so what is photographed is
 * what the product actually produces. Each scenario is serialised to the same
 * shape the app writes to localStorage, and the capture script injects it
 * before the page boots.
 *
 * Everything is pinned to one date so the set is reproducible: run it twice and
 * you get the same pixels, which is the only way a visual diff means anything.
 */
const path = require('path');
const { loadApp } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));
const { buildPlan, logAsPrescribed } = require(path.join(__dirname, '..', '..', 'test', 'fixtures.js'));

const TODAY = '2026-08-21';

function engine(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  return a;
}
/* A block of the given purpose, with the weeks before today actually trained.
   `purpose` drives the generator exactly as startDevelopmentBlock does. */
function block(purpose, opts){
  const o = opts || {};
  const a = engine();
  const weeks = o.weeks || 12;
  const startDate = a.addDays(TODAY, -(o.elapsedWeeks != null ? o.elapsedWeeks : 4) * 7);
  buildPlan(a, { weeks, startDate, distanceKey: o.distanceKey || 'half',
                 volume: o.volume || 55, benchSec: 45 * 60, lthr: 165, maxHR: 190,
                 schedule: { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 } });

  // Rebuild the days under the real purpose, which is what changes the arc.
  const startMonday = a.addDays(startDate, -a.isoWeekday(startDate));
  const goalDate = a.addDays(startMonday, weeks * 7 - 1);
  const br = a.buildBlockWeeks(o.distanceKey || 'half', o.volume || 55, weeks,
    { purpose, steady: purpose === 'maintain', rotation: o.rotation || 0 });
  a.state.days = a.buildDaysFromWeeks(br, goalDate, a.state.setup.schedule, startDate, false);
  a.state.setup.purpose = purpose;
  a.state.setup.raceDate = goalDate;
  a.state.setup.planWeeks = br.planWeeks;
  a.state.setup.hasEvent = false;
  a.state.athlete = a.makeAthleteRecord();
  const b = a.openBlock({ purpose, startDate, distanceKey: o.distanceKey || 'half',
                          goalDate, hasEvent: false });
  a.state.setup.blockId = b.id;

  if (purpose === 'recovery' && o.priorRaceDate)
    a.state.days = a.applyRecoveryCeiling(a.state.days, o.priorRaceDate, 10);

  a.state.days.filter(d => d.date < TODAY && d.type !== 'rest')
    .forEach(dd => logAsPrescribed(a, dd, { quality: o.quality != null ? o.quality : 1 }));
  a.state.view = 'today';
  return a;
}

/* The one scenario that is not a training block: a race that has just been
   run, so the post-race transition offer is on screen. */
function postRace(){
  const a = block('race', { weeks: 12, elapsedWeeks: 12, distanceKey: 'half' });
  const raceDay = a.state.days.filter(d => d.type === 'race')[0];
  if (raceDay){
    logAsPrescribed(a, raceDay);
    try { a.recordRaceOutcome('raced'); } catch (e) {}
  }
  a.state.view = 'today';
  return a;
}

const SCENARIOS = {
  race:     () => block('race',     { weeks: 12, distanceKey: 'half' }),
  maintain: () => block('maintain', { weeks: 8,  distanceKey: 'half', elapsedWeeks: 3 }),
  base:     () => block('base',     { weeks: 10, distanceKey: 'half', elapsedWeeks: 3 }),
  speed:    () => block('speed',    { weeks: 6,  distanceKey: '5k',   elapsedWeeks: 2 }),
  recovery: () => block('recovery', { weeks: 2,  distanceKey: 'half', elapsedWeeks: 1,
                                      priorRaceDate: '2026-08-16' }),
  postrace: postRace,
};

function serialise(a){
  return { storageKey: a.STORAGE_KEY, state: JSON.parse(JSON.stringify(a.state)) };
}

module.exports = { SCENARIOS, serialise, TODAY };

if (require.main === module){
  const out = {};
  Object.keys(SCENARIOS).forEach(k => {
    const a = SCENARIOS[k]();
    out[k] = serialise(a);
    const days = a.state.days.filter(d => d.type !== 'rest').length;
    console.log(k.padEnd(10) + ' ' + a.state.setup.purpose.padEnd(9) +
                ' weeks=' + a.state.setup.planWeeks + ' sessions=' + days);
  });
  require('fs').writeFileSync(path.join(__dirname, 'states.json'), JSON.stringify(out));
  console.log('\nwrote ' + path.join(__dirname, 'states.json'));
}
