'use strict';
/* CHANGE WORKOUT AND MAKE YOUR OWN (founder, 15 November 2026).
 *
 * "When you edit a session. And say pick tempo, but it could be any of
 * them.... Would it be possible to then have a way of picking from the
 * workout library for that session type?" Of the mock-ups: "I think 4",
 * "I don't think the bar is needed", and "my beta user changed a session. He
 * did a 4 min run 4 min walk. But it wasn't easy to add that in."
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

function athlete(){
  const a = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: '10k', volume: 40, weeks: 12, experience: 'experienced',
    startDate: '2026-11-16', schedule: { activeDays: [0, 2, 4, 6], longRunDay: 6 } });
  return a;
}
const future = (a, type) => a.state.days.find(d => d.type === type && d.km > 0 && d.date >= '2026-11-30');

test('four at most, the plan\'s own first and ticked, every one the session\'s own distance', () => {
  const a = athlete();
  ['easy', 'tempo', 'threshold', 'interval', 'long'].forEach(t => {
    const dd = future(a, t);
    assert.ok(a.wkCanChange(dd), t + ' cannot change its workout');
    const fams = ['easy', 'tempo', 'threshold', 'interval'].concat(t === 'long' ? ['long'] : []);
    fams.forEach(f => {
      const opts = a.wkOptions(dd, f);
      assert.ok(opts.length >= 1 && opts.length <= 4, t + '/' + f + ' offers ' + opts.length);
      if (a.wkFamilyOf(dd) === f) assert.equal(opts[0].id, 'planned', t + ': the plan\'s session is not first');
      opts.forEach(o => {
        assert.ok(o.dose, t + '/' + f + ': ' + o.name + ' has no dose');
        if (!o.planned && !o.restore && o.id !== 'run_walk')
          assert.equal(o.apply.km, dd.km, o.name + ' moves the day\'s distance');
      });
    });
  });
});

test('a library workout is written by the plan\'s own words and keeps its structure', () => {
  const a = athlete();
  const dd = future(a, 'easy'), was = JSON.parse(JSON.stringify(dd));
  const o = a.wkOptions(dd, 'tempo').find(x => x.id === 'steady_tempo');
  assert.ok(o, 'Steady Tempo is not offered');
  const t = a.textFor({ archetype: o.apply.prescription.archetype, params: o.apply.prescription.params }, null, dd.km);
  assert.equal(o.apply.title, t.title);
  assert.equal(o.apply.desc, t.desc);
  assert.ok(a.wkApply(dd, o));
  assert.equal(dd.type, 'tempo');
  assert.equal(dd.km, was.km, 'the distance moved');
  assert.equal(dd.prescription.archetype, 'steady_tempo');
  assert.equal(dd.prescription.athleteModified, true);
  assert.equal(dd.prescription.derivedFrom, was.prescription.archetype);
  assert.equal(dd.manualEdit.from.title, was.title, 'what was planned is not kept');
  /* ...and it can go back. */
  const back = a.wkOptions(dd, 'easy').find(x => x.id === 'original');
  assert.ok(back, 'Back to the Plan is not offered');
  assert.ok(a.wkApply(dd, back));
  assert.equal(dd.type, was.type); assert.equal(dd.title, was.title); assert.equal(dd.km, was.km);
  assert.deepEqual(dd.prescription, was.prescription);
  assert.equal(dd.manualEdit, undefined, 'the restored day still reads as edited');
});

test('what the library disallows this phase is not offered', () => {
  const a = athlete();
  /* Goal-pace work is disallowed in Base. */
  const base = a.state.days.find(d => d.type !== 'rest' && d.km > 0 && a.wkPhaseOf(d) === 'Base' && a.wkCanChange(d));
  assert.ok(base, 'the fixture has no Base session');
  assert.equal(a.WORKOUT_LIBRARY.goal_pace_block.phase.Base, 'disallowed');
  assert.ok(!a.wkOptions(base, 'tempo').some(o => o.id === 'goal_pace_block'), 'a Goal Pace Block is offered in Base');
  assert.ok(!a.wkOptions(base, 'interval').some(o => o.id === 'goal_pace_reps'), 'goal pace reps are offered in Base');
});

