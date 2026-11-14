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

/* ---------- WELCOME TO WEEK 1 ---------- */
test('a new block opens with a compact welcome naming the first run, until Got it', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 16, distanceKey: 'half', startDate: TODAY });
  const first = a.welcomeFirstRun();
  const card = a.renderWelcomeCard();
  assert.match(card, /Welcome to week 1/);
  assert.match(card, new RegExp(a.escapeHtml(first.title).replace(/[()+]/g, '\\$&')));
  assert.match(card, /data-action="welcome-ack">Got it</);
  assert.doesNotMatch(card, /modal|full-screen/);
  assert.match(a.renderTodayView(), /Welcome to week 1/);
  a.handleWelcomeAck();
  assert.equal(a.renderWelcomeCard(), '', 'it came back after Got it');
});
test('the welcome stands down once running has started or two weeks have passed', () => {
  const a = athlete();   // six weeks in, sessions logged
  assert.equal(a.renderWelcomeCard(), '');
});

/* ---------- THE INJURY CARD: A ROW, AND A PAGE IN THE COACH STRUCTURE ---------- */
test('the injury page has the circle, three tiles, the evidence, the read and two answers', () => {
  const a = athlete();
  a.declareRestriction('easy', a.addDays(TODAY, 6));
  const page = a.restrictionPanelHtml();
  ['class="rp-hero is-word"', 'Your Restriction', 'class="pt-tiles"', '>Days left<', '>Sessions<', '>Quality<',
   'The Evidence', 'SACORO’s Read', 'class="page-foot"'].forEach(s => assert.ok(page.indexOf(s) > -1, s + ' is missing'));
  const opened = [];
  a.openModal = (h, c) => opened.push(c);
  a.openRestrictionPanel();
  assert.match(opened[0], /\brp-cherry\b/);
  assert.match(opened[0], /\bhq-full\b/);
});

