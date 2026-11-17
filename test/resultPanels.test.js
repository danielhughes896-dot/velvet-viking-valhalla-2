'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');
const X = require('../api/_voice-explain.js');

/* SESSION COMPLETE AND WEEK COMPLETE, AND THE COACH'S WORD ON THEM.
   Founder: "I don't want a list of copying. I want it to sound like a real
   normal coach. Concise English. Not robotic. Summarising the stats."
   The engine decides; the paragraph only says it, and is checked before it
   is shown, on both sides of the wire. */

const NOW = '2026-11-16';
const RUN_EV = {
  kind: 'run', units: 'km',
  session: { type: 'Long Run', title: 'Long Run', planned: '13km' },
  logged: { distance: '13km', pace: '5:37 /km', time: null, effort: '4/10' },
  execution: '100%',
  verdict: { tone: 'neutral', label: 'Building Baseline', line: '13km completed at easy intent.' },
  noticed: 'Easy discipline held exactly where it was set.', next: 'Keep 17 Nov’s Sharpen: 6x100m Strides genuinely easy.'
};
const withTone = tone => Object.assign({}, RUN_EV, { verdict: Object.assign({}, RUN_EV.verdict, { tone }) });
const GOOD = '13km at 5:37 and it felt like a 4 out of 10, which is where a long run should sit. Keep the strides on 17 Nov relaxed.';

test('the checker passes a plain coach paragraph and refuses what a coach would not say', () => {
  assert.equal(X.validateExplain(GOOD, RUN_EV).ok, true);
  const cases = [
    ['13km at 5:12 and it felt easy.  Keep it relaxed tomorrow, that is the job now.', RUN_EV, 'invented_number'],
    ['Lovely long run, 13km at an easy effort. Keep the strides relaxed tomorrow!', RUN_EV, 'exclamation'],
    ['Great run, 13km at 5:37 with the effort a 4 out of 10. Keep the strides relaxed.', withTone('caution'), 'praise_against_verdict'],
    ['13km at 5:37 with the effort a 4 out of 10. Keep the strides relaxed tomorrow.', withTone('recovery'), 'softens_recovery'],
    ['13km at 5:37, but I am a little concerned the effort was a 4 out of 10.', withTone('positive'), 'worry_against_verdict'],
    ['13km done. Skip the strides tomorrow and rest your legs instead of running.', RUN_EV, 'changes_prescription']
  ];
  for (const [text, ev, why] of cases) assert.equal(X.validateExplain(text, ev).why, why, text);
});

/* Found by the side-by-side test of Haiku 5.5 and Sonnet 5.5 on 49 packets:
   most first-round paragraphs repeated the engine's sentences, and one model
   called a too-quick easy run "exactly the job of this run". */
const FAST_EV = Object.assign({}, RUN_EV, { verdict: { tone: 'neutral', label: 'Building Baseline',
  line: '12km completed at easy intent. Pace ran quicker than the easy window. The discipline to hold back is what makes the hard days work.' } });
test('a paragraph that copies the engine, or drops what the verdict flagged, is refused', () => {
  assert.equal(X.validateExplain('13km completed at easy intent. Keep 17 Nov’s Sharpen: 6x100m Strides genuinely easy.', RUN_EV).why, 'copied_engine');
  assert.equal(X.validateExplain('12km at an easy 4/10 effort, which is exactly the job of this run. Your strides come next on 17 Nov.', FAST_EV).why, 'drops_verdict_flag');
  assert.equal(X.validateExplain('12km at a 4/10 effort, but the pace crept quicker than an easy run should. Hold it back next time so the hard days get the benefit.', FAST_EV).ok, true);
});

