'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* FIVE THINGS THE INPUT-TO-COACHING AUDIT FOUND, AND THE FOUNDER'S RULING ON EACH.
 *
 * The audit varied one input at a time against an athlete who had run every
 * session as written, and recorded which readings moved. These are the five
 * places where what SACORO knew and what it did had come apart:
 *
 *   1. Weather a watch recorded was ignored unless the athlete also wrote a note.
 *   2. A proposal to ease a session was visible on Coach and nowhere else.
 *   3. An easing caused by strain was explained as sessions not being finished.
 *   4. Accepting a proposal produced another at once, on the same evidence.
 *   5. The morning check-in reached the decision but not the Recovery reading.
 */

const TODAY = '2026-11-12';
function athlete() {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.healthConsentGranted = () => true;
  const plan = buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 12, lthr: 172, maxHR: 188,
    startDate: a.addDays(TODAY, -37) });
  const past = plan.days.filter(d => d.date < TODAY && d.type !== 'rest');
  past.forEach(d => {
    logAsPrescribed(a, d, { quality: 1, sections: true });
    const z = a.executionHRTarget(d);
    if (z && z.lo != null) d.actual.hr = Math.round((z.lo + (z.hi || z.lo + 8)) / 2);
  });
  a.past = past; a.plan = plan;
  return a;
}
const last = (a, n) => a.past.slice(-n);
const strained = a => { last(a, 3).forEach(d => { if (d.actual.hr) d.actual.hr += 15; }); return a; };
const sore = a => { last(a, 2).forEach(d => { d.actual.notes = 'sharp pain in my calf, had to slow'; }); return a; };
const accept = (a, ev) => ev.playbook ? a.handleAcceptPlaybook(ev.proposalId) : a.handleAcceptEvolution(ev.proposalId);
const text = html => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

/* ---------- 1. stored weather ---------- */

test('weather the watch recorded informs the session when the athlete wrote nothing', () => {
  const a = athlete();
  const stored = a.coachEnvironment('', { tempC: 33, humidity: 80 });
  assert.equal(stored.heatBand, 'severe', 'a run imported at 33C read as ordinary conditions');
  assert.equal(stored.humidBand, 'severe');
  assert.equal(stored.stored, true);
  /* The same bands a written note earns for the same numbers: nothing more is excused. */
  const noted = a.coachEnvironment('33 degrees and 80% humidity', {});
  assert.equal(stored.heatBand, noted.heatBand);
  assert.equal(stored.humidBand, noted.humidBand);
  assert.equal(stored.severe, noted.severe);
  for (const t of [23, 24, 27, 28, 30, 31, 32, 35]) {
    assert.equal(a.coachEnvironment('', { tempC: t }).heatBand, a.coachEnvironment(t + ' degrees', {}).heatBand,
      'stored ' + t + 'C and a note saying ' + t + ' degrees are banded differently');
  }
});

test('stored weather is context only: it reports no symptom and ignores an impossible reading', () => {
  const a = athlete();
  const env = a.coachEnvironment('', { tempC: 33, humidity: 80 });
  assert.equal(env.fatigue, false); assert.equal(env.pain, false); assert.equal(env.illness, false);
  assert.equal(env.hrDoubt, false);
  assert.equal(a.coachEnvironment('', { tempC: 90 }).heatBand, 'none', 'a 90C reading was believed');
  assert.equal(a.coachEnvironment('', { humidity: 140 }).humidBand, 'none');
  assert.equal(a.coachEnvironment('', {}).heatBand, 'none');
  assert.equal(a.coachEnvironment('', null).heatBand, 'none');
});

test('and it explains a hard session without erasing it', () => {
  const a = athlete();
  const d = last(a, 1)[0];
  d.actual.rpe = 10; d.actual.tempC = 33; d.actual.humidity = 80; d.actual.notes = '';
  const r = a.assessSession(d);
  assert.equal(r.response.reading, 'harder', 'stored heat turned a hard session into a normal one');
  assert.ok(r.response.context.indexOf('heat') > -1, 'the stored heat was not kept as the explanation');
});

/* ---------- 3. the strain reason ---------- */