/* ---------- RAN ANYWAY ---------- */
test('a rest day nobody offered can still log a run, quietly, and it stays optional', () => {
  const a = loadApp({ pinnedDate: '2026-05-22T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 16, distanceKey: 'half', startDate: a.addDays('2026-05-22', -42) });
  const d = a.state.days.find(x => x.date === '2026-05-22');
  assert.equal(d.type, 'rest');
  if (a.isOptionalRunDay(d)) return;   // fixture offered it after all: nothing to prove here
  assert.equal(a.canLogRunAnyway(d), true);
  assert.match(a.renderOptionalRunCompanion(d), /data-action="optional-run-log"[^>]*>Ran anyway\? Log it</);
  d.actual = a.emptyActual(); d.actual.km = 5;
  assert.equal(a.applyOptionalRunLog(d, true), true);
  assert.equal(a.optionalRunLogged(d), true);
  assert.equal(d.type, 'rest', 'the day became a prescription');
  // and never inside a restriction
  const r = a.state.days.find(x => x.date > '2026-05-22' && x.type === 'rest');
  a.declareRestriction('none', a.addDays('2026-05-22', 5));
  assert.equal(a.canLogRunAnyway(a.state.days.find(x => x.date === '2026-05-22')), false);
});

/* ---------- THE RENAME ---------- */
test('a saved plan loses the dashes from its session names and descriptions, once', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  const st = { days: [{ title: 'Long Run — Rolling', desc: 'On tired legs — this specificity works.' },
                      { title: 'Easy Aerobic', desc: 'Plain.' }] };
  a.migrateDashCopy(st);
  assert.equal(st.days[0].title, 'Long Run: Rolling');
  assert.equal(st.days[0].desc, 'On tired legs. This specificity works.');
  assert.equal(st.days[1].title, 'Easy Aerobic');
  a.migrateDashCopy(st);
  assert.equal(st.days[0].title, 'Long Run: Rolling', 'not idempotent');
});

/* ---------- HOVER ONLY WHERE THERE IS A POINTER ---------- */
test('no hover effect can stick on a touch screen', () => {
  const fs = require('node:fs'), path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', require('./harness.js').RUNTIME_RELATIVE), 'utf8');
  const css = src.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
  // every :hover selector sits inside @media (hover:hover)
  const re = /[^{}]*:hover[^{}]*\{/g; let m, loose = [];
  while ((m = re.exec(css))){
    if (/\(hover:hover\)/.test(m[0])) continue;   // the gate itself
    const before = css.slice(Math.max(0, m.index - 24), m.index);
    if (!/@media \(hover:hover\)\{\s*$/.test(before)) loose.push(m[0].trim().slice(0, 60));
  }
  assert.equal(loose.join(' | '), '');
});

/* ---------- RACE TOO SOON: THE EXISTING DECISION, FOR EVERY DISTANCE ---------- */
test('a half, 10K or 5K too close to build for gets the same decision the marathon does', () => {
  const fs = require('node:fs'), path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', require('./harness.js').RUNTIME_RELATIVE), 'utf8');
  const gen = src.slice(src.indexOf('async function handleGeneratePlan'));
  const body = gen.slice(0, gen.indexOf('\nfunction '));
  assert.match(body, /if \(adm && !adm\.admitted && adm\.decision === 'too_short'\)\{\s*setRaceDestination[\s\S]{0,120}openRaceGoalPreparationModal\(adm, distanceKey\)/);
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  ['half', '10k', '5k', 'full'].forEach(dk => {
    const adm = a.raceGoalAdmission(dk, 1, 30, {});
    assert.equal(adm.decision, 'too_short', dk + ' one week out was admitted');
    const html = a.raceGoalPreparationHtml(adm, dk);
    assert.match(html, /data-action="prep-route" data-purpose="base"/, dk + ': the recommendation is not a real block');
    assert.match(html, />Build Aerobic Base</);
    assert.match(html, /Across 1 week, /, 'one week is written as weeks');
  });
});

/* ---------- SIGN-IN FROM THE FIRST SCREEN ---------- */
test('the first screen offers sign-in to somebody who already has an account', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.cloudConfigured = () => true; a.cloudSignedIn = () => false;
  assert.match(a.renderHero(), /data-action="open-signin-sheet"[^>]*>I already have an account</);
  a.cloudConfigured = () => false;
  assert.doesNotMatch(a.renderHero(), /open-signin-sheet/, 'offered with no account service to sign in to');
  const opened = [];
  a.openModal = (html, cls) => opened.push({ html, cls });
  a.openSigninSheet();
  assert.match(opened[0].html, /id="cloud-email"/);
  assert.match(opened[0].html, /data-action="cloud-sign-in"/);
  assert.match(opened[0].cls, /stg-sheet/);
});

/* ---------- THE BUILDER KEEPS A NEW ATHLETE'S ANSWERS ---------- */
function builderOverlay(){
  const o = { parentNode: { removeChild(){} }, querySelector: s => (s === '.bld-modal' ? {} : null) };
  return o;
}
test('closing the builder part-way keeps it, and opening it again puts it back', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  const parked = builderOverlay();
  let current = parked;
  a.document.getElementById = id => (id === 'modal-overlay' ? current : null);
  a.closeModal();
  assert.equal(a.bldParked, parked, 'the answers were thrown away');
  current = null;
  const appended = [];
  a.document.body.appendChild = el => { appended.push(el); current = el; };
  a.openSetupModal();
  assert.equal(appended[0], parked, 'the same builder did not come back');
  assert.equal(a.bldParked, null);
});
test('a builder over a real plan is never parked, and Start again begins afresh', () => {
  const a = athlete();
  let current = builderOverlay();
  a.document.getElementById = id => (id === 'modal-overlay' ? current : null);
  a.closeModal();
  assert.equal(a.bldParked, null, 'Edit Plan Settings kept stale answers');
  const b = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  current = builderOverlay();
  b.document.getElementById = id => (id === 'modal-overlay' ? current : null);
  b.closeModal();
  assert.ok(b.bldParked);
  let opened = 0;
  b.openSetupModal = () => { opened++; };
  b.handleBldRestart();
  assert.equal(b.bldParked, null, 'Start again brought the old answers back');
  assert.equal(opened, 1);
});

/* ---------- EDIT PLAN SETTINGS STARTS ON THE SUMMARY ---------- */
test('a line on the summary opens its screen, and Done comes straight back', () => {
  const a = athlete();
  const last = a.BLD_STAGE_NAMES.length - 1;
  const went = [];
  a.bldStage = n => { went.push(n); a.bldCurrentStage = n; };
  a.bldValidateStage = () => true;
  a.handleBldJump({ getAttribute: () => '7' });
  assert.equal(a.bldReviewReturn, true);
  a.handleBldNext();
  a.handleBldJump({ getAttribute: () => '4' });
  a.handleBldBack();
  assert.deepEqual(JSON.stringify(went), JSON.stringify([7, last, 4, last]));
  const fs = require('node:fs'), path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', require('./harness.js').RUNTIME_RELATIVE), 'utf8');
  assert.match(src, /bldStage\(planHasContent\(\) && state\.setup \? BLD_STAGE_NAMES\.length - 1 : 0\);/);
});

/* ---------- AN EMPTY TIME WHEEL STARTS NEAR THE LIKELY ANSWER ---------- */
test('an empty pace field starts on the session target, and nothing is written', () => {
  const a = athlete();
  const easy = a.state.days.find(d => d.type === 'easy' && d.date > TODAY);
  const band = a.executionPaceTarget(easy);
  const input = { id: '', value: '', getAttribute: k => (k === 'data-day' ? easy.id : null) };
  const v = a.timeWheelLikelyStart(input, { mode: 'pace' });
  const sec = v.m * 60 + v.s;
  assert.ok(sec >= band.fast && sec <= band.slow, 'started outside the session band');
  assert.equal(input.value, '');
});
test('an empty goal starts from the benchmark, and an empty benchmark from experience', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  const f = { 'su-bench-dist': '10k', 'su-bench-time': '45:00', 'su-distance': 'half' };
  a.document.getElementById = id => (id in f ? { value: f[id] } : null);
  a.document.querySelector = () => null;
  const goal = a.timeWheelLikelyStart({ id: 'su-goal-B', getAttribute: () => null }, { mode: 'hms' });
  const want = Math.round(a.equivalentTimeSec(a.vdotFromPerformance(10000, 2700) * a.BUILDER_SPEC.goals.ambitionMult.B, a.DISTANCE_PROFILES.half.raceKm * 1000));
  assert.equal(goal.h * 3600 + goal.m * 60 + goal.s, want);
  f['su-bench-time'] = '';
  const bench = a.timeWheelLikelyStart({ id: 'su-bench-time', getAttribute: () => null }, { mode: 'hms' });
  const t = bench.h * 3600 + bench.m * 60 + bench.s;
  assert.ok(t > 40 * 60 && t < 60 * 60, 'a typical 10K benchmark start is ' + t + 's');
});

/* ---------- SHARE IS A FULL PAGE ---------- */
test('the share page reads picture, then where it comes from, design, format, with the actions pinned', () => {
  const fs = require('node:fs'), path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', require('./harness.js').RUNTIME_RELATIVE), 'utf8');
  const i = src.indexOf('function shareComposerHtml()');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  const at = s => body.indexOf(s);
  assert.ok(at('share-stage') < at("sectionRule('Picture'"), 'the picture comes first');
  assert.ok(at("sectionRule('Picture'") < at("sectionRule('Design'"));
  assert.ok(at("sectionRule('Design'") < at("sectionRule('Format'"));
  assert.ok(at("sectionRule('Format'") < at('page-foot share-foot'), 'the actions sit at the foot');
  assert.doesNotMatch(body, /ICONS\./, 'a decorative icon is back on the page');
  assert.match(src, /\.modal-card\.share-page \.share-overlays\{display:flex; flex-wrap:nowrap;[^}]*overflow-x:auto/,
    'the designs are one row you swipe');
});

test('the share page opens on the last design and format, kept on this device only', () => {
  const a = athlete();
  const store = {};
  a.readStored = k => (k in store ? JSON.parse(store[k]) : null);
  a.writeStored = (k, v) => { store[k] = JSON.stringify(v); };
  const dd = a.state.days.filter(d => d.completed && d.type !== 'rest').slice(-1)[0];
  a.openShareModal(dd);
  assert.equal(a.shareState.overlay, 'frame');
  assert.equal(a.shareState.format, 'story');
  a.handleShareSet('overlay', 'railright');
  a.handleShareSet('format', 'post');
  const before = JSON.stringify(a.state);
  a.openShareModal(dd);
  assert.equal(a.shareState.overlay, 'railright');
  assert.equal(a.shareState.format, 'post');
  assert.equal(JSON.stringify(a.state), before, 'sharing wrote to the training record');
  store[a.SHARE_LAST_KEY] = JSON.stringify({ overlay: 'nonsense', format: 'banner' });
  a.openShareModal(dd);
  assert.equal(a.shareState.overlay, 'frame', 'an unknown design was trusted');
  assert.equal(a.shareState.format, 'story');
});

test('the verdict on the share image is lit from its first letter', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  const hp = a.shareHeadParts({ sessionLabel: 'INTERVAL', verdict: 'DIALED' });
  assert.equal(hp.text, 'INTERVAL: DIALED');
  assert.equal(hp.text.slice(hp.accentFrom), 'DIALED');
});

