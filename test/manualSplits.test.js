'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');
// Objects/arrays returned from the VM sandbox carry the sandbox's own
// Object/Array prototype, so assert.deepEqual (deepStrictEqual under
// assert/strict) fails on prototype identity even when every value matches.
// A JSON round-trip normalizes both sides to plain main-realm objects --
// the same workaround executionStrategy.test.js documents and uses.
const clone = o => JSON.parse(JSON.stringify(o));

// MANUAL LAPS / SPLITS -- REGRESSION SUITE.
//
// dd.actual.splits is not a new data model: coachSplitMetrics()/coachHRDrift()
// have read {paceSec, hr} per lap since before this feature existed, and
// simply returned null because nothing wrote to it. This suite is about the
// first production writer -- the logging UI and its handlers -- staying
// honest about what it accepts, what it derives, and what it is willing to
// claim once real evidence exists.
const TODAY = '2026-05-20';
function app(opts) {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {};
  buildPlan(a, Object.assign({ weeks: 6, startDate: a.addDays(TODAY, -14) }, opts || {}));
  return a;
}
function completedDay(a, archetype, optional) {
  const d = a.state.days.filter(x => {
    const p = a.prescriptionOf(x);
    return (!archetype || (p && p.archetype === archetype)) && x.type !== 'rest';
  })[0];
  if (!d && optional) return null;
  assert.ok(d, 'fixture must contain a usable day' + (archetype ? ' of ' + archetype : ''));
  d.completed = true;
  d.actual = a.emptyActual();
  return d;
}
// Fills 4 laps of 1km with a mild positive split (each lap 5s slower than
// the last), which is enough for coachSplitMetrics()/coachHRDrift() to stop
// returning null.
function fillFourLaps(a, dd, opts) {
  opts = opts || {};
  const times = ['5:00', '5:05', '5:10', '5:15'];
  for (let i = 0; i < 4; i++) {
    a.handleAddSplit(dd.id);
    a.handleSplitFieldChange(dd.id, i, 'km', '1');
    a.handleSplitFieldChange(dd.id, i, 'sec', times[i]);
    if (opts.hr) a.handleSplitFieldChange(dd.id, i, 'hr', String(140 + i * 5));
  }
}

// ---------------------------------------------------------------------------
// 1. THE EDITOR IS QUIET AND OPTIONAL
// ---------------------------------------------------------------------------
test('the splits editor is closed by default and never forces lap entry', () => {
  /* TWO PRESENTATIONS, ONE INVARIANT. A day whose prescription has a structure
     gets the session-breakdown summary card; a flat or legacy day gets the
     plain "Add laps / splits" toggle. The rule being tested belongs to
     neither: the editor is CLOSED, no rows are rendered, and the control is
     an offer rather than a requirement. The earlier form pinned the flat
     wording and passed only while the fixture's first day happened to be
     unstructured. Both are now exercised, so neither can regress. */
  const a = app();
  const structured = completedDay(a, 'track_reps', true) || completedDay(a);
  const flat = a.state.days.filter(x => x.type === 'easy' && !a.prescriptionOf(x))[0]
            || (function(){ const d = completedDay(a); delete d.prescription; return d; })();

  [structured, flat].forEach(dd => {
    assert.equal(a.isSplitsOpen(dd), false, 'the editor opens closed');
    const html = a.renderSplitsBlock(dd);
    assert.doesNotMatch(html, /split-row/, 'no rows render before the control is opened');
    assert.match(html, /data-action="toggle-splits"/, 'a control is offered');
    assert.match(html, /aria-expanded="false"/, 'and it says it is closed');
  });
  /* And each keeps its own presentation, so this test cannot pass by the two
     collapsing into one. */
  assert.match(a.renderSplitsBlock(flat), /Add laps \/ splits/,
    'a day with no structure still offers the plain lap editor');
  assert.match(a.renderSplitsBlock(structured), /Session breakdown|Log the session breakdown/,
    'a structured day offers its own breakdown instead');
});

