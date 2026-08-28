// The Ask Coach response contract, and the only place that understands it.
// ===========================================================================
// WHY THIS FILE EXISTS AT ALL.
//
// Ask Coach used to require the model to answer in JSON:
//
//     {"answer":"...","needsPlanChange":false,"changeReason":""}
//
// That contract cannot be streamed to an athlete. The first bytes on the wire
// are `{"answer":"` -- raw JSON -- and the only way to get prose out of a
// half-written JSON string is an incremental string/escape parser that has to
// be right about \" and \uXXXX split across network chunks. A parser that is
// wrong there does not fail loudly; it shows the athlete a backslash, or half
// a code point, or the beginning of the machine-readable trailer.
//
// So the contract changed shape. The model now answers:
//
//     <athlete-facing prose>
//     ###VALHALLA_TRAILER###
//     {"needsPlanChange":false,"changeReason":""}
//
// Prose first, because prose is the only part that is allowed to reach a human
// and it is now allowed to reach them a token at a time. The machine-readable
// part comes last, behind a sentinel, and is read only once the model has
// finished. Nothing after the sentinel is ever forwarded.
//
// THE SEMANTICS DID NOT CHANGE. needsPlanChange and changeReason mean exactly
// what they meant before, are validated more strictly than before, and still
// only ever become an OFFER after the app's own engine has independently
// computed one. The wire format moved; the authority did not.
//
// EVERY BOUNDARY IN THIS FEATURE IS IN THIS FILE. Both transports -- streamed
// and not -- go through the same split, the same validator and the same result
// shape, so the two cannot drift into two behaviours.

/* THE SENTINEL.
   ---------------------------------------------------------------------------
   Chosen so that it cannot plausibly be written by a running coach answering a
   question about training: three hashes, an underscored all-caps protocol word
   and three more hashes. It is not a Markdown heading (`###` is followed
   immediately by a non-space), not a word, and not punctuation any English
   sentence produces.

   COLLISION IS NOT DEFENDED BY IMPROBABILITY ALONE. Three things hold:

     1. the prompt tells the model this token is reserved and must not appear
        in the answer;
     2. prose is everything before the FIRST occurrence, so even if a
        collision happened, the trailer could not be revealed by it -- the
        failure would be a truncated answer, never a leak;
     3. a SECOND occurrence makes the structured decision unavailable
        (isAmbiguous below). A colliding answer therefore cannot produce a plan
        change; it can only fail to produce one.

   Defined once, here. The browser never learns it. */
const SENTINEL = '###VALHALLA_TRAILER###';

/* The response-format instruction, and ONLY the response-format instruction.
   The coaching prompt in _voice-ask.js is untouched: what the coach is, what
   it may not do, the medical boundary and the withheld-data rule all still
   live there and none of them changed. This is the contract portion, kept
   beside the parser that enforces it so the two cannot drift. */
const CONTRACT_INSTRUCTION = [
  'REPLY FORMAT. Reply in exactly two parts, in this order.',
  '',
  'FIRST, your answer to the athlete, as plain prose. No JSON, no code fences, no',
  'labels, no headings. This part is read aloud to them, so write it to be heard.',
  '',
  'THEN, on a line of its own, exactly this marker:',
  SENTINEL,
  '',
  'THEN a single JSON object and nothing else:',
  '{"needsPlanChange": false, "changeReason": ""}',
  '',
  'Set needsPlanChange true only if you believe the plan warrants a change, and put',
  'your one-sentence reason in changeReason. Otherwise leave them as shown.',
  '',
  'The marker is reserved. Never write it anywhere in your answer, never mention it,',
  'and never write anything after the JSON object.'
].join('\n');

/* HOW MUCH OF THE TAIL COULD STILL BECOME THE SENTINEL.
   ---------------------------------------------------------------------------
   A provider chunk boundary can fall anywhere, including the middle of the
   marker: "...easy.\n###VALH" then "ALLA_TRAILER###\n{...}". Emitting the first
   chunk verbatim would print `###VALH` into the athlete's answer and then hide
   the rest, which is precisely the protocol leak this design exists to
   prevent.

   So before emitting, the longest suffix of the buffer that is also a PREFIX of
   the sentinel is held back until more text arrives (or the stream ends and it
   is provably not a marker). Holding back the whole sentinel length
   unconditionally would also be safe but would stall every chunk by that many
   characters; this holds back only what is genuinely ambiguous, which is
   nothing at all for almost every chunk. */
function heldSuffixLength(buf){
  const max = Math.min(buf.length, SENTINEL.length - 1);
  for (let n = max; n > 0; n--){
    if (buf.endsWith(SENTINEL.slice(0, n))) return n;
  }
  return 0;
}

/* THE STREAM STATE MACHINE.
   Fed text chunks in arrival order; returns the prose that is safe to forward
   from each one. Once the sentinel has been seen it forwards nothing ever
   again and buffers the rest as the trailer.

   It is deliberately a tiny object rather than a class hierarchy: the whole
   security property is "prose is what came before the first sentinel", and
   that should be readable in one screen. */
