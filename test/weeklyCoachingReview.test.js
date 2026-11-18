'use strict';
/* THE WEEKLY COACHING REVIEW -- the learning loop, end to end.
 *
 * Founder, 14 November 2026: "Athlete inputs -> Initial prescription ->
 * Session execution -> Scoring and response -> Learning -> Coaching decision
 * -> Updated prescription. Confirm that this entire chain works." Each test
 * below builds a real plan from a declared 30km week, logs week one the way
 * an athlete would, and reads what SACORO decides for week two, what the
 * glass sheet says, and what the week looks like after the athlete answers.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

const QUALITY = ['tempo', 'threshold', 'interval', 'repetition'];
function athlete(log, pin){
  const a = loadApp({ pinnedDate: (pin || '2026-11-16') + 'T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: '10k', volume: 30, weeks: 10, experience: 'experienced',
    startDate: '2026-11-09', schedule: { activeDays: [0, 1, 3, 4, 6], longRunDay: 6 } });
  const w1 = a.state.days.filter(d => d.week === 1 && d.type !== 'rest' && d.km > 0);
  if (log) log(a, w1);
  return a;
}
const logAll = q => (a, w) => w.forEach(d => logAsPrescribed(a, d, { quality: typeof q === 'function' ? q(d) : q }));
const miss = (a, d) => { a.state.unloggedAck = a.state.unloggedAck || {}; a.state.unloggedAck[d.id] = '2026-11-15'; };
const weekKm = (a, w) => a.weekPlannedKm(w);

test('performs well: a progression is recommended from last week, at the evidence\'s own step', () => {
  const a = athlete(logAll(1));
  const rv = a.weeklyCoachingReview(2);
  assert.equal(rv.kind, 'progress');
  /* Last week is the week as delivered: the declared 30km week, rounded run
     by run (31km here). */
  assert.equal(rv.lastKm, weekKm(a, 1));
  assert.ok(Math.abs(rv.lastKm - 30) <= 1, 'week one is ' + rv.lastKm + ' from a declared 30');
  /* The founder's own example: 30km last week, 32.4km recommended (+8%). The
     plan had a larger step; the evidence-led step is the smaller one. */
  assert.equal(rv.step, 0.08);
  assert.equal(rv.recommendedKm, Math.round(rv.lastKm * 1.08 * 10) / 10);
  assert.equal(rv.material, true);
  const html = a.weeklyReviewSheetHtml(rv);
  assert.match(html, /You’re ready to progress\./);
  assert.match(html, /Accept Progression/);
  assert.match(html, /Stay at Current Weekly Mileage/);
  assert.doesNotMatch(html, /Keep My Plan/i);
  assert.match(html, /How the week is spread/, 'the sheet must show how the new mileage is distributed');
  a.answerWeeklyReview(rv, true);
  assert.ok(Math.abs(weekKm(a, 2) - rv.recommendedKm) <= 1.5, 'week two is ' + weekKm(a, 2) + ' after accepting ' + rv.recommendedKm);
});

test('refuses the increase: staying at the current weekly mileage is honoured', () => {
  const a = athlete(logAll(1));
  const rv = a.weeklyCoachingReview(2);
  const rec = a.answerWeeklyReview(rv, false);
  assert.equal(rec.decision, 'declined');
  assert.ok(Math.abs(weekKm(a, 2) - weekKm(a, 1)) <= 1.5, 'week two is ' + weekKm(a, 2) + ' after staying at ' + weekKm(a, 1));
  /* Never asked again for this week, with or without new information. */
  assert.equal(a.weeklyReviewDue(), null);
});

test('handles the mileage but struggles with quality: repeat the session, keep the mileage', () => {
  const a = athlete(logAll(d => QUALITY.includes(d.type) ? 0.6 : 1));
  const rv = a.weeklyCoachingReview(2);
  assert.equal(rv.kind, 'quality');
  const before = a.state.days.filter(d => d.week === 2 && QUALITY.includes(d.type)).map(d => d.title);
  a.answerWeeklyReview(rv, true);
  const w1q = a.state.days.filter(d => d.week === 1 && QUALITY.includes(d.type))[0];
  const w2q = a.state.days.filter(d => d.week === 2 && d.weeklyAdjust)[0];
  assert.ok(w2q, 'no quality session was repeated');
  assert.equal(w2q.title, w1q.title, 'week two\'s quality session is not last week\'s');
  assert.ok(before.length, 'fixture has a week-two quality session');
});

