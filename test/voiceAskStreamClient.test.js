'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const PROTO = require('../api/_voice-protocol.js');

/* ASK COACH, STREAMED — THE BROWSER HALF
 * ===========================================================================
 * Two things are being protected here, and both fail silently.
 *
 * ACCESSIBILITY. The answer node used to be role="status" aria-live="polite",
 * which is right for text that appears all at once and wrong for text that
 * grows: a polite live region rewritten on every chunk makes a screen reader
 * announce a half-sentence, then a slightly longer half-sentence, twenty times
 * over. The growing node is therefore inert and a separate visually-hidden
 * region carries exactly one announcement. Nothing about that is visible in a
 * screenshot, and nothing throws if it regresses.
 *
 * PLAN-CHANGE SAFETY. needsPlanChange can only arrive on the `final` event,
 * which the server writes only after a clean turn and a validated trailer. The
 * client must not accept it from anywhere else, and must not accept it at all
 * from an exchange that never completed.
 */

/* The sandbox has no TextDecoder and no ReadableStream; the reader under test
   needs one of each, so they are injected exactly as the app would find them
   in a browser. A fake body delivers the bytes in whatever pieces a test wants
   -- which is the point, since the split is the interesting variable. */
function appWithStream(){
  const a = loadApp({});
  a.TextDecoder = TextDecoder;
  a.ReadableStream = function(){};
  a.setTimeout = (fn) => { fn(); return 0; };
  a.patchVoiceCard = () => {};
  return a;
}
function fakeResponse(chunks, opts){
  const o = opts || {};
  let i = 0;
  const enc = new TextEncoder();
  return {
    ok: true,
    headers: { get: () => 'application/x-ndjson' },
    body: {
      getReader(){
        return {
          read(){
            if (o.failAt != null && i === o.failAt) return Promise.reject(new Error('connection lost'));
            if (i >= chunks.length) return Promise.resolve({ done: true });
            return Promise.resolve({ done: false, value: enc.encode(chunks[i++]) });
          }
        };
      }
    }
  };
}
const line = (o) => JSON.stringify(o) + '\n';

// ---------------------------------------------------------------------------
// 1. THE WIRE
// ---------------------------------------------------------------------------

test('prose events grow the answer and the final event carries the decision', async () => {
  const a = appWithStream();
  const r = await a.askReadStream(fakeResponse([
    line({ t:'prose', d:'Keep tomorrow ' }),
    line({ t:'prose', d:'easy.' }),
    line({ t:'final', complete:true, structured:true, needsPlanChange:true, changeReason:'Sore calf.' })
  ]));
  assert.equal(r.answer, 'Keep tomorrow easy.');
  assert.equal(r.complete, true);
  assert.equal(r.needsPlanChange, true);
  assert.equal(r.incomplete, false);
});

test('an ndjson line split across network chunks is still read', async () => {
  const a = appWithStream();
  const whole = line({ t:'prose', d:'Split across the wire.' }) +
                line({ t:'final', complete:true, needsPlanChange:false, changeReason:null });
  const pieces = [];
  for (let i = 0; i < whole.length; i += 7) pieces.push(whole.slice(i, i + 7));
  const r = await a.askReadStream(fakeResponse(pieces));
  assert.equal(r.answer, 'Split across the wire.');
  assert.equal(r.complete, true);
  assert.equal(r.needsPlanChange, false);
});

test('a stream that stops after prose is incomplete and proposes nothing', async () => {
  const a = appWithStream();
  const r = await a.askReadStream(fakeResponse([
    line({ t:'prose', d:'Half an answer' })
  ]));
  assert.equal(r.answer, 'Half an answer');
  assert.equal(r.complete, false);
  assert.equal(r.incomplete, true);
  assert.equal(r.needsPlanChange, false);
});

test('a connection that dies mid-answer keeps the words and commits nothing', async () => {
  const a = appWithStream();
  const r = await a.askReadStream(fakeResponse([
    line({ t:'prose', d:'The first part arrived' })
  ], { failAt: 1 }));
  assert.equal(r.answer, 'The first part arrived');
  assert.equal(r.incomplete, true);
  assert.equal(r.complete, false);
  assert.equal(r.needsPlanChange, false);
});

