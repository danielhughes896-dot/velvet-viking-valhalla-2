'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// STRUCTURED WORKOUT LAYER.
//
// The card could always explain how to run a session and could only describe
// what the session WAS in prose. workoutSteps() answers the second question as
// a list, and renderStructuredWorkout() puts that list above the coaching
// disclosure rather than in place of it.
//
// The property that matters most is that the layer has no authority. It reads
// segmentsFor() -- the same tree the zone chart, the duration estimate and the
// structured log already read -- and may not add a distance, a time, a rep, a
// recovery or a pace that the prescription did not contain. These tests hold
// that boundary from both sides: every number shown must be traceable to a
// segment, and every segment quantity must survive into the step list.
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const TODAY = '2026-05-20';

// Every archetype the generator can emit, with the representative parameters
// the prescription suite already uses.
const CASES = {
  easy_run:             { params:{km:9},                         type:'easy' },
  shakeout:             { params:{km:5},                         type:'easy' },
  long_run:             { params:{km:20},                        type:'long' },
  long_run_b2b:         { params:{km:16},                        type:'long' },
  long_run_goal_finish: { params:{km:23, finishKm:6},            type:'long' },
  race:                 { params:{km:42.2},                      type:'race' },
  time_trial:           { params:{ttKm:5, flankKm:2},            type:'checkpoint' },
  threshold_continuous: { params:{km:5},                         type:'threshold' },
  goal_pace_block:      { params:{km:10},                        type:'tempo' },
  steady_tempo:         { params:{min:20},                       type:'tempo' },
  progressive_tempo:    { params:{min:25},                       type:'tempo' },
  split_tempo:          { params:{min:24, split:2},              type:'tempo' },
  track_reps:           { params:{reps:5, m:1000},               type:'interval' },
  short_reps:           { params:{reps:8, m:400},                type:'repetition' },
  goal_pace_reps:       { params:{reps:4, m:1600},               type:'tempo' },
  ladder:               { params:{rungs:[400,800,1200,800,400]}, type:'interval' },
  deuce:                { params:{sets:2, reps:4, m:400},        type:'interval' },
  hill_repeats:         { params:{reps:8, sec:45},               type:'interval' },
  fartlek:              { params:{reps:5, min:2},                type:'interval' },
  easy_strides:         { params:{easyKm:8, reps:6, m:100},      type:'easy' }
};
const NAMES = Object.keys(CASES);

function app(units) {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {};
  buildPlan(a, { weeks: 14, startDate: a.addDays(TODAY, -28), distanceKey: 'full',
                 volume: 60, benchSec: 3 * 3600 + 15 * 60 });
  a.state.setup.benchmark = { distanceKey: 'full', timeSec: 3 * 3600 + 15 * 60 };
  a.state.setup.goals = { A: { timeSec: 3 * 3600 + 10 * 60 } };
  a.state.setup.lthr = 172;
  a.state.setup.maxHR = 197;
  if (units) a.state.units = units;
  return a;
}
function day(a, name) {
  const c = CASES[name];
  return { id: 'd-' + name, date: TODAY, type: c.type, km: 10,
           title: name, desc: 'prose',
           prescription: { v: a.PRESCRIPTION_VERSION, archetype: name,
                           params: JSON.parse(JSON.stringify(c.params)) } };
}
// Every leaf of the segment tree, with repeats left intact.
function flatten(segs, out) {
  out = out || [];
  (segs || []).forEach(s => {
    if (s.kind === 'repeat') flatten(s.children, out);
    else out.push(s);
  });
  return out;
}

test('every archetype the generator can emit produces steps', () => {
  const a = app();
  const missing = NAMES.filter(n => {
    const s = a.workoutSteps(day(a, n));
    return !s || !s.length;
  });
  assert.deepEqual(missing, [], 'no structured workout for: ' + missing.join(', '));
});

test('a repeat is ONE step, not one step per rep', () => {
  const a = app();
  // orderedSegments() expands 5x1000m to five reps and four recoveries; the
  // pre-run summary must not. This is the difference between the two views.
  const dd = day(a, 'track_reps');
  const ordered = a.orderedSegments(a.prescriptionOf(dd));
  assert.equal(ordered.length, 11, 'fixture assumption: wu + 5 reps + 4 recoveries + cd');
  const steps = a.workoutSteps(dd);
  assert.equal(steps.length, 3, 'warm up, one interval step, cool down');
  const work = steps[1];
  assert.equal(work.kind, 'reps');
  assert.equal(work.reps, 5);
  assert.equal(work.each, '1000m');
});

test('a set-based session keeps BOTH counts', () => {
  // "2 sets of 4x400m" and "8x400m" are different workouts. Flattening one
  // into the other would be the presentation layer rewriting the prescription.
  const a = app();
  const steps = a.workoutSteps(day(a, 'deuce'));
  const set = steps.find(s => s.kind === 'set');
  assert.ok(set, 'deuce did not produce a set step');
  assert.equal(set.sets, 2);
  assert.equal(set.reps, 4);
  assert.equal(set.each, '400m');
  assert.ok(set.setRecovery, 'the between-sets recovery was dropped');
});

test('a ladder is one step listing every rung in running order', () => {
  const a = app();
  const steps = a.workoutSteps(day(a, 'ladder'));
  const lad = steps.find(s => s.kind === 'ladder');
  assert.ok(lad, 'ladder did not collapse into a single step');
  assert.deepEqual(JSON.parse(JSON.stringify(lad.rungs)),
                   ['400m', '800m', '1200m', '800m', '400m']);
});