test('performs poorly across repeated sessions: a reload week, with the evidence named', () => {
  const a = athlete(logAll(0.55));
  const rv = a.weeklyCoachingReview(2);
  assert.equal(rv.kind, 'reload');
  assert.ok(rv.reasons.length >= 1);
  const html = a.weeklyReviewSheetHtml(rv);
  assert.match(html, /Take the Reload Week/);
  assert.match(html, /Continue as Planned/);
  assert.doesNotMatch(html, /progress\./i, 'a recovery recommendation was labelled a progression');
  a.answerWeeklyReview(rv, true);
  assert.ok(weekKm(a, 2) < weekKm(a, 1), 'the reload week is ' + weekKm(a, 2));
});

test('one hard session is not a reload', () => {
  const a = athlete((a, w) => { logAll(1)(a, w); w[1].actual.rpe = 9; });
  const rv = a.weeklyCoachingReview(2);
  assert.notEqual(rv.kind, 'reload');
});

test('reports pain: protect the week, quality becomes easy running, nothing is a progression', () => {
  const a = athlete((a, w) => { logAll(1)(a, w); w[1].actual.hurting = 'pain'; });
  const rv = a.weeklyCoachingReview(2);
  assert.equal(rv.kind, 'protect');
  a.answerWeeklyReview(rv, true);
  const q = a.state.days.filter(d => d.week === 2 && d.date >= a.todayStr() && QUALITY.includes(d.type));
  assert.equal(q.length, 0, 'a quality session survived a protected week');
});

test('misses sessions: hold at last week\'s mileage', () => {
  const a = athlete((a, w) => w.forEach((d, i) => i < 2 ? miss(a, d) : logAsPrescribed(a, d, { quality: 1 })));
  const rv = a.weeklyCoachingReview(2);
  assert.equal(rv.kind, 'hold');
  assert.equal(rv.recommendedKm, weekKm(a, 1));
  assert.match(a.weeklyReviewSheetHtml(rv), /2 sessions were missed/);
});

test('records incomplete data: nothing is invented, and a rising week is still explained', () => {
  /* A1 (founder, 15 November 2026): every week the load rises gets the glass
     sheet, including the weeks SACORO has too little to read. It says so
     plainly, claims no reading it did not make, and nothing changes unless
     the athlete chooses to stay at their current mileage. */
  const a = athlete((a, w) => logAsPrescribed(a, w[0], { quality: 1 }));
  const rv = a.weeklyCoachingReview(2);
  assert.equal(rv.kind, 'insufficient');
  assert.equal(rv.recommendedKm, rv.plannedKm, 'no step is invented');
  assert.equal(rv.material, rv.plannedKm > rv.lastKm + 0.5);
  if (rv.material){
    assert.match(a.weeklyReviewSheetHtml(rv), /too little to judge/);
    assert.ok(a.weeklyReviewDue(), 'the sheet is due');
  } else assert.equal(a.weeklyReviewDue(), null);
});

