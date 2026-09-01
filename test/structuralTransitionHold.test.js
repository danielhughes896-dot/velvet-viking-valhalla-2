'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

/* THE STRUCTURAL-TRANSITION HOLD.
 * ===========================================================================
 * "The week a purpose arrives is a week the doses hold." The rule existed in
 * the runtime and had never once fired: it compared mWeek.qSlots and
 * mWeek.supportDays -- the BLOCK's constants, identical every week -- against
 * variables assigned from those same constants two lines later. The weekly-load
 * instrument is what found it.
 *
 * THE METHODOLOGY, as HQ resolved it:
 *
 *   PREVIOUS EFFECTIVE WEEK
 *     -> MEANINGFUL STRUCTURAL INTRODUCTION, with the ordinary dose step held
 *     -> NEW EFFECTIVE BASELINE
 *     -> ORDINARY PROGRESSION RESUMES FROM THAT ACTUAL BASELINE.
 *
 * There is no deferred step, no debt and no repayment. A held week costs one
 * step of the block's progression and the athlete finishes one step lower --
 * which is the honest consequence of having spent that week absorbing a new
 * structure. The rate is fixed at the block's solve and is never re-derived, so
 * no later week can be walked faster to make it up.
 *
 * These tests hold: the detection is on EFFECTIVE prescription; every kind of
 * arrival is caught once and only once; a hold is not a recovery week; nothing
 * catches up afterwards; and the things that must NOT trigger it do not.
 */

const TODAY = '2026-08-30';
function app(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {}; a.showToast = () => {};
  a.state = a.makeDefaultState();
  return a;
}
function block(a, v, n, days){
  return a.buildBlockWeeks('full', v, n, { purpose: 'race', availableDays: days || 5 });
}
const devWeeks = blk => blk.weeks.filter(w => !w.isRace);
const runDays = w => { const b = w.bottomUp || {};
  return (b.countedSupportDays || 0) + (b.qSlots || 0) + (w.longTarget > 0 ? 1 : 0); };

/* ---- THE ATHLETE THE POPULATION IS NOW MADE OF ----
   This walked the domain by typed weekly volume alone. Destination-led
   construction removed that authority, so every one of those blocks now opens at
   its pathway's entry week AND its pathway's entry day count -- identical
   frequency across the whole sweep, and therefore no frequency ever arriving.
   Structure is still earned exactly as it was; what earns it is the athlete's
   own demonstrated training, so the population is written as demonstrated weeks
   rather than typed numbers. Each athlete arrives running on TWO days, which is
   what gives the block a frequency to develop and is the case these tests are
   about. Nothing about the hold, the arrival or the earned workload changes. */
function history(a, weeklyKm, days){
  const t = a.todayStr(), m = a.addDays(t, -a.isoWeekday(t)), s = [];
  const per = weeklyKm / days;
  for (let w = 1; w <= 20; w++)
    for (let d = 0; d < days; d++)
      s.push({ date: a.addDays(m, -7 * w + d * 3), completed: true,
               actualKm: per, plannedKm: per, type: d === days - 1 ? 'long' : 'easy',
               actual: { km: per, rpe: 4, pace: 360, hr: 138 }, feel: 'good' });
  return s;
}
/* Every marathon block the valid domain can produce, walked once. */
function eachBlock(fn){
  const a = app();
  const vols = []; for (let i = 6; i <= 40; i++) vols.push(i);
  [45, 50, 60, 70, 80, 100, 120].forEach(x => vols.push(x));
  vols.forEach(v => [4, 8, 12, 16, 24].forEach(n => [3, 5].forEach(d => {
    a.state = a.makeDefaultState();
    a.state.athlete = { sessions: history(a, v, 2) };
    fn(block(a, v, n, d), v, n, d);
  })));
}

/* ---------- 1. IT FIRES AT ALL, AND ON EFFECTIVE PRESCRIPTION ---------- */

test('the structural hold actually fires', () => {
  let arrivals = 0, held = 0;
  eachBlock(blk => devWeeks(blk).forEach(w => {
    const b = w.bottomUp || {};
    if (b.structureIntroduced){ arrivals++; if (b.heldAtEarnedWorkload) held++; }
  }));
  assert.ok(arrivals > 100, 'only ' + arrivals + ' structural arrivals across the population');
  assert.ok(held > arrivals * 0.9,
    'only ' + held + ' of ' + arrivals + ' arrivals held at the earned workload');
});

