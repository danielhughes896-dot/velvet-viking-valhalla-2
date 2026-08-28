// Ask Coach. The one place Valhalla speaks to a language model.
//
//   POST { question, context } -> { answer, grounded, proposal? }
//
// THE DETERMINISTIC ENGINE REMAINS THE AUTHORITY, and this file is where that
// is enforced rather than hoped for:
//
//   * the model is given the athlete's CONTEXT, already assembled and already
//     fenced by the browser (Strava-derived days removed, health information
//     withheld without consent). It is never given the athlete's state, and it
//     cannot ask for more;
//   * the model returns TEXT, and optionally a flag saying it believes a plan
//     change is warranted. It cannot name a session, a distance, a pace or a
//     date to change anything to. The app maps that flag onto the adjustment
//     Valhalla's OWN engine had already computed, or ignores it;
//   * nothing here writes to a plan, and this endpoint has no database access
//     of any kind. The service-role key is not read in this file.
//
// So the worst a compromised or hallucinating model can do is say something
// unhelpful. It cannot move a session, change a pace, or alter one byte of the
// athlete's training record.

const V = require('./_voice.js');
/* The response contract and the ONLY code that understands it. Both transports
   below -- streamed and not -- read the model's reply through this one module,
   which is what stops the fallback becoming a second set of rules. */
const PROTO = require('./_voice-protocol.js');
const SSE = require('./_voice-sse.js');

/* Named here, beside the only fetch that uses them, rather than in the shared
   module -- see the note in _voice.js. One file in api/ names a model. */
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
/* 16000, AND THE HISTORY OF THIS NUMBER IS THE HISTORY OF THE OUTAGE.

   This model runs adaptive thinking by DEFAULT, and thinking tokens are drawn
   from the SAME max_tokens budget as the reply. A ceiling small enough to be
   spent on reasoning alone leaves stop_reason "max_tokens" and NO text block at
   all -- which this endpoint then correctly reports as an empty reply and the
   athlete reads as "your coach is not responding".

   It shipped at 1024, chosen because the answer is meant to be two or three
   sentences. That reasoning was right about the answer and forgot the thinking,
   and it failed every time. It was then raised to 4096, which is enough for
   many questions and not enough for an open one asked against a full training
   context -- so the same failure came back intermittently, which is harder to
   diagnose than a total one.

   16000 is the documented non-streaming default for this model: large enough
   that thinking plus a short answer fit comfortably, small enough to stay well
   inside an HTTP request timeout. THE CEILING IS NOT A TARGET. Billing is on
   tokens actually produced, so a two-sentence reply costs the same at 16000 as
   it did at 1024; the number buys headroom to REACH that reply, nothing else.
   Brevity is still asked for where it belongs -- in the prompt. */
const VOICE_MAX_TOKENS = 16000;

/* The system prompt. Written as a boundary, not a personality: most of it is
   about what the coach may NOT do, because that is the part that has to hold
   when a question is phrased persuasively. */