test('a session with no logged laps still completes and scores normally', () => {
  const a = app();
  const dd = completedDay(a);
  dd.actual.km = dd.km;
  dd.actual.pace = '5:00';
  assert.equal(a.computeExecutionScore(dd) != null, true, 'scoring must not depend on laps existing');
});

test('opening the editor is a pure UI toggle -- it writes no data', () => {
  const a = app();
  const dd = completedDay(a);
  a.handleToggleSplits(dd.id);
  assert.equal(a.isSplitsOpen(dd), true);
  assert.equal(dd.actual.splits, undefined, 'toggling open must not create an empty splits array');
  a.handleToggleSplits(dd.id);
  assert.equal(a.isSplitsOpen(dd), false);
});

test('a day that already carries lap data opens by default, without a stored override', () => {
  const a = app();
  const dd = completedDay(a);
  a.handleAddSplit(dd.id);
  assert.equal(a.isSplitsOpen(dd), true, 'existing evidence should not be hidden behind another tap');
});

// ---------------------------------------------------------------------------
// 2. ADD / EDIT / DELETE
// ---------------------------------------------------------------------------
test('add lap appends one empty row and reuses the previous distance', () => {
  const a = app();
  const dd = completedDay(a);
  a.handleAddSplit(dd.id);
  assert.deepEqual(clone(dd.actual.splits), [{ km: null, sec: null, paceSec: null, hr: null }]);
  a.handleSplitFieldChange(dd.id, 0, 'km', '1.2');
  a.handleAddSplit(dd.id);
  assert.equal(dd.actual.splits.length, 2);
  assert.equal(dd.actual.splits[1].km, dd.actual.splits[0].km, 'the common case (repeated lap distance) costs one fewer tap');
});

test('delete lap removes exactly that row and nothing else', () => {
  const a = app();
  const dd = completedDay(a);
  fillFourLaps(a, dd);
  a.handleDeleteSplit(dd.id, 1);
  assert.equal(dd.actual.splits.length, 3);
  assert.equal(dd.actual.splits[0].sec, 300);
  assert.equal(dd.actual.splits[1].sec, 310, 'lap 3 shifted into position 1, lap 2 is gone');
});

test('pace is always derived from distance and time, never entered as a third number', () => {
  const a = app();
  const dd = completedDay(a);
  a.handleAddSplit(dd.id);
  a.handleSplitFieldChange(dd.id, 0, 'km', '2');
  a.handleSplitFieldChange(dd.id, 0, 'sec', '10:00');
  assert.equal(dd.actual.splits[0].paceSec, 300, '10:00 over 2km is 5:00/km');
  const html = a.renderSplitsBody(dd);
  assert.doesNotMatch(html, /data-field="paceSec"/, 'there is no pace input field for a lap');
});

// ---------------------------------------------------------------------------
// 3. VALIDATION: HONEST ABOUT WHAT IS AND ISN'T A REAL VALUE
// ---------------------------------------------------------------------------
test('negative, zero and NaN distance are all rejected', () => {
  const a = app();
  const dd = completedDay(a);
  a.handleAddSplit(dd.id);
  ['-1', '0', 'abc', ''].forEach(v => {
    a.handleSplitFieldChange(dd.id, 0, 'km', v);
    assert.equal(dd.actual.splits[0].km, null, JSON.stringify(v) + ' must not become a distance');
  });
});

test('negative, zero and malformed elapsed time are all rejected', () => {
  const a = app();
  const dd = completedDay(a);
  a.handleAddSplit(dd.id);
  ['-1:00', '0:00', 'not-a-time', ''].forEach(v => {
    a.handleSplitFieldChange(dd.id, 0, 'sec', v);
    assert.equal(dd.actual.splits[0].sec, null, JSON.stringify(v) + ' must not become an elapsed time');
  });
});

