'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// Three jobs, three sentences, no overlap:
//
//   DECISION      what should I do?
//   WHY           what evidence justifies that?
//   EXECUTION CUE what do I concentrate on while running it?
//
// The readiness line used to end by restating the decision, so a clean PROCEED
// day told the athlete "Run it as prescribed" twice in four lines. Each
// sentence was fine; together the coach repeated itself.
//
// Also pinned here: an absence of concern must never be dressed up as positive
// evidence, and an estimate must not be printed as though it were measured.
const PINNED = '2026-03-11T09:00:00Z';

function block(mutate, level) {
  const a = loadApp({ pinnedDate: PINNED });
  buildPlan(a, { weeks: 14, startDate: a.addDays(a.todayStr(), -56) });
  if (level) a.state.setup.experience = level;
  const today = a.todayStr();
  const past = a.state.days.filter(d => d.date < today && d.type !== 'rest');
  past.forEach(d => {
    const tr = a.executionPaceTarget(d), z = a.executionHRTarget(d), band = a.expectedRPEBand(d);
    d.completed = true;
    d.actual = { km: d.km, pace: a.secToPace(tr ? Math.round((tr.fast + tr.slow) / 2) : 330),
                 hr: z ? Math.round((z.lo + (z.hi != null ? z.hi : z.lo + 10)) / 2) : 145,
                 rpe: band ? band[0] : 3, notes: '' };
  });
  if (mutate) mutate(a, past);
  past.forEach(d => { try { a.coachPersistReview(d); } catch (e) {} });
  return a;
}
function makeNextQuality(a) {
  const today = a.todayStr();
  const nxt = a.state.days.filter(d => !d.completed && d.type !== 'rest' && d.date >= today)
                          .sort((x, y) => x.date < y.date ? -1 : 1)[0];
  nxt.type = 'threshold';
  nxt.title = 'Threshold: 5km';
  return a;
}
/* Everything the athlete reads on the Next Move card, in order, assembled the
   way renderCoachNextMoveCard assembles it. */
function cardLines(a) {
  const report = a.coachAnalyse();
  const dec = report.decision, mv = report.nextMove;
  const dd = a.findDay(mv.dayId);
  const line = (dec && dec.recommendation && (dec.state !== 'proceed' || dec.positives.length))
    ? dec.recommendation : mv.recommendation;
  const brief = a.coachBrief(dd);
  const rest = brief ? brief.paragraphs.filter(p => p !== line) : [];
  return { decision: dec, lines: [line].concat(rest) };
}
/* Sentence-level overlap: the actual failure mode was one whole sentence
   appearing in two paragraphs, not a shared word. */
function repeatedSentences(lines) {
  const seen = {}, dupes = [];
  lines.forEach(p => {
    String(p).split(/(?<=[.!?])\s+/).map(s => s.trim().toLowerCase().replace(/[.!?]+$/, ''))
      .filter(s => s.length > 12)
      .forEach(s => { if (seen[s]) dupes.push(s); else seen[s] = 1; });
  });
  return dupes;
}

test('a clean PROCEED day never says the same sentence twice', () => {
  const c = cardLines(makeNextQuality(block(null)));
  assert.equal(c.decision.state, 'proceed', 'precondition: this is the clean case');
  assert.deepEqual(repeatedSentences(c.lines), [],
    'each paragraph has its own job; none may restate another');
});

test('specifically, "run it as prescribed" appears at most once', () => {
  const c = cardLines(makeNextQuality(block(null)));
  const hits = c.lines.filter(p => /run it as prescribed/i.test(p)).length;
  assert.ok(hits <= 1, 'the decision is stated once, by the decision line');
});

test('the readiness line stays silent when it has nothing to report', () => {
  const a = makeNextQuality(block(null));
  const dd = a.findDay(a.coachAnalyse().nextMove.dayId);
  assert.equal(a.coachReadinessLine(dd), '',
    'a paragraph saying nothing happened is padding, not coaching');
});

test('but it speaks up when readiness genuinely differs', () => {
  /* A REAL LOAD SPIKE, ASSERTED AS ONE. coachLoad() calls a spike above 1.5x
     the four-week average; multiplying the last six days by 2.4 reached 1.43 --
     'elevated' -- so the readiness difference this test is about was never
     produced and it was asserting the behaviour of an ordinary week. */
  const a = makeNextQuality(block((app_, past) => {
    const from = app_.addDays(app_.todayStr(), -6);
    past.forEach(d => { if (d.date >= from) d.actual.km = Math.round(d.km * 3.2 * 10) / 10; });
  }));
  assert.equal(a.coachLoad().band, 'spike',
    'precondition: the fixture must actually produce a load spike, and it is ' +
    a.coachLoad().band);
  const dd = a.findDay(a.coachAnalyse().nextMove.dayId);
  const line = a.coachReadinessLine(dd);
  assert.ok(line.length > 0, 'a real load spike is worth telling the athlete about');
  assert.ok(!/run it as prescribed/i.test(line), 'without restating the decision');
});

test('an evidence day states the evidence once and the decision once', () => {
  const c = cardLines(makeNextQuality(block((app_, past) => {
    const from = app_.addDays(app_.todayStr(), -6);
    past.forEach(d => { if (d.date >= from) d.actual.km = Math.round(d.km * 2.4 * 10) / 10; });
  })));
  assert.deepEqual(repeatedSentences(c.lines), []);
});