const SYSTEM = [
  'You are the voice of Valhalla, a running coach inside the Velvet Viking training app.',
  'You are speaking to one athlete about their own training. Your reply will be read aloud.',
  '',
  'WHAT YOU ARE. You explain and discuss coaching decisions that Valhalla has ALREADY made.',
  'The training plan, the paces, the progression and any recommended change are computed by',
  'Valhalla\'s own deterministic engine. You are not that engine and must never act as it.',
  '',
  'HARD RULES.',
  '1. Never invent a session, a distance, a pace, a heart-rate zone or a date. If it is not in',
  '   the context you were given, you do not know it. Say so plainly.',
  '2. Never tell the athlete their plan has been changed. You cannot change it. If you think a',
  '   change is warranted, set needsPlanChange true and explain why in one sentence; Valhalla',
  '   decides whether to offer it, and the athlete decides whether to accept it.',
  '3. Never diagnose, and never give medical advice. For pain, injury or illness: be',
  '   conservative, say plainly that you are a running coach and not a doctor, and recommend',
  '   professional assessment when symptoms warrant it. Do not estimate how serious something is.',
  '4. Never state a number the context does not contain, and never imply certainty the evidence',
  '   does not carry. If heart-rate information is absent, do not reason about heart rate.',
  '5. If the context does not answer the question, say what you do not know rather than guessing.',
  '6. The context may contain a "withheld" section listing information you do not have for this',
  '   conversation. Treat anything listed there as simply unavailable to you. Do NOT infer',
  '   anything from its absence, do not estimate a replacement, and do not speculate about why',
  '   it is missing. If the athlete asks about something withheld -- for example a run that came',
  '   in from a connected app -- say plainly that you cannot go through that one here and offer',
  '   what you CAN discuss. Never mention policies, providers, syncing or data rules; the athlete',
  '   wants their answer, not an explanation of your plumbing.',
  '',
  'HOW YOU SOUND. Warm, calm, direct, British. A serious coach talking to an adult athlete.',
  'Short: two or three sentences unless genuinely more is needed. No greetings, no sign-offs,',
  'no bullet points, no headings, no emoji. No generic advice that would be true for anybody',
  '("remember to hydrate") -- everything you say should be about THIS athlete\'s plan.',
  '',
  /* ---- THE ONLY PART OF THIS PROMPT THE STREAMING PASS TOUCHED ----
     What the coach IS, what it may not do, the medical boundary, the withheld
     -data rule and how it sounds are all above, unchanged. This was
     'Reply with a single JSON object and nothing else', which cannot be
     streamed to a human: the first bytes of a JSON object are not prose, and
     recovering prose from a half-written JSON string needs an escape-aware
     incremental parser. The contract now puts the prose first and the machine
     -readable part last behind a reserved marker, and it lives beside the
     parser that enforces it -- see api/_voice-protocol.js. */
  PROTO.CONTRACT_INSTRUCTION
].join('\n');

function clean(s, max){
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
}

/* THE COMPLETE-REPLY READER, kept under its original name because every caller
   and several tests already know it. It no longer parses JSON itself: the
   contract lives in _voice-protocol.js and this is the non-streamed transport
   asking that one module to read a reply that happened to arrive all at once.

   Failing towards "just answer" is still the direction. A reply whose trailer
   is missing or malformed yields the prose and NO plan change -- never a
   guessed one. */
function parseReply(text){
  const r = PROTO.readComplete(text);
  if (!r.answer) return null;
  return { answer: clean(r.answer, 1200),
           needsPlanChange: r.needsPlanChange,
           changeReason: r.changeReason,
           structured: r.structured,
           why: r.why };
}