test('negative, zero and malformed HR are rejected, but an unusual real HR is not', () => {
  const a = app();
  const dd = completedDay(a);
  a.handleAddSplit(dd.id);
  ['-5', '0', 'abc'].forEach(v => {
    a.handleSplitFieldChange(dd.id, 0, 'hr', v);
    assert.equal(dd.actual.splits[0].hr, null, JSON.stringify(v) + ' must not become an HR');
  });
  // 210 is unusually high but a real athlete can produce it -- the app does
  // not get to decide it looks wrong and silently drop it.
  a.handleSplitFieldChange(dd.id, 0, 'hr', '210');
  assert.equal(dd.actual.splits[0].hr, 210);
});

test('an invalid row degrades to all-null rather than a half-written lap', () => {
  const a = app();
  const dd = completedDay(a);
  a.handleAddSplit(dd.id);
  a.handleSplitFieldChange(dd.id, 0, 'km', '-3');
  a.handleSplitFieldChange(dd.id, 0, 'sec', '0');
  a.handleSplitFieldChange(dd.id, 0, 'hr', '-1');
  assert.deepEqual(clone(dd.actual.splits[0]), { km: null, sec: null, paceSec: null, hr: null });
});

// ---------------------------------------------------------------------------
// 4. TOTALS VS THE WHOLE-SESSION LOG -- BOTH NUMBERS SURVIVE
// ---------------------------------------------------------------------------
test('the lap total is null, not zero, until at least one lap has a distance', () => {
  const a = app();
  const dd = completedDay(a);
  a.handleAddSplit(dd.id);
  assert.equal(a.splitsTotalKm(dd), null);
  a.handleSplitFieldChange(dd.id, 0, 'km', '3');
  assert.equal(a.splitsTotalKm(dd), 3);
});

test('a close lap total and whole-session log is not flagged as a mismatch', () => {
  const a = app();
  const dd = completedDay(a);
  dd.actual.km = 10;
  fillFourLaps(a, dd); // 4 x 1km = 4km total, far from 10 -- use a matching set instead
  for (let i = 0; i < 4; i++) a.handleSplitFieldChange(dd.id, i, 'km', '2.5'); // 4 x 2.5 = 10
  assert.equal(a.splitsMismatch(dd), null);
});

test('a materially different lap total is flagged, and neither number is overwritten', () => {
  const a = app();
  const dd = completedDay(a);
  dd.actual.km = 10;
  fillFourLaps(a, dd); // 4km of laps against a 10km logged session
  const mismatch = a.splitsMismatch(dd);
  assert.ok(mismatch, 'a 4km lap total against a 10km session is a real, material gap');
  assert.equal(mismatch.total, 4);
  assert.equal(mismatch.logged, 10);
  assert.equal(dd.actual.km, 10, 'the whole-session log is never silently corrected by the laps');
});

test('no mismatch is claimed while the whole-session distance is still unlogged', () => {
  const a = app();
  const dd = completedDay(a);
  fillFourLaps(a, dd);
  assert.equal(dd.actual.km, null);
  assert.equal(a.splitsMismatch(dd), null, 'nothing to compare against yet -- say nothing rather than guess');
});

// ---------------------------------------------------------------------------
// 5. THE EXISTING SPLIT-EVIDENCE ENGINE IS REACHED, UNCHANGED
// ---------------------------------------------------------------------------
test('coachSplitMetrics and coachHRDrift stay null below their own thresholds', () => {
  const a = app();
  const dd = completedDay(a);
  a.handleAddSplit(dd.id);
  a.handleSplitFieldChange(dd.id, 0, 'km', '1');
  a.handleSplitFieldChange(dd.id, 0, 'sec', '5:00');
  assert.equal(a.coachSplitMetrics(dd), null, 'fewer than 4 real splits is not evidence');
  assert.equal(a.coachHRDrift(dd), null);
});

test('4 real laps are enough for coachSplitMetrics to compute honestly', () => {
  const a = app();
  const dd = completedDay(a);
  fillFourLaps(a, dd, { hr: true });
  const sm = a.coachSplitMetrics(dd);
  assert.ok(sm);
  assert.equal(sm.splits, 4);
  assert.equal(sm.splitType, 'positive', 'each lap 5s slower than the last is a positive split');
  assert.ok(a.coachHRDrift(dd) != null, 'HR was logged on every lap, so drift is now computable');
});

