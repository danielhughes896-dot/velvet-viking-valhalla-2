'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* YOUR LOG: THE EVIDENCE, FROM THE FEWEST INTERACTIONS

   Founder: "SACORO should collect the evidence its coaching engine needs
   with the fewest possible interactions, without losing useful information
   or inventing missing data. No major redesign. Just a cleaner, faster, more
   intelligent Your Log."

   And the items under it that this file holds:

   2. "Multi-stage sessions: Warm-up -> Main Set -> Cool-down. SACORO
      calculates overall distance and pace from actual stage data where
      possible, without duplicating inputs or assuming prescribed distances
      were completed. Manual correction remains available."
   3. "Repetition sessions: Replace individual pace/HR entry boxes with
      simple rep-by-rep assessments using sliders or compact controls.
      Exactly the number of repetitions prescribed. Watch data supplies
      detailed metrics when available."
   4. "Reduce overall logging height by approximately 10-15%, primarily
      through tighter vertical spacing. Keep text, input fields, buttons and
      slider handles readable and thumb-friendly."
   6. "Notes: Remove the duplicated explanatory sentence. Keep one concise
      placeholder."
   7. "Only show questions relevant to the workout ... hill sessions assess
      effort rather than relying on pace."

   (What is drawn where, per session type, is yourLogSections.test.js.) */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
const END = '2026-10-20';
const rule = sel => { const at = CSS.indexOf('\n  ' + sel + '{'); assert.ok(at !== -1, sel + ' has no rule'); return CSS.slice(at + 3, CSS.indexOf('}', at)); };
const fnBody = name => { const at = SRC.indexOf('\nfunction ' + name + '('); assert.ok(at !== -1, name + ' is gone'); return SRC.slice(at, SRC.indexOf('\n}\n', at)); };