async function handle(req, res){
  /* THE DIAGNOSTIC CLOCK. Founder-approved instrumentation to establish where
     a live ~4s Ask Coach actually goes. Milliseconds only -- see the timing
     block above askUpstream() for what is measured, what is NOT measurable on
     a non-streaming call, and why nothing here can carry content. */
  const receivedAt = Date.now();
  const cfg = V.voiceConfig();

  if (req.method !== 'POST'){
    res.setHeader('Allow', 'POST');
    return V.json(res, 405, { error: 'method_not_allowed' });
  }
  if (!cfg.enabled){
    V.log('ASK refused voice_disabled');
    return V.json(res, 403, { error: 'voice_disabled', code: 'VOICE_DISABLED' });
  }
  if (!cfg.apiKey){
    V.log('ASK refused not_configured');
    return V.json(res, 503, { error: 'voice_not_configured', code: 'VOICE_NOT_CONFIGURED' });
  }
  /* A KEY THAT CANNOT BE SENT IS A CONFIGURATION FAULT, NOT AN OUTAGE, and it
     used to present as one: a stray character makes fetch() throw where a dead
     host throws, so the athlete was told the coach was not responding and the
     log said "unreachable". Caught here, named, and reported as what it is. */
  const fault = keyFault(cfg.apiKey);
  if (fault){
    V.log('ASK refused key_' + fault);
    return V.json(res, 503, { error: 'voice_not_configured', code: 'VOICE_KEY_MALFORMED' });
  }

  /* The athlete is identified before anything is sent, for the ordinary reason
     -- this costs money per call and is not an open endpoint -- and because a
     question can carry health information and must belong to a known account. */
  const who = await V.verifyUser(req, require('./_strava.js').config());
  if (!who.uid){
    V.log('ASK rejected ' + who.code);
    return V.json(res, 401, { error: 'not_signed_in', code: who.code });
  }

  const body = V.readBody(req);
  const question = clean(body.question, 500);
  if (!question) return V.json(res, 400, { error: 'no_question' });

  /* The context arrives already assembled and already fenced. It is bounded
     here as well: a browser is not a trusted producer of payload size, and a
     runaway context is a cost incident. */
  let context = body.context && typeof body.context === 'object' ? body.context : {};
  let contextJson = '';
  try{ contextJson = JSON.stringify(context).slice(0, 24000); }catch(e){ contextJson = '{}'; }

  /* DEFENCE IN DEPTH, NOT DECORATION. The browser removes Strava-derived days
     before assembling this. If a marker still arrives, something upstream is
     wrong, and the compliant answer to "something is wrong" on this particular
     boundary is to send nothing at all. Refusing costs one unanswered
     question; guessing costs a policy breach. */
  if (/stravaActivityId|strava_activity|"source"\s*:\s*"strava"/i.test(contextJson)){
    V.log('ASK REFUSED strava_marker_in_context');
    return V.json(res, 422, { error: 'context_refused', code: 'STRAVA_DERIVED_CONTEXT' });
  }

  /* THE BROWSER ASKS, THE SERVER DECIDES. A client that cannot read a stream
     never sends the header and is never sent one; a platform that cannot write
     one degrades inside readStreamed(). Both land on the same contract. */
  return askUpstream(res, cfg, contextJson, question, {
    receivedAt: receivedAt,
    wantStream: clientWantsStream(req) && typeof res.write === 'function'
  });
}

/* THE ONLY PLACE IN THE REPOSITORY THAT NAMES A MODEL ENDPOINT, and it stays
   that way on purpose: test/stravaPolicyBoundary.test.js asserts that exactly
   one file in api/ does. Anything else that needs the model -- the spoken
   briefing paraphrase in _voice-brief.js, and whatever comes after it -- calls
   THIS function rather than opening its own connection, so "how many places can
   reach a model" stays answerable with grep and the Strava boundary keeps one
   door to guard rather than several.

   Deliberately thin. It sends and returns the raw response: no interpretation,
   no res, no logging. Every caller owns its own error handling, because what a
   failure MEANS differs between a conversation and a briefing. */
/* IS THIS KEY EVEN SENDABLE AS A HEADER.

   Established by experiment against the runtime, not assumed:

     embedded CR or LF   -> Headers throws "invalid header value"
     any non-ASCII char  -> Headers throws "Cannot convert ... ByteString"
                            (a smart quote or a zero-width space from a paste)
     TRAILING newline    -> ACCEPTED, and sent to Anthropic as part of the key,
                            which comes back 401 rather than throwing

   The first two throw INSIDE fetch(), before a single byte leaves the process,
   and land in the same catch as a genuine network failure -- which is why a
   malformed key and an unreachable host were indistinguishable in production.
   The third is why the key is trimmed: a trailing newline is invisible in a
   dashboard field and turns a valid key into an authentication failure.

   Returns a CLASS, never the value. Nothing here may be logged verbatim. */
function keyFault(key){
  const raw = String(key == null ? '' : key);
  if (!raw.trim()) return 'missing';
  if (/[\r\n]/.test(raw.trim())) return 'control_char';
  /* eslint-disable-next-line no-control-regex */
  if (/[^\x20-\x7E]/.test(raw.trim())) return 'non_ascii';
  return null;
}

function postModel(cfg, payload){
  /* TRIMMED. Whitespace around a pasted key is invisible where it is entered
     and fatal where it is used. */
  return fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': String(cfg.apiKey || '').trim(),
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}

