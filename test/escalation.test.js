'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* VALHALLA SAID THE SAME THING TO EVERYONE.
 *
 * An athlete who had missed one session and an athlete who had missed seven
 * both got: "A threshold session went unlogged on Wednesday and it is still
 * worth having this week." Poor execution escalated exactly once and then went
 * flat. A programme meant to be used for years has to be able to notice that
 * something has changed -- and then stop saying it, because a coach who
 * repeats one warning forever is nagging rather than coaching.
 *
 * Three tiers, and the difference between them is what Valhalla DOES: an
 * isolated miss is acknowledged and nothing changes, an emerging pattern is
 * named once with an offer, a persistent one is an honest conversation about
 * whether the block still fits the athlete's life.
 *
 * The hard constraint, and the one most of these tests are about: NOTHING MAY
 * ESCALATE BECAUSE CALENDAR TIME HAS PASSED. The window is counted in planned
 * sessions, never in days.
 */

const TODAY = '2026-08-21';
function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  /* TWO STANDALONE QUALITY SESSIONS A WEEK, because the escalation tiers below
     are read against how much of the athlete's recent QUALITY work is going
     wrong. With quality frequency earned rather than granted by the day count,
     a fixture that says nothing about the athlete's response halves that
     denominator -- and two poor sessions out of five read as 'persistent'
     where two out of ten read as 'emerging'. The tiers are unchanged; the
     fixture has to describe the athlete they were calibrated on.

     AND THE DISTANCE IS 10K FOR THE SAME REASON, having been half. A week
     whose long run carries goal pace now spends one of its two quality slots
     on that long run, so a half-marathon athlete in Build and Peak has ONE
     standalone quality session a week however much they have earned -- and
     executionPattern() reads standalone quality only, so the denominator
     collapsed far enough that some weeks produced no pattern at all. 10K is
     the same athlete with the same earned exposure, at a distance whose long
     run stays aerobic, so the two-quality week these tiers were calibrated on
     still exists. Nothing about the tiers, the window or the language moved.

     AND TODAY SITS INSIDE BUILD, NOT PEAK, now that 10K has its own dedicated
     architecture (the continuation of this same correction). Peak is the
     highest-volume phase of a destination-led 10K block and legitimately
     leaves less room for a second standalone quality slot beside the peak
     long run -- one a week there, same as it always was for a phase this
     close to the event -- so an athlete whose most recent sessions all fall
     inside Peak has a THINNER recent quality denominator, and the same two
     poor sessions that read 'emerging' against Build's two-a-week read
     'persistent' against Peak's one. That is a real property of the phase,
     not a defect, and it is not what these tests are about: they hold the
     tier boundaries themselves, calibrated against the two-a-week athlete
     Build actually produces, exactly as originally intended. Six weeks
     out (started at week two, still inside Build's 2-14) does that; twelve
     landed TODAY at the block's own end, inside Peak. */
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -42), distanceKey: '10k',
                 volume: 55, benchSec: 45 * 60, lthr: 165, maxHR: 190,
                 earnedSecondQuality: true });
  return a;
}
const past = a => a.state.days.filter(d => d.date < TODAY && d.type !== 'rest')
                   .sort((x, y) => (x.date < y.date ? -1 : 1));
/* The athlete who is doing everything right. Every session logged at the
   middle of the app's OWN pace window for that day and the middle of its own
   effort band -- see logAsPrescribed, and the reason it had to be written. */
function textbook(a){ past(a).forEach(dd => logAsPrescribed(a, dd)); return a; }
// slice(-0) is slice(0), i.e. the whole array. Spelled out rather than relied
// on, because getting it wrong silently marks every session missed.
const lastN = (arr, n) => (n <= 0 ? [] : arr.slice(-n));
function miss(a, n){
  lastN(past(a), n).forEach(dd => { dd.completed = false; dd.actual = a.emptyActual(); delete dd.coachReview; });
  return a;
}
function underperform(a, n){
  // Only sessions the athlete actually ran, so this composes with miss()
  // instead of quietly un-missing what it just marked.
  const q = past(a).filter(d => a.isQualityType(d.type) && d.completed);
  lastN(q, n).forEach(dd => logAsPrescribed(a, dd, { quality: 0.65 }));
  return a;
}

/* ---------------------------------------------------------------- *
 * THE FIXTURE ITSELF -- the thing the audit could not previously trust
 * ---------------------------------------------------------------- */