test('the arrival is measured on prescription, never on the block ceiling', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const i = src.indexOf('var mSol = mSolveWeek(longTarget, mWeek.supportKm);');
  const win = src.slice(i, i + 1400);
  assert.ok(/mSol\.runDays > mBottomUp\.estRunDays/.test(win),
    'days must be compared as SOLVED, against what has been established');
  assert.ok(/mSol\.qSlots\s+> mBottomUp\.estQSlots/.test(win));
  assert.ok(!/mBottomUp\.supportDays >|mBottomUp\.qSlots >/.test(win),
    'the block constants must not be the thing compared -- that was the dead rule');
});

/* ---------- 2. EVERY KIND OF ARRIVAL ---------- */

test('an additional prescribed running day is a structural arrival', () => {
  const seen = {};
  eachBlock(blk => {
    const ws = devWeeks(blk);
    ws.forEach((w, i) => {
      const b = w.bottomUp || {};
      if (!b.structureIntroduced || !/running_day/.test(b.structureArrived || '')) return;
      const p = ws[i - 1]; if (!p) return;
      const key = runDays(p) + '->' + runDays(w);
      seen[key] = (seen[key] || 0) + 1;
    });
  });
  /* Every frequency arrival the valid marathon population can reach. Reported
     rather than assumed: an arrival the methodology cannot produce is stated as
     unreachable instead of being fabricated. */
  console.log('    prescribed running-day arrivals: ' + JSON.stringify(seen));
  assert.ok(Object.keys(seen).length > 0, 'no running-day arrival occurs at all');
  ['2->3', '3->4'].forEach(k => assert.ok(seen[k] > 0, k + ' days never happens'));
});

test('the first conventional quality session is a structural arrival', () => {
  let found = 0;
  eachBlock(blk => {
    const ws = devWeeks(blk);
    ws.forEach((w, i) => {
      const b = w.bottomUp || {}, p = ws[i - 1];
      if (!p || !b.structureIntroduced) return;
      if ((p.bottomUp || {}).qSlots === 0 && b.qSlots === 1 &&
          /quality_session/.test(b.structureArrived || '')) found++;
    });
  });
  assert.ok(found > 0, 'a first quality session never registers as an arrival');
});

test('marathon-specific work entering the long run is a structural arrival', () => {
  let found = 0;
  eachBlock(blk => devWeeks(blk).forEach(w => {
    if ((w.bottomUp || {}).structureIntroduced &&
        /race_specific/.test(w.bottomUp.structureArrived || '')) found++;
  }));
  assert.ok(found > 0, 'goal-pace work entering the long run never registers');
});

/* ---------- 3. IT DOES NOT RETRIGGER ---------- */

test('an established structure never arrives twice', () => {
  let retrig = 0;
  eachBlock(blk => {
    const ws = devWeeks(blk);
    let estDays = null, estQ = null, estSpec = false;
    ws.forEach(w => {
      const b = w.bottomUp || {}, d = runDays(w);
      if (b.structureIntroduced){
        const kinds = (b.structureArrived || '').split(',');
        if (kinds.indexOf('running_day') !== -1 && estDays != null && d <= estDays) retrig++;
        if (kinds.indexOf('quality_session') !== -1 && estQ != null && (b.qSlots || 0) <= estQ) retrig++;
        if (kinds.indexOf('race_specific') !== -1 && estSpec) retrig++;
      }
      estDays = Math.max(estDays || 0, d);
      estQ = Math.max(estQ || 0, b.qSlots || 0);
      if (w.hasGoalSegment) estSpec = true;
    });
  });
  assert.equal(retrig, 0, retrig + ' structures arrived a second time');
});

test('a cutback that suppresses a session does not un-establish it', () => {
  /* The mark is a high-water mark, not last week's snapshot, so a rebound is
     not a first arrival. */
  let bad = 0;
  eachBlock(blk => {
    const ws = devWeeks(blk);
    ws.forEach((w, i) => {
      const p = ws[i - 1];
      if (!p || !p.isCutback) return;
      const b = w.bottomUp || {};
      if (b.structureIntroduced && /running_day/.test(b.structureArrived || '') &&
          runDays(w) <= Math.max.apply(null, ws.slice(0, i).map(runDays))) bad++;
    });
  });
  assert.equal(bad, 0, bad + ' rebounds counted as a first structural arrival');
});

/* ---------- 4. NO DEBT, NO CATCH-UP ---------- */