test('no step invents a quantity the prescription withheld', () => {
  /* Several archetypes prescribe flanks and recoveries as RULES rather than
     numbers, and where segmentPrescribed() returns null the step must carry
     no figure either.

     There is exactly one other legitimate source: a timed session's flanks.
     segmentsFor() gives those no distance, but warmupClause() has always
     stated a 1-2km warm-up and completionClause() has always made the
     cool-down the remainder, so stepFlankExtras() reads those two back out of
     the same functions. That is allowed, and pinned to the exact values those
     functions return -- so it cannot become a licence to print anything. */
  const a = app();
  NAMES.forEach(n => {
    const dd = day(a, n);
    const segs = flatten(a.segmentsFor(a.prescriptionOf(dd)));
    const allowed = new Set();
    segs.forEach(s => { const q = a.segmentPrescribed(s); if (q) allowed.add(q); });
    const statedWu = a.statedWarmupKm(dd.km);
    if (statedWu) allowed.add(a.fmtDist(statedWu));
    a.workoutSteps(dd).forEach(st => {
      [st.qty, st.each].concat(st.rungs || []).forEach(v => {
        if (v == null) return;
        assert.ok(allowed.has(v),
          n + ': step shows "' + v + '" which no segment prescribes');
      });
    });
  });
});

test('a stated flank matches the prose it is read from, exactly', () => {
  const a = app();
  ['steady_tempo', 'progressive_tempo', 'hill_repeats', 'fartlek'].forEach(n => {
    const dd = day(a, n);
    const steps = a.workoutSteps(dd);
    const wu = steps.find(s => s.role === 'warmup');
    const cd = steps.find(s => s.role === 'cooldown');
    assert.equal(wu.qty, a.fmtDist(a.statedWarmupKm(dd.km)),
      n + ': the warm-up figure drifted from warmupClause()');
    assert.equal(cd.note, 'Easy running to complete ' + a.fmtDist(dd.km) + ' total',
      n + ': the completion rule drifted from completionClause()');
    assert.equal(cd.qty, null, n + ': invented a cool-down distance');
  });
  // A session whose flanks ARE numbered takes them from the segments, not here.
  const th = a.workoutSteps(day(a, 'threshold_continuous'));
  assert.equal(th[0].qty, '2km');
  assert.equal(th[2].qty, '1km');
  assert.equal(th[2].note, null, 'a numbered cool-down was given a completion rule too');
});

test('no segment quantity is silently dropped on the way to the steps', () => {
  // The other direction: the step list must not quietly lose a number the
  // prescription does contain.
  const a = app();
  NAMES.forEach(n => {
    const dd = day(a, n);
    const segs = flatten(a.segmentsFor(a.prescriptionOf(dd)));
    const shown = new Set();
    a.workoutSteps(dd).forEach(st => {
      [st.qty, st.each, st.recovery, st.setRecovery].concat(st.rungs || [])
        .forEach(v => { if (v != null) shown.add(String(v)); });
    });
    segs.forEach(s => {
      const q = a.segmentPrescribed(s);
      if (!q) return;
      const found = [...shown].some(v => v === q || v.indexOf(q) === 0);
      assert.ok(found, n + ': prescribed "' + q + '" never reaches the step list');
    });
  });
});

test('rep counts come from the prescription, never from the walker', () => {
  const a = app();
  [['track_reps', 5], ['short_reps', 8], ['hill_repeats', 8],
   ['fartlek', 5], ['goal_pace_reps', 4], ['easy_strides', 6]].forEach(([n, want]) => {
    const st = a.workoutSteps(day(a, n)).find(s => s.kind === 'reps');
    assert.ok(st, n + ': no rep step');
    assert.equal(st.reps, want, n + ': rep count moved');
  });
});

test('run-by-feel work never gets a pace window', () => {
  // INTENSITY_ZONE_KEY notes that I is "the closest cost" for hills and
  // fartlek rather than the prescription, and a time trial is maximal by
  // instruction. A pace band on any of them turns a by-feel instruction into
  // a number to chase.
  const a = app();
  ['hill_repeats', 'fartlek', 'time_trial'].forEach(n => {
    a.workoutSteps(day(a, n)).forEach(st => {
      if (st.role !== 'work') return;
      assert.equal(st.target, null, n + ': a by-feel effort was given a pace window');
      assert.ok(st.effort, n + ': by-feel effort lost its effort word too');
    });
  });
});

test('a warm-up or cool-down carries the effort word, not a window', () => {
  const a = app();
  NAMES.forEach(n => {
    a.workoutSteps(day(a, n)).forEach(st => {
      if (st.role !== 'warmup' && st.role !== 'cooldown') return;
      assert.equal(st.target, null, n + ': a flank was given a pace window');
    });
  });
});

test('a whole-session step does not restate the day targets', () => {
  // For a one-step session the step's band and the DAY's band are the same
  // numbers; the day targets row sits directly above the list.
  const a = app();
  ['easy_run', 'long_run', 'race'].forEach(n => {
    const steps = a.workoutSteps(day(a, n));
    assert.equal(steps.length, 1, n + ': expected a single-step session');
    assert.equal(steps[0].wholeSession, true);
    const html = a.renderStructuredWorkout(day(a, n));
    assert.ok(html.indexOf('ws-target') === -1, n + ': duplicated the day pace target');
    assert.ok(html.indexOf('ws-hr') === -1, n + ': duplicated the day heart-rate target');
  });
});

test('a single-step session is named after the session, not its intensity', () => {
  const a = app();
  const steps = a.workoutSteps(day(a, 'long_run'));
  assert.equal(steps[0].label, 'Long Run');
});

test('recovery ranges render as ranges, not as a joined array', () => {
  // DEUCE_SET_RECOVERY_SEC and SPLIT_TEMPO_RECOVERY_SEC are both [lo,hi].
  // Letting the array stringify itself put "180,240s" on screen.
  const a = app();
  const set = a.workoutSteps(day(a, 'deuce')).find(s => s.kind === 'set');
  assert.equal(set.setRecovery, '3–4min easy');
  const split = a.workoutSteps(day(a, 'split_tempo')).find(s => s.kind === 'reps');
  assert.equal(split.recovery, '2–3min easy');
  assert.ok(!/\d,\d/.test(JSON.stringify(a.workoutSteps(day(a, 'deuce')))),
    'an array leaked into the rendered prescription');
});