test('an easy day offers run/walk sized to the same time on the feet, and it is the athlete\'s', () => {
  const a = athlete();
  const dd = future(a, 'easy');
  const names = Array.from(a.wkOptions(dd, 'easy'), o => o.name);
  assert.deepEqual(names, ['Easy Run', 'Run/Walk', 'Easy with Strides', 'Easy Progression']);
  const rw = a.wkOptions(dd, 'easy').find(o => o.id === 'run_walk');
  assert.match(rw.dose, /^Run 4 min, walk 1 min, \d+ times$/);
  const easy = a.midPaceForIntensity('easy', a.getActivePaces(), null);
  const reps = rw.apply.prescription.params.structure.reps;
  assert.ok(Math.abs(reps * 5 - dd.km * easy / 60) <= 5, 'run/walk is not the same time on the feet');
  assert.equal(rw.apply.type, 'easy');
  assert.equal(rw.apply.prescription.archetype, a.ATHLETE_ARCHETYPE);
  assert.equal(rw.apply.prescription.source, 'athlete');
  assert.match(rw.apply.desc, /The walking counts\./);
  /* Strides stay an easy day: the strides archetype is race week's sharpener. */
  const st = a.wkOptions(dd, 'easy').find(o => o.id === 'easy_strides');
  assert.equal(st.apply.type, 'easy');
  assert.equal(st.apply.prescription.archetype, 'easy_run');
});

test('Make Your Own: 4 min run, 4 min walk, 5 times is forty minutes, and the sheet says what it costs', () => {
  const a = athlete();
  const dd = future(a, 'easy');
  const o = a.wkOwnOption(dd, { kind: 'run_walk', a: 4, b: 4, n: 5 });
  assert.equal(o.own.mins, 40);
  assert.equal(o.apply.type, 'easy');
  assert.equal(o.apply.title, 'Run/Walk: 4 min run, 4 min walk');
  assert.deepEqual(JSON.parse(JSON.stringify(o.apply.prescription.params.structure)), { kind: 'run_walk', runMin: 4, walkMin: 4, reps: 5 });
  assert.ok(o.apply.km > 3 && o.apply.km < 8, 'forty minutes of 4/4 run/walk estimated at ' + o.apply.km + 'km');
  assert.match(a.wkOwnSummary(dd, { kind: 'run_walk', a: 4, b: 4, n: 5 }), /<b>40 min<\/b> in total.*less than planned, so this week’s total moves with it\./);
  const reps = a.wkOwnOption(dd, { kind: 'reps', a: 3, b: 2, n: 6 });
  assert.equal(reps.apply.type, 'interval'); assert.equal(reps.own.mins, 30);
  const steady = a.wkOwnOption(dd, { kind: 'steady', a: 20 });
  assert.equal(steady.apply.type, 'tempo'); assert.equal(steady.own.mins, 20);
});

test('the time wheel picks whole minutes and a count, never a keyboard', () => {
  const a = athlete();
  assert.equal(a.timeWheelFormat('min', { m: 4 }), '4 min');
  assert.equal(a.timeWheelFormat('count', { n: 1 }), '1 time');
  assert.equal(a.timeWheelFormat('count', { n: 5 }), '5 times');
  assert.deepEqual(JSON.parse(JSON.stringify(a.timeWheelParse('min', '4 min'))), { m: 4 });
  assert.deepEqual(JSON.parse(JSON.stringify(a.timeWheelParse('count', '12 times'))), { n: 12 });
  const dd = future(a, 'easy');
  a.wkState = null;
  const st = a.wkStateFor(dd); st.mode = 'own';
  const html = a.wkPickerHtml(dd);
  (html.match(/<input[^>]*>/g) || []).forEach(i => {
    assert.match(i, /readonly inputmode="none"/, 'a Make Your Own box raises a keyboard');
    assert.match(i, /data-wheel="(min|count)"/);
  });
  assert.ok(a.TIME_WHEEL_FIELDS.some(f => f.mode === 'min') && a.TIME_WHEEL_FIELDS.some(f => f.mode === 'count'));
});

test('nothing changes a race, a checkpoint, a rest day, a shakeout or a session already run', () => {
  const a = athlete();
  a.state.days.filter(d => ['race', 'checkpoint', 'calibration', 'rest'].includes(d.type))
    .forEach(d => assert.equal(a.wkCanChange(d), false, d.type + ' can change its workout'));
  const past = a.state.days.find(d => d.type !== 'rest' && d.km > 0);
  past.completed = true; past.actual = { km: past.km };
  assert.equal(a.wkCanChange(past), a.canEditPrescription(past));
  const shake = Object.assign({}, future(a, 'easy'), { title: 'Shakeout' });
  assert.equal(a.wkCanChange(shake), false);
});

test('keeping the plan\'s workout changes nothing', () => {
  const a = athlete();
  const dd = future(a, 'tempo'), was = JSON.stringify(dd);
  let closed = 0; a.closeModal = () => { closed++; };
  a.wkState = null; a.wkStateFor(dd); a.wkState.opts = a.wkOptions(dd, 'tempo'); a.wkState.picked = 'planned';
  a.handleWkUse();
  assert.equal(JSON.stringify(dd), was);
  assert.equal(closed, 1);
});
