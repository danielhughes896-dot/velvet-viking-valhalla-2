// Velvet Viking -- premium speech for the Hear Today briefing.
//
//   POST /api/voice-tts   { text, voice } -> audio/mpeg
//
// WHAT THIS IS, AND THE LINE IT DOES NOT CROSS.
// ===========================================================================
// This is a LOUDSPEAKER, not a coach. The words it speaks were composed by
// Valhalla's own deterministic engine on the athlete's device -- see
// voiceBriefingScript() in the runtime -- and this route renders those exact
// words as audio. ElevenLabs is never asked what to say, never asked to
// rephrase, summarise, shorten or improve, and never sees anything except the
// final approved sentences.
//
// That distinction is the same one _voice-ask.js draws around the model it
// talks to, and for the same reason: an earlier pass of the spoken briefing
// sent the assembled lines to a model for "a conversational rephrasing" and
// was removed, because a paraphrase that quietly drops "Watch for racing it"
// passes every guard while changing the coaching the athlete receives.
// Deciding which coaching survives into speech IS coaching. A text-to-speech
// vendor renders; it does not decide.
//
// WHAT ELEVENLABS RECEIVES: the briefing text, a voice id and a model id.
// WHAT IT NEVER RECEIVES: the athlete's identity, plan, training history,
// health or readiness object, Strava payload, Ask Coach conversation, or any
// credential belonging to anything other than this vendor.

const V = require('./_voice.js');
const S = require('./_strava.js');
const crypto = require('crypto');

/* THE ONE PLACE THE VENDOR ENDPOINT IS NAMED. Same discipline as the model
   endpoint in _voice-ask.js: one file, one fetch, greppable.
   test/voiceNativeAndroid.test.js asserts exactly one file in api/ names it
   and that the browser runtime never reaches it at all. */
const TTS_ENDPOINT = 'https://api.elevenlabs.io/v1/text-to-speech/';

/* MODEL CHOICE -- see TTS-VOICE-REPORT.md for the full reasoning.
   eleven_multilingual_v2 is ElevenLabs' production English quality tier: the
   strongest prosody available outside eleven_v3, without v3's documented
   unsuitability for latency-sensitive use, and stable enough that the same
   briefing read twice sounds like the same coach. Overridable by env so the
   choice can be re-tested live without a code release. */
const TTS_MODEL_DEFAULT = 'eleven_multilingual_v2';

/* mp3 at 44.1kHz/128kbps: ElevenLabs' own default, and the format Android
   WebView and mobile Safari both play from a blob without a codec question.
   Deliberately not PCM (large, and gated to higher plans) and not a streaming
   format -- a four-sentence briefing is one small file. */
const TTS_OUTPUT_FORMAT = 'mp3_44100_128';

/* A BOUNDED WAIT, ONCE. No retry: a retry doubles the cost of a bad minute
   and delays the fallback the athlete can actually hear. Native TTS is
   already on the device and is a better answer than a second attempt. */
const TTS_TIMEOUT_MS = 8000;

/* A briefing is four sentences. This is a wide ceiling that still refuses
   anything that is obviously not a briefing -- a pasted document, a loop that
   concatenated. Cost control and abuse control at once. */
const TTS_MAX_CHARS = 1200;

/* ---------- THE COACH VOICES ----------
   A CLOSED CATALOGUE, RESOLVED SERVER-SIDE. The client sends a KEY ('molly'),
   never a voice id, so no caller can bill this account for synthesis with an
   arbitrary voice. Each key may be repointed by env without a code release --
   which is also how ELEVENLABS_VOICE_ID, already set in production, keeps
   meaning "the default coach voice".

   Voice IDs are not secrets. They identify a public catalogue entry, they
   authorise nothing on their own, and the founder's brief says as much. The
   API KEY is the secret, and it never leaves this file's process. */
const COACH_VOICES = {
  molly:  { label: 'Molly',  env: 'ELEVENLABS_VOICE_ID',        id: 'jkSXBeN4g5pNelNQ3YWw' },
  joanna: { label: 'Joanna', env: 'ELEVENLABS_VOICE_ID_JOANNA', id: 'dVoi15NNDJligFBwnVO0' },
  harry:  { label: 'Harry',  env: 'ELEVENLABS_VOICE_ID_HARRY',  id: '8Qks38ENjPxXSdubdeg8' },
  andrew: { label: 'Andrew', env: 'ELEVENLABS_VOICE_ID_ANDREW', id: 'jR6tjweqjDI3m7B2nd5t' }
};
const COACH_VOICE_DEFAULT = 'molly';

function env(name){ return process.env[name] || ''; }

/* An unknown, missing or malformed key resolves to Molly rather than failing.
   A stored preference that no longer exists is a reason to speak in the
   default voice, not a reason for the athlete's briefing to go silent. */