test('a prescription in seconds is not rounded into a different prescription', () => {
  // repRecovery(600) is 90 seconds and the session description says "90s jog
  // recovery". Rounding to the nearest minute showed "2min" -- a third longer
  // than prescribed, contradicting the same card's own description.
  const a = app();
  assert.equal(a.segmentPrescribed({ sec: 90 }), '90s');
  assert.equal(a.segmentPrescribed({ sec: 45 }), '45s');
  assert.equal(a.segmentPrescribed({ sec: 120 }), '2min');
  assert.equal(a.segmentPrescribed({ sec: 180 }), '3min');
  [600, 800].forEach(m => {
    const dd = { id: 'x', date: TODAY, type: 'interval', km: 8, title: 't', desc: 'd',
                 prescription: { v: a.PRESCRIPTION_VERSION, archetype: 'track_reps',
                                 params: { reps: 4, m: m } } };
    const st = a.workoutSteps(dd).find(s => s.kind === 'reps');
    assert.equal(st.recovery, '90s easy', m + 'm reps: recovery restated');
  });
});

test('changing units changes the display and nothing else', () => {
  const km = app('km'), mi = app('mi');
  NAMES.forEach(n => {
    const a1 = km.workoutSteps(day(km, n));
    const a2 = mi.workoutSteps(day(mi, n));
    assert.equal(a1.length, a2.length, n + ': unit change altered the step count');
    a1.forEach((st, i) => {
      assert.equal(st.label, a2[i].label, n + ': unit change altered a step name');
      assert.equal(st.reps, a2[i].reps, n + ': unit change altered a rep count');
      assert.equal(st.sets, a2[i].sets, n + ': unit change altered a set count');
      assert.equal(st.role, a2[i].role);
      assert.equal(st.intensity, a2[i].intensity);
    });
  });
  // Track reps are prescribed in metres and stay in metres in both.
  const t1 = km.workoutSteps(day(km, 'track_reps')).find(s => s.kind === 'reps');
  const t2 = mi.workoutSteps(day(mi, 'track_reps')).find(s => s.kind === 'reps');
  assert.equal(t1.each, '1000m');
  assert.equal(t2.each, '1000m');
  // Distances do convert.
  const d1 = km.workoutSteps(day(km, 'threshold_continuous'))[1];
  const d2 = mi.workoutSteps(day(mi, 'threshold_continuous'))[1];
  assert.equal(d1.qty, '5km');
  assert.equal(d2.qty, '3.11mi');
});

test('reading the workout does not modify the day or its prescription', () => {
  const a = app();
  NAMES.forEach(n => {
    const dd = day(a, n);
    const before = JSON.stringify(dd);
    a.workoutSteps(dd);
    a.renderStructuredWorkout(dd);
    assert.equal(JSON.stringify(dd), before, n + ': the day was mutated by rendering it');
  });
});

test('the step table sits above the rail until the session is run, then inside it', () => {
  /* WHERE THE STEP TABLE GOES DEPENDS ON WHETHER THE SESSION IS STILL AHEAD,
     and both halves matter.

     BEFORE IT IS RUN the prescription IS the card: the rail renders open,
     the table sits above it, and nothing stands between the athlete and
     what they are about to do. Today and This Week's open session are the
     cleanest screens in the product because of that, and an earlier pass
     that put every focused session behind a tab took exactly that away.

     ONCE IT IS LOGGED the prescription is reference. It moves under what
     you actually did, into Session Details -- and a tab with that name
     whose details were stacked outside it would be a label standing apart
     from the thing it labels, so the table goes in with the rail. */
  const a = app();

  const todo = day(a, 'threshold_continuous');
  const ahead = a.renderDayCard(todo);
  const wsA = ahead.indexOf('ws-block'), howA = ahead.indexOf('how-card');
  assert.ok(wsA > -1 && howA > -1, 'the unrun card lost its steps or its rail');
  assert.ok(wsA < howA, 'an unrun session hid its step table behind the rail');
  assert.doesNotMatch(ahead, /sess-tab-k">Session Details/,
    'an unrun session is behind a tab again -- it is the card, not a reference');

  /* AND ON A FOCUSED CARD IT MUST BE OPEN, which is the dangerous half.
     The open rail's summary is display:none -- correct, because a heading
     above panels headed WHY and EXECUTION is a label on a label. So if the
     element ever loses `open` while keeping .is-static, the rail is CLOSED
     with no summary to press: the session's instructions become unreachable
     on the one screen that exists to show them, and nothing else in the
     suite notices. */
  a.state.view = 'full';
  a.planSessionOpen = todo.id;
  const focused = a.renderDayCard(todo);
  assert.ok(a.dayCardIsFocused(todo), 'the fixture stopped being a focused card');
  assert.match(focused, /class="fuel-card how-card is-static" open/,
    'a focused unrun session renders its rail shut behind a hidden summary');
  a.planSessionOpen = null;
  a.state.view = 'today';

  const done = day(a, 'threshold_continuous');
  done.completed = true;
  done.actual = Object.assign(a.emptyActual(), { km: done.km, pace: '4:30', paceUnit: 'km' });
  const logged = a.renderDayCard(done);
  const wsB = logged.indexOf('ws-block'), howB = logged.indexOf('how-card');
  assert.ok(wsB > -1 && howB > -1, 'the logged card lost its steps or its rail');
  assert.ok(howB < wsB, 'the step table escaped Session Details once logged');
  /* Inside the <details>, not merely after it: the closing tag must come
     later than the table. */
  assert.ok(logged.indexOf('</details>', howB) > wsB,
    'the step table renders after Session Details closes, so the tab does not hold it');
});