/* WHY THE OUTBOUND REQUEST FAILED, IN ONE SAFE WORD.

   "ASK unreachable" collapsed every thrown fetch into one message, so a
   production log could not tell a malformed credential from a host that could
   not be reached. Both are TypeErrors from the same line.

   THE DISCRIMINATOR IS `cause`. A genuine network failure is
   "TypeError: fetch failed" carrying cause.code -- ENOTFOUND, ECONNREFUSED,
   UND_ERR_CONNECT_TIMEOUT, a TLS code. A header rejection has no cause at all
   and names Headers or ByteString in its message.

   NOTHING IDENTIFYING IS RETURNED. A class and, where the platform supplied
   one, its error code. Never the key, the question, the answer or the body. */
function transportFault(err){
  if (!err) return 'unknown';
  const cause = err.cause || null;
  const code = cause && (cause.code || cause.name);
  if (code) return 'network:' + String(code).slice(0, 40);
  const msg = String(err.message || '');
  if (/Headers|invalid header value/i.test(msg)) return 'header_rejected';
  if (/ByteString/i.test(msg)) return 'header_non_ascii';
  if (/is not a function|is not defined/i.test(msg)) return 'no_fetch';
  return (err.name || 'Error') + ':unclassified';
}

/* THE MODEL CALL, ON ITS OWN, so the one retry below is a real call rather than
   a copy of one. Everything it needs is passed in; it reads no request and no
   database. */
/* ---------- LATENCY DIAGNOSTIC ----------
   WHAT THIS ANSWERS. Ask Coach takes about four seconds on the founder's phone
   and nothing here has ever said WHERE. The split matters because the fixes are
   opposites: if generation dominates, streaming helps; if thinking dominates,
   streaming shows the athlete an equally long pause and the lever is `effort`
   or a different model for this route.

   WHAT IS MEASURED, all in milliseconds and all server-side:

     pre    request received -> the upstream request is opened.  Our own cost:
            the auth round trip, the Strava boundary and the context handling.
     head   upstream opened -> response HEADERS arrive.
     body   headers -> the body is fully read and parsed.
     total  request received -> our response is sent.

   WHAT IS **NOT** MEASURED, and cannot be. `head` IS NOT TIME-TO-FIRST-TOKEN.
   This is a non-streaming call: there are no tokens on the wire, only a
   complete JSON body, and `fetch` resolves when the response headers arrive --
   which for a non-streamed generation is at or near the END of generation.
   True first-visible-token timing is only observable by actually streaming,
   and streaming is not being implemented here. Any number claiming to be TTFT
   from this endpoint would be invented, so none is produced.

   WHAT THE SPLIT STILL TELLS US. `head` is the whole upstream turn -- thinking
   AND generation together. Read beside the two counts already logged:

     out=   total output tokens, which INCLUDE thinking tokens
     chars= the length of the answer actually returned

   a large `out` against a small `chars` means thinking consumed the turn, and a
   small `out` against a similar `chars` means generation did. That inference is
   an inference and is labelled as one in the report -- it is not a measurement
   of thinking time.

   PRIVACY. Every field is a number or a fixed word. No question, no answer, no
   context, no thinking content, no athlete identifier, no key. Same contract
   the surrounding log lines already hold. */
function askTimings(opts, r){
  const now = Date.now();
  const recv = opts.receivedAt || now;
  const parts = ['total=' + (now - recv)];
  if (opts.upstreamAt) parts.push('pre=' + (opts.upstreamAt - recv));
  if (opts.upstreamAt && opts.headersAt) parts.push('head=' + (opts.headersAt - opts.upstreamAt));
  if (opts.headersAt && r) parts.push('body=' + (now - opts.headersAt));
  return parts.join(' ');
}

/* WHETHER THIS EXCHANGE CAN BE STREAMED TO THE ATHLETE.
   Three things must hold, and any one of them failing degrades to the buffered
   transport rather than to an error: the browser asked for it (a browser that
   cannot read a stream must not be sent one), the platform gives us a writable
   response, and the upstream body is readable. The third is only knowable
   after the upstream call, which is why the emitter below is chosen late. */
