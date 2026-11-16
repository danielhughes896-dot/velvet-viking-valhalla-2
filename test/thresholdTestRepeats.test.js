'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THE THRESHOLD TEST, FOR EVERYONE AT 20KM AND OVER (founder, 16 November
   2026): "Everyone at 20km+ (Recommended)", "Week 1 + every 6 weeks", and,
   for a plan that has no test, "Offer the test (Recommended)". */

const app = (now) => {
  const a = loadApp({ pinnedDate: (now || '2026-11-16') + 'T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  return a;
};
/* Built the way handleGeneratePlan() decides it: the verdict says whether the
   test is placed now or once the plan reaches 20km. */
function plan(a, o){
  buildPlan(a, o);
  a.state.experience = o.experience;
  const blk = a.buildBlockWeeks(o.distanceKey, o.volume, o.weeks,
    { calibrate: a.calibrationNeededNow(o.volume), calibrateWhenViable: a.calibrationDeferrable(o.volume),
      experience: o.experience, availableDays: a.state.setup.schedule.activeDays.length });
  a.state.days = a.buildDaysFromWeeks(blk, a.state.setup.raceDate, a.state.setup.schedule, o.startDate, false);
  return blk;
}
const testWeeks = a => a.state.days.filter(d => d.type === 'calibration').map(d => d.week).sort((x, y) => x - y);

test('week one, then every six weeks, never in a recovery week, the taper or beside the Fitness Checkpoint', () => {
  [['full', 'experienced', 50, 16], ['full', 'advanced', 65, 20], ['half', 'experienced', 40, 14], ['10k', 'experienced', 40, 14]]
    .forEach(([dk, exp, vol, weeks]) => {
      const a = app();
      const blk = plan(a, { distanceKey: dk, experience: exp, volume: vol, weeks, startDate: '2026-11-16', healthConsent: true });
      const tw = testWeeks(a);
      const tag = dk + '/' + exp + ' ' + weeks + 'w';
      assert.equal(tw[0], 1, tag + ': the first test is not in week one: ' + tw);
      tw.slice(1).forEach((w, i) => assert.ok(w - tw[i] >= 6, tag + ': tests in weeks ' + tw[i] + ' and ' + w));
      if (weeks >= 14) assert.ok(tw.length >= 2, tag + ': only one test in ' + weeks + ' weeks');
      const info = w => blk.weeks.find(x => x.week === w) || {};
      const cps = a.state.days.filter(d => d.type === 'checkpoint').map(d => d.week);
      tw.slice(1).forEach(w => {
        const i = info(w);
        assert.ok(!i.isCutback && !i.isTaper && !i.isRace, tag + ': a repeat test in week ' + w + ', a ' +
          (i.isCutback ? 'recovery' : 'taper or race') + ' week');
        cps.forEach(c => assert.ok(Math.abs(c - w) > 2, tag + ': a repeat test in week ' + w + ' beside the checkpoint in week ' + c));
      });
    });
});

test('without health consent the test still runs, for its pace', () => {
  const a = app();
  plan(a, { distanceKey: 'half', experience: 'experienced', volume: 40, weeks: 12, startDate: '2026-11-16', healthConsent: false });
  assert.equal(a.healthConsentGranted(), false);
  assert.equal(testWeeks(a)[0], 1);
});

test('below 20km there is no test until the plan reaches 20km', () => {
  const a = app();
  assert.equal(a.calibrationEligibility({ healthConsent: true, performances: [], today: '2026-11-16', currentVolume: 15 }).reason,
    'insufficient_base');
});

test('a plan with no test is offered one, in place of a hard session, and not asked again for six weeks', () => {
  const a = app('2026-11-16');
  plan(a, { distanceKey: 'full', experience: 'experienced', volume: 45, weeks: 16, startDate: '2026-11-02', healthConsent: true });
  /* As a plan built before the ruling: no threshold test anywhere in it. */
  a.state.days.filter(d => d.type === 'calibration').forEach(d => { d.type = 'easy'; d.title = 'Easy Run'; delete d.prescription; });
  assert.equal(testWeeks(a).length, 0);
  const dd = a.thresholdTestOfferDay();
  assert.ok(dd, 'no test offered');
  assert.ok(['tempo', 'threshold', 'interval'].includes(dd.type), 'offered in place of a ' + dd.type);
  assert.ok(dd.week > a.currentWeekNum(), 'offered for this week, not next');
  const before = dd.title;
  assert.equal(a.applyThresholdTestTo(dd), true);
  assert.equal(dd.type, 'calibration');
  assert.notEqual(dd.title, before);
  assert.equal(a.thresholdTestOfferDay(), null, 'offered again with a test already in the plan');
});

test('Not Now holds the offer for six weeks', () => {
  const a = app('2026-11-16');
  plan(a, { distanceKey: 'full', experience: 'experienced', volume: 45, weeks: 16, startDate: '2026-11-02', healthConsent: true });
  a.state.days.filter(d => d.type === 'calibration').forEach(d => { d.type = 'easy'; delete d.prescription; });
  a.state.setup.thresholdTestOffer = { answer: 'no', at: '2026-11-10' };
  assert.equal(a.thresholdTestOfferDay(), null);
  a.state.setup.thresholdTestOffer = { answer: 'no', at: '2026-09-28' };
  assert.ok(a.thresholdTestOfferDay(), 'not offered again after six weeks');
});

test('a test inside the last six weeks is not repeated by a new block', () => {
  const a = app('2026-11-16');
  const ctx = { healthConsent: true, performances: [], today: '2026-11-16', currentVolume: 45 };
  assert.equal(a.calibrationEligibility(Object.assign({ measuredOn: '2026-10-20' }, ctx)).needed, false);
  assert.equal(a.calibrationEligibility(Object.assign({ measuredOn: '2026-10-05' }, ctx)).needed, true);
});
