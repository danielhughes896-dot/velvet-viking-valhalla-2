'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const PROTO = require('../api/_voice-protocol.js');

/* SPEAKING SENTENCE ONE WHILE SENTENCE THREE IS STILL BEING WRITTEN
 * ===========================================================================
 * Ask Coach used to call voiceSpeak() from the handler that runs when the
 * WHOLE answer has arrived, and the server buffers the entire ElevenLabs audio
 * before returning a byte. Two whole-answer waits in series: first words at
 * ~3s, speech at ~10s, by which time speech is repetition rather than delivery.
 *
 * THE SAFETY ARGUMENT, because it is not obvious. This segmenter reads the
 * browser's prose buffer, and the browser never receives the protocol at all:
 * api/_voice-ask.js forwards only deltas from a block opened as type "text",
 * splits them on the reserved marker, and sends prose events containing
 * nothing else. The marker, the trailer and every reasoning block stay on the
 * server. So what is segmented here is athlete prose by construction -- this is
 * not a filter and must never become one, because a second filter would hide
 * an upstream defect rather than prevent one.
 */

const S = PROTO.SENTINEL;

function app(){
  const a = loadApp({});
  a.patchVoiceCard = () => {};
  a.coachVoice = () => 'molly';
  a.voiceCloudEligible = () => true;
  a.cloudSignedIn = () => true;
  /* A live session to go with the signed-in stub. Without it the app's own
     background Strava refresh reads a null session and throws asynchronously
     -- the fixture's fault, not the product's, but it surfaces as an unhandled
     rejection attributed to whichever test happened to be running. */
  a.cloudSession = { access_token:'test-token', expires_at: Math.floor(Date.now()/1000) + 3600 };
  a.cloudRefreshIfNeeded = () => Promise.resolve(true);
  a.stravaRefreshStatus = () => Promise.resolve(false);
  a.fetch = () => new Promise(() => {});
  a.window.Audio = function(url){
    this.url = url; this.play = () => Promise.resolve();
    this.pause = () => {}; a.__audio.push(this);
  };
  a.__audio = [];
  a.__fetched = [];
  /* Each unit's generation is resolved by the test, so ordering can be
     controlled -- which is the point of several of these. */
  a.__resolvers = {};
  a.ttsFetchAudio = (key, text) => {
    a.__fetched.push(text);
    return new Promise((res, rej) => { a.__resolvers[text] = { res, rej }; });
  };
  a.ttsCacheFind = () => null;
  a.ttsCacheKey = (t) => 'k:' + t;
  return a;
}
const deliver = async (a, text, url) => {
  a.__resolvers[text].res(url || ('blob:' + text.slice(0, 8)));
  await new Promise(r => setImmediate(r));
};

// ---------------------------------------------------------------------------
// 1. SEGMENTATION
// ---------------------------------------------------------------------------

test('a completed sentence is speakable before the model has finished', () => {
  const a = app();
  const r = a.askSpeechSplit('Nice easy one today. Keep it relaxed and', false);
  assert.equal(r.units.length, 1);
  assert.equal(r.units[0], 'Nice easy one today.');
  assert.equal(r.rest.trim(), 'Keep it relaxed and',
    'the unfinished sentence was treated as speakable');
});

test('an incomplete sentence is never speakable', () => {
  const a = app();
  assert.deepEqual(a.askSpeechSplit('Nice easy one today', false).units.length, 0);
  assert.deepEqual(a.askSpeechSplit('Nice easy one today.', false).units.length, 0,
    'a full stop with nothing after it is not yet proven to be a boundary');
  /* Proven only once the stream ends, or once something follows it. */
  assert.equal(a.askSpeechSplit('Nice easy one today.', true).units[0], 'Nice easy one today.');
  assert.equal(a.askSpeechSplit('Nice easy one today. Then', false).units[0], 'Nice easy one today.');
});

test('a decimal is not a sentence boundary', () => {
  const a = app();
  const r = a.askSpeechSplit('Run 9.5 kilometres at 4.45 pace today. Easy does it.', false);
  assert.equal(r.units[0], 'Run 9.5 kilometres at 4.45 pace today.',
    'the coach would have said "run nine point"');
});

test('common coaching abbreviations do not end a sentence', () => {
  const a = app();
  ['approx. 9 km at easy pace. Next one.', 'about 40 min. easy today. Then rest.']
    .forEach(t => {
      const r = a.askSpeechSplit(t, false);
      assert.ok(r.units[0].length > 20, 'split mid-sentence on an abbreviation: ' + r.units[0]);
    });
});