const NDJSON = 'application/x-ndjson';
function clientWantsStream(req){
  const a = String((req && req.headers && (req.headers.accept || req.headers.Accept)) || '');
  return a.indexOf(NDJSON) !== -1;
}

/* THE SERVER -> CLIENT PROTOCOL, in full.
   ---------------------------------------------------------------------------
   Newline-delimited JSON, one object per line:

     {"t":"prose","d":"..."}          athlete-facing text, in arrival order
     {"t":"final","complete":true,
      "needsPlanChange":false,
      "changeReason":null}            the turn finished AND the trailer was
                                      found, unambiguous and valid
     {"t":"incomplete","code":"..."}  prose may have arrived; no structured
                                      decision exists for this exchange
     {"t":"error","code":"..."}       failed before any prose

   THE BROWSER NEVER SEES THE PROVIDER'S PROTOCOL. It does not know what SSE
   is, what a content block is, what the sentinel is, or that a trailer
   exists. It receives prose and, at most, one already-validated decision.

   `final` is the ONLY event that can carry needsPlanChange, and it is emitted
   only after message_stop. There is deliberately no way to express "a plan
   change, probably" on this wire. */
function ndjson(res, obj){
  try{ res.write(JSON.stringify(obj) + '\n'); }catch(e){ /* client went away */ }
}

/* Prose is always accumulated; it is additionally written as it arrives when
   the transport can carry it. One protocol machine, two emitters -- which is
   the whole reason the fallback cannot drift from the streamed path. */
function makeEmitter(res, streaming){
  let answer = '';
  return {
    streaming: streaming,
    prose(chunk){
      if (!chunk) return;
      answer += chunk;
      if (streaming) ndjson(res, { t: 'prose', d: chunk });
    },
    get answer(){ return answer; }
  };
}

/* ---------- LATENCY, NOW INCLUDING A REAL TTFT ----------
   The diagnostic that preceded this pass could not measure time-to-first-token
   and said so: on a non-streamed call `fetch` resolves at the END of
   generation, so `head` was the whole upstream turn. Streaming makes the real
   number observable for the first time.

     pre     request received -> upstream opened          (our own cost)
     head    upstream opened -> response headers
     prose   request received -> FIRST ATHLETE-FACING CHARACTER. This is TTFT.
     done    request received -> the model's turn ended
     total   request received -> our response closed

   `prose` deliberately does not start at the SSE connection, and deliberately
   does not count thinking blocks, empty deltas, the sentinel or the trailer --
   only the first character a human could actually read. A number that counted
   any of those would flatter the feature and mislead the next decision.

   Numbers and fixed words only. No question, no answer, no trailer, no
   reasoning, no context, no identifier, no key. */
function streamTimings(t){
  const parts = ['total=' + (Date.now() - t.receivedAt)];
  if (t.upstreamAt) parts.push('pre=' + (t.upstreamAt - t.receivedAt));
  if (t.upstreamAt && t.headersAt) parts.push('head=' + (t.headersAt - t.upstreamAt));
  if (t.firstProseAt) parts.push('prose=' + (t.firstProseAt - t.receivedAt));
  if (t.doneAt) parts.push('done=' + (t.doneAt - t.receivedAt));
  return parts.join(' ');
}

