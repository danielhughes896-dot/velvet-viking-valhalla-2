'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');
const X = require('../api/_voice-explain.js');

/* RECOVERY CHECK. Founder, Phase 3 of the approved plan: "recovery, only
   when flagged". A glass sheet rises for a flagged check-in, a Recovery
   reading of Watch or Strained, pain or illness on a recent log, or easy
   runs running hot -- once per flag, never over another sheet, and after
   Session Complete and Week Complete. The engine decides; the sheet only
   says it, and its buttons are the engine's existing actions. */

/* 17 November 2026 is a Tuesday with an easy run; 10 November a Tuesday
   with a tempo, which is where the engine has a change to offer. */
const NOW = '2026-11-17';
function athlete(o){
  const opts = o || {};
  const now = opts.now || NOW;
  const a = loadApp({ pinnedDate: now + 'T08:00:00Z', fetch: opts.fetch });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: 'half', volume: 40, weeks: 12, experience: 'experienced', startDate: '2026-10-26',
                 healthConsent: opts.healthConsent !== false, lthr: 170, maxHR: 190 });
  a.state.days.filter(d => d.date < now && d.km > 0).forEach(d => logAsPrescribed(a, d, { sections: true }));
  a.__opened = [];
  a.openModal = (html, cls) => { a.__opened.push({ html, cls }); };
  a.closeModal = () => { a.__opened.push({ closed: true }); };
  return a;
}
const today = (a, now) => a.findDayByDate(now || NOW);
const relog = (a, d) => { delete d.coachReview; a.coachPersistReview(d); };
function checkin(a, r, now){ today(a, now).readiness = Object.assign({ legs: 'normal', sleep: 'ok', health: 'good' }, r); }
function hotEasyRuns(a){
  a.state.days.filter(d => d.type === 'easy' && d.completed && d.date >= '2026-11-11' && d.date < NOW)
    .forEach(d => { d.actual.hr = a.executionHRTarget(d).hi + 6; });
}
function painOnLongRun(a){
  const lr = a.state.days.find(d => d.date === '2026-11-15');
  Object.assign(lr.actual, { hurting: 'pain', stopReason: 'injury', km: 9, notes: 'left calf really sore after the turn' });
  relog(a, lr);
  return lr;
}
/* Values from the app's realm compared as plain data. */
const plain = x => JSON.parse(JSON.stringify(x));
const sheets = a => a.__opened.filter(o => o.html && /Recovery Check/.test(o.html));

test('a clean week and a good morning raise nothing', () => {
  const a = athlete();
  checkin(a, { legs: 'fresh', sleep: 'good', health: 'good' });
  assert.equal(a.coachRecovery().trainingState, 'fresh');
  assert.deepEqual(plain(a.recoveryCheckFlags()), []);
  assert.equal(a.recoveryCheckDue(), null);
  assert.equal(a.maybeOpenRecoveryCheck('result'), false);
  assert.equal(sheets(a).length, 0);
});

