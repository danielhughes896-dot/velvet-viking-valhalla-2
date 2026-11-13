'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* Founder: "Accept both "5.25" and "5:25" as 5:25/km across all pace inputs
   ... it's the . and : that both should be accepted. Automatically display as
   "5:25". Validate seconds (00-59) and preserve existing logs."

   Found before the fix: the Log Session pace field stored the typed text,
   so "5.25" was saved as "5.25", and paceToSec (which split on ":") read it
   as nothing -- a pace on screen that the score silently never saw. The
   zone-pace overrides refused the dot outright, and no field checked the
   seconds: "5:75" was taken as 6:15. */

const TODAY = '2026-05-20';
function app(units){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  const toasts = [];
  a.showToast = m => toasts.push(m);
  a.toasts = toasts;
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -21) });
  a.state.units = units || 'km';
  return a;
}
function run(a, km, pace){
  const dd = a.state.days.filter(d => d.type === 'threshold' || d.type === 'tempo')[0]
          || a.state.days.filter(d => d.type !== 'rest')[0];
  dd.completed = true;
  dd.actual = a.emptyActual();
  a.handleActualFieldChange(dd.id, 'km', String(km));
  if (pace != null) a.handleActualFieldChange(dd.id, 'pace', pace);
  return dd;
}

test('the pace reader: a colon or a dot, two-digit seconds 00 to 59, nothing guessed', () => {
  const a = app();
  const ok = { '5:25': 325, '5.25': 325, ' 5.25 ': 325, '4:05': 245, '4.05': 245, '10:00': 600, '10.00': 600,
    '5:00': 300, '5:59': 359, '5.59': 359, '525': 325, '1015': 615, '5:25/km': 325, '8.00 /mi': 480, '5:25 min/km': 325 };
  Object.keys(ok).forEach(k => assert.equal(a.parsePaceInput(k), ok[k], JSON.stringify(k)));
  ['5:60', '5:75', '5.60', '5.75', '5.5', '5:5', '5.255', '5.25.10', 'abc', '', '0:00', '0.00', '45', '575', '5,25 ']
    .forEach(k => assert.equal(a.parsePaceInput(k), null, JSON.stringify(k) + ' was read as a pace'));
});

test('Log Session: "5.25" and "5:25" store the same pace, shown as 5:25, and score the same', () => {
  const a1 = app(), a2 = app();
  const d1 = run(a1, 8, '5.25'), d2 = run(a2, 8, '5:25');
  assert.equal(d1.actual.pace, '5:25', 'the dot was stored as typed');
  assert.equal(d2.actual.pace, '5:25');
  assert.equal(a1.actualPaceDisplayStr(d1), '5:25');
  assert.equal(a1.actualPaceToSecPerKm(d1), 325);
  assert.equal(d1.actual.paceUnit, 'km');
  const s1 = a1.computeExecutionScore(d1), s2 = a2.computeExecutionScore(d2);
  assert.equal(JSON.stringify(s1), JSON.stringify(s2), 'the two ways of writing one pace scored differently');
  assert.deepEqual(a1.toasts, []);
});

test('Log Session: seconds past 59 are refused, the pace already logged is kept, and the athlete is told', () => {
  const a = app();
  const dd = run(a, 8, '5:25');
  ['5:75', '5.60', '5.5', 'fast'].forEach(bad => {
    a.toasts.length = 0;
    a.handleActualFieldChange(dd.id, 'pace', bad);
    assert.equal(dd.actual.pace, '5:25', bad + ' replaced the logged pace');
    assert.equal(a.toasts.length, 1, bad + ': nothing told the athlete why');
    assert.match(a.toasts[0], /5:25 or 5\.25/);
    assert.match(a.toasts[0], /00 to 59/);
  });
  /* Emptying the field still clears it, as it always has. */
  a.handleActualFieldChange(dd.id, 'pace', '');
  assert.equal(dd.actual.pace, null);
});

test('miles: "8.00" typed under MI is 8:00/mi, stamped mi, and reads as 4:58/km', () => {
  const a = app('mi');
  const dd = run(a, 8, '8.00');
  assert.equal(dd.actual.pace, '8:00');
  assert.equal(dd.actual.paceUnit, 'mi');
  assert.equal(Math.round(a.actualPaceToSecPerKm(dd)), 298);
});

