'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// TWO BETA CORRECTIONS, PINNED.
//
// 1. CONSENT PROVENANCE. Plan Evolution's propose -> consent -> apply contract
//    was audited and found intact: every writer of coachAdjust is an explicit
//    accept handler. What was missing was the athlete's ability to TELL. Days
//    later, on a different screen, an ADJUSTED session said what changed, why,
//    and a bare date -- never that they had accepted it. A correctly-consented
//    mutation an athlete cannot recognise as consented is still a trust
//    failure, so the provenance is now stated.
//
// 2. NEXT MOVE BREVITY. The card restated the same archetype coaching that the
//    unified "How to run this" disclosure now renders as WHY / EXECUTION /
//    FEEL / WATCH FOR, on the same screen. Same point, three times, in
//    slightly different words.
const TODAY = '2026-05-20';
const app = () => loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
const D = n => new Date(Date.UTC(2026, 4, 20) + n * 86400000).toISOString().slice(0, 10);
const day = (date, type, km, extra) =>
  Object.assign({ id: date, date, type, km, mpSegment: false }, extra || {});

/* The exact live-observed shape: a missed KEY threshold session and an easy
   run in front of it that can absorb the work without stacking two hard days.
   This is what produced "Easy Aerobic 9km -> Threshold: 5km 8km". */
function proposingPlan(a) {
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -21) });
  a.state.days = [
    day(a.addDays(TODAY, -1), 'threshold', 8, { title: 'Threshold: 5km',
      desc: '2km warm-up. 5km continuous @ Threshold pace. 1km cool-down.',
      prescription: { v: a.PRESCRIPTION_VERSION, archetype: 'threshold_continuous', params: { km: 5 } } }),
    day(D(1), 'easy', 9, { title: 'Easy Aerobic', desc: '9km @ Easy pace.',
      prescription: { v: a.PRESCRIPTION_VERSION, archetype: 'easy_run', params: { km: 9 } } }),
    day(D(2), 'rest', 0),
    day(D(4), 'long', 20, { title: 'Long Run' })
  ];
  a.showToast = () => {};
  return a;
}

// ---------------------------------------------------------------------------
// 1. MUTATION STILL REQUIRES CONSENT (the contract this rests on)
// ---------------------------------------------------------------------------
test('generating and rendering a proposal mutates nothing at all', () => {
  const a = proposingPlan(app());
  const before = JSON.stringify(a.state.days);
  const ev = a.planEvolution();
  assert.ok(ev.changes.length, 'precondition: this fixture proposes a change');
  // every read-path a screen can take, none of which may write
  a.renderEvolutionProposal(ev, 'hq');
  a.renderEvolutionLink();
  a.coachAnalyse();
  ev.changes.forEach(c => a.renderDayCard(a.findDay(c.dayId)));
  assert.equal(JSON.stringify(a.state.days), before,
    'a proposal is a question; asking it may not change the plan');
  assert.equal(a.state.days.filter(d => d.coachAdjust).length, 0);
  assert.equal((a.state.evolutionHistory || []).length, 0);
});

test('only acceptance applies the change, and it stamps when', () => {
  const a = proposingPlan(app());
  const ev = a.planEvolution();
  const targetId = ev.changes[0].dayId;
  a.handleAcceptEvolution(ev.proposalId);
  const dd = a.findDay(targetId);
  assert.ok(dd.coachAdjust, 'accepting is what applies it');
  assert.equal(dd.coachAdjust.source, 'evolution');
  assert.ok(dd.coachAdjust.at, 'and stamps the moment of the decision');
  assert.equal((a.state.evolutionHistory || []).slice(-1)[0].accepted, true);
});

test('declining leaves the plan exactly as it was', () => {
  const a = proposingPlan(app());
  const ev = a.planEvolution();
  const before = JSON.stringify(a.state.days);
  a.handleDeclineEvolution(ev.proposalId);
  assert.equal(JSON.stringify(a.state.days), before);
  assert.equal(a.state.days.filter(d => d.coachAdjust).length, 0);
});