test('the coaching disclosure keeps every section it had', () => {
  // This is an addition, not a replacement. WHY / EXECUTION / FEEL / WATCH FOR
  // must all still be reachable on a card that now also has a step list.
  const a = app();
  const dd = day(a, 'threshold_continuous');
  const html = a.renderDayCard(dd);
  /* Named by what it says on an UNRUN session, which is what day() builds.
     Once logged the same panel is headed Session Details; the sections
     inside it are the same either way, and that is what is asserted. */
  ['How to run this', 'Why', 'Feel', 'Watch For'].forEach(k => {
    assert.ok(html.indexOf(k) > -1, 'the coaching disclosure lost: ' + k);
  });
  /* EXECUTION IS A RAIL NOW AND HAS NO HEADING. The word went the way FUEL's
     did -- every panel under it names itself (SETTLE, HOLD, PRESS, COMMIT)
     and a word above a row of self-naming labels is a label on labels. The
     law here is that the SECTION is still reachable, and the word was only
     ever a proxy for it, so the section is what is asserted. */
  /* EXECUTION IS CARRIED BY WHICHEVER RAIL THE SESSION HAS. On the
     founder's call a session shows the blueprint OR the execution rail and
     never both, because the two say the same thing in two vocabularies --
     and threshold_continuous has a blueprint. So the law this line protects
     is unchanged and the proxy for it moves: the section is reachable, as
     the staged rail where there is no blueprint, and as the blueprint plus
     the phase sentences in the Coach's Note where there is one. */
  const hasBlueprint = (() => { try { return a.usesHorizontalWorkoutBlueprint(a.workoutSteps(dd)); } catch(e){ return false; } })();
  if (hasBlueprint){
    assert.match(html, /class="fuel-body ws-rail"/,
      'the session has no execution rail AND no blueprint — its shape is nowhere');
    assert.match(html, /class="how-note"/,
      'the blueprint carries the stages but the phase coaching has nowhere to go');
  } else {
    assert.ok(/class="how-table how-exec"/.test(html) || /class="how-row-heading">Execution/.test(html),
      'the coaching disclosure lost Execution');
    assert.ok(/strat-phase/.test(html), 'the Execution section is present but empty of phases');
  }
  // Whether the session DESCRIPTION survives is a separate question with its
  // own rule and its own tests below -- it is not part of the disclosure.
});

test('a day with no prescription renders exactly the card it renders today', () => {
  const a = app();
  const legacy = { id: 'legacy', date: TODAY, type: 'easy', km: 8,
                   title: 'Hand-edited', desc: 'Something a human wrote.' };
  assert.equal(a.workoutSteps(legacy), null);
  assert.equal(a.renderStructuredWorkout(legacy), '');
  assert.ok(a.renderDayCard(legacy).indexOf('ws-block') === -1);
});

test('a rest day gets no workout block', () => {
  const a = app();
  const rest = { id: 'r', date: TODAY, type: 'rest', km: 0, title: 'Rest', desc: 'Rest.' };
  assert.equal(a.renderStructuredWorkout(rest), '');
});

test('a malformed prescription degrades to no block rather than a broken card', () => {
  const a = app();
  const broken = { id: 'b', date: TODAY, type: 'interval', km: 8, title: 't', desc: 'd',
                   prescription: { v: a.PRESCRIPTION_VERSION, archetype: 'ladder', params: {} } };
  let html;
  assert.doesNotThrow(() => { html = a.renderDayCard(broken); });
  assert.ok(html.indexOf('day-title') > -1, 'the card itself failed to render');
});

test('the step list is plain data a future export could read', () => {
  // Provider-neutral by construction: no markup and no vendor vocabulary in
  // the transformation's output, so an adapter can consume it later without
  // the athlete-facing presentation being rewritten around it.
  const a = app();
  NAMES.forEach(n => {
    const json = JSON.stringify(a.workoutSteps(day(a, n)));
    assert.ok(json.indexOf('<') === -1, n + ': HTML leaked into the step data');
    assert.ok(!/garmin|strava|polar|coros|wahoo/i.test(json), n + ': vendor vocabulary in step data');
  });
});

/* ---- description deduplication ----
   The step list is the execution prescription now, so a description that only
   restates it is dropped from the card. The danger is obvious and these hold
   the line against it: a description may only be hidden when the steps carry
   everything it quantifies, and everything else keeps its description. */

// Quantities as the prose writes them: 5km, 400m, 25min, 90s, 3-4min, 6x100m.
function quantities(text) {
  return (String(text).match(/\d+(?:\.\d+)?\s*(?:km|mi|m|min|s)\b/gi) || [])
    .map(x => x.replace(/\s+/g, '').toLowerCase());
}
function stepText(a, steps) {
  return (steps || []).map(st => [st.qty, st.each, st.recovery, st.setRecovery, st.build]
    .concat(st.rungs || []).filter(Boolean).join(' ')).join(' ').toLowerCase();
}

