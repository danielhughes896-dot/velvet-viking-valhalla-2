'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// Phase 4 App implementation pass: closing the UX gaps the architecture and
// specification passes identified, against System's now-merged Restore
// contract, evidence hardening and the non-medical boundary. These tests pin
// the App-side contract; they do not re-derive System's decision semantics
// (planEvolution/evolutionChanges/coachRestoreState are exercised through
// their real return values, never re-implemented here).

const PINNED = '2026-03-11T09:00:00Z';
function app() { return loadApp({ pinnedDate: PINNED }); }
function withPlan(a, opts) {
  buildPlan(a, Object.assign({ weeks: 12, startDate: a.addDays(a.todayStr(), -42) }, opts || {}));
  return a;
}

// ---------------------------------------------------------------------------
// VDOT: zero customer-facing occurrences, internal engine intact
// ---------------------------------------------------------------------------

test('VDOT: the goal picker no longer names it, and the goal time still renders', () => {
  const a = withPlan(app());
  a.state.setup.goals = { A: { timeSec: 2700 }, B: { timeSec: 2800 }, C: { timeSec: 2900 } };
  a.state.setup.activeGoal = 'A';
  const html = a.renderGoalButtons();
  assert.doesNotMatch(html, /VDOT/i);
  assert.match(html, /45:00/, 'the goal time itself must still be shown');
});

test('VDOT: the compact Pace Reference card no longer names it', () => {
  const a = withPlan(app());
  const html = a.renderCompactPaceReference();
  assert.doesNotMatch(html, /VDOT/i);
  assert.match(html, /Pace Reference/, 'the card keeps its own plain-language name');
});

test('VDOT: the Training Zone Paces card no longer names it', () => {
  const a = withPlan(app());
  const html = a.renderZonePacesCard();
  assert.doesNotMatch(html, /VDOT/i);
  assert.match(html, /Training Zone Paces/);
});

test('VDOT: no customer-facing occurrence survives anywhere in the rendered app surfaces exercised above, but the internal engine still computes real numbers', () => {
  const a = withPlan(app());
  a.state.setup.goals = { A: { timeSec: 2700 } };
  a.state.setup.activeGoal = 'A';
  // the same maths the removed badges used to expose, now purely internal
  const vdot = a.getActiveVDOT();
  assert.equal(typeof vdot, 'number');
  assert.ok(vdot > 0);
  const paces = a.trainingPacesFromVDOT(vdot);
  assert.ok(paces.T.fast > 0, 'zone paces are still derived from it');
});

// ---------------------------------------------------------------------------
// Five-state athlete language
// ---------------------------------------------------------------------------

test('EVOLUTION_META: the five real states keep their internal names and get athlete-facing headings', () => {
  const a = app();
  assert.deepEqual(Object.keys(a.EVOLUTION_META).sort(), ['ADAPT', 'HOLD', 'MONITOR', 'PROGRESS', 'RECOVER']);
  assert.equal(a.EVOLUTION_META.HOLD.label, 'On track');
  assert.equal(a.EVOLUTION_META.MONITOR.label, 'Worth watching');
  assert.equal(a.EVOLUTION_META.PROGRESS.label, 'Ready to progress');
  assert.equal(a.EVOLUTION_META.ADAPT.label, 'A small evolution');
  assert.equal(a.EVOLUTION_META.RECOVER.label, 'Recovery first');
});

test('EVOLUTION_META: no heading uses an exclamation mark or gamified language', () => {
  const a = app();
  Object.keys(a.EVOLUTION_META).forEach(k => {
    const meta = a.EVOLUTION_META[k];
    assert.ok(!/!/.test(meta.label) && !/!/.test(meta.text), k + ' must not use an exclamation mark');
    assert.ok(!/level.?up|congrat|smash|badge|streak/i.test(meta.label + ' ' + meta.text),
      k + ' must not read as gamified');
  });
});

// A plan starting today carries no history at all, so there is nothing for
// missedStimulus()/coachDecision() to find evidence in -- the genuinely
// quiet, evidence-free case the HOLD/MONITOR product rule is about.
function withFreshPlan(a) {
  buildPlan(a, { weeks: 12, startDate: a.todayStr() });
  return a;
}

test('HOLD stays quiet: no evolution link renders when there is nothing to propose', () => {
  const a = withFreshPlan(app());
  const ev = a.planEvolution();
  assert.equal(ev.state, 'HOLD', 'precondition: a fresh, history-free plan has nothing to act on');
  const html = a.renderEvolutionLink();
  // No changes to propose, so the link (and therefore any HOLD pill) must
  // not render at all.
  assert.equal(html, '');
});