/* ---------- RAN ANYWAY TYPES IN CHERRY ---------- */
test('typing a run on a rest day lights the cherry ring, never the old gold', () => {
  const fs = require('node:fs'), path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', require('./harness.js').RUNTIME_RELATIVE), 'utf8');
  const css = src.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
  const rule = /\n  \.optional-block :focus-visible\{outline-color:var\(--cherry-text\);\}/;
  assert.match(css, rule);
  assert.ok(css.search(rule) > css.indexOf('\n  :focus-visible{'), 'it must come after the global gold ring to win');
});

/* ---------- SHARE NEVER FAILS IN SILENCE ---------- */
function shareRig(fs, share, media){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  const toasts = [];
  a.showToast = m => toasts.push(m);
  a.setTimeout = setTimeout; a.clearTimeout = clearTimeout;
  a.setInterval = setInterval; a.clearInterval = clearInterval;
  a.nativePlugin = n => (n === 'Filesystem' ? fs : n === 'Share' ? share : n === 'Media' ? (media || null) : null);
  a.nativePlatform = () => (media ? 'android' : 'ios');
  a.shareBlobToBase64 = () => Promise.resolve('QUJD');
  a.document.hasFocus = () => true;
  return { a, toasts };
}
test('on Android, Share takes Save\'s road and never touches the Filesystem plugin', async () => {
  const fsCalls = [];
  const fs = { writeFile: o => { fsCalls.push(o); return new Promise(() => {}); } };
  const saved = [];
  const media = {
    getAlbums: () => Promise.resolve({ albums: [{ name: 'SACORO', identifier: '/storage/emulated/0/Android/media/app/SACORO' }] }),
    createAlbum: () => Promise.resolve(),
    savePhoto: o => { saved.push(o); return Promise.resolve({ filePath: o.albumIdentifier + '/' + o.fileName + '.png' }); }
  };
  let shared = null;
  const { a, toasts } = shareRig(fs, { share: o => { shared = o; return Promise.resolve({}); } }, media);
  await a.nativeSaveBinaryFile({ blob: {}, mime: 'image/png', filename: 'sacoro-20260519.png', done: 'Image ready to share' });
  assert.equal(fsCalls.length, 0, 'the Filesystem plugin that froze and closed the app was used');
  assert.equal(saved[0].path, 'data:image/png;base64,QUJD');
  assert.equal(saved[0].fileName, 'sacoro-20260519');
  assert.equal(shared.url, 'file:///storage/emulated/0/Android/media/app/SACORO/sacoro-20260519.png');
  assert.equal(toasts[0], 'Getting your image ready');
  assert.equal(toasts[toasts.length - 1], 'Shared. A copy is in your SACORO album', 'the kept copy is not mentioned');
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', require('./harness.js').RUNTIME_RELATIVE), 'utf8');
  assert.doesNotMatch(src, /appendFile\(/, 'the append that closed the app is back');
});
test('a write that never answers ends in a message, not nothing', async () => {
  const { a, toasts } = shareRig({ writeFile: () => new Promise(() => {}) }, { share: () => Promise.resolve({}) });
  a.SHARE_STEP_MS.write = 60;
  await a.nativeSaveBinaryFile({ blob: {}, filename: 'x.png', done: 'ok' });
  assert.match(toasts[toasts.length - 1], /could not be prepared to share\. Save it instead/);
});
test('a share sheet that never appears ends in a message; one that does is left alone', async () => {
  const fs = { writeFile: o => Promise.resolve({ uri: 'file:///c/' + o.path }) };
  const stuck = shareRig(fs, { share: () => new Promise(() => {}) });
  stuck.a.SHARE_STEP_MS.sheet = 300;
  await stuck.a.nativeSaveBinaryFile({ blob: {}, filename: 'x.png', done: 'ok' });
  assert.match(stuck.toasts[stuck.toasts.length - 1], /share options did not open/);

  let finish;
  const open = shareRig(fs, { share: () => new Promise(r => { finish = r; }) });
  open.a.SHARE_STEP_MS.sheet = 300;
  open.a.document.hasFocus = () => false;          // the sheet has the screen
  const p = open.a.nativeSaveBinaryFile({ blob: {}, filename: 'x.png', done: 'Image ready to share' });
  await new Promise(r => setTimeout(r, 700));      // well past the deadline
  finish({});
  await p;
  assert.equal(open.toasts[open.toasts.length - 1], 'Image ready to share', 'an open sheet was reported as failed');
});
