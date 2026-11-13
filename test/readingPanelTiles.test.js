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
  assert.match(p, b.sufficient ? /Easy HR bpm vs baseline/ : /Easy HR Building baseline/);
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
  assert.match(p, /class="b-dial is-rings"/, 'the hero is not the three rings');
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
  order(p, ['Your Adaptation', '>Aerobic<', '>Tolerance<', '>Breakthroughs<', 'Adaptation Timeline',
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