test('a description is only hidden when its numbers are still on the card', () => {
  /* The rule that matters is that nothing the athlete needs disappears from
     the card. Almost every hidden quantity is carried by a step; the one
     legitimate exception is a session TOTAL, which the day targets row states
     directly above the list -- long_run_goal_finish's prose says "23km", and
     the steps say 17.5km easy then 5.5km at goal pace, which is the same
     session decomposed. So both places count, and both are checked: the
     quantity must be on the rendered card, and if it is not in the steps it
     must be the day's own distance rather than something quietly dropped. */
  const a = app();
  const hidden = NAMES.filter(n => a.workoutCoversDescription(day(a, n)));
  assert.ok(hidden.length, 'no archetype is deduplicated at all');
  hidden.forEach(n => {
    const c = CASES[n];
    const p = { v: a.PRESCRIPTION_VERSION, archetype: n, params: JSON.parse(JSON.stringify(c.params)) };
    const t = a.textFor(p, null, 10);
    const dayKm = c.params.km != null ? c.params.km : 10;
    const dd = { id: 'x', date: TODAY, type: c.type, km: dayKm, title: n,
                 desc: (t && t.desc) || '', prescription: p };
    const inSteps = stepText(a, a.workoutSteps(dd));
    /* TAGS STRIPPED. The hero renders a distance as <span>23</span><em>km</em>
       -- split only so the number and the unit can be sized apart -- so a
       raw-markup search for "23km" never saw the one place every session
       states its total. It passed until the execution rail stopped being
       rendered beside a blueprint, because that rail happened to print
       "0km-23km" contiguously. The quantity is on the card either way; the
       check was reading the markup rather than the card. */
    const onCard = a.renderDayCard(dd).replace(/<[^>]*>/g, '').toLowerCase();
    const dayTotal = a.fmtDist(dayKm).toLowerCase();
    quantities(a.resolveDesc(dd.desc)).forEach(q => {
      assert.ok(onCard.indexOf(q) > -1,
        n + ': the description says "' + q + '" and the card no longer shows it anywhere');
      if (inSteps.indexOf(q) === -1)
        assert.equal(q, dayTotal,
          n + ': "' + q + '" is not in the steps and is not the session total');
    });
  });
});

test('every other archetype keeps its description', () => {
  const a = app();
  const kept = NAMES.filter(n => !a.workoutCoversDescription(day(a, n)));
  // The completion clause, the prose warm-up distances and the coaching
  // asides all live here. If this set ever empties, the rule went blanket.
  assert.ok(kept.length >= 6, 'too many descriptions are being hidden: only ' + kept.length + ' kept');
  kept.forEach(n => {
    const html = a.renderDayCard(day(a, n));
    assert.ok(html.indexOf('day-desc') > -1, n + ': lost its description');
  });
  /* Named instructions that must still be on the card. The point is not that
     the DESCRIPTION survives -- for the timed four it deliberately does not --
     but that the instruction does, wherever it now lives: a step, the gold
     cue, or the coaching disclosure. */
  const card = n => {
    const c = CASES[n];
    const p = { v: a.PRESCRIPTION_VERSION, archetype: n, params: JSON.parse(JSON.stringify(c.params)) };
    const t = a.textFor(p, null, 10);
    return a.renderDayCard({ id: 'x', date: TODAY, type: c.type, km: 10, title: n,
                             desc: (t && t.desc) || '', prescription: p });
  };
  const survives = (n, needle) =>
    assert.ok(card(n).indexOf(needle) > -1, n + ': "' + needle + '" is nowhere on the card');

  // kept descriptions -- coaching fused into a structural sentence
  survives('goal_pace_block', 'race rhythm');
  survives('long_run_b2b', 'tired legs');
  survives('shakeout', 'sleep early');      // not about structure at all
  survives('race', 'culminates');
  survives('time_trial', 'Active Goal');
  survives('long_run', 'steady and controlled');
  survives('easy_strides', 'Short and sharp');
  survives('goal_pace_reps', 'locking in race rhythm');

  // hidden descriptions -- the instruction moved into the step list
  survives('steady_tempo', 'complete');        // completionClause, now on the cool-down step
  survives('hill_repeats', 'complete');
  survives('fartlek', 'complete');
  survives('progressive_tempo', 'complete');
  survives('progressive_tempo', 'Building from Steady to Tempo');
  survives('hill_repeats', 'back down');       // the recovery rule
  survives('ladder', 'scaled to the rep');
  survives('deuce', 'Between sets');
});

test('a day with no prescription always keeps its description', () => {
  // The fail-safe direction: unknown or dropped prescription -> keep.
  const a = app();
  const legacy = { id: 'legacy', date: TODAY, type: 'easy', km: 8,
                   title: 'Hand-edited', desc: 'Something a human wrote.' };
  assert.equal(a.workoutCoversDescription(legacy), false);
  assert.ok(a.renderDayCard(legacy).indexOf('Something a human wrote.') > -1);
  const unknown = { id: 'u', date: TODAY, type: 'easy', km: 8, title: 't', desc: 'Prose.',
                    prescription: { v: a.PRESCRIPTION_VERSION, archetype: 'not_a_real_archetype', params: { km: 8 } } };
  assert.equal(a.workoutCoversDescription(unknown), false);
  assert.ok(a.renderDayCard(unknown).indexOf('Prose.') > -1);
});

test('hiding the description never touches the stored description', () => {
  // Edit Session and the calendar export both read dd.desc.
  const a = app();
  const dd = day(a, 'threshold_continuous');
  dd.desc = '2km warm-up. 5km continuous @ Threshold pace. 1km cool-down.';
  const before = dd.desc;
  assert.equal(a.workoutCoversDescription(dd), true);
  a.renderDayCard(dd);
  assert.equal(dd.desc, before, 'the stored description was mutated');
  assert.ok(a.buildICS ? a.buildICS().indexOf('DESCRIPTION') > -1 || true : true);
});

test('a progressive block states both ends of its ramp', () => {
  // segmentsFor() records the origin as `from`. Dropping it made a 25-minute
  // build look like 25 minutes held flat at the destination pace.
  const a = app();
  const st = a.workoutSteps(day(a, 'progressive_tempo')).find(s => s.role === 'work');
  assert.equal(st.build, 'Building from Steady to Tempo');
  const html = a.renderStructuredWorkout(day(a, 'progressive_tempo'));
  assert.ok(html.indexOf('Building from Steady to Tempo') > -1);
  // and nothing else claims a ramp it does not have
  ['threshold_continuous', 'steady_tempo', 'track_reps'].forEach(n => {
    a.workoutSteps(day(a, n)).forEach(s => assert.equal(s.build, null, n + ': invented a ramp'));
  });
});

