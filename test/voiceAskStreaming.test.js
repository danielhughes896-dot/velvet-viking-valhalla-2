'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PROTO = require('../api/_voice-protocol.js');
const SSE = require('../api/_voice-sse.js');
const askMod = require('../api/_voice-ask.js');

/* ASK COACH, STREAMED — THE PROTOCOL AND ITS BOUNDARIES
 * ===========================================================================
 * The contract is:
 *
 *     <athlete-facing prose>
 *     ###VALHALLA_TRAILER###
 *     {"needsPlanChange":false,"changeReason":""}
 *
 * Prose streams to the athlete as it arrives. Everything from the marker
 * onwards is machine-readable, stays on the server, and is validated before any
 * part of it becomes a decision the browser can see.
 *
 * WHAT THESE TESTS ARE REALLY FOR. Every one of the invariants below fails
 * SILENTLY if it breaks. A leaked trailer looks like a chatty coach. Leaked
 * reasoning looks like a thoughtful one. A plan change committed from a partial
 * stream looks like a plan change. None of it throws, so none of it would be
 * noticed without a test that goes looking.
 */

const S = PROTO.SENTINEL;

/* Feed a body to the protocol in an arbitrary chunking, the way a network
   actually delivers it. `chunks` is the exact split under test. */
function run(chunks){
  const p = PROTO.createProseStream();
  let prose = '';
  chunks.forEach(c => { prose += p.push(c); });
  prose += p.end();
  return { prose, stream: p };
}
/* Split a string into fixed-size pieces, to prove the parser is not accidentally
   relying on the chunk boundaries a fixture happens to have. */
function slice(text, n){
  const out = [];
  for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n));
  return out;
}

// ---------------------------------------------------------------------------
// 1. THE HAPPY PATH, AND EVERY CHUNKING OF IT
// ---------------------------------------------------------------------------

test('prose, sentinel and a valid trailer', () => {
  const body = 'Keep tomorrow easy.\n' + S + '\n{"needsPlanChange":true,"changeReason":"Sore calf."}';
  const { prose, stream } = run([body]);
  assert.equal(prose.trim(), 'Keep tomorrow easy.');
  const d = PROTO.decide(stream, { complete: true });
  assert.equal(d.structured, true);
  assert.equal(d.needsPlanChange, true);
  assert.equal(d.changeReason, 'Sore calf.');
});

test('the sentinel split across provider chunks is still found', () => {
  /* THE CASE THAT MAKES OR BREAKS THIS DESIGN. A chunk boundary can fall
     anywhere, including the middle of the marker. Emitting the first half
     would print "###VALH" into the athlete's answer. */
  const body = 'Keep it easy.\n' + S + '\n{"needsPlanChange":false}';
  for (let n = 1; n <= 9; n++){
    const { prose, stream } = run(slice(body, n));
    assert.equal(prose.trim(), 'Keep it easy.', 'chunk size ' + n + ' leaked or lost prose');
    assert.ok(prose.indexOf('###') === -1, 'chunk size ' + n + ' leaked part of the marker');
    assert.equal(PROTO.decide(stream, { complete: true }).structured, true,
      'chunk size ' + n + ' failed to find the marker');
  }
});

test('the trailer split across chunks is still read', () => {
  const body = 'Fine.\n' + S + '\n{"needsPlanChange":true,"changeReason":"Fatigue."}';
  const { prose, stream } = run(slice(body, 3));
  assert.equal(prose.trim(), 'Fine.');
  const d = PROTO.decide(stream, { complete: true });
  assert.equal(d.needsPlanChange, true);
  assert.equal(d.changeReason, 'Fatigue.');
});

test('one provider delta is never assumed to be one protocol segment', () => {
  /* Prose, marker and trailer arriving inside a SINGLE chunk, and the whole
     body arriving one character at a time, must agree exactly. */
  const body = 'A.\n' + S + '\n{"needsPlanChange":false}';
  const whole = run([body]);
  const atomised = run(slice(body, 1));
  assert.equal(whole.prose, atomised.prose);
  assert.equal(PROTO.decide(whole.stream, { complete: true }).structured,
               PROTO.decide(atomised.stream, { complete: true }).structured);
});