test('a stream that dies before any prose is an ordinary failure', async () => {
  /* Case A: no words reached the athlete, so this is the same failure the
     buffered transport has always produced -- one behaviour, not two. */
  const a = appWithStream();
  await assert.rejects(() => a.askReadStream(fakeResponse([], { failAt: 0 })),
    (e) => e && e.code === 'coach_unavailable');
});

test('an explicit incomplete event commits nothing', async () => {
  const a = appWithStream();
  const r = await a.askReadStream(fakeResponse([
    line({ t:'prose', d:'Some words.' }),
    line({ t:'incomplete', code:'VOICE_STREAM_INCOMPLETE' })
  ]));
  assert.equal(r.answer, 'Some words.');
  assert.equal(r.incomplete, true);
  assert.equal(r.needsPlanChange, false);
});

test('unknown or malformed wire lines are ignored, never rendered', async () => {
  const a = appWithStream();
  const r = await a.askReadStream(fakeResponse([
    'not json at all\n',
    line({ t:'something_new', d:'ignored' }),
    line({ t:'prose', d:'Real prose.' }),
    line({ t:'final', complete:true, needsPlanChange:false })
  ]));
  assert.equal(r.answer, 'Real prose.');
  assert.ok(r.answer.indexOf('ignored') === -1);
});

test('needsPlanChange is only ever read off the final event', async () => {
  /* A server that has been tampered with, or a proxy that injects, cannot put
     a plan change on a prose event -- there is no field for it, and the client
     reads the flag from exactly one place. */
  const a = appWithStream();
  const r = await a.askReadStream(fakeResponse([
    line({ t:'prose', d:'Words.', needsPlanChange:true }),
    line({ t:'incomplete', needsPlanChange:true, code:'x' })
  ]));
  assert.equal(r.needsPlanChange, false);
  assert.equal(r.complete, false);
});

// ---------------------------------------------------------------------------
// 2. ACCESSIBILITY
// ---------------------------------------------------------------------------

function panel(a, st){
  a.askState = Object.assign({ status:'answered', heard:'Q', answer:'An answer.',
                               message:'', proposalDayId:null, incomplete:false }, st || {});
  return a.renderAskPanel();
}

test('the growing answer is not an active live region', () => {
  const a = loadApp({});
  [ { status:'streaming', answer:'Half an ans' }, { status:'answered' } ].forEach(st => {
    const h = panel(a, st);
    const el = /<div class="ask-answer" id="ask-answer-live"[^>]*>/.exec(h);
    assert.ok(el, st.status + ': the answer node is gone');
    assert.ok(!/aria-live/.test(el[0]),
      st.status + ': the growing answer is a live region again -- every chunk would be announced');
    assert.ok(!/role="status"/.test(el[0]),
      st.status + ': the growing answer carries role=status again');
  });
});

test('the completed answer gets exactly one polite announcement', () => {
  const a = loadApp({});
  const h = panel(a, { status:'answered' });
  const regions = h.match(/aria-live="polite"/g) || [];
  const announce = /<div class="sr-only" id="ask-answer-announce" role="status" aria-live="polite"><\/div>/.exec(h);
  assert.ok(announce, 'the announcement region is missing');
  assert.equal(regions.length, 1,
    'a completed answer exposes ' + regions.length + ' live regions; it must expose exactly one');
});

test('the announcement region starts empty and is filled once', () => {
  /* Empty in the markup, so re-rendering the card for an unrelated reason
     cannot re-announce an answer the athlete already heard. */
  const a = appWithStream();
  const h = panel(a, { status:'answered', answer:'The whole answer.' });
  assert.match(h, /id="ask-answer-announce"[^>]*><\/div>/, 'the region ships with text in it');

  let writes = 0, last = null;
  a.document.getElementById = (id) => (id === 'ask-answer-announce'
    ? { set textContent(v){ writes++; last = v; }, get textContent(){ return last; } }
    : null);
  a.askAnnounceAnswer('The whole answer.');
  assert.equal(last, 'The whole answer.');
  /* Cleared then set: two writes, one announcement -- the clear is what makes
     the region observably CHANGE rather than appear to have always said it. */
  assert.equal(writes, 2);
});

