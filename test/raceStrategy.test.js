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

test('the default is the recommended strategy, and the recommendation is Even Pace', () => {
  const { a } = athlete();
  assert.equal(a.recommendedRaceStrategy(), 'even');
  assert.equal(a.RACE_STRATEGIES.even.label, 'Even Pace',
    'the strategy holds one PACE; effort rises late and the coaching says so');
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

test('Even Pace is exactly the declared goal pace on every block, unrounded', () => {
  const { a, race } = athlete('full');
  const goal = a.getGoalPaceSecPerKm();
  const plan = a.raceExecutionPlan(race.km, 'even');
  plan.blocks.forEach(b => assert.equal(b.paceSec, goal));
  assert.equal(plan.driftSec, 0);
  assert.equal(plan.differential, 0);
});

test('Negative Split genuinely differs from Even Pace — slower open, faster finish', () => {
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

  assert.equal(even[0].paceRole, 'ceiling', 'even pace caps the opening');
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
  assert.match(even, /Even pace/i);
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
  ['Even Pace', 'Negative Split', 'Custom'].forEach(l =>
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
  /* THE FINISH MOVED TO THE RING, where this card already states what a
     session is aimed at -- it used to sit in the corner of the strategy
     picker under a PLANNED FINISH label. The LAW is untouched and is the
     whole point of this test: every strategy finishes on the athlete's own
     declared goal, so changing strategy must never change the time. Read
     from wherever it is printed; what matters is that it is one number and
     it does not move. */
  const { a, race } = athlete('full');
  const goalClock = a.secToClock(Math.round(a.getGoalPaceSecPerKm() * race.km));
  assert.ok(!/rs-finish/.test(a.renderRaceStrategyPicker(race)),
    'the strategy picker is printing the finish again as well as the ring');
  ['even', 'negative', 'custom'].forEach(k => {
    a.handleSetRaceStrategy(k);
    const ring = a.renderDayTargetRing(race, a.getDayTargets(race));
    const shown = (ring.match(/(\d+:[0-5]\d:[0-5]\d)/) || [])[1];
    assert.ok(shown, k + ' put no finish time on the ring at all');
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


// =====================================================================
// 7. HQ POLISH — TERMINOLOGY, CUSTOM IDENTITY, BLOCK HIERARCHY
// =====================================================================

test('no stale "Even Effort" strategy copy reaches an athlete', () => {
  /* The rename is athlete-facing only: the internal key stays 'even', because
     a stored preference is not worth churning for a label. What must not
     survive is the old NAME anywhere an athlete can read it. */
  const { a, race } = athlete('full');
  assert.equal(a.RACE_STRATEGIES.even.key, 'even', 'the internal id is deliberately unchanged');
  ['even', 'negative', 'custom'].forEach(k => {
    a.handleSetRaceStrategy(k);
    const surfaces = [
      a.renderRaceStrategyPicker(race),
      a.raceSummarySentence(race),
      a.renderDayCard(race),
      JSON.stringify(a.executionStrategy(race).phases),
    ].join(' ');
    assert.doesNotMatch(surfaces, /Even Effort/,
      k + ': the strategy is called Even Pace now');
    assert.doesNotMatch(surfaces, /Even effort:/,
      k + ': the summary sentence still opens with the old name');
  });
});

test('the picker labels and accessibility text both say Even Pace', () => {
  const { a, race } = athlete('full');
  const html = a.renderRaceStrategyPicker(race);
  assert.ok(html.indexOf('>Even Pace') !== -1);
  assert.doesNotMatch(html, /Even Effort/);
  // the chip is a real button carrying its own label, so its accessible name
  // is that text — there is no second string to drift out of step
  assert.match(html, /<button[^>]*data-action="set-race-strategy" data-strategy="even">Even Pace/);
});

test('the long-run "even effort, not even pace" distinction is untouched', () => {
  /* That line is a DIFFERENT and deliberate coaching point about hills, and
     the rename must not have swept it up. */
  const CODE = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  assert.match(CODE, /Even effort, not even pace/,
    'the rolling long run still distinguishes effort from pace');
});

test('Negative Split is exactly the approved 2% convention', () => {
  const { a } = athlete('full');
  assert.equal(a.RACE_NEGATIVE_SPLIT_DIFFERENTIAL, 0.02);
  assert.equal(a.raceStrategyDifferential('negative'), 0.02);
});

test('Custom remains 0–3% negative only, with no positive-split path', () => {
  const { a, race } = athlete('full');
  assert.equal(a.RACE_CUSTOM_MIN, 0);
  assert.equal(a.RACE_CUSTOM_MAX, 0.03);
  // no control offers a fade, and no stored value can produce one
  a.handleSetRaceStrategy('custom');
  const html = a.renderRaceStrategyPicker(race);
  assert.doesNotMatch(html, /positive|fade|slower second/i);
  [-1, -0.02, -0.001].forEach(v => {
    a.state.setup.raceStrategyCustom = v;
    assert.ok(a.raceCustomDifferential() >= 0);
    const plan = a.raceExecutionPlan(race.km);
    for (let i = 1; i < plan.blocks.length; i++)
      assert.ok(plan.blocks[i].paceSec <= plan.blocks[i - 1].paceSec,
        'no stored value may produce a race planned to fade');
  });
});

test('the Custom summary names itself and states its own differential', () => {
  const { a, race } = athlete('full');
  a.handleSetRaceStrategy('custom');
  [[0.01, '1%'], [0.015, '1.5%'], [0.03, '3%']].forEach(([d, shown]) => {
    a.state.setup.raceStrategyCustom = d;
    const line = a.raceSummarySentence(race);
    assert.match(line, /^Custom:/, 'it must identify itself as Custom');
    assert.ok(line.indexOf(shown) !== -1, 'it must state ' + shown + ': ' + line);
    assert.doesNotMatch(line, /^Negative split/,
      'a custom differential is the athlete’s own choice, not a Valhalla strategy name');
    assert.doesNotMatch(line, /0\.0\d/, 'and it must not leak the implementation maths');
    assert.doesNotMatch(line, /for you|based on|your history|we recommend/i,
      'it must not imply personalised evidence that does not exist');
  });
  a.state.setup.raceStrategyCustom = 0;
  const flat = a.raceSummarySentence(race);
  assert.match(flat, /^Custom:/);
  assert.match(flat, /even pace/i, 'a zero differential is an even pace the athlete set');
});

test('the execution guidance stays consistent with a Custom selection', () => {
  const { a, race } = athlete('full');
  a.handleSetRaceStrategy('custom');
  a.state.setup.raceStrategyCustom = 0.02;
  const g = a.raceStrategyGuidance(race);
  assert.match(g.cue, /2%/, 'the cue names the athlete’s own figure');
  assert.match(g.cue, /slower than goal pace/);
  const card = a.renderDayCard(race);
  assert.match(card, /Custom:/);
  assert.doesNotMatch(card, /Even effort through the first two-thirds/);
});

test('a race block is one scannable line of instruction, not two of prose', () => {
  /* The block hierarchy HQ approved: ACTION · distance · pace/HR · one
     instruction. The standing purpose line is suppressed for race blocks so it
     cannot say the same thing twice at body size. */
  const { a, race } = athlete('full');
  ['even', 'negative'].forEach(k => {
    a.handleSetRaceStrategy(k);
    a.executionStrategy(race).phases.forEach(ph => {
      assert.equal(ph.purpose, null, k + '/' + ph.key + ' still carries a purpose line');
      assert.ok(ph.cue && ph.cue.length, 'every block still tells the athlete what to do');
      assert.ok(ph.label && ph.spanLabel && ph.pace, 'and still carries action, distance and pace');
    });
  });
  /* Purpose and cue render as ONE paragraph now, so a block carrying only a
     cue produces exactly one prose line -- which is what "not two of prose"
     has always meant. The class it lands in changed; the count did not, and
     the data assertion above still pins purpose to null at the source. */
  /* ---- THE CLASS MOVED WITH THE SENTENCE ----
     Founder: "Can any of the current coaches notes be added to the rails?"
     The block's one instruction used to render as .strat-phase-purpose in
     a caption under the rail; it renders as .strat-phase-say on the block's
     own card. The count is what this law is about and the count is
     unchanged -- one prose line per block, never two. */
  const card = a.renderDayCard(race);
  assert.equal((card.match(/strat-phase-say/g) || []).length, 5,
    'one instruction per block');
  assert.doesNotMatch(card, /strat-phase-purpose/,
    'the retired caption class is being emitted again alongside the card line');
  assert.doesNotMatch(card, /strat-phase-cue/,
    'the separate italic cue line is retired, not re-emitted alongside');
});

/* ===========================================================================
 * NO TWO BLOCKS OF A RACE SAY THE SAME THING
 * ---------------------------------------------------------------------------
 * Founder, looking at the rail: "I don't think it needs a commit page?
 * Commit and push us the same message? ... Same with hold?"
 * MEASURED BEFORE ANSWERING, on a real marathon: HOLD 10-20km and HOLD
 * 20-30km carried a byte-identical sentence -- "Goal pace, unremarkable,
 * boring. Take your fuel on schedule." -- so two pages of the plan said one
 * thing and the athlete swiped past the second having just read it.
 * PRESS AND COMMIT DID NOT. "Where the race starts. Effort rises for the
 * same pace now" against "The last stretch. If you are still in control,
 * press. If you are not, hold on and finish." Two different pieces of
 * coaching that only LOOKED alike, because the Coach's Note repeated
 * verbatim on all five pages and buried the one line that differed. So the
 * blocks were not merged -- RACE_BLOCKS_KM feeds the per-block paces and
 * the implied finish, and dropping one changes the race plan's arithmetic
 * rather than its screen. The middle was given the two different jobs it
 * actually has, and the repetition under it was removed.
 * CAUGHT BY MUTATION: forcing the middle branch off left every other guard
 * in this file green. */
test('no two blocks of a race carry the same instruction', () => {
  ['5k', '10k', 'half', 'full', 'ultra'].forEach(key => {
    const { a, race } = athlete(key);
    ['even', 'negative'].forEach(k => {
      a.handleSetRaceStrategy(k);
      const phases = a.executionStrategy(race).phases;
      const cues = phases.map(p => a.resolveDesc(p.cue || ''));
      /* Built with indexOf rather than a seen-map: a map keyed on the cue
         stores index 0 as a falsy value, so a block repeating the FIRST
         one's words slips through -- and the failure message dereferenced
         that undefined index, which node evaluates even when the assertion
         passes. Found by running it. */
      cues.forEach((c, i) => {
        if (!c) return;
        const first = cues.indexOf(c);
        if (first === i) return;
        assert.fail(
          key + '/' + k + ': blocks ' + first + ' and ' + i + ' (' +
          phases[first].label + ' ' + phases[first].spanLabel + ' and ' +
          phases[i].label + ' ' + phases[i].spanLabel +
          ') carry the identical instruction: "' + c + '"');
      });
    });
  });
});

/* AND THE MARATHON'S MIDDLE IS TWO DIFFERENT JOBS, NAMED.
   The rule is counted from the number of blocks rather than keyed to a
   distance, so it follows RACE_BLOCKS_KM instead of a second list that
   could drift from it: a half has exactly one middle block and keeps the
   patient line it already had, a 5K and a 10K have none at all. */
test('only a race with more than one middle block gets a second middle voice', () => {
  const widths = { '5k': 0, '10k': 0, 'half': 1, 'full': 2, 'ultra': 2 };
  Object.keys(widths).forEach(key => {
    const { a, race } = athlete(key);
    const phases = a.executionStrategy(race).phases;
    const middles = Math.max(0, phases.length - 3);
    assert.equal(middles, widths[key],
      key + ' has ' + middles + ' middle blocks, not ' + widths[key] +
      ' — the middle rule is counted from the block table and has drifted from it');
    if (middles < 2) return;
    const mid = phases.slice(1, 1 + middles).map(p => a.resolveDesc(p.cue || ''));
    assert.notEqual(mid[0], mid[mid.length - 1],
      key + ': the first and last middle blocks say the same thing again');
    /* The later one is where holding the pace starts to cost something, and
       it is the block whose fuelling is paid for after 30km. */
    assert.match(mid[mid.length - 1], /stops being free|steps down/,
      key + ': the last middle block lost the line that tells it apart');
  });
});

test('suppressing the purpose line is scoped to races and nothing else', () => {
  const { a, days } = athlete('full');
  const long = days.filter(d => d.type === 'long' && d.km >= 16)[0];
  if (!long) return;
  const s = a.executionStrategy(long);
  if (!s || s.suppressed) return;
  assert.ok(s.phases.some(ph => ph.purpose),
    'a long run keeps the standing purpose wording it always had');
});

/* =====================================================================
 * GOAL DAY SAYS EACH THING ONCE
 * ---------------------------------------------------------------------
 * Three separate duplications on the one screen the whole block is built
 * for, each removed on the founder's call, each with the fact it duplicated
 * still present somewhere better.
 * ===================================================================== */

test('the ceiling keeps the fast edge and loses the words', () => {
  const { a, race } = athlete();
  const s = a.executionStrategyForDisplay(race);
  const settle = s.phases.filter(p => p.paceRole === 'ceiling')[0];
  assert.ok(settle, 'sanity: an even-pace race opens with a ceiling phase');

  const shown = a.fmtStrategyPace(settle.pace, settle.paceRole);
  assert.doesNotMatch(shown, /no faster than/,
    'the rail panel is prefixing the figure again — the caption under it already says it');

  /* THE BEHAVIOUR IS UNCHANGED, which is the half that matters: a ceiling
     is the FAST EDGE ONLY and never a band, because a ceiling caps how
     fast and not how slow. Dropping the words must not have dropped that. */
  const band = a.fmtStrategyPace(settle.pace, 'target');
  if (settle.pace.slow != null && settle.pace.slow !== settle.pace.fast)
    assert.notEqual(shown, band, 'the ceiling is printing a BAND now — it has stopped being a ceiling');
  assert.equal(shown.indexOf('–'), -1, 'the ceiling printed a range');

  /* AND THE CEILING IS STILL SAID, in the Coach's Note, which is where the
     founder asked for it. This is the fact the rail stopped repeating. */
  /* AND THE CEILING IS STILL SAID -- on the SETTLE card itself now, which
     is where the founder asked the coaching to go. This read the caption
     renderer, and that function is deleted rather than left building a
     second copy of a sentence the card already carries. Asserted on the
     rendered card, which is stricter: a string in a renderer nobody calls
     would have satisfied the old line. */
  const settleCard = (a.renderDayCard(race)
    .match(/<div class="how-mod strat-phase">[\s\S]*?<\/div><\/div>/g) || [])[0] || '';
  assert.match(settleCard, /No faster than goal pace/,
    'the ceiling is now said NOWHERE — it came off the rail on the grounds the note carries it');

  /* The split that rendered the qualifier above the figure goes with it. */
  const CODE = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  assert.ok(CODE.indexOf('sp-q') === -1,
    'the qualifier line is still in the markup or the sheet with nothing left to put in it');
});

test('goal day drops time-on-feet; every long run keeps it', () => {
  /* On goal day the hero ring above this rail carries the goal time, so the
     panel was that number rounded worse, one swipe away. Every other
     session is the only place a duration can be read at all. */
  const { a, race, days } = athlete();
  const key = r => r.short || r.k;
  const raceRows = a.fuelFacts(race).rows.map(key);
  assert.ok(raceRows.indexOf('Time on feet') === -1,
    'time-on-feet is back on goal day, under a ring that already states the goal time');
  assert.ok(raceRows.length >= 3, 'the race lost more than the one row it was meant to');

  const long = days.filter(d => d.type === 'long' && d.km > 0).slice(-1)[0];
  assert.ok(long, 'sanity: the fixture has a long run');
  assert.ok(a.fuelFacts(long).rows.map(key).indexOf('Time on feet') > -1,
    'a long run lost time-on-feet — it was only ever meant to come off the race');

  /* TAKEN OUT BY THE DAY, NEVER BY THE SURFACE. renderDayCard() must emit
     one identical string for Today, This Week and Full Plan, so the stacked
     Fueling card and the rail have to agree about whether this fact exists. */
  assert.equal(a.fuelSectionBody(race).indexOf('time-on-feet'), -1,
    'the stacked card still shows time-on-feet while the rail does not — two surfaces, two answers');
});

test('the race lede is centred, and only the race lede', () => {
  const { a, race, days } = athlete();
  /* WAS "and only the race lede", asserting a .day-desc-race modifier. The
     founder extended the centring to every session description under a
     focused session, so the modifier has nothing left to say and is gone --
     what remains to protect is that the line is centred, and that it is
     centred where a session is BEING READ rather than in a list, where
     centring prose makes a ragged column. */
  const card = a.renderDayCard(race);
  assert.match(card, /class="day-desc"/, 'the race lede has lost its description element');
  const CSS = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8')
    .match(/<style[^>]*>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
  /* The rule carries an ink now as well as the alignment -- founder, on
     the race card: "Text white." It was the last warm grey left on a
     focused card once the labels went white. This matched the whole
     declaration body, so it is anchored on the property it is about. */
  assert.match(CSS, /\.view-week \.wk-overview\) \.day-desc\{[^}]*text-align:center/,
    'the focused session description is no longer centred');
  assert.ok(!/\n  \.day-desc\{[^}]*text-align:center/.test(CSS),
    'every description is centred now, in lists too — it was scoped to the focused session on purpose');
});