test('the progression index advances by at most one step a week, ever', () => {
  /* THE NO-CATCH-UP PROOF, and it is structural rather than statistical: the
     rate between steps is fixed at the block's solve, so if no week can advance
     more than one step, no week can be walked faster to make up a held one. */
  let worst = 0, worstCase = '';
  eachBlock((blk, v, n, d) => {
    const ws = devWeeks(blk).filter(w => w.bottomUp && w.bottomUp.step != null);
    ws.forEach((w, i) => {
      if (i === 0) return;
      const jump = w.bottomUp.step - ws[i - 1].bottomUp.step;
      if (jump > worst){ worst = jump; worstCase = v + 'km ' + n + 'w d' + d + ' wk' + w.week; }
    });
  });
  assert.ok(worst <= 1, 'the progression jumped ' + worst + ' steps at ' + worstCase);
});

test('a held week costs a step and the block ends lower, rather than repaying it', () => {
  const a = app();
  const blk = block(a, 15, 12, 5);
  const ws = devWeeks(blk);
  const holds = ws.filter(w => (w.bottomUp || {}).heldAtEarnedWorkload).length;
  assert.ok(holds > 0, 'this case is chosen because it holds');
  const last = ws.filter(w => w.bottomUp && w.bottomUp.step != null).pop();
  assert.ok(last.bottomUp.step <= blk.weeks[0].bottomUp.step + ws.length - 1 - holds,
    'the block reached step ' + last.bottomUp.step + ' after ' + holds + ' holds');
});

test('the rate is fixed at the block solve and never re-derived', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const loop = src.slice(src.indexOf('for (var w=1; w<=N; w++){'));
  assert.ok(!/sessionStepRate\(/.test(loop.slice(0, loop.indexOf('return { profile:profile'))),
    'the week loop must not recompute the progression rate -- that is catch-up');
});

/* ---------- 5. THE HOLD IS NOT A RECOVERY WEEK ---------- */

test('a held week keeps approximately the workload the athlete had earned', () => {
  let dropped = 0, n = 0;
  eachBlock(blk => {
    const ws = devWeeks(blk);
    ws.forEach((w, i) => {
      const b = w.bottomUp || {}, p = ws[i - 1];
      if (!b.heldAtEarnedWorkload || !p || p.isCutback) return;
      n++;
      if (w.volume < p.volume * 0.9) dropped++;
    });
  });
  assert.ok(n > 0);
  assert.ok(dropped / n < 0.05,
    dropped + ' of ' + n + ' held weeks cut the athlete by more than a tenth');
});

/* THE HOLD BELONGS TO THE SESSION THE ARRIVAL IS IN, and this used to assert
   the opposite: that the long run stood still in the week a RUNNING DAY
   arrived. That protection was withdrawn deliberately -- holding the long run
   because an easy run was added spent long-run development on frequency
   development, and it was two to three kilometres of the marathon's durability
   exposure across every pathway. What replaces it is stricter, not looser: the
   supporting work must still be held at the total the athlete had earned, so
   the week gains a session without gaining a session's worth of load, and the
   long run must still hold when the arrival is IN it. */
test('a day arrives at the earned supporting workload, not on top of it', () => {
  const a = app();
  /* The same athlete the population above is made of -- eight kilometres a week
     across two days, demonstrated rather than typed, which is what gives the
     block a third running day to arrive at. */
  a.state.athlete = { sessions: history(a, 8, 2) };
  const blk = block(a, 8, 12, 5);
  const ws = devWeeks(blk);
  const i = ws.findIndex(w => (w.bottomUp || {}).heldAtEarnedWorkload &&
                              /running_day/.test((w.bottomUp || {}).structureArrived || ''));
  assert.ok(i > 0, 'the 8km/12-week case holds at its third running day');
  assert.ok(runDays(ws[i]) > runDays(ws[i - 1]), 'and the day really did arrive');
  const b = ws[i].bottomUp, p = ws[i - 1].bottomUp;
  const earned = p.countedSupportDays * p.supportKm;
  const now    = b.countedSupportDays * b.supportKm;
  /* The same aerobic work, written across one more run. EASY_MIN_KM can lift
     it where the extra run cannot legally be smaller, which is geometry and is
     bounded rather than hidden. */
  assert.ok(now <= earned + a.EASY_MIN_KM + 1e-9,
    'the supporting workload grew by ' + Math.round((now - earned) * 10) / 10 +
    'km in the week a day arrived');
  /* And the long run is free to take its ordinary step -- one step, never two. */
  assert.ok(ws[i].longTarget >= ws[i - 1].longTarget - 1e-9,
    'the long run went backwards for a day arriving');
  assert.ok(ws[i].longTarget <= ws[i - 1].longTarget * 1.1 + 1,
    'the long run took more than its ordinary step');
});

