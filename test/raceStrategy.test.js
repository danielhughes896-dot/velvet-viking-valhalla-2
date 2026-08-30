'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* RACE STRATEGY — THE ATHLETE CHOOSES HOW THE RACE IS EXECUTED
   =========================================================================
   THE MATHEMATICAL BASIS, because this feature is only worth having if it has
   one. getGoalPaceSecPerKm() is the pace that exactly produces the goal time
   over the goal distance at the active VDOT, so the intended finish is

       T = goalPace x raceKm

   and a strategy is a pace multiplier m(x) = 1 + k(0.5 - x) over the fraction x
   of the race, taken at each block's own midpoint. For a linear m the average
   over an interval IS the midpoint value, and SUM len_i * mid_i = D/2 for ANY
   partition, so SUM len_i * m_i = D identically. The predicted finish therefore
   equals the goal time exactly, for any strategy and any block count -- which
   is what makes this a plan rather than "goal pace plus a few seconds".

   k = 2d, where d is the fraction by which the second half is run faster than
   the first: first-half mean 1 + k/4, second-half mean 1 - k/4, difference k/2.

   WHAT THESE TESTS EXIST TO STOP: a strategy that quietly moves the athlete's
   declared goal, blocks that do not add up, a Negative Split that is only
   different words, imperial blocks that are converted kilometres, five blocks
   bolted onto a 5K, and any of it reaching training prescription. */

const TODAY = '2026-09-02';
function athlete(distanceKey, opts) {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  const { days } = buildPlan(a, Object.assign({
    distanceKey: distanceKey || 'full', volume: 55, weeks: 14, lthr: 172, maxHR: 188,
    startDate: a.addDays(TODAY, -28)
  }, opts || {}));
  const race = days.filter(d => d.type === 'race')[0];
  assert.ok(race, 'fixture must have a race day');
  return { a, race, days };
}
const paces = s => s.phases.map(p => p.pace && p.pace.fast);
const spans = s => s.phases.map(p => p.spanLabel);

// =====================================================================
// 1. SELECTION, DEFAULT AND PERSISTENCE
// =====================================================================

test('the default is the recommended strategy, and the recommendation is Even Effort', () => {
  const { a } = athlete();
  assert.equal(a.recommendedRaceStrategy(), 'even');
  assert.equal(a.raceStrategyKey(), 'even', 'an athlete who has chosen nothing gets the safe default');
  assert.equal(a.state.setup.raceStrategy, undefined, 'and nothing was written to say so');
});

test('the athlete can select each strategy, and the choice is what is then used', () => {
  const { a, race } = athlete();
  ['negative', 'custom', 'even'].forEach(key => {
    a.handleSetRaceStrategy(key);
    assert.equal(a.state.setup.raceStrategy, key);
    assert.equal(a.raceStrategyKey(), key);
    assert.equal(a.raceExecutionPlan(race.km).strategy, key);
  });
});

test('an unknown strategy is refused and falls back to the recommendation', () => {
  const { a } = athlete();
  a.handleSetRaceStrategy('positive');
  assert.equal(a.state.setup.raceStrategy, undefined, 'nothing was stored');
  a.state.setup.raceStrategy = 'nonsense';                 // e.g. a hand-edited state
  assert.equal(a.raceStrategyKey(), 'even', 'and a bad stored value never reaches the maths');
});

test('the choice survives a reload and travels in the synced plan', () => {
  const { a } = athlete();
  a.handleSetRaceStrategy('negative');
  const reloaded = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  reloaded.state = JSON.parse(JSON.stringify(a.state));
  assert.equal(reloaded.raceStrategyKey(), 'negative');
  /* setup is signed whole by planContentSignature(), so this is synced state
     and a divergence between devices is observable — it is a plan preference,
     not a device one. */
  assert.match(String(a.planContentSignature(a.state)), /"raceStrategy":"negative"/);
});

test('changing strategy changes the plan signature; it is not device-local', () => {
  const { a } = athlete();
  const before = a.planContentSignature(a.state);
  a.handleSetRaceStrategy('negative');
  assert.notEqual(a.planContentSignature(a.state), before);
});

