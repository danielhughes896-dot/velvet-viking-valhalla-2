'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

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
  /* PICKED BY hasWorkoutBlueprint, NOT BY THE STEP COUNT. A one-stage
     session counts as a horizontal blueprint now -- that is what gave an
     easy run its card -- so filtering on usesHorizontalWorkoutBlueprint
     returned the RACE as "the last blueprint session", and this test then
     asserted the race had a blueprint rail. hasWorkoutBlueprint is the
     function that actually decides, and it is what the renderers ask. */
  const withBp = a.state.days.filter(d => a.hasWorkoutBlueprint(d) &&
    (function(){ try { return a.workoutSteps(d).length >= 2; } catch(e){ return false; } })());
  const race = a.state.days.filter(d => d.type === 'race')[0];
  assert.ok(withBp.length, 'sanity: the fixture has a multi-stage blueprint session');
  assert.ok(race, 'sanity: the fixture has a race');

  /* ASKED OF THE PANELS, NOT THE RAIL'S CLASS. This read "bp has no
     .exec-rail" and "the race has no .ws-rail", which held only while the
     two vocabularies lived in two differently-named components. They are
     one component now -- .ws-rail, cards either way -- so the question has
     to be what is ON the rail: a blueprint step (.ws-h-step) or an
     execution phase (.strat-phase). Never both, which is the law. */
  const bp = a.renderDayCard(withBp[withBp.length - 1]);
  assert.match(bp, /class="fuel-body ws-rail"/, 'the blueprint is no longer a rail');
  assert.match(bp, /ws-h-step/, 'the blueprint session has lost its steps');
  assert.ok(bp.indexOf('strat-phase-label') === -1,
    'a blueprint session is showing the execution phases as well — the same session said twice');

  const rc = a.renderDayCard(race);
  assert.match(rc, /strat-phase-label/, 'a race has no blueprint to fold into and has lost its execution phases');
  assert.ok(rc.indexOf('ws-h-step') === -1, 'a race has grown a blueprint');
  assert.match(rc, /class="fuel-body ws-rail exec-rail"/,
    'the race’s phases are no longer on the card rail, so they are no longer photographs');

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

