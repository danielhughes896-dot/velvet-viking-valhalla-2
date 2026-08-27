'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RUNTIME_RELATIVE } = require('./harness.js');

/* HEAR TODAY'S PREMIUM VOICE — THE SERVER HALF
 * ===========================================================================
 * THE ARCHITECTURAL RULE THIS FILE ENFORCES: ElevenLabs is a loudspeaker, not
 * a coach. It renders words Valhalla's own deterministic engine already chose,
 * on the athlete's device, before this route is reached. It is never asked
 * what to say.
 *
 * The properties that make that true rather than intended:
 *
 *   1. WHAT LEAVES US IS THE TEXT AND NOTHING ELSE. The outbound body is
 *      asserted field by field -- no athlete, no plan, no health data, no
 *      Strava payload, no conversation.
 *   2. THE CREDENTIAL CANNOT REACH THE BROWSER. It is read from the
 *      environment in one file and appears in no other, least of all the
 *      runtime.
 *   3. THE ATHLETE IS NEVER STRANDED. Missing config, a refused key, a dead
 *      vendor and a timeout all return a status the client answers by
 *      speaking with the device's own engine.
 *   4. ONE PRESS IS ONE GENERATION. The cache is content-addressed and a hit
 *      never reaches the vendor; concurrent presses collapse into one request.
 */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const TTS_SRC = fs.readFileSync(path.join(ROOT, 'api', '_voice-tts.js'), 'utf8');
const tts = require('../api/_voice-tts.js');
const V = require('../api/_voice.js');

const BRIEFING = 'Nice easy one today, five kilometres, easy aerobic. Keep it relaxed.';