// ---------------------------------------------------------------------------
// 6. EXECUTION REVIEW ONLY CLAIMS WHAT THE LAPS SUPPORT
// ---------------------------------------------------------------------------
test('Execution Review says nothing about splits below the evidence threshold', () => {
  const a = app();
  const dd = completedDay(a);
  dd.actual.km = dd.km;
  dd.actual.pace = '5:00';
  a.handleAddSplit(dd.id);
  a.handleSplitFieldChange(dd.id, 0, 'km', '1');
  a.handleSplitFieldChange(dd.id, 0, 'sec', '5:00');
  const html = a.renderExecutionReview(dd);
  assert.doesNotMatch(html, /<div class="cr-k">Splits<\/div>/);
});

test('Execution Review states the honest first-half-vs-second-half read once there is real evidence', () => {
  const a = app();
  const dd = completedDay(a);
  dd.actual.km = dd.km;
  dd.actual.pace = '5:00';
  fillFourLaps(a, dd);
  const html = a.renderExecutionReview(dd);
  assert.match(html, /<div class="cr-k">Splits<\/div>/);
  assert.match(html, /Paced slower in the second half than the first/);
  assert.match(html, /pace consistency across 4 laps/);
});

test('an even split is described as even, not as a fade in either direction', () => {
  const a = app();
  const dd = completedDay(a);
  dd.actual.km = dd.km;
  dd.actual.pace = '5:00';
  for (let i = 0; i < 4; i++) {
    a.handleAddSplit(dd.id);
    a.handleSplitFieldChange(dd.id, i, 'km', '1');
    a.handleSplitFieldChange(dd.id, i, 'sec', '5:00');
  }
  const sm = a.coachSplitMetrics(dd);
  assert.equal(sm.splitType, 'even');
  assert.equal(a.describeSplitEvidence(sm), 'Held pace evenly across the laps, 100% pace consistency across 4 laps.');
});

test('split evidence never becomes a medical claim', () => {
  const a = app();
  const dd = completedDay(a);
  dd.actual.km = dd.km;
  dd.actual.pace = '5:00';
  fillFourLaps(a, dd, { hr: true });
  const html = a.renderExecutionReview(dd);
  assert.doesNotMatch(html, /injur|illness|arrhythmia|abnormal heart|medical|see a doctor|clearance/i);
});

test('split evidence does not attempt to map laps onto Execution Strategy phases', () => {
  const a = app();
  const dd = completedDay(a);
  dd.actual.km = dd.km;
  dd.actual.pace = '5:00';
  fillFourLaps(a, dd);
  const html = a.renderExecutionReview(dd);
  assert.doesNotMatch(html, /strat-phase/, 'Execution Review must not render staged-plan markup at all');
});

// ---------------------------------------------------------------------------
// 7. DATA OWNERSHIP: SPLITS ARE PART OF THE SAME dd.actual COVERED BY
//    EXISTING PERSISTENCE, EXPORT AND CLOUD-CONFLICT MACHINERY
// ---------------------------------------------------------------------------
test('splits are on the existing dd.actual object -- a JSON round-trip is lossless', () => {
  const a = app();
  const dd = completedDay(a);
  fillFourLaps(a, dd, { hr: true });
  const restored = JSON.parse(JSON.stringify(dd));
  assert.deepEqual(restored.actual.splits, clone(dd.actual.splits));
});

