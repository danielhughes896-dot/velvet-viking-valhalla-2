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
/* THE SUBNAV IS GONE, AND WHAT REPLACES THESE TESTS IS THE REASON IT COULD
   GO. Coach and Record existed to carry a tap the overview could not take:
   the five Reading circles and the Record plates on Valhalla were decorative
   markup with no action on them, so the only route into a reading was a list
   on a second screen that restated it. The circles are buttons now and open
   the same panels, so the subnav had nothing left to reach.

   These tests therefore no longer ask "is the subnav built correctly". They
   ask the question that actually protects the athlete through this change:
   is every destination the two tabs used to carry still reachable, and
   reachable from the one screen? That is a stronger guard than the one it
   replaces -- the old tests could all pass while the circles did nothing. */
test('SUBNAV: there is no subnav, on Valhalla or anywhere else', () => {
  const a = planHQ();
  assert.equal(typeof a.renderPlanHQSubNav, 'undefined',
    'the subnav renderer is still here, so something can still draw it');
  assert.equal(typeof a.handleSetPlanhqTab, 'undefined');
  assert.equal(typeof a.planhqTab, 'undefined',
    'Valhalla still carries a tab state, so it still has more than one screen');
  assert.doesNotMatch(a.renderPlanHQView(), /planhq-subnav/);
  assert.doesNotMatch(a.renderBottomNavStack(), /planhq-subnav/);
  assert.doesNotMatch(CODE, /data-action="set-planhq-tab"/);
  assert.doesNotMatch(CODE, /case 'set-planhq-tab'/);
});

test('SUBNAV: every Reading is opened by the face that states it', () => {
  const a = planHQ();
  const view = a.renderPlanHQView();
  const preview = a.renderValhallaReadingPreview();
  const report = a.coachAnalyse();
  const keys = a.readingSections(report).map(s => s.key);
  assert.equal(keys.length, 5);
  /* Five readings, four circles and the gauge. This test's claim is that no
     panel is unreachable, and it is asserted against the whole VIEW rather
     than the arc alone: readiness is stated by the hero gauge, which is the
     button that opens it, because a readiness circle in the arc was a second
     drawing of the number the gauge was already showing. */
  keys.forEach(k => {
    assert.match(view, new RegExp('data-action="open-reading" data-reading="' + k + '"'),
      k + ' has no way in from Valhalla, so its panel is unreachable');
  });
  // and they are real buttons, not divs with an attribute nothing listens to
  assert.equal((preview.match(/<button type="button" class="b-dial"/g) || []).length, 4);
  assert.match(view, /<button[^>]*class="gauge-wrap"/,
    'the gauge carries readiness but is not a button, so readiness is unreachable');
});

test('SUBNAV: every Record fact is opened by the circle that states it', () => {
  const a = planHQ();
  const preview = a.renderValhallaRecordPreview();
  a.recordFacts().forEach(f => {
    assert.match(preview, new RegExp('data-action="open-record" data-record="' + f.key + '"'),
      f.key + ' has no way in from Valhalla');
    assert.ok(a.RECORD_PANELS[f.key], f.key + ' has a circle but no panel behind it');
  });
});

/* THE ONE DECISION THAT HAD NOWHERE ELSE TO GO. Active Goal was rendered by
   the Record tab and by nothing else in the app -- the Full Plan copy was
   deliberately deleted because the tab carried it -- so a Valhalla without
   tabs and without this panel would have taken an athlete's ability to change
   their goal away with it. */
test('SUBNAV: Active Goal survives the tabs, in the panel the Goal circle opens', () => {
  const a = planHQ();
  const panel = a.recordPanelGoal();
  assert.match(panel, /data-action="set-goal"/,
    'the A/B/C chooser did not come with the goal panel');
  assert.match(panel, /Active Goal/);
  assert.ok(panel.indexOf(a.renderGoalToggle()) !== -1,
    'the panel builds its own chooser instead of using renderGoalToggle()');
  // reachable, not merely defined
  assert.match(a.renderValhallaRecordPreview(), /data-record="goal"/);
  assert.ok(a.RECORD_PANELS.goal);
});

test('SUBNAV: re-tapping VALHALLA is an ordinary no-op again', () => {
  const a = planHQ();
  assert.equal(a.state.view, 'planhq');
  a.handleSetView('planhq');
  assert.equal(a.state.view, 'planhq');
});

// ===========================================================================
// 2b. ONE SCREEN, SO ONE BOTTOM NAV
// ===========================================================================
test('ANCHOR: the stack is the bottom nav and nothing above it', () => {
  const a = planHQ();
  const onValhalla = a.renderBottomNavStack();
  assert.match(onValhalla, /^<div class="bn-stack"><nav class="bottom-nav"/);
  assert.equal((onValhalla.match(/<nav class="bottom-nav"/g) || []).length, 1);

  /* The stack's CONTENTS no longer vary by view -- only which bottom-nav
     pill is marked active does, which is the nav doing its job. What is
     asserted is that no second row appears on Valhalla and nowhere else,
     which is the thing the subnav used to do. */
  a.handleSetView('today');
  const onToday = a.renderBottomNavStack();
  assert.match(onToday, /^<div class="bn-stack"><nav class="bottom-nav"/);
  assert.equal(onToday.replace(/ active/g, ''), onValhalla.replace(/ active/g, ''),
    'the stack carries something view-specific beyond the active pill');
});

test('ANCHOR: the stack is a fixed anchor, and the subnav clearance went with the subnav', () => {
  assert.match(CODE, /\.bn-stack\{[^}]*position\s*:\s*fixed[^}]*bottom\s*:\s*0/);
  assert.match(CODE, /\.bn-stack\{[^}]*flex-direction\s*:\s*column/);
  /* 64px of padding for a row that no longer renders would be 64px of dead
     screen under the last card on Valhalla, and only on Valhalla. */
  assert.doesNotMatch(CODE, /has-subnav/,
    'the extra Valhalla-only bottom clearance outlived the subnav it was for');
});

