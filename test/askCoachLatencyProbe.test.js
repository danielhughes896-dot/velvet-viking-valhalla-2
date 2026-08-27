'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/* THE ASK COACH LATENCY DIAGNOSTIC — NUMBERS ONLY, AND NOTHING ELSE MOVED
 * ===========================================================================
 * Ask Coach takes about four seconds on the founder's phone and nothing in the
 * logs has ever said WHERE. The split matters because the fixes are opposites:
 * if generation dominates, streaming helps; if thinking dominates, streaming
 * shows the athlete an equally long pause and the lever is effort or a
 * different model for this route.
 *
 * This file guards two things, and the second is the more important:
 *
 *   1. the timings are emitted, are numbers, and carry no athlete content;
 *   2. NOTHING ELSE CHANGED. Model, effort, prompt, output contract,
 *      needsPlanChange handling and every athlete-facing response shape are
 *      asserted identical, because a diagnostic that alters the thing it is
 *      measuring is worse than no diagnostic at all.
 */

const ROOT = path.join(__dirname, '..');
const ASK_SRC = fs.readFileSync(path.join(ROOT, 'api', '_voice-ask.js'), 'utf8');
const ask = require('../api/_voice-ask.js');
const V = require('../api/_voice.js');

function mkRes(){
  return { code:null, body:null, headers:{},
    setHeader(k,v){ this.headers[String(k).toLowerCase()] = v; },
    status(s){ this.code = s; return this; },
    send(b){ this.body = b; return this; },
    end(b){ this.body = b; if (this.code == null) this.code = 200; return this; } };
}
const req = (body) => ({ method:'POST', url:'/api/voice-ask', query:{},
  headers:{ authorization:'Bearer aa.bb.cc' }, body: body || { question:'How hard should today feel?', context:{ days:[] } } });