test('streaming chunks never go through the card re-render', () => {
  /* If they did, the whole panel -- including the announcement region -- would
     be rebuilt on every chunk, which is the chatter this design avoids. */
  const a = appWithStream();
  let renders = 0;
  a.patchVoiceCard = () => { renders++; };
  let text = '';
  a.document.getElementById = (id) => (id === 'ask-answer-live'
    ? { set textContent(v){ text = v; }, get textContent(){ return text; } } : null);
  a.askStreamBuf = '';
  a.askStreamChunk('One. ');
  a.askStreamChunk('Two.');
  assert.equal(text, 'One. Two.');
  assert.equal(renders, 0, 'a streamed chunk re-rendered the card');
});

test('an incomplete answer is exposed accessibly and keeps its words', () => {
  const a = loadApp({});
  const h = panel(a, { status:'answered', answer:'The part that arrived.', incomplete:true });
  assert.match(h, /The part that arrived\./, 'the partial answer was thrown away');
  assert.match(h, /class="ask-incomplete" role="status" aria-live="polite"/,
    'the incomplete state is not announced');
  assert.match(h, /stopped early/i);
});

test('retry stays keyboard reachable, and is hidden only while working', () => {
  const a = loadApp({});
  const done = panel(a, { status:'answered', incomplete:true });
  assert.match(done, /id="ask-input"/, 'there is no way to ask again after an incomplete answer');
  assert.match(done, /data-action="voice-ask-submit"/);
  assert.ok(!/tabindex="-1"/.test(done), 'the retry control was taken out of the tab order');
  /* Not while the coach is mid-sentence -- there is nothing to retry yet. */
  assert.ok(panel(a, { status:'streaming' }).indexOf('id="ask-input"') === -1);
  assert.ok(panel(a, { status:'thinking' }).indexOf('id="ask-input"') === -1);
});

test('the thinking state is still announced while waiting', () => {
  const a = loadApp({});
  assert.match(panel(a, { status:'thinking', answer:'' }),
    /class="ask-thinking" role="status" aria-live="polite">Thinking/);
});

// ---------------------------------------------------------------------------
// 3. NOTHING PROTOCOL-SHAPED REACHES THE SCREEN
// ---------------------------------------------------------------------------

test('the browser has no knowledge of the marker or the provider', () => {
  const fs = require('fs');
  const path = require('path');
  const { RUNTIME_RELATIVE } = require('./harness.js');
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  assert.ok(src.indexOf(PROTO.SENTINEL) === -1,
    'the protocol marker is in the browser bundle');
  assert.ok(!/content_block_delta|text_delta|thinking_delta/.test(src),
    'the browser has learned the provider event protocol');
  assert.ok(!/api\.anthropic\.com/.test(src),
    'the browser names the model endpoint');
});

test('a rendered answer can never contain the marker or the trailer', () => {
  /* Belt and braces: even handed protocol text, the panel escapes and the
     server never sends it. This asserts the second half -- that nothing in the
     client synthesises it. */
  const a = loadApp({});
  const h = panel(a, { status:'answered', answer:'Fine.' });
  assert.ok(h.indexOf(PROTO.SENTINEL) === -1);
  assert.ok(h.indexOf('needsPlanChange') === -1);
});

// ---------------------------------------------------------------------------
// 4. THE ENGINE STILL OWNS THE CHANGE
// ---------------------------------------------------------------------------

test('coachProposedChangeDayId is still the gate, and a partial answer never reaches it', () => {
  const fs = require('fs');
  const path = require('path');
  const { RUNTIME_RELATIVE } = require('./harness.js');
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  /* One caller, and it is guarded by BOTH the model's flag and a clean turn. */
  assert.match(src, /d\.needsPlanChange && d\.complete !== false\)\s*\n?\s*\? coachProposedChangeDayId\(\) : null/,
    'the plan-change gate no longer requires a completed exchange');
  assert.equal((src.match(/coachProposedChangeDayId\(\)/g) || []).length, 2,
    'coachProposedChangeDayId has gained or lost a call site -- there must be exactly ' +
    'one declaration and one caller');
  const a = loadApp({});
  assert.equal(typeof a.coachProposedChangeDayId, 'function',
    'the engine-owned gate is gone');
});
