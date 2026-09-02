'use strict';
/* §11  DO THE HALF AND THE MARATHON ACTUALLY RECEIVE DIFFERENT QUALITY?
 * ===========================================================================
 * The representative tables show similar family LABELS on both distances --
 * tempo, threshold, interval, checkpoint. HQ asked whether that is a defect or
 * a coarse vocabulary, and required the SESSIONS to be audited rather than the
 * names.
 *
 * They are audited here, on the axes HQ listed: structure, work duration and
 * distance, the goal-pace dose, the threshold dose, the long run's own
 * specific work, and which family the block's development culminates on. The
 * families are shared because a tempo is a tempo; what goes inside one is not
 * the same for a race run near threshold and a race run four hours below it.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const R = require(path.join(__dirname, 'audit', 'raceGoalReachability.js'));

const EXPS = ['novice', 'experienced', 'advanced'];
function sessions(dist, exp){
  const c = R.CANON.filter(x => x.dist === dist && x.exp === exp)[0];
  const res = R.build(Object.assign({ dist:c.dist, exp:c.exp, days:c.days, weeks:15 }, c.ev));
  const q = res.dd.filter(d => d.km > 0 && d.prescription &&
                          d.type !== 'easy' && d.type !== 'long' && d.type !== 'race');
  const dev = res.blk.weeks.filter(w => !w.isRace && !w.isTaper);
  return {
    res, q, dev,
    arche: a => q.filter(d => d.prescription.archetype === a),
    param: (a, k) => q.filter(d => d.prescription.archetype === a && d.prescription.params[k] != null)
                      .map(d => d.prescription.params[k]),
    peakMax: Math.max.apply(null, q.filter(d => res.blk.weeks[d.week - 1].phase === 'Peak')
                                   .map(d => d.km)),
    lrSegMax: Math.max.apply(null, [0].concat(
      res.blk.weeks.filter(w => w.hasGoalSegment).map(w => w.goalSegKm || 0))),
    terminal: (q.filter(d => d.week === dev[dev.length - 1].week)[0] || {}).prescription
  };
}

test('GOAL PACE — the marathon rehearses in longer efforts than the half, at every level', () => {
  /* The clearest event statement there is. A half is rehearsed in repetitions
     the athlete can hold at half effort; a marathon is rehearsed in longer
     continuous blocks, because that is the demand. */
  EXPS.forEach(e => {
    const h = sessions('half', e), f = sessions('full', e);
    const hRep = h.param('goal_pace_reps', 'm'), fRep = f.param('goal_pace_reps', 'm');
    if (hRep.length && fRep.length)
      assert.ok(Math.max.apply(null, fRep) > Math.max.apply(null, hRep),
        e + ': marathon goal-pace reps are ' + fRep + 'm against the half\'s ' + hRep + 'm');
  });
});

test('THE LONG RUN — the marathon carries roughly twice the half\'s goal-pace dose', () => {
  EXPS.forEach(e => {
    const h = sessions('half', e), f = sessions('full', e);
    assert.ok(f.lrSegMax > h.lrSegMax * 1.5,
      e + ': the marathon long run peaks at ' + f.lrSegMax +
      'km of goal pace against the half\'s ' + h.lrSegMax);
  });
});

test('PEAK — the marathon\'s hardest session is materially bigger than the half\'s', () => {
  EXPS.forEach(e => {
    const h = sessions('half', e), f = sessions('full', e);
    assert.ok(f.peakMax > h.peakMax * 1.3,
      e + ': marathon Peak session ' + f.peakMax + 'km against the half\'s ' + h.peakMax);
  });
});

test('TEMPO — the marathon\'s continuous work runs longer than the half\'s', () => {
  EXPS.forEach(e => {
    const h = sessions('half', e), f = sessions('full', e);
    const hMin = [].concat(h.param('progressive_tempo', 'min'), h.param('steady_tempo', 'min'),
                           h.param('split_tempo', 'min'));
    const fMin = [].concat(f.param('progressive_tempo', 'min'), f.param('steady_tempo', 'min'),
                           f.param('split_tempo', 'min'));
    assert.ok(hMin.length && fMin.length, e + ': no tempo work on one of the two distances');
    assert.ok(Math.max.apply(null, fMin) > Math.max.apply(null, hMin),
      e + ': marathon tempo runs to ' + Math.max.apply(null, fMin) +
      ' minutes against the half\'s ' + Math.max.apply(null, hMin));
  });
});

test('CULMINATION — the half ends on threshold and the marathon ends on goal pace', () => {
  /* What each block's LAST developed quality session is. A half marathon is
     run at or near threshold and a marathon is run at marathon pace, and the
     final thing each block develops says exactly that. This is the single
     sharpest answer to whether the shared family names are hiding a shared
     prescription: they are not. */
  EXPS.forEach(e => {
    const h = sessions('half', e), f = sessions('full', e);
    assert.equal(h.terminal.archetype, 'threshold_continuous',
      e + ' half: development culminates on ' + h.terminal.archetype);
    assert.notEqual(f.terminal.archetype, 'threshold_continuous',
      e + ' marathon: development culminates on threshold, which is the half\'s answer');
    assert.ok(/goal_pace|track_reps/.test(f.terminal.archetype),
      e + ' marathon: culminates on ' + f.terminal.archetype +
      ', which is neither goal-pace nor race-specific repetition work');
  });
});

test('AND THE FAMILIES REALLY ARE SHARED — so the difference is in the sessions', () => {
  /* If the two distances used disjoint family names this whole file would be
     proving something trivial. They do not: the same names appear on both, and
     everything above is about what is inside them. */
  const names = d => {
    const s = new Set();
    EXPS.forEach(e => sessions(d, e).q.forEach(x => s.add(x.type)));
    return s;
  };
  const h = names('half'), f = names('full');
  const shared = [].concat.apply([], [Array.from(h).filter(x => f.has(x))]);
  assert.ok(shared.length >= 3,
    'the two distances share only ' + shared.length + ' family names: ' + shared);
});
