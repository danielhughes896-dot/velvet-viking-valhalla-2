'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THE TODAY VOICE COACH
 * ===========================================================================
 * THE PRODUCT RULE EVERY TEST HERE SERVES: the coach may become conversational,
 * but the coaching may not become generative. Valhalla's deterministic engine
 * decides what the athlete should run and how it went; voice explains that
 * decision out loud and can never make one.
 *
 * That yields four properties worth protecting by test:
 *
 *   1. LISTEN REACHES NO NETWORK AT ALL. The briefing and the debrief are
 *      composed on the device from coachBrief()/coachDebrief()/
 *      coachingDisclosureFor() -- so they cannot drift from the screen, cannot
 *      fail in an outage, and cannot leak a field.
 *   2. NOTHING SPEAKS UNTIL IT IS PRESSED.
 *   3. VOICE EXISTS ON TODAY AND NOWHERE ELSE.
 *   4. GUIDANCE LEVEL CHANGES LENGTH AND NEVER PRESCRIPTION.
 */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const TODAY = '2026-08-24';
const START = '2026-08-03';

function athlete(opts){
  const o = opts || {};
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 10, startDate: START, distanceKey: '10k', volume: 40,
                 healthConsent: o.healthConsent !== false,
                 schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } });
  a.state.view = 'today';
  return a;
}
const todayDay = a => a.findDayByDate(TODAY);
function completeIt(a, dd, over){
  a.applyCompletion(dd, true);
  dd.actual = Object.assign(a.emptyActual(), { km: dd.km, pace: '5:20', rpe: 6 }, over || {});
  return dd;
}

// ---------------------------------------------------------------------------
// 1. LISTEN IS LOCAL
// ---------------------------------------------------------------------------
test('the briefing is composed from the engine, not fetched', async () => {
  /* If any part of LISTEN reached the network this would reject: the harness
     fetch is a rejecting stub. Nothing here awaits anything. */
  const a = athlete();
  const dd = todayDay(a);
  assert.ok(dd, 'the fixture has no session today');
  const script = a.voiceBriefingScript(dd);
  assert.ok(script && script.lines.length, 'no briefing was produced');
  assert.equal(script.kind, 'briefing');
});

test('the briefing says the same things the card says', () => {
  /* FIDELITY, checked against the source the card renders rather than against
     a copy: every sentence of guidance spoken must come from
     coachingDisclosureFor(), which is what "How to run this" displays. */
  const a = athlete();
  const dd = todayDay(a);
  const gd = a.coachingDisclosureFor(dd, a.athleteExperience(a.state.setup));
  if (!gd || !gd.how) return;
  a.setGuidanceLevel('full');
  const spoken = a.voiceScriptText(a.voiceBriefingScript(dd));
  assert.ok(spoken.includes(a.voiceSpeakable(gd.how)),
    'the execution instruction on screen was not the one spoken');
});

test('the debrief never concludes more than the engine concluded', () => {
  const a = athlete();
  const dd = completeIt(a, todayDay(a));
  const engine = a.coachDebrief(dd);
  const script = a.voiceDebriefScript(dd);
  assert.ok(script, 'a completed session produced no debrief');
  assert.equal(script.kind, 'debrief');
  a.setGuidanceLevel('full');
  const spoken = a.voiceScriptText(a.voiceDebriefScript(dd));
  engine.paragraphs.forEach(p => assert.ok(spoken.includes(a.voiceSpeakable(p)),
    'the engine said something the coach did not: ' + p));
});

test('LISTEN switches from briefing to debrief when the session is logged', () => {
  const a = athlete();
  const dd = todayDay(a);
  assert.equal(a.voiceScriptFor(dd).kind, 'briefing');
  completeIt(a, dd);
  assert.equal(a.voiceScriptFor(dd).kind, 'debrief');
});

test('an un-scoreable session still briefs, and simply does not debrief', () => {
  /* Degrading to silence would be worse than degrading to less: the athlete
     still has a session to run. */
  const a = athlete();
  const dd = todayDay(a);
  a.applyCompletion(dd, true);
  dd.actual = a.emptyActual();               // completed, nothing logged
  const script = a.voiceScriptFor(dd);
  assert.ok(script, 'a completed-but-unlogged day produced nothing to say');
});