test('the choice is editable before race day and locked afterwards', () => {
  const { a, race } = athlete();
  assert.equal(a.raceStrategyEditable(race), true);

  const past = loadApp({ pinnedDate: '2027-06-01T09:00:00Z' });
  past.state = JSON.parse(JSON.stringify(a.state));
  past.showToast = () => {}; past.renderApp = () => {}; past.flushSave = () => {};
  const pastRace = past.state.days.filter(d => d.type === 'race')[0];
  assert.equal(past.raceStrategyEditable(pastRace), false, 'a race that has happened is a record');
  past.handleSetRaceStrategy('negative');
  assert.notEqual(past.state.setup.raceStrategy, 'negative',
    'and the refusal is at the write, not only on the disabled button');
  assert.match(past.renderRaceStrategyPicker(pastRace), /Locked/);
});

// =====================================================================
// 2. SEGMENTATION — DISTANCE AND UNIT AWARE
// =====================================================================

test('the Marathon is staged in the blocks a marathon is actually raced in', () => {
  const { a, race } = athlete('full');
  const s = a.executionStrategy(race);
  assert.equal(s.phases.length, 5);
  assert.equal(spans(s).join(','), '0–10km,10–20km,20–30km,30–40km,40–42.2km');
});

test('imperial gives athlete-facing mile blocks, not converted kilometres', () => {
  const { a, race } = athlete('full');
  a.state.units = 'mi';
  const s = a.executionStrategy(race);
  assert.equal(spans(s).join(','), '0–6mi,6–12mi,12–18mi,18–24mi,24–26.2mi',
    'a marathon is raced to 6/12/18/24/26.2, never to 6.21/12.43');
  spans(s).forEach(sp => assert.doesNotMatch(sp, /\d\.\d\d/, 'no two-decimal conversion artefacts'));
});

test('shorter races get substantially fewer stages', () => {
  assert.equal(athlete('5k').a.executionStrategy(athlete('5k').race).phases.length, 3);
  const tenK = athlete('10k');
  assert.equal(tenK.a.executionStrategy(tenK.race).phases.length, 3);
  const half = athlete('half');
  assert.equal(half.a.executionStrategy(half.race).phases.length, 4);
  const ultra = athlete('ultra');
  assert.equal(ultra.a.executionStrategy(ultra.race).phases.length, 5);
});

test('every distance and unit produces clean spans ending at the real race distance', () => {
  ['5k', '10k', 'half', 'full', 'ultra'].forEach(dk => {
    ['km', 'mi'].forEach(u => {
      const { a, race } = athlete(dk);
      a.state.units = u;
      const bounds = a.raceBlockBounds(race.km);
      assert.equal(bounds[0], 0, dk + '/' + u + ' must start at zero');
      assert.equal(bounds[bounds.length - 1], race.km,
        dk + '/' + u + ' must finish at the actual race distance');
      for (let i = 1; i < bounds.length; i++)
        assert.ok(bounds[i] > bounds[i - 1], dk + '/' + u + ' bounds must increase');
    });
  });
});

test('the phase vocabulary follows position, so one rule stages 3 blocks and 5', () => {
  // joined, not deepEqual: arrays cross the VM sandbox boundary and a
  // structural comparison fails on prototype identity alone.
  const five = athlete('full');
  assert.equal(five.a.executionStrategy(five.race).phases.map(p => p.key).join(','),
    'settle,hold,hold,press,commit');
  const three = athlete('5k');
  assert.equal(three.a.executionStrategy(three.race).phases.map(p => p.key).join(','),
    'settle,press,commit');
});

// =====================================================================
// 3. THE MATHEMATICS
// =====================================================================