test('the browser runs the same check and reaches the same answer', () => {
  const a = loadApp({ pinnedDate: NOW + 'T08:00:00Z' });
  for (const t of ['12km at an easy 4/10 effort, which is exactly the job of this run. Your strides come next on 17 Nov.',
                   '12km at a 4/10 effort, but the pace crept quicker than an easy run should. Hold it back next time so the hard days get the benefit.',
                   '13km completed at easy intent. Keep 17 Nov’s Sharpen: 6x100m Strides genuinely easy.'])
    assert.equal(a.resultSayValid(t, FAST_EV).ok, X.validateExplain(t, FAST_EV).ok, t);
  const texts = [GOOD, 'Great run, 13km at 5:37 with the effort a 4 out of 10. Keep the strides relaxed.',
    '13km at 5:12 and it felt easy.  Keep it relaxed tomorrow, that is the job now.',
    'Lovely long run, 13km at an easy effort. Keep the strides relaxed tomorrow!'];
  for (const tone of ['positive', 'neutral', 'caution', 'recovery'])
    for (const t of texts)
      assert.equal(a.resultSayValid(t, withTone(tone)).ok, X.validateExplain(t, withTone(tone)).ok, tone + ': ' + t);
});

function reqOf(body){ return { method: 'POST', body, headers: {} }; }
function resOf(){
  const r = { status: 0, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.statusCode = 0;
  return r;
}
async function call(body, opts){
  const o = opts || {};
  const sent = [];
  const res = resOf();
  const V = require('../api/_voice.js');
  const origJson = V.json;
  let out = null;
  V.json = (r, status, b) => { out = { status, body: b }; };
  try {
    await X.handle(reqOf(body), res, {
      voiceConfig: () => ({ enabled: o.enabled !== false, apiKey: 'sk-test', model: 'm-ask', noteModel: 'm-note' }),
      verifyUser: async () => ({ uid: 'u1' }),
      postModel: async (cfg, payload) => { sent.push(payload);
        return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: o.reply || GOOD }], usage: { input_tokens: 900, output_tokens: 60 } }) }; }
    });
  } finally { V.json = origJson; }
  return { out, sent };
}

test('the route answers with checked text, on the routine model, at low effort', async () => {
  const { out, sent } = await call({ kind: 'run', evidence: RUN_EV });
  assert.equal(out.status, 200);
  assert.equal(out.body.text, GOOD);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].model, 'm-note', 'routine summaries are not written on the Ask Coach model');
  assert.deepEqual(sent[0].output_config, { effort: 'low' });
  assert.match(sent[0].system, /sound|real coach/i);
});

test('the route sends nothing it should not, and returns nothing it cannot stand behind', async () => {
  assert.equal((await call({ kind: 'run', evidence: RUN_EV }, { enabled: false })).out.body.text, null);
  assert.equal((await call({ kind: 'month', evidence: RUN_EV })).out.status, 400);
  assert.equal((await call({ kind: 'run', evidence: Object.assign({}, RUN_EV, { verdict: null }) })).out.status, 400);
  const strava = await call({ kind: 'run', evidence: Object.assign({}, RUN_EV, { stravaActivityId: 9 }) });
  assert.equal(strava.out.status, 422);
  assert.equal(strava.sent.length, 0, 'Strava-derived evidence reached the model');
  const bad = await call({ kind: 'run', evidence: withTone('caution') }, { reply: 'Great run, 13km at 5:37 with the effort a 4 out of 10.' });
  assert.equal(bad.out.body.text, null);
  assert.equal(bad.out.body.code, 'rejected_praise_against_verdict');
});

test('the route is behind the one voice function and has its rewrite', () => {
  const r = require('../api/voice.js');
  assert.ok(r.ROUTES.includes('voice-explain'));
  const vercel = fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8');
  assert.ok(vercel.indexOf('"/api/voice?route=voice-explain"') !== -1);
  const V = require('../api/_voice.js');
  assert.equal(V.NOTE_MODEL, 'claude-haiku-5-5');
});

function athlete(o){
  const opts = o || {};
  const a = loadApp({ pinnedDate: NOW + 'T08:00:00Z', fetch: opts.fetch });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: 'half', volume: 40, weeks: 12, experience: 'experienced', startDate: '2026-10-26',
                 healthConsent: opts.healthConsent !== false, lthr: 170, maxHR: 190 });
  a.state.days.filter(d => d.date < NOW && d.km > 0).forEach(d => logAsPrescribed(a, d, { sections: true }));
  return a;
}
const lastRun = a => a.state.days.filter(d => d.date < NOW && d.km > 0).pop();