// ---------------------------------------------------------------------------
// 2. NO AUTOPLAY
// ---------------------------------------------------------------------------
test('no render path can start speech', () => {
  /* Structural, because this is a promise about what happens when an athlete
     opens the app on a train. Every voiceSpeak() call site must be a handler,
     never a renderer. */
  /* CHECKED AGAINST CODE, NOT COMMENTS. This runtime explains itself at
     length, and several of those notes naturally name voiceSpeak() -- scanning
     the raw file reports the prose describing the rule as a violation of it.
     Comments are blanked rather than removed so every offset still lines up. */
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))
                  .replace(/^[ \t]*\/\/.*$/gm, m => ' '.repeat(m.length));

  /* Every function here is a top-level declaration, so the enclosing function
     of a call is the nearest `function NAME(` starting a line above it. */
  const decls = [...CODE.matchAll(/^function ([A-Za-z0-9_]+)\s*\(/gm)]
    .map(m => ({ at: m.index, name: m[1] }));
  const enclosing = at => {
    let best = '(top level)';
    for (const d of decls){ if (d.at < at) best = d.name; else break; }
    return best;
  };
  const callSites = [];
  const rx = /voiceSpeak\(/g; let m;
  while ((m = rx.exec(CODE)) !== null){
    if (CODE.slice(Math.max(0, m.index - 9), m.index).indexOf('function ') !== -1) continue;
    callSites.push(enclosing(m.index));
  }
  assert.ok(callSites.length, 'voiceSpeak is never called -- the test is not testing anything');
  callSites.forEach(name => {
    assert.ok(!/^render/.test(name), 'speech is started from a renderer: ' + name);
    assert.ok(!/^patch/.test(name), 'speech is started from a patch: ' + name);
  });
});

test('rendering the Today card speaks nothing', () => {
  const a = athlete();
  let spoke = 0;
  a.voiceSpeak = function(){ spoke++; return true; };
  a.voiceSetAvailable(true);
  a.renderVoiceCard(todayDay(a));
  a.renderDayCard(todayDay(a));
  assert.equal(spoke, 0, 'drawing the card produced audio');
});

// ---------------------------------------------------------------------------
// 3. TODAY ONLY
// ---------------------------------------------------------------------------
test('voice is offered on Today and on no other view', () => {
  const a = athlete();
  a.voiceSetAvailable(true);
  const dd = todayDay(a);
  a.state.view = 'today';
  assert.equal(a.voiceMayRender(dd), true);
  ['week', 'full', 'planhq', 'settings'].forEach(v => {
    a.state.view = v;
    assert.equal(a.voiceMayRender(dd), false, 'voice leaked onto ' + v);
    assert.equal(a.renderVoiceCard(dd), '', 'voice markup leaked onto ' + v);
  });
});

test('the same day card carries no voice controls inside This Week', () => {
  /* The real leak path: This Week and Full Plan map the identical renderer
     over every day, today's included. */
  const a = athlete();
  a.voiceSetAvailable(true);
  /* The harness has no speechSynthesis, so Listen would be undrawn for a
     reason that has nothing to do with the view. Stubbed so this test is about
     the boundary it names. */
  a.voiceAvailable = () => true;
  const dd = todayDay(a);
  a.state.view = 'week';
  const inWeek = a.renderDayCard(dd);
  assert.ok(!/data-action="voice-listen"/.test(inWeek));
  assert.ok(!/data-action="voice-ask-open"/.test(inWeek));
  a.state.view = 'today';
  assert.match(a.renderDayCard(dd), /data-action="voice-listen"/,
    'and it must still be there on Today');
});

test('a day that is not today is never given voice', () => {
  const a = athlete();
  a.voiceSetAvailable(true);
  const other = a.state.days.filter(d => d.date !== TODAY && d.type !== 'rest')[0];
  assert.equal(a.voiceMayRender(other), false);
});