test('an athlete who does exactly what is asked scores as having done it', () => {
  /* The audit's success-language run was invalid: it logged every session at a
     single hand-picked pace, and 4:45/km is a good easy run, a mediocre
     threshold and a hopeless 8x1200m. Every quality session scored below the
     poor bar, so the run measured the fixture, not the app. */
  const a = textbook(athlete());
  const scores = past(a).filter(d => a.isQualityType(d.type))
                        .map(d => a.computeExecutionScore(d));
  assert.ok(scores.length >= 10, 'the fixture must produce a real run of quality sessions');
  assert.ok(scores.every(s => s >= a.PLAYBOOK_GOOD_EXECUTION),
    'sessions logged exactly as prescribed scored ' + scores.join(' '));
  assert.equal(a.missPattern(), null);
  assert.equal(a.executionPattern(), null);
});

/* ---------------------------------------------------------------- *
 * MISSED SESSIONS
 * ---------------------------------------------------------------- */

test('one missed session is not a pattern', () => {
  const p = miss(textbook(athlete()), 1).missPattern();
  assert.equal(p.tier, 'isolated');
});

test('a quarter of the window missed is an emerging pattern', () => {
  const p = miss(textbook(athlete()), 3).missPattern();
  assert.equal(p.tier, 'emerging');
});

test('half the window missed is a persistent one', () => {
  const p = miss(textbook(athlete()), 6).missPattern();
  assert.equal(p.tier, 'persistent');
});

test('the three tiers say three different things', () => {
  const a = athlete();
  const said = [1, 3, 6].map(n => a.missPatternSentence(miss(textbook(athlete()), n).missPattern()));
  assert.equal(new Set(said).size, 3, 'two tiers produced the same sentence:\n' + said.join('\n'));
  said.forEach(s => assert.ok(s && s.length > 20));
});

test('and the count in the sentence is the real count', () => {
  const a = athlete();
  [1, 2, 3, 6].forEach(n => {
    const p = miss(textbook(athlete()), n).missPattern();
    assert.ok(a.missPatternSentence(p).indexOf(String(p.missed)) !== -1 ||
              (p.missed === 1 && /^One session/.test(a.missPatternSentence(p))),
      n + ' missed produced: ' + a.missPatternSentence(p));
  });
});

test('escalation is monotonic: more missed is never a milder tier', () => {
  const rank = { isolated: 1, emerging: 2, persistent: 3 };
  let last = 0;
  [0, 1, 2, 3, 4, 5, 6, 8, 10].forEach(n => {
    const p = miss(textbook(athlete()), n).missPattern();
    const r = p ? rank[p.tier] : 0;
    assert.ok(r >= last, n + ' missed sessions de-escalated to ' + (p ? p.tier : 'none'));
    last = r;
  });
});

test('an accepted adjustment is not a missed session', () => {
  /* A session the athlete and Valhalla agreed to change is the opposite of one
     they ignored, and counting it as a miss would punish the athlete for using
     the feature. */
  const a = textbook(athlete());
  const dd = past(a).slice(-1)[0];
  dd.completed = false; dd.actual = a.emptyActual();
  dd.coachAdjust = { at: TODAY + 'T08:00:00Z', reason: 'Load', evidence: [], state: 'modify', from: {} };
  assert.equal(a.missPattern(), null);
});

/* ---------------------------------------------------------------- *
 * NOTHING ESCALATES BECAUSE TIME PASSED
 * ---------------------------------------------------------------- */

test('a short history produces no tier at all, however many days have elapsed', () => {
  const a = athlete();
  const keep = past(a).slice(-4);
  a.state.days = a.state.days.filter(d => d.date >= TODAY || d.type === 'rest' || keep.indexOf(d) !== -1);
  logAsPrescribed(a, keep[0]); logAsPrescribed(a, keep[1]);
  assert.equal(a.missPattern(), null,
    'two missed sessions out of four became a pattern');
});

test('rest days do not count towards the window', () => {
  /* Otherwise an athlete on a three-day week escalates twice as fast as one on
     a six-day week for identical behaviour. */
  const a = textbook(athlete());
  const rests = a.state.days.filter(d => d.date < TODAY && d.type === 'rest');
  assert.ok(rests.length > 5, 'the fixture has no rest days to prove it with');
  assert.equal(a.plannedSessionWindow().filter(d => d.type === 'rest').length, 0);
});

test('the tier is a function of the sessions alone, not of the clock', () => {
  /* Same evidence, a week apart. Nothing about the tier may move. */
  const build = pinned => {
    const a = loadApp({ pinnedDate: pinned + 'T09:00:00Z' });
    a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
    buildPlan(a, { weeks: 14, startDate: a.addDays(pinned, -70), distanceKey: 'half',
                   volume: 55, benchSec: 45 * 60 });
    a.state.days.filter(d => d.date < pinned && d.type !== 'rest')
                .sort((x, y) => (x.date < y.date ? -1 : 1))
                .forEach(dd => logAsPrescribed(a, dd));
    a.state.days.filter(d => d.date < pinned && d.type !== 'rest')
                .sort((x, y) => (x.date < y.date ? -1 : 1)).slice(-3)
                .forEach(dd => { dd.completed = false; dd.actual = a.emptyActual(); });
    return a.missPattern();
  };
  assert.equal(build('2026-08-21').tier, build('2026-08-28').tier);
});

