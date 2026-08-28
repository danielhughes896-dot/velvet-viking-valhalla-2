'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* PLAN HQ -> VALHALLA: the athlete-facing rename, the new Valhalla / Coach /
 * Record internal navigation, the completion ring, and the prescription-vs-
 * execution edit boundary. Existing planHqReading.test.js and
 * planHqRecord.test.js already prove every re-homed section is the same
 * component rendering the same real data -- this file protects the things
 * that are genuinely new: the label, the tabs themselves, the ring, and the
 * historical-integrity gate on the prescription pencil.
 */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const TODAY = '2026-08-20';

function day(id, type, km, extra) {
  return Object.assign({ id, date: id, type, km: km == null ? 8 : km, mpSegment: false }, extra || {});
}
function loggedDay(id, type, km, extra) {
  return day(id, type, km, Object.assign({
    completed: true,
    actual: { km, pace: '5:00', hr: 150, rpe: 5, notes: '' },
  }, extra || {}));
}
function planHQ() {
  const a = loadApp({ pinnedDate: TODAY });
  buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 12 });
  a.state.view = 'planhq';
  return a;
}

// ===========================================================================
// 1. THE ATHLETE-FACING RENAME
// ===========================================================================
test('NAV: the bottom nav says Valhalla, never Plan HQ', () => {
  const a = planHQ();
  const nav = a.renderBottomNav();
  assert.match(nav, />Valhalla</);
  assert.doesNotMatch(nav, /Plan HQ/, 'the athlete-facing label was not retired');
  assert.match(nav, /data-view="planhq"/, 'the internal route key is unchanged on purpose');
});

test('NAV: the Valhalla screen heading says Valhalla', () => {
  const a = planHQ();
  assert.match(a.renderPlanHQView(), /<div class="view-heading font-head">Valhalla<\/div>/);
});

test('NAV: the five-tab shell is otherwise unchanged', () => {
  const a = planHQ();
  const items = (a.renderBottomNav().match(/data-action="set-view"/g) || []).length;
  assert.equal(items, 5, 'Today / This Week / Full Plan / Valhalla / Settings');
});

// ===========================================================================
// 2. VALHALLA / COACH / RECORD
// ===========================================================================
/* FINAL VISUAL COMPLETION PASS -- the subnav used to carry a "Valhalla"
   pill as its first tab, which sat directly beneath a bottom-nav tab
   already reading VALHALLA: "Valhalla > Valhalla", not a real destination.
   Coach and Record are the only two places the subnav actually goes now;
   re-tapping the already-active bottom-nav VALHALLA tab is the return path
   to the overview (see the handleSetView() tests below), the ordinary "tap
   home again" pattern -- so no third pill stands in for it, and while on
   the overview itself neither pill is marked active. */
test('SUBNAV: two tabs -- Coach and Record, no redundant inner Valhalla pill', () => {
  const a = planHQ();
  const html = a.renderPlanHQSubNav();
  assert.match(html, /class="planhq-subnav"/);
  ['Coach', 'Record'].forEach(label => {
    assert.match(html, new RegExp('data-action="set-planhq-tab" data-tab="' +
      label.toLowerCase() + '">' + label + '<'));
  });
  assert.doesNotMatch(html, /data-tab="valhalla"/,
    'the subnav still repeats the bottom-nav VALHALLA destination as its own pill');
  // On the overview itself, neither remaining pill claims to be active --
  // there is no third button whose "active" state could stand in for it.
  assert.doesNotMatch(html, /planhq-subnav-btn active/,
    'a pill claims to be active while the overview itself is showing');
});

test('SUBNAV: re-tapping the active VALHALLA bottom-nav tab from Coach/Record returns to the overview', () => {
  const a = planHQ();
  a.handleSetPlanhqTab('record');
  assert.equal(a.planhqTab, 'record');
  assert.equal(a.state.view, 'planhq');
  // Same view, tapped again -- the early-return path in handleSetView(),
  // now repurposed as the subnav's missing third pill.
  a.handleSetView('planhq');
  assert.equal(a.planhqTab, 'valhalla', 'the retap did not return to the overview');
  assert.equal(a.state.view, 'planhq', 'the retap left the Valhalla destination entirely');
});