// ---------------------------------------------------------------------------
// 4. GUIDANCE LEVEL
// ---------------------------------------------------------------------------
test('Guidance Level defaults to Adaptive and rejects anything else', () => {
  const a = athlete();
  assert.equal(a.guidanceLevel(), 'adaptive');
  assert.equal(a.setGuidanceLevel('nonsense'), false);
  assert.equal(a.guidanceLevel(), 'adaptive');
  ['adaptive','full','concise'].forEach(v => assert.equal(a.setGuidanceLevel(v), true));
});

test('Concise says less than Full, about the same session', () => {
  const a = athlete();
  const dd = todayDay(a);
  a.setGuidanceLevel('full');
  const full = a.voiceBriefingScript(dd);
  a.setGuidanceLevel('concise');
  const concise = a.voiceBriefingScript(dd);
  assert.ok(concise.lines.length <= full.lines.length,
    'concise was not shorter than full');
  assert.ok(a.voiceScriptText(concise).length < a.voiceScriptText(full).length,
    'concise produced as many words as full');
  assert.equal(concise.lines[0], full.lines[0],
    'the session itself must be stated either way');
});

test('Guidance Level changes NOTHING about the plan', () => {
  /* The line that separates a presentation control from a methodology one.
     Three athletes, three settings, one identical plan. */
  const snap = level => {
    const a = athlete();
    a.setGuidanceLevel(level);
    return JSON.stringify(a.state.days);
  };
  const adaptive = snap('adaptive'), full = snap('full'), concise = snap('concise');
  assert.equal(full, adaptive, 'Full changed the plan');
  assert.equal(concise, adaptive, 'Concise changed the plan');
});

test('Guidance Level is not Experience Level, and neither reads the other', () => {
  /* They are separate concepts and the code must keep them separate: nothing
     in the guidance module may consult experience, and setting one must not
     move the other. */
  const a = athlete();
  a.setGuidanceLevel('concise');
  assert.equal(a.athleteExperience(a.state.setup), 'experienced',
    'changing coaching detail changed the athlete\'s experience level');
  a.state.setup.experience = 'novice';
  assert.equal(a.guidanceLevel(), 'concise',
    'changing experience changed the coaching-detail preference');

  const mod = SRC.slice(SRC.indexOf('function guidanceLevel()'),
                        SRC.indexOf('function guidanceAdaptiveReason'));
  assert.ok(!/athleteExperience|state\.experience/.test(mod),
    'the guidance module reads experience -- they must stay independent');
});

test('Adaptive fails towards detail', () => {
  /* Saying too much costs ten seconds; saying too little costs the session. */
  const a = athlete();
  a.setGuidanceLevel('adaptive');
  assert.equal(a.resolvedGuidanceLevel(todayDay(a)), 'full',
    'a brand-new athlete with no history was given the short version');
  assert.equal(a.resolvedGuidanceLevel(null), 'full');
});

test('Adaptive restores detail when the plan was adjusted', () => {
  const a = athlete();
  a.setGuidanceLevel('adaptive');
  const dd = todayDay(a);
  dd.coachAdjust = { source: 'coach' };
  assert.equal(a.guidanceInterventionWarranted(dd), true);
  assert.equal(a.resolvedGuidanceLevel(dd), 'full');
});

test('Adaptive explains itself to the athlete', () => {
  const a = athlete();
  a.setGuidanceLevel('adaptive');
  assert.ok(a.guidanceAdaptiveReason(todayDay(a)), 'adaptive gave no reason');
  a.setGuidanceLevel('full');
  assert.equal(a.guidanceAdaptiveReason(todayDay(a)), null,
    'a fixed setting must not pretend to be adaptive');
});

// ---------------------------------------------------------------------------
// SPEECH IS SPOKEN, NOT READ OFF A CARD
// ---------------------------------------------------------------------------
test('units, paces and abbreviations are said, not spelled', () => {
  const a = athlete();
  const cases = [
    ['10.2km',            /10\.2 kilometres/],
    ['4:30/km',           /4 minutes 30 seconds per kilometre/],
    ['4:51/km–5:33/km',   /4 minutes 51 seconds to 5 minutes 33 seconds per kilometre/],
    ['avg 152bpm',        /152 beats per minute/],
    ['RPE 6',             /effort 6/],
    ['HR drift',          /heart rate drift/]
  ];
  cases.forEach(([input, want]) => assert.match(a.voiceSpeakable(input), want,
    'not speakable: ' + input));
});