/* ---------------------------------------------------------------- *
 * POOR EXECUTION
 * ---------------------------------------------------------------- */

test('poor execution escalates through the same three tiers', () => {
  const seen = [1, 2, 4].map(n => underperform(textbook(athlete()), n).executionPattern().tier);
  assert.deepEqual(seen, ['isolated', 'emerging', 'persistent']);
});

test('poor execution used to escalate once and then go flat', () => {
  /* The regression, named. Four bad sessions and eight bad sessions produced
     identical language. */
  const a = athlete();
  const one = a.executionPatternSentence(underperform(textbook(athlete()), 1).executionPattern());
  const many = a.executionPatternSentence(underperform(textbook(athlete()), 5).executionPattern());
  assert.notEqual(one, many);
});

test('only quality sessions are judged on execution', () => {
  /* An easy run logged short is a decision the athlete made about an easy run.
     A threshold session repeatedly falling apart is the programme asking for
     more than the athlete has. */
  const a = textbook(athlete());
  past(a).filter(d => !a.isQualityType(d.type))
         .forEach(dd => logAsPrescribed(a, dd, { quality: 0.5 }));
  assert.equal(a.executionPattern(), null,
    'short easy runs were read as the block being too hard');
});

/* ---------------------------------------------------------------- *
 * WHAT THE ATHLETE ACTUALLY READS
 * ---------------------------------------------------------------- */

test('the pattern reaches the athlete, and only once', () => {
  const a = miss(textbook(athlete()), 4);
  const move = a.coachAnalyse().nextMove;
  assert.equal(move.pattern.kind, 'missed');
  assert.equal(move.pattern.tier, 'emerging');
  assert.equal(move.recommendation, a.missPatternSentence(a.missPattern()));
});

test('an isolated miss does not take over the Next Move card', () => {
  const move = miss(textbook(athlete()), 1).coachAnalyse().nextMove;
  assert.equal(move.pattern, undefined,
    'one missed session displaced the advice for the next session');
});

test('missing sessions outranks running them badly -- one sentence, not two', () => {
  /* An athlete who is missing sessions is usually also executing the ones they
     do run badly. Printing both findings is how a coach turns into a list of
     complaints. */
  const a = underperform(miss(textbook(athlete()), 4), 4);
  assert.ok(a.missPattern() && a.executionPattern(), 'the fixture must produce both');
  const move = a.coachAnalyse().nextMove;
  assert.equal(move.pattern.kind, 'missed');
  assert.equal(move.recommendation.indexOf('under target'), -1,
    'both findings were printed at once');
});

test('the language is plain: no blame, no theatre, no streaks', () => {
  const a = athlete();
  const all = [1, 3, 6].map(n => a.missPatternSentence(miss(textbook(athlete()), n).missPattern()))
    .concat([1, 2, 4].map(n => a.executionPatternSentence(underperform(textbook(athlete()), n).executionPattern())));
  all.forEach(s => {
    assert.ok(s.indexOf('!') === -1, 'exclamation mark in: ' + s);
    assert.ok(!/\b(fail|failed|failing|lazy|excuse|must|should have|disappoint)\b/i.test(s),
      'blame vocabulary in: ' + s);
    assert.ok(!/\bstreak\b|\bin a row\b|\bkeep it up\b|\bwell done\b/i.test(s),
      'motivational theatre in: ' + s);
  });
});

test('a persistent pattern offers a way out rather than just a verdict', () => {
  const a = athlete();
  const missed = a.missPatternSentence(miss(textbook(athlete()), 6).missPattern());
  const poor = a.executionPatternSentence(underperform(textbook(athlete()), 5).executionPattern());
  assert.match(missed, /rebuild|re-tailor/i);
  assert.match(poor, /lighter|brought back|repeatable/i);
});

test('an internal state token never reaches the athlete', () => {
  /* "The block is PLATEAU" -- the enum, printed straight into a sentence the
     athlete reads, when BLOCK_META has carried their word for it all along. */
  const a = textbook(athlete());
  const ev = a.planEvolution();
  const text = JSON.stringify([(ev || {}).reasons || [], a.coachAnalyse().nextMove]);
  Object.keys(a.BLOCK_META).forEach(k => {
    assert.equal(text.indexOf(k), -1, 'the internal state "' + k + '" reached athlete-facing copy');
  });
});