function createProseStream(){
  let pending = '';          // not yet safe to emit (possible partial marker)
  let seenSentinel = false;
  let trailer = '';
  let sentinelCount = 0;
  let proseChars = 0;

  return {
    /* Returns the prose to forward for this chunk -- '' when there is none. */
    push(chunk){
      const text = String(chunk == null ? '' : chunk);
      if (!text) return '';
      if (seenSentinel){
        /* Everything past the marker is machine-readable and stays here.
           A second marker is counted, never forwarded. */
        trailer += text;
        sentinelCount += countOccurrences(text, SENTINEL);
        return '';
      }
      pending += text;
      const at = pending.indexOf(SENTINEL);
      if (at !== -1){
        seenSentinel = true;
        sentinelCount = 1;
        const out = pending.slice(0, at);
        const rest = pending.slice(at + SENTINEL.length);
        trailer += rest;
        sentinelCount += countOccurrences(rest, SENTINEL);
        pending = '';
        proseChars += out.length;
        return out;
      }
      /* No marker yet. Emit everything except a tail that could still turn
         into one. */
      const hold = heldSuffixLength(pending);
      const out = hold ? pending.slice(0, pending.length - hold) : pending;
      pending = hold ? pending.slice(pending.length - hold) : '';
      proseChars += out.length;
      return out;
    },
    /* The stream ended. Anything still held back was never a marker, so it is
       ordinary prose and the athlete is owed it. */
    end(){
      const out = pending;
      pending = '';
      proseChars += out.length;
      return out;
    },
    get sawSentinel(){ return seenSentinel; },
    get isAmbiguous(){ return sentinelCount > 1; },
    get rawTrailer(){ return trailer; },
    get proseLength(){ return proseChars; }
  };
}

function countOccurrences(hay, needle){
  let n = 0, i = 0;
  for (;;){
    const at = hay.indexOf(needle, i);
    if (at === -1) return n;
    n++; i = at + needle.length;
  }
}

/* THE VALIDATOR.
   ---------------------------------------------------------------------------
   The browser is handed a decision, never a document. Everything below rejects
   rather than coerces: a string "true" is not true, a missing key is not false
   by accident, and an extra key is not silently accepted. An invalid trailer is
   not an error the athlete sees -- it means no plan change was proposed for
   this exchange, which is the safe direction and the only safe direction.

   Returns { ok, needsPlanChange, changeReason, reason } where `reason` names
   the failure for the log and is never shown to anyone. */
const TRAILER_MAX = 2000;
const CHANGE_REASON_MAX = 300;

function validateTrailer(raw){
  const fail = (reason) => ({ ok: false, needsPlanChange: false, changeReason: '', reason });
  let body = String(raw == null ? '' : raw).trim();
  if (!body) return fail('empty');
  if (body.length > TRAILER_MAX) return fail('oversize');

  /* A code fence is tolerated because models add them reflexively, and doing
     so costs nothing: it is a wrapper, not a parse. */
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/.exec(body);
  if (fence) body = fence[1].trim();

  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return fail('no_object');

  let o;
  try{ o = JSON.parse(body.slice(start, end + 1)); }
  catch(e){ return fail('unparseable'); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return fail('not_object');

  /* STRICTLY BOOLEAN. This is the one field that can lead to an offer being
     shown to an athlete, so "true", 1 and "yes" are all rejected rather than
     interpreted -- a model that cannot follow the contract does not get to
     propose a change by accident. */
  if (typeof o.needsPlanChange !== 'boolean') return fail('needsPlanChange_type');

  let reason = '';
  if (o.changeReason != null){
    if (typeof o.changeReason !== 'string') return fail('changeReason_type');
    reason = o.changeReason.replace(/\s+/g, ' ').trim().slice(0, CHANGE_REASON_MAX);
  }
  return { ok: true, needsPlanChange: o.needsPlanChange, changeReason: reason, reason: '' };
}

/* THE ONE RESULT SHAPE, for both transports.
   `complete` says the model finished its turn; `structured` says the trailer
   was found, unambiguous and valid. They are separate on purpose: an answer
   can be complete and useful while its trailer is unusable, and that case must
   show the answer and propose nothing. */
function decide(stream, opts){
  const o = opts || {};
  if (!o.complete) return { structured: false, needsPlanChange: false, changeReason: '', why: 'incomplete' };
  if (!stream.sawSentinel) return { structured: false, needsPlanChange: false, changeReason: '', why: 'no_sentinel' };
  if (stream.isAmbiguous) return { structured: false, needsPlanChange: false, changeReason: '', why: 'ambiguous_sentinel' };
  const v = validateTrailer(stream.rawTrailer);
  if (!v.ok) return { structured: false, needsPlanChange: false, changeReason: '', why: 'trailer_' + v.reason };
  return { structured: true, needsPlanChange: v.needsPlanChange, changeReason: v.changeReason, why: 'ok' };
}

/* THE NON-STREAMED TRANSPORT, THROUGH THE SAME MACHINE. A complete reply is
   simply a stream of one chunk. This is what stops the fallback becoming a
   second implementation of the contract: there is one splitter, one validator
   and one decision, and the only difference between the transports is when the
   bytes arrive. */
function readComplete(fullText){
  const s = createProseStream();
  let prose = s.push(String(fullText == null ? '' : fullText));
  prose += s.end();
  const d = decide(s, { complete: true });
  return {
    answer: prose.trim(),
    needsPlanChange: d.needsPlanChange,
    changeReason: d.changeReason,
    structured: d.structured,
    why: d.why
  };
}

module.exports = {
  SENTINEL, CONTRACT_INSTRUCTION,
  createProseStream, validateTrailer, decide, readComplete,
  heldSuffixLength
};
