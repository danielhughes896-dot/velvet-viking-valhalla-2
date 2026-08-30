'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

/* SUPPORTING WORK — VARIETY WITHOUT COST
 * ===========================================================================
 * The gates choose a KIND from the phase, the week's cost and the day's
 * capacity. They were right, and are untouched. What was wrong was underneath
 * them: a kind held for a run of weeks delivered the identical five movements
 * every single time -- Foundation Strength can hold seven consecutive weeks in
 * a marathon build, and Mobility & Recovery carries most tapers.
 *
 * The whole of the change is that a kind now has more than one coherent route
 * through the same session. These tests hold the two properties that make that
 * safe rather than merely different:
 *
 *   VARIETY IS COST-FREE   every variant is the same session by every number
 *                          any gate reads, so nothing here can make a week
 *                          harder or displace running.
 *   VARIETY IS NOT         a harder session still comes only from the phase
 *   PROGRESSION            and the athlete's capacity permitting a more
 *                          expensive KIND.
 */
const TODAY = '2026-08-30';
const SCHED = { activeDays: [0, 1, 2, 3, 4, 6], longRunDay: 6 };

function plan(distKey, volume, weeks, schedule){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {}; a.showToast = () => {};
  a.state = a.makeDefaultState();
  const sch = schedule || SCHED;
  const blk = a.buildBlockWeeks(distKey, volume, weeks, {});
  const end = a.addDays(a.addDays(TODAY, -a.isoWeekday(TODAY)), blk.planWeeks * 7 - 1);
  a.state.days = a.buildDaysFromWeeks(blk, end, sch, TODAY, true);
  a.state.setup = { distanceKey: distKey, currentVolume: volume, planWeeks: blk.planWeeks,
    schedule: sch, benchmark: { distanceKey: '5k', timeSec: 1385 },
    goals: { A: { timeSec: 14400 } }, activeGoal: 'A', paceOverrides: {},
    lthr: null, maxHR: null, experience: 'experienced', startDate: TODAY,
    raceDate: end, hasEvent: true, purpose: 'race', supportWork: 'on' };
  return a;
}
function sequence(a){
  const weeks = [...new Set(a.state.days.map(d => d.week))].filter(Boolean).sort((x, y) => x - y);
  const out = [];
  weeks.forEach(w => (a.supportForWeek(w) || []).forEach(it =>
    out.push({ week: w, kind: it.kind, variant: it.variant, dayId: it.dayId })));
  return out;
}

test('every variant is the SAME session by every number a gate reads', () => {
  const a = plan('full', 51, 16);
  a.SUPPORT_ORDER.forEach(id => {
    const k = a.SUPPORT_KINDS[id];
    const variants = a.supportVariants(id);
    assert.ok(variants.length >= 1, id + ' must have at least its own routine');
    /* cost, minutes, label and the whole coaching disclosure live on the KIND
       and are therefore shared by construction. Stated here so that a future
       variant that tried to carry its own cost would fail rather than quietly
       reprice a week. */
    variants.forEach((v, i) => {
      assert.ok(Array.isArray(v) && v.length > 0, id + ' variant ' + i + ' is a routine');
      v.forEach(st => {
        assert.equal(typeof st.label, 'string', id + '/' + i + ' every movement is named');
        assert.equal(typeof st.qty, 'string', id + '/' + i + ' and quantified');
        assert.ok(st.label.length > 0 && st.qty.length > 0);
        assert.equal(st.cost, undefined, 'a movement may not carry its own cost');
        assert.equal(st.minutes, undefined, 'nor its own duration');
      });
      /* Equal length is the proxy for equal work that the product itself can
         check: the same number of movements, in a session whose duration and
         cost are fixed on the kind. */
      assert.equal(v.length, variants[0].length,
        id + ' variant ' + i + ' must be the same size of session as the first');
    });
    assert.ok(k.cost > 0 && k.minutes > 0);
  });
});

