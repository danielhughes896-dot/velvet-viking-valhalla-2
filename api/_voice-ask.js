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

/* Named here, beside the only fetch that uses them, rather than in the shared
   module -- see the note in _voice.js. One file in api/ names a model. */
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
/* 4096, NOT THE 1024 THIS SHIPPED WITH, and the difference is the whole of a
   production outage.

   This model runs adaptive thinking by DEFAULT, and thinking tokens are drawn
   from the same max_tokens budget as the reply. A 1024 ceiling can therefore be
   spent entirely on reasoning, leaving stop_reason "max_tokens" and NO text
   block at all -- which this endpoint then correctly reported as an empty reply
   and the athlete read as "your coach is not responding". Deterministically,
   every time.

   1024 was chosen because the answer is meant to be two or three sentences. That
   reasoning was right about the answer and forgot the thinking. The ceiling is
   not a target: billing is on tokens actually produced, so raising it costs
   nothing on a short reply and buys the headroom the model needs to get to one.
   Brevity is still asked for where it belongs -- in the prompt. */
const VOICE_MAX_TOKENS = 4096;

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
  'OUTPUT. Reply with a single JSON object and nothing else:',
  '{"answer": "<what you would say aloud>", "needsPlanChange": <true|false>,',
  ' "changeReason": "<one sentence, or empty>"}'
].join('\n');

function clean(s, max){
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
}

/* The model is asked for JSON and usually returns exactly that. "Usually" is
   not a contract, so a reply that will not parse is not an error the athlete
   should ever see: the text is used as the answer and no plan change is
   inferred from it. Failing towards "just answer" is the safe direction --
   failing towards a parsed proposal would not be. */
function parseReply(text){
  var raw = String(text || '').trim();
  var body = raw;
  var fence = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  if (fence) body = fence[1].trim();
  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  if (start !== -1 && end > start){
    try{
      const o = JSON.parse(body.slice(start, end + 1));
      if (o && typeof o.answer === 'string' && o.answer.trim()){
        return { answer: clean(o.answer, 1200),
                 needsPlanChange: o.needsPlanChange === true,
                 changeReason: clean(o.changeReason, 300) };
      }
    }catch(e){ /* fall through */ }
  }
  return raw ? { answer: clean(raw, 1200), needsPlanChange: false, changeReason: '' } : null;
}

async function handle(req, res){
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

  return askUpstream(res, cfg, contextJson, question, {});
}

/* THE MODEL CALL, ON ITS OWN, so the one retry below is a real call rather than
   a copy of one. Everything it needs is passed in; it reads no request and no
   database. */
async function askUpstream(res, cfg, contextJson, question, opts){
  opts = opts || {};
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

  let r;
  try{
    r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': cfg.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  }catch(e){
    V.log('ASK unreachable');
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
          (opts.noEffort ? ' noEffort=1' : ''));

    /* ONE TARGETED RETRY, for the one parameter that is a tuning knob rather
       than a requirement. `effort` lowers cost and latency; it does not make
       the answer correct. If the API rejects the request as malformed, a single
       retry without it turns a total outage into a working -- slightly costlier
       -- answer, and the log line above still records that it happened, so the
       cause is not hidden by the recovery. */
    if (r.status === 400 && !opts.noEffort){
      V.log('ASK retrying without effort');
      return askUpstream(res, cfg, contextJson, question, { noEffort: true });
    }
    return V.json(res, 502, { error: 'coach_unavailable', code: 'VOICE_UPSTREAM' });
  }

  let data;
  try{ data = await r.json(); }
  catch(e){
    V.log('ASK malformed_body');
    return V.json(res, 502, { error: 'coach_unavailable', code: 'VOICE_MALFORMED' });
  }

  /* A safety decline is a real outcome, not an error. The athlete is told the
     coach cannot answer that one, and the written coaching is untouched. */
  if (data && data.stop_reason === 'refusal'){
    V.log('ASK declined');
    return V.json(res, 200, { answer: null, declined: true });
  }

  const text = (data && Array.isArray(data.content) ? data.content : [])
    .filter(function(b){ return b && b.type === 'text'; })
    .map(function(b){ return b.text; }).join('\n');

  const parsed = parseReply(text);
  if (!parsed){
    /* stop_reason distinguishes "the model said nothing" from "the model ran
       out of room before it got to the answer" -- the second being exactly what
       a too-small max_tokens produces on a thinking model, and the one worth
       naming in a log rather than rediscovering from a live device. */
    const why = String((data && data.stop_reason) || 'none');
    V.log('ASK empty_reply stop=' + why + (opts.noEffort ? ' noEffort=1' : ''));
    return V.json(res, 502, { error: 'coach_unavailable', code: 'VOICE_EMPTY' });
  }

  /* Counts only. Never the question, never the answer. */
  V.log('ASK ok chars=' + parsed.answer.length + ' change=' + (parsed.needsPlanChange ? 1 : 0) +
        (opts.noEffort ? ' noEffort=1' : ''));
  return V.json(res, 200, {
    answer: parsed.answer,
    needsPlanChange: parsed.needsPlanChange,
    changeReason: parsed.changeReason || null
  });
}

module.exports = { handle, parseReply, SYSTEM };