// ---------------------------------------------------------------------------
// TRUTHFULNESS OF THE PROCEED CLAIM
// ---------------------------------------------------------------------------
test('absence of concern is never reported as positive evidence', () => {
  const a = makeNextQuality(block(null));
  const dec = a.coachDecision();
  if (dec.state === 'proceed' && !dec.positives.length) {
    assert.ok(!/supports keeping|coming into this in a good place|training supports/i.test(dec.recommendation),
      'nothing was found either way; that is not the same as evidence of readiness');
  }
  const dd = a.findDay(a.coachAnalyse().nextMove.dayId);
  const ready = a.coachReadinessLine(dd);
  assert.ok(!/good place/i.test(ready) || a.coachTrend().enough,
    'a positive readiness claim requires an established trend to make it from');
});

test('the no-data state stays truthful and unalarming', () => {
  const a = makeNextQuality(block((app_, past) => {
    const from = app_.addDays(app_.todayStr(), -10);
    past.forEach(d => { if (d.date >= from) { d.completed = false; delete d.actual; } });
  }));
  const dec = a.coachDecision();
  assert.ok(!/nothing unusual in the recent training/i.test(dec.recommendation),
    'there was no training to find anything unusual in');
  assert.ok(!/supports keeping this session/i.test(dec.recommendation),
    'and no evidence to support a positive claim either');
});

test('where positive evidence exists, the claim may be positive', () => {
  const a = loadApp({ pinnedDate: PINNED });
  const sentence = a.coachDecisionSentence('proceed', null, [],
    [{ detail: 'Easy-run heart rate has settled.' }], null, true, 12);
  assert.match(sentence, /supports keeping this session as written/,
    'positives.length > 0 means real evidence, so the wording may say so');
  const bare = a.coachDecisionSentence('proceed', null, [], [], null, true, 12);
  assert.ok(!/supports keeping this session as written/.test(bare),
    'and without positives it must not');
  assert.match(bare, /argues against it/, 'absence stated as absence');
});

// ---------------------------------------------------------------------------
// ESTIMATES PRESENTED AS ESTIMATES
// ---------------------------------------------------------------------------
test('fluid guidance is not printed to the millilitre', () => {
  const a = loadApp({ pinnedDate: PINNED });
  const out = a.fmtFluidEstimate(816, 1224);
  assert.match(out, /^≈/, 'it is an estimate and says so');
  assert.match(out, /L$/, 'a litre-scale total is expressed in litres');
  assert.ok(!/816|1224/.test(out), 'four significant figures imply a precision nobody has');
  assert.equal(out, '≈0.8–1.2 L');
});

test('smaller totals stay in millilitres, still rounded', () => {
  const a = loadApp({ pinnedDate: PINNED });
  const out = a.fmtFluidEstimate(430, 645);
  assert.match(out, /^≈\d+–\d+ ml$/);
  assert.ok(!/430|645/.test(out), 'rounded to something an athlete can act on');
});

/* A marathon block, because a 10k block has no session long enough to need
   fuelling at all -- the card only appears past 75 minutes or 14km.

   The goal has to be set for the distance actually being run. buildPlan derives
   its goal from a 10k benchmark whatever distanceKey it is given, so asking it
   for 'full' implies a 42-minute marathon, which resolves to a nonsense VDOT
   and pace zones roughly a quarter of their real value -- and therefore a
   duration, and a fuelling card, computed from paces no one can run. */
function fuellingSession(a) {
  buildPlan(a, { distanceKey: 'full', volume: 70, weeks: 16,
                 startDate: a.addDays(a.todayStr(), -56) });
  a.state.setup.goals = { A: { timeSec: 3 * 3600 + 30 * 60 } };   // a 3:30 marathon
  const day = a.state.days.filter(d => a.needsFueling(d)).sort((x, y) => y.km - x.km)[0];
  assert.ok(a.getDayDurationSec(day) > 2 * 3600,
    'precondition: the fixture must produce a session of a plausible length');
  return day;
}

test('the fueling card marks its estimates and keeps its honest caveats', () => {
  const a = loadApp({ pinnedDate: PINNED });
  const long = fuellingSession(a);
  assert.ok(long, 'precondition: the block has a session that needs fuelling');
  const html = a.renderFuelingCard(long);
  assert.match(html, /Fluid guide \(est\.\)/);
  assert.match(html, /Total carbs \(est\.\)/);
  assert.match(html, /≈/, 'the numbers are marked approximate');
  assert.match(html, /drink to thirst/i, 'the existing honest caveat is preserved');
  assert.match(html, /adjust for the heat/i);
  assert.ok(!/\d{3,4}–\d{3,4}ml/.test(html), 'no bare four-figure millilitre range');
});

test('hydration copy stays guidance, not medical instruction', () => {
  const a = loadApp({ pinnedDate: PINNED });
  const html = a.renderFuelingCard(fuellingSession(a));
  assert.ok(!/you must|required intake|prescribed dose|medical/i.test(html));
  assert.match(html, /starting guide, not a target/i);
});