test('SUBNAV: re-tapping VALHALLA while already on the overview is a harmless no-op', () => {
  const a = planHQ();
  assert.equal(a.planhqTab, 'valhalla');
  a.handleSetView('planhq');
  assert.equal(a.planhqTab, 'valhalla');
  assert.equal(a.state.view, 'planhq');
});

// ===========================================================================
// 2b. THE SUBNAV LIVES ABOVE THE MAIN BOTTOM NAV, NOT UNDER THE HEADING
// ===========================================================================
test('ANCHOR: the subnav no longer renders inline under the Valhalla heading', () => {
  const a = planHQ();
  assert.doesNotMatch(a.renderPlanHQView(), /class="planhq-subnav"/,
    'the subnav must move out of the scrolling content entirely');
});

test('ANCHOR: renderBottomNavStack() stacks the subnav directly above the main bottom nav, only on Valhalla', () => {
  const a = planHQ();
  const onValhalla = a.renderBottomNavStack();
  assert.match(onValhalla, /^<div class="bn-stack">/);
  const subnavAt = onValhalla.indexOf('class="planhq-subnav"');
  const navAt = onValhalla.indexOf('<nav class="bottom-nav"');
  assert.ok(subnavAt !== -1 && navAt !== -1 && subnavAt < navAt,
    'the subnav must sit above the main bottom nav in document order');
  assert.equal((onValhalla.match(/class="planhq-subnav"/g) || []).length, 1,
    'the subnav must not be duplicated');

  a.handleSetView('today');
  const onToday = a.renderBottomNavStack();
  assert.doesNotMatch(onToday, /class="planhq-subnav"/,
    'the subnav must not appear on views other than Valhalla');
  assert.match(onToday, /<nav class="bottom-nav"/);
});

test('ANCHOR: the stack is a fixed anchor, not a scrolling element, and content gets clearance for it', () => {
  assert.match(CODE, /\.bn-stack\{[^}]*position\s*:\s*fixed[^}]*bottom\s*:\s*0/);
  assert.match(CODE, /\.bn-stack\{[^}]*flex-direction\s*:\s*column/);
  assert.match(CODE, /\.app-root\.has-subnav\{[^}]*padding-bottom/);
});

test('SUBNAV: switching tabs changes what renders, and the active button moves', () => {
  const a = planHQ();
  assert.equal(a.planhqTab, 'valhalla');
  assert.match(a.renderPlanHQView(), /class="v-hero"/);

  a.handleSetPlanhqTab('coach');
  assert.equal(a.planhqTab, 'coach');
  assert.match(a.renderPlanHQView(), />The Reading</);
  assert.match(a.renderPlanHQSubNav(), /data-tab="coach"[^>]*active|active[^>]*data-tab="coach"/);

  a.handleSetPlanhqTab('record');
  assert.equal(a.planhqTab, 'record');
  assert.match(a.renderPlanHQView(), />The Record</);
});

test('SUBNAV: re-entering Valhalla from another tab always resets to the overview', () => {
  const a = planHQ();
  a.handleSetPlanhqTab('record');
  assert.equal(a.planhqTab, 'record');
  a.handleSetView('today');
  a.handleSetView('planhq');
  assert.equal(a.planhqTab, 'valhalla',
    'Valhalla must open on "where am I", not wherever the athlete last left it');
});