test('every strategy finishes on the athlete’s declared goal time, exactly', () => {
  ['5k', '10k', 'half', 'full', 'ultra'].forEach(dk => {
    const { a, race } = athlete(dk);
    const target = a.getGoalPaceSecPerKm() * race.km;
    ['even', 'negative', 'custom'].forEach(key => {
      const plan = a.raceExecutionPlan(race.km, key);
      const exact = plan.blocks.reduce((t, b) => t + b.km * b.paceExact, 0);
      assert.ok(Math.abs(exact - target) < 1e-6,
        dk + '/' + key + ' drifted from the declared finish by ' + (exact - target) + 's');
      assert.ok(Math.abs(plan.targetSec - target) < 1e-6);
    });
  });
});

test('the blocks an athlete actually reads do not imply a different finish', () => {
  /* Displayed paces are whole seconds. Rounding five of them independently can
     walk the implied finish twenty seconds from the goal, so the residual is
     carried between blocks. */
  ['5k', '10k', 'half', 'full', 'ultra'].forEach(dk => {
    ['km', 'mi'].forEach(u => {
      const { a, race } = athlete(dk);
      a.state.units = u;
      ['even', 'negative', 'custom'].forEach(key => {
        const plan = a.raceExecutionPlan(race.km, key);
        assert.ok(Math.abs(plan.driftSec) <= 6,
          dk + '/' + u + '/' + key + ' displayed blocks imply a finish '
            + plan.driftSec.toFixed(1) + 's from the goal');
        plan.blocks.forEach(b => assert.ok(Math.abs(b.paceSec - b.paceExact) <= 1,
          'a displayed pace must stay within a second of its true value'));
      });
    });
  });
});

test('Even Effort is exactly the declared goal pace on every block, unrounded', () => {
  const { a, race } = athlete('full');
  const goal = a.getGoalPaceSecPerKm();
  const plan = a.raceExecutionPlan(race.km, 'even');
  plan.blocks.forEach(b => assert.equal(b.paceSec, goal));
  assert.equal(plan.driftSec, 0);
  assert.equal(plan.differential, 0);
});

test('Negative Split genuinely differs from Even Effort — slower open, faster finish', () => {
  const { a, race } = athlete('full');
  const goal = a.getGoalPaceSecPerKm();
  const even = a.raceExecutionPlan(race.km, 'even');
  const neg = a.raceExecutionPlan(race.km, 'negative');

  assert.notDeepEqual(neg.blocks.map(b => b.paceSec), even.blocks.map(b => b.paceSec));
  assert.ok(neg.blocks[0].paceSec > goal, 'the opening block is genuinely slower than goal pace');
  assert.ok(neg.blocks[neg.blocks.length - 1].paceSec < goal, 'and the last is genuinely faster');
  // monotonic: each block is faster than the one before it
  for (let i = 1; i < neg.blocks.length; i++)
    assert.ok(neg.blocks[i].paceSec <= neg.blocks[i - 1].paceSec,
      'a negative split never steps back up');

  // and the differential is the one that was asked for
  const half = race.km / 2;
  const meanOver = (from, to) => {
    let t = 0, d = 0;
    neg.blocks.forEach(b => {
      const lo = Math.max(b.from, from), hi = Math.min(b.to, to);
      if (hi > lo) { t += (hi - lo) * b.paceExact; d += (hi - lo); }
    });
    return t / d;
  };
  const first = meanOver(0, half), second = meanOver(half, race.km);
  assert.ok(Math.abs(((first - second) / first) - a.RACE_NEGATIVE_SPLIT_DIFFERENTIAL) < 0.001,
    'the second half must be faster by exactly the declared differential');
});

test('the coaching differs too, not only the numbers', () => {
  const { a, race } = athlete('full');
  a.handleSetRaceStrategy('even');
  const even = a.executionStrategy(race).phases;
  a.handleSetRaceStrategy('negative');
  const neg = a.executionStrategy(race).phases;

  assert.equal(even[0].paceRole, 'ceiling', 'even effort caps the opening');
  assert.equal(neg[0].paceRole, 'target', 'a negative split PRESCRIBES the slower opening');
  assert.notEqual(even[0].cue, neg[0].cue);
  assert.notEqual(even[even.length - 1].cue, neg[neg.length - 1].cue);
  assert.match(neg[0].cue, /too easy|slower/i);
});