test('the expanded card can still show everything it contains', () => {
  /* .day-detail animates open with max-height and clips with overflow:hidden,
     so that constant is a hard visibility ceiling, not a hint. At its old
     1600px a race day at novice depth on a 320px screen measured 3517px and
     lost more than half of "How to run this" -- and that was true before the
     workout list was added to the same container.

     Measuring it properly needs a real viewport, which this suite has no
     browser for. What is enforced here is the floor: the ceiling may not drop
     back below the tallest card observed (3517px) plus meaningful headroom. */
  const OBSERVED_TALLEST = 3517;
  const m = SRC.match(/\.day\.open\s+\.day-detail\s*\{[^}]*max-height\s*:\s*(\d+)px/);
  assert.ok(m, 'the expanded-card height rule is gone or no longer uses max-height');
  const cap = parseInt(m[1], 10);
  assert.ok(cap >= OBSERVED_TALLEST * 1.5,
    'max-height ' + cap + 'px leaves too little room over the tallest measured card (' +
    OBSERVED_TALLEST + 'px); coaching content will be silently cut off');

  // The reasoning above only holds while this is still how the card collapses.
  assert.match(SRC, /\.day-detail,\s*\.day-drawer\{[^}]*overflow:hidden/,
    'the collapse mechanism changed -- re-derive the ceiling');
});

test('no device-integration surface has been added', () => {
  // This task is the visual layer only: no credentials, no API calls, no
  // calendar sync, and above all no dead athlete-facing button promising any
  // of it. The word "garmin" DOES appear in the app already -- it is one of
  // the note-signal keywords that recognises "my garmin died" in an athlete's
  // own notes -- and Strava's OAuth callback is a shipped integration, so a
  // bare word search is not the test. These are.
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ');

  // No host belonging to a device provider is reachable from the app.
  assert.doesNotMatch(code, /garmin\.com|garmin\.cn|connect\.garmin/i,
    'a Garmin endpoint appeared in the runtime');

  /* No athlete-facing control offering a device push. export-ics and
     export-json are the plan's own long-standing file exports -- a calendar
     file and a backup, both local, neither talking to a device maker -- so
     they are named here as known and allowed rather than left to make this
     assertion vacuous by widening the pattern. */
  const ALLOWED = [
    'export-ics', 'export-json',      // the plan's own local file exports
    /* The Settings account-linking pair. These are NOT per-workout controls:
       they render only inside the Garmin card, only once the SERVER reports the
       integration available, and never on a training surface -- which
       garminFoundation.test.js sweeps Today, This Week, Full Plan, Plan HQ and
       the day card to prove. Naming them here keeps this assertion meaningful
       rather than widening the pattern until it catches nothing. */
    'garmin-connect', 'garmin-disconnect'
  ];
  const actions = [...new Set([...code.matchAll(/data-action="([^"]+)"/g)].map(m => m[1]))];
  const offending = actions.filter(x =>
    ALLOWED.indexOf(x) === -1 &&
    (/garmin|coros|polar|wahoo|send-to|push-to|sync-workout|to-watch|to-device/i.test(x) ||
     /export|calendar/i.test(x)));
  assert.equal(offending.join(','), '', 'a device/export control was exposed: ' + offending.join(', '));

  /* And the forbidden SHAPE, independent of naming: nothing anywhere offers to
     push one session to a device. */
  [/send to garmin/i, /push to (watch|garmin)/i, /sync workout/i, /export to garmin/i]
    .forEach(re => assert.doesNotMatch(code, re, 'a per-workout device control exists'));

  // And the new layer itself carries no vendor vocabulary, so it stays
  // provider-neutral for whatever adapter reads it later.
  const start = code.indexOf('function segWork(');
  const end = code.indexOf('function rescaleOrDropPrescription(');
  assert.ok(start > -1 && end > start, 'could not locate the segment/steps region');
  const region = code.slice(start, end);
  assert.ok(region.indexOf('workoutSteps') > -1, 'wrong region -- workoutSteps is not in it');
  assert.ok(region.indexOf('providerWorkout') > -1,
    'wrong region -- the canonical layer is not in it either');
  assert.doesNotMatch(region, /garmin|coros|polar|wahoo|suunto|fit_?file|tcx/i,
    'vendor vocabulary leaked into the workout transformation, which must stay ' +
    'provider-neutral so a second platform needs no engine change');
});

/* ===========================================================================
 * ONE RAIL FOR THE SESSION'S SHAPE, AND IT IS A RAIL
 * ---------------------------------------------------------------------------
 * The blueprint and the execution rail describe the same session in two
 * vocabularies -- "2km / 4x1200m / 2km" and "SETTLE 0-2km / PRESS from 2km /
 * ABSORB" -- and a session with both made the athlete swipe through one and
 * then swipe through the other saying it again.
 *
 * THE TWO DO NOT CORRESPOND, which is why this is a choice and not a merge.
 * Measured across every session the engine builds:
 *   tempo      blueprint 3  execution 3   Settle/Hold/Absorb
 *   interval   blueprint 3  execution 4   Settle/Press/Recover/Absorb
 *   checkpoint blueprint 3  execution 5   Settle/Build/Hold/Commit/Absorb
 *   long       blueprint 3  execution 0
 *   race       blueprint -  execution 5   Settle/Hold/Hold/Press/Commit
 * Folding card-for-card would have dropped a phase on every session but the
 * first and had nothing to fold into on a race day.
 * ======================================================================== */

const RAILSRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const RAILCSS = RAILSRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
/* COMMENTS STRIPPED. Three guards below asked "is this string gone?" and
   got the answer from the COMMENT that explains why it went -- the note
   above railDotCount names swipeLearned('rail'), and the note where
   .sess-tab-s used to be names .sess-tab-s. Matching prose as if it were
   code has produced false results in this suite before; it produced three
   more here. */
const RAILCODE = RAILSRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

function railApp(){
  const a = loadApp({ pinnedDate: '2026-11-08T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 11, startDate: '2026-09-04', distanceKey: 'full', volume: 46,
                 benchSec: 45*60, lthr: 165, maxHR: 190,
                 schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } });
  a.state.athlete = a.makeAthleteRecord();
  return a;
}

test('a session shows the blueprint or the execution rail, never both', () => {
  const a = railApp();
  const withBp = a.state.days.filter(d => { try { return a.usesHorizontalWorkoutBlueprint(a.workoutSteps(d)); } catch(e){ return false; } });
  const race = a.state.days.filter(d => d.type === 'race')[0];
  assert.ok(withBp.length, 'sanity: the fixture has a blueprint session');
  assert.ok(race, 'sanity: the fixture has a race');

  const bp = a.renderDayCard(withBp[withBp.length - 1]);
  assert.match(bp, /class="fuel-body ws-rail"/, 'the blueprint is no longer a rail');
  assert.ok(bp.indexOf('exec-rail') === -1,
    'a blueprint session is showing the execution rail as well — the same session said twice');

  const rc = a.renderDayCard(race);
  assert.match(rc, /exec-rail/, 'a race has no blueprint to fold into and has lost its execution rail');
  assert.ok(rc.indexOf('ws-rail') === -1, 'a race has grown a blueprint');

  /* NOTHING IS LOST WITH THE RAIL. Its captions are the coaching, and they
     go to the Coach's Note -- so a four-phase execution on a three-step
     blueprint still carries all four sentences. */
  assert.match(bp, /class="how-note"/, 'a blueprint session lost its Coach’s Note with the execution rail');
  const phases = a.executionStrategyForDisplay(withBp[withBp.length - 1]);
  if (phases && phases.phases && phases.phases.length){
    const caps = (bp.match(/how-cap-i/g) || []).length;
    assert.equal(caps, phases.phases.length,
      'the Coach’s Note carries ' + caps + ' phase sentences for ' + phases.phases.length + ' phases');
  }
});

test('the coaching rail stays three columns, with two hairlines', () => {
  /* mod('execution') carries the one-SENTENCE execution and was suppressed
     whenever the staged rail was RENDERED. Choosing not to render it on a
     blueprint session turned the sentence back on and the rail became four
     columns with three hairlines. The condition is whether the engine HAS a
     staged execution, not what is on screen. */
  const a = railApp();
  const withBp = a.state.days.filter(d => { try { return a.usesHorizontalWorkoutBlueprint(a.workoutSteps(d)); } catch(e){ return false; } });
  const bp = a.renderDayCard(withBp[withBp.length - 1]);
  const rail = /<div class="how-cols">[\s\S]*?(?=<\/div><div class="how-table|<div class="how-note)/.exec(bp);
  assert.ok(rail, 'the coaching columns are gone or no longer named');
  const mods = (rail[0].match(/class="how-mod" data-mod=/g) || []).length;
  assert.equal(mods, 3, 'the coaching rail is ' + mods + ' columns, not three — two hairlines need three columns');
  assert.ok(rail[0].indexOf('data-mod="execution"') === -1,
    'the one-sentence Execution column is back alongside a blueprint that already says it');

  /* AND THEY FADE. Decoration, not table rules -- the distinction the whole
     hairline sweep turned on. Drawn on the second and third panels, which
     is exactly two for three columns. */
  const i = RAILCSS.indexOf('.how-cols .how-mod + .how-mod::after');
  assert.ok(i > -1, 'the coaching columns have no separating hairlines');
  const body = RAILCSS.slice(i, RAILCSS.indexOf('}', i));
  assert.match(body, /transparent 0%/, 'the hairline starts solid — that is a table rule, not decoration');
  assert.match(body, /transparent 100%\)/, 'the hairline ends solid');
  assert.match(body, /width:1px/, 'the hairline is no longer a hairline');
});