test('the packet: what was run and what the engine concluded, and nothing private without consent', () => {
  const a = athlete();
  const dd = lastRun(a);
  dd.actual.hr = 141; dd.actual.notes = 'calf a bit tight';
  const ev = a.resultSayEvidence('run', dd);
  assert.equal(ev.kind, 'run');
  assert.equal(ev.verdict.line, a.sessionResultReading(dd).line, 'the verdict is the engine\'s own sentence');
  assert.equal(ev.logged.averageHeartRate, '141 bpm');
  assert.ok(JSON.stringify(ev).indexOf('calf') === -1, 'free-text notes reached the packet');
  const b = athlete({ healthConsent: false });
  const db = lastRun(b); db.actual.hr = 141;
  const evb = b.resultSayEvidence('run', db);
  assert.equal(evb.logged.averageHeartRate, undefined, 'heart rate sent without consent');
  assert.equal(evb.healthInformation, 'withheld');
  /* Any Strava-derived day anywhere in the record: nothing is sent. */
  a.state.days.find(d => d.date < NOW && d.km > 0).stravaActivityId = 123;
  assert.equal(a.resultSayEvidence('run', dd), null);
  assert.equal(a.resultSayEvidence('week', 3), null);
});

test('Session Complete carries no words; the coach\'s paragraph is written into Sacoro Analysis', async () => {
  /* Founder: "I don't think we need all that detail. Everything from
     Building Baseline above we keep ... then the analysis is in the coach's
     analysis." */
  const calls = [];
  const a = athlete({ fetch: (url, init) => { calls.push({ url: String(url), init });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ text: a.__reply }) }); } });
  a.cloudSession = { access_token: 'tok', user_id: 'u1', email: 'a@b.c', expires_at: Date.parse('2031-01-01') };
  a.voiceCoachAvailable = true;
  const dd = lastRun(a);
  const panel = a.sessionResultHtml(dd);
  const rd = a.sessionResultReading(dd);
  assert.equal((panel.match(/class="rs-say"/g) || []).length, 0, 'the panel grew a paragraph again');
  assert.ok(panel.indexOf(rd.line) === -1, 'the engine sentence is on the panel');
  assert.ok(panel.indexOf(rd.tone.label) !== -1, 'the tone line is the last thing kept');
  assert.equal((panel.match(/btn-primary/g) || []).length, 1, 'cherry is OK alone');
  /* The analysis has the engine's words until a written paragraph passes. */
  const engine = a.renderExecutionReview(dd);
  assert.ok(engine.indexOf(a.escapeHtml(rd.line)) !== -1);
  a.__reply = '13km at an easy 4 out of 10, which is exactly where a long run belongs.\n\nKeep the strides on 17 Nov relaxed.';
  const got = await a.resultSayFetch('run', dd);
  const asks = () => calls.filter(c => c.url === '/api/voice-explain');
  assert.equal(got, a.__reply);
  assert.equal(asks().length, 1);
  assert.deepEqual(Object.keys(JSON.parse(asks()[0].init.body)), ['kind', 'evidence']);
  const written = a.renderExecutionReview(dd);
  assert.ok(written.indexOf('13km at an easy 4 out of 10, which is exactly where a long run belongs.') !== -1, 'the written paragraph is not in the analysis');
  assert.ok(written.indexOf(a.escapeHtml(rd.line)) === -1, 'both the engine sentence and the paragraph are drawn');
  assert.equal((written.match(/class="wc-prose-p"/g) || []).length, 2, 'the paragraphs were not kept as paragraphs');
  /* Asked once per run. */
  assert.equal(a.resultSayFetch('run', dd), null);
  assert.equal(asks().length, 1);
  /* KEPT WITH THE RUN (founder: "Go with you"): on the day itself, so it
     goes to the account with the plan and is the same on every device. */
  assert.equal(dd.coachSay && dd.coachSay.text, a.__reply);
  const elsewhere = loadApp({ pinnedDate: NOW + 'T08:00:00Z' });
  elsewhere.state = JSON.parse(JSON.stringify(a.state));
  const twin = elsewhere.state.days.find(d => d.id === dd.id);
  assert.ok(elsewhere.renderExecutionReview(twin).indexOf('exactly where a long run belongs') !== -1, 'another device does not show the same words');
  /* WRITTEN ONCE: a newer run moves the packet on (the trend line goes to the
     newer card) but these words stay. */
  const next = a.state.days.find(d => d.date === NOW && d.km > 0);
  if (next){ logAsPrescribed(a, next, { sections: true }); }
  assert.ok(a.renderExecutionReview(dd).indexOf('exactly where a long run belongs') !== -1, 'a newer run unpicked the written words');
  /* Editing the log is a new run to write about: the old words stand down. */
  dd.actual.rpe = 9; delete dd.coachReview; a.coachPersistReview(dd);
  assert.ok(a.renderExecutionReview(dd).indexOf('exactly where a long run belongs') === -1, 'words about the old log survived an edit');
});