function resolveVoiceKey(key){
  /* A STRING OR NOTHING. `String(['harry'])` is 'harry', so coercing first
     would let a JSON array select a voice -- harmless today, and exactly the
     kind of accidental surface that stops being harmless when the catalogue
     grows. A preference that is not a string is not a preference. */
  if (typeof key !== 'string') return COACH_VOICE_DEFAULT;
  const k = key.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(COACH_VOICES, k) ? k : COACH_VOICE_DEFAULT;
}
function resolveVoiceId(key){
  const entry = COACH_VOICES[resolveVoiceKey(key)];
  const override = env(entry.env).trim();
  return override || entry.id;
}
function ttsModel(){ return env('VVV_TTS_MODEL').trim() || TTS_MODEL_DEFAULT; }

/* ---------- FAIL CLOSED ----------
   Both halves, exactly like voiceConfig(): a deployment with a key but no
   resolvable voice, or a voice but no key, is misconfigured rather than
   half-working. The client's answer to either is the same -- speak with the
   device's own engine -- so the athlete never meets a dead button. */
function ttsConfig(){
  const apiKey = env('ELEVENLABS_API_KEY');
  return {
    apiKey: apiKey,
    ready: !!(apiKey && apiKey.trim() && resolveVoiceId(COACH_VOICE_DEFAULT)),
    model: ttsModel(),
    format: TTS_OUTPUT_FORMAT
  };
}

/* Settled, and part of the cache identity. Slightly above ElevenLabs' default
   stability so a coach reading paces twice sounds like the same coach, with
   style left at zero -- a briefing is information, not a performance. */
const TTS_VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.8, style: 0, use_speaker_boost: true };

/* ---------- CACHE IDENTITY ----------
   CONTENT-ADDRESSED, NOT DATE-ADDRESSED. Everything that can change a single
   sample of audio goes into the hash and nothing else does:

     the exact approved spoken text   (Guidance Level, session type, the
                                       athlete's paces and every adaptive
                                       decision all reach us only as WORDS,
                                       so hashing the words covers all of them
                                       -- there is no second input to miss)
     the resolved voice id            (Molly and Harry must never share a key)
     the model id                     (a model change re-renders everything)
     the output format                (ditto)
     the voice settings               (ditto)

   The key is an opaque SHA-256 hex digest. No athlete identifier goes in, and
   the text is hashed rather than stored in the key: a key can be logged, a
   briefing cannot. */
function ttsCacheKey(text, voiceId, model, format, settings){
  return crypto.createHash('sha256')
    .update([String(text), String(voiceId), String(model), String(format),
             JSON.stringify(settings || {})].join(' '))
    .digest('hex');
}

/* ---------- THE SERVER-SIDE CACHE ----------
   IN MEMORY, PER INSTANCE, SHORT-LIVED, AND DELIBERATELY NOT A DATABASE.
   Athlete coaching audio is not archived: this is a warm buffer that dies with
   the process and expires before that. The client holds the cache that
   actually saves most of the money (a hit there never leaves the phone); this
   one catches the rest -- a second device, a reload, a re-render -- and, more
   importantly, it is where CONCURRENT presses are collapsed into one vendor
   request via the in-flight map below. */
const TTS_CACHE_TTL_MS = 30 * 60 * 1000;
const TTS_CACHE_MAX = 24;
const ttsCache = new Map();     // key -> { audio: Buffer, at: number }
const ttsInflight = new Map();  // key -> Promise<Buffer>

function cacheGet(key, now){
  const hit = ttsCache.get(key);
  if (!hit) return null;
  if ((now - hit.at) > TTS_CACHE_TTL_MS){ ttsCache.delete(key); return null; }
  /* Touch: Map preserves insertion order, so re-inserting makes the eviction
     below least-recently-USED rather than merely oldest. */
  ttsCache.delete(key); ttsCache.set(key, hit);
  return hit.audio;
}
function cachePut(key, audio, now){
  ttsCache.set(key, { audio: audio, at: now });
  while (ttsCache.size > TTS_CACHE_MAX){
    const oldest = ttsCache.keys().next();
    if (oldest.done) break;
    ttsCache.delete(oldest.value);
  }
}
function cacheReset(){ ttsCache.clear(); ttsInflight.clear(); }

/* ---------- THE ONE VENDOR CALL ----------
   Bounded, cancellable, and not retried. */