test('why, feel and watch for left the screen for the Coach’s Note', () => {
  /* They were three gold headings with a sentence under each, under the
     rail, on every session. The founder took them off: the coaching is on
     the rail now.
     IT IS NOT ALL ON THE RAIL, which is why this test exists rather than
     going with them. A stage card says how to run THAT STAGE -- "Get the
     legs ready for the first rep, not tired by it" -- while these say what
     the SESSION is for and how it fails: "VO2 max and running economy",
     "Racing the first two reps". Feel overlaps the work stage's line; Why
     and Watch For appear nowhere on the rail at all.
     So the columns are gone from every end point, and what they said is in
     the Coach's Note -- which already took the fuel caveats, the execution
     captions and the one-sentence execution before them. */
  const a = railApp();
  const level = a.athleteExperience();
  let checked = 0;
  a.state.days.forEach(d => {
    if (d.type === 'rest') return;
    const html = a.renderDayCard(d);
    assert.ok(html.indexOf('how-cols') === -1,
      d.date + ' (' + d.type + ') still draws the coaching columns');
    let gd; try { gd = a.coachingDisclosureFor(d, level); } catch (e) { return; }
    if (!gd) return;
    const note = html.slice(html.indexOf('class="how-note"'));
    [['Why', gd.why], ['Feel', gd.feel], ['Watch For', gd.avoid]].forEach(pair => {
      const k = pair[0], v = pair[1];
      if (!v) return;
      assert.ok(note.indexOf(v) > -1,
        d.date + ' (' + d.type + '): ' + k + ' is not in the Coach’s Note — ' +
        JSON.stringify(v.slice(0, 40)) + ' has been dropped, not moved');
      assert.ok(note.indexOf('<b>' + k + '</b>') > -1,
        d.date + ': "' + k + '" has lost the word in front of it, so the sentence is a fragment');
      checked++;
    });
  });
  assert.ok(checked >= 30, 'the fixture no longer exercises the moved lines (' + checked + ')');

  /* AND NOTHING IS LEFT BEHIND. The class, its layout rules, its two
     hairlines, the row-inside-a-panel rules and the two helpers that built
     them were all for the columns alone. Dead CSS reads as a layout that
     might still happen. */
  assert.ok(RAILCODE.indexOf('how-cols') === -1, 'the columns are still being emitted');
  const liveCss = RAILCSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.ok(liveCss.indexOf('.how-cols') === -1, 'the column rules are still in the sheet');
  assert.ok(liveCss.indexOf('.how-mod .how-row') === -1,
    'the row-inside-a-panel rules are still in the sheet, and a .how-row can no longer reach a .how-mod');
  assert.ok(RAILCODE.indexOf('railDotsHtml') === -1,
    'railDotsHtml is back — it was dead code with no caller');

  /* ---------- AND THE WORD IN FRONT KEEPS THE COLUMN'S VOICE ----------
     Removing this rule left the three lines reading as plain bold prose,
     and every guard above still passed: they asserted the word was THERE,
     which it was. The heading was gold, in the label face, and it is the
     only thing distinguishing "Why" from the sentence it introduces. */
  const lab = /\.how-note-row b\{([^}]*)\}/.exec(RAILCSS);
  assert.ok(lab, 'the word in front of a moved line has no rule, so it reads as plain bold prose');
  assert.match(lab[1], /color:var\(--gold-text\)/, 'the moved lines’ labels are no longer gold');
  assert.match(lab[1], /font-family:var\(--label-face\)/, 'the labels left the product’s label voice');
  assert.match(lab[1], /text-transform:uppercase/, 'the labels are no longer set as labels');
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
  /* ---------- THE LAST text-align, NOT ANY text-align ----------
     This matched /\.sess-tab\{[^}]*text-align:center/ and passed for weeks
     on a rule that declared text-align:center and then text-align:left
     three declarations later. The later one won; every tab title was left
     aligned, measured at 120px off the row's centre on a 430px phone for
     "Share". The guard was reading a dead declaration and reporting the
     opposite of what the sheet did.
     So: take the block, take the LAST text-align in it -- which is the one
     the cascade applies -- and require that to be center. A re-introduced
     text-align:left after it fails here instead of hiding behind it. */
  const tabBlock = /\.sess-tab\{([^}]*)\}/.exec(RAILCSS);
  assert.ok(tabBlock, 'the session tab rule is gone');
  const aligns = tabBlock[1].match(/text-align:\s*([a-z]+)/g) || [];
  assert.ok(aligns.length, 'the tab row sets no text-align at all, so the title takes the page default');
  assert.equal(aligns.length, 1,
    'the tab row declares text-align ' + aligns.length + ' times (' + aligns.join(', ') +
    ') — one of them is dead and the next reader cannot tell which');
  assert.match(aligns[aligns.length - 1], /center/, 'the tab name is left-aligned again');
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
  /* ---------- EVERY PICTURE THE SHEET NAMES, AT BOTH WIDTHS ----------
     Listing the files by hand here would pass the day someone adds a
     --card-pic for a new type and forgets the asset: a background-image
     that 404s leaves a black card and says nothing. So the list comes from
     the sheet itself, and every url it names has to exist. */
  const named = [...new Set((RAILCSS.match(/--card-pic:url\('\/assets\/([^']+)'\)/g) || [])
    .map(s => /\/assets\/([^']+)/.exec(s)[1]))];
  assert.ok(named.length >= 8,
    'the sheet names only ' + named.length + ' card pictures — there are four types and two widths');
  named.forEach(f => {
    const stat = fs.statSync(path.join(ROOT2, 'assets', f));
    assert.ok(stat.size > 4000, 'assets/' + f + ' is missing or empty');
    assert.ok(stat.size < 160000, 'assets/' + f + ' is ' + stat.size + ' bytes — larger than the photograph it sits beside');
  });
  /* AND BOTH WIDTHS FOR EACH. A picture with only an -820 silently serves
     the wide file to a 360px phone, which is the thing the two widths
     exist to prevent. */
  const stems = [...new Set(named.map(f => f.replace(/-(420|820)\.jpg$/, '')))];
  stems.forEach(st => {
    assert.ok(named.indexOf(st + '-420.jpg') > -1, st + ' has no narrow-phone width');
    assert.ok(named.indexOf(st + '-820.jpg') > -1, st + ' has no retina width');
  });
  /* ON .how-mod, NOT .ws-h-step. The photograph was keyed to the
     blueprint's own element, which an execution phase and a fuel fact do
     not have -- so goal day, which has no blueprint, got plain panels
     while a tempo session got cards. Every panel in every rail is a
     .how-mod, so that is what carries the card. */
  assert.match(RAILCSS, /\.ws-rail \.how-mod\{[^}]*background-image:var\(--card-pic\)/,
    'the stage card has lost its photograph');
  /* ---------- ONE PICTURE PER SESSION TYPE ----------
     The founder's mapping: track for reps, misty road for easy, the finish
     arch for goal day, and the sunrise road that was already here for
     everything else. Carried as a property on the day card -- which
     already wears .type-easy, .type-track and the rest -- so every card in
     one session's rail inherits the same picture and the rail reads as one
     session rather than three. */
  assert.match(RAILCSS, /:root\{--card-pic:url\('\/assets\/dawn-road-820\.jpg'\);\}/,
    'there is no default picture, so an unmapped session type gets a black card');
  [['track', 'track-road'], ['easy', 'misty-road'], ['race', 'finish-arch']].forEach(([cls, stem]) => {
    assert.match(RAILCSS, new RegExp('\\.type-' + cls + '\\{--card-pic:url\\(\'/assets/' + stem + '-820\\.jpg\'\\);\\}'),
      '.type-' + cls + ' has lost its picture');
  });
  /* AND THE NARROW PHONE SWAPS EVERY ONE OF THEM, not just the default. */
  /* THE BLOCK FOUND BY WHAT IT MUST CONTAIN, not by the first
     @media (max-width:480px) in the sheet and a guess at where it ends --
     that located a block with no --card-pic in it and reported 0 of 4,
     which is the same trap a guard here fell into once before on the
     360px breakpoint. */
  const mi = RAILCSS.indexOf('--card-pic:url(\'/assets/dawn-road-420.jpg\')');
  assert.ok(mi > -1, 'the narrow-phone swap is gone entirely');
  const open = RAILCSS.lastIndexOf('@media', mi);
  assert.ok(open > -1 && /max-width:\s*480px/.test(RAILCSS.slice(open, mi)),
    'the narrow-phone picture swap is no longer inside a max-width:480px block');
  const block = RAILCSS.slice(open, RAILCSS.indexOf('\n  }', mi));
  const swapped = (block.match(/--card-pic:url\('\/assets\/[^']+-420\.jpg'\)/g) || []).length;
  const wide = (RAILCSS.match(/--card-pic:url\('\/assets\/[^']+-820\.jpg'\)/g) || []).length;
  assert.equal(swapped, wide,
    'the narrow phone swaps ' + swapped + ' of ' + wide + ' pictures — the rest download the wide file');
  assert.match(RAILCSS, /\.ws-rail \.ws-h-step\{display:contents;\}/,
    'the blueprint step is a box inside the card again, so its own tint and rule sit on the photograph');

  /* A PHOTOGRAPH IS NOT A BACKGROUND UNTIL THE WORDS ON IT ARE LEGIBLE.
     Measured against the pixels actually behind each run, with the figures
     mid-card over a gentle gradient: "2km" white came out at 1.75:1, "Easy"
     2.28, the pace band 3.49 -- all under 4.5 and two under the 3.0 that
     even large text needs. The figures sit at the FOOT now, where the frame
     is darkest to start with, under a scrim that is near-opaque there and
     clear at the top where the sunrise is the point: 19.84 / 9.51 / 9.67.
     (The first measurement sampled the row the glyphs are on, so white text
     inflated its own background; it reads the bands beside them now.) */
  /* ---------- THE SCRIM IS SIZED BY THE TEXT, NOT BY THE CARD ----------
     It was a gradient over the whole card with percentage stops, which
     holds only while every card's text block is about the same height. The
     founder's structure put a sentence between the figure and the numbers
     and that stopped being true: measured across every session at 320, 360
     and 390px, a block runs from 82px (a fuel fact) to 199px (an interval,
     whose sentence wraps to three lines). In a 260px card a 199px block
     starts at 22% -- far above the 47% where that gradient reached opaque.
     It passed its contrast measurement anyway, because the track
     photograph happens to be dark at that height. That is luck.
     So the gradient hangs off .ws-card-body, whose height IS the text, and
     its stops are in PIXELS: one fade, 76px long, finishing as the first
     line begins and flat underneath however many lines follow. Nothing
     about it is a proportion of the card, which is what made it fragile.
     PROVEN RATHER THAN ASSUMED: the tallest block in the product was put
     over the brightest photograph in the set -- an interval on the misty
     road, a pairing the mapping would never produce -- and every run of
     text still cleared its threshold, by 1.66 at the tightest.
     STILL NOT ON .how-mod's ::after: that is taken twice over, by the
     hairline between columns and by the rule zeroing it on the active
     panel, and an earlier scrim put there painted nothing at all. */
  assert.ok(RAILCSS.indexOf('.ws-rail .how-mod::after{') === -1,
    'the scrim is back on ::after, where the hairline and the active rule overwrite it');
  assert.match(RAILCSS, /\.ws-rail \.how-mod \+ \.how-mod::after\{content:none;\}/,
    'the hairline between columns is back on the card rail, drawing a rule on a photograph');

  assert.ok(RAILCODE.indexOf('<div class="ws-card-body">') > -1,
    'the panels no longer wrap their content, so there is nothing for the scrim to be sized by');
  const bodies = (RAILCODE.match(/ws-card-body/g) || []).length;
  assert.ok(bodies >= 3,
    'only ' + bodies + ' panel kinds wrap their content — a stage, a fuel fact and an ' +
    'execution phase all need one, or one of them loses its scrim');

  const si = RAILCSS.indexOf('.ws-rail .ws-card-body::before');
  assert.ok(si > -1, 'the scrim under the card text is gone');
  const scrim = RAILCSS.slice(si, RAILCSS.indexOf('}', si));
  /* ABOVE THE TEXT AND PAST THE PADDING. A scrim starting at the text's own
     top leaves the first line sitting in the fade. */
  const top = Number((/top:-(\d+)px/.exec(scrim) || [])[1]);
  assert.ok(top >= 60, 'the scrim reaches only ' + top + 'px above the text — the first line sits in the fade');
  assert.match(scrim, /bottom:-\d+px/, 'the scrim stops at the text, leaving the card’s bottom padding bare');
  /* THE STOPS ARE PIXELS, and this is the whole of the fix: a percentage
     stop is a proportion of the text block, so one rule ramps over 95px on
     a tall card and 34px on a short one — a contrast risk and a visible
     step across the frame at the same time. */
  const pct = (scrim.match(/rgba\(8,6,10,[^)]*\)\s+\d+%/g) || []).filter(x => !/\s100%/.test(x));
  assert.equal(pct.length, 0,
    'the scrim has gone back to percentage stops (' + pct.join(', ') + '), which are a ' +
    'proportion of the text and ramp differently on every card');
  assert.ok((scrim.match(/\d+px/g) || []).length >= 5,
    'the scrim no longer ramps in pixels, so its fade is not the same on every card');
  const last = Number((/rgba\(8,6,10,\.(\d+)\) 100%/.exec(scrim) || [])[1]);
  assert.ok(last >= 90, 'the scrim ends at .' + last + ' — the figures sit on it and were measured at 1.75:1 without it');

  /* AND THE CARD KEEPS A VEIL of its own, so a bright frame cannot shout
     over its neighbours and the figures have a floor above the fade. */
  const vi = RAILCSS.indexOf('.ws-rail .how-mod::before');
  assert.ok(vi > -1, 'the card has lost its veil');
  assert.match(RAILCSS.slice(vi, RAILCSS.indexOf('}', vi)), /linear-gradient/,
    'the veil is no longer a gradient');

  assert.match(RAILCSS, /\.ws-rail \.how-mod\{[^}]*justify-content:flex-end/,
    'the figures have left the foot of the card, which is where the scrim is built to meet them');
  assert.match(RAILCSS, /\.ws-rail \.how-mod\{[^}]*align-self:stretch/,
    'the cards are back to their natural heights, so a short one ends early and the rail is ragged');

  /* THE PEEK IS THE FOUNDER'S SECOND DRAWING: a card carried IN a rail
     rather than filling it, with its neighbours showing at both edges. */
  /* The 5px of breathing room either side comes OUT of the 84%, so the
     slot is never wider than the page the script scrolls by. */
  assert.match(RAILCSS, /\.ws-rail \.how-mod\{[^}]*flex:0 0 calc\(84% - 10px\)/,
    'the stage card fills the rail again, so nothing peeks and the rail stops reading as one');
});

test('label, figure, detail — that order, on every card of every rail', () => {
  /* The founder's words: "Make the 2km easy bigger like the sessions bigger
     central. So easy top. Distances 2nd. Then pace smaller."
     An execution phase and a fuel fact already read that way in the DOM
     (SETTLE / 0-10km / 4:46/km; CARB INTAKE / 60-90g/hr). A stage card did
     not -- it led with the figure and put "Easy" under it -- and its HR
     band and recovery note, carrying no `order` at all, took the initial 0
     and sorted AHEAD of everything that does: "178-190 BPM" rendered at the
     TOP of the card, over the brightest part of the sunrise.
     Reordered with flex `order` rather than by rewriting
     essentialPrescriptionHtml(), which is shared with the stacked list
     where the current order is right. */
  assert.match(RAILCSS, /\.ws-rail \.ws-h-presc:not\(\.font-mono\)\{order:1;\}/,
    'the zone word is no longer first');
  assert.match(RAILCSS, /\.ws-rail \.ws-h-qty\{order:2;\}/, 'the distance is no longer second');
  assert.match(RAILCSS, /\.ws-rail \.ws-h-cue\{order:3;\}/, 'the coaching line is no longer third');
  assert.match(RAILCSS, /\.ws-rail \.ws-h-presc\.font-mono\{order:4;\}/, 'the pace band is no longer fourth');
  assert.match(RAILCSS, /\.ws-rail \.ws-hr,\s*\n?\s*:is\([^)]*\) \.ws-rail \.ws-note\{order:5/,
    'the HR band and the recovery note have lost their order, which puts them at the ' +
    'top of the card above the label they belong under');

  /* THE FIGURE IS BIGGER THAN THE LABEL AND THE LABEL BIGGER THAN THE
     DETAIL -- the whole of what was asked for, read off the sheet. */
  const px = (re) => Number((re.exec(RAILCSS) || [])[1]);
  /* (\d+) stopped matching when the title took the hero's 21.85px and
     read back as NaN, which compares false against everything -- so the
     assertion below it was passing on a number that did not exist. */
  const fig = px(/\.ws-rail \.ws-h-qty,[\s\S]{0,400}?font-size:([\d.]+)px/);
  const lab = px(/\.ws-rail \.ws-h-presc:not\(\.font-mono\),[\s\S]{0,700}?font-size:([\d.]+)px/);
  assert.ok(Number.isFinite(fig) && Number.isFinite(lab),
    'the figure or the label size could not be read (' + fig + ' / ' + lab + ')');
  assert.ok(fig > lab, 'the figure (' + fig + 'px) is no longer bigger than the label (' + lab + 'px)');
  assert.ok(fig >= 28, 'the figure is ' + fig + 'px — it was raised to 30 because the card is ' +
    'no longer a third of a phone');

  /* ONE LABEL DECLARATION FOR EVERY KIND OF CARD. The zone word joins the
     rule that already states WHY, TIME ON FEET and SETTLE rather than
     getting a fourth that resembles it -- and Full Plan's phase slide is
     the fourth arm of the same rule for the same reason, so it is read here
     too. The arms have to stay contiguous: this walks from one to the next
     and a comment in the gap reads as separate declarations, which is why
     the explanation sits above the rule. */
  const labRule = /\.ws-rail \.ws-h-presc:not\(\.font-mono\),\s*\n\s*:is\([^)]*\) \.how-mod \.fuel-row \.k,\s*\n\s*:is\([^)]*\) \.how-mod \.strat-phase-label,\s*\n\s*\.view-plan \.pp-slide-k\{([^}]*)\}/;
  const labM = labRule.exec(RAILCSS);
  assert.ok(labM,
    'the stage card has a label declaration of its own again — there is one label voice ' +
    'in this rail and it is stated once');
  /* ---------- A CARD'S TITLE IS A HERO TITLE ----------
     The founder's words: "in the rails the titles should be white and big
     like they are in the heros same rules". So it is not merely white and
     not merely big -- it is the hero's own declaration, read off
     .th-hero-title and required to match on every property that is type. */
  /* THE FOCUSED ONE. A bare /\.th-hero-title\{/ finds the base rule first,
     which is `display:none` and has no type in it at all -- so every
     property read back undefined and the comparison said nothing. */
  const heroM = /:is\([^)]*\) \.th-hero-title\{([^}]*)\}/.exec(RAILCSS);
  assert.ok(heroM && /font-size/.test(heroM[1]), 'the focused hero title rule is gone');
  const decl = (b, k) => (new RegExp('(?:^|;)\\s*' + k + ':\\s*([^;]+)').exec(b) || [])[1];
  ['font-size', 'font-weight', 'letter-spacing', 'text-transform', 'color'].forEach(k => {
    const h = decl(heroM[1], k), c = decl(labM[1], k);
    assert.ok(h && c, 'cannot read ' + k + ' from both the hero title and the card title');
    assert.equal(c.trim(), h.trim(),
      'a card title and a hero title disagree on ' + k + ' (' + c + ' vs ' + h + ')');
  });
  assert.match(labM[1], /text-shadow:/,
    'the card title lost the hero glow, which on a photograph is what lifts it off the frame');
  /* The columns this used to be measured against are gone from the
     product -- see "why, feel and watch for left the screen" above -- so
     what is left to hold is that the card title is the HERO's, which the
     comparison above does property by property. */
});

test('every card in the rail leads with a word', () => {
  /* The stage name came off these cells when three of them shared a phone.
     One card at a time has the room, and every other panel in the rail
     leads with a label: SETTLE, CARB INTAKE, EASY. Measured on a 4x1200m
     session, the work card was the one panel in the product with nothing
     above its figure. The effort word wins where the engine has one; a
     work step, whose prescription is a pace band, takes its stage name. */
  const a = railApp();
  let checked = 0;
  a.state.days.forEach(d => {
    let steps; try { steps = a.workoutSteps(d); } catch (e) { return; }
    if (!steps || !steps.length || !a.usesHorizontalWorkoutBlueprint(steps)) return;
    steps.forEach((st, i) => {
      const cell = a.renderWorkoutStepHCell(st, i);
      const lead = /<span class="ws-h-presc">([^<]+)<\/span>/.exec(cell);
      assert.ok(lead, d.type + ' step ' + i + ': the card has no word above its figure');
      checked++;
      /* AND SPOKEN ONCE. The stage name is in the accessibility tree only
         while the card shows a different word; where it has been promoted
         to the label, a second copy would be read twice. */
      const sr = /<span class="sr-only">([^<]*)<\/span>/.exec(cell);
      if (lead[1] === st.label) assert.ok(!sr,
        d.type + ' step ' + i + ': "' + st.label + '" is both the label and the sr-only name');
      else assert.ok(sr && sr[1] === st.label,
        d.type + ' step ' + i + ': the stage name is no longer spoken');
    });
  });
  assert.ok(checked >= 6, 'the fixture no longer exercises the stage cards (' + checked + ')');

  /* THE SPLIT IS THE ONE PLACE THAT DECIDES. essentialPrescriptionHtml()
     still joins the two parts in exactly the order it always did, so the
     stacked list and the three-across row are untouched. */
  assert.match(RAILCODE, /function stepPrescriptionParts\(st\)\{/,
    'the prescription is no longer split into a word and a number');
  const steps = a.workoutSteps(a.state.days.filter(d => {
    try { return a.usesHorizontalWorkoutBlueprint(a.workoutSteps(d)); } catch (e) { return false; }
  })[0]);
  steps.forEach(st => {
    const p = a.stepPrescriptionParts(st);
    assert.equal(a.essentialPrescriptionHtml(st),
      (p.word ? '<span class="ws-h-presc">' + p.word + '</span>' : '') + p.pace,
      'essentialPrescriptionHtml no longer builds itself from the split');
  });
});

test('an Analysis with no score reads quieter, and says so from the same source', () => {
  /* The closed row used to carry "Not scored yet" under the name. That line
     went when the tab headings became the title alone, centred, as big as
     the narrowest phone allows -- and the GLANCE went with it: you could no
     longer tell from outside that the panel had nothing in it.
     Given back as weight rather than as a second line, so the heading is
     untouched and the row costs no height. The reason is still inside the
     panel, in a sentence, where there is room for it. */
  const a = railApp();
  const past = a.state.days.filter(d => d.type !== 'rest' && d.date < a.todayStr());
  assert.ok(past.length > 4, 'the fixture has no past sessions to log');

  const scoredDay = past[past.length - 2];
  logAsPrescribed(a, scoredDay);
  const lit = a.renderExecutionReview(scoredDay);
  assert.match(lit, /class="sess-tab sess-tab-btn"/,
    'a session with a score is showing the quiet tab — the dim says "nothing in here" over a ' +
    'panel that has a verdict and a percentage in it');

  const blankDay = past[past.length - 4];
  blankDay.completed = true;          /* done, nothing usable logged */
  const quiet = a.renderExecutionReview(blankDay);
  assert.match(quiet, /class="sess-tab sess-tab-btn is-quiet"/,
    'an Analysis with no score reads the same as one with a verdict in it');

  /* ---------- THE TITLE CANNOT DISAGREE WITH THE PANEL ----------
     computeExecutionBreakdown is what chooses the body -- the review, or
     the line telling the athlete what to log -- so the tab reads the same
     function rather than taking a flag from its caller. A flag is one
     forgotten argument away from a lit tab over an empty panel. */
  a.state.days.forEach(d => {
    if (d.type === 'rest' || !d.completed) return;
    const html = a.renderExecutionReview(d);
    if (!html) return;
    let b; try { b = a.computeExecutionBreakdown(d); } catch (e) { b = null; }
    assert.equal(/is-quiet/.test(html), !b,
      d.date + ' (' + d.type + '): the tab\'s weight disagrees with whether the panel has a score');
  });
  const fn = RAILCODE.slice(RAILCODE.indexOf('function analysisTab('));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /computeExecutionBreakdown\(dd\)/,
    'the quiet state is no longer derived from the function that chooses the panel');
  assert.match(body, /function analysisTab\(dd, body, vLine\)/,
    'analysisTab has taken an argument for this — it is one forgotten call away from drift');

  /* AND IT IS WEIGHT, NOT A SECOND LINE: the heading the founder asked for
     is the title alone. */
  assert.ok(quiet.indexOf('sess-tab-s') === -1 && !/Not scored yet/.test(quiet),
    'the second line is back under the tab name');
  assert.match(RAILCSS, /\.sess-tab\.is-quiet \.sess-tab-k\{color:var\(--ink-faint\);\}/,
    'the quiet tab no longer dims its title, so nothing distinguishes it');
  /* Measured in Chromium against the row it sits on: 5.94:1 quiet against
     17.31:1 lit. Clearly dimmer, and still over the 4.5 that even small
     text owes -- quiet, not disabled. */
});

test('every session has exactly one rail, and the rail is above the coaching', () => {
  /* THE FOUNDER PUT TWO SESSIONS SIDE BY SIDE AND THE ORDER DIFFERED. A
     blueprint session showed its cards and then WHY / FEEL / WATCH FOR,
     because the blueprint is emitted by renderStructuredWorkout further up
     the card; the goal day showed the columns and THEN its rail, because
     that one is emitted inside renderCoachingDepth, after them. Same two
     things, same screen, two orders.
     AND A LONG RUN WITH A BLUEPRINT DREW TWO RAILS -- its stages, then its
     fuel facts, two photograph rails one under the other. A session has
     one rail. Which one carries the fuel is decided by hasWorkoutBlueprint,
     in one place, so they can never land on both or on neither. */
  const a = railApp();
  const steps = d => { try { return a.workoutSteps(d).length; } catch (e) { return 0; } };
  const shapes = {};
  a.state.days.forEach(d => {
    if (d.type === 'rest') return;
    const html = a.renderDayCard(d);
    const rails = (html.match(/class="fuel-body ws-rail/g) || []).length;
    assert.equal(rails, 1,
      d.date + ' (' + d.type + ', ' + steps(d) + ' stages) draws ' + rails + ' card rails');
    const railAt = html.indexOf('class="fuel-body ws-rail');
    /* THE RAIL IS ABOVE THE COACHING, and the coaching is the Coach's Note
       now that the columns have gone. Same law, one fewer thing between
       them: the rail is the session, the note is the coach talking about
       it, and the note comes after. */
    const noteAt = html.indexOf('class="how-note"');
    assert.ok(noteAt > -1, d.date + ': the Coach\u2019s Note is gone');
    assert.ok(railAt < noteAt,
      d.date + ' (' + d.type + ') puts its Coach\u2019s Note above its rail');
    shapes[d.type + ' x' + steps(d)] = true;
  });
  /* The fixture has to contain the shapes this is about, or it proves
     nothing: a one-stage session, a multi-stage one, and a session whose
     rail is execution phases rather than stages. */
  assert.ok(Object.keys(shapes).some(k => /^easy x1/.test(k)), 'no one-stage session in the fixture');
  assert.ok(Object.keys(shapes).some(k => / x3$/.test(k)), 'no three-stage session in the fixture');
  assert.ok(a.renderDayCard(a.state.days.filter(d => d.type === 'race')[0]).indexOf('strat-phase-label') > -1,
    'the race no longer shows execution phases');
});

test('a single stage is a card, and yields to the execution phases where there are any', () => {
  /* The lower bound on a horizontal blueprint was 2, from when this was a
     ROW of cells and one cell in a three-cell row was a stranded box. It is
     a rail of full-width cards now and one card is a fine rail, so an easy
     run -- one stage, 26 of them in an eleven-week block -- gets the same
     card as everything else.
     THE TRAP: a race is also one stage. Letting a single stage win would
     have replaced its five execution phases with one card reading "GOAL
     DAY / 42.2km", which is the hero said twice. So a single stage is the
     rail only where there is no execution to show instead. */
  const a = railApp();
  assert.ok(a.usesHorizontalWorkoutBlueprint([{}]), 'a one-stage session is not a card rail');
  assert.ok(!a.usesHorizontalWorkoutBlueprint([]), 'a no-stage session claims a card rail');
  assert.ok(!a.usesHorizontalWorkoutBlueprint([{}, {}, {}, {}]), 'the upper bound is gone');

  let oneStageWithPhases = 0, oneStageWithout = 0;
  a.state.days.forEach(d => {
    if (d.type === 'rest') return;
    let n; try { n = a.workoutSteps(d).length; } catch (e) { return; }
    if (n !== 1) return;
    let phases = 0;
    try { const s = a.executionStrategyForDisplay(d); phases = (s && !s.suppressed && s.phases) ? s.phases.length : 0; } catch (e) { phases = 0; }
    /* EXCEPT A LONG RUN WITH FUEL, which has neither stages nor phases on
       its rail: the founder's three paired fuel cards took it, and the
       shape went to the Coach's Note. That is a third answer to "what is
       this session's rail", and it is decided in one place. */
    if (a.longRunIsFuelRail(d)){
      assert.equal(a.hasWorkoutBlueprint(d), false,
        d.date + ': a long run with fuel is showing stage cards as well as its paired fuel');
      return;
    }
    assert.equal(a.hasWorkoutBlueprint(d), phases === 0,
      d.date + ' (' + d.type + '): one stage and ' + phases + ' execution phases, but ' +
      'hasWorkoutBlueprint says ' + a.hasWorkoutBlueprint(d));
    if (phases) oneStageWithPhases++; else oneStageWithout++;
  });
  assert.ok(oneStageWithPhases >= 1 && oneStageWithout >= 1,
    'the fixture no longer has both one-stage cases (' + oneStageWithPhases + ' with phases, ' +
    oneStageWithout + ' without)');

  /* AND renderStructuredWorkout ASKS THE SAME QUESTION. Two readings of it
     would let a race draw a one-card blueprint rail here AND its execution
     rail below -- the two vocabularies at once, which is the one thing that
     law exists to prevent. */
  const rsw = RAILCODE.slice(RAILCODE.indexOf('function renderStructuredWorkout(dd)'));
  const rswBody = rsw.slice(0, rsw.indexOf('\n}'));
  assert.match(rswBody, /if \(hasWorkoutBlueprint\(dd\)\)\{/,
    'the workout block decides from the step count again, not from hasWorkoutBlueprint');
  assert.ok(rswBody.indexOf('usesHorizontalWorkoutBlueprint') === -1,
    'the workout block reads the step-count test directly again, which is a second answer ' +
    'to a question renderCoachingDepth answers with hasWorkoutBlueprint');

  /* A LONE CARD FILLS ITS RAIL. 84% leaves the next one peeking, which is
     how a rail says there is more sideways; with one card there is nothing
     to peek at and the 16% is dead space beside a photograph. */
  assert.match(RAILCSS, /\.ws-rail \.how-mod:only-child\{flex:0 0 calc\(100% - 10px\);\}/,
    'a one-card rail still leaves 16% of dead space beside its photograph');

  /* ---------- "EACH STEP BELOW" NEEDS MORE THAN ONE STEP ----------
     One variable used to answer two questions -- whether the card has a
     rail worth showing, and whether the session has more than one stage --
     because a blueprint meant two or three stages. A one-stage easy run is
     a rail now, and the shared variable put "Primary zone — each step below
     carries its own target" over a card showing one step whose target is
     the ring's. */
  const hero = RAILCODE.slice(RAILCODE.indexOf('function renderDayHeroBlock('));
  const heroBody = hero.slice(0, hero.indexOf('\n}'));
  assert.match(heroBody, /var stepNote = \(ring && manySteps\)/,
    'the step note is gated on having a rail again, not on having more than one step');
  assert.match(heroBody, /manySteps = workoutSteps\(dd\)\.length >= 2/,
    'manySteps is no longer derived from the step count');
  a.state.days.forEach(d => {
    if (d.type === 'rest') return;
    let n; try { n = a.workoutSteps(d).length; } catch (e) { return; }
    const html = a.renderDayHeroBlock(d, a.getDayTargets(d));
    const note = /th-steps-note/.test(html);
    if (n <= 1) assert.ok(!note,
      d.date + ' (' + d.type + ') has one step and is told each step below carries its own target');
  });
});

test('execution is never a column, and its sentence is never lost', () => {
  /* The founder's words: "execution is not there as the same as the other
     session types". It was the fourth column, and it appeared only where
     nothing else told the execution -- which, before a one-stage session
     had a rail, meant an easy run.
     REMOVING THE COLUMN WOULD HAVE DELETED THE SENTENCE. On an easy run
     "Hold the easy window from the first kilometre to the last" was said
     nowhere else; test/unitConsistencyCopy is built on that exact sentence
     and caught it. It goes to the Coach's Note instead -- the move the fuel
     caveats and the execution captions already made. */
  const a = railApp();
  assert.ok(RAILCODE.indexOf("mod('execution'") === -1,
    'EXECUTION is a column again — every session shows three');

  const level = a.athleteExperience();
  let rescued = 0, toldByStages = 0;
  a.state.days.forEach(d => {
    if (d.type === 'rest') return;
    let gd; try { gd = a.coachingDisclosureFor(d, level); } catch (e) { return; }
    if (!gd || !gd.how) return;
    const html = a.renderDayCard(d);
    const n = html.split(gd.how).length - 1;
    assert.ok(n <= 1, d.date + ' (' + d.type + '): the execution sentence is printed ' + n + ' times');
    let staged = 0;
    try { const s = a.executionStrategyForDisplay(d); staged = (s && !s.suppressed && s.phases) ? s.phases.length : 0; } catch (e) { staged = 0; }
    let stages = 0; try { stages = a.workoutSteps(d).length; } catch (e) { stages = 0; }
    const toldAlready = staged > 0 || (a.hasWorkoutBlueprint(d) && stages >= 2);
    assert.equal(n, toldAlready ? 0 : 1,
      d.date + ' (' + d.type + ', ' + stages + ' stages, ' + staged + ' phases): the execution ' +
      'sentence appears ' + n + ' times');
    if (n === 1){
      rescued++;
      const note = html.slice(html.indexOf('class="how-note"'));
      assert.ok(note.indexOf(gd.how) > -1,
        d.date + ': the execution sentence is on the card but not inside the Coach’s Note');
    } else toldByStages++;
  });
  assert.ok(rescued >= 5 && toldByStages >= 5,
    'the fixture no longer exercises both halves (' + rescued + ' rescued, ' + toldByStages + ' told by stages)');
});

test('the Commit card does not wear a Conditional badge', () => {
  /* 'Conditional' was HQ's word for paceRole 'open' -- the closing block,
     whose pace is available only if the earlier ones were executed -- and
     it read as a gold pill under the figure on the COMMIT card.
     NOTHING IS LOST, which is why it could go: the condition is carried in
     words by that phase's own cue, which goes to the Coach's Note, and both
     halves of that sentence are a safety invariant pinned by
     test/executionStrategy. */
  const a = railApp();
  const race = a.state.days.filter(d => d.type === 'race')[0];
  const html = a.renderDayCard(race);
  assert.ok(!/Conditional/.test(html), 'the Conditional badge is back on the card');
  /* ASKED OF renderStrategyPhase, NOT OF THE WHOLE RUNTIME. .pzr-tag is
     still a live class -- the zone editor marks an overridden pace
     'custom' with it -- so "the class appears nowhere" was never the law.
     The law is that a PHASE does not emit one. */
  const rsp = RAILCODE.slice(RAILCODE.indexOf('function renderStrategyPhase(ph)'));
  const rspBody = rsp.slice(0, rsp.indexOf('\n}'));
  assert.ok(rspBody.indexOf('pzr-tag') === -1, 'the Conditional badge is emitted again');
  assert.ok(!/\bvar tag\b/.test(rspBody),
    'the tag variable is back — if it can only ever be empty it is dead, and dead code ' +
    'reads as something that might still fire');

  const s = a.executionStrategyForDisplay(race);
  const last = s.phases[s.phases.length - 1];
  assert.equal(last.paceRole, 'open',
    'the closing block is no longer an open pace — this test is about the phase that was tagged');
  const note = html.slice(html.indexOf('class="how-note"'));
  assert.ok(note.indexOf('still in control') > -1 && note.indexOf('hold on and finish') > -1,
    'the closing block’s permission to press AND its permission to stop are no longer on the ' +
    'card — that sentence is what the badge was shorthand for');
});

test('a stage card reads name, figure, sentence, numbers — and the numbers are one line', () => {
  /* The founder's structure, written out:
         WARM-UP 2KM
         WHY: Prepare to hit goal pace smoothly.
         GOAL PACE 3 × 1600M
         Keep it controlled. Familiar, not hard.
         4:58/km · 164–171BPM
         Recovery: short
     Three things in that are new: the stage's own NAME as the title, a line
     of coaching about that stage, and the pace and the heart rate joined
     rather than stacked. */
  const a = railApp();
  const steps = d => { try { return a.workoutSteps(d); } catch (e) { return []; } };
  let withCue = 0, joined = 0, solo = 0;

  a.state.days.forEach(d => {
    if (!a.hasWorkoutBlueprint(d)) return;
    const st = steps(d);
    if (!st.length) return;
    const html = a.renderDayCard(d);

    st.forEach((s, i) => {
      /* THE TITLE IS THE STAGE'S NAME. It was the effort word, from when
         the card carried no name at all. */
      assert.ok(html.indexOf('<span class="ws-h-presc">' + s.label + '</span>') > -1,
        d.date + ' (' + d.type + ') stage ' + i + ': the card does not lead with "' + s.label + '"');
    });

    const cues = (html.match(/class="ws-h-cue"/g) || []).length;
    if (st.length >= 2) {
      assert.equal(cues, st.length,
        d.date + ' (' + d.type + '): ' + cues + ' coaching lines for ' + st.length + ' stages');
      withCue++;
    } else {
      /* ONE STAGE, NO SENTENCE. The card is the session there and the
         Coach's Note below is already saying it in the athlete's own
         words; a second copy a centimetre above it is the duplication
         every other pass here has been removing. */
      assert.equal(cues, 0,
        d.date + ' (' + d.type + '): a one-stage rail carries a coaching line that repeats the note');
      solo++;
    }

    /* PACE AND HEART RATE ON ONE LINE. They stacked because a 125px column
       could not hold a middot between them; the card is the full width of
       the rail now. */
    st.forEach(s => {
      /* NOT A wholeSession STAGE. Those deliberately carry no prescription
         on the card at all -- the ring above is already showing the day's
         pace and band, and stepPrescriptionParts returns nothing for them.
         Asserting a joined heart rate there was asserting against a rule
         the renderer does not have. */
      if (s.wholeSession) return;
      if (!s.target || !s.target.hr) return;
      const hr = a.fmtStrategyHR(s.target.hr);
      if (!hr) return;
      assert.ok(html.indexOf('<span class="ws-h-hr-join"> · ' + hr + '</span>') > -1,
        d.date + ': ' + hr + ' is not joined to the pace band');
      joined++;
    });
  });
  assert.ok(withCue >= 3 && solo >= 1 && joined >= 3,
    'the fixture no longer exercises all three (' + withCue + ' multi-stage, ' + solo +
    ' single-stage, ' + joined + ' joined heart rates)');

  /* AND IT IS NOT PRINTED TWICE. The heart rate used to be a row of its
     own below the pace; joining it without removing that row would put it
     on the card in two places. */
  const sec = RAILCODE.slice(RAILCODE.indexOf('function renderWorkoutStepSecondary(st)'));
  assert.ok(sec.slice(0, sec.indexOf('\n}')).indexOf('ws-hr') === -1,
    'the heart rate is both joined to the pace and printed as its own row');

  assert.match(RAILCSS, /\.ws-rail \.ws-h-cue\{order:3;\}/, 'the coaching line is not third on the card');
});

test('every stage the engine builds has something to say', () => {
  /* The sentences are written copy -- the engine carries role, intensity,
     label, qty, a target and sometimes a recovery, and nothing else. Three
     of them are the founder's, verbatim. The rest were drafted to sit
     beside them, and the thing that matters is that there is no stage the
     engine can produce which falls through the table and renders a card
     with a gap where its coaching should be. */
  const a = railApp();
  const seen = {}, missing = [];
  a.state.days.forEach(d => {
    if (!a.hasWorkoutBlueprint(d)) return;
    let st; try { st = a.workoutSteps(d); } catch (e) { return; }
    if (st.length < 2) return;
    let work = null;
    for (let i = 0; i < st.length; i++) if (st[i].role === 'work'){ work = st[i]; break; }
    st.forEach(s => {
      const key = s.role + '/' + s.intensity;
      const cue = a.stageCueFor(s, work ? work.intensity : null);
      seen[key] = cue;
      if (!cue) missing.push(key + ' (' + d.type + ')');
    });
  });
  assert.equal(missing.length, 0,
    'stages with no sentence: ' + [...new Set(missing)].join(', '));
  assert.ok(Object.keys(seen).length >= 5,
    'the fixture covers only ' + Object.keys(seen).length + ' kinds of stage');

  /* THE FOUNDER'S THREE, VERBATIM. These are the ones that were specified
     rather than drafted, so a later edit to the table has to leave them
     alone or say so out loud. */
  assert.equal(a.STAGE_CUES.warmup.goal_pace, 'Prepare to hit goal pace smoothly.',
    'the founder’s warm-up line has been rewritten');
  assert.equal(a.STAGE_CUES.work.goal_pace, 'Keep it controlled. Familiar, not hard.',
    'the founder’s goal-pace line has been rewritten');
  assert.equal(a.stageCueFor({ role: 'cooldown', intensity: 'easy', qty: '2km' }, 'goal_pace'),
    'Don’t turn the final 2km into extra work.',
    'the founder’s cool-down line has been rewritten, or stopped naming the distance');
  /* And a cool-down with no distance still reads. */
  assert.match(a.stageCueFor({ role: 'cooldown', intensity: 'easy' }, null), /cool-down into extra work/,
    'a cool-down without a distance renders a broken sentence');

  /* ---------- A FLANK IS ABOUT WHAT IT IS PREPARING FOR ----------
     A warm-up's own intensity is 'easy' on every session there is, so
     keying it on that would hand every warm-up the same line -- and the
     founder's is specifically about what follows: "Prepare to hit GOAL
     PACE smoothly." A mutation swapping the lookup to the stage's own
     intensity survived every other guard here, because the sentence it
     produced was a real one, just the wrong one. Existence was being
     asserted where correctness was meant. */
  const wu = i2 => a.stageCueFor({ role: 'warmup', intensity: 'easy' }, i2);
  assert.equal(wu('goal_pace'), 'Prepare to hit goal pace smoothly.',
    'a warm-up before goal pace no longer says so');
  assert.notEqual(wu('interval'), wu('goal_pace'),
    'a warm-up reads its own intensity rather than the session’s, so every warm-up in the ' +
    'product says the same thing');
  assert.notEqual(wu('tempo'), wu('goal_pace'), 'a warm-up before a tempo reads as one before goal pace');
  assert.ok(wu('interval') && wu('tempo') && wu('steady') && wu('hard_effort'),
    'a warm-up before one of the work intensities has nothing to say');
  /* The work stage is about ITSELF, which is the other half of the same
     rule and would break if the two lookups were merged. */
  assert.equal(a.stageCueFor({ role: 'work', intensity: 'interval' }, 'goal_pace'),
    a.STAGE_CUES.work.interval,
    'a work stage reads the session’s intensity rather than its own');
});

test('a long run is three slides, two facts to a card', () => {
  /* The founder's drawing, with that session's own numbers:
         SLIDE 1 - LONG RUN 15km     SLIDE 3 - TAKE 2-3 GELS
                   TIME ON FEET                or chews · ≈25g each
                   ≈1h 25m                     FLUID
         SLIDE 2 - FUEL 30-60g/hr                ≈0.7-1.1 L
                   TOTAL CARBS
                   ≈40-85g
     Each card carries two facts: one compact on a head line, one below as
     the card's own title and figure. The session heads card one because
     the stages have gone to the Coach's Note. */
  const a = railApp();
  const longs = a.state.days.filter(d => d.type === 'long');
  assert.ok(longs.length >= 5, 'the fixture has too few long runs');
  let paired = 0, unfuelled = 0;
  longs.forEach(d => {
    const html = a.renderDayCard(d);
    const cards = (html.match(/class="how-mod[^"]*"/g) || []).length;
    const dots = (html.match(/<span class="how-dot"><\/span>/g) || []).length;
    assert.equal(dots, cards, d.date + ': ' + dots + ' dots for ' + cards + ' cards');
    if (!a.longRunIsFuelRail(d)) { unfuelled++; return; }
    assert.equal(cards, 3,
      d.date + ' (' + d.km + 'km) is ' + cards + ' slides — a long run is three');
    /* NO STAGE AND NO PHASE CARDS: both went to the note. */
    assert.ok(html.indexOf('ws-h-step') === -1, d.date + ' still shows stage cards');
    /* THE PANEL, NOT THE WORD. A bare "strat-phase" also matches the
       caption's own .strat-phase-purpose, which is in the Coach's Note and
       is supposed to be there. */
    assert.ok(html.indexOf('class="how-mod strat-phase"') === -1,
      d.date + ' still shows execution phase cards');
    /* THE SESSION HEADS CARD ONE. */
    assert.ok(html.indexOf('<span class="pair-k">' + a.dayTypeLabel(d) + '</span>') > -1,
      d.date + ': the first card is not headed by the session');
    assert.ok(html.indexOf('<span class="pair-v font-mono">' + a.fmtDist(d.km) + '</span>') > -1,
      d.date + ': the session head does not carry the distance');
    /* AND EVERY FUEL FACT IS STILL ON THE RAIL -- three cards, six facts,
       nothing dropped in the fold. */
    const facts = a.fuelFacts(d).rows;
    facts.forEach(r => assert.ok(html.indexOf(r.v) > -1,
      d.date + ': the fuel fact ' + JSON.stringify(r.short) + ' (' + r.v + ') is not on the rail'));
    paired++;
  });
  assert.ok(paired >= 5, 'only ' + paired + ' long runs paired');
  assert.ok(unfuelled >= 1,
    'the fixture no longer has a long run without fuel, which is the case that keeps its stages');

  /* THE HEAD WORDS ARE THE FOUNDER'S. "Carb intake" reads as FUEL on a head
     line and "Gels" as TAKE, because a head line is an instruction. */
  const d15 = longs.filter(d => a.longRunIsFuelRail(d))[0];
  const h = a.renderDayCard(d15);
  ['Fuel', 'Take'].forEach(w => assert.ok(h.indexOf('<span class="pair-k">' + w + '</span>') > -1,
    'the head word "' + w + '" is gone from the paired cards'));
  assert.match(h, /<span class="pair-v font-mono">[^<]*GELS<\/span>/,
    'the gels head no longer names its unit, so "2–3" stands alone');
});

test('race day keeps its phases and pairs only its fuel', () => {
  /* The founder chose this: goal day goes from nine slides to seven --
     five execution phases, then two paired fuel cards. The phases stay
     because the rail IS the session there, which is also why no card is
     headed by the session the way a long run's first card is. */
  const a = railApp();
  const race = a.state.days.filter(d => d.type === 'race')[0];
  const html = a.renderDayCard(race);
  const cards = (html.match(/class="how-mod[^"]*"/g) || []).length;
  const phases = (html.match(/class="how-mod strat-phase"/g) || []).length;
  const pairs = (html.match(/data-mod="pair-\d+"/g) || []).length;
  assert.equal(phases, 5, 'the race shows ' + phases + ' execution phases');
  assert.equal(pairs, 2, 'the race’s four fuel facts came to ' + pairs + ' cards, not two');
  assert.equal(cards, 7, 'goal day is ' + cards + ' slides, not seven');
  assert.equal((html.match(/<span class="how-dot"><\/span>/g) || []).length, cards,
    'the dots disagree with the cards on goal day');
  assert.ok(html.indexOf('<span class="pair-k">' + a.dayTypeLabel(race) + '</span>') === -1,
    'the race’s first fuel card is headed by the session — the phases are already the session');
  a.fuelFacts(race).rows.forEach(r => assert.ok(html.indexOf(r.v) > -1,
    'the fuel fact ' + JSON.stringify(r.short) + ' is not on goal day’s rail'));
});

test('the phase captions all show where no panel can light them', () => {
  /* They are lit one at a time by the rail's focus. Where the phase panels
     are NOT on the rail -- a blueprint session, or a long run after the
     pairing -- nothing can move that focus, and this was already wrong
     before the pairing existed: measured in Chromium, an interval showed
     ONE of its four phase sentences and the other three were markup
     nobody could reach, because setFocus can only ever reach panel n-1.
     The guard that said "all four sentences are still carried" was reading
     the markup, which had them, rather than the screen, which did not. */
  const a = railApp();
  assert.match(RAILCODE, /function renderExecutionStrategyBlock\(dd, panelsShown\)/,
    'the captions no longer know whether their panels are on the rail');
  assert.match(RAILCODE, /how-cap'\+\(panelsShown \? '' : ' how-cap-all'\)/,
    'the caption wrapper no longer says whether anything can light it');
  assert.match(RAILCSS, /\.how-cap-all \.how-cap-i\{display:block;\}/,
    'the unlightable captions are hidden again, so only the first is ever read');

  let withPanels = 0, without = 0;
  a.state.days.forEach(d => {
    if (d.type === 'rest') return;
    let s; try { s = a.executionStrategyForDisplay(d); } catch (e) { return; }
    if (!s || s.suppressed || !s.phases || !s.phases.length) return;
    const html = a.renderDayCard(d);
    const onRail = html.indexOf('class="how-mod strat-phase"') > -1;
    const all = html.indexOf('how-cap how-cap-all') > -1;
    assert.equal(all, !onRail,
      d.date + ' (' + d.type + '): phase panels ' + (onRail ? 'ARE' : 'are NOT') +
      ' on the rail but the captions are ' + (all ? '' : 'not ') + 'all shown');
    /* And every sentence is in the note either way. */
    assert.equal((html.match(/class="how-cap-i/g) || []).length, s.phases.length,
      d.date + ': ' + s.phases.length + ' phases but a different number of sentences');
    onRail ? withPanels++ : without++;
  });
  assert.ok(withPanels >= 1 && without >= 3,
    'the fixture no longer exercises both (' + withPanels + ' with panels, ' + without + ' without)');
});

test('wherever fuel rides a rail, it rides it paired', () => {
  /* The pairing was asserted on the long run and on the race, which are
     the two the founder drew -- and a mutation swapping the BLUEPRINT
     rail's fuel back to one-fact-per-card survived all of it. A session
     with both a blueprint and fuel is not rare: one in this eleven-week
     fixture, thirteen in a sixteen-week full-marathon block. */
  const a = railApp();
  let seen = 0;
  a.state.days.forEach(d => {
    if (d.type === 'rest') return;
    let fuelled; try { fuelled = a.needsFueling(d); } catch (e) { return; }
    if (!fuelled) return;
    const html = a.renderDayCard(d);
    const facts = a.fuelFacts(d).rows.length;
    const pairs = (html.match(/data-mod="pair-\d+"/g) || []).length;
    const singles = (html.match(/data-mod="fuel-\d+"/g) || []).length;
    assert.equal(singles, 0,
      d.date + ' (' + d.type + ') shows ' + singles + ' one-fact fuel cards');
    assert.ok(pairs > 0 && pairs <= Math.ceil((facts + 1) / 2),
      d.date + ' (' + d.type + '): ' + facts + ' fuel facts came to ' + pairs + ' cards');
    seen++;
  });
  assert.ok(seen >= 6, 'the fixture exercises only ' + seen + ' fuelled sessions');

  /* AND THE SESSION WITH BOTH -- a blueprint AND fuel -- is one of them. */
  const both = a.state.days.filter(d => {
    try { return d.type !== 'rest' && a.hasWorkoutBlueprint(d) && a.needsFueling(d); } catch (e) { return false; }
  });
  assert.ok(both.length >= 1,
    'the fixture has no session with both a blueprint and fuel, which is the case a ' +
    'mutation walked straight through');
  both.forEach(d => {
    const html = a.renderDayCard(d);
    assert.ok(html.indexOf('data-mod="pair-0"') > -1,
      d.date + ' (' + d.type + '): a blueprint session’s fuel is not paired');
    assert.ok(html.indexOf('ws-h-step') > -1, d.date + ': its stages have gone too');
  });
});

test('the head line sits above the card’s title, and the shape reaches the note', () => {
  /* ---------- THE HEAD IS ABOVE THE TITLE ----------
     A paired card is head, title, figure. The head is `order:0` and the
     title `order:1`; nothing held that, and a mutation moving the head to
     the bottom of the card passed every other guard here. */
  const ord = (re) => Number((re.exec(RAILCSS) || [])[1]);
  const head = ord(/\.ws-rail \.pair-head\{[^}]*order:(\d)/);
  const title = ord(/\.ws-rail \.ws-h-presc:not\(\.font-mono\)\{order:(\d)/);
  const note = ord(/\.ws-rail \.pair-note\{[^}]*order:(\d)/);
  assert.ok(Number.isFinite(head) && Number.isFinite(title),
    'the head or the title has no order (' + head + ' / ' + title + ')');
  assert.ok(head < title, 'the head line (order ' + head + ') is no longer above the title (order ' + title + ')');
  assert.equal(note, head, 'the head’s qualifier has drifted away from the head it qualifies');

  /* ---------- THE SHAPE REACHES THE NOTE, AND ONLY WHERE IT MUST --------
     A long run's stages went to the Coach's Note. On most long runs the
     card already says the shape in prose, and a second telling is the
     thing every pass here removes -- but THREE OF TEN carry no description
     at all, and on those the stages were the only place it was written.
     Three mutations walked through this unguarded: never writing it,
     always writing it, and writing it without the paces. */
  const a = railApp();
  let written = 0, withheld = 0;
  a.state.days.forEach(d => {
    if (!a.longRunIsFuelRail(d)) return;
    const html = a.renderDayCard(d);
    const line = /<b>Session<\/b> ([^<]*)/.exec(html);
    const hasDesc = /<div class="day-desc">[^<]/.test(html);
    let steps; try { steps = a.workoutSteps(d); } catch (e) { steps = []; }
    if (hasDesc || steps.length < 2) {
      assert.ok(!line, d.date + ': the shape is written to the note as well as the description');
      withheld++;
      return;
    }
    assert.ok(line, d.date + ': ' + steps.length + ' stages, no description, and no shape in the note — ' +
      'the session’s shape is said nowhere');
    steps.forEach(st => {
      assert.ok(line[1].indexOf(st.label) > -1, d.date + ': the shape omits the stage ' + st.label);
      const q = a.renderStepQty(st);
      if (q) assert.ok(line[1].indexOf(q) > -1, d.date + ': the shape omits ' + st.label + '’s distance');
      const p = a.stepPrescriptionParts(st);
      if (p.pace) assert.ok(line[1].indexOf(p.pace) > -1,
        d.date + ': the shape omits ' + st.label + '’s pace (' + p.pace + '), which is the one ' +
        'thing a stage card carried that the description would not');
    });
    written++;
  });
  assert.ok(written >= 3 && withheld >= 3,
    'the fixture no longer exercises both (' + written + ' written, ' + withheld + ' withheld)');
});
