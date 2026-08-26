// The spoken briefing: the SAME coaching, said out loud like a person.
//
//   POST -> { lines: [...], level } -> { lines: [...], spoken: boolean }
//
// WHY THIS EXISTS. LISTEN used to read the card. voiceSpeakable() made the
// written text PRONOUNCEABLE -- it expanded "4:09/km" into "4 minutes 9 seconds
// per kilometre" and dropped card labels -- but it never rephrased anything, so
// what the athlete heard was the written paragraph, in written register, with
// written repetition, read aloud. Correct, and nothing like being coached.
//
// WHAT THIS MAY DO. Condense. Rephrase. Join related points. Drop repetition
// that only existed because a card has sections. Sound like speech.
//
// WHAT THIS MAY NOT DO, AND CANNOT. Valhalla's deterministic engine remains the
// only thing that decides anything. This layer receives text the engine has
// ALREADY produced and returns a spoken version of that same text. It never
// sees the plan, never sees the database, and never returns a number the
// engine did not already say -- which is not a matter of prompting but of the
// guard below, applied to every reply before it is accepted.
//
// IT CANNOT BREAK LISTEN. Every failure path -- unreachable, refused, declined,
// truncated, guard-tripped -- returns the deterministic lines it was given.
// The athlete always hears their briefing; on a bad day they hear the written
// one, which is exactly what they heard before this file existed.

const V = require('./_voice.js');
/* THE ONE MODEL CALL SITE, borrowed rather than reopened. This file must never
   name a model endpoint: test/stravaPolicyBoundary.test.js asserts exactly one
   file in api/ does, and that is the point -- one door to guard. */
const A = require('./_voice-ask.js');

/* Shorter than Ask Coach's ceiling because the job is smaller: the input is a
   handful of sentences and the output must be shorter than the input. Still
   generous enough that adaptive thinking cannot eat the whole budget before
   reaching the text, which is the failure this endpoint's sibling has had. */
const BRIEF_MAX_TOKENS = 8000;

const SYSTEM = [
  'You turn a running coach\'s written notes into what that coach would SAY out loud.',
  'You are not the coach. You do not decide anything. Every judgement, number and',
  'instruction has already been made by Valhalla\'s engine and is in the text you are given.',
  '',
  'YOUR ONLY JOB is to say that same thing the way a person says it.',
  'Condense it. Join related points into one sentence. Drop repetition that exists only',
  'because a screen has separate sections. Use contractions. Keep it flowing.',
  '',
  'HARD RULES.',
  '1. Never introduce a number, pace, distance, heart rate, percentage or date that is not',
  '   already in the text. Not one. If you are unsure whether a number was there, leave it out.',
  '2. Never add advice, encouragement or context of your own. If the notes do not say it,',
  '   it does not get said. No "remember to hydrate", no "you\'ve got this".',
  '3. Never contradict the notes, never soften a caution, and never turn a maybe into a will.',
  '4. Never mention the notes, the app, the engine, yourself, or that you are summarising.',
  '   You are simply speaking.',
  '',
  'HOW YOU SOUND. Warm, calm, direct, British. A serious coach talking to an adult athlete',
  'before they head out. No greeting, no sign-off, no headings, no bullet points, no emoji.',
  'Shorter than what you were given -- always.',
  '',
  'OUTPUT. The spoken words themselves and nothing else. No quotes, no JSON, no preamble.'
].join('\n');

/* ---------- the guard that makes the rule enforceable ----------

   A prompt asking a model not to invent numbers is a request. This is the
   check. Every run of digits in the reply must already appear somewhere in the
   text the engine produced; if even one does not, the reply is thrown away and
   the athlete hears the deterministic briefing instead.

   SET SEMANTICS, NOT MULTISET, and the asymmetry is deliberate. Dropping a
   number is condensing, which is the whole job. Saying an existing number twice
   is emphasis. Introducing one that was never there is the only thing that can
   change what the athlete is told to run -- so that, and only that, fails. */
function numbersIn(s){ return String(s == null ? '' : s).match(/\d+/g) || []; }

function inventsNumber(source, reply){
  const known = Object.create(null);
  numbersIn(source).forEach(function(n){ known[n] = true; });
  return numbersIn(reply).some(function(n){ return !known[n]; });
}

/* Strava markers, checked here for the same reason _voice-ask.js checks them:
   the browser fences this before sending, and a marker arriving anyway means
   the fence failed. A failed fence is answered by sending nothing. */
