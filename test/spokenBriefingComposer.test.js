'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THE SPOKEN BRIEFING IS COMPOSED, NOT READ
 * ===========================================================================
 * WHY THE PREVIOUS PASS STILL SOUNDED LIKE A SCREEN READER. It framed each
 * card value into a grammatical sentence and then spoke ALL of them, in card
 * order. Every line was a sentence and the whole was still the page:
 *
 *   - `why` and coachBrief()'s intent line say the SAME THING in two
 *     registers -- "Aerobic base, and freshness for the hard days" beside
 *     "Today is about banking aerobic time cheaply". Both were spoken.
 *   - FEEL and WATCH FOR are two cells of one row and one thought out loud.
 *     They were two separate sentences.
 *   - Labelled status paragraphs -- "Insufficient evidence: Not enough scored
 *     sessions yet to judge your training trend confidently" -- were spoken.
 *     That is Valhalla's confidence in itself, read to the athlete.
 *
 * THE ARCHITECTURE NOW. Structured coaching outputs -> composer -> speech.
 * The composer may condense, join and choose between two renderings of one
 * point. It may not decide anything: no prescription changes, no watch-for is
 * dropped, no number appears that the engine did not say.
 */

const TODAY = '2026-08-24';
function app(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.scheduleSave = () => {}; a.flushSave = () => {};
  buildPlan(a, { weeks: 14, startDate: '2026-07-01', distanceKey: '10k', volume: 40,
                 schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } });
  a.voiceSetAvailable(true);
  return a;
}
const firstOf = (a, t) => a.state.days.filter(d => d.type === t)[0];
const spokenFor = (a, dd) => a.voiceScriptText(a.voiceBriefingScript(dd));
function corpus(a){
  const seen = {}, out = [];
  a.state.days.filter(d => d.type !== 'rest').forEach(d => {
    if (seen[d.type]) return; seen[d.type] = 1;
    let gd = null;
    try { gd = a.coachingDisclosureFor(d, a.athleteExperience(a.state.setup)); } catch(e){}
    if (gd) out.push({ dd: d, gd });
  });
  return out;
}

// ---------------------------------------------------------------------------
// CONDENSATION — the same coaching, said once
// ---------------------------------------------------------------------------
test('the card value for purpose is not spoken alongside the coach\'s own sentence', () => {
  const a = app();
  const dd = firstOf(a, 'easy');
  const gd = a.coachingDisclosureFor(dd, a.athleteExperience(a.state.setup));
  const brief = a.coachBrief(dd);
  assert.ok(brief && brief.paragraphs.length, 'the fixture produced no coach intent line');
  const spoken = spokenFor(a, dd);
  const whyTail = gd.why.replace(/\s*\.\s*$/, '').split(' ').slice(-3).join(' ').toLowerCase();
  assert.ok(spoken.toLowerCase().indexOf(whyTail) === -1,
    'both renderings of the same point were spoken: ' + spoken);
  assert.match(spoken, /banking aerobic time/, 'the coach\'s own intent line was dropped');
});

test('when the coach produced no intent line, the card value carries the purpose', () => {
  const a = app();
  const dd = firstOf(a, 'easy');
  a.coachBrief = () => null;
  const spoken = spokenFor(a, dd);
  assert.match(spoken, /This one's for|It raises|It resets/,
    'with no coach sentence, the purpose vanished entirely: ' + spoken);
});

test('feel and watch-for are one thought, not two card cells', () => {
  const a = app();
  const spoken = spokenFor(a, firstOf(a, 'easy'));
  assert.match(spoken, /Keep it conversational throughout, and watch for drifting up/,
    'feel and watch-for are still two separate sentences: ' + spoken);
});

test('a feel that is already two clauses is left as its own sentence', () => {
  /* "Hard but even, and repeatable" plus a second `and` reads worse than the
     two sentences it replaced. */
  const a = app();
  const spoken = spokenFor(a, firstOf(a, 'threshold'));
  assert.ok(!/and repeatable, and watch for/.test(spoken),
    'a two-clause feel was joined anyway: ' + spoken);
  assert.match(spoken, /Watch for racing it/, 'the watch-for was lost in the process');
});

test('the briefing is shorter than the card it came from', () => {
  const a = app();
  corpus(a).forEach(({ dd, gd }) => {
    const lines = a.voiceBriefingScript(dd).lines.length;
    /* Session + how + (feel/watch-for) + purpose. The old shape spoke session,
       how, why, feel, avoid and every brief paragraph separately. */
    assert.ok(lines <= 5, dd.type + ' still speaks ' + lines + ' separate lines');
  });
});