test('prose containing JSON-like punctuation is left alone', () => {
  /* A coach may legitimately write braces, quotes and colons. Nothing here
     parses prose, so none of it can be mistaken for structure. */
  const proseIn = 'Your splits read {5:20, 5:18, "5:15"} — that is a negative split.';
  const { prose, stream } = run([proseIn + '\n' + S + '\n{"needsPlanChange":false}']);
  assert.equal(prose.trim(), proseIn);
  assert.equal(PROTO.decide(stream, { complete: true }).structured, true);
});

// ---------------------------------------------------------------------------
// 2. WHEN THE PROTOCOL FAILS, NOTHING IS COMMITTED
// ---------------------------------------------------------------------------

test('a missing sentinel yields the prose and no decision', () => {
  const { prose, stream } = run(['Just an answer, no marker anywhere.']);
  assert.equal(prose, 'Just an answer, no marker anywhere.');
  const d = PROTO.decide(stream, { complete: true });
  assert.equal(d.structured, false);
  assert.equal(d.needsPlanChange, false);
  assert.equal(d.why, 'no_sentinel');
});

test('a duplicated sentinel makes the decision unavailable', () => {
  /* Ambiguity is not resolved, it is refused. A second marker means the model
     did not follow the contract, and a plan change is the one thing that must
     never be inferred from a model that is not following the contract. */
  const { prose, stream } = run(['Answer.\n' + S + '\n{"needsPlanChange":true}\n' + S + '\n{}']);
  assert.equal(prose.trim(), 'Answer.');
  const d = PROTO.decide(stream, { complete: true });
  assert.equal(d.structured, false);
  assert.equal(d.needsPlanChange, false);
  assert.equal(d.why, 'ambiguous_sentinel');
});

test('a malformed trailer yields the prose and no decision', () => {
  const { prose, stream } = run(['Answer.\n' + S + '\nnot json at all']);
  assert.equal(prose.trim(), 'Answer.');
  const d = PROTO.decide(stream, { complete: true });
  assert.equal(d.structured, false);
  assert.equal(d.why, 'trailer_no_object');
});

test('a trailer with the wrong types is rejected, not coerced', () => {
  /* "true" is not true. 1 is not true. This is the field that can put an offer
     in front of an athlete, so it is the field with no tolerance. */
  ['{"needsPlanChange":"true"}', '{"needsPlanChange":1}', '{"needsPlanChange":null}',
   '{"changeReason":"x"}', '[]', '{"needsPlanChange":true,"changeReason":5}']
    .forEach(bad => {
      const v = PROTO.validateTrailer(bad);
      assert.equal(v.ok, false, bad + ' was accepted');
      assert.equal(v.needsPlanChange, false, bad + ' produced a plan change');
    });
  const good = PROTO.validateTrailer('{"needsPlanChange":true,"changeReason":"Reason."}');
  assert.equal(good.ok, true);
  assert.equal(good.needsPlanChange, true);
});

test('a stream that ends during the prose commits nothing', () => {
  const { prose, stream } = run(['Half an ans']);
  assert.equal(prose, 'Half an ans');
  const d = PROTO.decide(stream, { complete: false });
  assert.equal(d.structured, false);
  assert.equal(d.needsPlanChange, false);
  assert.equal(d.why, 'incomplete');
});

test('a stream that ends during the trailer commits nothing', () => {
  const { prose, stream } = run(['Answer.\n' + S + '\n{"needsPlanCh']);
  assert.equal(prose.trim(), 'Answer.');
  /* Even the *complete* reading of a truncated trailer must fail; and the
     stream was not complete anyway, which is checked first. */
  assert.equal(PROTO.decide(stream, { complete: false }).needsPlanChange, false);
  assert.equal(PROTO.decide(stream, { complete: true }).structured, false);
});

test('clean prose with an invalid trailer keeps the answer and drops the decision', () => {
  const { prose, stream } = run(['A complete, useful answer.\n' + S + '\n{"needsPlanChange":"yes"}']);
  assert.equal(prose.trim(), 'A complete, useful answer.');
  const d = PROTO.decide(stream, { complete: true });
  assert.equal(d.structured, false);
  assert.equal(d.needsPlanChange, false);
  assert.equal(d.why, 'trailer_needsPlanChange_type');
});

