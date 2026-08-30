'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* UNIT CONSISTENCY -- THE CACHED EXECUTION REVIEW GAP
 * ===========================================================================
 * test/actualPaceUnits.test.js already proves the raw actual-pace stamp
 * (dd.actual.paceUnit), canonical distance storage, and every LIVE analysis
 * function (structuredExecutionEvidence(), computeExecutionScore()) are
 * unit-safe -- none of them re-derive a wrong number when state.units
 * changes.
 *
 * This file covers a different code path those tests do not exercise:
 * dd.coachReview. coachWorkoutReview() builds coachVerdict()/coachNoticed/
 * nextMove as PROSE STRINGS with fmtDist()/fmtPaceFromSecPerKm() baked in
 * ("8km of threshold with pace inside the 5:04/km-5:34/km window"), and the
 * result is PERSISTED to dd.coachReview so coachReviewFor()/coachDebrief()
 * do not recompute it on every render. reviewInputHash() is the sole gate
 * that decides when that cache is safe to reuse -- and until this pass it
 * hashed everything about the SESSION (prescription, actual, zones) but
 * nothing about how the athlete is currently LOOKING at it. A km session
 * reviewed once, then viewed again after switching to MI, kept the exact
 * sentence written under km: correct distance, correct pace, wrong unit --
 * the precise defect this brief describes. Fixed by adding state.units to
 * the hash.
 *
 * The whole-app sweep this brief also demanded turned up one more instance
 * of the same defect class, in a different shape: openEditModal()'s Distance
 * field was hardcoded "Distance (km)" with dd.km's raw canonical value
 * dropped straight into the input, and handleSaveEdit() read it back with a
 * bare parseFloat() -- so under MI the modal showed a km number mislabelled
 * as miles, and a mile figure typed there would have been stored as if it
 * were that many kilometres. Fixed by routing the field through
 * kmToDisplay()/parseDistInput(), the same canonical-in/display-out boundary
 * every other distance input in the app already uses (section J below). */

const TODAY = '2026-05-20';
function app(units){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {};
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -21) });
  a.state.units = units || 'km';
  return a;
}
function loggedThreshold(a){
  const dd = a.state.days.filter(d => d.type === 'threshold' || d.type === 'tempo')[0]
          || a.state.days.filter(d => d.type !== 'rest')[0];
  dd.completed = true;
  dd.actual = a.emptyActual();
  a.handleActualFieldChange(dd.id, 'km', '8');
  a.handleActualFieldChange(dd.id, 'pace', '5:00');
  a.handleActualFieldChange(dd.id, 'hr', '160');
  a.handleActualFieldChange(dd.id, 'rpe', '6');
  a.coachPersistReview(dd);
  return dd;
}

// ---------------------------------------------------------------------------
// C. EXECUTION REVIEW -- the reported case, through the actual cached path
// ---------------------------------------------------------------------------
test('the cached executionVerdict converts on a unit toggle, not just a freshly-computed one', () => {
  const a = app('km');
  const dd = loggedThreshold(a);
  const kmVerdict = a.coachReviewFor(dd).executionVerdict;
  assert.match(kmVerdict, /\dkm\b/, 'the reported bug: cached text carries the unit it was written under');

  a.state.units = 'mi';
  const miVerdict = a.coachReviewFor(dd).executionVerdict;
  assert.match(miVerdict, /\dmi\b/);
  assert.doesNotMatch(miVerdict, /\/km/, 'no leftover km-labelled figure once switched to MI');
  assert.notEqual(kmVerdict, miVerdict, 'the numbers must actually differ, not just risk a relabel');
});

test('coachDebrief() -- the prose actually rendered on the card -- carries the same fix', () => {
  const a = app('km');
  const dd = loggedThreshold(a);
  const kmText = a.coachDebrief(dd).paragraphs.join(' ');
  a.state.units = 'mi';
  const miText = a.coachDebrief(dd).paragraphs.join(' ');
  assert.match(kmText, /\dkm\b/);
  assert.match(miText, /\dmi\b/);
  assert.doesNotMatch(miText, /\d\/km\b/, 'coachDebrief reads the same cached review coachReviewFor does');
});