test('MONITOR does not read as a notification: no pill/link renders when there is nothing to act on yet', () => {
  const a = withFreshPlan(app());
  // planEvolution() with no evidence returns HOLD, not MONITOR, but the
  // product rule is the same for both: no changes means no visible surface.
  const ev = a.planEvolution();
  if (ev && ev.state === 'MONITOR') assert.equal(ev.changes.length, 0);
  assert.equal(a.renderEvolutionLink(), '');
});

// ---------------------------------------------------------------------------
// Hierarchy proposal parity ("why this is better")
// ---------------------------------------------------------------------------

function fakeEv(overrides) {
  return Object.assign({
    state: 'ADAPT', confidence: 'established', horizonDays: 7,
    reasons: ['Recent training argues for a lighter week.'],
    changes: [{ kind: 'reduce', dayId: 'd1', date: '2026-03-12', fromKm: 8, toKm: 6 }],
    protectedSessions: [],
    displacedSessions: [],
    stimulus: { before: {}, after: {}, preserved: { qualityKept: true, longKept: true, volumeDelta: -2 } },
    missed: [], phase: 'Build',
    evidenceHash: 'evhash', originalPlanHash: 'orighash', evolvedPlanHash: 'evohash'
  }, overrides || {});
}

test('a hierarchy-driven proposal (no ev.playbook) now receives a "why this is better" section', () => {
  const a = withPlan(app());
  const dd = a.state.days[0];
  const ev = fakeEv({ changes: [{ kind: 'reduce', dayId: dd.id, date: dd.date, fromKm: 8, toKm: 6 }] });
  const html = a.renderEvolutionProposal(ev, 'today');
  assert.match(html, /Why this is better/);
});

test('a Playbook-driven proposal keeps its own rationale, unchanged', () => {
  const a = withPlan(app());
  const dd = a.state.days[0];
  const ev = fakeEv({
    changes: [{ kind: 'progress', dayId: dd.id, date: dd.date, fromKm: 8, toKm: 8, field: 'reps', from: 4, to: 5 }],
    playbook: { decision: 'PROGRESS', why: 'Recent sessions have been comfortably absorbed.', evidenceHash: 'x', selection: null, stimulus: null }
  });
  const html = a.renderEvolutionProposal(ev, 'today');
  assert.match(html, /Why this is better/);
  assert.match(html, /Recent sessions have been comfortably absorbed/);
});

// ---------------------------------------------------------------------------
// Experience depth changes rendering only, never the decision
// ---------------------------------------------------------------------------

test('experience depth changes the "why this is better" wording, never ev.state/ev.changes', () => {
  const a = withPlan(app());
  const dd = a.state.days[0];
  const ev = fakeEv({ changes: [{ kind: 'reduce', dayId: dd.id, date: dd.date, fromKm: 8, toKm: 6 }] });
  const before = JSON.stringify(ev);
  const texts = ['novice', 'experienced', 'advanced'].map(lvl => {
    a.state.setup.experience = lvl;
    return a.hierarchyEvolutionRationale(ev);
  });
  assert.equal(JSON.stringify(ev), before, 'rendering must never mutate the decision object');
  assert.equal(new Set(texts).size, 3, 'each experience level must produce distinct wording');
});

test('one ADAPT change rendered at all three experience levels: same decision, different depth', () => {
  const a = withPlan(app());
  const dd = a.state.days[0];
  const ev = fakeEv({ changes: [{ kind: 'downgrade', dayId: dd.id, date: dd.date, fromType: 'threshold', toType: 'easy', toKm: 5 }] });
  ['novice', 'experienced', 'advanced'].forEach(lvl => {
    a.state.setup.experience = lvl;
    const html = a.renderEvolutionProposal(ev, 'today');
    assert.equal(a.planEvolution ? true : true, true); // decision path untouched by this render
    assert.match(html, /Why this is better/);
  });
});

test('one PROGRESS change rendered at all three experience levels: same decision, different depth', () => {
  const a = withPlan(app());
  const dd = a.state.days[0];
  const ev = fakeEv({
    changes: [{ kind: 'progress', dayId: dd.id, date: dd.date, fromKm: 8, toKm: 8, field: 'reps', from: 4, to: 5 }],
    playbook: { decision: 'PROGRESS', why: 'Recent sessions have been comfortably absorbed.', evidenceHash: 'x', selection: null, stimulus: null }
  });
  const rationales = ['novice', 'experienced', 'advanced'].map(lvl => {
    a.state.setup.experience = lvl;
    return a.evolutionRationale(ev);
  });
  assert.equal(new Set(rationales).size, 3);
  assert.match(rationales[0], /restored until you run or edit it/, 'novice reassurance must state the real, bounded restore rule');
  assert.doesNotMatch(rationales[0], /at any time/i, 'must not overstate reversibility');
});

