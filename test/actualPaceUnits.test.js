'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// COMPLETED-PACE UNIT CORRECTNESS.
//
// dd.actual.pace is an "m:ss" string typed in whatever unit the athlete was
// looking at. It used to carry no record of WHICH unit, and every read
// resolved that against the selection in force at read time -- so toggling
// km -> mi did not merely mislabel a logged 5:13/km, it reinterpreted the run
// as 5:13/mi (3:14/km) and handed that to the Execution Score.
//
// dd.actual.paceUnit is the fix. It is stamped once at entry and never
// rewritten, so conversion happens only on the way out and a toggle is a pure
// round trip through a value that never moves.
const TODAY = '2026-05-20';
function app(units) {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {};
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -21) });
  a.state.units = units || 'km';
  return a;
}
function logged(a, km, pace) {
  const dd = a.state.days.filter(d => d.type !== 'rest')[0];
  dd.completed = true;
  dd.actual = a.emptyActual();
  a.handleActualFieldChange(dd.id, 'km', String(km));
  a.handleActualFieldChange(dd.id, 'pace', pace);
  return dd;
}

// ---------------------------------------------------------------------------
// THE REPORTED CASE
// ---------------------------------------------------------------------------
test('5:13/km logged in KM displays as ~8:24/mi after toggling to MI', () => {
  const a = app('km');
  const dd = logged(a, 8.1, '5:13');
  assert.equal(a.actualPaceDisplayStr(dd), '5:13');
  a.state.units = 'mi';
  assert.equal(a.actualPaceDisplayStr(dd), '8:24',
    '5:13/km is 8:24/mi -- the label converted but the value did not');
});

test('the reverse conversion returns exactly 5:13/km', () => {
  const a = app('km');
  const dd = logged(a, 8.1, '5:13');
  a.state.units = 'mi';
  assert.equal(a.actualPaceDisplayStr(dd), '8:24');
  a.state.units = 'km';
  assert.equal(a.actualPaceDisplayStr(dd), '5:13');
});

test('8.1 km still reads 5.03 mi -- distance was never the broken half', () => {
  const a = app('km');
  const dd = logged(a, 8.1, '5:13');
  assert.equal(a.kmToDisplay(dd.actual.km), 8.1);
  a.state.units = 'mi';
  assert.equal(a.kmToDisplay(dd.actual.km), 5.03);
});

test('a pace entered in MI is stored as entered and reads back in KM', () => {
  const a = app('mi');
  const dd = logged(a, 5.03, '8:24');
  assert.equal(dd.actual.paceUnit, 'mi');
  assert.equal(a.actualPaceDisplayStr(dd), '8:24');
  a.state.units = 'km';
  assert.equal(a.actualPaceDisplayStr(dd), '5:13');
});

// ---------------------------------------------------------------------------
// NO DRIFT
// ---------------------------------------------------------------------------
test('repeated km/mi toggling never moves the stored value', () => {
  const a = app('km');
  const dd = logged(a, 8.1, '5:13');
  const stored = JSON.stringify(dd.actual);
  for (let i = 0; i < 40; i++) {
    a.state.units = i % 2 ? 'km' : 'mi';
    a.renderDayCard(dd);                       // the display boundary, repeatedly
    a.actualPaceSecPerKm(dd);                  // and the read boundary
  }
  a.state.units = 'km';
  assert.equal(JSON.stringify(dd.actual), stored, 'toggling units is not an edit');
  assert.equal(a.actualPaceDisplayStr(dd), '5:13', 'and nothing accumulated');
});

test('the canonical sec/km is the same number whichever unit is selected', () => {
  const a = app('km');
  const dd = logged(a, 8.1, '5:13');
  const inKm = a.actualPaceSecPerKm(dd);
  a.state.units = 'mi';
  assert.equal(a.actualPaceSecPerKm(dd), inKm,
    'the run that happened does not change because a preference did');
  assert.equal(inKm, 313);
});