async function askUpstream(res, cfg, contextJson, question, opts){
  opts = opts || {};
  if (!opts.receivedAt) opts.receivedAt = Date.now();
  const payload = {
    model: cfg.model,
    max_tokens: VOICE_MAX_TOKENS,
    system: SYSTEM,
    messages: [{ role: 'user',
                 content: 'My training context:\n' + contextJson +
                          '\n\nMy question: ' + question }]
  };
  /* Effort low rather than thinking disabled: a short conversational answer
     does not need deep reasoning, and disabling thinking on this model has
     documented failure modes -- a tool call written into visible text, and
     leaked reasoning tags. Lowering effort keeps latency and cost down without
     them. Dropped entirely on the retry; see the 400 branch below. */
  if (!opts.noEffort) payload.output_config = { effort: 'low' };
  /* THE ONLY DIFFERENCE BETWEEN THE TWO TRANSPORTS, on the request side. */
  if (opts.wantStream) payload.stream = true;

  const startedAt = Date.now();
  opts.upstreamAt = startedAt;
  let r;
  try{
    r = await postModel(cfg, payload);
    opts.headersAt = Date.now();
  }catch(e){
    /* Classified rather than collapsed -- see transportFault(). The elapsed
       time separates "refused instantly" from "timed out", which no error code
       reports on its own. */
    V.log('ASK unreachable fault=' + transportFault(e) +
          ' ms=' + (Date.now() - startedAt) + ' model=' + String(cfg.model || 'none'));
    return V.json(res, 502, { error: 'coach_unavailable', code: 'VOICE_UNREACHABLE' });
  }

  if (r.status === 429){
    V.log('ASK rate_limited');
    return V.json(res, 429, { error: 'coach_busy', code: 'VOICE_RATE_LIMITED' });
  }
  if (!r.ok){
    /* THE STATUS ALONE WAS NOT ENOUGH TO DIAGNOSE A LIVE FAILURE, which is how
       an outage stayed unexplained: "upstream status=400" does not distinguish
       a rejected parameter from a bad key from a wrong model id.

       The error TYPE is recorded -- invalid_request_error, authentication_error,
       not_found_error and so on. It classifies the request, never its content:
       no question, no answer, no context, no key. */
    let kind = '';
    try{
      const body = await r.json();
      kind = String((body && body.error && body.error.type) || '');
    }catch(e){ kind = 'unreadable'; }
    V.log('ASK upstream status=' + r.status + ' type=' + (kind || 'none') +
          (opts.noEffort ? ' noEffort=1' : '') + (opts.wantStream ? ' stream=1' : ''));

    /* ONE TARGETED RETRY, for the one parameter that is a tuning knob rather
       than a requirement. `effort` lowers cost and latency; it does not make
       the answer correct. If the API rejects the request as malformed, a single
       retry without it turns a total outage into a working -- slightly costlier
       -- answer, and the log line above still records that it happened, so the
       cause is not hidden by the recovery.

       THE RETRY KEEPS THE TRANSPORT IT WAS ASKED FOR. Dropping to the buffered
       path here would make "did the athlete get streaming" depend on whether a
       parameter was rejected, which is exactly the kind of divergence §10
       forbids. */
    if (r.status === 400 && !opts.noEffort){
      V.log('ASK retrying without effort');
      /* receivedAt carries through, so `total` on the retry still measures the
         whole thing the athlete waited for rather than only the second half. */
      return askUpstream(res, cfg, contextJson, question,
                         { noEffort: true, receivedAt: opts.receivedAt,
                           wantStream: opts.wantStream });
    }
    return V.json(res, 502, { error: 'coach_unavailable', code: 'VOICE_UPSTREAM' });
  }

  if (opts.wantStream) return readStreamed(res, r, opts);
  return readBuffered(res, r, opts);
}

/* ---------- THE BUFFERED TRANSPORT ----------
   Unchanged in every respect that matters: same statuses, same codes, same log
   vocabulary. The only difference is that it now reads the reply through the
   shared contract rather than parsing JSON itself. */
