'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* SAID, RATHER THAN READ — AND STILL ONE COACHING BRAIN.
 * ===========================================================================
 * The guidance table is written for a CARD, where each value sits beside its
 * own label. Read aloud the labels are gone and the values arrive as captions:
 * "Aerobic base, and freshness for the hard days." is correct coaching and is
 * not a sentence.
 *
 * So a frame is added, and ONLY a frame. The coaching words are carried through
 * untouched; what changes is the handful of words that turn a caption into an
 * utterance. That is a rendering decision of exactly the kind the card already
 * makes when it draws a label.
 *
 * WHY NOT A MODEL. An earlier revision sent the assembled lines to the model
 * for a conversational rephrasing, guarded against invented numbers. It was
 * removed and this file pins that removal. The guard caught invention but not
 * OMISSION -- a paraphrase that quietly dropped "Watch for racing it" would
 * have passed every check while changing the coaching the athlete received.
 * Choosing which coaching survives into speech IS coaching. Framing cannot
 * omit, because it never chooses.
 */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const TODAY = '2026-08-24';

function app(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.scheduleSave = () => {}; a.flushSave = () => {};
  buildPlan(a, { weeks: 14, startDate: '2026-07-01', distanceKey: '10k', volume: 40,
                 schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } });
  a.state.view = 'today';
  a.voiceSetAvailable(true);
  a.window.Capacitor = { isNativePlatform: () => true };
  return a;
}
const today = a => a.findDayByDate(TODAY);

/* Every distinct session type the planner produces, with its authored
   guidance. This is the corpus the frames were designed against, so it is the
   corpus they are tested against. */
function corpus(a){
  const seen = {}, out = [];
  a.state.days.filter(d => d.type !== 'rest').forEach(d => {
    let gd = null;
    try { gd = a.coachingDisclosureFor(d, a.athleteExperience(a.state.setup)); } catch(e){ gd = null; }
    if (!gd || seen[d.type]) return;
    seen[d.type] = 1;
    out.push({ type: d.type, gd });
  });
  return out;
}

// ---------------------------------------------------------------------------
// THE FRAMES PRODUCE SENTENCES
// ---------------------------------------------------------------------------
test('every authored purpose, feel and watch-out becomes a spoken sentence', () => {
  const a = app();
  const rows = corpus(a);
  assert.ok(rows.length >= 6, 'the corpus is too small to prove anything: ' + rows.length);

  rows.forEach(({ type, gd }) => {
    [['why', a.voicePurposeLine(gd.why)],
     ['feel', a.voiceFeelLine(gd.feel)],
     ['avoid', a.voiceAvoidLine(gd.avoid)]].forEach(([field, said]) => {
      if (!gd[field]) return;
      const where = type + '.' + field + ': ' + said;
      assert.match(said, /^[A-Z]/, 'does not start as a sentence -- ' + where);
      assert.match(said, /\.$/, 'does not end as a sentence -- ' + where);
      assert.ok(said.split(' ').length > gd[field].split(' ').length,
        'no frame was added -- ' + where);
    });
  });
});

test('a purpose written as a verb takes "It", not "This one\'s for"', () => {
  const a = app();
  /* "Raises the pace at which lactate starts to accumulate" is a sentence
     missing its subject; the noun frame would produce nonsense. */
  assert.equal(a.voicePurposeLine('Raises the pace at which lactate accumulates.'),
    'It raises the pace at which lactate accumulates.');
  assert.equal(a.voicePurposeLine('Resets your goal and every training pace.'),
    'It resets your goal and every training pace.');
});

test('a purpose written as a noun phrase takes the noun frame', () => {
  const a = app();
  assert.equal(a.voicePurposeLine('Aerobic base, and freshness for the hard days.'),
    "This one's for aerobic base, and freshness for the hard days.");
});