test('SUBNAV: no re-homed section is duplicated or missing across the three tabs', () => {
  const a = planHQ();
  a.handleSetPlanhqTab('valhalla');
  const valhalla = a.renderPlanHQView();
  a.handleSetPlanhqTab('coach');
  const coach = a.renderPlanHQView();
  a.handleSetPlanhqTab('record');
  const record = a.renderPlanHQView();

  assert.ok(valhalla.indexOf(a.renderProgrammeStatus()) !== -1, 'Programme Status missing from Valhalla');
  assert.equal(coach.indexOf(a.renderProgrammeStatus()), -1, 'Programme Status duplicated onto Coach');
  assert.equal(record.indexOf(a.renderProgrammeStatus()), -1, 'Programme Status duplicated onto Record');

  assert.ok(coach.indexOf(a.renderCoachPanel()) !== -1, 'the coach panel missing from Coach');
  assert.equal(valhalla.indexOf(a.renderCoachPanel()), -1, 'the coach panel duplicated onto Valhalla');
  assert.equal(record.indexOf(a.renderCoachPanel()), -1, 'the coach panel duplicated onto Record');

  assert.ok(record.indexOf(a.renderRecordSection()) !== -1, 'THE RECORD missing from Record');
  assert.equal(valhalla.indexOf(a.renderRecordSection()), -1, 'THE RECORD duplicated onto Valhalla');
  assert.equal(coach.indexOf(a.renderRecordSection()), -1, 'THE RECORD duplicated onto Coach');
});

// ===========================================================================
// 3. THE COMPLETION RING
// ===========================================================================
test('RING: the completion control is a labelled circular input, not a bare checkbox', () => {
  const a = loadApp({ pinnedDate: TODAY });
  const html = a.renderDayCheck(day(TODAY, 'easy', 8));
  assert.match(html, /^<label class="day-check[^"]*"/, 'the wrapper is not a <label>, so the tap target is only the tiny input');
  assert.match(html, /<input type="checkbox"/);
  assert.match(html, /data-action="toggle-complete"/, 'the existing completion handler was disconnected');
});

test('RING: today, unstarted, renders unchecked and unlocked; a run day already logged renders checked', () => {
  const a = loadApp({ pinnedDate: TODAY });
  const open = a.renderDayCheck(day(TODAY, 'tempo', 8));
  assert.doesNotMatch(open, /checked/);
  assert.doesNotMatch(open, / locked/);

  const done = a.renderDayCheck(loggedDay(TODAY, 'tempo', 8));
  assert.match(done, /checked/);
});

test('RING: past and future sessions render locked and disabled, same as before', () => {
  const a = loadApp({ pinnedDate: TODAY });
  const future = a.renderDayCheck(day('2026-08-25', 'easy', 6));
  const past = a.renderDayCheck(day('2026-08-10', 'easy', 6));
  [future, past].forEach(html => {
    assert.match(html, /class="day-check locked"/);
    assert.match(html, /disabled/);
  });
});