test('variant 0 IS the routine the product has always prescribed', () => {
  const a = plan('full', 51, 16);
  a.SUPPORT_ORDER.forEach(id => {
    /* The same array object, not a copy -- there is one definition of the
       original routine and the variant list points at it. */
    assert.equal(a.supportVariants(id)[0], a.SUPPORT_KINDS[id].steps, id);
  });
});

test('a kind held for several weeks does not repeat its routine', () => {
  /* The case this exists for: Foundation Strength across a marathon build. */
  const a = plan('full', 51, 16);
  const seq = sequence(a);
  const runs = {};
  seq.forEach(it => (runs[it.kind] = runs[it.kind] || []).push(it));
  const held = Object.keys(runs).filter(k => runs[k].length > 1);
  assert.ok(held.length > 0, 'the fixture must hold at least one kind for more than one week');
  held.forEach(k => {
    for (let i = 1; i < runs[k].length; i++)
      assert.notEqual(runs[k][i].variant, runs[k][i - 1].variant,
        k + ': weeks ' + runs[k][i - 1].week + ' and ' + runs[k][i].week +
        ' delivered the identical routine');
  });
});

test('across the population, no consecutive occurrence repeats its routine', () => {
  /* The property measured in test/audit/supportRotation.js, pinned here so a
     future change to how kinds are spaced cannot silently break it. */
  let pairs = 0, repeats = 0;
  const SCHEDULES = { 4: { activeDays: [1,3,5,6], longRunDay: 6 },
                      6: { activeDays: [0,1,2,3,4,6], longRunDay: 6 } };
  ['10k', 'half', 'full'].forEach(dk =>
    [35, 55].forEach(v =>
      [12, 20].forEach(w =>
        [4, 6].forEach(nd => {
          const a = plan(dk, v, w, SCHEDULES[nd]);
          const last = {};
          sequence(a).forEach(it => {
            if (last[it.kind] != null){ pairs++; if (last[it.kind] === it.variant) repeats++; }
            last[it.kind] = it.variant;
          });
        }))));
  assert.ok(pairs > 100, 'the population must actually contain repeats to test');
  assert.equal(repeats, 0, repeats + ' of ' + pairs + ' consecutive pairs repeated a routine');
});

test('rotation returns rather than permanently excluding a routine', () => {
  /* Variety that never came back would be exclusion by another name. */
  const a = plan('full', 51, 16);
  const seen = {};
  sequence(a).forEach(it => (seen[it.kind] = seen[it.kind] || new Set()).add(it.variant));
  Object.keys(seen).forEach(k => {
    const n = a.supportVariants(k).length;
    const held = sequence(a).filter(x => x.kind === k).length;
    if (held >= n) assert.equal(seen[k].size, n,
      k + ' appears ' + held + ' times but only ' + seen[k].size + ' of its ' + n + ' routines are used');
  });
});

test('regeneration is deterministic: the same plan prescribes the same routines', () => {
  const one = sequence(plan('full', 51, 16));
  const two = sequence(plan('full', 51, 16));
  assert.equal(JSON.stringify(one), JSON.stringify(two));
  /* And it does not depend on what the athlete has completed, which is what
     lets two devices agree without syncing the routine. */
  const a = plan('full', 51, 16);
  const before = JSON.stringify(sequence(a));
  const first = sequence(a)[0];
  const dd = a.findDay(first.dayId);
  dd.support = { kind: first.kind, completedAt: '2026-09-01T10:00:00.000Z' };
  const after = sequence(a).filter(x => x.dayId !== first.dayId);
  const beforeRest = JSON.parse(before).filter(x => x.dayId !== first.dayId);
  assert.equal(JSON.stringify(after.map(x => x.kind + ':' + x.variant)),
               JSON.stringify(beforeRest.map(x => x.kind + ':' + x.variant)),
               'a completion may steer which KIND comes next; it must not rewrite which routine');
});