test('round trip km -> mi -> km returns the byte-identical cached review', () => {
  const a = app('km');
  const dd = loggedThreshold(a);
  const original = a.coachReviewFor(dd).executionVerdict;
  a.state.units = 'mi';
  a.coachReviewFor(dd);
  a.state.units = 'km';
  const back = a.coachReviewFor(dd).executionVerdict;
  assert.equal(back, original, 'no drift: the canonical km/pace never moved, so the sentence must not either');
});

test('switching units alone does not append to the block-review history', () => {
  // coachReviewFor() is explicitly documented as safe to call from a render
  // path because -- unlike coachPersistReview() -- it must never create
  // evidence. The fix must not change that: reading the review after a unit
  // toggle should refresh the cached prose, not behave like a new log event.
  const a = app('km');
  const dd = loggedThreshold(a);
  const measuredBefore = (a.athlete().performances || []).length;
  a.state.units = 'mi';
  a.coachReviewFor(dd);
  assert.equal((a.athlete().performances || []).length, measuredBefore);
});

test('the qualitative coaching meaning is unchanged across units -- only the embedded numbers differ', () => {
  const a = app('km');
  const dd = loggedThreshold(a);
  const kmReview = a.coachReviewFor(dd);
  a.state.units = 'mi';
  // Force a fresh object read after the toggle (same day, same physical data).
  const miReview = a.coachReviewFor(dd);
  assert.equal(miReview.trainingSignal, kmReview.trainingSignal,
    'the coaching signal is derived from canonical evidence, never from the display unit');
  assert.equal(miReview.recommendPlanAdjustment, kmReview.recommendPlanAdjustment);
  assert.equal(miReview.confidence, kmReview.confidence);
});

test('a session logged and reviewed entirely under MI reads correctly back in KM', () => {
  const a = app('mi');
  /* A SESSION WHOSE VERDICT ACTUALLY QUOTES A DISTANCE. The verdict wording is
     per session type: an interval session is summarised as "Quality work
     delivered close to the prescription" and names no distance at all, so a
     round-trip assertion about the UNITS of a number reads a sentence with no
     number in it. The first non-rest day of this block is now an interval
     session, which is what changed; the rule being tested has not. */
  const dd = a.state.days.filter(d => d.type === 'tempo' || d.type === 'easy')[0]
          || a.state.days.filter(d => d.type !== 'rest')[0];
  dd.completed = true;
  dd.actual = a.emptyActual();
  a.handleActualFieldChange(dd.id, 'km', '5'); // "5" typed while MI is selected -> ~8.05km canonical
  a.handleActualFieldChange(dd.id, 'pace', '8:00'); // 8:00/mi
  a.handleActualFieldChange(dd.id, 'hr', '155');
  a.coachPersistReview(dd);
  const miVerdict = a.coachReviewFor(dd).executionVerdict;
  assert.match(miVerdict, /\d/, 'precondition: the verdict must quote a number to round-trip');
  assert.match(miVerdict, /\dmi\b/);

  a.state.units = 'km';
  const kmVerdict = a.coachReviewFor(dd).executionVerdict;
  assert.match(kmVerdict, /\dkm\b/);
  assert.doesNotMatch(kmVerdict, /\d\/mi\b/);
});

// ---------------------------------------------------------------------------
// I. CURRENT FITNESS / CALIBRATION -- same physical speed, either unit
// ---------------------------------------------------------------------------
test('currentFitnessAnchor() and the training paces it derives are identical whichever unit is selected', () => {
  const a = app('km');
  a.state.setup.thresholdPaceSecPerKm = 258; // 4:18/km
  a.state.setup.thresholdPaceSource = 'calibration';
  a.state.setup.thresholdPaceMeasuredOn = TODAY;
  const kmAnchor = a.currentFitnessAnchor();
  const kmPaces = a.getActivePaces();
  a.state.units = 'mi';
  const miAnchor = a.currentFitnessAnchor();
  const miPaces = a.getActivePaces();
  assert.equal(miAnchor.vdot, kmAnchor.vdot, 'the anchor is computed from canonical sec/km, never display units');
  assert.equal(miPaces.T.fast, kmPaces.T.fast, 'zone bounds are stored canonically -- only rendering converts them');
  assert.equal(miPaces.T.slow, kmPaces.T.slow);
});