async function synthesise(cfg, voiceId, text){
  const controller = (typeof AbortController === 'function') ? new AbortController() : null;
  const timer = controller ? setTimeout(function(){ try{ controller.abort(); }catch(e){} }, TTS_TIMEOUT_MS) : null;
  try{
    const r = await fetch(TTS_ENDPOINT + encodeURIComponent(voiceId) +
                          '?output_format=' + encodeURIComponent(cfg.format), {
      method: 'POST',
      headers: {
        'xi-api-key': String(cfg.apiKey || '').trim(),
        'content-type': 'application/json',
        'accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text: text,
        model_id: cfg.model,
        voice_settings: TTS_VOICE_SETTINGS
      }),
      signal: controller ? controller.signal : undefined
    });
    if (!r.ok){
      /* The vendor's own error body can quote the request back. It is read for
         a status code and discarded -- never logged, never returned. */
      const err = new Error('tts_provider_' + r.status);
      err.status = r.status;
      throw err;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) throw new Error('tts_empty');
    return buf;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* Two presses of Hear Today a quarter-second apart are ONE generation. The
   second await joins the first promise rather than opening a second billable
   request -- this is the whole of the "no request storm" guarantee on the
   server side, and it holds across athletes too, because the key is the
   content and not the account. */
function generateOnce(key, cfg, voiceId, text, now){
  const running = ttsInflight.get(key);
  if (running) return running;
  const p = synthesise(cfg, voiceId, text)
    .then(function(buf){ cachePut(key, buf, now); return buf; })
    .finally(function(){ ttsInflight.delete(key); });
  ttsInflight.set(key, p);
  return p;
}

async function handle(req, res){
  if (req.method !== 'POST'){
    res.setHeader('Allow', 'POST');
    return V.json(res, 405, { error: 'method_not_allowed' });
  }
  res.setHeader('cache-control', 'no-store');

  const cfg = ttsConfig();
  /* FAIL CLOSED, AND SAY WHICH KIND OF CLOSED. The client latches on this
     answer and stops asking for the rest of the session, so an uncommissioned
     deployment costs exactly one request and then speaks natively. */
  if (!cfg.ready){
    V.log('TTS unconfigured');
    return V.json(res, 503, { error: 'tts_unconfigured' });
  }

  /* Synthesis costs money per character, so it is not offered to an
     unauthenticated caller. A signed-out athlete is not cut off from their
     briefing -- the device speaks it. */
  const who = await V.verifyUser(req, S.config());
  if (!who || !who.uid){
    V.log('TTS refused reason=auth');
    return V.json(res, 401, { error: 'not_signed_in' });
  }

  const body = V.readBody(req);
  const text = String((body && body.text) || '').trim();
  if (!text) return V.json(res, 400, { error: 'tts_no_text' });
  if (text.length > TTS_MAX_CHARS){
    V.log('TTS refused reason=too_long chars=' + text.length);
    return V.json(res, 413, { error: 'tts_too_long' });
  }

  const voiceKey = resolveVoiceKey(body && body.voice);
  const voiceId = resolveVoiceId(voiceKey);
  const key = ttsCacheKey(text, voiceId, cfg.model, cfg.format, TTS_VOICE_SETTINGS);
  const now = Date.now();
  const startedAt = now;

  /* A HIT NEVER REACHES THE VENDOR. That is the point of the cache and it is
     asserted by test rather than assumed. */
  const cached = cacheGet(key, now);
  if (cached){
    V.log('TTS hit chars=' + text.length + ' voice=' + voiceKey + ' model=' + cfg.model);
    res.setHeader('content-type', 'audio/mpeg');
    res.setHeader('x-vvv-tts', 'hit');
    return res.end(cached);
  }

  let audio;
  try{
    audio = await generateOnce(key, cfg, voiceId, text, now);
  }catch(e){
    /* CLASSIFIED, NEVER QUOTED. A name and a status; no text, no key, no body.
       Every one of these makes the client speak natively instead. */
    const fault = (e && e.name === 'AbortError') ? 'timeout'
                : (e && e.status) ? ('provider_' + e.status)
                : (e && e.message === 'tts_empty') ? 'empty'
                : ((e && e.name) || 'Error');
    V.log('TTS fail fault=' + fault + ' ms=' + (Date.now() - startedAt) +
          ' chars=' + text.length + ' voice=' + voiceKey + ' model=' + cfg.model);
    return V.json(res, 502, { error: 'tts_unavailable' });
  }

  V.log('TTS ok ms=' + (Date.now() - startedAt) + ' chars=' + text.length +
        ' bytes=' + audio.length + ' voice=' + voiceKey + ' model=' + cfg.model);
  res.setHeader('content-type', 'audio/mpeg');
  res.setHeader('x-vvv-tts', 'miss');
  return res.end(audio);
}

module.exports = {
  handle,
  TTS_ENDPOINT, TTS_MODEL_DEFAULT, TTS_OUTPUT_FORMAT, TTS_TIMEOUT_MS, TTS_MAX_CHARS,
  TTS_VOICE_SETTINGS, TTS_CACHE_TTL_MS, TTS_CACHE_MAX,
  COACH_VOICES, COACH_VOICE_DEFAULT,
  resolveVoiceKey, resolveVoiceId, ttsModel, ttsConfig, ttsCacheKey,
  cacheGet, cachePut, cacheReset,
  _cache: ttsCache, _inflight: ttsInflight
};