test('RING: the ring is drawn with CSS, not a native checkbox appearance, and fills Cherry Lacquer when checked', () => {
  // [^{]* rather than [^}]* directly after ".day-check input" -- the
  // Builder's Training Day selector (.wd-check input) now shares this
  // exact rule via a joined selector list (".day-check input, .wd-check
  // input{...}"), so the opening brace may be preceded by that second
  // selector rather than following ".day-check input" immediately. The
  // assertion is unweakened: appearance:none still has to appear in the
  // same rule body .day-check input resolves from.
  assert.match(CODE, /\.day-check input[^{]*\{[^}]*appearance\s*:\s*none/);
  assert.match(CODE, /\.day-check input:checked[^{]*\{[^}]*background\s*:\s*var\(--cherry\)/);
  assert.match(CODE, /\.day-check input:checked::after[^{]*\{/, 'no checkmark is drawn for the checked state');
  // A ≥40px label around a visually compact ring -- generous tap target,
  // restrained visible control.
  assert.match(CODE, /\.day-check\{[^}]*width\s*:\s*40px/);
});

test('RING: the Edit Session display checkbox carries the same ring language', () => {
  assert.match(CODE, /\.ef-completed input\[type="checkbox"\]\{[^}]*appearance\s*:\s*none/);
  assert.match(CODE, /\.ef-completed input\[type="checkbox"\]:checked\{[^}]*background\s*:\s*var\(--cherry\)/);
});

// ===========================================================================
// 4. PRESCRIPTION VS EXECUTION
// ===========================================================================
test('LOCK: canEditPrescription is true for a future session and for today before it has run', () => {
  const a = loadApp({ pinnedDate: TODAY });
  assert.equal(a.canEditPrescription(day('2026-08-25', 'easy', 6)), true, 'future session should be editable');
  assert.equal(a.canEditPrescription(day(TODAY, 'easy', 6)), true, "today, not yet run, should be editable");
  assert.equal(a.canEditPrescription(day(TODAY, 'rest', 0)), false, 'a rest day is never prescription-editable');
});

test('LOCK: canEditPrescription is false once today has run, and false for every past day', () => {
  const a = loadApp({ pinnedDate: TODAY });
  assert.equal(a.canEditPrescription(loggedDay(TODAY, 'easy', 6)), false,
    "today, completed, must not still show as editable");
  assert.equal(a.canEditPrescription(day('2026-08-15', 'easy', 6)), false,
    'a missed past session must not be prescription-editable');
  assert.equal(a.canEditPrescription(loggedDay('2026-08-15', 'easy', 6)), false,
    'a completed past session must not be prescription-editable');
});

test('LOCK: canEditCompletion (execution) stays exactly as wide as it always was', () => {
  const a = loadApp({ pinnedDate: TODAY });
  // Unchanged rule: any day up to and including today, never the future.
  assert.equal(a.canEditCompletion(day(TODAY, 'easy', 6)), true);
  assert.equal(a.canEditCompletion(day('2026-08-01', 'easy', 6)), true);
  assert.equal(a.canEditCompletion(day('2026-08-25', 'easy', 6)), false);
});

test('ACTION BUTTON: pencil while the prescription is open, a distinct icon once it is not, nothing for rest', () => {
  const a = loadApp({ pinnedDate: TODAY });
  const pencilFuture = a.dayActionButton(day('2026-08-25', 'easy', 6));
  const pencilToday = a.dayActionButton(day(TODAY, 'easy', 6));
  const lockedToday = a.dayActionButton(loggedDay(TODAY, 'easy', 6));
  const lockedPast = a.dayActionButton(day('2026-08-10', 'easy', 6));
  const rest = a.dayActionButton(day(TODAY, 'rest', 0));

  assert.match(pencilFuture, /aria-label="Edit session"/);
  assert.match(pencilToday, /aria-label="Edit session"/);
  assert.match(lockedToday, /aria-label="Edit activity"/,
    'a completed session must not still offer "Edit session"');
  assert.match(lockedPast, /aria-label="Edit activity"/);
  assert.equal(rest, '', 'a rest day should offer no action');

  // Two distinct icons, not the same glyph relabelled.
  assert.match(pencilToday, /<path d="M4 20l1-4\.5/, 'the pencil glyph is missing from the editable state');
  assert.doesNotMatch(lockedToday, /<path d="M4 20l1-4\.5/, 'the locked state still draws the pencil');
  assert.match(lockedToday, /<rect x="5" y="3" width="14" height="18"/, 'the notes glyph is missing from the locked state');
  // Neither wording is the system-oriented phrase the brief explicitly ruled out.
  [pencilFuture, pencilToday, lockedToday, lockedPast].forEach(html => {
    assert.doesNotMatch(html, /Prescription locked/i);
  });
});

test('MODAL: Edit Session locks the prescription fields once canEditPrescription is false', () => {
  const a = loadApp({ pinnedDate: TODAY });
  const locked = loggedDay(TODAY, 'easy', 6);
  a.state.days = [locked];
  a.openModal = (html) => { a.__modalHtml = html; };
  a.openEditModal(TODAY);
  const html = a.__modalHtml;

  ['ef-title', 'ef-type', 'ef-km', 'ef-mp', 'ef-desc'].forEach(id => {
    const start = html.indexOf('id="' + id + '"');
    const tag = html.slice(start, html.indexOf('>', start) + 1);
    assert.match(tag, /disabled/, '#' + id + ' is still editable on a locked session');
  });
  assert.doesNotMatch(html, /data-action="reset-day"/,
    'a locked session can still be reset back to rest');
  // Completed itself is a different rule (canEditCompletion) and stays live.
  assert.doesNotMatch(html, /id="ef-completed"[^>]*disabled/);
  assert.match(html, /already happened/i, 'no explanation is given for why editing is limited');
  // Reschedule is deliberately NOT locked here -- swapping a logged session
  // is governed by its own historical-integrity rules (swapIntegrity.test.js),
  // unrelated to whether the prescription fields above are open.
  assert.match(html, /<fieldset><legend>Reschedule<\/legend>/,
    'a locked session lost the ability to be rescheduled, which is a separate, already-guarded rule');
});

test('MODAL: Edit Session leaves every field open on a future or in-progress session', () => {
  const a = loadApp({ pinnedDate: TODAY });
  const open = day(TODAY, 'easy', 6);
  a.state.days = [open];
  a.openModal = (html) => { a.__modalHtml = html; };
  a.openEditModal(TODAY);
  const html = a.__modalHtml;

  ['ef-title', 'ef-type', 'ef-km', 'ef-mp', 'ef-desc'].forEach(id => {
    const start = html.indexOf('id="' + id + '"');
    const tag = html.slice(start, html.indexOf('>', start) + 1);
    assert.doesNotMatch(tag, /disabled/, '#' + id + ' was locked on an editable session');
  });
  assert.match(html, /<fieldset><legend>Reschedule<\/legend>/);
  assert.match(html, /data-action="reset-day"/);
});

test('SAVE: a locked session cannot have its prescription rewritten through a direct save call', () => {
  const a = loadApp({ pinnedDate: TODAY });
  const locked = loggedDay(TODAY, 'threshold', 10, { title: 'Threshold intervals' });
  a.state.days = [locked];
  a.document.getElementById = (id) => {
    // A crafted/forced call: every prescription field carries a changed
    // value even though the UI would have disabled these inputs.
    const forced = {
      'ef-title': { value: 'Rewritten title' },
      'ef-type': { value: 'easy' },
      'ef-km': { value: '2' },
      'ef-mp': { checked: true },
      'ef-desc': { value: 'rewritten instructions' },
      'ef-completed': { checked: false },
      'ef-swap': { value: '' }, // reschedule is a separate, ungated rule -- not under test here
    };
    return forced[id] || null;
  };
  a.handleSaveEdit(TODAY);
  assert.equal(locked.title, 'Threshold intervals', 'the title was rewritten on a locked session');
  assert.equal(locked.type, 'threshold', 'the type was rewritten on a locked session');
  assert.equal(locked.km, 10, 'the distance was rewritten on a locked session');
  // Execution data is still allowed to move -- that is the entire point of the split.
  assert.equal(locked.completed, false, 'completion, the one legitimately open field, was not honoured');
});

test('SAVE: an editable session still saves every field exactly as before', () => {
  const a = loadApp({ pinnedDate: TODAY });
  const open = day(TODAY, 'easy', 6);
  a.state.days = [open];
  a.document.getElementById = (id) => ({
    'ef-title': { value: 'New title' },
    'ef-type': { value: 'tempo' },
    'ef-km': { value: '9' },
    'ef-mp': { checked: false },
    'ef-desc': { value: 'new instructions' },
    'ef-completed': { checked: true },
    'ef-swap': { value: '' },
  }[id] || null);
  a.handleSaveEdit(TODAY);
  assert.equal(open.title, 'New title');
  assert.equal(open.type, 'tempo');
  assert.equal(open.km, 9);
  assert.equal(open.completed, true);
});

// ===========================================================================
// 5. CHEVRON CONSISTENCY
// ===========================================================================
test('CHEVRON: the day and week expand chevrons share one size now', () => {
  assert.match(CODE, /\.day-chevron svg\{width\s*:\s*18px/);
  assert.match(CODE, /\.week-chevron svg\{width\s*:\s*18px/);
});

test('CHEVRON: the Fueling and How-to-run-this disclosures carry a real expand cue', () => {
  assert.match(CODE, /class="fuel-chevron"/);
  assert.match(CODE, /\.fuel-card\[open\] \.fuel-chevron\{[^}]*rotate\(180deg\)/);
  assert.match(SRC, /How to run this<span class="fuel-chevron"/, 'the how-to-run-this summary has no chevron');
  assert.match(SRC, /Fueling &amp; Hydration Strategy<span class="fuel-chevron"/,
    'the fueling summary has no chevron');
});

test('CHEVRON: navigation chevrons on Record/Reading cards remain visually distinct from expand chevrons', () => {
  // chevronRight is the static "go to a detail panel" glyph; it must not gain
  // the day/week/fuel rotating-expand treatment.
  assert.doesNotMatch(CODE, /\.rec-right[^{]*\{[^}]*rotate\(180deg\)/);
});

// ===========================================================================
// 6. TOKEN CLEANUP
// ===========================================================================
test('TOKENS: the coach status dots use the semantic good/bad family, not a second hardcoded pair', () => {
  assert.doesNotMatch(CODE, /#5FA86B/i, 'the hardcoded green survived');
  assert.doesNotMatch(CODE, /#C4643C/i, 'the hardcoded warn colour survived');
  assert.match(CODE, /\.coach-dot\.good\{background\s*:\s*var\(--c-easy\)/);
  assert.match(CODE, /\.coach-dot\.warn\{background\s*:\s*var\(--c-threshold\)/);
});

test('TOKENS: the race countdown and unit toggle read the canonical bronze/gold tokens', () => {
  // #c5a059 legitimately remains as --modal-active's own definition at
  // :root -- the point is that .tb-unit-toggle/.countdown-badge/.cd-cell no
  // longer carry their own private copy of it.
  const widget = CODE.slice(CODE.indexOf('.tb-unit-toggle{'), CODE.indexOf('.gauge-wrap{'));
  assert.doesNotMatch(widget, /#1e1b18/i, 'the countdown widget still hardcodes its own dark fill');
  assert.doesNotMatch(widget, /#c5a059/i, 'the countdown widget still hardcodes its own gold');
  assert.doesNotMatch(widget, /#8c8273/i, 'the countdown widget still hardcodes its own faint ink');
  assert.match(widget, /\.countdown-badge\{[^}]*background\s*:\s*var\(--bg-3\)/);
  assert.match(widget, /\.cd-cell\{[^}]*color\s*:\s*var\(--gold-text\)/);
  // The separate light-theme override this used to need is gone -- the token
  // already carries both themes.
  assert.doesNotMatch(widget, /\[data-theme="light"\]\s*\.countdown-badge/);
  assert.doesNotMatch(widget, /\[data-theme="light"\]\s*\.tb-unit-toggle/);
});

test('TOKENS: a Record value carries its data typography by default, not by caller convention', () => {
  /* This asserted .rec-val, the list-row shell's value slot, which nothing had
     rendered for some time -- so it was pinning a rule that could not paint.
     The law is unchanged and is what matters: the COMPONENT guarantees the data
     face, rather than every call site remembering to pass 'font-mono'. The
     surfaces that carry a Record value today are the Valhalla plate and the
     Record tab's headline, so it is asserted on both. */
  assert.match(CODE, /\.b-plate \.val\{[^}]*font-family\s*:\s*'JetBrains Mono'/);
  assert.match(CODE, /\.rec-headline b\{[^}]*font-family\s*:\s*'JetBrains Mono'/);
});

// ===========================================================================
// 7. NOTHING COACHING-SHAPED MOVED
// ===========================================================================
test('SAFETY: computeConfidenceScore, coachAnalyse and raceOutlook are untouched by this pass', () => {
  const a = planHQ();
  const before = {
    conf: a.computeConfidenceScore(),
    outlook: JSON.stringify(a.raceOutlook()),
    decision: JSON.stringify((a.coachAnalyse().decision || {})),
  };
  // Re-render every surface this pass touched; none of it is allowed to have
  // been reached by a coaching calculation.
  a.renderPlanHQView();
  a.handleSetPlanhqTab('coach');
  a.renderPlanHQView();
  a.handleSetPlanhqTab('record');
  a.renderPlanHQView();
  assert.equal(a.computeConfidenceScore(), before.conf);
  assert.equal(JSON.stringify(a.raceOutlook()), before.outlook);
  assert.equal(JSON.stringify((a.coachAnalyse().decision || {})), before.decision);
});