test('each trigger raises it: the check-in, the Recovery reading, pain or illness, easy runs running hot', () => {
  const c = athlete();
  checkin(c, { legs: 'heavy', sleep: 'poor' });
  const rc = c.recoveryCheckDue();
  assert.equal(rc.kind, 'checkin');
  assert.deepEqual(plain(rc.rows.map(r => r.slice(0, 2))), [['Legs', 'Heavy'], ['Sleep', 'Poor']]);
  assert.equal(rc.kick, 'Tuesday 17 November');

  const r = athlete();
  r.state.days.filter(d => d.completed && d.date >= '2026-11-11' && d.km > 0).forEach(d => { d.actual.rpe = 9; relog(r, d); });
  const rr = r.recoveryCheckDue();
  assert.equal(rr.kind, 'reading');
  assert.equal(rr.tone.label, 'Recovery First');
  assert.deepEqual(plain(rr.rows[0]), ['Recovery', 'Strained']);

  const p = athlete();
  painOnLongRun(p);
  const rp = p.recoveryCheckDue();
  assert.equal(rp.kind, 'pain');
  assert.equal(rp.tone.label, 'Rest and Get It Checked');
  assert.equal(rp.tone.cls, 'rs-tone-red');
  assert.match(rp.kick, /^From your log of Sunday’s long run$/);
  assert.deepEqual(plain(rp.rows), [['You noted', 'Injury or soreness'], ['Session', 'Stopped at 9 of 13km']]);
  /* Illness stopped a run too, and so does a run cut short for it. */
  const i = athlete();
  const ir = i.state.days.find(d => d.date === '2026-11-15');
  Object.assign(ir.actual, { stopReason: 'illness', km: 6 }); relog(i, ir);
  assert.equal(i.recoveryCheckDue().kind, 'pain');
  assert.equal(i.sessionCutShortFor(ir), 'illness');

  const h = athlete();
  hotEasyRuns(h);
  const rh = h.recoveryCheckDue();
  assert.equal(rh.kind, 'hr');
  assert.equal(rh.tone.label, 'Running Hotter Than Usual');
  assert.deepEqual(plain(rh.rows.slice(0, 2).map(x => x.slice(0, 2))), [['Easy runs, last 7 days', '2'], ['Heart rate above easy zone', '2 of 2']]);
  assert.match(rh.kick, /^After Saturday’s easy run$/);
});

test('heart rate counts only with health consent, and so does everything the body reported', () => {
  const b = athlete({ healthConsent: false });
  b.state.days.filter(d => d.type === 'easy' && d.completed).forEach(d => { d.actual.hr = 199; });
  checkin(b, { legs: 'heavy', sleep: 'poor', health: 'under' });
  const lr = b.state.days.find(d => d.date === '2026-11-15');
  Object.assign(lr.actual, { hurting: 'pain', stopReason: 'injury', km: 9 });
  assert.equal(b.executionHRTarget(lr), null);
  assert.deepEqual(plain(b.recoveryCheckFlags()), [], 'a flag was raised from health data given without consent');
  /* One hot easy run is a run, not a pattern. */
  const one = athlete();
  const e = one.state.days.find(d => d.type === 'easy' && d.completed && d.date === '2026-11-14');
  e.actual.hr = one.executionHRTarget(e).hi + 6;
  assert.equal(one.recoveryCheckHrFlag(), null);
});

test('each flag is shown once; new evidence is a new flag', () => {
  const a = athlete();
  checkin(a, { legs: 'heavy' });
  assert.equal(a.maybeOpenRecoveryCheck('result'), true);
  assert.equal(sheets(a).length, 1);
  assert.equal(a.recoveryCheckDue(), null, 'the same check-in raised it twice');
  assert.equal(a.maybeOpenRecoveryCheck('result'), false);
  /* Kept with the plan, so another device does not raise it again. */
  const twin = loadApp({ pinnedDate: NOW + 'T08:00:00Z' });
  twin.state = JSON.parse(JSON.stringify(a.state));
  assert.equal(twin.recoveryCheckDue(), null);
  /* Poor sleep as well is a different morning. */
  checkin(a, { legs: 'heavy', sleep: 'poor' });
  assert.equal(a.recoveryCheckDue().key, 'checkin:2026-11-17:heavy,poor');
});