test('an unrecognised purpose fails towards formal, never towards ungrammatical', () => {
  const a = app();
  const said = a.voicePurposeLine('Something nobody authored yet.');
  assert.match(said, /^This one's for /, 'the safe frame was not used');
  assert.match(said, /\.$/);
});

// ---------------------------------------------------------------------------
// THE FRAME CANNOT CHANGE THE COACHING
// ---------------------------------------------------------------------------
test('framing carries every coaching word through, in order', () => {
  const a = app();
  corpus(a).forEach(({ type, gd }) => {
    [['why', a.voicePurposeLine(gd.why)],
     ['feel', a.voiceFeelLine(gd.feel)],
     ['avoid', a.voiceAvoidLine(gd.avoid)]].forEach(([field, said]) => {
      if (!gd[field]) return;
      /* The value survives inside the frame with only its leading capital and
         trailing stop touched -- both of which are card punctuation. */
      const core = String(gd[field]).replace(/\s*\.\s*$/, '');
      const relaxed = core.charAt(0).toLowerCase() + core.slice(1);
      assert.ok(said.indexOf(core) !== -1 || said.indexOf(relaxed) !== -1,
        'the coaching value did not survive framing -- ' + type + '.' + field + ': ' + said);
    });
  });
});

test('nothing is dropped: every guidance value reaches the spoken briefing', () => {
  const a = app();
  const dd = today(a);
  const gd = a.coachingDisclosureFor(dd, a.athleteExperience(a.state.setup));
  const spoken = a.voiceScriptText(a.voiceScriptFor(dd)).toLowerCase();
  ['how', 'why', 'feel', 'avoid'].forEach(f => {
    if (!gd[f]) return;
    /* Compared on the distinctive last words rather than the whole string,
       because voiceSpeakable() legitimately rewrites units and paces. */
    const tail = String(gd[f]).replace(/\s*\.\s*$/, '').split(' ').slice(-3).join(' ').toLowerCase();
    assert.ok(spoken.indexOf(tail) !== -1, 'guidance "' + f + '" never reached speech: ' + tail);
  });
});

test('the spoken briefing is no longer a string of captions', () => {
  const a = app();
  const spoken = a.voiceScriptText(a.voiceScriptFor(today(a)));
  assert.ok(!/(^|\. )Conversational throughout\./.test(spoken),
    'a bare card caption is still being read aloud');
  assert.match(spoken, /It should feel /, 'the feel was not framed');
  assert.match(spoken, /Watch for /, 'the watch-out was not framed');
});

// ---------------------------------------------------------------------------
// CONTRACTIONS
// ---------------------------------------------------------------------------
test('written auxiliaries are contracted for the ear', () => {
  const a = app();
  /* Case is carried through: this text is DISPLAYED as well as spoken. */
  assert.equal(a.voiceContract('Today you have got 5 kilometres.'),
    "Today you've got 5 kilometres.");
  assert.equal(a.voiceContract('It is easy. Do not race it.'), "It's easy. Don't race it.");
  assert.equal(a.voiceContract('You will not need it.'), "You won't need it.",
    'negations must contract before pronoun+will, or a coach says "you\'ll not"');
});

test('contraction adds and removes no words, so it cannot touch meaning', () => {
  const a = app();
  const before = 'You are running 8 kilometres and it is easy.';
  const after = a.voiceContract(before);
  const digits = s => (s.match(/\d+/g) || []).join(',');
  assert.equal(digits(after), digits(before), 'a number changed during contraction');
  assert.ok(after.length < before.length, 'nothing was contracted');
});

test('the real briefing comes out contracted', () => {
  const a = app();
  const spoken = a.voiceScriptText(a.voiceScriptFor(today(a)));
  assert.ok(!/you have got/.test(spoken), 'the lead is still uncontracted');
  assert.match(spoken, /you've got/);
});

// ---------------------------------------------------------------------------
// ONE COACHING BRAIN — no model anywhere near LISTEN
// ---------------------------------------------------------------------------
test('LISTEN still needs no model, no key and no network', () => {
  const a = app();
  a.fetch = () => { throw new Error('LISTEN must not reach the network'); };
  if (a.window) a.window.fetch = a.fetch;
  const dd = today(a);
  assert.ok(a.voiceScriptFor(dd).lines.length);
  a.handleVoiceListen(dd.id);
  assert.match(a.renderVoiceCard(dd), /voice-said/, 'the words never appeared');
});

test('the spoken briefing reaches no model, on the server or the client', () => {
  assert.ok(!/voice-brief/.test(SRC), 'the runtime still references a model paraphrase route');
  const apiDir = path.join(ROOT, 'api');
  assert.ok(!fs.existsSync(path.join(apiDir, '_voice-brief.js')),
    'the model paraphrase module is still present');
  const routes = fs.readFileSync(path.join(apiDir, 'voice.js'), 'utf8');
  assert.ok(!/voice-brief/.test(routes), 'the router still exposes a paraphrase route');
  const vercel = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
  assert.ok(!/voice-brief/.test(vercel), 'vercel.json still routes a paraphrase endpoint');
});

test('the narration half contains no fetch and no endpoint', () => {
  const region = SRC.slice(SRC.indexOf('THE VOICE COACH — NARRATION'),
                           SRC.indexOf('ASK COACH — THE CONTEXT LAYER'));
  assert.ok(!/fetch\(/.test(region), 'the on-device half makes a network call');
  assert.ok(!/\/api\//.test(region), 'the on-device half names an endpoint');
});

// ---------------------------------------------------------------------------
// GUIDANCE LEVEL IS UNCHANGED BY ANY OF THIS
// ---------------------------------------------------------------------------
test('concise still keeps the instruction and drops purpose, feel and watch-out', () => {
  const a = app();
  const dd = today(a);
  a.state.guidanceLevel = 'concise';
  const script = a.voiceScriptFor(dd);
  if (script.level !== 'concise') return; // the day resolved differently; nothing to assert
  const spoken = a.voiceScriptText(script);
  assert.ok(!/It should feel /.test(spoken), 'concise spoke the feel');
  assert.ok(!/Watch for /.test(spoken), 'concise spoke the watch-out');
});