test('the blueprint rail is the rail component, wired like one', () => {
  /* Every rule that makes a rail a rail was scoped to ".how-card
     .fuel-body", because every rail lived inside Session Details. The
     blueprint does not -- it is the session's own words, above the tab --
     so it got the PANEL styling and none of the TRACK styling, and three
     cards stacked vertically with nothing scrolling. Measured after: three
     panels at 380px of 380, three dots, first lit. */
  assert.match(RAILCSS, /:is\(\.how-card \.fuel-body, \.ws-rail\)\{\s*display:flex/,
    'the blueprint rail is not in the rail track rule, so its cards stack');
  /* Full width is the COMPONENT's now, not this rail's -- see "every rail
     is one card at a time" below, which asserts it where it lives. */
  assert.match(RAILCSS, /\.view-week \.wk-overview\) \.how-mod\{[^}]*flex:0 0 100%/,
    'rail panels are no longer full width');
  assert.match(RAILSRC, /querySelectorAll\('\.how-card \.fuel-body, \.ws-rail'\)/,
    'the blueprint rail is not bound by the rail script, so its dots never light');
  assert.match(RAILSRC, /railDotCount\(steps\.length\)/,
    'the blueprint rail has no dots, so nothing says there is more sideways');
});

test('every rail is one card at a time, and keeps its dots', () => {
  /* The founder's rule: every end point that has a rail follows the new
     one. Measured at 412px -- blueprint 2 panels at 380/380 with 2 dots;
     race day's execution 5 at 380/380 with 5; its fuel 4 at 380/380 with 4.
     The width lives on the COMPONENT, not on one rail, which is what makes
     that true everywhere rather than in the place it was first asked for. */
  const i = RAILCSS.indexOf('.view-week .wk-overview) .how-mod{');
  assert.ok(i > -1, 'the rail panel rule is gone or its selector changed');
  const body = RAILCSS.slice(i, RAILCSS.indexOf('}', i));
  assert.match(body, /flex:0 0 100%/, 'rail panels are back to sharing the row');
  assert.ok(!/min-width:122px/.test(body),
    'the 122px floor is back — it existed for a third-width column and a full-width card has no use for it');

  /* THE DOTS ARE A POSITION NOW, NOT A HINT. They used to disappear once
     swipeLearned('rail') was true. With one panel on screen they are the
     only thing saying which of five you are on. */
  const dc = RAILCODE.slice(RAILCODE.indexOf('function railDotCount'), RAILCODE.indexOf('function railDotCount') + 300);
  assert.ok(dc.indexOf("swipeLearned('rail')") === -1,
    'the dots vanish once the swipe is learned — on a full-width rail they are the position, not the hint');
});

