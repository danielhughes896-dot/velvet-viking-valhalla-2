'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THE SPOKEN RENDERING — A SECOND RENDERING, NOT A SECOND BRAIN
 * ===========================================================================
 * The guidance table is written for a CARD: four labelled cells, each a
 * fragment, read by the eye in a layout that supplies the grammar. Composing
 * those fragments into sentences got the briefing to correct English and no
 * further -- it still enumerated the screen, because the WORDS were the
 * screen's words.
 *
 * So the same coaching facts get a rendering authored for the ear. What makes
 * that safe rather than a second coach is enforced here, not intended:
 *
 *   - the authored text holds NO number. Every distance, pace, duration, rep
 *     count and recovery is injected from the prescription at speech time, so
 *     the table cannot contradict the engine even if edited carelessly.
 *   - the session's STRUCTURE survives. "7x400 metres" is where the reps and
 *     recoveries live, and shortening must never be what loses them.
 *   - the purpose is said ONCE, and the engine's own intent line wins.
 *   - a session type with no entry is spoken plainly, never dropped.
 */

const TODAY = '2026-08-24';
const TYPES = ['easy','long','tempo','threshold','interval','repetition','checkpoint','race'];

function app(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.scheduleSave = () => {}; a.flushSave = () => {};
  buildPlan(a, { weeks: 14, startDate: '2026-07-01', distanceKey: '10k', volume: 40,
                 schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } });
  return a;
}
const firstOf = (a, t) => a.state.days.filter(d => d.type === t)[0];
const spokenFor = (a, dd) => a.voiceScriptText(a.voiceBriefingScript(dd));
function eachType(a, fn){
  TYPES.forEach(t => { const dd = firstOf(a, t); if (dd) fn(dd, t); });
}

// ---------------------------------------------------------------------------
// THE TABLE IS COMPLETE, AND HOLDS NO COACHING NUMBERS
// ---------------------------------------------------------------------------
test('every authored session type has a complete spoken rendering', () => {
  const a = app();
  TYPES.forEach(t => {
    const s = a.VOICE_SPOKEN[t];
    assert.ok(s, 'no spoken rendering authored for ' + t);
    ['opener', 'cue', 'purpose'].forEach(f =>
      assert.ok(s[f] && String(s[f]).trim(), t + ' is missing its ' + f));
  });
});

test('the authored text contains no number of any kind', () => {
  /* The single most important property. A distance, pace or rep count written
     here could contradict the prescription; injected from the engine, it
     cannot. */
  const a = app();
  Object.keys(a.VOICE_SPOKEN).forEach(t => {
    const s = a.VOICE_SPOKEN[t];
    ['opener', 'cue', 'purpose'].forEach(f =>
      assert.ok(!/\d/.test(String(s[f])),
        t + '.' + f + ' hard-codes a number: ' + s[f]));
  });
});

test('no number is spoken that the engine did not supply', () => {
  const a = app();
  eachType(a, (dd, t) => {
    let gd = null;
    try { gd = a.coachingDisclosureFor(dd, a.athleteExperience(a.state.setup)); } catch(e){}
    const source = [a.voiceSessionLine(dd), gd && gd.how, gd && gd.why, gd && gd.feel, gd && gd.avoid,
      ((a.coachBrief(dd) || {}).paragraphs || []).join(' ')].filter(Boolean).join(' ');
    const known = {};
    (a.voiceSpeakable(source).match(/\d+/g) || []).forEach(n => { known[n] = true; });
    (spokenFor(a, dd).match(/\d+/g) || []).forEach(n =>
      assert.ok(known[n], t + ' spoke a number the engine never said: ' + n));
  });
});

// ---------------------------------------------------------------------------
// STRUCTURE SURVIVES — reps and recoveries are not "detail" to be trimmed
// ---------------------------------------------------------------------------
test('the prescription reaches speech for every session type', () => {
  const a = app();
  eachType(a, (dd, t) => {
    const said = spokenFor(a, dd);
    const dist = a.voiceSpokenDistance(dd.km);
    if (dist) assert.ok(said.indexOf(a.voiceSpeakable(dist)) !== -1,
      t + ' did not say how far: expected ' + dist);
  });
});

test('a structured session says its structure, not just its total', () => {
  /* "repetition: 7x400 metres" is where the reps live. A briefing that says
     only "8 kilometres" has dropped the session. */
  const a = app();
  ['repetition', 'interval', 'threshold'].forEach(t => {
    const dd = firstOf(a, t);
    if (!dd || !dd.title) return;
    /* Compared against the SPEAKABLE form of the title: voiceSpeakable()
       legitimately expands "7x400m" into "7x400 metres", so matching the raw
       card string would fail on a briefing that said the structure correctly. */
    const said = spokenFor(a, dd).toLowerCase();
    const spokenTitle = a.voiceSpeakable(String(dd.title)).toLowerCase();
    const tail = spokenTitle.replace(/\s*\.\s*$/, '').split(' ').slice(-2).join(' ');
    assert.ok(said.indexOf(tail) !== -1,
      t + ' lost its structure: expected "' + tail + '" in: ' + said);
  });
});