test('an athlete who finished everything under strain is told that, not that they failed to finish', () => {
  const a = strained(athlete());
  const ev = a.planEvolution();
  assert.ok(ev.changes.length, 'the fixture produced no proposal');
  assert.match(ev.reasons[0], /completed your recent sessions, but they.ve required more effort than usual/,
    'the reason shown beside Accept is: ' + ev.reasons[0]);
  assert.doesNotMatch(ev.reasons.join(' '), /not being completed|fallen short/,
    'a finished session is still described as an unfinished one');
  assert.equal(ev.changes[0].why, ev.reasons[0]);
});

test('an athlete who really is not finishing is still told so, even when strained as well', () => {
  const a = strained(athlete());
  a.past.filter(d => a.isQualityType(d.type)).slice(-3).forEach(d => { d.actual.km = d.km * 0.5; });
  const as = a.playbookAssess();
  const ids = as.evidence.map(e => e.id);
  assert.ok(ids.indexOf('strained_week') > -1 && ids.indexOf('repeated_shortfall') > -1,
    'the fixture is not both strained and falling short: ' + ids.join(','));
  assert.equal(a.playbookStrainLed(as), false, 'strain was allowed to speak over sessions that were not finished');
  assert.doesNotMatch(a.playbookChangeWhy('REGRESS', {}, null, null, as), /completed your recent sessions/);
  /* And strain alone does lead. */
  assert.equal(a.playbookStrainLed(strained(athlete()).playbookAssess()), true);
});

test('the strain sentence names what was actually high', () => {
  const a = athlete();
  const m = { answered: false, flags: [] };
  assert.equal(a.recoveryStrainSentence({ overRPE: 0, overHR: 3, morning: m }), 'Heart rate has been above target this week.');
  assert.equal(a.recoveryStrainSentence({ overRPE: 2, overHR: 0, morning: m }), 'Effort has been above target this week.');
  assert.match(a.recoveryStrainSentence({ overRPE: 2, overHR: 2, morning: m }), /^Effort and heart rate have both/);
  assert.equal(a.recoveryStrainSentence({ overRPE: 0, overHR: 0, morning: { flags: ['heavy legs', 'poor sleep'] } }),
    'You reported heavy legs and poor sleep this morning.');
  /* The evidence the proposal is built on carries the accurate one. */
  const ev = strained(athlete()).playbookAssess().evidence.filter(e => e.id === 'strained_week')[0];
  assert.ok(ev, 'no strain evidence');
  assert.doesNotMatch(ev.detail, /Effort and heart rate have both/, 'heart rate alone is described as both');
});

/* ---------- 4. one change per body of evidence ---------- */

for (const [name, make] of [['strain', strained], ['soreness', sore]]) {
  test('accepting a ' + name + ' proposal does not produce another on the same evidence', () => {
    const a = make(athlete());
    const first = a.planEvolution();
    assert.equal(first.changes.length, 1, 'the fixture produced no single proposal');
    assert.equal(first.settled, false);
    accept(a, first);
    const after = a.planEvolution();
    assert.equal(after.changes.length, 0,
      'a second session was offered for easing before one new run had been logged');
    assert.equal(after.settled, true);
    assert.equal(a.evolutionProposalVisible(after), false);
    assert.match(after.reasons[0], /accepted a change on this evidence/);
    assert.equal(a.state.days.filter(d => d.coachAdjust).length, 1, 'more than one session was changed');
  });
}

test('new evidence reopens the question', () => {
  const a = sore(athlete());
  accept(a, a.planEvolution());
  const sig = a.planEvolution().evidenceSignature;
  /* A session is logged: the evidence is no longer the evidence that was acted on. */
  const next = a.plan.days.filter(d => d.date >= TODAY && d.type !== 'rest' && !d.completed)[0];
  logAsPrescribed(a, next, { quality: 1, sections: true });
  const again = a.planEvolution();
  assert.notEqual(again.evidenceSignature, sig);
  assert.equal(again.settled, false, 'the engine stayed silent after new evidence arrived');
});

