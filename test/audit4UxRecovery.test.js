'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* AUDIT IV: THE USER EXPERIENCE AND RECOVERY CHECK FINDINGS.
   Founder: "tackle the UX and Recovery Check findings first". Each check
   below failed on the audited build (f7bcb3d). */

const NOW = '2026-11-17';
function athlete(o){
  const opts = o || {};
  const now = opts.now || NOW;
  const a = loadApp({ pinnedDate: now + 'T08:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: 'half', volume: 40, weeks: 12, experience: 'experienced', startDate: '2026-10-26',
                 healthConsent: true, lthr: 170, maxHR: 190 });
  a.state.days.filter(d => d.date < now && d.km > 0).forEach(d => logAsPrescribed(a, d, { sections: true }));
  a.__opened = [];
  a.openModal = (html, cls) => { a.__opened.push({ html, cls }); };
  a.closeModal = () => { a.__opened.push({ closed: true }); };
  return a;
}
const relog = (a, d) => { delete d.coachReview; a.coachPersistReview(d); };
const plain = x => JSON.parse(JSON.stringify(x));

test('A2 (coaching): the same runs never raise the Recovery Check twice, whatever the week number', () => {
  const a = athlete();
  /* Two runs harder than set: Watch on two signals, a sheet. */
  const hard = a.state.days.filter(d => d.completed && d.date >= '2026-11-11' && d.km > 0).slice(-2);
  hard.forEach(d => { d.actual.rpe = a.expectedRPEBand(d)[1] + 2; relog(a, d); });
  const rc = a.recoveryCheckDue();
  assert.ok(rc, 'two hard runs raised nothing');
  assert.equal(rc.kind, 'reading');
  assert.ok(rc.keys.some(k => /^run:rpe:/.test(k)), 'the sheet is not keyed on the runs behind it');
  a.openRecoveryCheck(rc);
  /* The plan's week number moves on (a Monday), and the same two runs are
     still the evidence: nothing new to say. */
  const realWeek = a.currentWeekNum;
  a.currentWeekNum = () => realWeek() + 1;
  assert.equal(a.recoveryCheckDue(), null, 'the same runs raised it again in a new week');
  a.currentWeekNum = realWeek;
  /* A third hard run is new evidence. */
  const third = a.state.days.filter(d => d.completed && d.date >= '2026-11-11' && d.km > 0 && hard.indexOf(d) === -1).slice(-1)[0];
  third.actual.rpe = a.expectedRPEBand(third)[1] + 2; relog(a, third);
  assert.ok(a.recoveryCheckDue(), 'a new hard run raised nothing');
});

test('A3 (coaching): one signal reads Watch on the Coach page but raises no sheet', () => {
  const a = athlete();
  const one = a.state.days.filter(d => d.completed && d.date >= '2026-11-11' && d.km > 0).slice(-1)[0];
  one.actual.rpe = a.expectedRPEBand(one)[1] + 2; relog(a, one);
  const rec = a.coachRecovery();
  assert.equal(rec.trainingState, 'watch', 'the fixture did not reach Watch');
  assert.equal(rec.strainPoints, 1);
  assert.equal(a.recoveryCheckReadingFlag(rec), null, 'one run above its band still raised a sheet');
  assert.equal(a.recoveryCheckDue(), null);
});

test('UX-R1: the reason sheet waits for an open page, then rises once it has gone', () => {
  const a = loadApp({ pinnedDate: NOW + 'T08:00:00Z' });
  const appended = [];
  const overlay = { id: 'modal-overlay' };
  let open = overlay;
  a.document.getElementById = id => (id === 'modal-overlay' ? open : null);
  a.document.body.appendChild = el => appended.push(el);
  const asked = { code: 'protect_declined', week: 4, wait: Promise.resolve() };
  assert.equal(a.coachMemoryOfferReason(asked), true);
  assert.equal(appended.length, 0, 'the reason sheet rose over an open page');
  assert.equal(a.coachMemoryReasonQueued, asked);
  /* And the closing page hands it on. */
  assert.match(a.closeModal.toString(), /if \(coachMemoryReasonQueued && !modalSwapping\)/);
  open = null;
  assert.equal(a.coachMemoryOfferReason(asked), true);
  assert.equal(appended.length, 1);
  assert.equal(a.coachMemoryReasonQueued, null);
});

test('UX-R1: a weekly protect answer is not followed by a Recovery Check on the same evidence', () => {
  const a = athlete();
  a.findDayByDate(NOW).readiness = { legs: 'heavy', sleep: 'poor', health: 'under' };
  assert.ok(a.recoveryCheckDue(), 'the check-in flagged nothing');
  a.recoveryCheckMarkAnswered();
  assert.equal(a.recoveryCheckDue(), null, 'answered on the weekly sheet, then asked again');
  assert.match(a.handleWeeklyAnswer.toString(), /p\.rv\.kind === 'protect' \|\| p\.rv\.kind === 'recovery'\)\)\{ try \{ recoveryCheckMarkAnswered\(\);/);
});