test('after Session Complete and Week Complete, never over another sheet, the builder or the arrival', () => {
  const a = athlete({ now: '2026-11-16' });
  const lr = a.state.days.find(d => d.date === '2026-11-15');
  Object.assign(lr.actual, { hurting: 'pain', stopReason: 'injury', km: 9 }); relog(a, lr);
  assert.ok(a.recoveryCheckDue(), 'the pain log did not flag');
  let overlay = null;
  a.document.getElementById = id => (id === 'modal-overlay' ? overlay : null);
  const sheetOf = cls => ({ querySelector: sel => (sel === cls ? {} : null) });
  /* Session Complete is up: the app raising sheets itself waits. */
  assert.equal(a.maybeOpenSessionResult(lr), true);
  overlay = sheetOf('.rs-sheet');
  assert.equal(a.maybeOpenRecoveryCheck('auto'), false);
  assert.equal(a.maybeOpenRecoveryCheck('log'), false);
  /* OK on Session Complete opens Week Complete (the last run of its week);
     OK on Week Complete opens the Recovery Check on the same slide. */
  a.handleResultOk(lr.id);
  a.handleResultOk(null);
  const titles = a.__opened.filter(o => o.html).map(o => /<h2[^>]*>([^<]*)</.exec(o.html)[1]);
  assert.deepEqual(plain(titles), ['Session Complete', 'Week ' + lr.week + ' Complete', 'Recovery Check']);
  assert.ok(!a.__opened.some(o => o.closed), 'Week Complete closed instead of handing on');
  /* Never over anything else, on any route. */
  const b = athlete();
  checkin(b, { legs: 'heavy', sleep: 'poor' });
  b.document.getElementById = id => (id === 'modal-overlay' ? sheetOf('.bld-modal') : null);
  ['auto', 'result', 'log', 'checkin'].forEach(w => assert.equal(b.maybeOpenRecoveryCheck(w), false, w));
  b.document.getElementById = id => (id === 'weekly-sheet' ? {} : null);
  assert.equal(b.maybeOpenRecoveryCheck('result'), false);
  b.document.getElementById = () => null;
  const arrive = b.shouldShowProgrammeEntry;
  b.shouldShowProgrammeEntry = () => true;
  assert.equal(b.maybeOpenRecoveryCheck('result'), false, 'it rose over the arrival');
  b.shouldShowProgrammeEntry = arrive;
  /* An injury already declared: the athlete has said, nothing rises. */
  b.state.setup.restriction = { level: 'easy', from: NOW, until: '2026-11-30' };
  assert.equal(b.maybeOpenRecoveryCheck('result'), false);
  delete b.state.setup.restriction;
  assert.equal(b.maybeOpenRecoveryCheck('result'), true);
  /* Raised by the app itself only on Today, never on the arrival, and after
     the morning check-in has had its turn, as the weekly sheet is. */
  const c = athlete();
  hotEasyRuns(c);
  c.state.view = 'today';
  c.maybeRaiseRecoveryCheck(false);
  assert.equal(sheets(c).length, 0, 'it rose before the check-in had its turn');
  c.checkinSheetRaised[NOW] = true;
  c.maybeRaiseRecoveryCheck(true);
  c.state.view = 'plan';
  c.maybeRaiseRecoveryCheck(false);
  assert.equal(sheets(c).length, 0);
  c.state.view = 'today';
  c.maybeRaiseRecoveryCheck(false);
  assert.equal(sheets(c).length, 1);
});