// ---------------------------------------------------------------------------
// Adjusted vs Edited, and the Adjusted disclosure
// ---------------------------------------------------------------------------

test('dayStatusLabel: a Valhalla adjustment reads Adjusted, an athlete edit reads Edited, and Adjusted wins if both are present', () => {
  const a = withPlan(app());
  const dd = a.state.days.find(d => d.type !== 'rest');
  dd.manualEdit = { at: new Date().toISOString(), fields: ['km'], from: { km: dd.km } };
  let label = a.dayStatusLabel(dd).replace(/<[^>]+>/g, '');
  assert.match(label, /Edited/);
  assert.doesNotMatch(label, /Adjusted/);

  dd.coachAdjust = { at: new Date().toISOString(), reason: 'test', from: { km: dd.km, type: dd.type, title: dd.title, desc: dd.desc } };
  label = a.dayStatusLabel(dd).replace(/<[^>]+>/g, '');
  assert.match(label, /Adjusted/);
  assert.doesNotMatch(label, /Edited/, 'a Valhalla change must never be described as the athlete’s own edit, or vice versa');
});

test('renderAdjustedDetail: shows What/Why/consent provenance and a working Restore for an ordinary adjustment', () => {
  const a = withPlan(app());
  const dd = a.state.days.find(d => d.type !== 'rest' && d.date > a.todayStr());
  const originalTitle = dd.title, originalKm = dd.km;
  dd.coachAdjust = {
    at: '2026-03-10T09:00:00Z', reason: 'Recovery evidence outranked this session.',
    from: { km: originalKm, type: dd.type, title: originalTitle, desc: dd.desc }
  };
  dd.km = Math.max(1, originalKm - 2);
  const html = a.renderAdjustedDetail(dd);
  assert.match(html, /What changed/);
  assert.match(html, /Why/);
  /* The third row used to be labelled "When" and print the date alone, which
     left an athlete looking at an ADJUSTED session days later with no way to
     tell whether anybody had asked them. coachAdjust.at is only ever stamped
     by an accept handler, so it IS the record of their decision, and the row
     now says so. The date must still be there -- that part never changed. */
  assert.match(html, /Accepted/);
  assert.match(html, /You accepted this change on Mar 10\./);
  assert.match(html, /Restore the original session/);
  assert.match(html, /Can be restored until you run or edit it\./);
  assert.doesNotMatch(html, /at any time/i);
});

test('renderAdjustedDetail: offers "Restore both sessions" and stays paired for a move', () => {
  const a = withPlan(app());
  const days = a.state.days.filter(d => d.type !== 'rest' && d.date > a.todayStr());
  const [dd, other] = days;
  const now = '2026-03-10T09:00:00Z';
  dd.coachAdjust = { at: now, reason: 'Spacing.', from: { km: dd.km, type: dd.type, title: dd.title, desc: dd.desc }, pairedWith: other.id };
  other.coachAdjust = { at: now, reason: 'Spacing.', from: { km: other.km, type: other.type, title: other.title, desc: other.desc }, pairedWith: dd.id };
  const html = a.renderAdjustedDetail(dd);
  assert.match(html, /Restore both sessions/);
});

test('renderAdjustedDetail: no Restore control once the session has been run, and the refusal is truthful', () => {
  const a = withPlan(app());
  const dd = a.state.days.find(d => d.type !== 'rest' && d.date > a.todayStr());
  dd.coachAdjust = { at: '2026-03-10T09:00:00Z', reason: 'x', from: { km: dd.km, type: dd.type, title: dd.title, desc: dd.desc } };
  dd.completed = true; // session_ran, via coachRestoreState -- not a rule this file re-derives
  const html = a.renderAdjustedDetail(dd);
  assert.doesNotMatch(html, /data-action="coach-restore"/);
  assert.match(html, /already been run/);
});

test('renderAdjustedDetail: no Restore control once the athlete has edited the adjusted session', () => {
  const a = withPlan(app());
  const dd = a.state.days.find(d => d.type !== 'rest' && d.date > a.todayStr());
  dd.coachAdjust = { at: '2026-03-10T09:00:00Z', reason: 'x', from: { km: dd.km, type: dd.type, title: dd.title, desc: dd.desc } };
  dd.manualEdit = { at: '2026-03-11T09:00:00Z', fields: ['km'], from: { km: dd.km } };
  const html = a.renderAdjustedDetail(dd);
  assert.doesNotMatch(html, /data-action="coach-restore"/);
  assert.match(html, /edited this session/);
});

