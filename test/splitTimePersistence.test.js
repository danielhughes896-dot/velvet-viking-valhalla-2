'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// STRUCTURED LAP/SPLIT TIME PERSISTENCE.
//
// Real-device report: log 7km with two laps (3km and 4km), each with a time
// and an HR. Distance stays. HR stays. The TIMES reset to the m:ss
// placeholder.
//
// The write and render paths were both clean; the loss was upstream of them,
// in what the athlete could physically type. All three inputs carried an
// inputmode: distance "decimal" (keypad has its point), heart rate "numeric"
// (digits are all it needs) -- and time "numeric" too, which is a DIGITS-ONLY
// keypad with no colon anywhere on it. clockToSec() returns null without a
// colon, so every lap time parsed to null and was dropped in silence, while
// its two neighbours saved fine. That asymmetry is the whole bug.
const TODAY = '2026-05-20';
function app() {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {};
  buildPlan(a, { weeks: 14, startDate: a.addDays(TODAY, -28),
                 distanceKey: 'full', volume: 60, benchSec: 3 * 3600 + 15 * 60 });
  a.state.setup.benchmark = { distanceKey: 'full', timeSec: 3 * 3600 + 15 * 60 };
  a.state.setup.goals = { A: { timeSec: 3 * 3600 + 10 * 60 } };
  a.state.setup.lthr = 172; a.state.setup.maxHR = 197;
  return a;
}
function dayWith(a, prescription, type, km) {
  const dd = { id:'2026-05-21', date:'2026-05-21', week:1, type:type||'easy',
               title:'Session', km:km||7, completed:true, actual:a.emptyActual() };
  if (prescription) dd.prescription = prescription;
  dd.actual.km = km || 7; dd.actual.pace = '5:54'; dd.actual.paceUnit = 'km'; dd.actual.hr = 155;
  a.state.days = [dd];
  return dd;
}
const fartlek = a => ({ v:a.PRESCRIPTION_VERSION, archetype:'fartlek', params:{reps:5,min:2} });
const threshold = a => ({ v:a.PRESCRIPTION_VERSION, archetype:'threshold_continuous', params:{km:5} });
// value= precedes data-field= in the emitted markup, so match the tag and
// then read the attribute out of it rather than assuming an order.
const timeInputs = html =>
  [...html.matchAll(/<input[^>]*data-field="sec"[^>]*>/g)]
    .map(t => (t[0].match(/value="([^"]*)"/) || [,''])[1]);
const flatTimeInputs = timeInputs;

// ---------------------------------------------------------------------------
// THE PARSE BOUNDARY -- what a phone keypad can actually produce
// ---------------------------------------------------------------------------
test('a colon-less time from a numeric keypad is accepted, not dropped', () => {
  const a = app();
  assert.equal(a.parseElapsedInput('1800'), 1080, 'this is what the athlete could actually type');
  assert.equal(a.parseElapsedInput('18:00'), 1080, 'and this is what the placeholder asks for');
  assert.equal(a.parseElapsedInput('930'), 570);
  assert.equal(a.parseElapsedInput('45'), 45, 'a hill rep is 45 seconds');
  assert.equal(a.parseElapsedInput('1:23:45'), 5025);
});

test('separators a paste or a keypad might use all mean the same thing', () => {
  const a = app();
  ['18 00', '18.00', '18-00', '18,00'].forEach(v =>
    assert.equal(a.parseElapsedInput(v), 1080, JSON.stringify(v)));
});

test('ambiguity is refused rather than guessed', () => {
  const a = app();
  assert.equal(a.parseElapsedInput('1875'), null, '75 is not a seconds value; do not invent 21:15');
  ['abc', '', '   ', null, undefined, '::', '12:'].forEach(v =>
    assert.equal(a.parseElapsedInput(v), null, JSON.stringify(v)));
});

test('the benchmark parser is untouched', () => {
  const a = app();
  assert.equal(a.clockToSec('0:45:00'), 2700);
  assert.equal(a.clockToSec('45:00'), 2700);
  assert.equal(a.clockToSec('4500'), null, 'clockToSec keeps its own stricter contract');
});

test('no lap time field asks for a colon on a keypad that has none', () => {
  const a = app();
  const plain = dayWith(a, null);
  a.handleAddSplit(plain.id);                     // opens the editor and adds a row
  const flat = a.renderSplitsBlock(plain);
  assert.match(flat, /class="split-time"/);
  assert.doesNotMatch(flat.match(/<input[^>]*class="split-time"[^>]*>/)[0], /inputmode="numeric"/,
    'a digits-only keypad cannot type m:ss');
  const dd = dayWith(a, fartlek(a), 'interval', 8);
  a.splitsEditorOpen[dd.id] = true;
  const struct = a.renderSplitsBlock(dd);
  const timeInput = struct.match(/<input[^>]*data-field="sec"[^>]*>/);
  if (timeInput) assert.doesNotMatch(timeInput[0], /inputmode="numeric"/);
});

// ---------------------------------------------------------------------------
// A. THE REPORTED SESSION, END TO END
// ---------------------------------------------------------------------------
function reportedSession(a, timeA, timeB) {
  const dd = dayWith(a, null);
  a.handleAddSplit(dd.id); a.handleAddSplit(dd.id);   // adding a lap opens the editor
  [[0,'km','3'],[0,'sec',timeA],[0,'hr','150'],
   [1,'km','4'],[1,'sec',timeB],[1,'hr','160']]
    .forEach(([i,f,v]) => a.handleSplitFieldChange(dd.id, i, f, v));
  return dd;
}
test('7km with two laps: distance, time AND heart rate all survive', () => {
  const a = app();
  const dd = reportedSession(a, '1730', '2340');       // typed without a colon
  const s = dd.actual.splits;
  assert.equal(s.length, 2);
  assert.deepEqual([s[0].km, s[0].sec, s[0].hr], [3, 1050, 150]);
  assert.deepEqual([s[1].km, s[1].sec, s[1].hr], [4, 1420, 160]);
  assert.deepEqual(flatTimeInputs(a.renderSplitsBlock(dd)), ['17:30', '23:40'],
    'and the re-rendered field shows them rather than the placeholder');
});

test('pace derives from the recovered time', () => {
  const a = app();
  const dd = reportedSession(a, '1730', '2340');
  assert.equal(dd.actual.splits[0].paceSec, 350, '3km in 17:30 is 5:50/km');
});

// ---------------------------------------------------------------------------
// B/C. SEEDED vs ENTERED TIME
// ---------------------------------------------------------------------------
const REP = 's.1.0.0.0', REP2 = 's.1.1.0.0', WU = 's.0';
test('a time-prescribed rep still seeds its duration from the prescription', () => {
  const a = app();
  const dd = dayWith(a, fartlek(a), 'interval', 8);
  a.handleStructuredSplitChange(dd.id, REP, 'km', '0.58');
  const s = dd.actual.splits[0];
  assert.equal(s.sec, 120, 'the athlete was told to run two minutes');
  assert.equal(s.secSeeded, true, 'and it is marked as prescribed, not measured');
});

test('an entered time is never overwritten by a seed, and drops the seed flag', () => {
  const a = app();
  const dd = dayWith(a, fartlek(a), 'interval', 8);
  a.handleStructuredSplitChange(dd.id, WU, 'sec', '1200');    // warm-up: asks for time
  const s = dd.actual.splits[0];
  assert.equal(s.sec, 720);
  assert.equal(s.secSeeded, undefined, 'a measured time is not a seeded one');
  a.handleStructuredSplitChange(dd.id, WU, 'hr', '140');      // regenerates the row
  assert.equal(a.findDay(dd.id).actual.splits[0].sec, 720, 'and editing a sibling field keeps it');
});

test('a seeded row that the athlete never answered is not a phantom segment', () => {
  const a = app();
  const dd = dayWith(a, fartlek(a), 'interval', 8);
  a.handleStructuredSplitChange(dd.id, REP, 'km', '0.58');
  a.handleStructuredSplitChange(dd.id, REP, 'km', '');
  assert.ok(!dd.actual.splits || !dd.actual.splits.length,
    'the seeded time alone is the prescription talking, not evidence');
});

// ---------------------------------------------------------------------------
// D. PARTIAL LOGS
// ---------------------------------------------------------------------------
test('filled rows keep their times and blank rows stay blank', () => {
  const a = app();
  const dd = dayWith(a, threshold(a), 'threshold', 8);
  a.splitsEditorOpen[dd.id] = true;
  const plan = a.structuredLoggingPlan(dd);
  a.handleStructuredSplitChange(dd.id, plan.rows[0].segId, 'sec', '1200');
  a.handleStructuredSplitChange(dd.id, plan.rows[2].segId, 'sec', '600');
  assert.equal(dd.actual.splits.length, 2);
  const shown = timeInputs(a.renderSplitsBlock(dd));
  assert.deepEqual(shown, ['12:00', '', '6:00'], 'middle row untouched, and still empty');
});

// ---------------------------------------------------------------------------
// E. RERENDER AND NAVIGATION
// ---------------------------------------------------------------------------
test('replaceCard and a view change both retain entered times', () => {
  const a = app();
  const dd = reportedSession(a, '17:30', '23:40');
  const before = dd.actual.splits.map(s => s.sec).join(',');
  a.replaceCard(dd);
  ['today', 'week', 'full', 'today'].forEach(v => { a.state.view = v; a.renderDayCard(dd); });
  assert.equal(a.findDay(dd.id).actual.splits.map(s => s.sec).join(','), before);
});

test('editing a whole-session field does not disturb lap times', () => {
  const a = app();
  const dd = reportedSession(a, '17:30', '23:40');
  const before = JSON.stringify(dd.actual.splits);
  a.handleActualFieldChange(dd.id, 'hr', '158');
  a.handleActualFieldChange(dd.id, 'rpe', '6');
  a.handleSetFeel(dd.id, 'good');
  assert.equal(JSON.stringify(a.findDay(dd.id).actual.splits), before);
});

// ---------------------------------------------------------------------------
// F. PERSISTENCE
// ---------------------------------------------------------------------------
test('times survive a JSON round trip and a cloud-shaped adoption', () => {
  const a = app();
  const dd = reportedSession(a, '17:30', '23:40');
  const before = JSON.parse(JSON.stringify(dd.actual.splits));
  const b = app();
  b.state = JSON.parse(JSON.stringify(a.state));
  assert.deepEqual(JSON.parse(JSON.stringify(b.findDay(dd.id).actual.splits)), before);
  assert.deepEqual(flatTimeInputs(b.renderSplitsBlock(b.findDay(dd.id))), ['17:30', '23:40']);
});

test('a lap time moves the sync signature, so it is never silently unsynced', () => {
  const a = app();
  const dd = dayWith(a, null);
  a.handleAddSplit(dd.id);
  a.handleSplitFieldChange(dd.id, 0, 'km', '3');
  const before = a.planContentSignature(a.state);
  a.handleSplitFieldChange(dd.id, 0, 'sec', '1730');
  assert.notEqual(a.planContentSignature(a.state), before);
});

// ---------------------------------------------------------------------------
// G. UNIT TOGGLE
// ---------------------------------------------------------------------------
test('km/mi toggling leaves elapsed times byte-identical', () => {
  const a = app();
  const dd = reportedSession(a, '17:30', '23:40');
  const before = dd.actual.splits.map(s => s.sec).join(',');
  for (let i = 0; i < 20; i++) { a.state.units = i % 2 ? 'km' : 'mi'; a.renderSplitsBlock(dd); }
  a.state.units = 'km';
  assert.equal(dd.actual.splits.map(s => s.sec).join(','), before, 'time is not a unit-bearing value');
  assert.deepEqual(flatTimeInputs(a.renderSplitsBlock(dd)), ['17:30', '23:40']);
});

// ---------------------------------------------------------------------------
// H. CLEAR LOG
// ---------------------------------------------------------------------------
test('times go only when the log is deliberately cleared', () => {
  const a = app();
  const dd = reportedSession(a, '17:30', '23:40');
  assert.equal(dd.actual.splits.length, 2);
  a.handleClearActual(dd.id);
  assert.equal(dd.actual.splits, undefined);
});

test('deleting one lap leaves the other lap\'s time alone', () => {
  const a = app();
  const dd = reportedSession(a, '17:30', '23:40');
  a.handleDeleteSplit(dd.id, 0);
  assert.equal(dd.actual.splits.length, 1);
  assert.equal(dd.actual.splits[0].sec, 1420);
});

// ---------------------------------------------------------------------------
// I. LEGACY
// ---------------------------------------------------------------------------
test('legacy flat splits are unchanged and still analysed', () => {
  const a = app();
  const dd = dayWith(a, null);
  a.splitsEditorOpen[dd.id] = true;
  dd.actual.splits = [{paceSec:300},{paceSec:305},{paceSec:310},{paceSec:315}];
  const before = JSON.stringify(dd.actual.splits);
  a.renderSplitsBlock(dd);
  assert.equal(JSON.stringify(dd.actual.splits), before);
  assert.ok(a.coachSplitMetrics(dd));
});

test('a time already stored in seconds is never re-parsed on render', () => {
  const a = app();
  const dd = dayWith(a, null);
  a.splitsEditorOpen[dd.id] = true;
  dd.actual.splits = [{ km:3, sec:1050, paceSec:350, hr:150 }];
  const before = JSON.stringify(dd.actual.splits);
  for (let i = 0; i < 5; i++) a.renderSplitsBlock(dd);
  assert.equal(JSON.stringify(dd.actual.splits), before,
    'seconds are the one canonical representation; rendering formats, it does not convert');
});