test('the check-in hands on to it as it closes, unless it was changed from Recovery', () => {
  const real = loadApp({ pinnedDate: NOW + 'T08:00:00Z' });
  const src = real.closeModal.toString();
  assert.match(src, /else if \(wasCheckin && !modalSwapping\)\s*setTimeout\(function\(\)\{ try \{ maybeOpenRecoveryCheck\('checkin'\);/);
  const a = athlete();
  checkin(a, { legs: 'heavy', sleep: 'poor' });
  /* Closing the check-in with nothing flagged by it raises nothing, even
     with something else due. */
  const r = athlete();
  hotEasyRuns(r);
  checkin(r, { legs: 'fresh', sleep: 'good' });
  assert.equal(r.maybeOpenRecoveryCheck('checkin'), false);
  assert.equal(a.maybeOpenRecoveryCheck('checkin'), true);
  /* Through the real closeModal: the timer it sets opens the sheet, and a
     check-in opened from Recovery goes back to Recovery instead. */
  const b = loadApp({ pinnedDate: NOW + 'T08:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { b[f] = () => {}; });
  buildPlan(b, { distanceKey: 'half', volume: 40, weeks: 12, experience: 'experienced', startDate: '2026-10-26', lthr: 170, maxHR: 190 });
  b.state.days.filter(d => d.date < NOW && d.km > 0).forEach(d => logAsPrescribed(b, d, { sections: true }));
  checkin(b, { legs: 'heavy', sleep: 'poor' });
  const timers = [], opened = [], panels = [];
  b.setTimeout = fn => { timers.push(fn); return timers.length; };
  b.openModal = (html) => opened.push(html);
  b.openHQPanel = k => panels.push(k);
  const sheet = () => { let ov = { querySelector: sel => (sel === '.checkin-sheet' ? {} : null), parentNode: null };
    ov.parentNode = { removeChild(){ ov = null; } }; b.document.getElementById = id => (id === 'modal-overlay' ? ov : null); };
  b.checkinReturnToRecovery = true;
  sheet(); b.closeModal(); timers.splice(0).forEach(f => f());
  assert.deepEqual(plain(panels), ['recovery']);
  assert.equal(opened.length, 0, 'a check-in changed from Recovery raised the sheet instead of returning');
  sheet(); b.closeModal(); timers.splice(0).forEach(f => f());
  assert.equal(opened.length, 1);
  assert.match(opened[0], /Recovery Check/);
});

test('pain or illness carries the boundary line; nothing else does', () => {
  const p = athlete();
  painOnLongRun(p);
  const html = p.recoveryCheckHtml(p.recoveryCheckDue());
  assert.ok(html.indexOf(p.escapeHtml(p.RECOVERY_CHECK_BOUNDARY)) !== -1);
  assert.equal(p.RECOVERY_CHECK_BOUNDARY, 'I’m a running coach, not a doctor, and I can’t judge symptoms. If something hurts, get it looked at properly, and see someone sooner if it is sharp, swelling or getting worse.');
  const c = athlete();
  checkin(c, { legs: 'heavy', sleep: 'poor' });
  assert.doesNotMatch(c.recoveryCheckHtml(c.recoveryCheckDue()), /rck-safe/);
  /* Under the weather is illness, and says so. */
  checkin(c, { health: 'under' });
  assert.match(c.recoveryCheckHtml(c.recoveryCheckDue()), /rck-safe/);
});

test('the Suggested box only with the engine’s own offer, and it is the change Accept applies', () => {
  /* No offer: the next session is an easy run and nothing asks for a cut. */
  const c = athlete();
  checkin(c, { legs: 'heavy', sleep: 'poor' });
  const noOffer = c.recoveryCheckDue();
  assert.equal(noOffer.offer, null);
  const ph = c.recoveryCheckHtml(noOffer);
  assert.doesNotMatch(ph, /rck-swap/);
  assert.equal((ph.match(/<button type="button" class="btn /g) || []).length, 1);
  /* And the round X every sheet has, which closes it (Audit IV UX-A1). */
  assert.match(ph, /<div class="modal-head"><h2 class="font-head">Recovery Check<\/h2><button type="button" class="icon-btn" data-action="recovery-check-ok" aria-label="Close">/);
  assert.match(ph, /data-action="recovery-check-ok">Got It</);
  assert.equal(noOffer.tone.label, 'Worth Watching', 'the label promised a change the engine did not offer');
  /* Pain with nothing on offer: the page the app already has for it. */
  const p = athlete();
  painOnLongRun(p);
  const pp = p.recoveryCheckHtml(p.recoveryCheckDue());
  assert.match(pp, /data-action="recovery-check-injury">Injured or Ill\?</);
  assert.match(pp, /data-action="recovery-check-ok">I’m Fine, Keep the Plan</);
  /* A tempo today, two runs harder than set and a heavy morning: the engine
     cuts it, and the sheet shows that cut and nothing else. */
  const o = athlete({ now: '2026-11-10' });
  o.state.days.filter(d => d.completed && d.date >= '2026-11-04' && d.km > 0).slice(-2)
    .forEach(d => { d.actual.rpe = o.expectedRPEBand(d)[1] + 2; relog(o, d); });
  checkin(o, { legs: 'heavy', sleep: 'poor' }, '2026-11-10');
  const rc = o.recoveryCheckDue();
  const tempo = today(o, '2026-11-10');
  const adj = o.coachAcceptAdjustment(o.coachAnalyse(), tempo.id);
  assert.ok(adj, 'the engine offers nothing in the offer scenario');
  assert.equal(rc.offer.dayId, tempo.id);
  assert.equal(rc.offer.to, 'Tempo ' + o.fmtDist(adj.km));
  assert.equal(rc.offer.from, 'Tempo ' + o.fmtDist(tempo.km));
  assert.equal(rc.tone.label, 'Ease Off Today');
  assert.deepEqual(plain(rc.rows.find(r => r[0] === 'Last 7 days').slice(0, 2)), ['Last 7 days', '2 runs harder than set']);
  const html = o.recoveryCheckHtml(rc);
  assert.match(html, /rck-swap-was">Tempo 6\.5km</);
  assert.match(html, new RegExp('data-action="recovery-check-accept" data-day="' + tempo.id + '">Run ' + o.fmtDist(adj.km) + ' Instead<'));
  assert.match(html, new RegExp('data-action="recovery-check-keep" data-day="' + tempo.id + '">Keep the Plan<'));
  /* Accepting through the sheet is Accept Adjustment: the day becomes
     exactly what the box said. */
  o.vtAccept = (id, apply) => apply();
  o.handleRecoveryCheckAccept(tempo.id);
  assert.equal(tempo.km, adj.km);
  assert.ok(tempo.coachAdjust, 'the change was not recorded as the coach’s, restorable');
  /* Once accepted there is nothing left to offer. */
  assert.equal(o.recoveryCheckOffer(), null);
});

test('the buttons are the existing engine actions, through the one door', () => {
  const a = athlete();
  const fire = a.document._listeners.click[0];
  const click = (action, attrs) => {
    const at = Object.assign({ 'data-action': action }, attrs || {});
    const node = { getAttribute: n => (n in at ? at[n] : null), closest(sel){ return sel === 'details' ? null : this; },
      classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } }, setAttribute(){}, removeAttribute(){}, focus(){}, blur(){}, dataset: {} };
    fire.call(a.document, { target: node, currentTarget: node, preventDefault(){}, stopPropagation(){} });
  };
  const seen = [];
  a.closeModal = () => seen.push('close');
  a.vtAccept = (id, apply) => { seen.push('vtAccept:' + id); apply(); };
  a.handleCoachAccept = id => seen.push('accept:' + id);
  a.handleCoachKeep = id => seen.push('keep:' + id);
  a.openRestrictionModal = () => seen.push('injury');
  click('recovery-check-accept', { 'data-day': 'd1' });
  click('recovery-check-keep', { 'data-day': 'd1' });
  click('recovery-check-injury');
  click('recovery-check-ok');
  assert.deepEqual(seen, ['close', 'vtAccept:d1', 'accept:d1', 'close', 'keep:d1', 'injury', 'close']);
});

test('the packet: trigger, reasons, verdict and offer; never the notes, never Strava', () => {
  const p = athlete();
  painOnLongRun(p);
  const rc = p.recoveryCheckDue();
  const ev = p.resultSayEvidence('recovery', rc);
  assert.deepEqual(plain(Object.keys(ev)), ['kind', 'units', 'trigger', 'about', 'reasons', 'verdict', 'suggestion', 'healthInformation']);
  assert.equal(ev.kind, 'recovery');
  assert.equal(ev.trigger, 'pain');
  assert.equal(ev.verdict.line, rc.line);
  assert.equal(ev.suggestion, null);
  assert.ok(JSON.stringify(ev).indexOf('calf') === -1, 'free-text notes reached the packet');
  /* Heart rate rows only with consent. */
  const h = athlete();
  hotEasyRuns(h);
  const hrc = h.recoveryCheckDue();
  assert.match(JSON.stringify(h.resultSayEvidence('recovery', hrc)), /Heart rate above easy zone/);
  h.state.healthConsent = null;
  assert.doesNotMatch(JSON.stringify(h.recoveryCheckEvidence(hrc)), /Heart rate|Easy runs/);
  assert.equal(h.recoveryCheckEvidence(hrc).healthInformation, 'withheld');
  /* Any Strava-derived day anywhere in the record: no packet at all. */
  p.state.days.find(d => d.completed).stravaActivityId = 123;
  assert.equal(p.resultSayEvidence('recovery', rc), null);
});

test('the coach’s words: asked once, checked, kept with the flag; the engine’s sentence otherwise', async () => {
  const calls = [];
  const a = athlete({ fetch: (url, init) => { calls.push({ url: String(url), init });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ text: a.__reply }) }); } });
  a.cloudSession = { access_token: 'tok', user_id: 'u1', email: 'a@b.c', expires_at: Date.parse('2031-01-01') };
  a.voiceCoachAvailable = true;
  checkin(a, { legs: 'heavy', sleep: 'poor' });
  const rc = a.recoveryCheckDue();
  /* The engine's words first. */
  assert.match(a.recoveryCheckHtml(rc), /class="rck-say"[^>]*>You reported heavy legs and poor sleep this morning\./);
  a.__reply = 'Great work getting up today, heavy legs and poor sleep happen.';
  assert.equal(await a.resultSayFetch('recovery', rc), null, 'praise got through');
  const b = athlete({ fetch: (url, init) => { calls.push({ url: String(url), init });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ text: b.__reply }) }); } });
  b.cloudSession = a.cloudSession; b.voiceCoachAvailable = true;
  checkin(b, { legs: 'heavy', sleep: 'poor' });
  const rb = b.recoveryCheckDue();
  b.__reply = 'Heavy legs after a short night is your body asking for a lighter touch, so let recovery catch up before anything hard.';
  assert.equal(await b.resultSayFetch('recovery', rb), b.__reply);
  const asks = calls.filter(c => c.url === '/api/voice-explain');
  const body = JSON.parse(asks[asks.length - 1].init.body);
  assert.equal(body.kind, 'recovery');
  assert.equal(body.evidence.trigger, 'checkin');
  assert.equal(b.state.recoveryChecks[rb.key].say.text, b.__reply);
  assert.match(b.recoveryCheckHtml(rb), /lighter touch/);
  assert.equal(b.resultSayFetch('recovery', rb), null, 'asked twice');
});