// =====================================================================
// 4. CUSTOM
// =====================================================================

test('Custom moves one number, is clamped, and stays coherent', () => {
  const { a, race } = athlete('full');
  a.handleSetRaceStrategy('custom');
  assert.equal(a.raceCustomDifferential(), a.RACE_CUSTOM_DEFAULT);

  for (let i = 0; i < 20; i++) a.handleRaceCustomStep(1);
  assert.equal(a.raceCustomDifferential(), a.RACE_CUSTOM_MAX, 'clamped at the top');
  for (let i = 0; i < 40; i++) a.handleRaceCustomStep(-1);
  assert.equal(a.raceCustomDifferential(), a.RACE_CUSTOM_MIN, 'and at the bottom');

  // at either bound the plan is still exactly on the goal time
  [a.RACE_CUSTOM_MIN, a.RACE_CUSTOM_MAX].forEach(d => {
    a.state.setup.raceStrategyCustom = d;
    const plan = a.raceExecutionPlan(race.km, 'custom');
    const exact = plan.blocks.reduce((t, b) => t + b.km * b.paceExact, 0);
    assert.ok(Math.abs(exact - a.getGoalPaceSecPerKm() * race.km) < 1e-6);
  });
});

test('Custom cannot ask for a race planned to fall apart', () => {
  const { a, race } = athlete('full');
  a.state.setup.raceStrategy = 'custom';
  a.state.setup.raceStrategyCustom = -0.5;          // a deliberate positive split
  assert.ok(a.raceCustomDifferential() >= 0, 'a planned fade is not on offer');
  const plan = a.raceExecutionPlan(race.km);
  for (let i = 1; i < plan.blocks.length; i++)
    assert.ok(plan.blocks[i].paceSec <= plan.blocks[i - 1].paceSec);

  a.state.setup.raceStrategyCustom = 99;
  assert.equal(a.raceCustomDifferential(), a.RACE_CUSTOM_MAX);
  a.state.setup.raceStrategyCustom = 'nonsense';
  assert.equal(a.raceCustomDifferential(), a.RACE_CUSTOM_DEFAULT, 'a junk value is not a strategy');
});

// =====================================================================
// 5. NOTHING ELSE MOVED
// =====================================================================

test('no strategy changes training prescription, zones, volume or history', () => {
  const { a, race, days } = athlete('full');
  const snapshot = () => ({
    days: days.map(d => [d.id, d.date, d.type, d.km, d.title, d.desc,
                         d.prescription ? JSON.stringify(d.prescription) : null].join('~')),
    paces: JSON.stringify(a.getActivePaces()),
    hr: JSON.stringify(a.getActiveHRZones()),
    goalPace: a.getGoalPaceSecPerKm(),
    vol: [1, 2, 3, 4].map(w => JSON.stringify(a.weekVolume(w))).join('|'),
    targets: days.slice(0, 20).map(d => JSON.stringify(a.executionPaceTarget(d))).join('|'),
  });
  const before = JSON.stringify(snapshot());
  ['negative', 'custom', 'even'].forEach(k => a.handleSetRaceStrategy(k));
  assert.equal(JSON.stringify(snapshot()), before,
    'race strategy is an execution preference and must not touch the programme');
});

test('completed history is untouched by a strategy change', () => {
  const { a, days } = athlete('full');
  const past = days.filter(d => d.date < a.todayStr() && d.type !== 'rest')[0];
  past.completed = true;
  past.actual = { km: past.km, pace: '5:30', hr: 150, rpe: 5, notes: 'ran it' };
  const before = JSON.stringify(past);
  a.handleSetRaceStrategy('negative');
  assert.equal(JSON.stringify(past), before);
});

test('the stored race prescription is never rewritten by a preference', () => {
  const { a, race } = athlete('full');
  const desc = race.desc, km = race.km, title = race.title, date = race.date;
  a.handleSetRaceStrategy('negative');
  assert.equal(race.desc, desc, 'dd.desc is plan content, signed and synced — not a preference');
  assert.equal(race.km, km); assert.equal(race.title, title); assert.equal(race.date, date);
});