async function readBuffered(res, r, opts){
  let data;
  try{ data = await r.json(); }
  catch(e){
    V.log('ASK malformed_body');
    return V.json(res, 502, { error: 'coach_unavailable', code: 'VOICE_MALFORMED' });
  }

  /* A safety decline is a real outcome, not an error. The athlete is told the
     coach cannot answer that one, and the written coaching is untouched. */
  if (data && data.stop_reason === 'refusal'){
    V.log('ASK declined ' + askTimings(opts, r));
    return V.json(res, 200, { answer: null, declined: true });
  }

  const text = (data && Array.isArray(data.content) ? data.content : [])
    .filter(function(b){ return b && b.type === 'text'; })
    .map(function(b){ return b.text; }).join('\n');

  const outTokens = Number((data && data.usage && data.usage.output_tokens) || 0);
  const parsed = parseReply(text);
  if (!parsed){
    const why = String((data && data.stop_reason) || 'none');
    const truncated = why === 'max_tokens';
    V.log('ASK empty_reply stop=' + why + ' out=' + outTokens +
          ' cap=' + VOICE_MAX_TOKENS + ' ' + askTimings(opts, r) +
          (opts.noEffort ? ' noEffort=1' : ''));
    return V.json(res, 502, {
      error: 'coach_unavailable',
      code: truncated ? 'VOICE_TRUNCATED' : 'VOICE_EMPTY'
    });
  }

  /* Counts only. Never the question, never the answer. */
  V.log('ASK ok chars=' + parsed.answer.length + ' out=' + outTokens +
        ' change=' + (parsed.needsPlanChange ? 1 : 0) +
        ' struct=' + (parsed.structured ? 1 : 0) +
        (parsed.structured ? '' : ' why=' + parsed.why) +
        ' ' + askTimings(opts, r) +
        (opts.noEffort ? ' noEffort=1' : ''));
  return V.json(res, 200, {
    answer: parsed.answer,
    needsPlanChange: parsed.needsPlanChange,
    changeReason: parsed.changeReason || null
  });
}

/* ---------- THE STREAMED TRANSPORT ----------
   Reads provider SSE, forwards only athlete-facing prose, and emits at most one
   validated decision after the turn has ended. */
async function readStreamed(res, r, opts){
  const body = r.body;
  const reader = body && typeof body.getReader === 'function' ? body.getReader() : null;
  if (!reader){
    /* THE PLATFORM CANNOT GIVE US A READABLE BODY. Degrade rather than fail:
       read it whole, drive the SAME protocol machine, and answer as the
       buffered transport would. The athlete loses the progressive reveal and
       nothing else. */
    V.log('ASK stream_unavailable degraded=body');
    return readStreamedWhole(res, r, opts);
  }

  const events = SSE.createEventReader();
  const filter = SSE.createBlockFilter();
  const proto = PROTO.createProseStream();
  let headersSent = false;
  const emit = { fn: null };

  const decoder = new TextDecoder();
  let chunks = 0;

  const start = () => {
    if (headersSent) return;
    headersSent = true;
    try{
      res.writeHead(200, {
        'Content-Type': NDJSON,
        'Cache-Control': 'no-store',
        /* Proxies that buffer defeat the entire feature; this is the
           conventional opt-out and is harmless where it is not understood. */
        'X-Accel-Buffering': 'no'
      });
    }catch(e){ /* already sent */ }
  };

  const out = makeEmitter(res, true);
  let readFault = null;
  try{
    for(;;){
      const step = await reader.read();
      if (step.done) break;
      chunks++;
      const evs = events.feed(decoder.decode(step.value, { stream: true }));
      for (const ev of evs){
        const text = filter.handle(ev);
        if (!text) continue;
        const prose = proto.push(text);
        if (!prose) continue;
        if (!opts.firstProseAt){ opts.firstProseAt = Date.now(); start(); }
        out.prose(prose);
      }
    }
  }catch(e){
    readFault = transportFault(e);
  }

  /* Anything held back for sentinel-safety that turned out to be ordinary
     prose is owed to the athlete. */
  const tail = proto.end();
  if (tail){
    if (!opts.firstProseAt){ opts.firstProseAt = Date.now(); start(); }
    out.prose(tail);
  }
  opts.doneAt = Date.now();

  const cleanEnd = !readFault && filter.done && filter.stopReason !== 'error';
  const declined = filter.stopReason === 'refusal';
  const answer = clean(out.answer, 1200);

  /* NOTHING ARRIVED. No headers have been written, so the existing failure
     contract is still available in full and the athlete sees exactly what they
     saw before this pass. */
  if (!headersSent){
    if (declined){
      V.log('ASK declined stream=1 ' + streamTimings(opts));
      return V.json(res, 200, { answer: null, declined: true });
    }
    const why = readFault ? 'fault_' + readFault : ('stop_' + String(filter.stopReason || 'none'));
    V.log('ASK empty_reply stream=1 ' + why + ' chunks=' + chunks + ' ' + streamTimings(opts) +
          (opts.noEffort ? ' noEffort=1' : ''));
    return V.json(res, 502, {
      error: 'coach_unavailable',
      code: filter.stopReason === 'max_tokens' ? 'VOICE_TRUNCATED' : 'VOICE_EMPTY'
    });
  }

  /* PROSE REACHED THE ATHLETE. From here the answer is theirs to keep, and the
     only question left is whether a structured decision exists. */
  const decision = PROTO.decide(proto, { complete: cleanEnd });
  if (!cleanEnd){
    /* Case B: the turn did not finish. The words already on screen stay; the
       exchange is marked incomplete; NOTHING structured is committed. */
    V.log('ASK incomplete stream=1 chars=' + answer.length + ' chunks=' + chunks +
          ' why=' + (readFault ? 'fault_' + readFault : 'stop_' + String(filter.stopReason || 'none')) +
          ' ' + streamTimings(opts));
    ndjson(res, { t: 'incomplete', code: 'VOICE_STREAM_INCOMPLETE' });
    try{ res.end(); }catch(e){}
    return;
  }

  /* Case D, or case C. Either way the decision below is the ONLY thing that
     can ever carry needsPlanChange, and it is validated before it is written.
     The raw trailer is not sent, is not logged, and does not leave this
     function. */
  V.log('ASK ok stream=1 chars=' + answer.length + ' chunks=' + chunks +
        ' change=' + (decision.needsPlanChange ? 1 : 0) +
        ' struct=' + (decision.structured ? 1 : 0) +
        (decision.structured ? '' : ' why=' + decision.why) +
        ' ' + streamTimings(opts) +
        (opts.noEffort ? ' noEffort=1' : ''));
  ndjson(res, {
    t: 'final',
    complete: true,
    structured: decision.structured,
    needsPlanChange: decision.needsPlanChange,
    changeReason: decision.changeReason || null
  });
  try{ res.end(); }catch(e){}
}