test('a lowercase continuation is not treated as a new sentence', () => {
  const a = app();
  const r = a.askSpeechSplit('You ran 10k. then eased off. Good.', false);
  assert.ok(!r.units.some(u => u === 'You ran 10k.'),
    'split before a lowercase continuation');
});

test('? and ! are boundaries, and closing quotes stay with their sentence', () => {
  const a = app();
  const r = a.askSpeechSplit('Sore calf? Ease off. "Push through it." Never that.', false);
  assert.equal(r.units[0], 'Sore calf?');
  assert.equal(r.units[1], 'Ease off.');
  assert.equal(r.units[2], '"Push through it."',
    'the closing quote was left to start the next unit');
});

test('a sentence split across many chunks is found exactly once', () => {
  const a = app();
  let buf = '', units = [];
  'Nice easy one today. Keep it relaxed. Done.'.split('').forEach(ch => {
    buf += ch;
    const r = a.askSpeechSplit(buf, false);
    units = units.concat(r.units);
    buf = r.rest;
  });
  const r = a.askSpeechSplit(buf, true);
  units = units.concat(r.units);
  assert.deepEqual(units.join('|'), 'Nice easy one today.|Keep it relaxed.|Done.');
});

test('several sentences arriving in one chunk all come out', () => {
  const a = app();
  const r = a.askSpeechSplit('One here. Two here. Three here. And more', false);
  assert.equal(r.units.length, 3);
});

// ---------------------------------------------------------------------------
// 2. THE QUEUE
// ---------------------------------------------------------------------------

test('speech begins before the model has finished', async () => {
  const a = app();
  a.askStreamBegin();
  a.askSpeechFeed('Nice easy one today, nine kilometres at a relaxed pace. ', false);
  assert.equal(a.__fetched.length, 1, 'nothing was sent for generation while prose was still arriving');
  await deliver(a, a.__fetched[0]);
  assert.equal(a.__audio.length, 1, 'the first sentence was not spoken until the answer ended');
});

test('playback order is the writing order, whatever finishes first', async () => {
  const a = app();
  a.askStreamBegin();
  a.askSpeechFeed('First sentence here, long enough to stand on its own. ' +
                  'Second sentence here, also long enough to stand alone. And more follows.', false);
  assert.equal(a.__fetched.length, 2);
  /* The SECOND generation finishes first. */
  await deliver(a, a.__fetched[1]);
  assert.equal(a.__audio.length, 0, 'unit 2 was played before unit 1');
  await deliver(a, a.__fetched[0]);
  assert.equal(a.__audio.length, 1);
  assert.match(a.__audio[0].url, /First/, 'the wrong unit played first');
  a.__audio[0].onended();
  await new Promise(r => setImmediate(r));
  assert.equal(a.__audio.length, 2);
  assert.match(a.__audio[1].url, /Second/);
});

test('the next unit is generated while the current one is playing', async () => {
  const a = app();
  a.askStreamBegin();
  a.askSpeechFeed('First sentence here, long enough to stand on its own. ', false);
  await deliver(a, a.__fetched[0]);
  assert.equal(a.__audio.length, 1, 'unit 1 is not playing');
  /* Unit 2 arrives mid-playback and its generation starts immediately. */
  a.askSpeechFeed('Second sentence here, also long enough to stand alone. ', false);
  assert.equal(a.__fetched.length, 2,
    'the next unit waits for playback to finish before it is even requested');
});

test('a short opening sentence is batched rather than paying its own request', () => {
  const a = app();
  a.askStreamBegin();
  a.askSpeechFeed('Yes. ', false);
  assert.equal(a.__fetched.length, 0, '"Yes." bought its own generation and its own pause');
  a.askSpeechFeed('You are ready for this one, and the plan agrees. ', false);
  assert.equal(a.__fetched.length, 1);
  assert.match(a.__fetched[0], /^Yes\. You are ready/, 'the short opener was dropped, not batched');
});

test('a short final sentence is spoken rather than swallowed', () => {
  const a = app();
  a.askStreamBegin();
  a.askSpeechFeed('Good.', false);
  assert.equal(a.__fetched.length, 0);
  a.askSpeechFeed('', true);
  assert.equal(a.__fetched.length, 1, 'the last short sentence was never spoken');
  assert.equal(a.__fetched[0], 'Good.');
});