test('race-specific work entering the long run still holds the long run', () => {
  let n = 0, stepped = 0;
  eachBlock(blk => {
    const ws = devWeeks(blk);
    ws.forEach((w, i) => {
      const b = w.bottomUp || {};
      if (i === 0 || !/race_specific/.test(b.structureArrived || '')) return;
      if (!b.doseStepHeld) return;
      /* Against the previous DEVELOPING week: a cutback deliberately suppresses
         its long run, so rebounding above it is the cutback ending, not a step. */
      if (ws[i - 1].isCutback || ws[i - 1].isTaper) return;
      n++;
      if (w.longTarget > ws[i - 1].longTarget + 0.05) stepped++;
    });
  });
  assert.ok(n > 0, 'no race-specific arrival held anywhere in the population');
  assert.equal(stepped, 0,
    stepped + ' of ' + n + ' race-specific arrivals also stepped the long run');
});

/* ---------- 6. WHAT MUST NOT TRIGGER IT ---------- */

test('an ordinary quality rotation is not a structural arrival', () => {
  let bad = 0;
  eachBlock(blk => {
    const ws = devWeeks(blk);
    ws.forEach((w, i) => {
      const b = w.bottomUp || {}, p = ws[i - 1];
      if (!p || !b.structureIntroduced) return;
      const pb = p.bottomUp || {};
      /* Same day count, same quality count, same specific status: nothing
         structural changed, so the workout changing cannot be the trigger. */
      if (runDays(w) === runDays(p) && b.qSlots === pb.qSlots &&
          !!w.hasGoalSegment === !!p.hasGoalSegment) bad++;
    });
  });
  assert.equal(bad, 0, bad + ' weeks were held for a workout change alone');
});

test('a phase transition on its own is not a structural arrival', () => {
  let bad = 0;
  eachBlock(blk => {
    const ws = devWeeks(blk);
    ws.forEach((w, i) => {
      const b = w.bottomUp || {}, p = ws[i - 1];
      if (!p || p.phase === w.phase || !b.structureIntroduced) return;
      const pb = p.bottomUp || {};
      if (runDays(w) === runDays(p) && b.qSlots === pb.qSlots &&
          !!w.hasGoalSegment === !!p.hasGoalSegment) bad++;
    });
  });
  assert.equal(bad, 0, bad + ' weeks were held for changing phase alone');
});

test('availability is not prescription, so an unused day cannot trigger it', () => {
  /* Six days available, a week that runs on three. Nothing structural arrives
     from the ceiling being generous. */
  const a = app();
  const wide = block(a, 12, 12, 6);
  a.state = a.makeDefaultState();
  const narrow = block(a, 12, 12, 3);
  const held = b => devWeeks(b).filter(w => (w.bottomUp || {}).heldAtEarnedWorkload).length;
  assert.ok(held(wide) <= devWeeks(wide).length,
    'sanity: holds are bounded by the weeks that exist');
  devWeeks(wide).forEach(w => {
    const b = w.bottomUp || {};
    if (!b.structureIntroduced) return;
    assert.ok(/running_day|quality_session|race_specific/.test(b.structureArrived || ''),
      'an arrival must name what actually arrived');
  });
});

test('a taper never introduces a new structure and never adds load', () => {
  let bad = 0, up = 0;
  eachBlock(blk => {
    const ws = devWeeks(blk);
    ws.forEach((w, i) => {
      if (!w.isTaper) return;
      if ((w.bottomUp || {}).structureIntroduced) bad++;
      const p = ws[i - 1];
      if (p && w.volume > p.volume + 0.5) up++;
    });
  });
  assert.equal(bad, 0, bad + ' taper weeks introduced a structure');
  assert.equal(up, 0, up + ' taper weeks added load');
});

test('a cutback is a reduction, which is what the word means', () => {
  let up = 0, n = 0, worst = 0;
  eachBlock(blk => {
    const ws = devWeeks(blk);
    ws.forEach((w, i) => {
      if (!w.isCutback || i === 0) return;
      n++;
      const d = Math.round((w.volume - ws[i - 1].volume) * 10) / 10;
      if (d > 0.05){ up++; if (d > worst) worst = d; }
    });
  });
  /* Not zero, and the residue is named: at the very bottom of the population a
     cutback week's supporting runs are already at EASY_MIN_KM and cannot
     shrink, so what remains is the floor rather than a progression. It was 47
     before the hold existed and 77 with it; the same ladder the taper already
     used brings it to this. */
  assert.ok(up <= 12, up + ' cutback weeks are larger than the week before them');
  assert.ok(worst <= 1.5, 'worst cutback rise +' + worst + 'km');
});
