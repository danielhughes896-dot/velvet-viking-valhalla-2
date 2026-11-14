'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* RECOVERY, PATTERNS AND ADAPTATION IN ONE STRUCTURE.

   Founder, with three references: "Can you make the recovery and fatigue
   page like this?", "the patterns page like this ... Graphs", "And last.
   Same as the other cards. Same rules." Then: "Build all three".

   The circle with the word in it and the sentence beside it; three tiles,
   each with a ring; the evidence; a closing section. Every ring is a share
   of something the engine already holds, and nothing is said twice. */

const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const TODAY = '2026-05-20';
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  buildPlan(a, { weeks: 16, distanceKey: 'half', startDate: a.addDays(TODAY, -42), lthr: 170, maxHR: 190 });
  a.state.healthConsent = { version: a.HEALTH_CONSENT_VERSION, decision: 'granted', at: '2026-01-01T00:00:00Z' };
  a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').forEach((d, i) => {
    if (i % 8 === 5) return;
    logAsPrescribed(a, d, { quality: (i % 4 === 2 ? 0.8 : 1), sections: true });
  });
  return a;
}
const order = (p, labels) => {
  let at = -1;
  labels.forEach(l => {
    const i = p.indexOf(l, at + 1);
    assert.ok(i > at, '"' + l + '" is missing or out of order');
    at = i;
  });
};

test('RECOVERY: the circle holds the word, then signals, evidence and the assessment', () => {
  const a = athlete();
  const p = a.readingPanel('recovery');
  assert.match(p, /class="rp-hero is-word" data-tone="(good|watch|bad)"/);
  assert.match(p, /class="b-dial"[^>]*>.*rd-ring/, 'the recovery ring is not in the hero');
  assert.doesNotMatch(p, /class="rp-hero-verdict"/, 'the chip is back beside a circle that already says it');
  order(p, ['Recovery Signals', '>Morning<', '>Strain<', '>Easy HR<', 'The Evidence', 'Effort above band',
            'HR above zone', '>Feel<', 'SACORO’s Assessment']);
  assert.equal((p.match(/class="pt-tile"/g) || []).length, 3);
  // said once: the three tiles left the evidence
  ['Hard days in a row', 'This morning', 'Easy HR vs baseline'].forEach(l =>
    assert.doesNotMatch(p, new RegExp('hq-row-l">' + l), l + ' is said twice'));
  assert.ok(p.indexOf(a.coachAnalyse().decision.recommendation) !== -1, 'the assessment is not the coach\'s own');
});

test('RECOVERY: each tile ring is the share it says', () => {
  const a = athlete();
  a.handleSetReadiness('legs', 'heavy');
  const p = text(a.readingPanel('recovery'));
  assert.match(p, /1\/3 Morning Heavy legs/);
  const rec = a.coachRecovery();
  assert.match(p, new RegExp(rec.hardStreak + ' Strain Hard days? in a row'));
  const b = a.easyHRBaseline();
  assert.match(p, b.sufficient ? /Easy HR bpm vs baseline/ : a.easyRunsLackHeartRate() ? /Easy HR Needs heart rate on easy runs/ : /Easy HR Building baseline/);
});

test('PATTERNS: three rings, the evidence each needs, the questions, never a score', () => {
  const a = athlete();
  const P = a.patternProgress(a.coachAnalyse());
  assert.equal(P.map(x => x.label).join(), 'Pacing,Effort,Recovery');
  P.forEach(x => {
    assert.equal(x.frac, Math.min(1, x.n / x.need));
    assert.ok(['Learning', 'Emerging', 'Established', 'Watching', 'Improving', 'Stable'].indexOf(x.word) !== -1,
      x.label + ' reads "' + x.word + '", a word the engine does not use');
  });
  const p = a.readingPanel('patterns');
  /* Founder: "Patterns orb: Approved - build it on the Coach page and on
     the Patterns panel's circle." */
  assert.match(p, /class="b-dial is-orb"/, 'the hero is not the orb');
  assert.match(p, /<svg class="rd-orb"/);
  order(p, ['Three Patterns', '>Pacing<', '>Effort<', '>Recovery<', 'The Evidence',
            'What SACORO Is Learning', 'Do you hold your prescribed pace?', 'How hard does the work feel?',
            'How do you respond between sessions?', 'never a score.']);
  P.forEach(x => assert.match(text(p), new RegExp(Math.min(x.n, x.need) + '/' + x.need + ' ' + x.label + ' ' + x.word)));
});