// ---------------------------------------------------------------------------
// 3. WHAT MUST NEVER BE SPOKEN
// ---------------------------------------------------------------------------

test('nothing protocol-shaped can reach a generation request', () => {
  /* Belt and braces. The server never sends any of this to the browser, so
     this asserts the second half: nothing here synthesises it either. */
  const a = app();
  a.askStreamBegin();
  a.askSpeechFeed('A normal answer that is long enough to be spoken alone. ', false);
  a.askSpeechFeed('', true);
  a.__fetched.forEach(t => {
    assert.ok(t.indexOf(S) === -1, 'the marker reached a generation request');
    assert.ok(t.indexOf('needsPlanChange') === -1, 'the trailer reached a generation request');
    assert.ok(!/thinking|reasoning_delta|text_delta/.test(t), 'provider protocol reached TTS');
  });
});

test('the browser cannot obtain the marker, the trailer or any reasoning', () => {
  const fs = require('fs');
  const path = require('path');
  const { RUNTIME_RELATIVE } = require('./harness.js');
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  assert.ok(src.indexOf(S) === -1, 'the marker is in the browser bundle');
  assert.ok(!/thinking_delta|content_block_delta/.test(src),
    'the browser has learned the provider protocol');
  /* Which is why the segmenter is not a filter: there is nothing to filter. */
  const seg = /function askSpeechSplit\([\s\S]*?\n\}/.exec(src);
  assert.ok(seg, 'the segmenter is gone');
  assert.ok(!new RegExp(S.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(seg[0]));
});

// ---------------------------------------------------------------------------
// 4. STOP, NEW QUESTIONS, AND FAILURE
// ---------------------------------------------------------------------------

test('Stop silences what is playing and drops what is queued', async () => {
  const a = app();
  a.askStreamBegin();
  a.askSpeechFeed('First sentence here, long enough to stand on its own. ' +
                  'Second sentence here, also long enough to stand alone. And more follows.', false);
  await deliver(a, a.__fetched[0]);
  assert.equal(a.__audio.length, 1);
  let paused = false;
  a.__audio[0].pause = () => { paused = true; };
  a.ttsHalt();
  assert.equal(paused, true, 'Stop did not silence the audio');
  assert.equal(a.askSpeech, null, 'the queue survived Stop');
  /* And a generation that lands afterwards cannot start anything. */
  await deliver(a, a.__fetched[1]);
  assert.equal(a.__audio.length, 1, 'a stale generation played after Stop');
});

test('a new question never inherits the old answer\'s speech', async () => {
  const a = app();
  a.askStreamBegin();
  a.askSpeechFeed('First answer sentence, long enough to be spoken alone. ', false);
  const firstPipeline = a.askSpeech;
  a.askStreamBegin();                       /* the athlete asks again */
  assert.notEqual(a.askSpeech, firstPipeline, 'the old pipeline is still live');
  await deliver(a, a.__fetched[0]);
  assert.equal(a.__audio.length, 0, 'the previous answer spoke over the new one');
});

test('a truncated turn speaks the complete sentences and no more', async () => {
  const a = app();
  a.askStreamBegin();
  a.askSpeechFeed('A complete first sentence that stands on its own here. ' +
                  'A second one that never fini', false);
  assert.equal(a.__fetched.length, 1);
  /* The stream dies. The unfinished sentence must never be spoken. */
  a.askSpeechFeed('', false);
  assert.equal(a.__fetched.length, 1, 'half a sentence was sent to be spoken');
  a.__fetched.forEach(t => assert.ok(!/never fini/.test(t)));
});

test('a generation failure skips its unit and keeps the order', async () => {
  const a = app();
  a.askStreamBegin();
  a.askSpeechFeed('First sentence here, long enough to stand on its own. ' +
                  'Second sentence here, also long enough to stand alone. And more follows.', false);
  a.__resolvers[a.__fetched[0]].rej(new Error('tts down'));
  await new Promise(r => setImmediate(r));
  await deliver(a, a.__fetched[1]);
  assert.equal(a.__audio.length, 1, 'a failed unit blocked the queue');
  assert.match(a.__audio[0].url, /Second/);
});

test('speech failure never touches the answer or the plan decision', async () => {
  const a = app();
  a.askStreamBegin();
  a.askSpeechFeed('A sentence long enough to stand on its own right here. ', false);
  /* Snapshot once the turn is under way: the invariant is that SPEECH failing
     changes nothing, not that starting a turn changes nothing. */
  a.askState = { status:'answered', heard:'Q', answer:'The whole answer.',
                 message:'', proposalDayId:'d-9', incomplete:false };
  const before = JSON.stringify(a.askState);
  a.__resolvers[a.__fetched[0]].rej(new Error('down'));
  await new Promise(r => setImmediate(r));
  assert.equal(JSON.stringify(a.askState), before,
    'a speech failure changed the answer or the plan-change state');
});

// ---------------------------------------------------------------------------
// 5. WHAT THIS PASS WAS NOT ALLOWED TO TOUCH
// ---------------------------------------------------------------------------

test('Hear Today still speaks its whole briefing in one generation', () => {
  /* The briefing is composed complete before a word of it is spoken, and the
     founder is happy with it. It must not be routed through the sentence
     queue: voiceSpeak() is still its entry point and voiceCloudSpeak() still
     its generation. */
  const fs = require('fs');
  const path = require('path');
  const { RUNTIME_RELATIVE } = require('./harness.js');
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(src, /function voiceSpeak\(text, opts\)/, 'voiceSpeak is gone');
  assert.match(src, /function voiceCloudSpeak\(text, opts\)/, 'voiceCloudSpeak is gone');
  /* The briefing path must not mention the queue at all. */
  const brief = /function voiceSpeak\(text, opts\)\{[\s\S]*?\n\}/.exec(src);
  assert.ok(brief && !/askSpeech/.test(brief[0]),
    'Hear Today now goes through the Ask Coach speech queue');
});

test('the streaming protocol and its accessibility behaviour are untouched', () => {
  const fs = require('fs');
  const path = require('path');
  const { RUNTIME_RELATIVE } = require('./harness.js');
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  assert.match(src, /function askReadStream\(resp\)/);
  assert.match(src, /d\.needsPlanChange && d\.complete !== false/,
    'the plan-change gate lost its completed-turn requirement');
  assert.match(src, /id="ask-answer-announce"/);
  const live = /<div class="ask-answer" id="ask-answer-live"[^>]*>/.exec(src);
  assert.ok(live && !/aria-live/.test(live[0]),
    'the growing answer became a live region again');
});

test('the preparing watchdog is still armed and still bounded', () => {
  const a = loadApp({});
  assert.equal(typeof a.voicePreparingTimedOut, 'function');
  assert.ok(a.VOICE_PREPARING_MAX_MS > 0);
  assert.ok(a.TTS_CLIENT_TIMEOUT_MS > 0);
});

test('speech stopped from anywhere else in the app invalidates the queue', () => {
  /* THE TOKEN IS THE CROSS-SURFACE GUARD. askSpeech === p catches a new
     question, because that replaces the pipeline. It does NOT catch ttsHalt()
     arriving from somewhere that has nothing to do with Ask Coach -- leaving
     Today, opening the panel, voiceStop() -- which bumps ttsToken without
     touching askSpeech. Without the token check a unit generated before that
     would still play, after the athlete had left the screen. */
  const a = app();
  a.askStreamBegin();
  const p = a.askSpeech;   /* askStreamBegin returns nothing; the pipeline is here */
  a.askSpeechFeed('A sentence long enough to be spoken entirely on its own. ', false);
  assert.equal(a.askSpeechLive(p), true);
  a.ttsToken++;                        /* some other surface stopped speech */
  assert.equal(a.askSpeechLive(p), false,
    'a pipeline survived a stop that came from outside Ask Coach');
});

test('a truncated turn is never flushed, and a completed one always is', () => {
  /* The decision lives at the call site in the ask completion handler, and
     there is no seam that reaches it without a live model stream -- so it is
     asserted from the source, with comments stripped so the prose describing
     the rule cannot satisfy the assertion. */
  const fs = require('fs');
  const path = require('path');
  const { RUNTIME_RELATIVE } = require('./harness.js');
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /askSpeechFeed\('',\s*d\.incomplete !== true\)/,
    'the final flush no longer depends on the turn having completed -- a ' +
    'truncated answer would have its unfinished sentence spoken');
  assert.ok(!/askSpeechFeed\('',\s*true\)/.test(src),
    'something flushes the buffer unconditionally');
});