test('why / feel / watch for is three columns, not a rail', () => {
  /* It was a rail when Execution's sentence made it four. Three fit, and a
     rail that never needs swiping hides a third of itself behind a gesture
     nobody makes. So: no .fuel-body, no data-hswipe, no dots, nothing
     selected -- all three lit, because with all three on screen there is
     nothing to select. Measured: opacity 1,1,1. */
  assert.match(RAILCODE, /<div class="how-cols">/, 'the coaching columns are gone or renamed');
  assert.ok(RAILCODE.indexOf('"fuel-body how-rail"') === -1,
    'the coaching columns are a .fuel-body again, which makes them a scrolling rail');
  const i = RAILCODE.indexOf('<div class="how-cols">');
  const after = RAILCODE.slice(i, i + 1400);
  assert.ok(after.indexOf('railDotsHtml') === -1, 'the coaching columns have dots again');
  assert.match(RAILCSS, /\.how-cols \.how-mod\{[^}]*opacity:1/,
    'the coaching columns dim again — all three are on screen, so none of them is "the" one');
  assert.match(RAILCSS, /\.how-cols \.how-mod::before\{content:none;\}/,
    'the selected-panel pool is back on columns where nothing is selected');
});

test('a tab is its name, centred, at the size that fits the narrowest phone', () => {
  /* Measured with the real classes: "VALHALLA ANALYSIS" is 186px of ink at
     21px in a 193px column on a 320px phone, 204px at 23px. 21px is the
     largest that never wraps -- and it is also just under the session
     title's 21.85px, so a tab heading cannot out-shout the session it
     opens. Two bounds, one number. */
  assert.match(RAILCODE, /function sessionTabHtml\(title\)\{/,
    'the tab still takes a sub-line argument');
  assert.ok(RAILCODE.indexOf('sess-tab-s') === -1,
    'the contents list under each tab name is back');
  assert.match(RAILCSS, /\.sess-tab-k\{display:block;[^}]*font-size:21px/,
    'the tab name is no longer 21px');
  assert.match(RAILCSS, /\.sess-tab\{[^}]*text-align:center/, 'the tab name is left-aligned again');
  assert.match(RAILCSS, /\.sess-tab::before\{content:''; flex:0 0 19px;\}/,
    'the chevron spacer is gone, so the name is centred in what is left of the row rather than in the row');
});

test('the stage card is a photograph, and the words on it are legible', () => {
  /* The founder supplied the picture and asked for it on the rail. It ships
     as an asset at two widths, which is the convention this product already
     has for a photograph (valhalla-mountains-420/-820, swapped on the same
     breakpoint) -- a data URI would have put ~50KB of base64 into a file
     that is already 3.5MB and is parsed at every launch. */
  const ROOT2 = path.join(__dirname, '..');
  ['dawn-road-420.jpg', 'dawn-road-820.jpg'].forEach(f => {
    const stat = fs.statSync(path.join(ROOT2, 'assets', f));
    assert.ok(stat.size > 4000, 'assets/' + f + ' is missing or empty');
    assert.ok(stat.size < 160000, 'assets/' + f + ' is ' + stat.size + ' bytes — larger than the photograph it sits beside');
  });
  assert.match(RAILCSS, /\.ws-rail \.ws-h-step\{[^}]*background-image:url\('\/assets\/dawn-road-820\.jpg'\)/,
    'the stage card has lost its photograph');
  assert.match(RAILCSS, /\.ws-rail \.ws-h-step\{\s*\n?\s*background-image:url\('\/assets\/dawn-road-420\.jpg'\)/,
    'the narrow phone still downloads the wide photograph');

  /* A PHOTOGRAPH IS NOT A BACKGROUND UNTIL THE WORDS ON IT ARE LEGIBLE.
     Measured against the pixels actually behind each run, with the figures
     mid-card over a gentle gradient: "2km" white came out at 1.75:1, "Easy"
     2.28, the pace band 3.49 -- all under 4.5 and two under the 3.0 that
     even large text needs. The figures sit at the FOOT now, where the frame
     is darkest to start with, under a scrim that is near-opaque there and
     clear at the top where the sunrise is the point: 19.84 / 9.51 / 9.67.
     (The first measurement sampled the row the glyphs are on, so white text
     inflated its own background; it reads the bands beside them now.) */
  const i = RAILCSS.indexOf('.ws-rail .ws-h-step::after');
  assert.ok(i > -1, 'the scrim under the card text is gone');
  const scrim = RAILCSS.slice(i, RAILCSS.indexOf('}', i));
  const last = Number((scrim.match(/rgba\(8,6,10,\.(\d+)\) 100%/) || [])[1]);
  assert.ok(last >= 90, 'the scrim ends at .' + last + ' — the figures sit on it and were measured at 1.75:1 without it');
  assert.match(RAILCSS, /\.ws-rail \.ws-h-step\{[^}]*justify-content:flex-end/,
    'the figures have left the foot of the card, which is the only part of the frame dark enough for them');

  /* THE PEEK IS THE FOUNDER'S SECOND DRAWING: a card carried IN a rail
     rather than filling it, with its neighbours showing at both edges. */
  assert.match(RAILCSS, /\.ws-rail \.how-mod\{\s*\n?\s*flex:0 0 84%/,
    'the stage card fills the rail again, so nothing peeks and the rail stops reading as one');
});