test('accepts a reload, then performs well: the progression resumes and says so', () => {
  const a = athlete(logAll(0.55));
  a.answerWeeklyReview(a.weeklyCoachingReview(2), true);
  /* Week two run well, as reloaded. */
  a.state.days.filter(d => d.week === 2 && d.type !== 'rest' && d.km > 0)
    .forEach(d => logAsPrescribed(a, d, { quality: 1 }));
  const b = loadApp({ pinnedDate: '2026-11-23T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { b[f] = () => {}; });
  b.state = a.state;
  const rv = b.weeklyCoachingReview(3);
  assert.ok(rv.kind === 'progress' || rv.kind === 'planned_reduction', rv.kind);
  if (rv.kind === 'progress'){
    assert.ok(rv.reasons.indexOf('resuming') !== -1 || rv.reasons.indexOf('smaller_than_planned') !== -1);
    assert.equal(rv.material, true);
  }
});

test('the learning instruments decide: Recovery and Adaptation move the decision', () => {
  const strained = athlete(logAll(1));
  strained.coachRecovery = () => ({ state: 'strained', trainingState: 'strained' });
  assert.equal(strained.weeklyCoachingReview(2).kind, 'reload', 'Recovery & Fatigue did not reach the decision');
  const adapting = athlete(logAll(1));
  adapting.blockEffectiveness = () => ({ state: 'ADAPTING', robust: true });
  const rv = adapting.weeklyCoachingReview(2);
  assert.equal(rv.step, 0.10, 'Adaptation did not change the size of the step');
  /* At a 10% step the plan's own week (within half a kilometre of the cap)
     is already inside the evidence, so it stands. */
  const cap = Math.round(rv.lastKm * 1.10 * 10) / 10;
  assert.ok(rv.recommendedKm <= cap + 0.5 && rv.recommendedKm > Math.round(rv.lastKm * 1.08 * 10) / 10,
    rv.recommendedKm + ' against a 10% cap of ' + cap);
});

test('it never rewrites a logged session, and the original is always kept', () => {
  const a = athlete(logAll(1), '2026-11-18');
  a.state.days.filter(d => d.week === 2 && d.date < '2026-11-18' && d.type !== 'rest' && d.km > 0)
    .forEach(d => logAsPrescribed(a, d, { quality: 1 }));
  const done = a.state.days.filter(d => d.week === 2 && d.completed).map(d => JSON.stringify([d.id, d.km, d.title]));
  const rv = a.weeklyCoachingReview(2);
  a.answerWeeklyReview(rv, false);
  const after = a.state.days.filter(d => d.week === 2 && d.completed).map(d => JSON.stringify([d.id, d.km, d.title]));
  assert.deepEqual(after, done, 'a completed session was changed');
  const moved = a.state.days.filter(d => d.weeklyAdjust);
  assert.ok(moved.length, 'staying at 30km changed nothing');
  moved.forEach(d => assert.ok(d.weeklyAdjust.from && d.weeklyAdjust.from.km > 0));
  assert.ok(a.restoreWeeklyAdjust(2) > 0);
  assert.equal(a.state.days.filter(d => d.weeklyAdjust).length, 0);
});

test('a planned cutback week is not second-guessed, and week one asks nothing', () => {
  const a = athlete(logAll(1));
  assert.equal(a.weeklyCoachingReview(1), null);
  const info = a.playbookWeekInfo(4);
  if (info && info.isCutback){
    const b = loadApp({ pinnedDate: '2026-11-30T09:00:00Z' });
    b.state = a.state;
    const rv = b.weeklyCoachingReview(4);
    assert.ok(!rv || rv.kind === 'planned_reduction' || rv.kind === 'insufficient', rv && rv.kind);
  }
});

test('the proposal is the glass bottom sheet, on its own layer, and closing it does not answer it', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  assert.match(src, /layer\.className = 'tw-layer ask-layer wr-layer'/);
  assert.match(src, /'<div class="tw-sheet stg-sheet wr-sheet"/);
  assert.match(src, /case 'weekly-later': closeWeeklyReviewSheet\(\); break;/);
  assert.match(src, /\.wr-acts \.btn-primary\{background:var\(--cherry-fill\)/, 'the action is not cherry');
  assert.match(src, /try \{ maybeRaiseWeeklyReview\(arriving\); \} catch\(e\)\{\}/);
});

/* ---------------------------------------------------------------------------
   R4: THE RECOVERY PATTERN. Founder approval, 15 November 2026: "weekly
   pattern recognition with three athlete choices, clear examples and an
   explicit recommendation. No silent training changes."
   --------------------------------------------------------------------------- */
const consent = a => { a.state.healthConsent = { version: a.HEALTH_CONSENT_VERSION, decision: 'granted', at: '2026-01-01T00:00:00Z' }; };
const weekOneDays = a => a.state.days.filter(d => d.week === 1);
const tiredWeek = (opts) => (a, w) => {
  consent(a);
  logAll(1)(a, w);
  const o = opts || {};
  weekOneDays(a).forEach((d, i) => {
    if (o.legs != null && i < o.legs) d.readiness = Object.assign(d.readiness || {}, { legs: 'heavy', date: d.date });
    if (o.sleep != null && i < o.sleep) d.readiness = Object.assign(d.readiness || {}, { sleep: 'poor', date: d.date });
  });
  if (o.stops) w.slice(0, o.stops).forEach(d => { d.actual.km = Math.round(d.km * 0.6 * 10) / 10; d.actual.notes = 'stopped early, legs tired and exhausted'; });
};

test('a week of heavy legs and poor sleep is named, and holding is recommended', () => {
  const a = athlete(tiredWeek({ legs: 4, sleep: 7 }));
  const rv = a.weeklyCoachingReview(2);
  assert.equal(rv.kind, 'recovery');
  assert.equal(rv.choice, 'hold');
  assert.equal(rv.material, true);
  const html = a.weeklyReviewSheetHtml(rv);
  assert.match(html, /Your recovery pattern/);
  assert.match(html, /Heavy legs on 4 days/);
  assert.match(html, /Poor sleep on 7 days/);
  assert.match(html, /Continue Progression/);
  assert.match(html, /Hold Training Load<span class="wr-opt-rec">Recommended<\/span>/, 'the recommendation is not marked');
  assert.match(html, /Recovery Week/);
  assert.match(html, /data-action="weekly-accept">Confirm</);
  assert.doesNotMatch(html, /Keep My Plan/i);
  assert.equal((html.match(/role="radio"/g) || []).length, 3, 'three choices');
});

test('sessions stopped early because the athlete was tired are a pattern too', () => {
  const a = athlete(tiredWeek({ stops: 2 }));
  const rv = a.weeklyCoachingReview(2);
  assert.equal(rv.kind, 'recovery');
  assert.match(a.weeklyReviewSheetHtml(rv), /2 sessions stopped early because you were tired/);
});

test('one heavy morning is not a pattern, and nothing is read without health consent', () => {
  assert.notEqual(athlete(tiredWeek({ legs: 1, sleep: 2 })).weeklyCoachingReview(2).kind, 'recovery');
  const noConsent = athlete((a, w) => { tiredWeek({ legs: 7, sleep: 7 })(a, w); a.state.healthConsent = null; });
  assert.notEqual(noConsent.weeklyCoachingReview(2).kind, 'recovery');
});

test('with strain in the readings as well, a recovery week is recommended', () => {
  const a = athlete(tiredWeek({ legs: 5, sleep: 5 }));
  a.coachRecovery = () => ({ state: 'strained', trainingState: 'strained' });
  const rv = a.weeklyCoachingReview(2);
  assert.equal(rv.kind, 'recovery');
  assert.equal(rv.choice, 'reload');
  assert.match(a.weeklyReviewSheetHtml(rv), /Recovery Week<span class="wr-opt-rec">Recommended/);
});

test('each choice does what it says, nothing changes before one is made, and it is asked once', () => {
  const pick = choice => {
    const a = athlete(tiredWeek({ legs: 4, sleep: 7 }));
    const rv = a.weeklyCoachingReview(2);
    const planned = weekKm(a, 2);
    assert.equal(a.state.days.filter(d => d.weeklyAdjust).length, 0, 'the week changed before the athlete chose');
    const rec = a.answerWeeklyReview(rv, choice);
    assert.equal(rec.choice, choice);
    assert.equal(a.weeklyReviewDue(), null, 'asked again after answering');
    return { a, rv, planned };
  };
  const cont = pick('progress');
  assert.equal(weekKm(cont.a, 2), cont.planned, 'continuing changed the week');
  const hold = pick('hold');
  assert.ok(weekKm(hold.a, 2) <= hold.rv.options.hold + 1, 'holding left the week at ' + weekKm(hold.a, 2));
  const rel = pick('reload');
  assert.ok(weekKm(rel.a, 2) < rel.planned, 'the recovery week is ' + weekKm(rel.a, 2));
  rel.a.state.days.filter(d => d.weeklyAdjust).forEach(d => assert.ok(d.weeklyAdjust.from, 'an original was not kept'));
});

test('the three choices are picked on the sheet, and confirming applies the one picked', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  assert.match(src, /case 'weekly-pick': handleWeeklyPick\(target\.getAttribute\('data-choice'\)\); break;/);
  assert.match(src, /if \(p\.rv\.kind === 'recovery' && accept === true && p\.picked\) accept = p\.picked;/);
  assert.match(src, /\.wr-opt\.is-on\{border-color:color-mix\(in srgb, var\(--cherry\)/, 'the picked choice is not cherry');
});