test('UX-A1: every way out of Session Complete is its OK, so Week Complete still follows', () => {
  const a = athlete();
  const html = a.sessionResultHtml(a.state.days.find(d => d.completed));
  assert.match(html, /<div class="modal-head"><h2 class="font-head">Session Complete<\/h2><button type="button" class="icon-btn" data-action="result-ok" data-day="[^"]+" aria-label="Close">/);
  assert.match(a.weekResultHtml(2), /Complete<\/h2><button type="button" class="icon-btn" data-action="result-ok" aria-label="Close">/);
  const oks = [];
  a.handleResultOk = id => oks.push(id);
  const ok = { getAttribute: n => (n === 'data-day' ? 'd9' : null) };
  a.document.getElementById = id => (id === 'modal-overlay' ? { querySelector: s => (s === '.rs-sheet .rs-ok' ? ok : null) } : null);
  a.dismissModal();
  assert.deepEqual(oks, ['d9'], 'a tap on the ground closed Session Complete without its OK');
  const src = a.openModal.toString === undefined ? '' : require('fs').readFileSync(require('path').join(__dirname, '..', require('./harness.js').RUNTIME_RELATIVE), 'utf8');
  assert.match(src, /overlay\.addEventListener\('mousedown', function\(e\)\{ if \(e\.target===overlay\) dismissModal\(\); \}\);/);
  assert.match(src, /case 'close-modal': vtCloseBack\(function\(\)\{ if \(!stgCloseSub\(\)\) dismissModal\(\); \}\); break;/);
});

test('UX-A2: no threshold test offer on a morning the check-in flagged', () => {
  const a = athlete();
  a.findDayByDate(NOW).readiness = { legs: 'heavy', sleep: 'poor', health: 'good' };
  assert.equal(a.thresholdTestNotToday(), true);
  a.findDayByDate(NOW).readiness = { legs: 'fresh', sleep: 'good', health: 'good' };
  a.recoveryCheckDue = () => null;
  assert.equal(a.thresholdTestNotToday(), false);
});

test('UX-A3: Back closes the top glass sheet before anything else', () => {
  const a = loadApp({ pinnedDate: NOW + 'T08:00:00Z' });
  const did = [];
  a.answerAskSacoro = y => did.push('ask:' + y);
  a.closeWeeklyReviewSheet = () => did.push('weekly');
  a.document.querySelector = () => null;
  a.document.querySelectorAll = sel => (sel === '.tw-layer' ? [{ id: 'weekly-sheet' }, { id: 'ask-sheet' }] : []);
  assert.equal(a.closeTopGlassSheet(), true);
  assert.deepEqual(did, ['ask:false'], 'Back closed the wrong sheet');
  a.document.querySelectorAll = () => [];
  assert.equal(a.closeTopGlassSheet(), false);
});

test('UX-A5: a goal inside the range is drawn inside the band', () => {
  const a = athlete();
  a.raceOutlook = () => ({ state: 'estimated', fastSec: 5760, slowSec: 6180, goalSec: 6000,
    profile: { label: 'Half Marathon' } });
  a.state.setup.activeGoal = 'A';
  const html = a.renderRaceOutlook();
  const band = /class="oi-band" style="left:([\d.]+)%; width:([\d.]+)%"/.exec(html);
  const goal = /class="oi-goal" style="left:([\d.]+)%"/.exec(html);
  const l = +band[1], r = +band[1] + +band[2], g = +goal[1];
  assert.ok(g > l && g < r, 'the goal dot (' + g + ') sits outside the band (' + l + ' to ' + r + ')');
  assert.match(html, /sits inside the range/);
});

test('UX-A9: signed out, Ask Coach asks for the email before the question', () => {
  const a = loadApp({ pinnedDate: NOW + 'T08:00:00Z' });
  a.voiceCoachAvailable = true;
  a.cloudSignedIn = () => false;
  const opened = [];
  a.openModal = h => opened.push(h);
  a.handleVoiceAskOpen();
  assert.match(opened[0] || '', /Sign In to Ask Your Coach/);
  assert.match(opened[0], /data-action="cloud-sign-in">Email Me a Sign-In Link</);
  assert.equal(a.askState.status, 'closed', 'the panel opened to take a question it cannot answer');
});

test('UX-A12: a browser voice that never starts shows the words', () => {
  const a = loadApp({ pinnedDate: NOW + 'T08:00:00Z' });
  const timers = [];
  a.setTimeout = fn => { timers.push(fn); return 1; };
  const statuses = [];
  const real = a.voiceSetStatus;
  a.voiceSetStatus = (s, x) => { statuses.push(s); real(s, x); };
  a.voiceNativeTts = () => null;
  a.voiceSynth = () => ({ cancel(){}, speak(){}, getVoices: () => [] });
  a.window.SpeechSynthesisUtterance = function(t){ this.text = t; };
  assert.equal(a.voiceSpeakNative('Easy run today.', {}), true);
  timers.forEach(f => f());
  assert.equal(statuses[statuses.length - 1], 'unavailable', 'nothing was ever said and nothing was shown');
});