const REC_EV = { kind: 'recovery', units: 'km', trigger: 'checkin', about: null,
  reasons: [{ label: 'Legs', value: 'Heavy' }, { label: 'Sleep', value: 'Poor' }, { label: 'Last 7 days', value: '2 runs harder than set' }],
  verdict: { tone: 'caution', label: 'Ease Off Today',
    line: 'You reported heavy legs and poor sleep this morning, after 2 runs harder than set this week. Easing off lets your recovery catch up.' },
  suggestion: { change: 'shorten', day: 'today', from: 'Tempo 6.5km', to: 'Tempo 5km' }, healthInformation: 'included' };
const OK = 'Heavy legs and a poor night on top of two hard runs is a body asking for a lighter day, so shorten today’s tempo to 5km and let recovery catch up.';

test('the checker: recovery words, no praise, nothing medical, no invented numbers, two sentences', () => {
  assert.equal(X.validateExplain(OK, REC_EV).ok, true, X.validateExplain(OK, REC_EV).why);
  const cases = [
    ['Brilliant honesty this morning: heavy legs and a poor night mean today should be a lighter day for recovery.', 'praise_against_verdict'],
    ['Heavy legs and a poor night suggest a cold coming on, so keep today lighter and let recovery catch up.', 'medical'],
    ['Heavy legs and poor sleep this morning, so book in with a physio and let recovery catch up on the tempo.', 'medical'],
    ['Heavy legs after 3 hard runs is a lot, so shorten today’s tempo to 5km and let recovery catch up.', 'invented_number'],
    ['Heavy legs and a poor night on top of two hard runs, so run today’s tempo as planned and see how it goes.', 'softens_recovery'],
    ['Heavy legs and poor sleep this morning. Two runs were hard this week. Shorten the tempo so recovery can catch up.', 'too_many_sentences'],
    ['Heavy legs and a poor night on top of two hard runs is a lot, so let recovery catch up today!', 'exclamation'],
    ['Heavy legs and a poor night on top of two hard runs, so skip today’s tempo and rest instead of running it.', 'changes_prescription'],
    ['You reported heavy legs and poor sleep this morning, after 2 runs harder than set this week. Easing off lets your recovery catch up.', 'copied_engine']
  ];
  for (const [text, why] of cases) assert.equal(X.validateExplain(text, REC_EV).why, why, text);
  /* The same answer on this side of the wire. */
  const a = athlete();
  for (const [text] of cases.concat([[OK]])) {
    const s = X.validateExplain(text, REC_EV), c = a.resultSayValid(text, REC_EV);
    assert.equal(c.ok, s.ok, text);
    assert.equal(c.why, s.why, text);
  }
  assert.match(X.SYSTEM.recovery, /At most TWO sentences and 45 words/);
  assert.ok(X.KINDS.includes('recovery'));
});

