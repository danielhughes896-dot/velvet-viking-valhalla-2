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
  const next = rest.search(/data-part="|<div id="splits-total-|data-field="rpe"/);
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
    assert.match(html, /<div class="yl-title">The run<\/div>/);
    assert.deepEqual([...html.matchAll(/class="yl-q-t">([^<]+)</g)].map(m => m[1]),
      ['How did it feel?', 'Overall effort', 'Conditions', 'Anything hurting?'], k + ' is asked something else');
  });
});

test('a session with all three shows all three, with the main set between them', () => {
  const all = everyStructure();
  ['threshold_continuous', 'track_reps', 'hill_repeats', 'fartlek', 'ladder', 'deuce', 'split_tempo', 'steady_tempo',
   'progressive_tempo', 'goal_pace_block', 'time_trial', 'long_run_goal_insert', 'long_run_goal_broken'].forEach(k => {
    const html = log(all[k]);
    assert.deepEqual(parts(html), ['warmup', 'main', 'cooldown'], k);
    assert.match(section(html, 'warmup'), /<div class="yl-title">Warm-up<\/div>/);
    assert.match(section(html, 'cooldown'), /<div class="yl-title">Cool-down<\/div>/);
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
    assert.ok(count(html, /class="slog-row/g) >= 2, k + ' lost its own rows');
  });
  assert.deepEqual(rowLabels(log(all.long_run_goal_finish)).filter(l => /Rep|Warm|Cool/.test(l)), []);
  assert.match(log(all.race), /<div class="yl-title">The race<\/div>/);
});

// ---------------------------------------------------------------------------
// REPS
// ---------------------------------------------------------------------------

test('the reps in the main set are the reps in the session, one row each', () => {
  const all = everyStructure();
  Object.values(all).forEach(c => {
    const shape = c.a.logShape(c.dd);
    const reps = rowLabels(section(log(c), 'main')).filter(l => /^Rep( \d+)?$/.test(l));
    if (!shape.reps) return;
    assert.equal(reps.length, shape.reps, c.arch + ' (' + c.dd.title + '): ' + reps.length + ' rep rows for ' + shape.reps + ' reps');
    assert.match(log(c), new RegExp('data-field="repsDone"[^>]*data-of="' + shape.reps + '"'), c.arch + ': the reps slider does not run to the same number');
    /* Where the title states the count, that is the count. */
    const m = /(\d+)\s?x\s?\d/.exec(c.dd.title);
    if (m && !/twice/.test(c.dd.title)) assert.equal(shape.reps, +m[1], c.arch + ': "' + c.dd.title + '" is counted as ' + shape.reps);
  });
});

test('a strides session has six reps, not seven; and a ladder has reps at all', () => {
  const all = everyStructure();
  /* The easy running before the strides is not a stride. */
  const st = all.easy_strides;
  assert.match(st.dd.title, /6x100m/);
  assert.equal(st.a.logShape(st.dd).reps, 6, 'the easy run is being counted as a rep');
  assert.deepEqual(rowLabels(section(log(st), 'main')), ['Easy', 'Rep 1', 'Rep 2', 'Rep 3', 'Rep 4', 'Rep 5', 'Rep 6']);
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
    assert.ok(at('data-field="rpe"') < at('data-action="actual-field" data-field="hr"'), c.arch + ': heart rate is above the answers');
    assert.ok(at('data-action="actual-field" data-field="hr"') < at('data-field="notes"'));
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
  reps.forEach(r => assert.ok(onScreen.has(r.segId), r.label + ' has no input on the screen'));
  assert.match(SRC, /action === 'slog-field'\) handleStructuredSplitChange\(/, 'the row inputs are not wired to the structured handler');
  const before = a.computeExecutionBreakdown(dd);
  reps.forEach((r, i) => a.handleStructuredSplitChange(dd.id, r.segId, r.asks.time ? 'sec' : 'km', r.asks.time ? String(200 + i * 2) : '0.6'));
  const saved = dd.actual.splits.filter(s => s.role === 'work');
  assert.equal(saved.length, reps.length, 'the reps were not saved as structured splits');
  assert.ok(saved.every(s => s.paceSec != null), 'a rep was saved without a pace');
  const ev = a.structuredExecutionEvidence(dd);
  assert.equal(ev.reps, reps.length, 'the split analysis no longer sees the reps');
  assert.ok(ev.claims.length >= 1);
  assert.ok(a.computeExecutionBreakdown(dd), 'the session stopped scoring');
  assert.ok(before, 'the fixture session was not scoring to begin with');
  assert.equal(a.assessSession(dd).completion.done, reps.length, 'the assessment does not count the reps that were entered');
  /* And they come back on the next draw. */
  assert.equal(count(log(c), /data-field="sec"[^>]*|value="3:2\d"/g) > 0, true);
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