test('PATTERNS: the headline sentence has no em dash', () => {
  const a = athlete();
  const sec = a.readingSections(a.coachAnalyse()).filter(s => s.key === 'patterns')[0];
  assert.doesNotMatch(sec.syn, /[—–]/);
  assert.equal(a.patternHeadlineSentence({ area: 'Recovery', headline: 'Watching' }), 'Recovery is worth watching.');
  assert.equal(a.patternHeadlineSentence({ area: 'Easy efficiency', headline: 'Improving' }), 'Easy efficiency is improving.');
});

test('ADAPTATION: torus, tiles, the timeline from its own reviews, evidence as rows, the read', () => {
  const a = athlete();
  a.state.blockReviews = [['2026-04-14', 'LEARNING'], ['2026-04-28', 'RESPONDING'], ['2026-04-29', 'PLATEAU'], ['2026-05-20', 'PLATEAU']]
    .map(([d, s]) => ({ date: d, state: s, at: d + 'T08:00:00Z', windowDays: 28, evidence: [], positives: [], negatives: [], qualifyingSessions: 10 }));
  const p = a.readingPanel('adaptation');
  assert.match(p, /class="b-dial is-torus"/);
  order(p, ['Your Adaptation', '>Aerobic<', '>Tolerance<', '>Break\u00ADthroughs<', 'Adaptation Timeline',
            'The Evidence', 'Observation window', 'Qualifying sessions', 'Coach’s Read']);
  // one point per plan week, its latest reading: the 28th and 29th share a week
  const wk = d => a.findDayByDate(d).week;
  const pts = [...p.matchAll(/pt-tl-w">W(\d+)<\/span><span class="pt-tl-s">(\w+)</g)].map(m => [+m[1], m[2]]);
  const want = {}; [['2026-04-14', 'Learning'], ['2026-04-28', 'Responding'], ['2026-04-29', 'Plateau'], ['2026-05-20', 'Plateau']]
    .forEach(([d, l]) => { want[wk(d)] = l; });
  assert.equal(JSON.stringify(pts), JSON.stringify(Object.keys(want).map(Number).sort((x, y) => x - y).map(w => [w, want[w]])));
  assert.match(p, /class="pt-tl-pt is-now"><span class="pt-dot"><\/span><span class="pt-tl-w">W\d+<\/span><span class="pt-tl-s">Plateau</);
  // the em dash list is rows now
  assert.doesNotMatch(text(p), /—/);
});

test('ADAPTATION: with no reviews yet the timeline says when it starts', () => {
  const a = athlete();
  a.state.blockReviews = [];
  assert.match(a.readingPanel('adaptation'), /The timeline starts with the first review of the block\./);
});

test('the three panels keep the house rules: white text, no new grey, 11px floor, one style block', () => {
  const css = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
  const rules = [...css.matchAll(/(\.pt-[\w-]+[^{]*)\{([^}]*)\}/g)];
  assert.ok(rules.length > 10);
  rules.forEach(([, sel, body]) => {
    const c = /(?:^|;)\s*color:([^;]+)/.exec(body);
    if (c) assert.equal(c[1].trim(), '#FFFFFF', sel + ' text is not white');
    assert.doesNotMatch(body, /font-size:[\d.]+px/, sel + ' sets its size in px, out of reach of text size');
    const f = /font-size:([\d.]+)rem/.exec(body);
    if (f) assert.ok(+f[1] * 16 >= 11, sel + ' is below the 11px floor');
  });
  assert.equal((SRC.match(/<style[\s>]/g) || []).length, 1);
});

test('PATTERNS: the Coach page draws the orb, the name under it, the word inside it dark on white', () => {
  const a = athlete();
  const rail = a.renderSacoroInstruments();
  assert.match(rail, /<button type="button" class="b-dial is-orb"[^>]*data-reading="patterns"/);
  const dial = rail.slice(rail.indexOf('data-reading="patterns"'));
  assert.match(dial, /<svg class="rd-orb"/);
  assert.match(dial, /<span class="rd-cat">Patterns<\/span>/, 'the name is not under the orb');
  const css = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /\.b-dial\.is-orb \.rd-val b\{color:#111216;/, 'the word inside the orb is not dark');
  // same string every render: the orb names its gradients once
  assert.equal(a.patternOrbHtml(), a.patternOrbHtml());
});

test('PLAN EVOLUTION: phase, then Phase Development, the evidence, recently evolved, the Coach’s Read', () => {
  /* Founder, with a reference: "change plan evolution to follow this
     structure - my rules my data". */
  const a = athlete();
  const fut = a.state.days.filter(d => d.date > TODAY && d.type !== 'rest');
  a.state.evolutionHistory = [{ date: a.addDays(TODAY, -2), accepted: true, changes: [{ dayId: fut[1].id }] }];
  const p = a.readingPanel('evolution');
  order(p, ['Current Phase', 'Phase Development', '>Aerobic<', '>Execution<', '>Structure<',
            'The Evidence', 'Evidence behind this', 'Recently evolved', 'Coach’s Read']);
  const d = a.evolutionDevelopment(a.coachAnalyse());
  // execution is this phase's own logged sessions, averaged
  const sc = a.state.days.filter(x => x.type !== 'rest' && x.completed && x.date < TODAY &&
    x.week >= d.phase.first && x.week <= d.phase.last).map(x => a.computeExecutionScore(x)).filter(v => v != null);
  assert.equal(d.execution, Math.round(sc.reduce((x, y) => x + y, 0) / sc.length));
  assert.match(text(p), new RegExp(d.execution + '% Execution ' + sc.length + ' sessions this phase'));
  assert.match(text(p), d.changes ? /Structure \d+ changes? suggested/ : /Stable Structure No change needed/);
  const read = text(p).slice(text(p).indexOf('Coach’s Read'));
  assert.match(read, new RegExp('Your ' + d.phase.name + ' phase is in week ' + d.phase.week + ' of ' + d.phase.weeks + '\\.'));
  assert.doesNotMatch(read, /[—–]/);
});

test('PLAN EVOLUTION: with nothing logged the read says so, and the tiles wait', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  buildPlan(a, { weeks: 16, distanceKey: 'half', startDate: a.addDays(TODAY, -42), lthr: 170, maxHR: 190 });
  const p = text(a.readingPanel('evolution'));
  assert.match(p, /Execution Awaiting runs/);
  assert.match(p, /There isn’t enough logged training yet to assess aerobic development or execution\./);
  assert.match(p, /The current plan remains unchanged\.|SACORO suggests/);
});

test('COLOUR: every graph on a panel wears the colour of the card that opens it', () => {
  /* Founder: "All colours of the pages behind the circles use same colours
     the cards represent." */
  const a = athlete();
  a.patternProgress(a.coachAnalyse()).forEach(p => assert.equal(p.col, a.READING_ACCENT.patterns, p.label));
  assert.match(a.evolutionPhaseHtml(), new RegExp('--ph-col:' + a.READING_ACCENT.evolution.replace(/[()]/g, '\\$&')));
  [['recovery', 'recovery'], ['adaptation', 'adaptation'], ['evolution', 'evolution']].forEach(([k]) => {
    const tiles = (a.readingPanel(k).match(/class="pt-tile" style="--pt-col:([^;]+);/g) || []);
    tiles.forEach(t => assert.ok(t.indexOf(a.READING_ACCENT[k]) !== -1, k + ' has a tile in another colour'));
  });
});

test('WORDS: without heart rate on easy runs the tiles say why they are waiting', () => {
  /* Founder: "I'd change the words to 'Needs heart rate on easy runs' so it
     says why." The fixture logs easy runs with no heart rate. */
  const a = athlete();
  assert.equal(a.easyRunsLackHeartRate(), true);
  const t = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(t(a.readingPanel('adaptation')), /Aerobic Needs heart rate on easy runs/);
  assert.match(t(a.readingPanel('recovery')), /Easy HR Needs heart rate on easy runs/);
  assert.match(t(a.readingPanel('evolution')), /Aerobic Needs heart rate on easy runs/);
  // once easy runs carry a heart rate, the ordinary word comes back
  a.state.days.filter(d => d.completed && d.type === 'easy').forEach(d => { d.actual.hr = 148; });
  assert.equal(a.easyRunsLackHeartRate(), false);
  assert.doesNotMatch(t(a.readingPanel('adaptation')), /Needs heart rate/);
});