/* The degrade path: an upstream stream we cannot forward incrementally. Read
   it whole, run the identical filter and protocol machine, and answer with the
   buffered contract. Same rules, same validation, same result -- only the
   arrival is different, which is the point. */
async function readStreamedWhole(res, r, opts){
  let raw = '';
  try{ raw = await r.text(); }
  catch(e){
    V.log('ASK malformed_body stream=1');
    return V.json(res, 502, { error: 'coach_unavailable', code: 'VOICE_MALFORMED' });
  }
  const events = SSE.createEventReader();
  const filter = SSE.createBlockFilter();
  let text = '';
  events.feed(raw).forEach(function(ev){ text += filter.handle(ev); });
  opts.doneAt = Date.now();

  if (filter.stopReason === 'refusal'){
    V.log('ASK declined stream=degraded ' + streamTimings(opts));
    return V.json(res, 200, { answer: null, declined: true });
  }
  const parsed = parseReply(text);
  if (!parsed){
    const why = String(filter.stopReason || 'none');
    V.log('ASK empty_reply stream=degraded stop=' + why + ' ' + streamTimings(opts));
    return V.json(res, 502, {
      error: 'coach_unavailable',
      code: why === 'max_tokens' ? 'VOICE_TRUNCATED' : 'VOICE_EMPTY'
    });
  }
  V.log('ASK ok stream=degraded chars=' + parsed.answer.length +
        ' change=' + (parsed.needsPlanChange ? 1 : 0) +
        ' struct=' + (parsed.structured ? 1 : 0) + ' ' + streamTimings(opts));
  return V.json(res, 200, {
    answer: parsed.answer,
    needsPlanChange: parsed.needsPlanChange,
    changeReason: parsed.changeReason || null
  });
}


module.exports = { handle, parseReply, SYSTEM, postModel, keyFault, transportFault,
                   askTimings, streamTimings, clientWantsStream, makeEmitter, NDJSON,
                   readStreamed, readBuffered, readStreamedWhole, askUpstream };