test('the pace window is spoken wherever the engine set one', () => {
  const a = app();
  eachType(a, (dd, t) => {
    let targets = null;
    try { targets = a.getDayTargets(dd); } catch(e){}
    if (!targets || !targets.pace) return;
    assert.match(spokenFor(a, dd), /Pace is around /, t + ' dropped its pace window');
  });
});

// ---------------------------------------------------------------------------
// SAID ONCE, AND NOT LIKE A SCREEN
// ---------------------------------------------------------------------------
test('the purpose is said once, and the engine\'s own line wins', () => {
  const a = app();
  eachType(a, (dd, t) => {
    const brief = a.coachBrief(dd);
    const intent = a.voiceBriefParagraphs(brief)[0];
    const said = spokenFor(a, dd);
    if (!intent) return;
    assert.ok(said.indexOf(a.voiceSpeakable(intent)) !== -1,
      t + ' dropped the engine\'s intent line');
    const authored = a.VOICE_SPOKEN[t].purpose;
    assert.ok(said.indexOf(a.voiceSpeakable(authored)) === -1,
      t + ' spoke BOTH purposes, which is the defect this layer removes');
  });
});

test('the briefing is short enough to be something a coach would say', () => {
  const a = app();
  eachType(a, (dd, t) =>
    assert.ok(a.voiceBriefingScript(dd).lines.length <= 4,
      t + ' speaks ' + a.voiceBriefingScript(dd).lines.length + ' separate lines'));
});

test('no label, heading or evidence-status furniture is spoken', () => {
  const a = app();
  eachType(a, (dd, t) => {
    const said = spokenFor(a, dd);
    assert.ok(!/Insufficient evidence|WATCH FOR|HOW TO RUN|FEEL:/i.test(said),
      t + ' read interface furniture aloud: ' + said);
  });
});

// ---------------------------------------------------------------------------
// A TYPE WITH NO RENDERING IS SPOKEN PLAINLY, NEVER DROPPED
// ---------------------------------------------------------------------------
test('an unauthored session type falls back rather than going silent', () => {
  const a = app();
  const dd = firstOf(a, 'easy');
  delete a.VOICE_SPOKEN.easy;
  const script = a.voiceBriefingScript(dd);
  assert.ok(script && script.lines.length, 'an unauthored type produced no briefing at all');
  const said = a.voiceScriptText(script);
  const gd = a.coachingDisclosureFor(dd, a.athleteExperience(a.state.setup));
  const tail = String(gd.how).replace(/\s*\.\s*$/, '').split(' ').slice(-3).join(' ').toLowerCase();
  assert.ok(said.toLowerCase().indexOf(tail) !== -1,
    'the fallback lost the instruction: ' + said);
});

// ---------------------------------------------------------------------------
// GUIDANCE LEVEL
// ---------------------------------------------------------------------------
test('concise is genuinely brief and still says what to do', () => {
  const a = app();
  const dd = firstOf(a, 'easy');
  a.state.guidanceLevel = 'full';
  const full = a.voiceBriefingScript(dd);
  a.state.guidanceLevel = 'concise';
  const concise = a.voiceBriefingScript(dd);
  if (concise.level !== 'concise' || full.level !== 'full') return;
  assert.ok(concise.lines.length < full.lines.length, 'concise is not shorter');
  assert.ok(concise.lines.length <= 2, 'concise speaks ' + concise.lines.length + ' lines');
  const said = a.voiceScriptText(concise);
  assert.match(said, /Keep it relaxed and conversational/, 'concise dropped the cue');
  assert.match(said, /kilometres/, 'concise dropped the prescription');
});

test('there is no Voice-specific verbosity setting', () => {
  const a = app();
  const dd = firstOf(a, 'easy');
  a.state.guidanceLevel = 'concise';
  assert.equal(a.voiceBriefingScript(dd).level, a.resolvedGuidanceLevel(dd));
});

// ---------------------------------------------------------------------------
// ONE COACHING BRAIN
// ---------------------------------------------------------------------------
test('the spoken layer reaches no model and no network', () => {
  const a = app();
  a.fetch = () => { throw new Error('the spoken briefing must not reach the network'); };
  if (a.window) a.window.fetch = a.fetch;
  eachType(a, (dd, t) =>
    assert.ok(a.voiceScriptText(a.voiceBriefingScript(dd)).length,
      t + ' produced no briefing'));
});

test('the rendering cannot change the prescription', () => {
  const a = app();
  eachType(a, (dd, t) => {
    const before = { km: dd.km, type: dd.type, title: dd.title };
    a.voiceBriefingScript(dd);
    assert.equal(dd.km, before.km, t + ': speaking changed the distance');
    assert.equal(dd.type, before.type, t + ': speaking changed the type');
    assert.equal(dd.title, before.title, t + ': speaking changed the title');
  });
});