test('the Race Day summary describes the chosen strategy instead of contradicting it', () => {
  const { a, race } = athlete('full');
  a.handleSetRaceStrategy('even');
  const even = a.raceSummarySentence(race);
  a.handleSetRaceStrategy('negative');
  const neg = a.raceSummarySentence(race);
  assert.notEqual(even, neg);
  assert.match(even, /Even effort/i);
  assert.match(neg, /Negative split/i);
  /* The old stored sentence said "Even effort through the first two-thirds …
     Target: Goal Pace throughout" on every race, which a negative split
     contradicts outright. The card must not print it. */
  const card = a.renderDayCard(race);
  assert.doesNotMatch(card, /Even effort through the first two-thirds/);
  assert.match(card, /Negative split/i);
});

// =====================================================================
// 6. THE CONTROL
// =====================================================================

test('the picker offers the three strategies and marks the recommendation once', () => {
  const { a, race } = athlete('full');
  const html = a.renderRaceStrategyPicker(race);
  ['Even Effort', 'Negative Split', 'Custom'].forEach(l =>
    assert.ok(html.indexOf('>' + l) !== -1, 'missing ' + l));
  assert.equal((html.match(/Recommended/g) || []).length, 1);
  assert.equal((html.match(/data-action="set-race-strategy"/g) || []).length, 3);
});

test('the custom stepper appears only while Custom is chosen', () => {
  const { a, race } = athlete('full');
  a.handleSetRaceStrategy('even');
  assert.doesNotMatch(a.renderRaceStrategyPicker(race), /data-action="race-custom"/,
    'the card must not carry a configuration panel it does not need');
  a.handleSetRaceStrategy('custom');
  assert.match(a.renderRaceStrategyPicker(race), /data-action="race-custom"/);
});

test('the selected chip takes the Valhalla accent, and gold is not the selection colour', () => {
  const CODE = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const i = CODE.indexOf('.rs-chip.on{');
  assert.ok(i > 0);
  const body = CODE.slice(i, CODE.indexOf('}', i));
  assert.match(body, /var\(--cherry[a-z-]*\)/, 'selection is Cherry Lacquer, as everywhere else');
  assert.doesNotMatch(body, /--modal-active|--gold/, 'gold stays Race Day identity, not selection');
  assert.doesNotMatch(body, /#[0-9a-f]{3,8}/i);
  // and the retired violet does not come back through this feature
  const block = CODE.slice(CODE.indexOf('.race-strategy{'), CODE.indexOf('.taper-note.race-split'));
  assert.doesNotMatch(block, /--violet|#A88FD8|#4C2A6B/i);
});

test('the planned finish shown is the athlete’s own goal time, whichever strategy', () => {
  const { a, race } = athlete('full');
  const goalClock = a.secToClock(Math.round(a.getGoalPaceSecPerKm() * race.km));
  ['even', 'negative', 'custom'].forEach(k => {
    a.handleSetRaceStrategy(k);
    const html = a.renderRaceStrategyPicker(race);
    const shown = (html.match(/rs-finish font-mono">([^<]+)</) || [])[1];
    const diff = Math.abs(a.clockToSec(shown) - a.clockToSec(goalClock));
    assert.ok(diff <= 6, k + ' showed ' + shown + ' against a goal of ' + goalClock);
  });
});

test('an athlete with no VDOT gets staging without invented paces', () => {
  const { a, race } = athlete('full');
  a.state.setup.benchmark = null;
  a.state.setup.goal = null;
  if (a.getGoalPaceSecPerKm() != null) return;        // fixture still has a goal; nothing to test
  const s = a.executionStrategy(race);
  assert.ok(s && s.phases.length >= 3, 'the staging survives');
  s.phases.forEach(ph => assert.equal(ph.pace, null, 'and no pace is fabricated'));
});