function block(distanceKey){
  const a = loadApp({ pinnedDate: END + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.replaceCard = () => {}; a.patchDerivedStats = () => {}; a.patchExecutionUI = () => {}; a.patchSplitsTotal = () => {};
  buildPlan(a, { distanceKey, volume: 60, weeks: 16, lthr: 172, maxHR: 188, startDate: '2026-06-01' });
  return a;
}
/* A fresh app and a logged session of the wanted archetype, every time: these
   tests write to the session. */
function fresh(arch){
  for (const dk of ['5k', '10k', 'half']){
    const a = block(dk);
    const dd = a.state.days.filter(d => d.type !== 'rest' && d.date < END &&
      (a.prescriptionOf(d) || {}).archetype === arch)[0];
    if (!dd) continue;
    logAsPrescribed(a, dd, { quality: 1 });
    dd.actual.rpe = null;
    return { a, dd };
  }
  assert.fail('no ' + arch + ' in the fixture');
}
const log = (a, dd) => { a.logOpenFor[dd.id] = true; const h = a.renderCompletedPanel(dd, '');
  return h.slice(h.indexOf('class="log-body"'), h.indexOf('class="exec-review-mount"')); };
const tap = (a, dd, rep, times) => { for (let i = 0; i < (times || 1); i++) a.handleLogMark(dd.id, String(rep)); };
const marks = dd => Array.from(dd.actual.repMarks || []);

// ---------------------------------------------------------------------------
// 3. EACH REP, MARKED
// ---------------------------------------------------------------------------

test('a tap moves a rep on one step: on target, short of it, beyond it, then unmarked', () => {
  const { a, dd } = fresh('track_reps');
  const n = a.logShape(dd).reps;
  assert.ok(n >= 5);
  assert.equal(dd.actual.repMarks, undefined, 'a rep is marked before anyone touched it');
  tap(a, dd, 1);
  assert.deepEqual(marks(dd), ['on'].concat(Array(n - 1).fill(null)));
  tap(a, dd, 1); assert.equal(marks(dd)[0], 'under');
  tap(a, dd, 1); assert.equal(marks(dd)[0], 'over');
  tap(a, dd, 1);
  assert.equal(dd.actual.repMarks, undefined, 'a set with every mark cleared still stores marks');
  /* Exactly the reps prescribed: nothing outside them can be marked. */
  tap(a, dd, 0); tap(a, dd, n + 1); tap(a, dd, 'x');
  assert.equal(dd.actual.repMarks, undefined, 'a rep that is not in the session was marked');
  tap(a, dd, n); assert.equal(marks(dd).length, n); assert.equal(marks(dd)[n - 1], 'on');
  /* The screen says what is stored, and which are chosen. */
  tap(a, dd, 2, 2);
  const html = log(a, dd);
  const tiles = [...html.matchAll(/<button type="button" class="(active)?" aria-pressed="(true|false)" data-action="log-mark" data-rep="(\d+)" data-day="[^"]*" aria-label="([^"]+)"><span class="n">(\d+)<\/span><span class="t">([^<]+)<\/span><\/button>/g)];
  assert.equal(tiles.length, n);
  assert.deepEqual(tiles.map(t => t[6]), ['–', 'Slower'].concat(Array(n - 3).fill('–')).concat(['On pace']));
  assert.deepEqual(tiles.map(t => t[2]), ['false', 'true'].concat(Array(n - 3).fill('false')).concat(['true']));
  assert.equal(tiles[1][4], 'Rep 2: Slower'); assert.equal(tiles[0][4], 'Rep 1: not marked');
  assert.match(SRC, /case 'log-mark': handleLogMark\(target\.getAttribute\('data-day'\), target\.getAttribute\('data-rep'\)\); break;/);
});

/* Founder: "I've selected 4/5 reps but can select all tabs. The tabs should
   be locked to the slider selection." */
test('only the reps that were run can be marked: the tiles are locked to the slider', () => {
  const { a, dd } = fresh('hill_repeats');
  const n = a.logShape(dd).reps;
  const tiles = () => [...log(a, dd).matchAll(/data-action="log-mark" data-rep="(\d+)"/g)].map(m => +m[1]);
  /* Until the slider is answered: the prescribed number. */
  assert.deepEqual(tiles(), Array.from({ length: n }, (_, i) => i + 1));
  for (let i = 1; i <= n; i++) tap(a, dd, i);
  assert.equal(marks(dd).filter(Boolean).length, n);
  /* Four of five completed: four tiles, and the fifth rep's mark goes with it. */
  a.handleLogAnswer(dd.id, 'repsDone', String(n - 1));
  assert.deepEqual(tiles(), Array.from({ length: n - 1 }, (_, i) => i + 1), 'a rep that was not run can still be marked');
  assert.equal(marks(dd).length, n - 1, 'a mark is kept for a rep that was not run');
  tap(a, dd, n);
  assert.equal(marks(dd).length, n - 1, 'a rep beyond the slider was marked');
  assert.equal(a.logRepMarkSummary(dd).of, n - 1);
  assert.match(a.sessionReadoutHtml(dd), new RegExp((n - 1) + ' of ' + (n - 1) + ' reps on target'));
  /* None completed: nothing to mark, and nothing left stored. */
  a.handleLogAnswer(dd.id, 'repsDone', '0');
  assert.deepEqual(tiles(), []);
  assert.equal(dd.actual.repMarks, undefined);
  /* The slider cleared: back to the prescribed number, unmarked. */
  a.handleLogClear(dd.id, 'repsDone');
  assert.deepEqual(tiles(), Array.from({ length: n }, (_, i) => i + 1));
});

test('hill reps are marked by effort, never by pace', () => {
  const { a, dd } = fresh('hill_repeats');
  tap(a, dd, 1); tap(a, dd, 2, 2); tap(a, dd, 3, 3);
  const html = log(a, dd);
  assert.deepEqual([...html.matchAll(/data-action="log-mark"[^>]*><span class="n">\d+<\/span><span class="t">([^<]+)</g)].map(m => m[1]).slice(0, 3),
    ['On target', 'Too easy', 'Too hard']);
  assert.doesNotMatch(html, /On pace|Slower|Faster/, 'a hill rep is judged by pace');
  /* Founder: "I'm not clear on what easier on effort or harder is." Easier
     than what was the missing half, so the words carry it. */
  assert.doesNotMatch(html, /On effort|>Easier<|>Harder</, 'the unclear words are back');
  assert.match(html, /Tap a rep: on target, too easy or too hard\. Leave any you are not sure of\./);
  /* Stored as the same three words as any other rep, so one reader serves both. */
  assert.deepEqual(marks(dd).slice(0, 3), ['on', 'under', 'over']);
  assert.match(log(a, dd), /Did your effort hold\?/);
});

test('the marks are read by the session\'s own assessment: how much was on target, and whether it faded', () => {
  /* Nothing marked: nothing claimed. */
  let { a, dd } = fresh('track_reps');
  const n = a.logShape(dd).reps;
  assert.equal(a.logRepMarkSummary(dd).marked, 0);
  assert.equal(a.logRepMarkSummary(dd).pattern, null);
  assert.doesNotMatch(a.sessionReadoutHtml(dd), /reps on pace/);

  /* Every rep on pace. */
  for (let i = 1; i <= n; i++) tap(a, dd, i);
  let sum = a.logRepMarkSummary(dd);
  assert.equal(sum.on + '/' + sum.marked + '/' + sum.of, n + '/' + n + '/' + n);
  assert.equal(sum.pattern, 'held');
  assert.match(a.sessionReadoutHtml(dd), new RegExp(n + ' of ' + n + ' reps on pace'));

  /* The last third slower: the set faded, said in the engine's own word. */
  ({ a, dd } = fresh('track_reps'));
  for (let i = 1; i <= n; i++) tap(a, dd, i, i > n - Math.round(n / 3) ? 2 : 1);
  sum = a.logRepMarkSummary(dd);
  assert.equal(sum.pattern, 'faded');
  assert.match(a.sessionReadoutHtml(dd), /the set faded/);
  /* What the athlete says outright about the set wins over what the marks imply. */
  a.handleLogAnswer(dd.id, 'mainSetHeld', '3');
  assert.doesNotMatch(a.sessionReadoutHtml(dd), /the set faded/);

  /* The first third slower, then on pace: it built. */
  ({ a, dd } = fresh('track_reps'));
  for (let i = 1; i <= n; i++) tap(a, dd, i, i <= Math.round(n / 3) ? 2 : 1);
  assert.equal(a.logRepMarkSummary(dd).pattern, 'built');

  /* Some marked, some left: only the marked ones are counted, and it says so. */
  ({ a, dd } = fresh('track_reps'));
  tap(a, dd, 1); tap(a, dd, 2); tap(a, dd, 3, 2);
  assert.match(a.sessionReadoutHtml(dd), /2 of 3 marked reps on pace/);
  assert.equal(a.logRepMarkSummary(dd).of, n);

  /* Two marks are two facts and not a pattern. */
  ({ a, dd } = fresh('track_reps'));
  tap(a, dd, 1); tap(a, dd, 2, 2);
  assert.equal(a.logRepMarkSummary(dd).pattern, null, 'a fade was read out of two reps');
  assert.doesNotMatch(a.sessionReadoutHtml(dd), /the set (faded|got stronger)/);

  /* The marks say the last reps fell short; the athlete says the effort
     held. The athlete was there. */
  const said = fresh('hill_repeats');
  const sn = said.a.logShape(said.dd).reps;
  for (let i = 1; i <= sn; i++) tap(said.a, said.dd, i, i === sn ? 2 : 1);
  assert.equal(said.a.logRepMarkSummary(said.dd).pattern, 'faded');
  assert.equal(said.a.assessSession(said.dd).execution.level, 'mixed');
  said.a.handleLogAnswer(said.dd.id, 'mainSetHeld', '3');
  assert.equal(said.a.assessSession(said.dd).execution.level, 'high', 'the marks overruled what the athlete said about the set');

  /* Up a hill it is effort, and a set mostly short of it is a mixed set. */
  const hill = fresh('hill_repeats');
  const hn = hill.a.logShape(hill.dd).reps;
  for (let i = 1; i <= hn; i++) tap(hill.a, hill.dd, i, 2);
  const ex = hill.a.assessSession(hill.dd).execution;
  assert.equal(ex.basis, 'reported');
  assert.equal(ex.level, 'mixed');
  assert.equal(ex.score, null, 'a tap was turned into a score');
  assert.match(hill.a.sessionReadoutHtml(hill.dd), new RegExp('0 of ' + hn + ' reps on target'));
});

test('a mark is never turned into a pace, a split or a score', () => {
  const { a, dd } = fresh('track_reps');
  const n = a.logShape(dd).reps;
  const before = JSON.stringify([a.computeExecutionBreakdown(dd), dd.actual.pace, dd.actual.km, dd.actual.splits || null]);
  for (let i = 1; i <= n; i++) tap(a, dd, i, 2);
  assert.equal(JSON.stringify([a.computeExecutionBreakdown(dd), dd.actual.pace, dd.actual.km, dd.actual.splits || null]), before,
    'marking reps changed a measured figure or the session\'s score');
  assert.equal(a.assessSession(dd).execution.score == null || a.assessSession(dd).execution.basis !== 'reported', true,
    'a reported set was given a number');
  ['logRepMarks', 'logRepMarkSummary', 'handleLogMark'].forEach(f =>
    assert.ok(!/paceSec|splits|\.km\b|\.sec\b/.test(fnBody(f)), f + ' writes or reads a measurement'));
  /* A set re-marked is new evidence; the same marks are not. */
  const sig = a.evolutionEvidenceSignature();
  tap(a, dd, 1);
  assert.notEqual(a.evolutionEvidenceSignature(), sig, 'a changed mark is not new evidence');
});

test('watch laps and figures already typed for a rep are still shown, by name', () => {
  const { a, dd } = fresh('track_reps');
  const plan = a.loggingModeFor(dd).plan;
  const reps = Array.from(plan.rows).filter(r => r.role === 'work');
  /* A rep that holds a pace -- typed before the marks existed -- keeps its row. */
  a.handleStructuredSplitChange(dd.id, reps[2].segId, 'pace', '3:45');
  let html = log(a, dd);
  assert.equal((html.match(/class="slog-row/g) || []).length, 3, 'the rep that holds a figure lost its row');   // warm-up, that rep, cool-down
  assert.match(html, new RegExp('<span class="slog-label">' + reps[2].label + '<'), 'a lone rep row has no name');
  assert.match(html, /Optional — enter what you know\./);
  /* The marks are still exactly the prescribed number. */
  assert.equal((html.match(/data-action="log-mark"/g) || []).length, reps.length);
  /* And what a watch recorded is still drawn. */
  dd.actual.deviceLaps = [1, 2, 3, 4].map(i => ({ km: 0.7, sec: 160 + i, paceSec: Math.round((160 + i) / 0.7) }));
  dd.actual.deviceLapSource = 'strava';
  assert.match(a.renderSplitsBlock(dd), /Recorded laps \u00b7 4 from your watch/, 'what the watch recorded is no longer drawn');
});

// ---------------------------------------------------------------------------
// 2. THE WHOLE SESSION, FROM ITS STAGES
// ---------------------------------------------------------------------------

/* A threshold session with its own distance entered and no pace. */
function staged(){
  const { a, dd } = fresh('threshold_continuous');
  dd.actual.pace = null; delete dd.actual.paceUnit;
  const rows = Array.from(a.loggingModeFor(dd).plan.rows);
  assert.equal(rows.length, 3, 'the fixture is not warm-up, main set, cool-down');
  assert.ok(rows.every(r => r.presKm > 0), 'the fixture\'s stages are not set by distance');
  return { a, dd, rows, planned: rows.reduce((t, r) => t + r.presKm, 0) };
}
const stage = (a, dd, row, pace) => a.handleStructuredSplitChange(dd.id, row.segId, 'pace', pace);

test('the average pace is worked out once every stage has one and the athlete\'s own distance matches the plan', () => {
  const { a, dd, rows, planned } = staged();
  a.handleActualFieldChange(dd.id, 'km', String(planned));
  assert.equal(dd.actual.pace, null);
  stage(a, dd, rows[0], '6:00');
  assert.equal(dd.actual.pace, null, 'one stage of three was treated as the session');
  stage(a, dd, rows[1], '4:30');
  assert.equal(dd.actual.pace, null);
  stage(a, dd, rows[2], '6:30');
  /* The stage paces, weighted by the size of each stage. */
  const want = Math.round((360 * rows[0].presKm + 270 * rows[1].presKm + 390 * rows[2].presKm) / planned);
  assert.equal(dd.actual.paceDerived, true);
  assert.equal(a.paceToSec(dd.actual.pace), want);
  assert.equal(dd.actual.paceUnit, 'km');
  assert.equal(a.actualPaceSecPerKm(dd), want, 'the worked-out pace is not where the score reads pace');
  assert.ok(a.computeExecutionBreakdown(dd), 'the session does not score on a worked-out pace');
  assert.match(log(a, dd), /data-log-totals-note>Average pace worked out from your stages\. Type over it to correct it\.</);
  /* The distance is the athlete's and is never rewritten from paces. */
  assert.equal(dd.actual.km, planned);
  assert.equal(dd.actual.kmDerived, undefined);
  /* A stage changed: the average follows it. */
  stage(a, dd, rows[1], '4:20');
  assert.equal(a.paceToSec(dd.actual.pace), Math.round((360 * rows[0].presKm + 260 * rows[1].presKm + 390 * rows[2].presKm) / planned));
  /* A stage emptied: there is no longer an average to state, and it is taken back. */
  stage(a, dd, rows[2], '');
  assert.equal(dd.actual.pace, null);
  assert.equal(dd.actual.paceDerived, undefined);
  assert.doesNotMatch(log(a, dd), /worked out from your stages/);
});

test('prescribed distances are never assumed: a session run short or long is not added up', () => {
  [0.8, 1.25].forEach(f => {
    const { a, dd, rows, planned } = staged();
    a.handleActualFieldChange(dd.id, 'km', String(Math.round(planned * f * 10) / 10));
    rows.forEach(r => stage(a, dd, r, '5:00'));
    assert.equal(dd.actual.pace, null, 'a session that covered ' + f + ' of its distance was read as run to plan');
    assert.equal(dd.actual.paceDerived, undefined);
  });
  /* No distance from the athlete at all: nothing to check the stages against. */
  const none = staged();
  none.dd.actual.km = null;
  none.rows.forEach(r => stage(none.a, none.dd, r, '5:00'));
  assert.equal(none.dd.actual.pace, null);
  assert.equal(none.dd.actual.km, null, 'a distance was made up from stage paces');
  /* Within the tolerance it is, and outside it is not. */
  const edge = staged();
  edge.a.handleActualFieldChange(edge.dd.id, 'km', String(Math.round(edge.planned * (1 + edge.a.LOG_TOTALS_MATCH - 0.01) * 100) / 100));
  edge.rows.forEach(r => stage(edge.a, edge.dd, r, '5:00'));
  assert.equal(edge.dd.actual.paceDerived, true);
  /* The distance corrected afterwards: the average is taken back with it. */
  edge.a.handleActualFieldChange(edge.dd.id, 'km', String(edge.planned + 3));
  assert.equal(edge.dd.actual.pace, null);
  edge.a.handleActualFieldChange(edge.dd.id, 'km', String(edge.planned));
  assert.equal(edge.dd.actual.paceDerived, true, 'the average did not return when the distance matched again');
});

test('manual correction remains: a figure the athlete types is theirs and is not overwritten', () => {
  const { a, dd, rows, planned } = staged();
  a.handleActualFieldChange(dd.id, 'km', String(planned));
  rows.forEach(r => stage(a, dd, r, '5:00'));
  assert.equal(dd.actual.paceDerived, true);
  a.handleActualFieldChange(dd.id, 'pace', '5:12');
  assert.equal(dd.actual.pace, '5:12');
  assert.equal(dd.actual.paceDerived, undefined);
  stage(a, dd, rows[1], '4:40');
  assert.equal(dd.actual.pace, '5:12', 'a typed pace was replaced by a worked-out one');
  assert.doesNotMatch(log(a, dd), /worked out from your stages/);
  /* A session logged the ordinary way -- distance and pace typed -- is untouched by any of this. */
  const plain = fresh('threshold_continuous');
  const was = plain.dd.actual.pace;
  Array.from(plain.a.loggingModeFor(plain.dd).plan.rows).forEach(r => stage(plain.a, plain.dd, r, '6:10'));
  assert.equal(plain.dd.actual.pace, was);
  assert.equal(plain.dd.actual.paceDerived, undefined);
});

test('where the stages carry a measured distance and time, the whole session is their sum', () => {
  const { a, dd, rows } = staged();
  dd.actual.km = null;
  dd.actual.splits = rows.map((r, i) => ({ segId: r.segId, role: r.role, label: r.label, km: [2, 5.2, 1][i], sec: [720, 1404, 400][i], paceSec: Math.round([720, 1404, 400][i] / [2, 5.2, 1][i]) }));
  a.logApplyStageTotals(dd);
  assert.equal(dd.actual.km, 8.2);
  assert.equal(dd.actual.kmDerived, true);
  assert.equal(a.paceToSec(dd.actual.pace), Math.round(2524 / 8.2));
  assert.match(log(a, dd), /Distance and average pace worked out from your stages\./);
  /* A stage whose distance is only the prescription's is not a measurement. */
  dd.actual.splits[1].kmFromPrescription = true;
  a.logApplyStageTotals(dd);
  assert.equal(dd.actual.km, null, 'a prescribed distance was counted as a measured one');
  assert.equal(dd.actual.kmDerived, undefined);
  /* Typing the distance makes it the athlete's. */
  delete dd.actual.splits[1].kmFromPrescription;
  a.logApplyStageTotals(dd);
  a.handleActualFieldChange(dd.id, 'km', '8.5');
  assert.equal(dd.actual.km, 8.5);
  assert.equal(dd.actual.kmDerived, undefined);
});

test('the three whole-session figures share one row, and none is asked for twice', () => {
  const { a, dd } = fresh('threshold_continuous');
  const html = log(a, dd);
  const totals = html.slice(html.indexOf('class="actual-field full log-totals has-hr"'), html.indexOf('class="actual-field full yl"'));
  ['km', 'pace', 'hr'].forEach(f => {
    assert.equal((totals.match(new RegExp('data-action="actual-field" data-field="' + f + '"', 'g')) || []).length, 1, f + ' is not in the totals row');
    assert.equal((html.match(new RegExp('data-action="actual-field" data-field="' + f + '"', 'g')) || []).length, 1, f + ' is asked for twice');
  });
  assert.match(rule('.log-totals.has-hr'), /grid-template-columns:repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(rule('.log-totals'), /grid-template-columns:repeat\(2, minmax\(0, 1fr\)\)/);
  const was = a.healthConsentGranted;
  a.healthConsentGranted = () => false;
  const bare = log(a, dd); a.healthConsentGranted = was;
  assert.match(bare, /class="actual-field full log-totals">/, 'two figures are laid out for three');
  assert.doesNotMatch(bare, /data-field="hr"/);
});

// ---------------------------------------------------------------------------
// 6. NOTES
// ---------------------------------------------------------------------------

test('the notes say what they are for once, in the box', () => {
  const { a, dd } = fresh('easy_run');
  const html = log(a, dd);
  const at = html.indexOf('class="actual-field full notes-field"');
  const notes = html.slice(at, html.indexOf('data-action="clear-actual"'));
  assert.match(notes, /placeholder="Anything the numbers don’t show: heavy legs, poor sleep, illness, a sensor fault\."/);
  assert.doesNotMatch(notes, /class="field-hint"/, 'the sentence under the notes is back');
  assert.equal((notes.match(/numbers don/g) || []).length, 1, 'the notes explain themselves twice');
  /* It names what the tiles above do not already offer. */
  assert.doesNotMatch(notes.match(/placeholder="([^"]+)"/)[1], /heat|wind|hills|treadmill/i);
});

// ---------------------------------------------------------------------------
// 4 AND 5. TIGHTER, NOT SMALLER
// ---------------------------------------------------------------------------

test('the log is shorter by its gaps alone: every thumb target is the size it was', () => {
  const px = (sel, prop) => { const m = new RegExp(prop + ':(\\d+)px').exec(rule(sel)); assert.ok(m, sel + ' has no ' + prop); return +m[1]; };
  /* What must not have shrunk. */
  assert.match(rule('.yl-range'), /height:44px; min-height:44px/, 'a slider is no longer a 44px target');
  assert.match(rule('.yl .slog-in'), /min-height:44px; font-size:16px/, 'a stage field shrank');
  assert.match(rule('.yl .opt-grid button'), /min-height:48px/, 'a tile shrank');
  assert.match(rule('.yl-clear'), /min-height:44px/);
  assert.match(CSS, /\.yl-range::-webkit-slider-thumb\{[^}]*width:26px; height:26px/, 'a slider handle shrank');
  assert.match(rule('.yl-title'), /font-size:19px/);
  assert.match(rule('.yl-q-t'), /font-size:var\(--fs-body\)/);
  /* What did: the space between things. Each is smaller than it was, and none is gone. */
  [['.yl-sec', 'margin-top', 36], ['.yl-q', 'margin-top', 26], ['.yl-grp', 'margin-top', 40],
   ['.yl-rows', 'margin-top', 18], ['.yl-opt', 'margin-top', 16]].forEach(([sel, prop, was]) => {
    const now = px(sel, prop);
    assert.ok(now < was, sel + ' is not tighter than it was (' + now + ' against ' + was + ')');
    assert.ok(now >= 10, sel + ' has lost its space altogether');
  });
  /* The first fields sit clear of the Your Log tab. */
  assert.ok(px('.log-body', 'margin-top') >= 20, 'the first fields are tight against the Your Log tab again');
  /* The rep tiles are thumb-sized and four to a row. */
  assert.match(rule('.yl .yl-marks'), /grid-template-columns:repeat\(4, minmax\(0, 1fr\)\)/);
  assert.ok(!/min-height/.test(rule('.yl .yl-marks button')), 'the rep tile overrides the 48px every tile has');
});

// ---------------------------------------------------------------------------
// CHERRY, NOT GOLD, ROUND WHAT IS BEING USED
// ---------------------------------------------------------------------------

/* Founder: "Check all boxes in the log session as they're coming up gold on
   selection. Cherry please." And of the tabs: "It shouldn't be gold around
   these boxes when selected." */
test('nothing on the log, and no tab, takes a gold rim when it is selected', () => {
  assert.match(rule('.log-body :focus-visible'), /outline-color:var\(--cherry-text\)/);
  /* It comes after, and outranks, the product's one global ring -- which is left as it is. */
  assert.match(CSS, /\n  :focus-visible\{outline:2px solid var\(--gold\); outline-offset:2px; border-radius:4px;\}/);
  assert.ok(CSS.indexOf('.log-body :focus-visible{') > CSS.indexOf('\n  :focus-visible{'));
  /* No rule scoped to the log puts gold round a focused or chosen control. */
  const logRules = [...CSS.matchAll(/\n  ([^{}\n]*(?:\.log-body|\.yl|\.slog|\.log-totals)[^{}\n]*(?::focus|:hover|\.active)[^{}\n]*)\{([^}]*)\}/g)];
  logRules.forEach(m => assert.ok(!/(outline|border)[^;]*var\(--(gold|bronze)[^)]*\)/.test(m[2]), m[1] + ' is gold when selected'));
  /* The tabs: Share, Session Details, Your Log, and Edit Session's two. */
  assert.equal(rule('.sess-tab:hover, .sess-tab:focus-visible'), '.sess-tab:hover, .sess-tab:focus-visible{border-color:var(--cherry);');
  assert.doesNotMatch(CSS, /\.sess-tab:hover\{border-color:var\(--bronze\)/);
});