// ---------------------------------------------------------------------------
// 2. THE ATHLETE CAN TELL THAT THEY CONSENTED
// ---------------------------------------------------------------------------
test('the ADJUSTED card states that the athlete accepted it, not merely a date', () => {
  const a = proposingPlan(app());
  const ev = a.planEvolution();
  const targetId = ev.changes[0].dayId;
  a.handleAcceptEvolution(ev.proposalId);
  const html = a.renderAdjustedDetail(a.findDay(targetId));
  assert.match(html, /You accepted this change on/,
    'consent provenance must be visible on the surface where the change is seen');
  assert.match(html, /What changed/);
  assert.match(html, /Restore the original session/, 'the safety net stays');
});

test('the provenance survives a persistence round-trip, like the change itself', () => {
  const a = proposingPlan(app());
  const ev = a.planEvolution();
  const targetId = ev.changes[0].dayId;
  a.handleAcceptEvolution(ev.proposalId);
  const stampedAt = a.findDay(targetId).coachAdjust.at;

  const b = app();
  b.showToast = () => {};
  b.state = JSON.parse(JSON.stringify(a.state));
  const back = b.findDay(targetId);
  assert.equal(back.coachAdjust.at, stampedAt, 'the acceptance timestamp is persisted state');
  assert.match(b.renderAdjustedDetail(back), /You accepted this change on/,
    'so the provenance is still readable after a reload');
});

test('Next Move no longer attributes an accepted change to the coach acting alone', () => {
  const a = proposingPlan(app());
  const ev = a.planEvolution();
  a.handleAcceptEvolution(ev.proposalId);
  const report = a.coachAnalyse();
  const html = a.renderCoachNextMoveCard(report);
  assert.doesNotMatch(html, /Adjusted by the coach on/,
    'the athlete accepted this; the copy may not say the coach did it unilaterally');
});

// ---------------------------------------------------------------------------
// 3. NEXT MOVE SAYS EACH THING ONCE
// ---------------------------------------------------------------------------
/* Assembled exactly as renderCoachNextMoveCard assembles it. */
function nextMoveLines(a) {
  const report = a.coachAnalyse();
  const dec = report.decision, mv = report.nextMove;
  const dd = a.findDay(mv.dayId);
  const line = (dec && dec.recommendation && (dec.state !== 'proceed' || dec.positives.length))
    ? dec.recommendation : mv.recommendation;
  const brief = a.coachBrief(dd);
  const rest = brief ? brief.paragraphs.filter(p => p !== line) : [];
  return [line].concat(rest);
}
function sessionApp(archetype, type, title, km, params, level) {
  const a = app();
  a.showToast = () => {};
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -28) });
  if (level) a.state.setup.experience = level;
  const nxt = a.state.days.filter(d => !d.completed && d.type !== 'rest' && d.date >= a.todayStr())
                          .sort((x, y) => x.date < y.date ? -1 : 1)[0];
  nxt.type = type; nxt.title = title; nxt.km = km;
  nxt.prescription = { v: a.PRESCRIPTION_VERSION, archetype: archetype, params: params };
  return a;
}
const CASES = [
  ['fartlek',              'interval',   'Fartlek 5x2min',    8,  { reps: 5, min: 2 }],
  ['threshold_continuous', 'threshold',  'Threshold: 5km',    8,  { km: 5 }],
  ['easy_run',             'easy',       'Easy Aerobic',      9,  { km: 9 }],
  ['long_run',             'long',       'Long Run',          20, { km: 20 }],
  ['time_trial',           'checkpoint', 'Time Trial 5km',    9,  { ttKm: 5, flankKm: 2 }],
  ['track_reps',           'interval',   'Interval: 4x600m',  8,  { reps: 4, m: 600 }]
];
const LEVELS = ['novice', 'experienced', 'advanced'];

test('no Next Move card restates the archetype cue as a second "feel" sentence', () => {
  const offenders = [];
  CASES.forEach(([arch, type, title, km, params]) => {
    LEVELS.forEach(level => {
      const a = sessionApp(arch, type, title, km, params, level);
      const lines = nextMoveLines(a).join(' ');
      // These two openers were coachFocusLine's, and they duplicated the cue.
      if (/It should feel /.test(lines) || /The thing that ruins it: /.test(lines))
        offenders.push(title + '/' + level);
    });
  });
  assert.deepEqual(offenders, [],
    'feel and the ruinous mistake are the disclosure\'s FEEL and WATCH FOR rows now');
});