function setEnv(vars){
  const saved = {};
  Object.keys(vars).forEach(k => { saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; });
  return function restore(){ Object.keys(saved).forEach(k => {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); };
}
function withEnv(vars, run){
  const restore = setEnv(vars);
  try { return run(); } finally { restore(); }
}
/* SEPARATE, AND NOT AN OVERSIGHT. The synchronous withEnv above restores in a
   `finally` that runs the moment run() RETURNS -- which for an async run() is
   the moment it returns a pending promise, long before the route has read
   process.env. Every server test here is async, so it must await inside the
   window rather than around it. */
async function withEnvAsync(vars, run){
  const restore = setEnv(vars);
  try { return await run(); } finally { restore(); }
}
function mkRes(){
  const r = { code:null, body:null, headers:{}, ended:null,
    setHeader(k,v){ this.headers[String(k).toLowerCase()] = v; },
    status(s){ this.code = s; return this; },
    send(b){ this.body = b; return this; },
    end(b){ this.ended = b; if (this.code == null) this.code = 200; return this; } };
  return r;
}
const req = (body, method) => ({
  method: method || 'POST', url:'/api/voice-tts', query:{},
  headers:{ authorization:'Bearer aa.bb.cc' }, body: body });

/* The vendor and the identity check are the two things this route reaches.
   Both are replaced so no test can ever spend money or need a network. */
function withVendor(impl, run){
  const realFetch = globalThis.fetch;
  const realVerify = V.verifyUser;
  const calls = [];
  globalThis.fetch = async function(url, opts){ calls.push({ url, opts }); return impl(url, opts, calls); };
  V.verifyUser = async function(){ return { uid:'athlete-1', email:null, code:'AUTH_OK' }; };
  tts.cacheReset();
  return Promise.resolve()
    .then(() => run(calls))
    .finally(() => { globalThis.fetch = realFetch; V.verifyUser = realVerify;
                     tts.cacheReset(); });
}
const audioOk = () => ({ ok:true, status:200,
  arrayBuffer: async () => new Uint8Array([0x49,0x44,0x33,1,2,3,4,5]).buffer });

const LIVE = { ELEVENLABS_API_KEY:'test-key-not-a-real-one', ELEVENLABS_VOICE_ID:undefined,
               VVV_TTS_MODEL:undefined };

// ---------------------------------------------------------------------------
// 1. THE MODEL, PINNED AND JUSTIFIED
// ---------------------------------------------------------------------------
test('the speech model is the pinned production identifier', () => {
  /* Chosen 2026-08-27 from the current ElevenLabs model line-up (eleven_v3,
     eleven_multilingual_v2, eleven_flash_v2_5). multilingual_v2 is the English
     quality tier: v3 is documented as unsuitable for latency-sensitive use and
     flash trades the prosody this change exists to buy. See
     TTS-VOICE-REPORT.md for the full comparison. */
  assert.equal(tts.TTS_MODEL_DEFAULT, 'eleven_multilingual_v2');
  assert.equal(withEnv({ VVV_TTS_MODEL: undefined }, () => tts.ttsModel()),
    'eleven_multilingual_v2');
  assert.equal(withEnv({ VVV_TTS_MODEL: 'eleven_v3' }, () => tts.ttsModel()), 'eleven_v3',
    'the model must be repointable by env without a code release');
});

test('the output format is one mobile playback can rely on', () => {
  assert.equal(tts.TTS_OUTPUT_FORMAT, 'mp3_44100_128');
});

// ---------------------------------------------------------------------------
// 2. FAIL CLOSED
// ---------------------------------------------------------------------------
test('with no API key the route refuses and never reaches the vendor', async () => {
  await withEnvAsync({ ELEVENLABS_API_KEY: undefined }, () => withVendor(audioOk, async (calls) => {
    const res = mkRes();
    await tts.handle(req({ text: BRIEFING }), res);
    assert.equal(res.code, 503);
    assert.match(String(res.body), /tts_unconfigured/);
    assert.equal(calls.length, 0, 'an unconfigured deployment still called the vendor');
  }));
});

test('an unauthenticated caller is refused before any spend', async () => {
  await withEnvAsync(LIVE, async () => {
    const realFetch = globalThis.fetch, realVerify = V.verifyUser;
    const calls = [];
    globalThis.fetch = async (u,o) => { calls.push({u,o}); return audioOk(); };
    V.verifyUser = async () => ({ code:'AUTH_HEADER_MISSING' });
    try {
      const res = mkRes();
      await tts.handle(req({ text: BRIEFING }), res);
      assert.equal(res.code, 401);
      assert.equal(calls.length, 0, 'a signed-out caller was allowed to spend money');
    } finally { globalThis.fetch = realFetch; V.verifyUser = realVerify; }
  });
});

test('an empty or oversized briefing is refused without spending', async () => {
  await withEnvAsync(LIVE, () => withVendor(audioOk, async (calls) => {
    const empty = mkRes();
    await tts.handle(req({ text: '   ' }), empty);
    assert.equal(empty.code, 400);
    const huge = mkRes();
    await tts.handle(req({ text: 'x'.repeat(tts.TTS_MAX_CHARS + 1) }), huge);
    assert.equal(huge.code, 413);
    assert.equal(calls.length, 0, 'a refused request still reached the vendor');
  }));
});

test('anything but POST is refused', async () => {
  const res = mkRes();
  await tts.handle(req({ text: BRIEFING }, 'GET'), res);
  assert.equal(res.code, 405);
});

// ---------------------------------------------------------------------------
// 3. WHAT LEAVES THE BUILDING
// ---------------------------------------------------------------------------
test('the vendor receives the briefing text and nothing else about the athlete', async () => {
  await withEnvAsync(LIVE, () => withVendor(audioOk, async (calls) => {
    const res = mkRes();
    await tts.handle(req({
      text: BRIEFING,
      voice: 'molly',
      /* Everything below is the shape of a poisoned payload: if the route ever
         forwards fields it was not asked for, this is what would ride along. */
      athlete: 'athlete-1', plan: [{ id:'2026-08-24' }], hr: 158, readiness: { score: 71 },
      strava: { activity_id: 99 }, conversation: [{ q:'my calf hurts' }]
    }), res);
    assert.equal(res.code, 200);
    assert.equal(calls.length, 1);

    const body = JSON.parse(calls[0].opts.body);
    assert.deepEqual(Object.keys(body).sort(), ['model_id', 'text', 'voice_settings'],
      'the outbound body carries a field beyond text, model and voice settings');
    assert.equal(body.text, BRIEFING);

    const raw = calls[0].opts.body;
    ['athlete-1', '2026-08-24', '158', 'readiness', 'strava', 'calf']
      .forEach(leak => assert.equal(raw.indexOf(leak), -1,
        'athlete data reached the speech vendor: ' + leak));
  }));
});

test('the credential travels in the vendor header and nowhere else', async () => {
  await withEnvAsync({ ELEVENLABS_API_KEY: 'secret-key-value' }, () => withVendor(audioOk, async (calls) => {
    const res = mkRes();
    await tts.handle(req({ text: BRIEFING }), res);
    assert.equal(calls[0].opts.headers['xi-api-key'], 'secret-key-value');
    assert.equal(calls[0].opts.body.indexOf('secret-key-value'), -1, 'the key is in the body');
    assert.equal(String(calls[0].url).indexOf('secret-key-value'), -1, 'the key is in the URL');
    assert.equal(String(res.ended || '').indexOf('secret-key-value'), -1, 'the key is in the response');
  }));
});

test('the credential is nowhere near the browser', () => {
  assert.ok(!/ELEVENLABS_API_KEY/.test(SRC), 'the runtime names the key variable');
  assert.ok(!/xi-api-key/i.test(SRC), 'the runtime carries the vendor auth header');
  assert.ok(!/api\.elevenlabs\.io/i.test(SRC), 'the runtime names the vendor endpoint');
  /* Read from the environment, never a literal. */
  assert.ok(!/ELEVENLABS_API_KEY\s*=\s*['"]/.test(TTS_SRC), 'a key literal was committed');
  assert.match(TTS_SRC, /process\.env/);
});

// ---------------------------------------------------------------------------
// 4. THE VOICE CATALOGUE
// ---------------------------------------------------------------------------
test('all four approved coach voices resolve to their own id', () => {
  const ids = ['molly','joanna','harry','andrew'].map(k => tts.resolveVoiceId(k));
  assert.equal(new Set(ids).size, 4, 'two coach voices resolve to the same id');
  ids.forEach(id => assert.match(id, /^[A-Za-z0-9]{15,}$/, 'a voice id looks malformed: ' + id));
});

test('Molly is the default, and an unusable stored preference lands on her', () => {
  assert.equal(tts.COACH_VOICE_DEFAULT, 'molly');
  ['', '   ', null, undefined, 'zoe', '../../etc', 42, {}, ['harry']]
    .forEach(v => assert.equal(tts.resolveVoiceKey(v), 'molly',
      'an unusable preference did not fall back to Molly: ' + String(v)));
  /* A real choice is not lost to casing or a stray space. */
  assert.equal(tts.resolveVoiceKey('HARRY'), 'harry');
  assert.equal(tts.resolveVoiceKey(' Joanna '), 'joanna');
});

test('a voice can be repointed by env without a code release', () => {
  assert.equal(withEnv({ ELEVENLABS_VOICE_ID: 'replacement-default-id' },
    () => tts.resolveVoiceId('molly')), 'replacement-default-id');
  assert.equal(withEnv({ ELEVENLABS_VOICE_ID_HARRY: 'replacement-harry-id' },
    () => tts.resolveVoiceId('harry')), 'replacement-harry-id');
});

test('the client cannot bill this account for an arbitrary voice', async () => {
  await withEnvAsync(LIVE, () => withVendor(audioOk, async (calls) => {
    const res = mkRes();
    /* A caller naming a voice id directly rather than one of our keys. */
    await tts.handle(req({ text: BRIEFING, voice: 'SomeExpensiveClonedVoiceId' }), res);
    assert.equal(res.code, 200);
    assert.ok(String(calls[0].url).indexOf('SomeExpensiveClonedVoiceId') === -1,
      'an arbitrary voice id reached the vendor');
    assert.ok(String(calls[0].url).indexOf(tts.resolveVoiceId('molly')) !== -1,
      'an unknown key should have resolved to the default voice');
  }));
});

// ---------------------------------------------------------------------------
// 5. CACHE IDENTITY — CONTENT, NOT DATE
// ---------------------------------------------------------------------------
test('cache identity separates every input that can change the audio', () => {
  const k = (t,v,m,f,s) => tts.ttsCacheKey(t,v,m,f,s);
  const base = k(BRIEFING, 'v-molly', 'model-a', 'fmt-a', { stability: 0.5 });
  assert.equal(base, k(BRIEFING, 'v-molly', 'model-a', 'fmt-a', { stability: 0.5 }),
    'identical inputs produced different keys -- the cache would never hit');
  assert.notEqual(base, k(BRIEFING + '!', 'v-molly', 'model-a', 'fmt-a', { stability: 0.5 }),
    'a changed briefing reused a stale key');
  assert.notEqual(base, k(BRIEFING, 'v-harry', 'model-a', 'fmt-a', { stability: 0.5 }),
    'two different voices share a cache key -- Harry would speak in Molly\'s audio');
  assert.notEqual(base, k(BRIEFING, 'v-molly', 'model-b', 'fmt-a', { stability: 0.5 }),
    'a model change reused stale audio');
  assert.notEqual(base, k(BRIEFING, 'v-molly', 'model-a', 'fmt-b', { stability: 0.5 }),
    'a format change reused stale audio');
  assert.notEqual(base, k(BRIEFING, 'v-molly', 'model-a', 'fmt-a', { stability: 0.9 }),
    'a voice-settings change reused stale audio');
});

test('the cache key carries no athlete identity and no briefing text', () => {
  const key = tts.ttsCacheKey(BRIEFING, tts.resolveVoiceId('molly'),
    tts.TTS_MODEL_DEFAULT, tts.TTS_OUTPUT_FORMAT, tts.TTS_VOICE_SETTINGS);
  assert.match(key, /^[0-9a-f]{64}$/, 'the key is not an opaque digest');
  assert.equal(key.indexOf('easy'), -1);
  assert.equal(key.indexOf('molly'), -1);
});

test('two coach voices cannot collide on the real production identity', () => {
  const keyFor = (v) => tts.ttsCacheKey(BRIEFING, tts.resolveVoiceId(v),
    tts.TTS_MODEL_DEFAULT, tts.TTS_OUTPUT_FORMAT, tts.TTS_VOICE_SETTINGS);
  const keys = ['molly','joanna','harry','andrew'].map(keyFor);
  assert.equal(new Set(keys).size, 4, 'two coach voices share a cache key');
});

// ---------------------------------------------------------------------------
// 6. THE CACHE, AND WHAT IT SAVES
// ---------------------------------------------------------------------------
test('a second identical press is served from cache and never reaches the vendor', async () => {
  await withEnvAsync(LIVE, () => withVendor(audioOk, async (calls) => {
    const first = mkRes();
    await tts.handle(req({ text: BRIEFING, voice:'molly' }), first);
    assert.equal(first.headers['x-vvv-tts'], 'miss');
    const second = mkRes();
    await tts.handle(req({ text: BRIEFING, voice:'molly' }), second);
    assert.equal(second.headers['x-vvv-tts'], 'hit');
    assert.equal(calls.length, 1, 'a cache hit still called the vendor -- that is the bill');
    assert.deepEqual(Buffer.from(second.ended), Buffer.from(first.ended),
      'the cached audio differs from what was generated');
  }));
});

test('a changed briefing regenerates, and a changed voice regenerates', async () => {
  await withEnvAsync(LIVE, () => withVendor(audioOk, async (calls) => {
    await tts.handle(req({ text: BRIEFING, voice:'molly' }), mkRes());
    await tts.handle(req({ text: BRIEFING + ' Watch for racing it.', voice:'molly' }), mkRes());
    assert.equal(calls.length, 2, 'a changed briefing was served stale audio');
    await tts.handle(req({ text: BRIEFING, voice:'harry' }), mkRes());
    assert.equal(calls.length, 3, 'Harry was served Molly\'s audio');
  }));
});

test('two simultaneous presses become one vendor request', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  await withEnvAsync(LIVE, () => withVendor(async () => { await gate; return audioOk(); },
    async (calls) => {
      const a = tts.handle(req({ text: BRIEFING, voice:'molly' }), mkRes());
      const b = tts.handle(req({ text: BRIEFING, voice:'molly' }), mkRes());
      release();
      await Promise.all([a, b]);
      assert.equal(calls.length, 1, 'concurrent presses opened ' + calls.length + ' billable requests');
    }));
});

test('an expired entry is regenerated rather than played', () => {
  tts.cacheReset();
  const now = 1000000;
  tts.cachePut('k', Buffer.from([1,2,3]), now);
  assert.ok(tts.cacheGet('k', now + 1000), 'a fresh entry was dropped');
  assert.equal(tts.cacheGet('k', now + tts.TTS_CACHE_TTL_MS + 1), null,
    'an expired entry was served -- coaching audio must not be a permanent archive');
  tts.cacheReset();
});

test('the cache is bounded, so it can never become an archive', () => {
  tts.cacheReset();
  const now = 1000000;
  for (let i = 0; i < tts.TTS_CACHE_MAX + 10; i++) tts.cachePut('k' + i, Buffer.from([i]), now);
  assert.ok(tts._cache.size <= tts.TTS_CACHE_MAX,
    'the cache grew past its bound: ' + tts._cache.size);
  assert.equal(tts.cacheGet('k0', now), null, 'the oldest entry was not evicted');
  tts.cacheReset();
});

test('nothing here writes audio to disk or to a database', () => {
  assert.ok(!/require\(['"]fs['"]\)/.test(TTS_SRC), 'the speech route touches the filesystem');
  assert.ok(!/supabase|from\(['"]/i.test(TTS_SRC), 'the speech route reaches a database');
});

// ---------------------------------------------------------------------------
// 7. EVERY FAILURE ENDS SOMEWHERE THE CLIENT CAN FALL BACK FROM
// ---------------------------------------------------------------------------
test('a refused key fails soft, and is not retried', async () => {
  await withEnvAsync(LIVE, () => withVendor(async () => ({ ok:false, status:401 }), async (calls) => {
    const res = mkRes();
    await tts.handle(req({ text: BRIEFING }), res);
    assert.equal(res.code, 502);
    assert.match(String(res.body), /tts_unavailable/);
    assert.equal(calls.length, 1, 'a failure was retried -- one press must be at most one request');
  }));
});

test('a vendor outage fails soft', async () => {
  await withEnvAsync(LIVE, () => withVendor(async () => { throw new Error('socket hang up'); },
    async () => {
      const res = mkRes();
      await tts.handle(req({ text: BRIEFING }), res);
      assert.equal(res.code, 502);
    }));
});

test('a timeout fails soft rather than hanging the briefing', async () => {
  await withEnvAsync(LIVE, () => withVendor(async () => {
    const e = new Error('aborted'); e.name = 'AbortError'; throw e;
  }, async () => {
    const res = mkRes();
    await tts.handle(req({ text: BRIEFING }), res);
    assert.equal(res.code, 502);
  }));
  assert.ok(tts.TTS_TIMEOUT_MS > 0 && tts.TTS_TIMEOUT_MS <= 15000,
    'the wait is unbounded or longer than an athlete standing in a doorway will accept');
  assert.match(TTS_SRC, /AbortController/, 'the request is not cancellable');
});

test('empty audio is treated as a failure, not played as silence', async () => {
  await withEnvAsync(LIVE, () => withVendor(async () => ({ ok:true, status:200,
    arrayBuffer: async () => new Uint8Array([]).buffer }), async () => {
      const res = mkRes();
      await tts.handle(req({ text: BRIEFING }), res);
      assert.equal(res.code, 502);
    }));
});

test('a failed generation does not poison the cache', async () => {
  await withEnvAsync(LIVE, async () => {
    let firstCall = true;
    await withVendor(async () => {
      if (firstCall){ firstCall = false; throw new Error('transient'); }
      return audioOk();
    }, async (calls) => {
      const bad = mkRes();
      await tts.handle(req({ text: BRIEFING }), bad);
      assert.equal(bad.code, 502);
      const good = mkRes();
      await tts.handle(req({ text: BRIEFING }), good);
      assert.equal(good.code, 200, 'a failure was cached and the athlete could never recover');
      assert.equal(calls.length, 2);
    });
  });
});

// ---------------------------------------------------------------------------
// 8. LOGGING — FACTS ONLY
// ---------------------------------------------------------------------------
test('no log line can carry the briefing, the key or the athlete', async () => {
  const lines = [];
  const realLog = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    await withEnvAsync({ ELEVENLABS_API_KEY: 'secret-key-value' },
      () => withVendor(async () => ({ ok:false, status:429 }), async () => {
        await tts.handle(req({ text: BRIEFING, voice:'harry' }), mkRes());
      }));
    await withEnvAsync({ ELEVENLABS_API_KEY: 'secret-key-value' },
      () => withVendor(audioOk, async () => {
        await tts.handle(req({ text: BRIEFING, voice:'harry' }), mkRes());
      }));
  } finally { console.log = realLog; }

  assert.ok(lines.length, 'nothing was logged at all -- operations cannot see this route');
  const all = lines.join('\n');
  assert.equal(all.indexOf('secret-key-value'), -1, 'the API key was logged');
  assert.equal(all.indexOf('Nice easy one'), -1, 'the spoken briefing was logged');
  assert.equal(all.indexOf('athlete-1'), -1, 'the athlete was logged');
  /* And the facts operations actually need are there. */
  assert.match(all, /chars=\d+/, 'no character count -- cost is unobservable');
  assert.match(all, /ms=\d+/, 'no latency');
  assert.match(all, /voice=harry/, 'no voice');
  assert.match(all, /fault=provider_429/, 'no failure classification');
});

// ---------------------------------------------------------------------------
// 9. THE ROUTER, AND THE BOUNDARIES THIS CHANGE MUST NOT MOVE
// ---------------------------------------------------------------------------
test('the voice router serves speech alongside Ask Coach, on one function', () => {
  const r = require('../api/voice.js');
  assert.deepEqual(r.ROUTES.slice().sort(), ['voice-ask','voice-enabled','voice-tts']);
  assert.equal(r.resolveRoute({ url:'/api/voice?route=voice-tts', query:{} }), 'voice-tts');
  assert.equal(r.resolveRoute({ url:'/api/voice-tts', query:{} }), 'voice-tts');
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.ok(JSON.stringify(vercel).indexOf('route=voice-tts') !== -1,
    'the rewrite is missing -- the route would 404 in production');
});

test('Ask Coach was not touched by the speech change', () => {
  const ask = fs.readFileSync(path.join(ROOT, 'api', '_voice-ask.js'), 'utf8');
  assert.ok(!/elevenlabs/i.test(ask), 'the speech vendor leaked into the Ask Coach path');
  assert.equal(V.VOICE_MODEL, 'claude-opus-5', 'the Ask Coach model changed');
});

test('the speech route holds no Strava or health surface at all', () => {
  /* It borrows _strava.js for config() and verifyUser() -- the shared Supabase
     helpers happen to live there -- and that is the ONLY Strava word allowed.
     What must not exist is any REASONING about Strava or health: no
     provenance check, no ingestion, no derived-day question, no heart rate,
     readiness or RPE. The route sees words, and words have no provenance left
     to decide about -- aiEligibleDays() and the health-consent fence already
     ran, on the device, before the briefing existed. */
  /* CODE, NOT PROSE. The file's own header comment describes what it must
     never receive, and a naive grep would read that description as the thing
     it warns about. */
  const code = TTS_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const stravaWords = (code.match(/strava/gi) || []).length;
  const allowed = (code.match(/_strava\.js/g) || []).length;
  assert.equal(stravaWords, allowed,
    'the speech route mentions Strava beyond borrowing the shared auth helper');
  [/isStravaDerived/, /aiEligibleDays/, /activity_id/, /\bathleteId\b/,
   /healthConsent/, /readiness/, /\brpe\b/, /heart[_ ]?rate/i]
    .forEach(re => assert.ok(!re.test(code),
      'the speech route reasons about data it should never see: ' + re));
});