// ---------------------------------------------------------------------------
// THE REAL DAMAGE: SCORING
// ---------------------------------------------------------------------------
test('a unit toggle does not change what the session scored', () => {
  const a = app('km');
  const dd = a.state.days.filter(d => d.type !== 'rest' && d.km > 0)[0];
  dd.completed = true;
  dd.actual = a.emptyActual();
  a.handleActualFieldChange(dd.id, 'km', String(dd.km));
  a.handleActualFieldChange(dd.id, 'pace', '5:13');
  const scoreKm = a.computeExecutionScore(dd);
  a.state.units = 'mi';
  assert.equal(a.computeExecutionScore(dd), scoreKm,
    'the score is a fact about the run, not about the display preference');
});

// ---------------------------------------------------------------------------
// LEGACY LOGS
// ---------------------------------------------------------------------------
test('an unstamped legacy pace reads exactly as it did before this existed', () => {
  const a = app('km');
  const dd = a.state.days.filter(d => d.type !== 'rest')[0];
  dd.completed = true;
  dd.actual = a.emptyActual();
  dd.actual.km = 8.1;
  dd.actual.pace = '5:13';                     // written before paceUnit existed
  assert.equal(dd.actual.paceUnit, undefined);
  assert.equal(a.actualPaceSecPerKm(dd), 313, 'resolved against the current selection, as before');
  assert.equal(a.actualPaceDisplayStr(dd), '5:13');
});

test('the migration labels a legacy pace without converting it', () => {
  const a = app('km');
  const st = { units:'km', days:[ { id:'d', actual:{ km:8.1, pace:'5:13' } } ] };
  a.migrateActualPaceUnits(st);
  assert.equal(st.days[0].actual.paceUnit, 'km', 'labelled');
  assert.equal(st.days[0].actual.pace, '5:13', 'and the number is untouched');
});

test('the migration records the unit in force, not a guess', () => {
  const a = app('mi');
  const st = { units:'mi', days:[ { id:'d', actual:{ km:8.1, pace:'8:24' } } ] };
  a.migrateActualPaceUnits(st);
  assert.equal(st.days[0].actual.paceUnit, 'mi',
    'a mile athlete\'s 8:24 means 8:24/mi and must not be relabelled km');
});

test('the migration never overwrites a stamp that already exists', () => {
  const a = app('mi');
  const st = { units:'mi', days:[ { id:'d', actual:{ pace:'5:13', paceUnit:'km' } } ] };
  a.migrateActualPaceUnits(st);
  assert.equal(st.days[0].actual.paceUnit, 'km');
});

test('the migration is safe on empty, partial and unlogged state', () => {
  const a = app('km');
  assert.doesNotThrow(() => a.migrateActualPaceUnits(null));
  assert.doesNotThrow(() => a.migrateActualPaceUnits({}));
  assert.doesNotThrow(() => a.migrateActualPaceUnits({ days: [] }));
  const st = { units:'km', days:[ {id:'a'}, {id:'b', actual:{}}, {id:'c', actual:{ km:5 }} ] };
  assert.doesNotThrow(() => a.migrateActualPaceUnits(st));
  st.days.forEach(d => assert.equal(d.actual && d.actual.paceUnit, undefined,
    'a day with no logged pace gets no stamp'));
});

// ---------------------------------------------------------------------------
// THE OTHER SURFACES FOUND BY THE AUDIT
// ---------------------------------------------------------------------------
test('paceUnit travels with the log through sync and backup', () => {
  const a = app('km');
  assert.ok(a.ACTUAL_SYNCED_FIELDS.indexOf('paceUnit') !== -1,
    'a stamp that does not sync would be lost on the next device');
  const dd = logged(a, 8.1, '5:13');
  const b = app('mi');
  b.state = JSON.parse(JSON.stringify(a.state));
  b.state.units = 'mi';                        // the adopting device's own setting
  const back = b.findDay(dd.id);
  assert.equal(b.actualPaceSecPerKm(back), 313,
    'adopted on a mile device, it is still the 5:13/km run that happened');
  assert.equal(b.actualPaceDisplayStr(back), '8:24');
});