test('the card shows the prescribed routine, in the unchanged card', () => {
  const a = plan('full', 51, 16);
  const seq = sequence(a);
  const kinds = {};
  seq.forEach(it => (kinds[it.kind] = kinds[it.kind] || []).push(it));
  const k = Object.keys(kinds).filter(x => kinds[x].length > 1 && a.supportVariants(x).length > 1)[0];
  assert.ok(k, 'a kind that repeats and has more than one routine');
  const first = kinds[k][0], second = kinds[k][1];
  const html = id => {
    const dd = a.findDay(id);
    a.handleToggleDay(dd.id);
    return a.renderDayCard(dd);
  };
  const h1 = html(first.dayId), h2 = html(second.dayId);
  /* Same card, same category, same duration, same coaching voice. */
  const label = a.SUPPORT_KINDS[k].label;
  [h1, h2].forEach(h => {
    assert.match(h, /support-block/);
    assert.match(h, /Supporting work/);
    assert.match(h, new RegExp(a.SUPPORT_KINDS[k].minutes + ' min'));
    assert.ok(h.indexOf(label) !== -1, 'the category is named identically');
    assert.ok(h.indexOf(a.SUPPORT_KINDS[k].why) !== -1, 'and explained identically');
  });
  /* Only the movements differ. */
  /* .join(), not deepEqual: supportVariants() returns an array built in the
     app's realm, so .map() on it produces an array whose prototype is not this
     realm's Array and deepEqual refuses it. */
  const movements = h => a.supportVariants(k).map((v, i) =>
    v.every(st => h.indexOf(st.label) !== -1) ? i : -1).filter(i => i >= 0).join(',');
  assert.equal(movements(h1), String(first.variant));
  assert.equal(movements(h2), String(second.variant));
  assert.notEqual(first.variant, second.variant);
});

test('variety did not change what any week costs', () => {
  /* The decisive proof, and it is a property of where the numbers live: cost
     and minutes are on the kind, so the week's supporting-work bill is a
     function of the kinds prescribed and nothing else. Measured over the
     sequence rather than argued. */
  const a = plan('full', 51, 16);
  const weeks = [...new Set(a.state.days.map(d => d.week))].filter(Boolean);
  const bill = weeks.map(w => (a.supportForWeek(w) || [])
    .reduce((t, it) => t + a.SUPPORT_KINDS[it.kind].cost, 0));
  const mins = weeks.map(w => (a.supportForWeek(w) || [])
    .reduce((t, it) => t + a.SUPPORT_KINDS[it.kind].minutes, 0));
  /* Force every session onto its last routine and re-price. */
  const realIndex = a.supportVariantIndex;
  a.supportVariantIndex = (id) => a.supportVariants(id).length - 1;
  try {
    assert.equal(weeks.map(w => (a.supportForWeek(w) || [])
      .reduce((t, it) => t + a.SUPPORT_KINDS[it.kind].cost, 0)).join(','), bill.join(','));
    assert.equal(weeks.map(w => (a.supportForWeek(w) || [])
      .reduce((t, it) => t + a.SUPPORT_KINDS[it.kind].minutes, 0)).join(','), mins.join(','));
  } finally { a.supportVariantIndex = realIndex; }
});

test('rotation displaced no running and moved no supporting work', () => {
  const a = plan('full', 51, 16);
  const seq = sequence(a);
  /* Placement is the gates' answer and this change may not have touched it. */
  assert.ok(seq.length > 0);
  seq.forEach(it => {
    const dd = a.findDay(it.dayId);
    assert.ok(dd.type === 'rest' || dd.type === 'easy',
      it.dayId + ': supporting work still only lands on a rest or easy day');
    assert.ok(a.supportDayEligible(dd, a.state.days.filter(d => d.week === dd.week)),
      it.dayId + ': and only where the day gate allows it');
  });
  const running = a.state.days.map(d => d.date + ':' + d.type + ':' + (d.km || 0)).join(',');
  a.supportForWeek(2); a.supportForWeek(3);
  assert.equal(a.state.days.map(d => d.date + ':' + d.type + ':' + (d.km || 0)).join(','), running,
    'asking for supporting work writes nothing to the running plan');
});
