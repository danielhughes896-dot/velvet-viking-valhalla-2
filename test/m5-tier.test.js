'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* MOVE UP A LEVEL (founder, methodology batch 5): "if they show clear
   progression above the level they are on through learning they could be
   offered a tier upgrade? So from established to advanced?"

   The evidence is the athlete's own last four weeks: at or above the weekly
   volume their level's pathway peaks at, 90% or more of sessions run, good
   execution and nothing flagged by recovery. Asked on Today in Base and the
   first half of Build; later, kept for the next block and asked as it is
   built. Answered once per block. */

const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');

/* An Established half marathoner running above the Established peak (58km):
   a 16-week block from 7 September, so week 5 is Base, week 7 the first
   half of Build, week 9 the second half and week 12 Peak. */
function athlete(today, o){
  const opts = o || {};
  const a = loadApp({ pinnedDate: today + 'T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave', 'persistState'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: 'half', experience: opts.experience || 'experienced', volume: opts.volume || 66,
                 weeks: 16, startDate: '2026-09-07' });
  a.state.days.filter(d => d.date < a.todayStr() && d.type !== 'rest').forEach(d => logAsPrescribed(a, d, { sections: true }));
  a.state.view = 'today';
  /* This week's review already answered: the weekly sheet has had its turn. */
  a.weeklyReviewStore()[a.weeklyReviewKey(a.currentWeekNum())] = { kind: 'progress', decision: 'accepted' };
  const asked = [];
  a.askSacoro = q => asked.push(q);
  return { a, asked };
}
const BASE = '2026-10-06', EARLY_BUILD = '2026-10-20', LATE_BUILD = '2026-11-03', PEAK = '2026-11-24', TAPER = '2026-12-15';

test('offered in Base and the first half of Build, with the evidence in real numbers', () => {
  [BASE, EARLY_BUILD].forEach(day => {
    const { a, asked } = athlete(day);
    const ph = a.trainingPhase(a.currentWeekNum());
    a.maybeRaiseLevelUpOffer(false);
    assert.equal(asked.length, 1, day + ' (' + ph + '): not offered');
    const q = asked[0];
    assert.equal(q.title, 'Move Up to Advanced');
    assert.equal(q.yes, 'Move Up');
    assert.equal(q.no, 'Stay at Established');
    assert.match(q.say, /^You have run 58km or more in [34] of the last 4 weeks, the most the Established Half Marathon pathway builds to, and completed (\d+) of \1 sessions with good execution\.$/);
    assert.match(q.hint, /peak week and long runs, and your sessions reshape for the rest of this block\. Everything you have logged is kept\./);
    [q.title, q.say, q.hint, q.yes, q.no].forEach(t => assert.doesNotMatch(t, /—/, 'an em dash: ' + t));
  });
});

test('raised by the auto-sheet rules: never over a sheet, after the weekly review and the Recovery Check, on Today', () => {
  let t = athlete(EARLY_BUILD);
  t.a.state.view = 'plan';
  t.a.maybeRaiseLevelUpOffer(false);
  t.a.state.view = 'today';
  t.a.maybeRaiseLevelUpOffer(true);
  assert.equal(t.asked.length, 0, 'raised off Today or during the arrival');
  t = athlete(EARLY_BUILD);
  t.a.document.getElementById = id => (id === 'ask-sheet' ? {} : null);
  t.a.maybeRaiseLevelUpOffer(false);
  assert.equal(t.asked.length, 0, 'raised over another sheet');
  t = athlete(EARLY_BUILD);
  t.a.weeklyReviewDue = () => ({ week: t.a.currentWeekNum() });
  t.a.maybeRaiseLevelUpOffer(false);
  assert.equal(t.asked.length, 0, 'raised before the weekly review');
  t = athlete(EARLY_BUILD);
  t.a.recoveryCheckDue = () => true;
  t.a.maybeRaiseLevelUpOffer(false);
  assert.equal(t.asked.length, 0, 'raised before the Recovery Check');
  /* In the render, after the threshold test offer. */
  assert.match(SRC, /  try \{ maybeRaiseThresholdTestOffer\(arriving\); \} catch\(e\)\{\}\n  try \{ maybeRaiseLevelUpOffer\(arriving\); \} catch\(e\)\{\}\n/);
});

test('late in Build, in Peak and in the taper it is not asked: it waits for the next block', () => {
  [LATE_BUILD, PEAK, TAPER].forEach(day => {
    const { a, asked } = athlete(day);
    a.maybeRaiseLevelUpOffer(false);
    assert.equal(asked.length, 0, day + ' (' + a.trainingPhase(a.currentWeekNum()) + '): asked mid-block');
  });
  const { a } = athlete(LATE_BUILD);
  a.maybeRaiseLevelUpOffer(false);
  const r = a.state.setup.levelUpOffer;
  assert.ok(r && r.deferred && !r.answer, 'the evidence was not kept for the next block');
  assert.equal(r.level, 'advanced');
  assert.equal(a.levelUpWaiting(), r);
});