test('declining does not erase what was accepted, and a decline is still respected', () => {
  const a = sore(athlete());
  const first = a.planEvolution();
  a.handleDeclineEvolution(first.proposalId);
  assert.equal(a.evolutionProposalVisible(a.planEvolution()), false, 'a declined proposal came straight back');
  assert.equal(a.state.days.filter(d => d.coachAdjust).length, 0, 'a declined proposal changed the plan');
  const b = sore(athlete());
  accept(b, b.planEvolution());
  const kept = b.state.evolution.acceptedEvidence;
  assert.ok(kept);
  b.state.evolution = Object.assign({}, b.state.evolution);
  b.handleDeclineEvolution(null);
  assert.equal(b.state.evolution.acceptedEvidence, kept);
});

/* ---------- 2. the proposal is on Today, and it is the same proposal ---------- */

test('a proposal is on Today, with the change, the reason and both answers', () => {
  const a = strained(athlete());
  const ev = a.planEvolution();
  a.state.view = 'today';
  const today = a.renderMainContent();
  assert.match(today, /class="today-proposal"/, 'an athlete who never opens Coach never learns a change was suggested');
  const t = text(today);
  assert.ok(t.indexOf(a.evolutionChangeLine(ev.changes[0])) > -1, 'Today does not say what would change');
  assert.ok(t.indexOf('more effort than usual') > -1, 'Today does not say why');
  assert.match(today, /data-action="accept-evolution"[^>]*>Accept</);
  assert.match(today, /data-action="decline-evolution"[^>]*>Keep my plan</);
  assert.match(today, /data-action="open-reading" data-reading="evolution"/, 'Today has no way through to the explanation');
  /* Accept is a choice the athlete makes, so it is cherry -- not the bronze a
     primary button is outside a sheet. */
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', require('./harness.js').RUNTIME_RELATIVE), 'utf8');
  assert.match(src, /\n  \.today-proposal \.btn-primary\{background:var\(--cherry-fill\);/,
    'Accept on Today is the gold slab again');
});

test('Today and Coach show ONE proposal: the same id on the same actions', () => {
  const a = sore(athlete());
  const ev = a.planEvolution();
  const ids = html => (html.match(/data-proposal="([^"]+)"/g) || []);
  const today = a.renderTodayProposal(a.findDayByDate(TODAY), 'above') + a.renderTodayProposal(a.findDayByDate(TODAY), 'below');
  const coach = a.hqPanelHtml('evolution');
  assert.ok(ids(today).length >= 2 && ids(coach).length >= 2, 'one of the two surfaces carries no proposal id');
  ids(today).concat(ids(coach)).forEach(x => assert.equal(x, 'data-proposal="' + ev.proposalId + '"',
    'the two surfaces are offering different proposals'));
  assert.match(today, /data-source="evolution"/);
  assert.ok(text(coach).indexOf(a.evolutionChangeLine(ev.changes[0])) > -1, 'the two surfaces word the change differently');
});

test('a change to today’s own session sits above it; a change to a later one sits below', () => {
  const a = sore(athlete());
  const ev = a.planEvolution();
  const dd = a.findDayByDate(TODAY);
  assert.notEqual(ev.changes[0].dayId, dd.id, 'the fixture changes today’s session');
  assert.equal(a.renderTodayProposal(dd, 'above'), '');
  assert.notEqual(a.renderTodayProposal(dd, 'below'), '');
  const target = a.findDay(ev.changes[0].dayId);
  assert.notEqual(a.renderTodayProposal(target, 'above'), '', 'a change to the session in front of the athlete is below it');
  assert.equal(a.renderTodayProposal(target, 'below'), '');
});

test('nothing to propose, a declined proposal and an accepted one all leave Today clear', () => {
  const calm = athlete();
  const dd = calm.findDayByDate(TODAY);
  assert.equal(calm.renderTodayProposal(dd, 'above') + calm.renderTodayProposal(dd, 'below'), '');
  const a = sore(athlete());
  a.handleDeclineEvolution(a.planEvolution().proposalId);
  assert.equal(a.renderTodayProposal(dd, 'above') + a.renderTodayProposal(dd, 'below'), '');
  const b = sore(athlete());
  accept(b, b.planEvolution());
  assert.equal(b.renderTodayProposal(dd, 'above') + b.renderTodayProposal(dd, 'below'), '');
});

/* ---------- 5. the morning check-in reaches Recovery ---------- */

test('what the athlete said this morning moves the Recovery reading', () => {
  const a = athlete();
  assert.equal(a.coachRecovery().state, 'fresh');
  a.handleSetReadiness('legs', 'heavy');
  let r = a.coachRecovery();
  assert.equal(r.state, 'watch', 'heavy legs this morning and Recovery still reads Fresh');
  assert.equal(r.trainingState, 'fresh', 'the week’s sessions were rewritten by a check-in');
  a.handleSetReadiness('sleep', 'poor');
  assert.equal(a.coachRecovery().state, 'watch', 'heavy legs and poor sleep alone reached Strained');
  a.handleSetReadiness('health', 'under');
  r = a.coachRecovery();
  assert.equal(r.state, 'strained');
  assert.deepEqual(Array.from(r.morning.flags), ['heavy legs', 'poor sleep', 'feeling unwell']);
  /* Feeling unwell weighs more than tired legs: with one other flag it is
     Strained, where two lesser flags together are only Watch. */
  const b = athlete();
  b.handleSetReadiness('health', 'under'); b.handleSetReadiness('legs', 'heavy');
  assert.equal(b.coachRecovery().state, 'strained', 'unwell with heavy legs reads no worse than heavy legs with poor sleep');
});

test('a good morning is recorded as good, not assumed', () => {
  const a = athlete();
  assert.equal(a.coachRecovery().morning.answered, false);
  a.handleSetReadiness('legs', 'fresh'); a.handleSetReadiness('sleep', 'good'); a.handleSetReadiness('health', 'good');
  const r = a.coachRecovery();
  assert.equal(r.morning.answered, true);
  assert.equal(r.state, 'fresh');
  // the Morning tile, under Recovery Signals: three of three answered
  assert.match(text(a.hqPanelHtml('recovery')), /3\/3\s+Morning\s+Feeling good/);
});

test('the Recovery page shows the morning, and without consent the answers are not read', () => {
  const a = athlete();
  assert.match(text(a.hqPanelHtml('recovery')), /Morning\s+Not answered/);
  a.handleSetReadiness('legs', 'heavy');
  assert.match(text(a.hqPanelHtml('recovery')), /1\/3\s+Morning\s+Heavy legs/);
  a.healthConsentGranted = () => false;
  assert.equal(a.coachRecovery().state, 'fresh', 'a readiness answer was read without health consent');
});

test('the check-in is counted once: heavy legs alone is watched and changes nothing', () => {
  /* The interpretation already agreed: "Heavy legs alone shouldn't
     automatically downgrade a workout." The decision engine weighs the
     check-in itself, so it must not also receive it through Recovery. */
  const a = athlete();
  a.handleSetReadiness('legs', 'heavy');
  const dec = a.coachDecision();
  assert.equal(dec.state, 'check');
  assert.equal(dec.reasons.filter(x => /heavy legs/.test(x)).length, 1, 'the same answer appears twice in the reasons');
  assert.equal(a.planEvolution().changes.length, 0, 'heavy legs alone produced a proposal');
  /* Where it would otherwise leak through: one hard-feeling session this
     week is not "strained" on its own. With two bad answers this morning
     Recovery rightly reads Strained -- but the decision engine, which has
     already weighed those answers, must not be told the WEEK was strained
     and add the week's evidence on top. */
  const b = athlete();
  const d = last(b, 1)[0];
  d.actual.rpe = 10;
  b.handleSetReadiness('legs', 'heavy'); b.handleSetReadiness('sleep', 'poor');
  const rec = b.coachRecovery();
  assert.equal(rec.overRPE, 1, 'the fixture has not exactly one over-effort session');
  assert.equal(rec.state, 'strained');
  assert.equal(rec.trainingState, 'watch');
  assert.equal(b.coachDecision().reasons.filter(x => /above target/.test(x)).length, 0,
    'the morning\u2019s answers were counted again as a strained week: ' + b.coachDecision().reasons.join(' | '));
});
