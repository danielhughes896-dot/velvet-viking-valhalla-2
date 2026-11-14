'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* THE USABILITY AUDIT, FIXED.

   Founder, on the audit's findings: "Fix High 1-3, 5 ..." Each fix is a law
   below, so none of them can quietly come undone. */

const TODAY = '2026-05-20';
function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 16, distanceKey: 'half', startDate: a.addDays(TODAY, -42), lthr: 170, maxHR: 190 });
  a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').forEach(d => logAsPrescribed(a, d, {}));
  return a;
}
function unlogYesterday(a){
  const y = a.state.days.find(d => d.date === a.addDays(TODAY, -1));
  y.completed = false; delete y.actual; delete y.stravaActivityId;
  return y;
}

/* ---------- HIGH 1: AN EXPLAINER CLOSED ANY WAY IS SEEN ---------- */
test('closing an explainer by the background or Back records it, like the cross', () => {
  const a = athlete();
  let overlay = { parentNode: { removeChild(){ overlay = null; } }, querySelector: s => (s === '.ci-modal' ? {} : null) };
  a.document.getElementById = id => (id === 'modal-overlay' ? overlay : null);
  a.openInsightKey = 'programme:test';
  a.closeModal();          // what the background tap and Android Back both call
  const l = a.insightLedger();
  assert.ok(l.seen['programme:test'], 'the explainer was not recorded, so it would rise again');
  assert.equal(l.shownOn, TODAY);
  assert.equal(l.dismissed, 1, 'it counts as the cross does');
  assert.equal(a.openInsightKey, null);
});

test('closing any other page records no explainer', () => {
  const a = athlete();
  let overlay = { parentNode: { removeChild(){ overlay = null; } }, querySelector: () => null };
  a.document.getElementById = id => (id === 'modal-overlay' ? overlay : null);
  a.openInsightKey = null;
  a.closeModal();
  assert.deepEqual(Object.keys(a.insightLedger().seen), []);
});

/* ---------- HIGH 3: A MISSED SESSION IS NOT TREATED AS DONE ---------- */
test('Today asks about yesterday when it is not logged, and only then', () => {
  const a = athlete();
  assert.equal(a.renderUnloggedYesterdayCard(), '', 'asked about a session that was logged');
  const y = unlogYesterday(a);
  const card = a.renderUnloggedYesterdayCard();
  assert.match(card, /Yesterday is not logged/);
  assert.match(card, new RegExp(y.title.replace(/[()+]/g, '\\$&')));
  // a row like the check-in, opening a glass sheet with the two answers
  assert.match(card, /class="checkin-row" data-action="unlogged-open" data-day="/);
  const opened = [];
  a.openModal = (html, cls) => opened.push({ html, cls });
  a.openUnloggedSheet(y.id);
  assert.equal(opened.length, 1);
  assert.match(opened[0].cls, /\bstg-sheet\b/);
  assert.match(opened[0].html, /data-action="unlogged-log" data-day="/);
  assert.match(opened[0].html, /data-action="unlogged-ack" data-day="/);
  assert.match(a.renderTodayView(), /Yesterday is not logged/);
});

test('"I didn’t run it" stops the question and writes no training fact', () => {
  const a = athlete();
  const y = unlogYesterday(a);
  const sig = a.planContentSignature(a.state);
  a.handleUnloggedAck(y.id);
  assert.equal(a.renderUnloggedYesterdayCard(), '');
  assert.equal(y.completed, false, 'the session became run');
  assert.equal(a.planContentSignature(a.state), sig, 'the answer moved the plan');
});

test('"Log it" marks the day run and opens its log on This Week', () => {
  const a = athlete();
  const y = unlogYesterday(a);
  a.handleUnloggedLog(y.id);
  assert.equal(a.sessionRan(y), true);
  assert.equal(a.state.view, 'week');
  assert.equal(a.weekSelectedDate, y.date);
  assert.equal(a.logOpenFor[y.id], true);
  assert.equal(a.renderUnloggedYesterdayCard(), '');
});

test('rest days, restricted days and an open restriction are never asked about', () => {
  const a = athlete();
  const y = unlogYesterday(a);
  y.restricted = true;
  assert.equal(a.renderUnloggedYesterdayCard(), '');
  y.restricted = false;
  a.declareRestriction('easy', a.addDays(TODAY, 7));
  assert.equal(a.renderUnloggedYesterdayCard(), '');
});

test('the coaching never names an unlogged session as the reason for today', () => {
  const a = athlete();
  const today = a.state.days.find(d => d.date === TODAY);
  const y = a.state.days.find(d => d.date === a.addDays(TODAY, -1));
  assert.ok(a.coachingIsQuality(y), 'fixture: yesterday is a quality session');
  assert.equal(a.coachingContextFor(today).role, 'after_quality');
  unlogYesterday(a);
  assert.notEqual(a.coachingContextFor(today).role, 'after_quality',
    'Today still says "hard work yesterday" for a session that did not happen');
  // a day still to come keeps the planned reading
  const later = a.state.days.find(d => d.date > TODAY && d.type === 'easy' &&
    a.coachingIsQuality(a.state.days.find(p => p.date === a.addDays(d.date, -1)) || {}));
  if (later) assert.equal(a.coachingContextFor(later).role, 'after_quality');
});

/* ---------- THE NOTE SAYS WHAT TO DO; THE WHY SAYS WHY ----------
   Founder, option B: "Coach's Note: What the athlete should do today. Why
   This Session: Why the workout belongs in the training programme. Keep
   both sections." */
test('the note’s role lines say how to run today and never restate the reason', () => {
  const a = athlete();
  const roles = a.COACHING_SOLO_SUB.easy.role;
  Object.keys(roles).forEach(r => roles[r].forEach(line => {
    assert.doesNotMatch(line, /yesterday|tomorrow|long run|hard one|hard session|biggest/i,
      r + ': "' + line + '" restates why, which is the Why’s job');
  }));
  // both sections still render on the day after a hard session
  const today = a.state.days.find(d => d.date === TODAY);
  assert.equal(a.coachingContextFor(today).role, 'after_quality');
  const card = a.renderDayCard(today);
  assert.match(card, /class="why-session"/, 'WHY THIS SESSION went');
  assert.ok(roles.after_quality.some(l => card.indexOf(l.replace(/'/g, '&#39;')) > -1), 'the note line went');
});

/* ---------- ICONS COMMUNICATE A FUNCTION ----------
   Founder: "Build My Plan: Remove the target. Sign-in: Remove the link
   icon. Tell SACORO: Remove the tick. Back, Close, Edit, Share and
   navigation: Keep their icons." */
test('Build My Plan, the sign-in link and Tell SACORO carry words only', () => {
  const fs = require('node:fs'), path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', require('./harness.js').RUNTIME_RELATIVE), 'utf8');
  assert.doesNotMatch(src, /ICONS\.target\+' Build My Plan/);
  assert.doesNotMatch(src, /ICONS\.link\+' Email me a sign-in link/);
  assert.doesNotMatch(src, /data-action="restriction-confirm">'\+ICONS\./);
  // the functional ones stay
  assert.match(src, /data-action="plan-back" aria-label="Back">'\+\s*\n?\s*ICONS\.chevronRight/);
  assert.match(src, /data-action="close-record-panel" aria-label="Close">'\+ICONS\.close/);
  assert.match(src, /\{key:'planhq', label:'Coach', icon:ICONS\.target\}/, 'the navigation lost its icon');
});