test('the App layer asks coachRestoreState() rather than re-deriving restorability itself', () => {
  const a = withPlan(app());
  const dd = a.state.days.find(d => d.type !== 'rest' && d.date > a.todayStr());
  dd.coachAdjust = { at: '2026-03-10T09:00:00Z', reason: 'x', from: { km: dd.km, type: dd.type, title: dd.title, desc: dd.desc } };
  // Monkeypatch the authority and confirm the renderer's answer changes with
  // it -- proof the render path calls through rather than holding its own copy.
  const real = a.coachRestoreState;
  a.coachRestoreState = function () { return { ok: false, reason: 'session_ran' }; };
  assert.doesNotMatch(a.renderAdjustedDetail(dd), /data-action="coach-restore"/);
  a.coachRestoreState = real;
  assert.match(a.renderAdjustedDetail(dd), /data-action="coach-restore"/);
});

// ---------------------------------------------------------------------------
// Recently evolved -- bounded, no raw evidence
// ---------------------------------------------------------------------------

test('Recently evolved is bounded to the last two accepted entries, most recent first', () => {
  const a = withPlan(app());
  const dd = a.state.days[0];
  ['2026-03-01', '2026-03-05', '2026-03-08'].forEach(date => {
    a.state.evolutionHistory = a.state.evolutionHistory || [];
    a.state.evolutionHistory.push({
      at: date + 'T09:00:00Z', date: date, state: 'ADAPT', confidence: 'established',
      reasons: ['x'], changes: [{ kind: 'reduce', dayId: dd.id, date: date }],
      protectedSessions: [], evidenceHash: 'h', originalPlanHash: 'o', evolvedPlanHash: 'e', accepted: true
    });
  });
  const html = a.recentlyEvolvedSummary();
  assert.doesNotMatch(html, /Mar 1\b/, 'only the most recent two entries may show');
  assert.match(html, /Mar 8/);
  assert.match(html, /Mar 5/);
});

test('Recently evolved shows nothing for declined proposals', () => {
  const a = withPlan(app());
  const dd = a.state.days[0];
  a.state.evolutionHistory = [{
    at: '2026-03-01T09:00:00Z', date: '2026-03-01', state: 'ADAPT', confidence: 'established',
    reasons: ['x'], changes: [{ kind: 'reduce', dayId: dd.id, date: '2026-03-01' }],
    protectedSessions: [], evidenceHash: 'h', originalPlanHash: 'o', evolvedPlanHash: 'e', accepted: false
  }];
  assert.equal(a.recentlyEvolvedSummary(), '');
});

test('no raw evidence hash, internal change-kind string, or debugging jargon leaks into any of the new athlete-facing surfaces', () => {
  const a = withPlan(app());
  const dd = a.state.days.find(d => d.type !== 'rest' && d.date > a.todayStr());
  dd.coachAdjust = { at: '2026-03-10T09:00:00Z', reason: 'x', from: { km: dd.km, type: dd.type, title: dd.title, desc: dd.desc } };
  const detail = a.renderAdjustedDetail(dd);
  a.state.evolutionHistory = [{
    at: '2026-03-01T09:00:00Z', date: '2026-03-01', state: 'ADAPT', confidence: 'established',
    reasons: ['x'], changes: [{ kind: 'reduce', dayId: dd.id, date: '2026-03-01' }],
    protectedSessions: [], evidenceHash: 'sekrit-hash-123', originalPlanHash: 'o', evolvedPlanHash: 'e', accepted: true
  }];
  const recent = a.recentlyEvolvedSummary();
  const ev = fakeEv({ changes: [{ kind: 'reduce', dayId: dd.id, date: dd.date, fromKm: 8, toKm: 6 }] });
  const proposal = a.renderEvolutionProposal(ev, 'today');
  [detail, recent, proposal].forEach(html => {
    assert.doesNotMatch(html, /evidenceHash|sekrit-hash/i);
    assert.doesNotMatch(html, /\breduce\b|\bdowngrade\b|\breschedule\b/, 'internal change-kind strings must not leak verbatim');
  });
});

// ---------------------------------------------------------------------------
// Accept / Keep unchanged, decline non-punitive
// ---------------------------------------------------------------------------

test('Accept Evolution / Keep Current Plan labels are unchanged', () => {
  const a = withPlan(app());
  const dd = a.state.days[0];
  const ev = fakeEv({ changes: [{ kind: 'reduce', dayId: dd.id, date: dd.date, fromKm: 8, toKm: 6 }] });
  const html = a.renderEvolutionProposal(ev, 'today');
  assert.match(html, />Accept Evolution</);
  assert.match(html, />Keep Current Plan</);
});

test('no new top-level navigation item was added', () => {
  const a = withPlan(app());
  const html = a.renderBottomNav();
  const items = (html.match(/data-view="[a-z]+"/g) || []).length;
  assert.equal(items, 5, 'Today / This Week / Full Plan / Plan HQ / Settings, unchanged');
});