test('existing logs are preserved: colon paces read exactly as before, and a pace saved with a dot is no longer lost', () => {
  const a = app();
  const dd = run(a, 8, null);
  /* Written straight into the log, as the old field saved it. */
  dd.actual.pace = '5.25'; dd.actual.paceUnit = 'km';
  assert.equal(a.actualPaceToSecPerKm(dd), 325, 'a dot pace already in a log is still read as nothing');
  assert.equal(a.actualPaceDisplayStr(dd), '5:25');
  /* Every colon form keeps its old reading, including the lenient ones. */
  assert.equal(a.paceToSec('5:25'), 325);
  assert.equal(a.paceToSec('5:5'), 305);
  assert.equal(a.paceToSec('5:25 /km'), 325);
  assert.equal(a.paceToSec('1:05:00'), 65);
  /* And nothing that never read as a pace starts to. */
  assert.equal(a.paceToSec('5.5'), null);
  assert.equal(a.paceToSec('5.75'), null);
  assert.equal(a.paceToSec('5'), null);
  assert.equal(a.paceToSec(''), null);
});

test('Your Log stages: "4.47" is 4:47, "350" still 3:50, and a refused pace leaves the stage as it was', () => {
  const a = app();
  const dd = a.state.days.filter(d => { try { return a.loggingModeFor(d).mode === 'structured'; } catch (e) { return false; } })[0];
  assert.ok(dd, 'the fixture has no structured session');
  dd.completed = true; dd.actual = a.emptyActual();
  const rows = Array.from(a.loggingModeFor(dd).plan.rows);
  const r0 = rows[0], r1 = rows[1] || rows[0];
  a.handleStructuredSplitChange(dd.id, r0.segId, 'pace', '4.47');
  const s0 = dd.actual.splits.filter(x => x.segId === r0.segId)[0];
  assert.equal(s0.paceSec, 287);
  a.handleStructuredSplitChange(dd.id, r0.segId, 'pace', '350');
  assert.equal(s0.paceSec, 230, 'the watch shorthand the stage fields took is lost');
  a.toasts.length = 0;
  a.handleStructuredSplitChange(dd.id, r0.segId, 'pace', '4:75');
  assert.equal(s0.paceSec, 230, 'a refused pace changed the stage');
  assert.equal(a.toasts.length, 1);
  /* A refusal on a stage never typed in makes no empty row. */
  const before = dd.actual.splits.length;
  if (r1 !== r0){
    a.handleStructuredSplitChange(dd.id, r1.segId, 'pace', '9.99');
    assert.equal(dd.actual.splits.length, before, 'a refused pace left an empty stage behind');
  }
});

test('zone pace overrides: "4.30" is taken as 4:30, a bad bound is refused rather than read as cleared', () => {
  const a = app();
  assert.ok(a.state.setup, 'the fixture has no setup');
  const zone = 'threshold';
  const inputs = [{ value: '4.30' }, { value: '4:45' }];
  a.document = { querySelectorAll: () => inputs };
  a.renderApp = () => {}; a.restorePlanHQScroll = () => {}; a.refreshOpenRecordPanel = () => {}; a.scheduleSave = () => {};
  a.handlePaceOverrideChange(zone);
  assert.equal(JSON.stringify(a.state.setup.paceOverrides[zone]), JSON.stringify({ fast: 270, slow: 285 }));
  inputs[0].value = '4:90';
  a.handlePaceOverrideChange(zone);
  assert.equal(JSON.stringify(a.state.setup.paceOverrides[zone]), JSON.stringify({ fast: 270, slow: 285 }), 'an unreadable bound deleted or changed the override');
  assert.equal(a.toasts.length, 1);
});

test('every pace field offers a keypad with a dot, and is read through the one parser', () => {
  const fs = require('node:fs'), path = require('node:path');
  const { RUNTIME_RELATIVE } = require('./harness.js');
  const RT = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  assert.equal((RT.match(/class="pzr-input" placeholder="m:ss" inputmode="decimal"/g) || []).length, 2,
    'the zone pace fields still open a digits-only keypad with no dot');
  const body = n => { const i = RT.indexOf('function ' + n + '('); return RT.slice(i, RT.indexOf('\n}', i)); };
  assert.match(body('handleActualFieldChange'), /parsePaceInput\(paceRaw\)/);
  assert.match(body('handlePaceOverrideChange'), /parsePaceInput\(fastRaw\)[\s\S]*parsePaceInput\(slowRaw\)/);
  assert.match(body('handleStructuredSplitChange'), /parsePaceInput\(value\)/);
});