test('a comparable keeps its meaning when units change', () => {
  const a = app('km');
  const past = a.state.days.filter(d => d.date < a.todayStr() && d.type !== 'rest')[0];
  if (!past) return;
  past.completed = true;
  past.actual = a.emptyActual();
  a.handleActualFieldChange(past.id, 'km', String(past.km));
  a.handleActualFieldChange(past.id, 'pace', '5:13');
  assert.equal(a.actualPaceToSecPerKm(past), 313);
  a.state.units = 'mi';
  assert.equal(a.actualPaceToSecPerKm(past), 313,
    'comparables now carry canonical sec/km rather than an ambiguous string');
});

test('the structured work-vs-recovery claim states a unit and converts it', () => {
  const a = app('km');
  const dd = { id:'2026-05-25', date:'2026-05-25', week:1, type:'interval', title:'F', km:8,
               completed:true, actual:a.emptyActual(),
               prescription:{ v:a.PRESCRIPTION_VERSION, archetype:'fartlek', params:{reps:5,min:2} } };
  a.state.days.push(dd);
  dd.actual.km = 8; dd.actual.pace = '5:00';
  ['s.1.0.0.0','s.1.1.0.0','s.1.2.0.0','s.1.3.0.0','s.1.4.0.0']
    .forEach((id,i) => a.handleStructuredSplitChange(dd.id, id, 'km', String(0.58 - i*0.01)));
  ['s.1.0.1.0','s.1.1.1.0','s.1.2.1.0','s.1.3.1.0']
    .forEach((id,i) => a.handleStructuredSplitChange(dd.id, id, 'km', String(0.34 - i*0.005)));
  const kmClaim = a.structuredExecutionEvidence(dd).claims.join(' ');
  assert.match(kmClaim, /\/km slower than the reps/, 'a pace difference must name its unit');
  a.state.units = 'mi';
  const miClaim = a.structuredExecutionEvidence(dd).claims.join(' ');
  assert.match(miClaim, /\/mi slower than the reps/);
  assert.notEqual(kmClaim, miClaim, 'and the number must actually convert, not just the label');
});

test('structured split paces are canonical sec/km and never re-converted', () => {
  const a = app('km');
  const dd = { id:'2026-05-25', date:'2026-05-25', week:1, type:'interval', title:'F', km:8,
               completed:true, actual:a.emptyActual(),
               prescription:{ v:a.PRESCRIPTION_VERSION, archetype:'fartlek', params:{reps:5,min:2} } };
  a.state.days.push(dd);
  a.handleStructuredSplitChange(dd.id, 's.1.0.0.0', 'km', '0.5');
  const stored = JSON.parse(JSON.stringify(dd.actual.splits));
  assert.equal(stored[0].paceSec, 240, '0.5km in 120s is 4:00/km');
  a.state.units = 'mi';
  a.renderSplitsBlock(dd);
  assert.deepEqual(JSON.parse(JSON.stringify(dd.actual.splits)), stored,
    'a segment pace is derived from canonical km and seconds, so units never touch it');
});

// ---------------------------------------------------------------------------
// ENTRY EDGE CASES
// ---------------------------------------------------------------------------
test('clearing the pace clears its stamp too', () => {
  const a = app('km');
  const dd = logged(a, 8.1, '5:13');
  assert.equal(dd.actual.paceUnit, 'km');
  a.handleActualFieldChange(dd.id, 'pace', '');
  assert.equal(dd.actual.pace, null);
  assert.equal(dd.actual.paceUnit, undefined, 'no orphan stamp on an empty field');
});

test('re-entering a pace in the other unit restamps it', () => {
  const a = app('km');
  const dd = logged(a, 8.1, '5:13');
  a.state.units = 'mi';
  a.handleActualFieldChange(dd.id, 'pace', '8:30');
  assert.equal(dd.actual.paceUnit, 'mi');
  assert.equal(a.actualPaceDisplayStr(dd), '8:30');
  a.state.units = 'km';
  assert.equal(a.actualPaceDisplayStr(dd), '5:17', '8:30/mi is 5:17/km');
});

test('an unparseable pace yields null rather than a wrong number', () => {
  const a = app('km');
  const dd = logged(a, 8.1, 'not-a-pace');
  assert.equal(a.actualPaceSecPerKm(dd), null);
  assert.equal(a.actualPaceDisplayStr(dd), '');
});