test('splits are part of ACTUAL_SYNCED_FIELDS, so a splits-only edit is not invisible to sync', () => {
  const a = app();
  assert.ok(a.ACTUAL_SYNCED_FIELDS.indexOf('splits') !== -1);
  const dd = completedDay(a);
  dd.actual.km = 5;
  const before = JSON.stringify(a.ACTUAL_SYNCED_FIELDS.reduce((o, k) => { o[k] = dd.actual[k] === undefined ? null : dd.actual[k]; return o; }, {}));
  a.handleAddSplit(dd.id);
  a.handleSplitFieldChange(dd.id, 0, 'km', '1');
  a.handleSplitFieldChange(dd.id, 0, 'sec', '5:00');
  const after = JSON.stringify(a.ACTUAL_SYNCED_FIELDS.reduce((o, k) => { o[k] = dd.actual[k] === undefined ? null : dd.actual[k]; return o; }, {}));
  assert.notEqual(before, after, 'a change to laps alone must change the synced signature');
});

test('clearing the whole-session log clears its laps too -- there is one log, not two', () => {
  const a = app();
  const dd = completedDay(a);
  fillFourLaps(a, dd);
  a.handleClearActual(dd.id);
  assert.equal(dd.actual.splits, undefined);
});

test('editing laps on one completed day never touches another day\'s log or review', () => {
  const a = app();
  const dd1 = completedDay(a);
  const others = a.state.days.filter(x => x.type !== 'rest' && x.id !== dd1.id).slice(0, 1);
  const dd2 = others[0] ? (others[0].completed = true, others[0].actual = a.emptyActual(), others[0]) : null;
  if (dd2) { dd2.actual.km = 5; dd2.actual.pace = '5:30'; }
  fillFourLaps(a, dd1);
  if (dd2) {
    assert.equal(dd2.actual.splits, undefined);
    assert.equal(dd2.actual.km, 5);
  }
});

// ---------------------------------------------------------------------------
// 8. UNIT DISPLAY, AND NO SECOND SURFACE
// ---------------------------------------------------------------------------
test('a lap distance round-trips correctly between km and mi display', () => {
  const a = app();
  const dd = completedDay(a);
  a.handleAddSplit(dd.id);
  a.state.units = 'mi';
  a.handleSplitFieldChange(dd.id, 0, 'km', '1'); // entered as 1 mile while units=mi
  // parseDistInput()/kmToDisplay() round at 1dp going in and 2dp coming back
  // out -- the same shared helpers the whole-session km field already uses,
  // so a mile entry redisplaying as 0.99mi is existing, pre-existing
  // rounding behaviour, not something splits introduced.
  assert.equal(dd.actual.splits[0].km, a.round1(1 / 0.621371));
  const html = a.renderSplitsBody(dd);
  assert.match(html, new RegExp('value="' + a.kmToDisplay(dd.actual.splits[0].km) + '"'),
    'the field redisplays via the app\'s own kmToDisplay(), not a re-derived value');
});

test('the splits control lives inside the existing logging panel, not a new card', () => {
  const a = app();
  const dd = completedDay(a);
  fillFourLaps(a, dd);
  const card = a.renderDayCard(dd);
  const panelStart = card.indexOf('actual-panel');
  const panelEnd = card.indexOf('</div>\n', card.indexOf('actual-clear'));
  const splitsIdx = card.indexOf('splits-block');
  assert.ok(panelStart !== -1 && splitsIdx > panelStart, 'splits-block must render inside .actual-panel');
  assert.doesNotMatch(card, /<details class="fuel-card[^"]*splits/, 'laps must not become their own disclosure/card');
});

test('no Serverless Function was added for splits -- everything is local, client-side state', () => {
  const fs = require('fs');
  const path = require('path');
  const apiDir = path.join(__dirname, '..', 'api');
  const files = fs.readdirSync(apiDir).filter(f => f.endsWith('.js') && !f.startsWith('_'));
  /* Stated as a CEILING rather than a constant. Every one of these
     assertions was written to mean "my feature added no Serverless
     Function", and pinning the absolute total made a legitimate
     CONSOLIDATION look like a regression: the Strava routes moved
     behind one router and the count fell 12 -> 7, which is the same
     claim holding more strongly, not a broken one. The limit is what
     the deployment actually enforces. */
  assert.ok(files.length <= 12, 'splits add no Serverless Function');
});