function setEnv(vars){
  const saved = {};
  Object.keys(vars).forEach(k => { saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; });
  return () => Object.keys(saved).forEach(k => {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
}
const LIVE = { VVV_VOICE_ENABLED:'on', ANTHROPIC_API_KEY:'test-key', VVV_VOICE_MODEL:undefined };

/* The upstream and the identity check are the two things this route reaches.
   `delayMs` gives the fake generation a known duration so the timings can be
   checked against something rather than merely existing. */
async function withUpstream(reply, run, delayMs){
  const realFetch = globalThis.fetch, realVerify = V.verifyUser;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    return { ok: reply.ok !== false, status: reply.status || 200,
             json: async () => reply.body };
  };
  V.verifyUser = async () => ({ uid:'athlete-1', email:null, code:'AUTH_OK' });
  try { return await run(calls); }
  finally { globalThis.fetch = realFetch; V.verifyUser = realVerify; }
}
const ANSWER = { content:[{ type:'text', text:'{"answer":"Keep it easy today.","needsPlanChange":false,"changeReason":""}' }],
                 usage:{ output_tokens: 812 }, stop_reason:'end_turn' };

function captureLogs(){
  const lines = [];
  const real = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  return { lines, done: () => { console.log = real; } };
}
const field = (line, name) => {
  const m = new RegExp('\\b' + name + '=(\\d+)\\b').exec(line);
  return m ? Number(m[1]) : null;
};

// ---------------------------------------------------------------------------
// 1. THE DIAGNOSTIC
// ---------------------------------------------------------------------------
test('a successful ask logs the four timings, all numbers', async () => {
  const restore = setEnv(LIVE);
  const log = captureLogs();
  try {
    await withUpstream({ body: ANSWER }, async () => {
      await ask.handle(req(), mkRes());
    }, 40);
  } finally { log.done(); restore(); }

  const ok = log.lines.filter(l => l.indexOf('ASK ok') !== -1)[0];
  assert.ok(ok, 'no ASK ok line was logged at all: ' + JSON.stringify(log.lines));
  ['total', 'pre', 'head', 'body'].forEach(f =>
    assert.ok(field(ok, f) !== null, 'no ' + f + '= in: ' + ok));
  /* The fake generation took 40ms, so `head` must have seen it and `total`
     must be at least as long. Proves the clock is wired to the right points
     rather than merely printing zeroes. */
  assert.ok(field(ok, 'head') >= 35, 'head did not measure the upstream turn: ' + ok);
  assert.ok(field(ok, 'total') >= field(ok, 'head'), 'total is shorter than the upstream turn: ' + ok);
  assert.ok(field(ok, 'pre') >= 0 && field(ok, 'body') >= 0);
});

test('the counts that separate thinking from generation are still logged', () => {
  /* `head` is the whole upstream turn. out= (which INCLUDES thinking tokens)
     read against chars= is what lets the report infer which half dominated. */
  const ok = /V\.log\('ASK ok chars=[\s\S]{0,260}?\);/.exec(ASK_SRC);
  assert.ok(ok, 'the ASK ok log line changed shape');
  assert.match(ok[0], /chars=/);
  assert.match(ok[0], /out=/);
  assert.match(ok[0], /askTimings/);
});

test('a decline and an empty reply are timed too', async () => {
  for (const [name, body] of [['declined', { stop_reason:'refusal', content:[] }],
                              ['empty_reply', { stop_reason:'max_tokens', content:[], usage:{ output_tokens: 16000 } }]]){
    const restore = setEnv(LIVE);
    const log = captureLogs();
    try {
      await withUpstream({ body }, async () => { await ask.handle(req(), mkRes()); });
    } finally { log.done(); restore(); }
    const line = log.lines.filter(l => l.indexOf('ASK ' + name) !== -1)[0];
    assert.ok(line, 'no ASK ' + name + ' line: ' + JSON.stringify(log.lines));
    assert.ok(field(line, 'total') !== null, name + ' was not timed: ' + line);
  }
});

test('nothing in any log line can carry athlete content', async () => {
  const restore = setEnv(LIVE);
  const log = captureLogs();
  const SECRET_Q = 'my left calf has been hurting since Tuesday';
  try {
    await withUpstream({ body: ANSWER }, async () => {
      await ask.handle(req({ question: SECRET_Q,
        context:{ days:[{ id:'2026-08-24', hr:158 }], readiness:{ score:71 } } }), mkRes());
    });
  } finally { log.done(); restore(); }

  const all = log.lines.join('\n');
  ['calf', 'Tuesday', 'Keep it easy', '2026-08-24', '158', 'readiness', 'test-key', 'athlete-1']
    .forEach(leak => assert.equal(all.indexOf(leak), -1, 'a log line leaked: ' + leak));
  /* Every timing field is digits and nothing else. */
  const ok = log.lines.filter(l => l.indexOf('ASK ok') !== -1)[0];
  (ok.match(/\b(total|pre|head|body)=[^\s]+/g) || []).forEach(pair =>
    assert.match(pair, /^(total|pre|head|body)=\d+$/, 'a timing field is not a plain number: ' + pair));
});

test('the diagnostic does not claim to measure time to first token', () => {
  /* A NON-STREAMING CALL HAS NO FIRST TOKEN. fetch resolves on headers, and for
     a non-streamed generation those arrive at the end. Anything labelled ttft
     here would be invented, so the field must not exist and the file must say
     why. */
  /* CODE, NOT PROSE. The file's own comment explains at length why TTFT is not
     measurable here, and a naive grep reads that explanation as the thing it
     warns against. */
  const code = ASK_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\bttft\b/i.test(code), 'a time-to-first-token field appeared on a non-streaming call');
  assert.match(ASK_SRC, /NOT\*\* MEASURED|NOT MEASURED/, 'the limitation is not recorded in the file');
  assert.match(ASK_SRC, /resolves when the response headers arrive|resolves on HEADERS/,
    'the meaning of the headers timestamp is not explained');
});

test('askTimings degrades rather than throwing when a stage never happened', () => {
  /* An unreachable upstream has no headers and no body. */
  const t = ask.askTimings({ receivedAt: Date.now() - 50 }, null);
  assert.match(t, /^total=\d+$/, 'a failed request produced a malformed timing string: ' + t);
  const t2 = ask.askTimings({ receivedAt: Date.now() - 50, upstreamAt: Date.now() - 40 }, null);
  assert.match(t2, /total=\d+ pre=\d+/);
  assert.ok(!/head=/.test(t2), 'headers were timed when none arrived');
});

// ---------------------------------------------------------------------------
// 2. NOTHING ELSE CHANGED — the point of the whole exercise
// ---------------------------------------------------------------------------
test('the model, effort and token ceiling are untouched', () => {
  assert.equal(V.VOICE_MODEL, 'claude-opus-5');
  assert.match(ASK_SRC, /output_config = \{ effort: 'low' \}/, 'effort changed');
  assert.match(ASK_SRC, /const VOICE_MAX_TOKENS = 16000;/, 'the token ceiling changed');
  assert.ok(!/stream\s*:\s*true/.test(ASK_SRC), 'streaming was switched on -- this branch is diagnostic only');
});

test('the prompt is untouched', () => {
  /* The exact output contract the model is held to. */
  assert.match(ask.SYSTEM, /OUTPUT\. Reply with a single JSON object and nothing else:/);
  assert.match(ask.SYSTEM, /\{"answer": "<what you would say aloud>", "needsPlanChange": <true\|false>,/);
  assert.match(ask.SYSTEM, /"changeReason": "<one sentence, or empty>"\}/);
});

test('the response contract the athlete receives is byte-identical', async () => {
  const restore = setEnv(LIVE);
  let payload;
  try {
    await withUpstream({ body: ANSWER }, async () => {
      const res = mkRes();
      await ask.handle(req(), res);
      payload = JSON.parse(res.body);
      assert.equal(res.code, 200);
    });
  } finally { restore(); }
  assert.deepEqual(Object.keys(payload).sort(), ['answer', 'changeReason', 'needsPlanChange']);
  assert.equal(payload.answer, 'Keep it easy today.');
  assert.equal(payload.needsPlanChange, false);
  /* No timing field leaked into the athlete-facing response. */
  ['total', 'pre', 'head', 'body', 'ms', 'timings'].forEach(f =>
    assert.equal(Object.prototype.hasOwnProperty.call(payload, f), false,
      'the diagnostic leaked ' + f + ' into the athlete-facing response'));
});

test('needsPlanChange still round-trips exactly as before', async () => {
  const restore = setEnv(LIVE);
  try {
    await withUpstream({ body: { content:[{ type:'text',
      text:'{"answer":"Worth easing Thursday.","needsPlanChange":true,"changeReason":"Load is high."}' }],
      usage:{ output_tokens: 900 }, stop_reason:'end_turn' } }, async () => {
      const res = mkRes();
      await ask.handle(req(), res);
      const p = JSON.parse(res.body);
      assert.equal(p.needsPlanChange, true);
      assert.equal(p.changeReason, 'Load is high.');
    });
  } finally { restore(); }
});

test('every refusal path still refuses, with the same codes', async () => {
  const cases = [
    [{ VVV_VOICE_ENABLED: undefined, ANTHROPIC_API_KEY:'k' }, 403, 'VOICE_DISABLED'],
    [{ VVV_VOICE_ENABLED:'on', ANTHROPIC_API_KEY: undefined }, 503, 'VOICE_NOT_CONFIGURED']
  ];
  for (const [env, code, marker] of cases){
    const restore = setEnv(env);
    try {
      const res = mkRes();
      await ask.handle(req(), res);
      assert.equal(res.code, code);
      assert.match(String(res.body), new RegExp(marker));
    } finally { restore(); }
  }
});

test('the Strava boundary and the athlete-facing UX are untouched', () => {
  const runtime = fs.readFileSync(path.join(ROOT, 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  /* Not one line of the browser changed on this branch. */
  assert.match(runtime, /askSet\('thinking'/, 'the thinking state changed');
  assert.match(runtime, /class="ask-thinking" role="status" aria-live="polite"/,
    'the athlete-facing waiting state changed');
  assert.match(ASK_SRC, /STRAVA_DERIVED_CONTEXT/, 'the Strava context refusal changed');
});

test('the diagnostic adds no dependency and no new require', () => {
  /* The project legitimately depends on Capacitor for the Android shell. What
     must not happen is a NEW one arriving for a logging change, so the set is
     pinned rather than required to be empty. */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies || {}).sort(), [
    '@capacitor-community/text-to-speech',
    '@capacitor/android',
    '@capacitor/app',
    '@capacitor/core',
    '@capacitor/filesystem',
    '@capacitor/share'
  ], 'the dependency list changed');
  const code = ASK_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const requires = (code.match(/require\(['"][^'"]+['"]\)/g) || [])
    .map(r => r.replace(/require\(['"]|['"]\)/g, ''));
  requires.forEach(r => assert.ok(r.indexOf('./_') === 0,
    'the ask route gained an external require: ' + r));
});