test('the sheet: glass, Title Case, no em dashes, and its words in white', () => {
  const a = athlete();
  checkin(a, { legs: 'heavy', sleep: 'poor' });
  a.maybeOpenRecoveryCheck('result');
  const s = sheets(a)[0];
  assert.match(s.cls, /^modal-themed stg-sheet rck-sheet$/);
  assert.doesNotMatch(s.html, /—/);
  const p = athlete();
  painOnLongRun(p);
  const ph = p.recoveryCheckHtml(p.recoveryCheckDue());
  assert.doesNotMatch(ph + p.recoveryCheckDue().line, /—/);
  for (const m of ph.matchAll(/<button[^>]*>([^<]+)</g))
    m[1].split(' ').filter(w => !/^(the|of|and|or)$/.test(w))
      .forEach(w => assert.match(w, /^[A-Z0-9]/, 'not Title Case: ' + m[1]));
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  assert.equal((css.match(/<style\b/g) || []).length, 1);
  assert.match(css, /\.rck-say\{[^}]*color:#FFFFFF/);
  assert.match(css, /\.rck-why-row\{[^}]*color:#FFFFFF/);
  /* Above the last rule in its area, which must stay last. */
  assert.ok(css.indexOf('.rck-safe{') < css.indexOf('  .coach-why-btn,\n  .v-hero-fig span,'));
});

test('the route takes a Recovery Check through the same door, and refuses a Strava marker', async () => {
  const V = require('../api/_voice.js');
  const run = async (evidence, reply) => {
    const sent = [];
    let out = null;
    const orig = V.json;
    V.json = (r, status, b) => { out = { status, body: b }; };
    try {
      await X.handle({ method: 'POST', body: { kind: 'recovery', evidence }, headers: {} }, { setHeader(){} }, {
        voiceConfig: () => ({ enabled: true, apiKey: 'sk-test', model: 'm-ask', noteModel: 'm-note' }),
        verifyUser: async () => ({ uid: 'u1' }),
        postModel: async (cfg, payload) => { sent.push(payload);
          return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: reply }] }) }; }
      });
    } finally { V.json = orig; }
    return { out, sent };
  };
  const ok = await run(REC_EV, OK);
  assert.equal(ok.out.body.text, OK);
  assert.equal(ok.sent[0].system, X.SYSTEM.recovery);
  const bad = await run(REC_EV, 'Heavy legs and a poor night suggest a cold coming on, so keep today lighter and let recovery catch up.');
  assert.equal(bad.out.body.code, 'rejected_medical');
  const strava = await run(Object.assign({}, REC_EV, { source: 'strava' }), OK);
  assert.equal(strava.out.status, 422);
  assert.equal(strava.sent.length, 0);
});