test('the displayed threshold pace converts, but represents the exact same physical speed', () => {
  const a = app('km');
  const secPerKm = 258;
  const kmText = a.fmtPaceFromSecPerKm(secPerKm);
  a.state.units = 'mi';
  const miText = a.fmtPaceFromSecPerKm(secPerKm);
  assert.match(kmText, /\/km$/);
  assert.match(miText, /\/mi$/);
  // Derived independently, from the same conversion factor fmtPaceFromSecPerKm()
  // itself uses -- proving the displayed value, not asserting a hand-picked number.
  assert.equal(miText, a.secToPace(secPerKm * 1.60934) + '/mi');
});

// ---------------------------------------------------------------------------
// J. EDIT SESSION -- the whole-app sweep's own finding: openEditModal()'s
// Distance field was hardcoded "Distance (km)" with a raw dd.km value, and
// handleSaveEdit() read it back with plain parseFloat() -- so under MI the
// modal showed a canonical-km number mislabelled as the athlete's chosen
// unit, and typing a mile figure there would have been stored as if it were
// that many kilometres. Fixed by routing the field through
// kmToDisplay()/parseDistInput(), the same boundary every other distance
// input in the app already uses.
// ---------------------------------------------------------------------------
function futureApp(units){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {};
  buildPlan(a, { weeks: 8, startDate: a.addDays(TODAY, 7) }); // all future, prescription editable
  a.state.units = units || 'km';
  a.canEditPrescription = () => true;
  return a;
}

function capturedModalHtml(a, dd){
  let captured = null;
  const realAppend = a.document.body.appendChild.bind(a.document.body);
  a.document.body.appendChild = (node) => { captured = node.innerHTML; return realAppend(node); };
  try { a.openEditModal(dd.id); } finally { a.document.body.appendChild = realAppend; }
  return captured;
}

test('the Edit Session modal labels and pre-fills the Distance field in the currently selected unit', () => {
  const a = futureApp('km');
  const dd = a.state.days.find(d => d.type !== 'rest');
  const kmHtml = capturedModalHtml(a, dd);
  assert.match(kmHtml, /Distance \(km\)/);
  assert.match(kmHtml, new RegExp('id="ef-km" value="' + a.kmToDisplay(dd.km) + '"'));

  a.state.units = 'mi';
  const miHtml = capturedModalHtml(a, dd);
  assert.match(miHtml, /Distance \(mi\)/);
  assert.match(miHtml, new RegExp('id="ef-km" value="' + a.kmToDisplay(dd.km) + '"'));
  assert.notEqual(a.kmToDisplay(dd.km), dd.km, 'sanity: mi display value must actually differ from raw canonical km');
});

test('a distance typed into Edit Session while MI is selected is stored as the correct canonical km, not the raw digits', () => {
  const a = futureApp('mi');
  const dd = a.state.days.find(d => d.type !== 'rest');
  const mockFields = {
    'ef-title': { value: dd.title }, 'ef-type': { value: dd.type },
    'ef-km': { value: '5' }, // "5" typed while MI is selected -> ~8.05km canonical
    'ef-mp': { checked: !!dd.mpSegment }, 'ef-desc': { value: a.resolveDesc(dd.desc) },
    'ef-swap': { value: '' },
  };
  a.document.getElementById = (id) => mockFields[id] || null;
  a.handleSaveEdit(dd.id);
  const after = a.findDay(dd.id);
  assert.equal(after.km, a.parseDistInput('5'), 'stored canonically, via the same boundary every other distance input uses');
  assert.ok(after.km > 7.5 && after.km < 8.5, '"5" typed under MI must land near 8.05km, not be stored as 5km');
});