test('Next Move does not also state the session purpose the disclosure owns', () => {
  const offenders = [];
  CASES.forEach(([arch, type, title, km, params]) => {
    const a = sessionApp(arch, type, title, km, params, 'novice');
    const dd = a.findDay(a.coachAnalyse().nextMove.dayId);
    const purpose = a.sessionPurpose(dd);
    if (!purpose) return;
    if (nextMoveLines(a).join(' ').indexOf(purpose.text) !== -1) offenders.push(title);
  });
  assert.deepEqual(offenders, [], 'why the session exists is the disclosure\'s WHY row');
});

test('the session-specific instruction is still present -- this got shorter, not emptier', () => {
  const missing = [];
  CASES.forEach(([arch, type, title, km, params]) => {
    const a = sessionApp(arch, type, title, km, params, 'experienced');
    const dd = a.findDay(a.coachAnalyse().nextMove.dayId);
    const g = a.coachingEntryFor(dd);
    const lines = nextMoveLines(a);
    if (lines.length < 2) { missing.push(title + ' (no instruction at all)'); return; }
    if (g && g.cue && lines.join(' ').indexOf(g.cue) === -1) missing.push(title + ' (cue dropped)');
  });
  assert.deepEqual(missing, [], 'one concrete instruction must survive on every card');
});

/* Sentence-level, because the real failure mode was a whole sentence appearing
   twice, not a shared word. */
function repeatedSentences(lines) {
  const seen = {}, dupes = [];
  lines.forEach(p => {
    String(p).split(/(?<=[.!?])\s+/).map(s => s.trim().toLowerCase().replace(/[.!?]+$/, ''))
      .filter(s => s.length > 12)
      .forEach(s => { if (seen[s]) dupes.push(s); else seen[s] = 1; });
  });
  return dupes;
}
test('no Next Move card repeats a sentence, at any experience level', () => {
  const offenders = [];
  CASES.forEach(([arch, type, title, km, params]) => {
    LEVELS.forEach(level => {
      const a = sessionApp(arch, type, title, km, params, level);
      const dupes = repeatedSentences(nextMoveLines(a));
      if (dupes.length) offenders.push(title + '/' + level + ': ' + dupes.join(' | '));
    });
  });
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------
// 4. LOW-EVIDENCE COPY IS ATHLETE-FACING, AND THE THRESHOLDS ARE UNTOUCHED
// ---------------------------------------------------------------------------
test('insufficient-evidence copy leaks no internal threshold jargon', () => {
  const a = sessionApp('fartlek', 'interval', 'Fartlek 5x2min', 8, { reps: 5, min: 2 }, 'novice');
  const text = nextMoveLines(a).join(' ');
  [/longitudinal/i, /high certainty/i, /low certainty/i,
   /relevant scored session/i, /\bqualifying sessions\b/i].forEach(pat => {
    assert.doesNotMatch(text, pat, 'implementation vocabulary must not reach the athlete');
  });
});

test('the simplified copy is presentation only -- sufficiency still decides identically', () => {
  const a = sessionApp('fartlek', 'interval', 'Fartlek 5x2min', 8, { reps: 5, min: 2 }, 'novice');
  const suf = a.playbookSufficiency('fartlek');
  // The reason LIST is what drives the gate; it is deliberately untouched.
  assert.equal(suf.sufficient, suf.reasons.length === 0,
    'sufficiency is still exactly "no outstanding reasons"');
  assert.ok(Array.isArray(suf.reasons));
  assert.ok(typeof suf.requiredSessions === 'number', 'thresholds still reported on the object');
  assert.ok(typeof suf.certainty === 'string');
});

test('rendering Next Move never mutates the plan', () => {
  CASES.forEach(([arch, type, title, km, params]) => {
    const a = sessionApp(arch, type, title, km, params, 'novice');
    const before = JSON.stringify(a.state.days);
    a.renderCoachNextMoveCard(a.coachAnalyse());
    assert.equal(JSON.stringify(a.state.days), before, title + ': reading may not write');
  });
});