// ---------------------------------------------------------------------------
// CARD FURNITURE IS NOT COACHING
// ---------------------------------------------------------------------------
test('a labelled status paragraph is never spoken', () => {
  const a = app();
  const dd = firstOf(a, 'threshold');
  const brief = a.coachBrief(dd);
  const labelled = brief.paragraphs.filter(p => /^[A-Z][A-Za-z]*(?:\s+[a-z]+){0,2}:\s+[A-Z]/.test(p));
  assert.ok(labelled.length, 'the fixture produced no labelled paragraph to test against');
  const spoken = spokenFor(a, dd).toLowerCase();
  labelled.forEach(p => {
    const tail = p.replace(/\s*\.\s*$/, '').split(' ').slice(-4).join(' ').toLowerCase();
    assert.ok(spoken.indexOf(tail) === -1, 'card status was read aloud: ' + p);
  });
});

test('an unlabelled coaching paragraph is never dropped', () => {
  const a = app();
  const dd = firstOf(a, 'easy');
  a.coachBrief = () => ({ when:'before', depth:'normal', paragraphs:[
    'Today is about banking aerobic time cheaply.',
    'Ease off if the calf is still sore.' ] });
  const spoken = spokenFor(a, dd);
  assert.match(spoken, /Ease off if the calf is still sore/,
    'a second coaching paragraph was silently dropped: ' + spoken);
});

test('the filter reads shape, not a particular message', () => {
  const a = app();
  assert.equal(a.voiceBriefParagraphs({ paragraphs:[
    'Some status: A thing about Valhalla.', 'Real coaching here.' ] }).length, 1);
  assert.equal(a.voiceBriefParagraphs({ paragraphs:[ 'Real coaching here.' ] }).length, 1);
  assert.equal(a.voiceBriefParagraphs(null).length, 0);
});

// ---------------------------------------------------------------------------
// NOTHING IS INVENTED, NOTHING PRESCRIPTIVE IS LOST
// ---------------------------------------------------------------------------
test('no number is spoken that the engine did not say', () => {
  const a = app();
  corpus(a).forEach(({ dd, gd }) => {
    const source = [a.voiceSessionLine(dd), gd.how, gd.why, gd.feel, gd.avoid,
      ((a.coachBrief(dd) || {}).paragraphs || []).join(' ')].join(' ');
    const known = {};
    (a.voiceSpeakable(source).match(/\d+/g) || []).forEach(n => { known[n] = true; });
    (spokenFor(a, dd).match(/\d+/g) || []).forEach(n =>
      assert.ok(known[n], dd.type + ' spoke a number the engine never said: ' + n));
  });
});

test('the watch-for instruction survives into speech for every session type', () => {
  /* A safety/avoid instruction may never be the thing condensation drops. */
  const a = app();
  corpus(a).forEach(({ dd, gd }) => {
    if (!gd.avoid) return;
    const tail = gd.avoid.replace(/\s*\.\s*$/, '').split(' ').slice(-3).join(' ').toLowerCase();
    assert.ok(spokenFor(a, dd).toLowerCase().indexOf(tail) !== -1,
      dd.type + ' lost its watch-for: ' + gd.avoid);
  });
});

test('the prescribed instruction survives into speech for every session type', () => {
  const a = app();
  corpus(a).forEach(({ dd, gd }) => {
    if (!gd.how) return;
    const tail = gd.how.replace(/\s*\.\s*$/, '').split(' ').slice(-3).join(' ').toLowerCase();
    assert.ok(spokenFor(a, dd).toLowerCase().indexOf(tail) !== -1,
      dd.type + ' lost its instruction: ' + gd.how);
  });
});

// ---------------------------------------------------------------------------
// GUIDANCE LEVEL, UNCHANGED AND NOT VOICE-SPECIFIC
// ---------------------------------------------------------------------------
test('concise says less than full, and drops feel and watch-for rather than the instruction', () => {
  const a = app();
  const dd = firstOf(a, 'easy');
  a.state.guidanceLevel = 'full';
  const full = a.voiceBriefingScript(dd);
  a.state.guidanceLevel = 'concise';
  const concise = a.voiceBriefingScript(dd);
  if (concise.level !== 'concise' || full.level !== 'full') return;
  assert.ok(concise.lines.length < full.lines.length, 'concise is not shorter than full');
  const said = a.voiceScriptText(concise);
  assert.ok(!/Keep it |Watch for |It should feel /.test(said), 'concise spoke the feel or watch-for');
  assert.match(said, /Hold the easy window/, 'concise dropped the instruction itself');
});

test('there is no Voice-specific verbosity setting', () => {
  const a = app();
  const dd = firstOf(a, 'easy');
  a.state.guidanceLevel = 'concise';
  assert.equal(a.voiceBriefingScript(dd).level, a.resolvedGuidanceLevel(dd),
    'the spoken briefing resolved a level of its own');
});