test('the offer that waited is asked as the next block starts, and either answer carries on', () => {
  const { a, asked } = athlete(LATE_BUILD);
  a.maybeRaiseLevelUpOffer(false);
  a.athleteHasTrainingHistory = () => false;
  const started = [];
  a.startDevelopmentBlock = (p) => { started.push([p, a.athleteExperience()]); return { id: 'blk-next' }; };
  a.handleStartBlock('base', 8, true);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].title, 'Move Up to Advanced');
  assert.match(asked[0].say, /^In your last block you ran 58km or more in \d of its last 4 weeks/);
  assert.match(asked[0].hint, /^Advanced builds this block to a higher peak week and longer long runs/);
  assert.equal(started.length, 0, 'the block started before the question was answered');
  asked[0].onYes();
  assert.deepEqual(started, [['base', 'advanced']]);
  assert.equal(a.state.setup.levelUpOffer.answer, 'yes');
  /* Not for a recovery block: it waits for the block after. */
  const t2 = athlete(LATE_BUILD);
  t2.a.maybeRaiseLevelUpOffer(false);
  t2.a.athleteHasTrainingHistory = () => false;
  t2.a.startDevelopmentBlock = () => ({ id: 'x' });
  t2.a.handleStartBlock('recovery', 2, true);
  assert.equal(t2.asked.length, 0);
  /* Inside the builder it is asked with bldDecide(), before any admission
     question reads the level, and only for the next block. */
  const gen = SRC.slice(SRC.indexOf('async function handleGeneratePlan('), SRC.indexOf('var admSig = admissionInputsSignature('));
  assert.match(gen, /var levelUpNextBlock = !rebuilding \|\|/);
  assert.match(gen, /if \(levelUpAsk\)\{ askLevelUpWaiting\(levelUpAsk, bldDecide, function\(\)\{ handleGeneratePlan\(\); \}\); return; \}/);
});

test('not offered with recovery flags, an open restriction, under 90% completion or at the top level', () => {
  let t = athlete(EARLY_BUILD);
  const w = t.a.currentWeekNum() - 2;
  const day = t.a.weekRunDays(w).find(d => d.type === 'easy');
  day.actual.hurting = 'pain';
  t.a.maybeRaiseLevelUpOffer(false);
  assert.equal(t.asked.length, 0, 'offered with pain logged');

  t = athlete(EARLY_BUILD);
  t.a.weeklyReviewStore()[t.a.weeklyReviewKey(t.a.currentWeekNum() - 1)] = { kind: 'protect', decision: 'accepted' };
  t.a.maybeRaiseLevelUpOffer(false);
  assert.equal(t.asked.length, 0, 'offered in a block whose week was protected');

  t = athlete(EARLY_BUILD);
  t.a.coachRecovery = () => ({ state: 'watch' });
  t.a.maybeRaiseLevelUpOffer(false);
  assert.equal(t.asked.length, 0, 'offered with Recovery on Watch');

  t = athlete(EARLY_BUILD);
  t.a.openRestriction = () => ({ level: 'injury' });
  t.a.maybeRaiseLevelUpOffer(false);
  assert.equal(t.asked.length, 0, 'offered with an injury open');

  /* Two easy runs missed of about eighteen: below 90%, though every week is
     still above the volume bar. */
  t = athlete(EARLY_BUILD, { volume: 80 });
  assert.ok(t.a.levelUpEvidence(), 'fixture: the evidence holds before the misses');
  const N = t.a.currentWeekNum();
  [N - 1, N - 3].forEach(wk => {
    const e = t.a.weekRunDays(wk).find(d => d.type === 'easy');
    e.completed = false; e.actual = t.a.emptyActual();
  });
  t.a.maybeRaiseLevelUpOffer(false);
  assert.equal(t.asked.length, 0, 'offered below 90% completion');

  t = athlete(EARLY_BUILD, { experience: 'advanced' });
  assert.equal(t.a.levelUpEvidence(), null);
  t.a.maybeRaiseLevelUpOffer(false);
  assert.equal(t.asked.length, 0, 'offered above the top level');

  /* And below the level's peak volume there is nothing to offer. */
  t = athlete(EARLY_BUILD, { volume: 45 });
  t.a.maybeRaiseLevelUpOffer(false);
  assert.equal(t.asked.length, 0, 'offered below the Established peak');
});

test('Move Up switches the level through handleSetExperience and rebuilds the remaining weeks, keeping what is logged', () => {
  const { a, asked } = athlete(EARLY_BUILD);
  const logged = a.state.days.filter(d => d.completed).map(d => d.id + ':' + d.actual.km);
  const calls = [];
  a.openSetupModal = () => calls.push('builder');
  a.bldStage = n => calls.push('stage ' + n);
  const realSet = a.handleSetExperience;
  a.handleSetExperience = lv => { calls.push('level ' + lv); realSet(lv); };
  a.maybeRaiseLevelUpOffer(false);
  asked[0].onYes();
  assert.deepEqual(calls, ['builder', 'level advanced', 'stage ' + (a.BLD_STAGE_NAMES.length - 1)]);
  assert.equal(a.athleteExperience(), 'advanced');
  assert.equal(a.state.experience, 'advanced');
  /* The level the weeks were built for is remembered, so the existing
     Rebuild for Advanced? question still covers leaving without building. */
  assert.equal(a.state.setup.experienceBuiltFor, 'experienced');
  assert.deepEqual(a.state.days.filter(d => d.completed).map(d => d.id + ':' + d.actual.km), logged);
  assert.equal(a.state.setup.levelUpOffer.answer, 'yes');
  assert.equal(a.levelUpAcceptedFor('advanced'), true, 'the pathway question would argue them back down');
  a.maybeRaiseLevelUpOffer(false);
  assert.equal(asked.length, 1, 'asked again');
});

test('Stay at Established is remembered and costs nothing', () => {
  const { a, asked } = athlete(EARLY_BUILD);
  const before = JSON.stringify(a.state.days);
  a.maybeRaiseLevelUpOffer(false);
  asked[0].onNo();
  assert.equal(a.athleteExperience(), 'experienced');
  assert.equal(a.state.setup.levelUpOffer.answer, 'no');
  assert.equal(JSON.stringify(a.state.days), before, 'declining changed the plan');
  a.maybeRaiseLevelUpOffer(false);
  assert.equal(asked.length, 1, 'asked again in the same block');
  assert.equal(a.levelUpWaiting(), null, 'kept for the next block after a no');
});