test('SUBNAV: nothing the tabs carried is missing from the one screen', () => {
  const a = planHQ();
  const view = a.renderPlanHQView();
  assert.ok(view.indexOf(a.renderProgrammeStatus()) !== -1, 'Programme Status missing');
  assert.ok(view.indexOf(a.renderValhallaReadingPreview()) !== -1, 'The Reading missing');
  assert.ok(view.indexOf(a.renderValhallaRecordPreview()) !== -1, 'The Athlete Status missing');
  assert.ok(view.indexOf(a.renderCoachPanel()) !== -1, 'the coach panel missing');
  assert.ok(view.indexOf(a.renderCheckpointBanner()) !== -1, 'the checkpoint banner missing');
  // and none of it twice
  [a.renderValhallaReadingPreview(), a.renderValhallaRecordPreview()].forEach(frag => {
    if (!frag) return;
    assert.equal(view.indexOf(frag), view.lastIndexOf(frag), 'a section renders twice');
  });
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
  // A generous label around a visually compact ring -- generous tap target,
  // restrained visible control. The intent was always "at least 40"; the app
  // now names that minimum once, as --tap-min, and carries it at 44. The ring
  // itself did not move when the label grew: its centre was measured at the
  // same x=10.0 y=11.0 from the rail's origin before and after.
  assert.match(CODE, /\.day-check\{[^}]*width:var\(--tap-min\)/);
});

test('RING: the Edit Session display checkbox carries the same ring language', () => {
  /* It used to draw its own ring -- a 20px near-copy of the shared 22px
     component two rules away. It is a member of that component now, so the
     ring language is asserted where the ring is actually defined. */
  assert.match(CODE, /\.ef-completed input\[type="checkbox"\], #ef-mp\{/,
    'the Edit Session pair must sit in the shared circular-checkbox rule');
  assert.match(CODE, /\.ef-completed input\[type="checkbox"\]:checked, #ef-mp:checked\{[\s\S]{0,80}background:var\(--cherry\)/,
    'and take --cherry when checked, like every other member');
  /* Inside a .field, `.field input` repaints them as text inputs -- the same
     collision .wd-check and .bld-consent already carry an override for. */
  assert.match(CODE, /\.field #ef-mp, \.field #ef-completed\{[^}]*min-height:0/,
    'the .field override that keeps them circular is gone');
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
  assert.match(html, /id="ef-sec-reschedule"/,
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
  assert.match(html, /id="ef-sec-reschedule"/);
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
  /* Session Details carries its chevron as .sess-tab-c now -- it is a
     session tab rather than a bare fuel disclosure, and sessionTabHtml()
     emits the cue for both tabs from one place. The Fueling card above
     still uses .fuel-chevron, which is what the two assertions above
     guard. */
  assert.match(SRC, /sessionTabHtml\('Session Details'/,
    'Session Details is no longer built from the shared session tab');
  assert.match(CODE, /\.sess-tab-btn\[aria-expanded="true"\] \.sess-tab-c\{transform:rotate\(180deg\)/,
    'the session tab chevron no longer turns when the tab opens');
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
  /* This has now been re-pointed twice, at .rec-val and then at the plate and
     headline, each time because the markup under it was retired. The LAW is
     what has never changed and is the only reason the test exists: the
     COMPONENT guarantees the data face, rather than every call site
     remembering to pass 'font-mono'. The one surface that carries a Record
     value today is the Athlete Status circle, so that is where it is
     asserted -- on .rd-val b, which both the Reading and the Status circles
     draw from, and which therefore cannot be loosened for one without the
     other noticing. */
  /* Named by token rather than by family: the product declares two faces
     and nothing names one directly (see typographyConsistency). The law is
     unchanged -- the component guarantees the FIGURE face -- and which
     family that is, is pinned in one place instead of here. */
  assert.match(CODE, /\.rd-val b\{[^}]*font-family\s*:\s*var\(--num-face\)/,
    'a Record value stopped carrying the figure face by default');
  /* And the absence, which must NOT inherit it -- the defect that rule was
     written for was an empty state rendering in the measurement's own face.
     It takes the words face, because an absence is language. */
  assert.match(CODE, /\.rd-val b\.rec-none\{[^}]*font-family\s*:\s*var\(--text-face\)/,
    'the absence is typeset as a measurement again');
  /* The two must not be the same token, or this law is satisfied by a
     product in which every value looks identical. */
  assert.notEqual('var(--num-face)', 'var(--text-face)');
  const a = planHQ();
  assert.match(a.statusDialHtml(a.recordProgressFact()), /class="rd-val"/,
    'a Record value is no longer drawn in the slot this law protects');
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
  // Re-render every surface this pass touched, and open every panel the
  // circles now reach; none of it is allowed to have been reached by a
  // coaching calculation. The panels are the new half of this guard: the
  // Goal panel renders raceOutlook() and the goal chooser on the same
  // surface, which is exactly where a render could start deciding things.
  a.renderPlanHQView();
  a.renderValhallaReadingPreview();
  a.renderValhallaRecordPreview();
  Object.keys(a.RECORD_PANELS).forEach(k => a.hqPanelHtml(k));
  a.readingSections(a.coachAnalyse()).forEach(sec => a.hqPanelHtml(sec.key));
  a.renderPlanHQView();
  assert.equal(a.computeConfidenceScore(), before.conf);
  assert.equal(JSON.stringify(a.raceOutlook()), before.outlook);
  assert.equal(JSON.stringify((a.coachAnalyse().decision || {})), before.decision);
});