test('a session title is not turned into a range', () => {
  /* "Ladder: 1200-1800-1200m" is a sequence of reps. Spoken as "1200 to 1800
     to 1200" it becomes a range the athlete was never given. */
  const a = athlete();
  const said = a.voiceSpeakable('Ladder: 1200-1800-1200m');
  assert.ok(!/1200 to 1800/.test(said), 'a rep sequence was spoken as a range');
  assert.match(said, /metres/);
});

test('a card label is not read aloud as a verdict', () => {
  const a = athlete();
  assert.equal(a.voiceSpeakable('Insufficient evidence: Not enough scored sessions yet.'),
    'Not enough scored sessions yet.');
  assert.match(a.voiceSpeakable('You ran well: the second half was stronger.'),
    /^You ran well/, 'an ordinary sentence containing a colon was truncated');
});

test('every spoken line is also available as text', () => {
  const a = athlete();
  const script = a.voiceScriptFor(todayDay(a));
  assert.ok(script.lines.every(l => typeof l === 'string' && l.trim()),
    'a spoken line has no readable form');
  assert.equal(a.voiceScriptText(script), script.lines.join(' '));
});

// ---------------------------------------------------------------------------
// THE VOICE ITSELF
// ---------------------------------------------------------------------------
test('one British female voice is preferred, and any English voice beats silence', () => {
  const a = athlete();
  const pick = list => { const v = a.voicePickVoice(list); return v && v.name; };
  assert.equal(pick([{ name:'Daniel', lang:'en-GB', localService:true },
                     { name:'Google UK English Female', lang:'en-GB' }]),
               'Google UK English Female');
  assert.equal(pick([{ name:'Alex', lang:'en-US', localService:true }]), 'Alex',
    'an American voice is better than no voice');
  assert.equal(a.voicePickVoice([]), null);
  assert.equal(a.voicePickVoice(null), null);
});

/* THIS TEST USED TO ASSERT THE BUG. It required that a device without speech
 * synthesis be shown NO control -- which is what shipped, and what made the
 * briefing vanish entirely on the founder's Android device: the installed app
 * is a Capacitor WebView and Android WebView does not expose
 * window.speechSynthesis.
 *
 * The suite could not catch it because the suite agreed with it. The contract
 * it now holds is the right one: the briefing is the product and speech is only
 * the delivery, so the control is offered whenever there is something to say,
 * and the press produces the words either way.
 */
test('a device that cannot speak still gets the briefing, as text', () => {
  const a = athlete();                    // the harness has no speechSynthesis
  assert.equal(a.voiceAvailable(), false, 'precondition: this device cannot speak');
  const html = a.renderVoiceCard(todayDay(a));
  assert.match(html, /data-action="voice-listen"/,
    'the briefing disappeared with the voice');
  assert.match(html, />Read today</,
    'the label must promise what the press will actually do on this device');
  assert.ok(!/>Hear today</.test(html),
    'a device that cannot speak must not offer to speak');
});

test('pressing it on such a device reveals the words and can be closed again', () => {
  const a = athlete();
  const dd = todayDay(a);
  a.handleVoiceListen(dd.id);
  const open = a.renderVoiceCard(dd);
  assert.match(open, /voice-said/, 'the press produced nothing at all');
  assert.match(open, /data-action="voice-stop"/, 'there is no way to close it');
  a.voiceStop();
  assert.ok(!/voice-said/.test(a.renderVoiceCard(dd)), 'it could not be closed');
});

test('every line that would have been spoken is in the text', () => {
  const a = athlete();
  const dd = todayDay(a);
  const script = a.voiceScriptFor(dd);
  a.handleVoiceListen(dd.id);
  const html = a.renderVoiceCard(dd);
  script.lines.forEach(l => assert.ok(html.indexOf(a.escapeHtml(l)) !== -1,
    'a spoken line has no readable form: ' + l));
});

test('a device that CAN speak is offered speech, not a read-out', () => {
  const a = athlete();
  a.voiceAvailable = () => true;
  const html = a.renderVoiceCard(todayDay(a));
  assert.match(html, />Hear today</);
  assert.ok(!/>Read today</.test(html));
});
