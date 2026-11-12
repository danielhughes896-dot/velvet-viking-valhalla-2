'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* YOUR LOG, ACROSS EVERY WORKOUT THE ENGINE BUILDS.

   Founder: "Audit Your Log across every workout type. Confirm multi-part
   sessions automatically show separate Warm-up, Main Set and Cool-down
   inputs, including appropriate interval/rep details, while easy runs
   remain simple. Remove redundant 'Hide Detail', 'Add Laps / Splits' and
   unnecessary gold subheadings. Keep Avg HR, elevation and notes directly
   visible, with no duplicate inputs. Preserve all scoring/coaching
   connections."

   And: "three sections should appear only when the prescription actually
   contains them. We don't want SACORO forcing warm-up and cooldown fields
   onto an ordinary easy run. When you open your log it goes straight to the
   bottom it shouldn't." */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
const END = '2026-10-20';

function block(distanceKey, volume){
  const a = loadApp({ pinnedDate: END + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.replaceCard = () => {}; a.patchDerivedStats = () => {};
  buildPlan(a, { distanceKey, volume, weeks: 16, lthr: 172, maxHR: 188, startDate: '2026-06-01' });
  return a;
}
/* One logged example of every archetype, across four distances and two
   volumes -- every structure the generator can write. */
let CACHE = null;
function everyStructure(){
  if (CACHE) return CACHE;
  const out = {};
  ['5k', '10k', 'half', 'full'].forEach(dk => [30, 60].forEach(vol => {
    const a = block(dk, vol);
    a.state.days.forEach(d => {
      if (d.type === 'rest' || d.date >= END) return;
      const p = a.prescriptionOf(d), arch = p && p.archetype;
      if (!arch || out[arch]) return;
      logAsPrescribed(a, d, { quality: 1 });
      d.actual.rpe = null;
      out[arch] = { a, dd: d, arch };
    });
  }));
  CACHE = out;
  return out;
}
const log = c => { c.a.logOpenFor[c.dd.id] = true; const h = c.a.renderCompletedPanel(c.dd, '');
  return h.slice(h.indexOf('class="log-body"'), h.indexOf('class="exec-review-mount"')); };
const parts = html => [...html.matchAll(/data-part="([a-z]+)"/g)].map(m => m[1]);
const section = (html, p) => {
  const at = html.indexOf('data-part="' + p + '"');
  if (at === -1) return '';
  const rest = html.slice(at + 12);
  const next = rest.search(/data-part="|data-group="|<div id="splits-total-|data-field="rpe"/);
  return next === -1 ? rest : rest.slice(0, next);
};
const rowLabels = html => [...html.matchAll(/<span class="slog-label">([^<]+)</g)].map(m => m[1]);
const count = (html, re) => (html.match(re) || []).length;

// ---------------------------------------------------------------------------
// THE SECTIONS A SESSION HAS ARE THE SECTIONS IT IS GIVEN
// ---------------------------------------------------------------------------

test('every structure is covered, so none of these laws passes on an empty loop', () => {
  const seen = Object.keys(everyStructure()).sort();
  ['easy_run', 'long_run', 'shakeout', 'easy_strides', 'track_reps', 'hill_repeats', 'fartlek', 'ladder', 'deuce',
   'split_tempo', 'steady_tempo', 'progressive_tempo', 'threshold_continuous', 'goal_pace_block', 'time_trial',
   'long_run_goal_finish', 'long_run_goal_insert', 'long_run_goal_broken', 'race']
    .forEach(k => assert.ok(seen.indexOf(k) !== -1, 'the fixtures no longer build a ' + k));
  assert.ok(seen.length >= 19, 'only ' + seen.length + ' structures: ' + seen.join(', '));
});

test('warm-up and cool-down sections appear exactly when the prescription contains them', () => {
  Object.values(everyStructure()).forEach(c => {
    const plan = c.a.loggingModeFor(c.dd).plan;
    const roles = plan ? Array.from(plan.rows).map(r => r.role) : [];
    const html = log(c), got = parts(html);
    assert.equal(got.indexOf('warmup') !== -1, roles.indexOf('warmup') !== -1,
      c.arch + ': warm-up section ' + (roles.indexOf('warmup') !== -1 ? 'missing' : 'invented'));
    assert.equal(got.indexOf('cooldown') !== -1, roles.indexOf('cooldown') !== -1,
      c.arch + ': cool-down section ' + (roles.indexOf('cooldown') !== -1 ? 'missing' : 'invented'));
    assert.equal(count(html, /data-part="main"/g), 1, c.arch + ': not exactly one main box');
    /* In the order they are run. */
    assert.deepEqual(got, ['warmup', 'main', 'cooldown'].filter(p => got.indexOf(p) !== -1), c.arch + ': out of order');
    /* And what the section holds is the prescription's own segment. */
    ['warmup', 'cooldown'].forEach(p => {
      const want = roles.filter(r => r === p).length;
      assert.equal(count(section(html, p), /class="slog-row/g), want, c.arch + ': ' + p + ' rows');
    });
    /* The prescription is asked independently of the log plan, so a section
       cannot be missing because the plan forgot a segment the session has. */
    const segs = Array.from(c.a.orderedSegments(c.a.prescriptionOf(c.dd)) || []);
    if (plan && plan.source === 'segments')
      ['warmup', 'cooldown'].forEach(p =>
        assert.equal(roles.indexOf(p) !== -1, segs.some(s => s.role === p), c.arch + ': the plan and the prescription disagree about ' + p));
  });
});

test('an ordinary easy run, a long run and a shakeout stay simple', () => {
  const all = everyStructure();
  ['easy_run', 'long_run', 'shakeout'].forEach(k => {
    const html = log(all[k]);
    assert.deepEqual(parts(html), ['main'], k + ' was given sections');
    assert.equal(count(html, /class="slog-row/g), 0, k + ' is asked for segments');
    assert.doesNotMatch(html, />Warm-up<|>Cool-down<|>Main set<|Reps completed|Recoveries|Did your (pace|effort) hold/, k + ' is asked a multi-part question');
    assert.match(html, /<div class="yl-title">The run<\/div>/, k + ' was given a heading it has no section for');
    assert.deepEqual([...html.matchAll(/class="yl-q-t">([^<]+)</g)].map(m => m[1]),
      ['How did it feel?', 'Overall effort', 'Anything hurting?'], k + ' is asked something else');
    /* Conditions is still asked: its heading is the group's now, not a second label. */
    assert.match(html, /role="group" aria-label="Conditions"/, k + ' is not asked the conditions');
  });
});

test('a session with all three shows all three, with the main set between them', () => {
  const all = everyStructure();
  ['threshold_continuous', 'track_reps', 'hill_repeats', 'fartlek', 'ladder', 'deuce', 'split_tempo', 'steady_tempo',
   'progressive_tempo', 'goal_pace_block', 'time_trial', 'long_run_goal_insert', 'long_run_goal_broken'].forEach(k => {
    const html = log(all[k]);
    assert.deepEqual(parts(html), ['warmup', 'main', 'cooldown'], k);
    assert.match(section(html, 'warmup'), /<div class="yl-title">Warm-up( \u00b7 [^<]+)?<\/div>/);
    assert.match(section(html, 'cooldown'), /<div class="yl-title">Cool-down( \u00b7 [^<]+)?<\/div>/);
    /* Under its own heading a single row is not named a second time. */
    assert.doesNotMatch(section(html, 'warmup') + section(html, 'cooldown'), /class="slog-label"/, k + ': "Warm up" is printed under "Warm-up"');
    assert.match(section(html, 'warmup'), /data-action="slog-field"/, k + ': the warm-up has nothing to fill in');
  });
});

test('a session with no warm-up or cool-down in it is not given one', () => {
  const all = everyStructure();
  /* Strides: an easy run, then the strides. A stage long run: its stages. */
  ['easy_strides', 'long_run_goal_finish', 'race'].forEach(k => {
    const html = log(all[k]);
    assert.deepEqual(parts(html), ['main'], k + ' was given a section its prescription does not have');
    if (k !== 'easy_strides') assert.ok(count(html, /class="slog-row/g) >= 2, k + ' lost its own rows');
  });
  /* Founder: "Easy runs stay simple." Strides are counted and nothing else:
     no stage boxes, no rep-by-rep marks, nothing about recoveries or
     whether the pace held. */
  const st = log(all.easy_strides);
  assert.equal(count(st, /class="slog-row/g), 0, 'an easy run with strides is asked for stage figures');
  assert.match(st, /<div class="yl-title">Strides \u00b7 6 \u00d7 100m<\/div>/);
  assert.match(st, />Strides completed</);
  assert.doesNotMatch(st, /data-action="log-mark"|data-field="recoveries"|data-field="mainSetHeld"|>Each rep</, 'strides are asked a workout\'s questions');
  assert.match(st, /data-field="mainSetFelt"/); assert.match(st, /data-field="rpe"/);
  assert.deepEqual(rowLabels(log(all.long_run_goal_finish)).filter(l => /Rep|Warm|Cool/.test(l)), []);
  assert.match(log(all.race), /<div class="yl-title">The race[^<]*<\/div>/);
});

// ---------------------------------------------------------------------------
// REPS
// ---------------------------------------------------------------------------

/* Founder: "Repetition sessions: Replace individual pace/HR entry boxes with
   simple rep-by-rep assessments using sliders or compact controls. Exactly
   the number of repetitions prescribed. Watch data supplies detailed metrics
   when available." (This law used to demand one pace and heart-rate row per
   rep.) */
test('every prescribed rep has one mark, and no pace or heart-rate box of its own', () => {
  const all = everyStructure();
  let seen = 0;
  Object.values(all).forEach(c => {
    const shape = c.a.logShape(c.dd), html = log(c), main = section(html, 'main');
    const marks = [...html.matchAll(/data-action="log-mark" data-rep="(\d+)"/g)].map(m => +m[1]);
    if (!shape.reps || shape.light){ assert.deepEqual(marks, [], c.arch + ' is asked to mark reps it does not have'); return; }
    seen++;
    assert.deepEqual(marks, Array.from({ length: shape.reps }, (_, i) => i + 1), c.arch + ' (' + c.dd.title + '): the marks are not one per prescribed rep');
    assert.ok(main.indexOf('data-action="log-mark"') !== -1, c.arch + ': the marks are not in the main set');
    assert.deepEqual(rowLabels(main).filter(l => /^Rep( \d+)?$/.test(l)), [], c.arch + ': a rep still has pace and heart-rate boxes');
    assert.match(html, new RegExp('data-field="repsDone"[^>]*data-of="' + shape.reps + '"'), c.arch + ': the reps slider does not run to the same number');
    /* Where the title states the count, that is the count. */
    const m = /(\d+)\s?x\s?\d/.exec(c.dd.title);
    if (m && !/twice/.test(c.dd.title)) assert.equal(shape.reps, +m[1], c.arch + ': "' + c.dd.title + '" is counted as ' + shape.reps);
    /* The words are the session's: a pace for reps run to one, effort up a hill. */
    assert.match(html, shape.hills ? /Tap a rep: on target, too easy or too hard\./ : /Tap a rep: on pace, slower or faster\./, c.arch);
    assert.equal(/Average pace/.test(main), false, c.arch + ': the main set of a rep session asks for a pace');
  });
  assert.ok(seen >= 4, 'the fixture has too few rep sessions for this to mean anything');
});

test('a strides session has six reps, not seven; and a ladder has reps at all', () => {
  const all = everyStructure();
  /* The easy running before the strides is not a stride. */
  const st = all.easy_strides;
  assert.match(st.dd.title, /6x100m/);
  assert.equal(st.a.logShape(st.dd).reps, 6, 'the easy run is being counted as a rep');
  assert.match(log(st), /data-field="repsDone"[^>]*data-of="6"/, 'the strides are not counted out of six');
  assert.equal(st.a.assessPlan(st.dd).reps.length, 6);
  /* 500-1000-1500-1000-500 is five reps by anyone's count. */
  const ld = all.ladder;
  assert.equal(ld.a.logShape(ld.dd).reps, 5, 'a ladder is not asked about its reps');
  assert.equal(ld.a.assessPlan(ld.dd).family, 'reps');
  assert.match(log(ld), /Reps completed/);
  /* And the completion the assessment reports is out of the same number. */
  ld.dd.actual.repsDone = 3;
  const done = ld.a.assessSession(ld.dd).completion;
  assert.equal(done.done + '/' + done.of + '/' + done.basis, '3/5/reps');
  delete ld.dd.actual.repsDone;
  st.dd.actual.repsDone = 6;
  assert.equal(st.a.assessSession(st.dd).completion.short, false, 'six of six strides is read as short');
  delete st.dd.actual.repsDone;
});

test('recoveries are asked about once: a row appears only where it already holds a number', () => {
  const all = everyStructure();
  const c = all.track_reps;
  const plan = c.a.loggingModeFor(c.dd).plan;
  const recs = Array.from(plan.rows).filter(r => r.kind === 'recovery');
  assert.ok(recs.length >= 3);
  let html = log(c);
  assert.doesNotMatch(html, /is-rec/, 'every recovery is asked for by number');
  assert.match(html, /data-field="recoveries"/, 'recoveries are not asked about at all');
  /* A number that is there is never hidden. */
  c.a.handleStructuredSplitChange(c.dd.id, recs[1].segId, recs[1].asks.dist ? 'km' : 'sec', recs[1].asks.dist ? '0.2' : '95');
  html = log(c);
  assert.equal(count(html, /slog-row is-rec/g), 1, 'a recovery the athlete logged is not shown');
  assert.match(section(html, 'main'), new RegExp('>' + recs[1].label + '<'));
  c.dd.actual.splits = c.dd.actual.splits.filter(s => s.segId !== recs[1].segId);
});

// ---------------------------------------------------------------------------
// NOTHING TO OPEN, NOTHING TWICE
// ---------------------------------------------------------------------------

test('heart rate, elevation and notes are on every log, once, with nothing to open', () => {
  Object.values(everyStructure()).forEach(c => {
    const html = log(c);
    ['km', 'pace', 'hr', 'elevationGainM', 'notes'].forEach(f =>
      assert.equal(count(html, new RegExp('data-action="actual-field" data-field="' + f + '"', 'g')), 1, c.arch + ': ' + f + ' is shown ' +
        count(html, new RegExp('data-action="actual-field" data-field="' + f + '"', 'g')) + ' times'));
    assert.equal(count(html, /data-field="rpe"/g), 1, c.arch + ': effort is asked more than once');
    assert.ok(count(html, /data-field="mainSetFelt"/g) <= 2, c.arch);     // the slider and its Clear
    assert.doesNotMatch(html, /toggle-detail|toggle-splits|splits-toggle|splits-summary|st-k|st-sub/, c.arch + ': a disclosure is back');
    assert.doesNotMatch(html, /Add detail|Hide detail|Add laps|laps \/ splits|Session breakdown|session breakdown/i, c.arch);
    /* No segment input is drawn twice. */
    const segIn = [...html.matchAll(/data-action="slog-field" data-field="([a-z]+)"\s+data-day="[^"]*" data-seg="([^"]+)"/g)].map(m => m[2] + ':' + m[1]);
    assert.equal(new Set(segIn).size, segIn.length, c.arch + ': a segment input is duplicated');
    /* And the order is the order the form is filled in. */
    const at = s => { const i = html.indexOf(s); assert.ok(i !== -1, c.arch + ': ' + s); return i; };
    assert.ok(at('data-field="pace"') < at('class="actual-field full yl"'));
    /* Average heart rate is the third whole-session figure and sits with
       the other two, above the sections. (It was below every question,
       between Anything hurting and Elevation.) */
    assert.ok(at('data-action="actual-field" data-field="pace"') < at('data-action="actual-field" data-field="hr"'));
    assert.ok(at('data-action="actual-field" data-field="hr"') < at('class="actual-field full yl"'), c.arch + ': heart rate is not with distance and pace');
    assert.ok(at('data-group="conditions"') < at('data-action="actual-field" data-field="elevationGainM"'));
    assert.ok(at('data-action="actual-field" data-field="elevationGainM"') < at('data-field="notes"'));
    assert.ok(at('data-field="notes"') < at('data-action="clear-actual"'));
  });
});

test('without health consent heart rate is not asked, in the header or in any row', () => {
  const c = everyStructure().threshold_continuous;
  const was = c.a.healthConsentGranted;
  c.a.healthConsentGranted = () => false;
  const html = log(c);
  c.a.healthConsentGranted = was;
  assert.doesNotMatch(html, /data-field="hr"/, 'a heart-rate box was drawn without consent');
  assert.match(html, /data-field="elevationGainM"/);
  assert.match(html, /data-field="notes"/);
  assert.deepEqual(parts(html), ['warmup', 'main', 'cooldown'], 'consent changed the shape of the session');
});

test('the section headings are white, and the rows are thumb-sized', () => {
  const CSS = SRC.slice(SRC.indexOf('<style>'), SRC.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, ' ');
  const rule = sel => { const i = CSS.indexOf(sel + '{'); assert.ok(i !== -1, sel + ' has no rule'); return CSS.slice(i, CSS.indexOf('}', i)); };
  assert.match(rule('.yl-title'), /color:#FFFFFF/);
  assert.match(rule('.yl .slog-in'), /min-height:44px/);
  assert.match(rule('.yl .slog-label'), /color:#FFFFFF/);
  assert.match(rule('.yl .slog-presc'), /color:#FFFFFF/);
  const yl = CSS.slice(CSS.indexOf('.yl{'), CSS.indexOf('.today-proposal{'));
  assert.doesNotMatch(yl, /var\(--gold\)|var\(--bronze|var\(--ink-(dim|faint)\)/, 'a gold or grey heading is back in Your Log');
});

// ---------------------------------------------------------------------------
// THE CONNECTIONS
// ---------------------------------------------------------------------------

test('a row filled in is saved where every reader already looks, and still scores', () => {
  const c = everyStructure().track_reps, a = c.a, dd = c.dd;
  const plan = a.loggingModeFor(dd).plan;
  const html = log(c);
  /* The inputs on screen carry the plan's own segment ids and the handler's own action. */
  const onScreen = new Set([...html.matchAll(/data-action="slog-field" data-field="[a-z]+"\s+data-day="[^"]*" data-seg="([^"]+)"/g)].map(m => m[1]));
  const reps = Array.from(plan.rows).filter(r => r.role === 'work');
  /* The warm-up and cool-down are stages and are typed; the reps are marked
     now, so they have no box until they hold a figure. What is tested below
     is that a figure a rep DOES hold -- from an earlier log, or from a watch
     -- is still saved where every reader looks, still scores, and is then
     drawn. */
  Array.from(plan.rows).filter(r => r.role === 'warmup' || r.role === 'cooldown').forEach(r =>
    assert.ok(onScreen.has(r.segId), r.label + ' has no input on the screen'));
  reps.forEach(r => assert.ok(!onScreen.has(r.segId), r.label + ' still has typed boxes'));
  assert.match(SRC, /action === 'slog-field'\) handleStructuredSplitChange\(/, 'the row inputs are not wired to the structured handler');
  const before = a.computeExecutionBreakdown(dd);
  /* Typed the way the screen now asks: an average pace per rep. */
  reps.forEach((r, i) => a.handleStructuredSplitChange(dd.id, r.segId, 'pace', '3:' + (40 + i)));
  const saved = dd.actual.splits.filter(s => s.role === 'work');
  assert.equal(saved.length, reps.length, 'the reps were not saved as structured splits');
  assert.ok(saved.every(s => s.paceSec != null), 'a rep was saved without a pace');
  const ev = a.structuredExecutionEvidence(dd);
  assert.equal(ev.reps, reps.length, 'the split analysis no longer sees the reps');
  assert.ok(ev.claims.length >= 1);
  assert.ok(a.computeExecutionBreakdown(dd), 'the session stopped scoring');
  assert.ok(before, 'the fixture session was not scoring to begin with');
  assert.equal(a.assessSession(dd).completion.done, reps.length, 'the assessment does not count the reps that were entered');
  /* And they come back on the next draw, exactly as typed. */
  const shown = [...section(log(c), 'main').matchAll(/value="([^"]*)"\s+data-action="slog-field" data-field="pace"/g)].map(m => m[1]);
  assert.deepEqual(shown, reps.map((r, i) => '3:' + (40 + i)), 'a pace came back different from how it was typed');
  dd.actual.splits = [];
});

test('what the watch recorded, and a lap list already typed, are still shown', () => {
  const c = everyStructure().easy_run, a = c.a, dd = c.dd;
  assert.equal(a.renderSplitsBlock(dd), '', 'an easy run with no laps is given a lap block');
  dd.actual.splits = [{ km: 1, sec: 330 }, { km: 1, sec: 328 }];
  const own = a.renderSplitsBlock(dd);
  assert.equal(count(own, /class="split-row"/g), 2, 'the athlete\'s own laps are hidden');
  assert.match(own, /<div class="yl-title">Laps<\/div>/);
  assert.equal(count(log(c), /class="split-row"/g), 2, 'the athlete\'s own laps are not on the log');
  delete dd.actual.splits;
  dd.actual.deviceLapSource = 'strava';
  dd.actual.deviceLaps = [{ km: 1, sec: 331, paceSec: 331 }, { km: 1, sec: 329, paceSec: 329 }];
  assert.match(a.renderSplitsBlock(dd), /dlap-card/, 'the recorded laps are gone');
  assert.match(log(c), /dlap-card/, 'the recorded laps are not on the log');
  delete dd.actual.deviceLapSource; delete dd.actual.deviceLaps;
});

// ---------------------------------------------------------------------------
// THE PAGE STAYS WHERE IT WAS
// ---------------------------------------------------------------------------

test('redrawing a card puts the page back where the thumb left it', () => {
  /* Measured in Chromium before this was fixed: tap Your Log on Today at
     597px and the page is at 2,387px. The browser's scroll anchoring moves
     it when the card is swapped; nothing in the app scrolls. */
  const a = block('half', 45);
  const real = /function replaceCard\(dd\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(real, /var y = hasWin \? \(window\.pageYOffset \|\| 0\) : 0;/);
  assert.ok(real.indexOf('var y =') < real.indexOf('replaceChild') && real.indexOf('replaceChild') < real.indexOf('window.scrollTo(0, y)'),
    'the position is not taken before the swap and restored after it');
  /* Run the real function against a page that behaves as the browser did. */
  const dd = a.state.days.filter(d => d.type !== 'rest')[0];
  const calls = [];
  const win = { pageYOffset: 597, scrollTo: (x, y) => { calls.push([x, y]); win.pageYOffset = y; } };
  const card = { parentNode: { replaceChild: () => { win.pageYOffset = 2387; } } };
  const doc = { getElementById: () => card, createElement: () => ({ set innerHTML(v){ this.firstChild = {}; } }) };
  const run = new Function('window', 'document', 'renderDayCard', 'wireCoachingRails', real + '; return replaceCard;')(win, doc, () => '<div></div>', () => {});
  run(dd);
  assert.deepEqual(calls, [[0, 597]], 'the page was left where the browser threw it');
  assert.equal(win.pageYOffset, 597);
  /* Nothing moved: nothing is touched. */
  calls.length = 0; card.parentNode.replaceChild = () => {};
  run(dd);
  assert.deepEqual(calls, []);
  /* Opening the log goes through it. */
  assert.match(/function handleToggleLog\(dayId\)\{[\s\S]*?\n\}/.exec(SRC)[0], /replaceCard\(dd\)/);
});

// ---------------------------------------------------------------------------
// THE FIELDS SAY WHAT THEY ARE
// ---------------------------------------------------------------------------

/* Founder: "The m:ss and HR placeholders are too subtle. On the threshold
   workout, I'd want something like: MAIN SET · THRESHOLD · 5 KM / Average
   pace  Average heart rate / Optional — enter what you know. The labels
   should be explicit. Athletes shouldn't have to work out whether m:ss means
   total time, average pace or something else ... the warm-up and cooldown
   should use the same field-label pattern." */

test('a threshold session reads the way the founder drew it', () => {
  const c = everyStructure().threshold_continuous;
  const html = log(c);
  const main = section(html, 'main');
  assert.match(main, /<div class="yl-title">Main set \u00b7 Threshold \u00b7 \d+(\.\d+)? km<\/div>/, 'the heading does not say what the main set is');
  assert.match(main, /<span class="slog-k">Average pace<\/span><input type="text" class="slog-in" placeholder="5:00 \/km"/);
  assert.match(main, /<span class="slog-k">Average heart rate<\/span><input type="number"[^>]*placeholder="155 bpm"/);
  assert.match(main, /<div class="yl-opt">Optional \u2014 enter what you know\.<\/div>/);
  /* The same pattern either side of it. */
  ['warmup', 'cooldown'].forEach(p => {
    const sec = section(html, p);
    assert.match(sec, new RegExp('<div class="yl-title">' + (p === 'warmup' ? 'Warm-up' : 'Cool-down') + ' \u00b7 \\d+(\\.\\d+)? km</div>'), p + ' heading');
    assert.match(sec, /<span class="slog-k">Average pace<\/span>/, p + ' does not name its pace field');
    assert.match(sec, /<span class="slog-k">Average heart rate<\/span>/, p + ' does not name its heart-rate field');
  });
  assert.equal(count(html, /class="yl-opt"/g), 1, 'the reassurance is said more than once');
});

test('no field anywhere on a log is a bare "m:ss", "km" or "HR"', () => {
  Object.values(everyStructure()).forEach(c => {
    const html = log(c);
    [...html.matchAll(/<input[^>]*data-action="slog-field"[^>]*>/g)].forEach(m => {
      assert.doesNotMatch(m[0], /placeholder="(m:ss|km|mi|HR)"/, c.arch + ': an unexplained placeholder: ' + m[0].slice(0, 120));
      assert.match(m[0], /aria-label="[^"]+ average (pace per (km|mi)|heart rate)"/, c.arch + ': a field with no name');
      assert.match(m[0], /data-field="(pace|hr)"/, c.arch + ': a row asks for something other than pace and heart rate');
    });
    /* Every row's two fields are named: on the row, or once above a list. */
    const rows = count(html, /class="slog-row/g);
    if (!rows){ assert.doesNotMatch(html, /class="yl-opt"/, c.arch + ': "Optional" with nothing optional under it'); return; }
    const named = count(html, /<span class="slog-k">Average pace<\/span>/g) + count(html, /<div class="slog-cols"[^>]*><span>Average pace<\/span>/g);
    assert.ok(named >= 1, c.arch + ': the pace fields are not named');
    [...html.matchAll(/data-part="[a-z]+"[\s\S]*?(?=data-part="|data-group="|data-field="rpe")/g)].forEach(p => {
      const n = count(p[0], /class="slog-row/g);
      if (n === 1) assert.match(p[0], /<span class="slog-k">Average pace<\/span>/, c.arch + ': a single row is not labelled');
      if (n > 1) assert.equal(count(p[0], /<span>Average pace<\/span>/g), 1, c.arch + ': a list of rows repeats or lacks its labels');
    });
  });
});

test('the heading says what the section is: the effort, the reps, the distance', () => {
  const all = everyStructure();
  const title = (k, p) => (new RegExp('<div class="yl-title">([^<]*)</div>').exec(section(log(all[k]), p)) || [,''])[1];
  assert.match(title('track_reps', 'main'), /^Main set \u00b7 \d+ \u00d7 \d+m$/);
  assert.equal(title('track_reps', 'main').match(/(\d+) \u00d7/)[1], String(all.track_reps.a.logShape(all.track_reps.dd).reps));
  assert.equal(title('ladder', 'main'), 'Main set \u00b7 5 reps', 'a ladder was given one distance for five different reps');
  assert.match(title('easy_strides', 'main'), /^Strides \u00b7 6 \u00d7 100m$/, 'an easy run with strides is headed as a workout');
  assert.match(title('hill_repeats', 'main'), /^Main set \u00b7 \d+ \u00d7 \d+s$/);
  assert.equal(title('long_run_goal_finish', 'main'), 'Main set', 'stages were given a rep count');
  assert.equal(title('easy_run', 'main'), 'The run');
  /* A warm-up prescribed as a rule has no number to print, and is given none. */
  assert.equal(title('fartlek', 'warmup'), 'Warm-up');
});

test('an average pace is kept as typed, and the prescription supplies the other half', () => {
  const all = everyStructure();
  /* A prescribed distance: the time that pace takes to cover it. */
  const t = all.threshold_continuous, plan = t.a.loggingModeFor(t.dd).plan;
  const main = Array.from(plan.rows).filter(r => r.role === 'work')[0];
  assert.ok(main.presKm > 0);
  t.a.handleStructuredSplitChange(t.dd.id, main.segId, 'pace', '4:47');
  let s = t.dd.actual.splits.filter(x => x.segId === main.segId)[0];
  assert.equal(s.paceSec, 287);
  assert.equal(s.sec, Math.round(287 * main.presKm), 'the time is not the pace over the prescribed distance');
  assert.equal(s.km, null, 'a distance the athlete never typed was written');
  assert.match(section(log(t), 'main'), /value="4:47"\s+data-action="slog-field" data-field="pace"/);
  /* Entering heart rate afterwards does not round the pace. */
  t.a.handleStructuredSplitChange(t.dd.id, main.segId, 'hr', '168');
  s = t.dd.actual.splits.filter(x => x.segId === main.segId)[0];
  assert.equal(s.paceSec, 287, 'the pace moved when the heart rate was entered'); assert.equal(s.hr, 168);
  /* A pace on a 700m rep comes back as typed, not as its rounded time. */
  const r = all.track_reps, rep = Array.from(r.a.loggingModeFor(r.dd).plan.rows).filter(x => x.role === 'work')[0];
  r.a.handleStructuredSplitChange(r.dd.id, rep.segId, 'pace', '3:45');
  assert.match(section(log(r), 'main'), /value="3:45"\s+data-action="slog-field" data-field="pace"/, '3:45 came back as something else');
  /* Digits from a keypad with no colon mean the same thing. */
  r.a.handleStructuredSplitChange(r.dd.id, rep.segId, 'pace', '350');
  assert.equal(r.dd.actual.splits.filter(x => x.segId === rep.segId)[0].paceSec, 230);
  /* A prescribed duration: the distance that pace covers in it. */
  const f = all.fartlek, frep = Array.from(f.a.loggingModeFor(f.dd).plan.rows).filter(x => x.role === 'work')[0];
  assert.ok(frep.presSec > 0 && !(frep.presKm > 0));
  f.a.handleStructuredSplitChange(f.dd.id, frep.segId, 'pace', '4:00');
  s = f.dd.actual.splits.filter(x => x.segId === frep.segId)[0];
  assert.equal(s.sec, frep.presSec); assert.equal(s.secSeeded, true);
  assert.equal(s.km, Math.round(frep.presSec / 240 * 100) / 100, 'the distance is not what that pace covers in the time');
  /* A rule with no number: the pace alone, and it is kept. */
  const fw = Array.from(f.a.loggingModeFor(f.dd).plan.rows).filter(x => x.role === 'warmup')[0];
  assert.ok(!(fw.presKm > 0) && fw.presSec == null, 'the fixture warm-up has a number after all');
  f.a.handleStructuredSplitChange(f.dd.id, fw.segId, 'pace', '5:50');
  s = f.dd.actual.splits.filter(x => x.segId === fw.segId)[0];
  assert.ok(s, 'a pace on a rule-prescribed segment was thrown away');
  assert.equal(s.paceSec, 350); assert.equal(s.km, null); assert.equal(s.sec, null);
  assert.match(section(log(f), 'warmup'), /value="5:50"/);
  /* Cleared, it leaves nothing behind. */
  f.a.handleStructuredSplitChange(f.dd.id, fw.segId, 'pace', '');
  assert.equal(f.dd.actual.splits.filter(x => x.segId === fw.segId).length, 0, 'an emptied row left a phantom');
  [t, r, f].forEach(c => { c.dd.actual.splits = []; });
});

test('miles are typed as miles and stored the way the engine reads them', () => {
  const c = everyStructure().threshold_continuous, a = c.a;
  const main = Array.from(a.loggingModeFor(c.dd).plan.rows).filter(r => r.role === 'work')[0];
  a.state.units = 'mi';
  assert.match(log(c), /placeholder="8:00 \/mi"/);
  a.handleStructuredSplitChange(c.dd.id, main.segId, 'pace', '7:40');
  const s = c.dd.actual.splits.filter(x => x.segId === main.segId)[0];
  assert.ok(Math.abs(s.paceSec - 460 / 1.60934) < 0.06, 'a pace per mile was stored as a pace per km');
  assert.match(section(log(c), 'main'), /value="7:40"\s+data-action="slog-field" data-field="pace"/, 'it did not come back as typed');
  a.state.units = 'km'; c.dd.actual.splits = [];
});

test('the placeholders can be read, and the tiles are not bigger than the job', () => {
  const CSS = SRC.slice(SRC.indexOf('<style>'), SRC.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.match(CSS, /\.actual-field input::placeholder,\s*:is\([^)]*\) \.actual-field textarea::placeholder\{color:#FFFFFF; opacity:\.6;\}/,
    'the placeholders on the session screens are dim again');
  assert.match(CSS, /\.log-body input::placeholder, \.log-body textarea::placeholder\{color:#FFFFFF; opacity:\.6;\}/);
  assert.doesNotMatch(CSS, /\.actual-field input::placeholder\{color:var\(--ink-quiet\)/);
  assert.match(CSS, /\.yl \.opt-grid button\{min-height:48px/);
  assert.match(CSS, /\.yl \.slog-in\{width:100%; min-height:44px/);
});

// ---------------------------------------------------------------------------
// THE ORDER OF THE LOG
// ---------------------------------------------------------------------------

/* Founder, with two mock-ups: "how I would like the session log to look.
   Keep everything we currently have just a restructure. Visuals we already
   have should stay."

   Warm-up, Main set, Cool-down, Session feedback, Conditions and health,
   then elevation and the notes. Nothing asked that was not asked before and
   nothing dropped. */
test('every log runs in the founder\'s order, whatever the session', () => {
  Object.values(everyStructure()).forEach(c => {
    const html = log(c);
    const at = s => html.indexOf(s);
    const order = ['data-part="warmup"', 'data-part="main"', 'data-part="cooldown"', 'data-group="feedback"',
                   'data-group="conditions"', 'data-field="elevationGainM"', 'data-field="notes"', 'data-action="clear-actual"']
      .filter(m => at(m) !== -1);
    assert.deepEqual(order.slice().sort((x, y) => at(x) - at(y)), order, c.arch + ': the sections are out of order');
    assert.ok(at('data-group="feedback"') !== -1 && at('data-group="conditions"') !== -1, c.arch + ': a group is missing');
    assert.equal(count(html, /<div class="yl-title">Session feedback<\/div>/g), 1, c.arch);
    assert.equal(count(html, /<div class="yl-title">Conditions &amp; health<\/div>/g), 1, c.arch);
    /* Overall effort, then the conditions, then whether anything hurts. */
    assert.ok(at('data-group="feedback"') < at('data-field="rpe"') && at('data-field="rpe"') < at('data-group="conditions"'), c.arch + ': effort is not in Session feedback');
    assert.ok(at('data-group="conditions"') < at('data-field="conditions"'), c.arch);
    assert.ok(at('data-field="conditions"') < at('data-field="hurting"'), c.arch);
  });
});

test('the main set shows its fields first, then what is asked about the set', () => {
  const all = everyStructure();
  Object.values(all).forEach(c => {
    const html = log(c), shape = c.a.logShape(c.dd);
    const main = section(html, 'main');
    const fb = html.slice(html.indexOf('data-group="feedback"'), html.indexOf('data-group="conditions"'));
    const rowAt = main.indexOf('class="slog-row'), qAt = main.indexOf('class="yl-q"');
    if (rowAt !== -1 && qAt !== -1) assert.ok(rowAt < qAt, c.arch + ': a question sits above the main set\'s fields');
    if (shape.reps){
      /* Reps and hills: the box holds the reps; how it felt and whether it
         held are Session feedback, as the hill-sprint mock-up draws them. */
      assert.match(main, /data-field="repsDone"/, c.arch + ': reps completed is not in the main set');
      assert.doesNotMatch(main, /data-field="mainSetFelt"|data-field="mainSetHeld"/, c.arch);
      assert.match(fb, /data-field="mainSetFelt"/, c.arch);
      /* Strides are not asked whether the pace held: "Easy runs stay simple." */
      assert.equal(/data-field="mainSetHeld"/.test(fb), !shape.light, c.arch);
      if (!shape.light) assert.ok(fb.indexOf('data-field="mainSetHeld"') < fb.indexOf('data-field="rpe"'), c.arch);
    } else {
      /* One sustained effort, or a plain run: both questions are about it. */
      assert.match(main, /data-field="mainSetFelt"/, c.arch + ': how it felt left the main set');
      assert.doesNotMatch(fb, /data-field="mainSetFelt"|data-field="mainSetHeld"|data-field="repsDone"/, c.arch);
      if (shape.main) assert.match(main, /data-field="mainSetHeld"/, c.arch);
    }
    /* Recoveries are Session feedback's, after effort, on the sessions that have them. */
    assert.doesNotMatch(main, /data-field="recoveries"/, c.arch + ': recoveries are still in the main set');
    assert.equal(/data-field="recoveries"/.test(fb), !!shape.recoveries, c.arch);
    if (shape.recoveries) assert.ok(fb.indexOf('data-field="rpe"') < fb.indexOf('data-field="recoveries"'), c.arch);
  });
  /* Both shapes are in the fixture, so neither branch above is vacuous. */
  assert.ok(Object.values(all).some(c => c.a.logShape(c.dd).reps) && Object.values(all).some(c => !c.a.logShape(c.dd).reps));
});

test('a session cut short is asked why in Session feedback, and nothing is asked twice', () => {
  const c = everyStructure().track_reps;
  c.a.handleLogAnswer(c.dd.id, 'repsDone', '3');
  const html = log(c);
  const fb = html.slice(html.indexOf('data-group="feedback"'), html.indexOf('data-group="conditions"'));
  assert.match(fb, /Why did you stop\?/);
  ['repsDone', 'mainSetFelt', 'mainSetHeld', 'rpe', 'recoveries'].forEach(f =>
    assert.equal(count(html, new RegExp('<input type="range"[^>]*data-field="' + f + '"', 'g')) +
                 (f === 'recoveries' ? 1 : 0) >= 1, true, f + ' is gone'));
  ['conditions', 'hurting', 'stopReason', 'recoveries'].forEach(f =>
    assert.equal(count(html, new RegExp('role="group" aria-label="[^"]*"><button[^>]*data-field="' + f + '"', 'g')), 1, f + ' is asked ' +
      count(html, new RegExp('role="group" aria-label="[^"]*"><button[^>]*data-field="' + f + '"', 'g')) + ' times'));
});

test('the restructure added no control and no look: same sliders, same tiles, same fields', () => {
  const css = SRC.slice(SRC.indexOf('  .yl{'), SRC.indexOf('  .yl .opt-grid button .t{'));
  const grp = css.slice(css.indexOf('.yl-grp{'), css.indexOf('}', css.indexOf('.yl-grp{')));
  assert.ok(!/border|background|box-shadow|border-radius/.test(grp), 'the new groups were given a box');
  const body = SRC.slice(SRC.indexOf('\nfunction renderYourLogAnswers('), SRC.indexOf('\n}\n', SRC.indexOf('\nfunction renderYourLogAnswers(')));
  assert.equal((body.match(/logRangeHtml\(/g) || []).length, 4, 'a slider was added or dropped');
  assert.equal((body.match(/logTilesHtml\(/g) || []).length, 4, 'a tile group was added or dropped');
  assert.ok(!/<svg|<img|class="[^"]*pill|type="checkbox"|stepper/.test(body), 'an icon, pill or new control was added');
  /* Without consent the heading does not promise a health question. */
  const c = everyStructure().easy_run, was = c.a.healthConsentGranted;
  c.a.healthConsentGranted = () => false;
  const html = log(c); c.a.healthConsentGranted = was;
  assert.match(html, /<div class="yl-title">Conditions<\/div>/);
  assert.doesNotMatch(html, /Conditions &amp; health|data-field="hurting"|data-field="mainSetFelt"/);
});