const STRAVA_MARKER = /stravaActivityId|strava_activity|"source"\s*:\s*"strava"/i;

function tidy(s){
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/* The reply is prose, not JSON -- there is nothing to parse and nothing to
   negotiate. It is split back into sentences so the client can speak it in the
   same shape it speaks the deterministic lines. */
function toLines(text){
  return tidy(text)
    .replace(/^["'“‘]+|["'”’]+$/g, '')
    .split(/(?<=[.!?])\s+/)
    .map(tidy)
    .filter(Boolean);
}

async function handle(req, res){
  const cfg = V.voiceConfig();

  if (req.method !== 'POST'){
    res.setHeader('Allow', 'POST');
    return V.json(res, 405, { error: 'method_not_allowed' });
  }

  const body = V.readBody(req);
  const given = Array.isArray(body && body.lines)
    ? body.lines.map(tidy).filter(Boolean).slice(0, 40)
    : [];
  if (!given.length) return V.json(res, 400, { error: 'no_lines' });

  /* THE FALLBACK IS THE INPUT, and it is computed before anything can go wrong
     so that every early return below is one line rather than a decision. */
  const fallback = { lines: given, spoken: false };

  /* Switched off, or not commissioned: the deterministic briefing is not an
     error state, it is the product working. No 4xx, no toast, no silence. */
  if (!cfg.enabled || !cfg.apiKey) return V.json(res, 200, fallback);

  const who = await V.verifyUser(req, require('./_strava.js').config());
  if (!who.uid){
    V.log('BRIEF rejected ' + who.code);
    return V.json(res, 401, { error: 'not_signed_in', code: who.code });
  }

  const source = given.join(' ');
  if (STRAVA_MARKER.test(source)){
    V.log('BRIEF REFUSED strava_marker_in_lines');
    return V.json(res, 422, { error: 'context_refused', code: 'STRAVA_DERIVED_CONTEXT' });
  }

  const level = (body && body.level) === 'concise' ? 'concise' : 'full';
  const payload = {
    model: cfg.model,
    max_tokens: BRIEF_MAX_TOKENS,
    system: SYSTEM + (level === 'concise'
      ? '\n\nTHIS ONE IS CONCISE. Two sentences at most.'
      : '\n\nKeep it to four sentences at most.'),
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: source }]
  };

  let r;
  try{ r = await A.postModel(cfg, payload); }
  catch(e){
    V.log('BRIEF unreachable -- spoke the written briefing');
    return V.json(res, 200, fallback);
  }

  if (!r.ok){
    let kind = '';
    try{ const b = await r.json(); kind = String((b && b.error && b.error.type) || ''); }
    catch(e){ kind = 'unreadable'; }
    V.log('BRIEF upstream status=' + r.status + ' type=' + (kind || 'none') +
          ' -- spoke the written briefing');
    return V.json(res, 200, fallback);
  }

  let data;
  try{ data = await r.json(); }
  catch(e){
    V.log('BRIEF malformed_body -- spoke the written briefing');
    return V.json(res, 200, fallback);
  }

  if (data && data.stop_reason === 'refusal'){
    V.log('BRIEF declined -- spoke the written briefing');
    return V.json(res, 200, fallback);
  }

  const text = (data && Array.isArray(data.content) ? data.content : [])
    .filter(function(b){ return b && b.type === 'text'; })
    .map(function(b){ return b.text; }).join('\n');

  const out = toLines(text);
  const outTokens = Number((data && data.usage && data.usage.output_tokens) || 0);

  if (!out.length){
    V.log('BRIEF empty stop=' + String((data && data.stop_reason) || 'none') +
          ' out=' + outTokens + ' -- spoke the written briefing');
    return V.json(res, 200, fallback);
  }

  /* THE GUARD, and the only outcome worth a loud log line: it means the model
     said a number the coach did not. Nothing is repaired and nothing is
     stripped -- the whole reply is discarded, because a paraphrase that
     invented one figure has proved it will invent another. */
  if (inventsNumber(source, out.join(' '))){
    V.log('BRIEF REJECTED invented_number -- spoke the written briefing');
    return V.json(res, 200, fallback);
  }

  V.log('BRIEF ok lines=' + out.length + ' out=' + outTokens + ' level=' + level);
  return V.json(res, 200, { lines: out, spoken: true });
}

module.exports = { handle, SYSTEM, numbersIn, inventsNumber, toLines };
