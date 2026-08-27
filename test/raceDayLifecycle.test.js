'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THE WHOLE JOURNEY, END TO END
 * ===========================================================================
 *   active race block -> Race Day -> outcome pending -> Raced / DNF / DNS
 *   -> the right recovery -> recovery running -> recovery done
 *   -> the athlete chooses
 *
 * Almost all of this machinery already existed and worked; this file walks the
 * lifecycle rather than trusting that, and pins each stage so a future change
 * to any one of raceOutcomePending(), nextBlockRecommendation(),
 * renderBlockTransitionCard(), renderContinuityCard() or
 * startDevelopmentBlock() cannot silently break a stage two steps away.
 *
 * THE FIXTURE MUST OPEN A BLOCK. buildPlan() alone leaves state.setup.blockId
 * unset, so currentBlock() is null and recordRaceOutcome() writes nothing and
 * returns null -- which looks exactly like "the outcome never clears" and is
 * not a product defect at all. migrateAthleteRecord() is the app's own path to
 * a ledger entry, so the fixture uses it. Written down because the wrong
 * conclusion here would be a convincing bug report about working code.
 */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');

const RACE_DATE = '2026-10-25';
const BLOCK_START = '2026-07-27';

function mk(pinned){
  const a = loadApp({ pinnedDate: pinned + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.scheduleSave = () => {}; a.flushSave = () => {}; a.openModal = () => {};
  return a;
}
function raceBlock(pinned){
  const a = mk(pinned);
  buildPlan(a, { weeks: 13, startDate: BLOCK_START, distanceKey: 'half', volume: 45,
                 benchSec: 45 * 60, maxHR: 190, raceDate: RACE_DATE, hasEvent: true,
                 schedule: { activeDays: [1,2,3,5,6], longRunDay: 6 } });
  a.state.setup.purpose = 'race';
  a.state.setup.raceDate = RACE_DATE;
  a.migrateAthleteRecord();
  return a;
}
const fullPlan = (a) => a.renderWeeksList();
const today = (a) => a.renderTodayView();
const hasWhatsNext = (h) => /What’s next|What next\?|Recommended next/.test(h);

// ---------------------------------------------------------------------------
// 1. THE CARD IS PERMANENT -- from the start of the block, not only at the end
// ---------------------------------------------------------------------------
test('Full Plan answers "where does this go next" from the first week of a race block', () => {
  const a = raceBlock('2026-07-28');            // week 1
  const html = fullPlan(a);
  assert.ok(hasWhatsNext(html), 'week 1 of a race build has no What’s next card');
  assert.match(html, /Once <b>Race Day<\/b> passes/,
    'the card does not tell the athlete the plan continues past Race Day');
});

test('mid-block it still says it, and still recommends nothing', () => {
  const a = raceBlock('2026-08-27');
  assert.ok(hasWhatsNext(fullPlan(a)), 'the card disappeared mid-block');
  assert.equal(a.nextBlockRecommendation(), null,
    'a recommendation appeared while the race block was still running');
  assert.equal(a.renderBlockTransitionCard(), '',
    'the actionable transition card appeared mid-block');
});

test('THE TAPER CONTINUITY BUG: taper week offers no premature recovery', () => {
  /* Regression. nearEnd is true for the whole final week, taper included, and
     it used to fall through every purpose check to the generic catch-all --
     so an athlete in taper was offered Start Recovery days BEFORE the race. */
  const a = raceBlock('2026-10-20');            // five days out
  assert.equal(a.state.setup.raceDate >= a.todayStr(), true, 'the fixture is past the race');
  assert.equal(a.nextBlockRecommendation(), null,
    'taper week recommends a next block before the race has happened');
  const html = fullPlan(a);
  assert.ok(!/Start recovery|data-action="start-block"/i.test(html),
    'taper week offers a start-block action before Race Day');
  assert.ok(hasWhatsNext(html), 'taper week lost the continuity card');
});

// ---------------------------------------------------------------------------
// 2. RACE DAY PASSES -- the outcome comes first
// ---------------------------------------------------------------------------
test('with the outcome unanswered, the question outranks everything downstream', () => {
  const a = raceBlock('2026-10-26');
  assert.equal(a.raceOutcomePending(), true);
  /* Field by field: a value built inside the VM sandbox is never
     reference-equal to one built out here, so deepEqual on the object itself
     fails on a correct result. */
  assert.equal(a.nextBlockRecommendation().kind, 'race_outcome');

  const t = today(a);
  assert.match(t, /How did/i, 'Today does not ask how the race went');
  assert.match(t, /Recover first/,
    'Today pretends normal programme progression resumed instead of cueing recovery');
  assert.ok(!/data-action="start-block"/.test(t),
    'a next block was offered before the outcome was known');
  assert.equal(a.renderBlockTransitionCard(), '',
    'the transition card jumped the outcome question');

  const fp = fullPlan(a);
  assert.ok(hasWhatsNext(fp));
  assert.match(fp, /Tell Valhalla on Today/,
    'Full Plan does not point at the one place that asks the question');
});

test('the recovery cue never competes with a real Next Move', () => {
  /* renderPostRaceRecoverCard yields the moment the engine has something of
     its own to say -- two Next Move cards would be two coaches. */
  const a = raceBlock('2026-10-26');
  assert.equal(a.renderPostRaceRecoverCard({ nextMove: { some: 'thing' } }), '',
    'the recovery cue rendered alongside a real Next Move');
  assert.notEqual(a.renderPostRaceRecoverCard({}), '');
});

// ---------------------------------------------------------------------------
// 3. RACED / DNF / DNS ARE THREE DIFFERENT ANSWERS
// ---------------------------------------------------------------------------
test('recording an outcome clears the question and produces the next step', () => {
  ['raced', 'dnf', 'dns'].forEach(oc => {
    const a = raceBlock('2026-10-26');
    assert.ok(a.recordRaceOutcome(oc), oc + ': the outcome was not recorded at all');
    assert.equal(a.raceOutcomePending(), false, oc + ': still asking after it was answered');
    const rec = a.nextBlockRecommendation();
    assert.equal(rec.kind, 'block', oc + ': no next step offered');
    assert.ok(!/How did/i.test(today(a)), oc + ': Today still asks the answered question');
  });
});

test('DNS keeps the fitness; racing and DNF both recover', () => {
  const purpose = (oc) => {
    const a = raceBlock('2026-10-26');
    a.recordRaceOutcome(oc);
    return a.nextBlockRecommendation().purpose;
  };
  assert.equal(purpose('dns'), 'maintain', 'a did-not-start was sent to recover from nothing');
  assert.equal(purpose('raced'), 'recovery');
  assert.equal(purpose('dnf'), 'recovery', 'a did-not-finish was denied recovery');
});

test('DNF is not told "You raced"', () => {
  /* It used to fall through to the raced copy verbatim. Same recovery -- a day
     that ended early can still cost as much -- but not the same sentence. */
  const why = (oc) => {
    const a = raceBlock('2026-10-26');
    a.recordRaceOutcome(oc);
    return a.nextBlockRecommendation().why;
  };
  const dnf = why('dnf');
  assert.ok(!/You raced/.test(dnf), 'a did-not-finish is congratulated on racing: ' + dnf);
  assert.match(dnf, /did not finish/i);
  assert.notEqual(dnf, why('raced'));
  assert.notEqual(dnf, why('dns'));
  /* And it does not claim to know what the day cost, because nobody does yet. */
  assert.ok(!/took a lot|drained|exhaust/i.test(dnf),
    'the DNF copy claims to know how much the day took');
});

test('the outcome is recorded once and the answer is the authority', () => {
  const a = raceBlock('2026-10-26');
  a.recordRaceOutcome('raced');
  const first = JSON.stringify(a.currentBlock().outcome.race.outcome);
  assert.equal(a.renderRaceOutcomePrompt(), '', 'the prompt returned after being answered');
  assert.equal(first, '"raced"');
});

// ---------------------------------------------------------------------------
// 4. RECOVERY -- the engine's own sizing, and history kept
// ---------------------------------------------------------------------------
test('starting recovery uses the existing block machinery and keeps history', () => {
  const a = raceBlock('2026-10-26');
  a.recordRaceOutcome('raced');
  const before = a.athlete().blocks.length;
  const built = a.startDevelopmentBlock('recovery');
  assert.ok(built, 'startDevelopmentBlock(recovery) built nothing');
  assert.equal(a.state.setup.purpose, 'recovery');
  assert.ok(a.athlete().blocks.length > before, 'the ledger did not gain the new block');
  const ledger = a.athlete().blocks.map(b => b.purpose + ':' + b.status);
  assert.ok(ledger.indexOf('race:closed') !== -1, 'the race block was not closed: ' + ledger);
  assert.ok(ledger.indexOf('recovery:active') !== -1, 'no active recovery block: ' + ledger);
  /* The sizing is the engine's. This asserts it is SHORT and plausible rather
     than asserting a number, because the number is methodology and not ours. */
  const weeks = a.totalWeeksInPlan();
  assert.ok(weeks >= 1 && weeks <= 4, 'recovery came out ' + weeks + ' weeks long');
});

test('THE PERMANENT CARD SURVIVES INTO RECOVERY -- the gap this pass closed', () => {
  /* renderContinuityCard() used to return '' for every non-race block, so the
     card was permanent through the race build and then vanished for the whole
     of the recovery that follows it -- precisely when an athlete running easy
     for a fortnight most wants to know where this is going. */
  const a = raceBlock('2026-10-26');
  a.recordRaceOutcome('raced');
  a.startDevelopmentBlock('recovery');
  const html = fullPlan(a);
  assert.ok(hasWhatsNext(html), 'Full Plan went silent during recovery');
  assert.match(html, /When this <b>recovery<\/b> block finishes/,
    'the card does not say what happens at the end of this block');
});

test('the preview names directions but does not offer them mid-block', () => {
  /* Live start-block buttons here would let an athlete replace a recovery
     block halfway through it -- the opposite of what recovery is for. */
  const a = raceBlock('2026-10-26');
  a.recordRaceOutcome('raced');
  a.startDevelopmentBlock('recovery');
  const card = a.renderContinuityCard();
  assert.ok(!/data-action="start-block"/.test(card),
    'the mid-block preview offers a live block switch');
  assert.match(card, /Nothing changes until you choose/);
  assert.equal(a.nextBlockRecommendation(), null,
    'a real recommendation fired while recovery was still running');
});

test('the preview can never promise a direction the offer will not make', () => {
  /* One table, two readers. Asserted rather than assumed, because a preview
     that drifts from the offer is believed and only found out weeks later. */
  ['recovery', 'maintain', 'base', 'speed'].forEach(purpose => {
    const a = raceBlock('2026-10-26');
    a.recordRaceOutcome('raced');
    a.startDevelopmentBlock('recovery');
    a.state.setup.purpose = purpose;

    const previewed = a.blockChoicesFor(purpose).options;
    /* Jump to the end of the block, where the real offer is made. */
    const end = a.state.days[a.state.days.length - 1].date;
    const b = mk(end);
    b.state = JSON.parse(JSON.stringify(a.state));
    const offered = b.nextBlockRecommendation();
    assert.ok(offered, purpose + ': no offer at the end of the block');
    const actual = offered.kind === 'block' ? [offered.purpose] : offered.options;
    assert.equal(actual.join('/'), previewed.join('/'),
      purpose + ': preview ' + previewed.join('/') + ' but offer ' + actual.join('/'));
  });
});

// ---------------------------------------------------------------------------
// 5. RECOVERY DONE -- the four directions, and the athlete chooses
// ---------------------------------------------------------------------------
test('at the end of recovery the four directions are offered, as real actions', () => {
  const a = raceBlock('2026-10-26');
  a.recordRaceOutcome('raced');
  a.startDevelopmentBlock('recovery');
  const end = a.state.days[a.state.days.length - 1].date;
  const b = mk(end);
  b.state = JSON.parse(JSON.stringify(a.state));

  const rec = b.nextBlockRecommendation();
  assert.equal(rec.kind, 'choice');
  assert.equal(rec.options.join('/'), 'maintain/base/speed/race',
    'the four directions are not the four directions');

  const html = fullPlan(b);
  /* Named the way the athlete meets them. */
  [/Maintain/i, /Aerobic base/i, /Speed/i, /Build a race block/i].forEach(re =>
    assert.match(html, re, 'a direction is missing from Full Plan: ' + re));
  /* And here they ARE actions, because the block has ended. */
  assert.match(html, /data-action="start-block"/,
    'the directions are not actionable once recovery is done');
  assert.match(html, /Nothing changes until you choose/);
});

test('nothing is replaced until the athlete acts', () => {
  const a = raceBlock('2026-10-26');
  a.recordRaceOutcome('raced');
  const daysBefore = JSON.stringify(a.state.days);
  const purposeBefore = a.state.setup.purpose;
  /* Rendering every surface must never mutate the programme. */
  fullPlan(a); today(a); a.renderContinuityCard(); a.nextBlockRecommendation();
  assert.equal(JSON.stringify(a.state.days), daysBefore, 'rendering changed the schedule');
  assert.equal(a.state.setup.purpose, purposeBefore, 'rendering changed the block purpose');
});

// ---------------------------------------------------------------------------
// 6. THE TWO OTHER NAMED DEFECTS
// ---------------------------------------------------------------------------
test('THE IMPOSSIBLE CONGRATULATIONS GATE is gone', () => {
  /* It required literally every non-rest day in the block marked complete,
     future days included, so almost nobody ever saw any acknowledgement that
     Valhalla kept coaching after the block did. */
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/congratulat/i.test(code), 'a congratulations banner is back');
  const a = raceBlock('2026-10-26');
  a.recordRaceOutcome('raced');
  /* Continuity is shown on the strength of the engine's recommendation, with
     nothing completed at all. */
  assert.ok(hasWhatsNext(fullPlan(a)),
    'continuity is gated on completion again');
});

test('THE POST-BLOCK WEEK 1 FALLBACK is corrected', () => {
  /* A just-finished 16-week build used to read "Week 1 of 16". */
  const past = raceBlock('2026-11-30');          // every week's range is behind us
  assert.equal(past.currentWeekNum(), null,
    'a finished block still reports a current week');
  /* The other side is unchanged: a block that has not started yet is week 1,
     because week 1 is Monday-aligned and today is not always a Monday. */
  const future = raceBlock('2026-07-26');        // the day before the block starts
  assert.equal(future.currentWeekNum(), 1,
    'a block about to start no longer reports week 1');
});

// ---------------------------------------------------------------------------
// 7. WHAT THIS PASS MUST NOT HAVE DONE
// ---------------------------------------------------------------------------
test('no new dashboard, no new methodology, no commercial messaging', () => {
  const a = raceBlock('2026-10-26');
  a.recordRaceOutcome('raced');
  a.startDevelopmentBlock('recovery');
  const html = fullPlan(a) + today(a);
  /* "Time trial" is a training term, not a sales page -- the first version of
     this regex matched it and reported a coaching session as commercial
     messaging. Matched on phrases only money uses. */
  const commercial = /subscription|upgrade to|free trial|billing|pricing|per month|£\d|\$\d/i;
  const hit = commercial.exec(html);
  assert.equal(hit, null, 'commercial messaging appeared in the race-day journey: ' +
    (hit ? html.slice(Math.max(0, hit.index - 60), hit.index + 40) : ''));
  /* The recovery block is the engine's, not a second sizing system. */
  assert.match(SRC, /function startDevelopmentBlock\(/);
  assert.ok(!/function buildRecoveryPlan|function recoveryWeeksFor/.test(SRC),
    'a parallel recovery system was invented');
});

test('the existing machinery is still the machinery', () => {
  ['raceOutcomePending', 'renderRaceOutcomePrompt', 'nextBlockRecommendation',
   'renderBlockTransitionCard', 'startDevelopmentBlock', 'renderContinuityCard']
    .forEach(fn => assert.match(SRC, new RegExp('function ' + fn + '\\('),
      fn + ' is gone -- it was meant to be reused, not replaced'));
  /* And the continuity card is still reached from Full Plan. */
  assert.match(SRC, /html \+= renderContinuityCard\(\);/,
    'the continuity card is no longer rendered by Full Plan');
});