test('Session Complete once, after Save; Week Complete after OK on the last run of the week', () => {
  const a = athlete();
  const opened = [];
  a.openModal = (html, cls) => { opened.push({ html, cls }); };
  a.closeModal = () => {};
  const dd = lastRun(a);
  assert.equal(a.maybeOpenSessionResult(dd), true);
  assert.match(opened[0].cls, /stg-sheet/);
  assert.match(opened[0].html, /Session Complete/);
  assert.equal(a.maybeOpenSessionResult(dd), false, 'Session Complete rose twice for one run');
  /* An old log tidied up is not a run just finished. */
  const old = a.state.days.find(d => d.date < '2026-11-05' && d.km > 0);
  assert.equal(a.sessionResultDue(old), false);
  /* The week of a run with sessions still to come: no week panel. */
  assert.equal(a.weekResultDue(dd.week), true);
  a.handleResultOk(dd.id);
  assert.match(opened[opened.length - 1].html, new RegExp('Week ' + dd.week + ' Complete'));
  const n = opened.length;
  a.handleResultOk(dd.id);
  assert.equal(opened.length, n, 'Week Complete rose twice');
  const later = a.state.days.find(d => d.date > NOW && d.km > 0);
  assert.equal(a.weekResultDue(later.week), false, 'a week with runs still to come is not complete');
});

/* WEEK COMPLETE IS ONE SENTENCE (founder: "Week complete should have 1
   sentence summarising the week"). */
test('Week Complete: one sentence, from the model and from the engine alike', () => {
  const WEEK_EV = { kind: 'week', units: 'km', week: 2, phase: 'Base',
    sessions: { done: 4, planned: 4, missed: 0, notLogged: 0 }, distance: { done: '41.5km', planned: '41.5km' },
    execution: '100%', runsHarderThanIntended: 0,
    verdict: { tone: 'positive', label: 'Ready to Progress', line: 'Every session done, and none harder than it was meant to be. You’re ready to progress.' },
    nextWeek: { decision: 'Ready to Progress', recommendedDistance: '42km' } };
  const one = 'All four runs done and none of them forced, so you have earned the small step up to 42km next week.';
  const two = 'All four runs done and none of them forced. You have earned the small step up to 42km next week.';
  assert.equal(X.validateExplain(one, WEEK_EV).ok, true);
  assert.equal(X.validateExplain(two, WEEK_EV).why, 'week_not_one_sentence');
  assert.match(X.SYSTEM.week, /ONE sentence, at most 25 words/);
  const a = athlete();
  assert.equal(a.resultSayValid(one, WEEK_EV).ok, true);
  assert.equal(a.resultSayValid(two, WEEK_EV).why, 'week_not_one_sentence');
  const html = a.weekResultHtml(2);
  const say = /<p class="rs-say"[^>]*>([^<]*)<\/p>/.exec(html);
  assert.ok(say, 'Week Complete has no sentence');
  assert.equal(say[1].split(/(?<=[.!?])\s+/).filter(Boolean).length, 1, 'the engine fallback is more than one sentence: ' + say[1]);
});