test('the sentinel and the trailer are never part of the prose', () => {
  /* Stated as its own test because it is Invariant 3, and because every other
     test here would still pass if the trailer were appended to the answer. */
  const bodies = [
    'Answer.\n' + S + '\n{"needsPlanChange":false}',
    'Answer.' + S + '{"needsPlanChange":true,"changeReason":"secret reason"}',
    'Answer.\n' + S + '\ngarbage'
  ];
  bodies.forEach(b => {
    for (const n of [1, 4, 17, b.length]){
      const { prose } = run(slice(b, n));
      assert.ok(prose.indexOf(S) === -1, 'the marker reached the athlete');
      assert.ok(prose.indexOf('needsPlanChange') === -1, 'the trailer reached the athlete');
      assert.ok(prose.indexOf('secret reason') === -1, 'trailer content reached the athlete');
      assert.ok(prose.indexOf('garbage') === -1, 'post-marker text reached the athlete');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. THE PROVIDER STREAM: ONLY THE ANSWER CHANNEL IS FORWARDED
// ---------------------------------------------------------------------------

function sse(events){
  return events.map(e => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join('');
}
function drive(frames){
  const r = SSE.createEventReader(), f = SSE.createBlockFilter();
  let text = '';
  frames.forEach(fr => { r.feed(fr).forEach(ev => { text += f.handle(ev); }); });
  return { text, filter: f };
}

const THINKING = [
  { type:'content_block_start', index:0, content_block:{ type:'thinking' } },
  { type:'content_block_delta', index:0, delta:{ type:'thinking_delta', thinking:'REASONING_MUST_NOT_LEAK' } },
  { type:'content_block_stop', index:0 }
];
const answerBlocks = (text, idx) => ([
  { type:'content_block_start', index:idx, content_block:{ type:'text' } },
  { type:'content_block_delta', index:idx, delta:{ type:'text_delta', text:text } },
  { type:'content_block_stop', index:idx }
]);
const CLOSE = [
  { type:'message_delta', delta:{ stop_reason:'end_turn' } },
  { type:'message_stop' }
];

test('a thinking block before the answer contributes nothing', () => {
  const { text, filter } = drive([sse([].concat(THINKING, answerBlocks('Hello.', 1), CLOSE))]);
  assert.equal(text, 'Hello.');
  assert.ok(text.indexOf('REASONING') === -1, 'reasoning reached the answer');
  assert.equal(filter.done, true);
  assert.equal(filter.stopReason, 'end_turn');
});

test('thinking interleaved with other provider events contributes nothing', () => {
  const frames = sse([].concat(
    [{ type:'message_start', message:{ id:'x' } }],
    THINKING,
    answerBlocks('First. ', 1),
    [{ type:'content_block_start', index:2, content_block:{ type:'thinking' } },
     { type:'content_block_delta', index:2, delta:{ type:'thinking_delta', thinking:'MORE_REASONING' } }],
    answerBlocks('Second.', 3),
    CLOSE));
  const { text } = drive([frames]);
  assert.equal(text, 'First. Second.');
  assert.ok(!/REASONING/.test(text));
});

test('the filter is an allowlist: an unknown block type is not forwarded', () => {
  /* THE POINT OF THE WHOLE DESIGN. A blocklist would pass this content through
     because it is not called "thinking". Only a channel affirmatively opened as
     text is ever read, so a block type invented after this was written is
     silence rather than a leak. */
  const frames = sse([
    { type:'content_block_start', index:0, content_block:{ type:'some_future_reasoning_channel' } },
    { type:'content_block_delta', index:0, delta:{ type:'text_delta', text:'FUTURE_LEAK' } },
    { type:'content_block_delta', index:9, delta:{ type:'text_delta', text:'NEVER_OPENED' } }
  ].concat(answerBlocks('Only this.', 1), CLOSE));
  const { text } = drive([frames]);
  assert.equal(text, 'Only this.');
});

test('a non-text delta on a text block is not forwarded', () => {
  const frames = sse([
    { type:'content_block_start', index:0, content_block:{ type:'text' } },
    { type:'content_block_delta', index:0, delta:{ type:'input_json_delta', partial_json:'{"a":1}' } },
    { type:'content_block_delta', index:0, delta:{ type:'text_delta', text:'Real.' } }
  ].concat(CLOSE));
  const { text } = drive([frames]);
  assert.equal(text, 'Real.');
});

test('SSE frames split across network chunks are read correctly', () => {
  const whole = sse([].concat(THINKING, answerBlocks('Split me.', 1), CLOSE));
  for (const n of [1, 7, 40, 300]){
    const { text, filter } = drive(slice(whole, n));
    assert.equal(text, 'Split me.', 'chunk size ' + n);
    assert.equal(filter.done, true, 'chunk size ' + n + ' lost message_stop');
  }
});

test('an unfinished provider stream is not reported as done', () => {
  const { text, filter } = drive([sse([].concat(answerBlocks('Partial', 0)))]);
  assert.equal(text, 'Partial');
  assert.equal(filter.done, false);
  /* Which is what makes decide() refuse the trailer. */
  const p = PROTO.createProseStream(); p.push(text); p.end();
  assert.equal(PROTO.decide(p, { complete: filter.done }).needsPlanChange, false);
});

test('a provider error frame marks the turn unclean', () => {
  const { filter } = drive([sse([{ type:'error', error:{ type:'overloaded_error' } }])]);
  assert.equal(filter.stopReason, 'error');
  assert.equal(filter.done, false);
});

// ---------------------------------------------------------------------------
// 4. END TO END, THROUGH BOTH TRANSPORTS
// ---------------------------------------------------------------------------

test('the two transports reach the same answer and the same decision', () => {
  /* INVARIANT 7. The fallback is a transport, not a second implementation --
     so a body that arrives all at once and the same body arriving in pieces
     must agree on every field. */
  const cases = [
    'Easy tomorrow.\n' + S + '\n{"needsPlanChange":true,"changeReason":"Calf."}',
    'No change needed.\n' + S + '\n{"needsPlanChange":false,"changeReason":""}',
    'Answer with no marker at all.',
    'Answer.\n' + S + '\nbroken',
    'Answer.\n' + S + '\n{"needsPlanChange":"true"}'
  ];
  cases.forEach(body => {
    const buffered = PROTO.readComplete(body);
    const { prose, stream } = run(slice(body, 5));
    const d = PROTO.decide(stream, { complete: true });
    assert.equal(prose.trim(), buffered.answer, 'answers differ for: ' + body.slice(0, 30));
    assert.equal(d.needsPlanChange, buffered.needsPlanChange, 'decisions differ');
    assert.equal(d.structured, buffered.structured, 'structured flag differs');
    assert.equal(d.changeReason, buffered.changeReason, 'reasons differ');
  });
});

test('parseReply -- the buffered reader -- goes through the same contract', () => {
  const r = askMod.parseReply('Ease off.\n' + S + '\n{"needsPlanChange":true,"changeReason":"Calf."}');
  assert.equal(r.answer, 'Ease off.');
  assert.equal(r.needsPlanChange, true);
  assert.equal(r.structured, true);
  const noTrailer = askMod.parseReply('Ease off.');
  assert.equal(noTrailer.needsPlanChange, false);
  assert.equal(noTrailer.structured, false);
  assert.equal(askMod.parseReply(''), null);
  assert.equal(askMod.parseReply('   ' + S + '   '), null,
    'a reply that is only a marker is not an answer');
});

// ---------------------------------------------------------------------------
// 5. THE SERVER -> CLIENT WIRE
// ---------------------------------------------------------------------------

test('the browser is only offered a stream when it says it can read one', () => {
  assert.equal(askMod.clientWantsStream({ headers:{ accept:'application/x-ndjson, application/json' } }), true);
  assert.equal(askMod.clientWantsStream({ headers:{ accept:'application/json' } }), false);
  assert.equal(askMod.clientWantsStream({ headers:{} }), false);
  assert.equal(askMod.clientWantsStream({}), false);
});

test('the emitter writes prose as it arrives and accumulates the same answer', () => {
  const written = [];
  const res = { write(s){ written.push(s); } };
  const e = askMod.makeEmitter(res, true);
  e.prose('One. '); e.prose('Two.');
  assert.equal(e.answer, 'One. Two.');
  assert.equal(written.length, 2);
  written.forEach(line => {
    const o = JSON.parse(line);
    assert.equal(o.t, 'prose');
    assert.ok(typeof o.d === 'string');
    /* The wire carries prose and nothing else -- no marker, no trailer, no
       provider vocabulary. */
    assert.ok(line.indexOf(S) === -1);
    assert.ok(line.indexOf('needsPlanChange') === -1);
  });
  /* And the buffered emitter writes nothing while accumulating the same text. */
  const silent = askMod.makeEmitter({ write(){ throw new Error('must not write'); } }, false);
  silent.prose('One. '); silent.prose('Two.');
  assert.equal(silent.answer, 'One. Two.');
});

test('timings are numbers and fixed words, and TTFT is the first prose', () => {
  const t = { receivedAt: 1000, upstreamAt: 1050, headersAt: 1200,
              firstProseAt: 1250, doneAt: 3000 };
  const line = askMod.streamTimings(t);
  assert.match(line, /\bpre=50\b/);
  assert.match(line, /\bhead=150\b/);
  assert.match(line, /\bprose=250\b/, 'TTFT is measured from the request, to the first prose');
  assert.match(line, /\bdone=2000\b/);
  /* Nothing but keys, digits and spaces. */
  assert.match(line, /^[a-z]+=\d+( [a-z]+=\d+)*$/);
  /* A turn that produced no prose reports no TTFT rather than a made-up one. */
  assert.ok(!/prose=/.test(askMod.streamTimings({ receivedAt:1000, upstreamAt:1010 })));
});

// ---------------------------------------------------------------------------
// 6. WHAT THE STREAMING PASS WAS NOT ALLOWED TO CHANGE
// ---------------------------------------------------------------------------

test('the coaching prompt is intact and only its reply format changed', () => {
  const p = askMod.SYSTEM;
  assert.match(p, /not a doctor/i, 'the medical boundary left the prompt');
  assert.match(p, /deterministic engine/i, 'the engine-authority statement left the prompt');
  assert.match(p, /withheld/i, 'the withheld-data rule left the prompt');
  assert.match(p, /Never invent a session/i, 'the no-invention rule left the prompt');
  assert.match(p, /two or three sentences/i, 'the voice guidance left the prompt');
  /* The new contract, and the old one gone. */
  assert.ok(p.indexOf(S) !== -1, 'the prompt does not state the marker');
  assert.ok(!/single JSON object and nothing else:\s*\{"answer"/.test(p),
    'the old JSON-only reply format is still being asked for');
});

test('key-fault and transport-fault classification are untouched', () => {
  assert.equal(askMod.keyFault(''), 'missing');
  assert.equal(askMod.keyFault('sk-ant-abc\n'), null, 'a trailing newline is trimmed, not a fault');
  assert.equal(askMod.keyFault('sk\nant'), 'control_char');
  assert.equal(askMod.keyFault('sk–ant'), 'non_ascii');
  assert.equal(askMod.keyFault('sk-ant-fine'), null);

  const net = new TypeError('fetch failed'); net.cause = { code:'ENOTFOUND' };
  assert.equal(askMod.transportFault(net), 'network:ENOTFOUND');
  assert.equal(askMod.transportFault(new TypeError('invalid header value')), 'header_rejected');
  assert.equal(askMod.transportFault(new TypeError('Cannot convert to ByteString')), 'header_non_ascii');
});

test('the one retry without effort survives, and keeps its transport', () => {
  /* Read from the source: the retry is a control-flow guarantee and there is
     no seam that exercises it without a live upstream. Comments stripped, so
     the prose describing the retry cannot satisfy the assertion. */
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', '_voice-ask.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /if \(r\.status === 400 && !opts\.noEffort\)/,
    'the single 400 retry is gone');
  assert.match(src, /noEffort: true, receivedAt: opts\.receivedAt,\s*\n?\s*wantStream: opts\.wantStream/,
    'the retry no longer preserves the transport it was asked for');
  /* Exactly one retry: the retried call sets noEffort, and the guard above
     stops it retrying again. */
  assert.equal((src.match(/retrying without effort/g) || []).length, 1);
  assert.match(src, /effort: 'low'/, "the effort setting changed");
  assert.match(src, /max_tokens: VOICE_MAX_TOKENS/, 'the token ceiling changed');
});

test('the Strava and health boundaries still sit before any model call', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', '_voice-ask.js'), 'utf8');
  const refuse = src.indexOf('STRAVA_DERIVED_CONTEXT');
  const call = src.indexOf('return askUpstream(res, cfg, contextJson, question, {');
  assert.ok(refuse !== -1 && call !== -1);
  assert.ok(refuse < call, 'the Strava refusal no longer precedes the model call');
});

test('exactly one file in api/ names a model endpoint, still', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'api');
  const hits = fs.readdirSync(dir).filter(f => /\.js$/.test(f)).filter(f =>
    /api\.anthropic\.com/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepEqual(hits.join(','), '_voice-ask.js',
    'the streaming pass opened a second door to the model');
});
