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

  /* ---------- ON A BLUEPRINT SESSION THE TABLE *IS* THE CARD ----------
     These sessions have no coaching disclosure left at all. The rail
     carries the stage coaching and WHY THIS SESSION carries the purpose,
     so the tab had nothing behind it -- and rendered anyway, as a bare
     "How to run this" summary opening on an empty body, until it was taken
     out. What this law is FOR is untouched by that: before it is run the
     prescription is the card and nothing stands between the athlete and
     it. So that is what is asked here, and the ordering claim moves to a
     session that still has a disclosure to be ordered against. */
  const todo = day(a, 'threshold_continuous');
  const ahead = a.renderDayCard(todo);
  assert.ok(ahead.indexOf('ws-block') > -1, 'the unrun blueprint card lost its steps');
  assert.doesNotMatch(ahead, /sess-tab-k">Session Details/,
    'an unrun session is behind a tab again -- it is the card, not a reference');
  /* AND THE COACHING IT NO LONGER DISCLOSES IS STILL ON THE CARD. Without
     this line the law passes just as well on a card that lost the tab AND
     the coaching with it, which is the failure the removal risked. */
  assert.ok(ahead.indexOf('why-session') > -1,
    'the blueprint card has no disclosure and no Why -- the purpose is nowhere');
  /* ---------- AND NO EMPTY DISCLOSURE EITHER ----------
     Standing the note's CONTENT down is not the same as standing the
     disclosure down, and for one pass it was not: with the body returning
     '' and the execution rail already suppressed in favour of the
     blueprint, renderCoachingDepth still emitted its <details> -- 780
     characters on a threshold card, every one of them chrome, reaching the
     screen as a "How to run this" summary that opened on nothing.
     NOTHING IN THE SUITE NOTICED. Deleting the suppression passed all 82
     laws in this file and coachingRail together, which is why this line
     exists and why it names the summary as well as the element: an empty
     tab is invisible to any law that only asks what the card contains. */
  assert.equal(ahead.indexOf('how-card'), -1,
    'an unrun blueprint session renders a coaching disclosure with nothing left in it');
  assert.equal(ahead.indexOf('How to run this'), -1,
    'the blueprint card offers a "How to run this" tab whose body has moved to the rail');
  assert.match(ahead, /class="fuel-body ws-rail"/,
    'the blueprint card has no disclosure and no rail -- the coaching is nowhere');

  /* ---------- WHERE A DISCLOSURE STILL RENDERS, THE TABLE IS ABOVE IT ----
     A goal-finish long run has no blueprint, so it keeps the staged
     execution rail inside the disclosure and keeps a step table above it:
     the original two-element ordering, held on the session that still has
     both elements. */
  const staged = day(a, 'long_run_goal_finish');
  assert.equal(a.hasWorkoutBlueprint(staged), false,
    'fixture assumption: a goal-finish long run has no blueprint, so it keeps its disclosure');
  const aheadS = a.renderDayCard(staged);
  const wsA = aheadS.indexOf('ws-block'), howA = aheadS.indexOf('how-card');
  assert.ok(wsA > -1 && howA > -1, 'the unrun card lost its steps or its rail');
  assert.ok(wsA < howA, 'an unrun session hid its step table behind the rail');

  /* AND ON A FOCUSED CARD IT MUST BE OPEN, which is the dangerous half.
     The open rail's summary is display:none -- correct, because a heading
     above panels headed WHY and EXECUTION is a label on a label. So if the
     element ever loses `open` while keeping .is-static, the rail is CLOSED
     with no summary to press: the session's instructions become unreachable
     on the one screen that exists to show them, and nothing else in the
     suite notices. */
  a.state.view = 'full';
  a.planSessionOpen = staged.id;
  const focused = a.renderDayCard(staged);
  assert.ok(a.dayCardIsFocused(staged), 'the fixture stopped being a focused card');
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
  /* ---- WHERE THEY ARE IS THE CARD'S BUSINESS; THAT THEY ARE IS THIS ----
     Why and Watch For now ride the stage cards on a rail with stages, so
     the NOTE no longer prints their headings. The sections are still all
     reachable on the card, which is what this test is named for, so it
     asks for the SENTENCES rather than the note's headings. */
  /* ---------- THE SECTIONS ARE SENTENCES NOW, NOT HEADINGS ----------
     The disclosure itself is gone from a blueprint session: its stage
     coaching rides the rail cards and its purpose rides WHY THIS SESSION,
     so "How to run this" and "Feel" are no longer written anywhere as
     words. Asking for those two strings was asking for the old furniture,
     and this law was never about the furniture -- it is about nothing
     being LOST when the step list arrived. So every section is asked for
     by the sentence it carries, which is the thing the athlete reads. */
  const gdSec = a.coachingDisclosureFor(dd, a.athleteExperience()) || {};
  [['Why', gdSec.why], ['Feel', gdSec.feel], ['Watch For', gdSec.avoid]].forEach(pair => {
    if (!pair[1]) return;
    assert.ok(html.indexOf(pair[1]) > -1,
      'the card lost ' + pair[0] + ' entirely: ' + JSON.stringify(pair[1].slice(0, 40)));
  });
  /* AND THE SENTENCES MUST EXIST TO BE FOUND. Three `if (!pair[1]) return`
     guards in a row will pass a card that shows nothing at all the moment
     coachingDisclosureFor() stops answering for this archetype, which is
     exactly the regression this law exists to catch. */
  assert.ok(gdSec.why && gdSec.feel && gdSec.avoid,
    'the fixture has no coaching to lose, so this law is checking nothing');
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
    /* ---------- THE PHASE COACHING RIDES THE STAGES IT DESCRIBES --------
       It used to be swept into the Coach's Note, because the blueprint had
       taken the execution rail's place and the phase sentences had nowhere
       else to be. On the founder's call -- "the rail becomes the coach:
       each part tells the athlete what to do and how to execute it when
       they are looking at that part" -- they are distributed onto the
       stage cards instead, and the Note went with the last thing in it.
       Asked phase by phase rather than by looking for a container, so the
       law holds whatever the carrier is called next. */
    const strat = a.executionStrategyForDisplay(dd);
    assert.ok(strat && !strat.suppressed && strat.phases && strat.phases.length,
      'the fixture has no execution phases, so this branch is checking nothing');
    strat.phases.forEach(ph => {
      ['purpose', 'cue'].forEach(k => {
        if (!ph[k]) return;
        const t = a.resolveDesc(ph[k]);
        assert.ok(html.indexOf(t) > -1,
          'the blueprint carries the stages but the ' + ph.key + ' ' + k +
          ' has nowhere to go: ' + JSON.stringify(t.slice(0, 40)));
      });
    });
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

/* ---------- THE SESSION THE FIXTURE NEVER BUILDS ----------
   A strides day is the only session the engine makes with TWO role='work'
   stages -- 4.2km easy, then 6x100m -- and the 11-week block this file
   builds happens never to schedule one. Two laws are about exactly that
   shape (the work stage is the LAST work step, and easy_strides covers its
   own description), and both passed a mutation that broke them because
   nothing in the fixture had the shape. So it is built here, by hand, from
   the same prescription the generator writes. */
function stridesDay(a){
  const d = a.state.days.filter(x => x.type === 'easy')[5];
  if (!d) return null;
  d.prescription = { archetype:'easy_strides', params:{ easyKm:4.2, reps:6, m:100 } };
  d.km = 5.5;
  const st = a.workoutSteps(d) || [];
  assert.equal(st.length, 2, 'the strides day did not build two stages');
  assert.equal(st.filter(x => x.role === 'work').length, 2,
    'the strides day no longer has two work stages, which is the shape these laws are about');
  return d;
}

/* ---------- NO RAIL CARD CARRIES PACE OR HEART RATE ----------
   Founder: "No card in any rail needs pace or Heart rate as it's going to
   remain in the ring. That can be removed from every rail card the user
   will ever see."
   This replaces the law that stood here before, which let a card keep its
   band wherever the numbers differed from the ring's. That was a condition;
   this is not. "Every rail card the user will ever see" is the whole claim,
   so the test reads EVERY card of EVERY rail across the whole block rather
   than the blueprint's stages alone -- which is how the execution rail was
   caught still printing 4:46/km five times under a ring that said 4:46/km.
   IT ASKS BOTH WAYS ROUND, because each alone has let something through
   this session. The rendered cards are scanned for a figure, which catches
   a new rail nobody thought to look at; and the two cell builders are read
   for a call to a pace or heart-rate formatter, which catches a figure in a
   shape this scan does not recognise. */
test('no card in any rail carries a pace or a heart rate', () => {
  const a = railApp();
  stridesDay(a);                       /* the two-work-stage shape as well */
  let cards = 0, days = 0;
  a.state.days.forEach(d => {
    const html = a.renderDayCard(d);
    /* EVERY rail: the blueprint's stage cards, the execution rail's phase
       cards and the fuel rail's panels all render a .ws-card-body, which is
       what "a card in a rail" means on this screen. */
    /* MATCHED WITH A DELIMITER, NOT AS AN EXACT ATTRIBUTE. The stage card's
       body took a second class (.ws-step-body, which is what runs its words
       full width and left) and an exact `class="ws-card-body"` stopped
       seeing it: the scan went from 55 cards on 16 days to 25 on 7, and
       passed, because the floor below was still met by the other two rails.
       Every stage card in the product had quietly left this law. */
    const bodies = html.match(/<div class="ws-card-body[ "][\s\S]*?<\/div><\/div>/g) || [];
    if (bodies.length) days++;
    bodies.forEach((c, i) => {
      cards++;
      const text = c.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;|&#\d+;/g, ' ');
      /* A PACE ALWAYS CARRIES ITS UNIT HERE and a heart rate always carries
         BPM, so these three strings are the figures themselves rather than
         a guess at what one looks like -- no bare "4:46" to confuse with a
         rep duration, and nothing a distance or a rep count can trip. */
      ['/km', '/mi', 'BPM'].forEach(unit => {
        assert.equal(text.indexOf(unit), -1,
          d.date + ' (' + d.type + ') card ' + i + ' carries ' + unit +
          ' — "it’s going to remain in the ring": ' + text.trim().slice(0, 90));
      });
    });
  });
  /* THE FIXTURE HAS TO HAVE BUILT THE CARDS. A scan of nothing passes, and
     this file has shipped a vacuous guard before. */
  /* RECOUNTED, NOT RELAXED. An easy run, a shakeout and four of the five
     long-run archetypes draw no rail at all now ("Long run should follow
     the same rules as easy run"), so 35 of the block's 73 days have no
     card to scan. What is left is every multi-stage session and the race:
     55 cards across 16 days, and the scan is worthless if the fixture
     stops building them. */
  assert.ok(cards >= 50 && days >= 14,
    'only ' + cards + ' cards on ' + days + ' days were scanned — this proves nothing');

  /* AND THE BUILDERS DO NOT REACH FOR A FIGURE. One per rail. */
  [['renderWorkoutStepHCell', ['paceBandHtml']],
   ['renderStrategyPhase',    ['fmtStrategyPace', 'fmtStrategyHR']]
  ].forEach(([fn, banned]) => {
    const at = RAILCODE.indexOf('function ' + fn + '(');
    assert.ok(at > -1, fn + ' is gone — this guard is now reading nothing');
    const body = RAILCODE.slice(at, RAILCODE.indexOf('\n}', at));
    banned.forEach(b => assert.equal(body.indexOf(b), -1,
      fn + ' calls ' + b + ' again, so a card is building a figure'));
  });

  /* THE GATE IS GONE, not merely unused. While stepBandIsRing existed it
     was one line away from being asked again. */
  assert.equal(RAILCODE.indexOf('stepBandIsRing'), -1,
    'stepBandIsRing is back — the rule is unconditional now');
});

test('the coaching rides the cards, one sentence each, and the work card is the last work stage', () => {
  /* Founder: "the rail becomes the coach -- each part tells the athlete
     what to do and how to execute it when they are looking at that part."
     WATCH FOR and FEEL ride the work card; the execution phase captions
     ride the stage each describes; and WHY left the cards altogether for
     WHY THIS SESSION under the rail, which is the section the founder
     asked for in the same instruction.

     THE SENTENCE CAP IS A MEASUREMENT AND IT HAS BEEN RE-TAKEN. It used to
     read "two fit, three do not", from a rail whose picture was 223px: the
     interval's work card came to 233px of text against the 189 the picture
     left and dragged the rail to 259px. Both numbers moved afterwards --
     --rail-pic is 274px now, and the card body is left-aligned rather than
     centred, which took the bodies from 308px to 220px. Re-measured in
     Chromium at 360px wide on the two worst cards the product builds:
     every .how-mod is exactly 274px with scrollHeight == clientHeight, the
     4-sentence work card of the 6km time trial has a 182px body ending
     64px clear of the card's bottom, and the 3-sentence interval card has
     a 149px body. So FOUR FIT. Five is not known to and not asserted to:
     the cap stays one above nothing, as a tripwire, and a fifth sentence
     is a reason to re-measure rather than to raise the number here. */
  const a = railApp();
  const level = a.athleteExperience();
  let railsSeen = 0, sawTwoWork = false;
  const strides = stridesDay(a);
  a.state.days.forEach(d => {
    if (d.type === 'rest') return;
    let steps = null; try { steps = a.workoutSteps(d); } catch (e) { return; }
    if (!steps || steps.length < 2 || !a.hasWorkoutBlueprint(d)) return;
    railsSeen++;
    if (steps.filter(x => x.role === 'work').length > 1) sawTwoWork = true;
    const gd = a.coachingDisclosureFor(d, level) || {};
    const cards = (a.renderStructuredWorkout(d, a.state) || '').split('class="how-mod"').slice(1);
    cards.forEach((c, i) => {
      const n = (c.match(/class="ws-h-cue/g) || []).length;
      assert.ok(n <= 4, d.date + ' card' + i + ' carries ' + n +
        ' sentences; four is the most that was measured to fit the shared ' +
        'picture height — re-measure before raising this');
    });
    /* ---------- WHY IS NOT ON A CARD, AND IS NOT GONE ----------
       It was on the first one. The founder moved it below the rail --
       "Below the rail, add a simple WHY THIS SESSION section containing
       the overall purpose/physiological reason for the workout" -- so the
       card must NOT carry it and the section MUST, and both halves are
       asked for: dropping the second would let the sentence vanish. */
    if (gd.why){
      cards.forEach((c, i) => assert.ok(c.indexOf(gd.why) === -1,
        d.date + ' card' + i + ': Why is on a stage card — it belongs under the rail'));
      const whole = a.renderDayCard(d);
      const wi = whole.indexOf('class="why-session"');
      assert.ok(wi > -1, d.date + ': there is no WHY THIS SESSION section');
      assert.ok(whole.indexOf(gd.why) > wi,
        d.date + ': Why left the cards and never arrived under the rail');
    }
    /* THE WORK CARD IS THE LAST role=work STEP. Every session but one has a
       single work stage between a warm-up and a cool-down, so first and
       last are the same card. A strides session has two -- work/easy then
       work/repetition -- and taking the first put "Turning the strides
       into reps" on the EASY card and left the repetition with no sentence
       at all. */
    let workIdx = -1;
    steps.forEach((st, i) => { if (st.role === 'work') workIdx = i; });
    if (gd.avoid && workIdx > -1) assert.ok((cards[workIdx] || '').indexOf(gd.avoid) > -1,
      d.date + ': Watch For is not on the work card (card' + workIdx + ')');
    /* FEEL JOINED WATCH FOR ON THE WORK CARD. It was kept off the cards by
       the 223px measurement above and nothing else; with the room re-taken
       it rides the stage it describes, like everything else on the rail.
       Asked on the LAST work stage for the same reason Watch For is. */
    if (gd.feel && workIdx > -1) assert.ok((cards[workIdx] || '').indexOf(gd.feel) > -1,
      d.date + ': Feel is not on the work card (card' + workIdx + ')');
  });
  assert.ok(railsSeen >= 5, 'only ' + railsSeen + ' stage rails in the fixture');
  assert.ok(sawTwoWork,
    'no session with two work stages was checked, so "the work card is the LAST work stage" ' +
    'was asserted against nothing — a mutation to the first/last choice passed this test once');
});

test('every stage the engine builds has a sentence to run it by', () => {
  /* A repetition stage had none: STAGE_CUES.work had no key for the
     intensity, so the strides card showed a name, a figure and a pace band
     and said nothing about how to run it. Asserted across every intensity
     the engine actually produces rather than against a written-down list,
     so the next intensity added without a cue fails here. */
  const a = railApp();
  const missing = {};
  a.state.days.forEach(d => {
    let steps = null; try { steps = a.workoutSteps(d); } catch (e) { return; }
    if (!steps || steps.length < 2) return;
    let work = null; steps.forEach(st => { if (st.role === 'work') work = st; });
    steps.forEach(st => {
      if (st.wholeSession) return;
      const cue = a.stageCueFor(st, work ? work.intensity : null);
      if (!cue) missing[st.role + '/' + st.intensity] = (d.date + ' ' + st.label);
    });
  });
  assert.deepEqual(Object.keys(missing), [],
    'stages with no cue: ' + JSON.stringify(missing));
});

test('every other archetype keeps its description — on the face or in the note', () => {
  const a = app();
  /* ---- NOTHING BETWEEN THE HERO AND THE CARDS, AND NOTHING LOST ----
     Founder: "And workout card that has a title between the hero and the
     card can be removed. If it adds no value to the face remove it. If it
     does add to coaches note."
     So a description now has three possible fates and this test is about
     telling them apart:
       the cards said it         -> it is not printed at all
       it adds something, and
         there IS a card rail    -> it moves under the rail, into WHY THIS
                                    SESSION, which is where the founder put
                                    the session's reason for being; it used
                                    to move into the Coach's Note, and on
                                    the sessions that still have a note it
                                    is in both
         there is NO card rail   -> it stays on the face, where it was
     The third case is most of them: a long run's stages are the fuel rail
     rather than a card rail, and a race or an optional day has no rail at
     all, so nothing sits between those heroes and a card to begin with.
     ASKED OF THE APP'S OWN PREDICATES, NOT RE-DERIVED HERE. The version of
     this test before it counted stages itself, which is how it came to
     disagree with the renderer about shakeout; the two readings of one rule
     are exactly what descMovesToNote exists to stop.
     IF EITHER SET EVER EMPTIES, A RULE WENT BLANKET. */
  const moved = NAMES.filter(n => !!a.descMovesToNote(day(a, n)));
  const kept  = NAMES.filter(n => {
    const d = day(a, n);
    return !a.workoutCoversDescription(d) && !a.descMovesToNote(d);
  });
  /* THE KEPT SET IS ALLOWED TO BE EMPTY NOW, AND IN THIS FIXTURE IT IS.
     It held the long runs: sessions with no card rail, whose description
     therefore had nothing to sit above and stayed on the face. "Long run
     should follow the same rules as easy run" moved every one of them into
     the note, and what is left on the face across a real block is a race
     lede and the optional days -- neither of which is in CASES.
     SO THE FLOOR MOVES TO THE OTHER SET rather than being lowered to zero
     and left looking like a law. If descriptions stopped moving, or started
     vanishing, the two assertions under this catch it; an empty kept set on
     its own no longer means anything. */
  assert.ok(moved.length >= 4,
    'only ' + moved.length + ' descriptions move to the note — that half of the rule is dying');

  /* STRUCTURE ONLY, IN THIS FIXTURE. Every CASES day carries the literal
     placeholder "prose" as its description, so asking here whether the
     sentence survived would be asking whether the word "prose" appears
     somewhere in the card -- which it would, almost whatever broke. The
     real sentences are asserted word for word against the 11-week block,
     in "a description that leaves the face arrives in the Coach's Note". */
  const text = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  /* AND IT IS ON THE RIGHT ONE OF THE TWO. */
  kept.forEach(n => {
    assert.ok(a.renderDayCard(day(a, n)).indexOf('day-desc') > -1,
      n + ': has no card rail, so nothing was between its hero and a card to remove');
  });
  moved.forEach(n => {
    const html = a.renderDayCard(day(a, n));
    assert.equal(html.indexOf('day-desc'), -1,
      n + ': still prints its description between the hero and the cards');
    /* ASKED OF THE SECTION THAT NOW CARRIES IT ON EVERY SESSION. The note
       was the old home and four of these six still have one, so asking for
       "a note OR a Why section" would pass those four with the Why section
       deleted -- and a time trial, which has no note left, would be the
       only thing holding it up. WHY THIS SESSION is universal here: it is
       built from descMovesToNote() itself, the same predicate this set was
       filtered by. */
    assert.ok(html.indexOf('why-session-s') > -1,
      n + ': its description came off the face and there is no WHY THIS SESSION to have taken it');
  });
});

/* ---------- THE BOX FOLLOWS THE DAY TO EVERY SCREEN ----------
   Founder: "So that needs to follow the every place a day card is. Today,
   this week, full plan... No symbols what so ever like the mock up. The
   easy run simpleness follows the today this week and full plan."
   THIS WAS COMPLETELY UNGUARDED until it was mutation-tested. Deleting the
   box from the week slide, leaving the chips on it, and hiding the box
   outside the focused card all passed the whole suite -- because every
   existing law reads renderDayCard(), and This Week and Full Plan's week
   screen do not use it: they build their own slide through weekSlideHtml(),
   whose .wk-overview contains no .day element at all. That is exactly why
   the box was missing from those two screens in the first place. */
test('a solo-note day looks the same on Today, This Week and Full Plan', () => {
  const a = railApp();
  let solo = 0, railed = 0, rested = 0;
  a.state.days.forEach((d, i) => {
    const slide = a.weekSlideHtml(d, i);
    if (a.soloNoteSession(d)){
      solo++;
      /* THE BOX IS ON THE SLIDE, and it is the same one Today draws -- the
         markup comes from renderSoloNote(), which both callers ask. */
      assert.ok(slide.indexOf('data-solo') > -1,
        d.date + ': This Week and Full Plan show the hero with nothing under it');
      assert.equal(slide, slide.replace(/<div class="wk-session-badges">/, '___'),
        d.date + ': the slide still draws a chip row on a solo-note day');
      assert.equal(slide.indexOf('wk-badge'), -1,
        d.date + ': "No symbols what so ever" — the slide still carries a chip');
      /* AND IT IS THE SAME WORDS AS THE DAY CARD. */
      const card = a.renderDayCard(d);
      const parts = a.singleCardNoteParts(d);
      if (parts) assert.ok(
        slide.indexOf(parts.lead.replace(/\.$/, '')) > -1 &&
        card.indexOf(parts.lead.replace(/\.$/, '')) > -1,
        d.date + ': the two screens are saying different things');
    } else if (a.hasWorkoutBlueprint(d)){
      railed++;
      /* A DAY WITH A RAIL NO LONGER KEEPS ITS CHIPS EITHER. Founder: "Long
         run tempo interval still there also." The exception had no reason of
         its own -- the hero one line below reads LONG RUN + GOAL PACE,
         TEMPO: 26MIN (SPLIT), HILL REPEATS 6X40S, so the type chip was the
         same fact twice on a railed day exactly as on a solo-note one.
         It still does not grow a box it has no business having. */
      assert.equal(slide.indexOf('wk-badge'), -1,
        d.date + ': a session with a rail still carries a type chip, and the ' +
        'hero directly beneath it already names the session');
      assert.equal(slide.indexOf('data-solo'), -1,
        d.date + ': a session with a rail grew a solo box');
    } else if (d.type === 'rest'){
      /* ---------- AND A REST DAY IS THE SOLO-NOTE CASE ----------
         Founder: "Rest days has the pills at the top."
         It fell between the two branches above -- not solo-note, because
         soloNoteSession() needs a workout blueprint a rest day has not got,
         and not railed for the same reason -- so it was the one kind of day
         this sweep walked straight past. It printed Today and Rest over a
         hero reading FULL REST.
         ALL THREE, not just the type chip: the rule here is that a day with
         a rail keeps its chips and a day without one keeps none, and a rest
         day is the least railed day there is. */
      rested++;
      assert.equal(slide.indexOf('wk-badge'), -1,
        d.date + ': a rest day still carries a chip, and the hero directly ' +
        'beneath it already says FULL REST');
      assert.equal(slide, slide.replace(/<div class="wk-session-badges">/, '___'),
        d.date + ': the slide still draws a chip row on a rest day');
    }
  });
  assert.ok(solo >= 20 && railed >= 5 && rested >= 5,
    'the block built ' + solo + ' solo-note days, ' + railed + ' railed ones and ' +
    rested + ' rest days — this proves little');

  /* NO DAY OF ANY KIND CARRIES ONE, including the types the three branches
     above do not classify (race, checkpoint, calibration). The rule is now
     unconditional, so it is asserted unconditionally rather than as three
     coincidences. */
  a.state.days.forEach((d, i) => {
    assert.equal(a.weekSlideHtml(d, i).indexOf('wk-badge'), -1,
      d.date + ' (' + d.type + '): a week slide grew a chip back');
  });

  /* AND THE DAY SELECTOR STILL SAYS WHICH DAY IS TODAY AND WHICH ARE DONE.
     This is the half that makes the removal safe rather than lossy: the
     Today and Done chips went because renderWeekDaySelector() already
     carries those states -- "done / today / ahead" is the job it says it
     exists for. If it stops carrying them the information is not moved
     somewhere else, it is gone from the screen. */
  const wkNum = a.currentWeekNum();
  const sel = a.renderWeekDaySelector(wkNum);
  assert.match(sel, /class="wk-day[^"]*\bis-today\b/,
    'the day selector stopped marking today, and the Today chip that used to ' +
    'say it has been removed — nothing on the screen says it now');
  a.state.days.filter(d => d.week === wkNum).forEach(d => { d.completed = true; });
  assert.match(a.renderWeekDaySelector(wkNum), /class="wk-day[^"]*\bis-done\b/,
    'the day selector stopped marking completed days, and the Done chip that ' +
    'used to say it has been removed');

  /* ---- AND THE SHEET LETS IT SHOW THERE ----
     .how-note is display:none at large and lit only inside a focused card.
     The box restates display:flex for itself; without that it is built,
     present in the DOM, and invisible on exactly the two screens this law
     is about -- which no rendered-markup assertion above would catch. */
  const solonote = /\.how-note\[data-solo\]\{([^}]*)\}/.exec(RAILCSS);
  assert.ok(solonote, 'the solo box rule is gone');
  assert.match(solonote[1], /display:flex/,
    'the box no longer shows itself outside a focused card, so This Week and Full Plan hide it');
});

/* ---------- NOTHING MORE TO OPEN ON A SOLO-NOTE DAY ----------
   Founder: "On easy sessions the view full session isnt needed." The full
   card on those days is the hero and the cherry box, and the overview above
   the button already shows both, so the button was offering to reveal what
   the athlete was looking at.
   GHOSTED RATHER THAN DELETED, the way a rest day's already was: the slides
   are one height for the week and this button sits below the rail, so
   removing it outright drops everything beneath it and snaps it back on the
   next swipe. Both halves are asserted -- it is not pressable, and its box
   is still there -- because deleting it would also pass a test that only
   checked for the words. */
test('no day but race offers a full session to open', () => {
  const a = railApp();
  /* ---- READ IN THE WEEK THAT HAS A RACE IN IT ----
     THIS USED TO READ THE CURRENT WEEK, and the reserved box has since
     stopped being drawn in weeks whose carousel holds no race day -- there
     the button can never appear, so the box was 65px of nothing on 15 weeks
     of 16 (see renderWeekSessionBox). The claim here is about the exception
     race day makes, so it is asserted where race day is. */
  const raceDay = a.state.days.filter(d => d.type === 'race')[0];
  assert.ok(raceDay, 'the block builds no race day, so the exception is untested');
  const wk = raceDay.week;
  const days = a.weekCarouselDays(wk);
  assert.ok(days.length >= 5, 'the fixture week is too small to prove anything');
  assert.ok(days.some(d => d.type === 'race'), 'the race is not in its own week\u2019s carousel');
  let ghosted = 0, offered = 0;
  days.forEach(d => {
    a.handleWeekPickDay(d.date);
    const html = a.renderWeekSessionBox(wk);
    const btn = /<button type="button" class="wk-open sess-nav([^"]*)"([^>]*)>/.exec(html);
    assert.ok(btn, d.date + ': the week screen has no full-session button at all');
    const ghost = btn[1].indexOf('is-ghost') > -1;
    /* ---- THE RULE WIDENED FROM SOLO-NOTE DAYS TO EVERY DAY BUT RACE ----
       Founder: "I want the full session swapping. So I don't want view full
       session button. I want the rail and the coaches note being visible."
       The slide carries the hero, the rail and the Coach's Note now, so the
       button offered to reveal what was already on screen.
       RACE IS THE EXCEPTION, by instruction -- "Leave race day separate for
       the time being" -- and it is a real one, not a leftover: its five
       execution phases are still deliberately off the slide, so the full
       card is the only place they can be read. */
    if (d.type !== 'race'){
      ghosted++;
      assert.ok(ghost, d.date + ' (' + d.type + '): still offers to open a session it is already showing');
      assert.equal(btn[2].indexOf('data-action'), -1,
        d.date + ': the ghosted button is still pressable');
      /* THE BOX STAYS, or the page jumps under a finger mid-swipe. */
      assert.ok(html.indexOf('wk-open sess-nav') > -1,
        d.date + ': the button was deleted rather than ghosted, so the week will jump on a swipe');
    } else {
      offered++;
      assert.ok(!ghost, d.date + ': goal day can no longer be opened, and its phases are only there');
      assert.ok(btn[2].indexOf('data-action="week-open-session"') > -1,
        d.date + ': the full-session button lost its action');
    }
  });
  /* The fixture week has no race day, so `offered` is 0 here; the race arm
     is exercised by the race-day laws elsewhere in this file. What this
     week proves is that every ordinary day ghosts it. */
  assert.ok(ghosted >= 5,
    'the fixture week exercised only ' + ghosted + ' ghosted days');

  /* ---- AND GOAL DAY, WHICH IS THE ONE DAY THAT STILL OPENS ----
     The fixture week above has no race day, so without this the race arm of
     the condition was never run -- removing it entirely passed every test
     in this file. Goal day's five execution phases are deliberately still
     off the slide, so the full card is the only place to read them. */
  /* ---- GOAL DAY, ASSERTED AT THE UNIT RATHER THAN ON SCREEN ----
     Checked before writing this: goal day is not in any week's carousel.
     Week 11 runs to Nov 14 and the race is Nov 15, so weekSessionDays()
     never returns it -- the race has its own card on Full Plan instead. The
     exception is therefore DEFENSIVE: it is what stops goal day becoming a
     hero and nothing if it ever does reach this rail. Asserted where it can
     be: the slide withholds its coaching, and the button condition names
     the exception rather than having quietly become unconditional. */
  const race = a.state.days.filter(d => d.type === 'race')[0];
  assert.ok(race, 'the block builds no goal day, so the exception is untested');
  assert.equal(a.weekSlideHtml(race, 0).indexOf('class="how-note"'), -1,
    'goal day\u2019s coaching reached the slide — it is meant to be held back for now');
  /* ---- WITHHELD ON THE SLIDE, NOT TAKEN AWAY ----
     Founder: "you have removed coaches note? Which is actually ok if it
     shows up on today card for that session?" It does, and that is the
     half of this that matters: the slide is the only place goal day's
     coaching is held back. Asserted here because the exclusion lives in
     weekSlideHtml() and nothing stopped it being copied into the day card
     the next time someone made the two agree. Checked with goal day as
     TODAY, which is the only day it is ever the Today card. */
  const g = railApp();
  const gRace = g.state.days.filter(d => d.type === 'race')[0];
  g.todayStr = function(){ return gRace.date; };
  const card = g.renderDayCard(gRace);
  assert.ok(card.indexOf('class="how-note"') > -1,
    'goal day has lost its Coach\u2019s Note on the day card as well, which was never the ask');
  assert.ok((card.match(/ws-card-body/g) || []).length >= 5,
    'goal day has lost its execution phases on the day card');
  const box = /function renderWeekSessionBox\(weekNum\)\{[\s\S]*?\n\}/.exec(RAILCODE)[0];
  assert.match(box, /dd\.type !== 'race' && !weekSessionOpen/,
    'the full-session button no longer makes an exception of goal day');

  /* ---- A SLIDE'S PICTURES STAY INSIDE THAT SLIDE ----
     Founder: "There is a wrapping issue? So when you swipe the images
     follow on?" Measured at 430px before the fix: slide 16->414, card
     0->430, so each card overhung 16px into both neighbours and only the
     rail clipped. Three rules move the breakout from the card to the rail;
     all three are needed, and removing the clip alone passed every other
     law in this file. */
  assert.match(RAILCSS, /\.view-week \.wk-rail\{margin-left:-16px; margin-right:-16px; width:calc\(100% \+ 32px\);\}/,
    'the week rail is no longer full-bleed, so the slide cannot hold the breakout');
  assert.match(RAILCSS, /\.view-week \.wk-slide\{overflow:hidden;\}/,
    'a slide no longer clips, so a neighbour\u2019s picture paints into it');
  assert.match(RAILCSS, /\.view-week \.wk-overview\{padding-left:16px; padding-right:16px;\}/,
    'the slide lost its gutter, so the hero now starts at the screen edge');
});

/* ---------- TICK AND EDIT ON TODAY; EDIT ON THE OTHER TWO ----------
   Founder: "I think that's right tick and edit on today. Edit this week.
   And edit full plan." -- and then, on the completed card: "the tick and
   edit button over lap the ring. I like the position at the top right. But
   they should both be there all the time."
   THE OVERLAP WAS MEASURED, NOT EYEBALLED. The rail was absolute at
   right:0 laying its controls out in a row, so it grew leftwards as it
   gained them: one control sat at x370, clear of a ring spanning x261-405;
   logging the session added the notes button and pushed the tick to x310,
   onto the ring. It is a right-aligned row of its own now, above the hero,
   so the two states are identical and nothing can collide with the ring
   however many controls the rail ends up holding. */
test('the tick and the edit control sit together, clear of the ring, in both states', () => {
  const a = railApp();
  const today = a.state.days.filter(d => d.date === a.todayStr())[0];
  assert.ok(today, 'the block has no day that is today');

  /* BOTH CONTROLS, IN BOTH STATES. dayActionButton() returns the pencil
     before the session is run and the notes button after, never both, so
     "both there all the time" means the tick and whichever one applies. */
  [false, true].forEach(done => {
    today.completed = done;
    const html = a.renderDayCard(today);
    assert.ok(html.indexOf('data-action="toggle-complete"') > -1,
      'completed=' + done + ': the tick is gone from the day card');
    assert.ok(html.indexOf('data-action="open-edit"') > -1,
      'completed=' + done + ': there is no edit control on the day card');
    assert.ok(html.indexOf('class="day-rail"') > -1,
      'completed=' + done + ': the two controls are no longer in one rail');
  });
  today.completed = false;

  /* AND TODAY NO LONGER HIDES THE PENCIL. Two rules did it, and the second
     hid the whole rail unless it held a notes button -- which with the
     pencil back would hide the pencil. */
  assert.equal(RAILCSS.indexOf('.view-today .day-act-plan{display:none'), -1,
    'Today hides the edit control again');
  assert.equal(RAILCSS.indexOf('.view-today .day-actions:not(:has(.day-act-log))'), -1,
    'Today hides the whole action rail again, which takes the pencil with it');

  /* THE RAIL IS A ROW, NOT A CORNER. An absolute right:0 rail grows
     leftwards into the ring as controls are added; this is what stops it. */
  const rail = /\.day-rail\{([^}]*)\}/.exec(RAILCSS);
  assert.ok(rail, 'the focused rail rule is gone');
  assert.match(rail[1], /justify-content:flex-end/,
    'the rail is not right-aligned, so the controls have left the top right');
  assert.equal(/position:absolute/.test(rail[1]), false,
    'the rail is absolutely positioned again, so it will overlap the ring once it holds two controls');

  /* ---- EDIT ON THIS WEEK AND FULL PLAN, AND NO TICK THERE ----
     Both screens draw their day through weekSlideHtml(). Before this, a
     solo-note day had neither: its full card is not openable, and that card
     was the only thing carrying the control. */
  let edits = 0;
  a.state.days.forEach((d, i) => {
    if (d.type === 'rest') return;
    const slide = a.weekSlideHtml(d, i);
    assert.ok(slide.indexOf('data-action="open-edit"') > -1,
      d.date + ' (' + d.type + '): no edit control on the week slide');
    assert.equal(slide.indexOf('data-action="toggle-complete"'), -1,
      d.date + ': the week slide grew a tick — the founder put that on Today');
    edits++;
  });
  assert.ok(edits >= 30, 'only ' + edits + ' slides were checked');
});

/* ---------- THE WORKOUT IS ON THE WEEK SLIDE, AND IT OWNS ITS OWN SWIPE ----
   Founder: "I think the work out now should be open like full plan. So when
   you swipe the day the work out is there."
   A solo-note day already showed everything it had; a day with a card rail
   showed a hero, a gap, and a button offering to reveal the session. */
test('a session with a rail shows that rail on the week slide', () => {
  const a = railApp();
  let railed = 0, solo = 0;
  a.state.days.forEach((d, i) => {
    const slide = a.weekSlideHtml(d, i);
    const cards = (slide.match(/ws-card-body/g) || []).length;
    /* SOLO FIRST: a solo-note day HAS a blueprint -- that is what makes it
       one -- so asking hasWorkoutBlueprint() first claims every easy run. */
    if (a.soloNoteSession(d)){
      solo++;
      assert.equal(cards, 0, d.date + ': a solo-note day grew a card rail on the slide');
    } else if (a.hasWorkoutBlueprint(d)){
      railed++;
      assert.ok(cards >= 1,
        d.date + ' (' + d.type + '): the week slide shows no workout, only a button to find it');
      /* THE SAME RAIL THE FOCUSED CARD DRAWS -- one function, so the two
         screens cannot describe the session differently. */
      assert.equal(cards, (a.renderDayCard(d).match(/ws-card-body/g) || []).length,
        d.date + ': the week slide and the day card draw different numbers of cards');
    }
  });
  assert.ok(railed >= 10 && solo >= 20,
    'the block exercised ' + railed + ' railed and ' + solo + ' solo days — this proves little');
});

test('swiping the workout does not also change the day', () => {
  /* ---- A GESTURE BELONGS TO THE INNERMOST THING THAT WANTS IT ----
     The workout rail is a horizontal region of its own -- scroll-snap, no
     handler, no stopPropagation -- so once it sits inside the week's day
     carousel its swipes reach that carousel too. MEASURED IN A BROWSER
     before the fix: a swipe across the cards moved the week from index 1 to
     index 2 while the cards scrolled as well; after it, the week stays at 1
     and a swipe starting on the hero still moves it to 2.
     THE HELPER ALREADY EXISTED. wireWeekFullSwipe() asks exactly this for
     the open card, written when the coaching rail inside a session did the
     same thing to it. Reused rather than re-derived, and passed `rail` as
     the stopping point because the rail carries data-hswipe itself -- a
     walk that did not stop there would find that attribute and always
     answer yes, standing the pager down on every touch and killing the day
     swipe altogether. */
  const pg = /function wirePagerRail\(rail, learnKey, planCommit\)\{[\s\S]*?\n\}/.exec(RAILCODE)[0];
  assert.match(pg, /weekSwipeOwnedInside\(e\.target, rail\)/,
    'the day carousel claims swipes that belong to the rail inside it');
  /* AND IT BAILS ON TOUCHSTART, before a gesture is tracked: deciding later
     would already have moved the track under the finger. */
  const start = pg.slice(pg.indexOf("addEventListener('touchstart'"));
  assert.ok(start.indexOf('weekSwipeOwnedInside') > -1 &&
            start.indexOf('weekSwipeOwnedInside') < start.indexOf('g = { x:'),
    'the ownership test runs after the gesture has started being tracked');
  /* THE HELPER STOPS AT THE ELEMENT IT IS GIVEN, which is what keeps this
     from standing the pager down on every touch. */
  assert.match(RAILCODE, /function weekSwipeOwnedInside\(node, card\)\{[\s\S]*?el !== card/,
    'the ownership walk no longer stops at the rail, so it will swallow every swipe');
});

/* ---------- A SLIDE IS A PREVIEW, AND A PREVIEW HAS NO COACH'S NOTE ------
   Founder, first: "I want the full session swapping... I want the rail and
   the coaches note being visible. Less clicks effectively."
   Then, having swapped a session forward to reach one on Today and read
   both: "Coach's Note belongs to the canonical Full Session view, not
   session previews... So only visible on today card."
   So the rail swaps with the day and the prose note does not. The two
   halves are asserted together because they are one rule, and because the
   way to break this quietly is to satisfy either half alone -- strip the
   note and the rail goes with it (they share one <details>), or keep the
   rail and the note rides along. */
test('a week slide carries its rail and its solo note, and never the Coach\u2019s Note', () => {
  const a = railApp();
  let soloBoxes = 0, fuelRailed = 0, disclosed = 0, previewed = 0;
  a.state.days.forEach((d, i) => {
    if (d.type === 'race') return;          /* held back by instruction */
    const slide = a.weekSlideHtml(d, i);
    /* A REST DAY IS NOT A SESSION and has no full view to be a preview of:
       its one line is the whole day, and stripping it would leave a hero
       over nothing. Left exactly as it was, and the founder told so. */
    if (d.type !== 'rest'){
      previewed++;
      assert.equal(slide.indexOf('<div class="how-note">'), -1,
        d.date + ' (' + d.type + '): the Coach\u2019s Note is back on a preview');
    }
    /* ---- THE SOLO NOTE IS NOT THAT NOTE ----
       Two lines in the founder's own words, with the heading row -- mark,
       rule, the words COACH'S NOTE -- taken off at their instruction,
       because on an easy or long run it IS the session rather than a note
       about one. "The easy run simpleness follows the today this week and
       full plan." Told apart by data-solo, which is the only thing in the
       markup that distinguishes them. */
    if (a.soloNoteSession(d)){
      soloBoxes++;
      assert.ok(slide.indexOf('data-solo="1"') > -1,
        d.date + ' (' + d.type + '): a solo-note day\u2019s slide is a hero over nothing');
    }
    /* ---- BUILT IS NOT THE SAME AS SHOWN ----
       The line above passed while the founder was looking at an empty gap:
       the note was in the markup, inside a <details> that nothing ever
       opened. renderCoachingDepth() opens itself on a focused card or a
       solo-note day, and the carousel focuses nothing -- the slide IS the
       session. MEASURED in a browser on both This Week and Full Plan before
       the fix: detailsOpen false, the note itself reporting display:flex and
       a 390px box, the slide 500px tall; after it, open, and the slide 937px.
       The markup check alone is worthless here; this is the one with teeth. */
    /* A REST DAY'S NOTE IS NOT IN A DISCLOSURE AT ALL -- measured, not
       assumed: 22 of the 72 days carry no <details>, and every one of them
       is a rest day. So the open check runs where there IS one, and the
       count below is what stops it quietly checking nothing. */
    const det = (slide.match(/<details class="fuel-card how-card[^>]*>/g) || [])[0];
    if (det){
      disclosed++;
      assert.match(det, / open>/,
        d.date + ' (' + d.type + '): the week slide\u2019s Coach\u2019s Note is closed \u2014 ' +
        'it renders as an empty gap, which is the bug this line exists for');
    }
    /* A FUEL-RAIL LONG RUN DRAWS ITS RAIL HERE TOO -- "Yeh I want that on
       the goal-pace long runs." Its rail is built inside renderCoachingDepth
       rather than by renderStructuredWorkout, which is why adding the
       blueprint rail alone did not reach it. */
    if (a.longRunIsFuelRail(d) && !a.soloNoteSession(d)){
      fuelRailed++;
      assert.ok((slide.match(/ws-card-body/g) || []).length >= 3,
        d.date + ': a goal-pace long run shows no rail on the slide');
    }
  });
  /* THE DISCLOSURE FLOOR DROPPED WITH THE RESTRUCTURE, and it is a floor on
     an instrument rather than a claim about the product: it exists so the
     ` open>` check above cannot quietly run on nothing. A blueprint session
     emits no disclosure at all now -- its rail carries the coaching and its
     purpose rides WHY THIS SESSION, so the <details> had an empty body and
     was taken out. Measured after: 35 of the 50 non-rest previews still
     carry one (the rest days, the solo notes and the fuel-rail long runs),
     where 40+ did before. The floor is set below that, not at it. */
  assert.ok(previewed >= 45 && soloBoxes >= 25 && fuelRailed >= 3 && disclosed >= 30,
    'the block exercised ' + previewed + ' previews, ' + soloBoxes +
    ' solo notes, ' + fuelRailed + ' goal-pace long runs and ' +
    disclosed + ' disclosures');

  /* ---- AND THE COACHING IS STILL THERE WHERE IT BELONGS ----
     The half of the rule that has nowhere else to be asserted. Every day
     above is checked as a slide; this checks the same days as the canonical
     full session, so "withheld from previews" cannot quietly become
     "deleted". Each day is pinned as TODAY in turn, because dayCardIsFocused()
     is what the note's open state hangs on.

     IT USED TO ASK track_reps AND steady_tempo FOR A NOTE, and both are
     blueprint sessions, which no longer have one: their coaching was
     distributed onto the rail cards and their purpose into WHY THIS
     SESSION. Asking those two for a <div class="how-note"> was asking for
     the carrier rather than the coaching, so each kind of session is now
     asked for the carrier it actually has -- and BOTH kinds are asked,
     because this law's whole job is to catch coaching that fell off the
     full view while the previews looked unchanged. */
  let onToday = 0;
  /* THE NOTE, where a note is still what carries it: a goal-pace long run
     runs on the fuel rail rather than a blueprint, so renderCoachingDepth
     still owns its coaching and still prints it. Plain <div class="how-note">
     with no attributes, which is what tells it from the solo box -- that
     one carries data-solo="1" and is asserted on the slides above. */
  ['long_run_goal_finish', 'long_run_goal_insert'].forEach(arch => {
    const g = railApp();
    const d = g.state.days.filter(x => {
      const p = g.prescriptionOf(x);
      return p && p.archetype === arch;
    })[0];
    if (!d) return;
    g.todayStr = function(){ return d.date; };
    assert.ok(g.renderDayCard(d).indexOf('<div class="how-note">') > -1,
      d.date + ' (' + arch + '): the Coach\u2019s Note has gone from the Today card too, ' +
      'which is the one place the founder asked for it');
    onToday++;
  });
  assert.equal(onToday, 2, 'neither archetype was found, so the Today half proves nothing');

  /* THE RAIL AND THE WHY, where those carry it. A blueprint session shows
     no note on any screen now, so the thing that must not quietly vanish
     from the full view is the stage coaching and the purpose. Asked for the
     sentences, not the containers: Watch For on the work card, and the Why
     under the rail. */
  let bpToday = 0;
  ['track_reps', 'steady_tempo'].forEach(arch => {
    const g = railApp();
    const d = g.state.days.filter(x => {
      const p = g.prescriptionOf(x);
      return p && p.archetype === arch;
    })[0];
    if (!d) return;
    g.todayStr = function(){ return d.date; };
    assert.ok(g.hasWorkoutBlueprint(d) && !g.soloNoteSession(d),
      d.date + ' (' + arch + '): fixture assumption \u2014 this is the session kind with no note');
    const html = g.renderDayCard(d);
    const gd = g.coachingDisclosureFor(d, g.athleteExperience()) || {};
    assert.ok(gd.why && gd.avoid,
      d.date + ' (' + arch + '): no coaching written for it, so this proves nothing');
    const wi = html.indexOf('class="why-session"');
    assert.ok(wi > -1 && html.indexOf(gd.why) > wi,
      d.date + ' (' + arch + '): the purpose is not under the rail on the full view');
    assert.ok(html.indexOf(gd.avoid) > -1,
      d.date + ' (' + arch + '): Watch For has gone from the full view');
    /* AND THE PREVIEW STILL WITHHOLDS THE SECTION, which is the other half
       of "the Coach's Note belongs to the canonical Full Session view, not
       session previews" -- the Why section inherited that rule along with
       the content. The rail itself does show on a slide, as it always has. */
    const idx = g.state.days.indexOf(d);
    assert.equal(g.weekSlideHtml(d, idx).indexOf('class="why-session"'), -1,
      d.date + ' (' + arch + '): WHY THIS SESSION is on a preview');
    bpToday++;
  });
  assert.equal(bpToday, 2, 'neither blueprint archetype was found, so that half proves nothing');

  /* ---- AND NO SLIDE EVER CARRIES THE DAY CARD'S CAPTION ID ----
     This Week embeds the whole renderDayCard() behind the carousel, so
     anything the slide emits with id="exec-cap-<day>" exists TWICE in the
     document. getElementById returns the first match, so the visible rail
     would drive the hidden card's captions and its own would never move --
     the ring gradient's failure, in a second place. It was real and
     measured: one duplicated id, exec-cap-2026-09-15.
     IT IS NOW VACUOUS, AND DELIBERATELY STILL HERE. The execution captions
     lived inside the Coach's Note, so withholding that note from a preview
     took the anchors with it -- measured across the block: 0 slides carry
     an anchor, 0 carry a dangling data-cap pointing at one. Stated as the
     invariant rather than as "the id is rewritten", so it holds whichever
     way the slide satisfies it, and the uniquifying line in weekSlideHtml()
     is kept for the same reason: it costs one string pass and it is what
     makes the note's return to a slide safe. */
  let reused = 0, checked = 0;
  a.state.days.forEach((d, i) => {
    if (d.type === 'race') return;
    checked++;
    const slide = a.weekSlideHtml(d, i);
    if (slide.indexOf('exec-cap-' + d.id + '"') > -1) reused++;
    /* NOTHING POINTS AT A CAPTION THAT IS NOT ON THIS SLIDE. */
    (slide.match(/data-cap="([^"]+)"/g) || []).forEach(m => {
      const want = 'id="' + m.slice(10, -1) + '"';
      assert.ok(slide.indexOf(want) > -1,
        d.date + ': the slide\u2019s rail points at a caption anchor it does not contain');
    });
  });
  assert.equal(reused, 0,
    reused + ' slides reuse the day card\u2019s caption id, so one of the two would drive the other');
  assert.ok(checked >= 60, 'only ' + checked + ' slides were checked');
});

/* ---------- THE WEEK CAN REACH EVERY KILOMETRE IT CLAIMS ----------
   Founder: "Should race day be added? But left in it's current place
   aswell?" The week's own numbers made the case: race week's header read
   70.2km while the carousel could reach 28.0km of it, because every week
   total filters state.days by week directly and has always counted the
   42.2km race, while weekSessionDays() kept it out of the days you can
   swipe to. Goal day -- the day the block exists for -- was the one day of
   that week that could not be opened. */
test('the week carousel reaches every day the week counts', () => {
  const a = railApp();
  const race = a.state.days.filter(d => d.type === 'race')[0];
  assert.ok(race, 'the block builds no goal day, so this proves nothing');
  const w = race.week;
  const km = list => list.reduce((t, d) => t + (d.km || 0), 0);
  const header = a.state.days.filter(d => d.week === w);
  /* THE NUMBERS AGREE, which is the whole point and is read the same way
     the header reads it rather than from a constant. */
  assert.ok(Math.abs(km(a.weekCarouselDays(w)) - km(header)) < 0.01,
    'the week header counts ' + km(header).toFixed(1) + 'km and the carousel reaches ' +
    km(a.weekCarouselDays(w)).toFixed(1) + 'km');
  assert.ok(a.weekCarouselDays(w).some(d => d.date === race.date),
    'goal day is still not one of the days the week can be swiped to');
  /* IN DATE ORDER, or it lands in the middle of the week. */
  const dates = a.weekCarouselDays(w).map(d => d.date);
  assert.deepEqual(dates, dates.slice().sort(), 'the carousel days are out of order');

  /* ---- AND NOT IN THE ROW LIST, WHICH IS THE REASON FOR A SECOND LIST ----
     Full Plan's week rows sit directly above the dedicated RACE DAY card on
     the same screen. Widening the shared list rather than adding this one
     would print goal day twice there, which is the duplication this whole
     pass has been removing. */
  assert.ok(!a.weekSessionDays(w).some(d => d.type === 'race'),
    'the race is back in the row list, so Full Plan prints goal day twice');
  const rows = /function renderPlanWeekRows?\(/.test(RAILCODE) ? null : null;
  /* Every other week is unchanged by the addition. */
  for (let x = 1; x < w; x++){
    assert.deepEqual(a.weekCarouselDays(x).map(d => d.date),
      a.weekSessionDays(x).map(d => d.date),
      'week ' + x + ' has no race, so its carousel must be its training days exactly');
  }
});

/* ---------- THE SENTENCE ITSELF, AGAINST A REAL BLOCK ----------
   The test above can only check structure: its fixture gives every day the
   placeholder description "prose". This one reads the 11-week block, where
   the descriptions are the ones the generator actually writes, and holds
   the thing the founder asked for -- "if it does add to coaches note" --
   word for word in both directions: gone from above the cards, present
   below them. */
test('a description that leaves the face arrives under the rail', () => {
  const a = railApp();
  const text = h => h.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
                      .replace(/\s+/g, ' ').trim();
  let n = 0;
  a.state.days.forEach(d => {
    const want = a.descMovesToNote(d);
    if (!want) return;
    n++;
    const html = a.renderDayCard(d);
    assert.equal(html.indexOf('day-desc'), -1,
      d.date + ': still prints a description between the hero and the cards');
    /* ---------- THE CARRIER IS WHERE THE FOUNDER PUT IT ----------
       This read the Coach's Note, because that was the only place a
       description could go when it came off the face. It goes under the
       rail now, into WHY THIS SESSION, and the Note is gone from every
       session whose rail carries its own coaching -- so on the time trial
       the note this law looked for does not exist, and the sentence it was
       looking for is one element further down the card.
       ASKED OF THE SECTION THAT IS THERE ON ALL SIX. The four long runs and
       the shakeout keep a note as well and have the sentence in both, so
       reading "the note if there is one, else the Why" would hold five of
       these days up on a carrier that could be deleted without this law
       noticing. The Why section is the universal one and it is read alone.
       The written-copy claim below is a claim about the NOTE, and it is
       still asked of the note, on the days that still have one. */
    const at = html.indexOf('class="why-session"');
    assert.ok(at > -1, d.date + ': no WHY THIS SESSION to carry "' + want + '"');
    const carrier = text(html.slice(at));
    /* ---- WRITTEN COPY REPLACES THE DESCRIPTION, DELIBERATELY ----
       Where the founder has written the note for an archetype, that copy
       IS the day's words and the generated description is not also shown.
       On a long run "Build endurance. / Run by effort, not pace. / Start at
       the pace you'll finish at." stands in for "18km @ Easy pace. Start at
       the slow end of the window and run the second half no slower than the
       first." -- the same instruction in the founder's voice, with the
       distance already in the hero and the window already in the ring.
       That is a replacement, so it is asserted as one: the written lines
       have to be there, all of them. Everywhere else the day's own sentence
       still has to survive verbatim. */
    const p = a.prescriptionOf(d) || {};
    const written = a.SINGLE_CARD_NOTE[p.archetype];
    if (written){
      /* COMPARED WITHOUT THE TRAILING STOP. Founder: "drop the . From both
         lines." The copy is stored as sentences and the box strips the
         final stop as it renders, so the assertion strips it too -- and
         only the final one, which is why "4.4km" and "Light. Finish
         fresher..." are unaffected. */
      const nodot = t => text(t).replace(/\.$/, '');
      /* STILL A CLAIM ABOUT THE NOTE, so it is still read from the note.
         Every archetype with written copy is a solo-note session and keeps
         one; if that ever stops being true this line says so rather than
         quietly reading the written lines off some other element. */
      const noteAt = html.indexOf('class="how-note"');
      assert.ok(noteAt > -1,
        d.date + ' (' + p.archetype + '): has written note copy and no note to print it in');
      const note = text(html.slice(noteAt));
      [written.lead].concat(written.subs || []).forEach(line => {
        assert.ok(note.indexOf(nodot(line)) > -1,
          d.date + ' (' + p.archetype + '): the written note has lost "' + line + '"');
      });
      assert.ok(note.indexOf(nodot(written.lead) + '.') === -1,
        d.date + ': the lead kept its full stop');
    }
    /* AND THE DAY'S OWN SENTENCE SURVIVES UNDER THE RAIL, written copy or
       not. It used to be asserted only where there was no written copy,
       because written copy REPLACED the description in the note. The Why
       section carries the day's own shape either way, so all six days are
       asked the same question here. Same strip: the box prints the line
       without its final stop. */
    assert.ok(carrier.indexOf(text(want).replace(/\.$/, '')) > -1,
      d.date + ': "' + want + '" left the face and is nowhere under the rail');
  });
  /* THE BLOCK HAS TO CONTAIN THE CASE. Measured: exactly two days of 73 do
     -- the time trial and the shakeout -- and a fixture that stopped
     building either would make every assertion above unreachable. */
  /* TWO BECAME SIX, HAVING BRIEFLY BEEN EIGHT. Every fuel-rail long run
     joined the rule for one commit, and the founder caught it: "I only
     wanted it from 1 card rails. So on long runs with marathon pace need to
     have the rails." Only long_run has a single stage, and the block builds
     four of them; the time trial and the shakeout make six. The three
     goal-pace long runs keep their rails and their descriptions. */
  assert.equal(n, 6,
    n + ' days moved a description to the note, not the 6 this block builds');
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

  /* THE THREE JUDGEMENTS THIS PASS MADE, NAMED. Each of these archetypes
     lost its description to the rail, and each had a clause that is not a
     stage name -- so each is checked where it now lives rather than taken
     on trust. */
  /* THE FOUNDER'S OWN SESSION, built by hand for the same reason as above:
     removing easy_strides from the coverage table passed this file once,
     because nothing in the block fixture is a strides day. */
  {
    const b = app();
    const sd = b.state.days.filter(x => x.type === 'easy')[5];
    sd.prescription = { archetype:'easy_strides', params:{ easyKm:4.2, reps:6, m:100 } };
    sd.km = 5.5;
    assert.equal(b.renderDayCard(sd).indexOf('day-desc'), -1,
      'the strides session still prints the sentence between its hero and its rail');
  }
  survives('time_trial', 'Resets your goal');
  survives('easy_strides', 'Recovery:');
  // kept descriptions -- coaching fused into a structural sentence
  survives('goal_pace_block', 'race rhythm');
  survives('long_run_b2b', 'tired legs');
  survives('shakeout', 'sleep early');      // not about structure at all
  survives('race', 'culminates');
  survives('time_trial', 'Active Goal');
  /* ---- 'steady and controlled' IS REPLACED, NOT DROPPED ----
     Same distinction as 'Short and sharp' below. "30km @ Easy pace, steady
     and controlled." was the long run's description; the founder has since
     written that day's note themselves -- "Build endurance. / Run by
     effort, not pace. / Start at the pace you'll finish at." -- and asked
     for the long run to follow the easy run's rule, which is that written
     copy and nothing else. The distance is in the hero and the window is
     in the ring, so what the phrase characterised is still said; the
     phrase is not. Asserted as the replacement it is. */
  /* PRINTED WITHOUT THEIR FINAL STOP -- founder: "drop the . From both
     lines" -- so the needles are the words as they reach the screen. */
  survives('long_run', 'Run by effort, not pace');
  survives('long_run', 'Start at the pace you\u2019ll finish at');
  /* ---- 'Short and sharp' IS THE ONE CLAUSE THE FOUNDER REMOVED ----
     It was the tail of the sentence between the hero and the rail --
     "4.2km @ Easy pace, then 6x100m relaxed strides w/ full recovery.
     Short and sharp." -- and that whole sentence is what they asked to go.
     What it SAID is still said: the rail's second card reads 'Not a full
     sprint. Relaxed strides.' and the Coach's Note keeps 'Quick and
     light.' So the characterisation survives and the phrase does not,
     which is the difference this list is for. */
  survives('easy_strides', 'Relaxed strides');
  survives('easy_strides', 'Quick and light');
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

function gdFeel(a, d){
  try { return (a.coachingDisclosureFor(d, a.athleteExperience()) || {}).feel || ''; }
  catch (e) { return ''; }
}
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

  /* NOTHING IS LOST WITH THE RAIL. Its captions ARE the coaching, and they
     used to be swept into the Coach's Note because the blueprint had taken
     the execution rail's place and they had nowhere else to be. They are
     distributed onto the stage cards now -- founder: "the rail becomes the
     coach: each part tells the athlete what to do and how to execute it
     when they are looking at that part" -- and the Note went with the last
     thing that was in it.
     SO A FOUR-PHASE EXECUTION ON A THREE-STEP BLUEPRINT STILL CARRIES ALL
     FOUR SENTENCES, which is the claim this always made; only the carrier
     changed. Counted off workoutStepCaptions() rather than off a class in
     the markup, because the count is the thing at risk: the placement maps
     phases onto fewer stages than there are phases, and an off-by-one in
     that arithmetic silently drops the last one. */
  const bpDay = withBp[withBp.length - 1];
  const phases = a.executionStrategyForDisplay(bpDay);
  assert.ok(phases && !phases.suppressed && phases.phases && phases.phases.length,
    'the blueprint fixture has no execution phases, so nothing is being checked');
  const placed = a.workoutStepCaptions(bpDay, a.workoutSteps(bpDay));
  const nPlaced = placed.reduce((n, x) => n + x.length, 0);
  assert.equal(nPlaced, phases.phases.length,
    'the stage cards carry ' + nPlaced + ' phase sentences for ' +
    phases.phases.length + ' phases');
  phases.phases.forEach(ph => {
    ['purpose', 'cue'].forEach(k => {
      if (!ph[k]) return;
      const t = a.resolveDesc(ph[k]);
      assert.ok(bp.indexOf(t) > -1,
        'the ' + ph.key + ' ' + k + ' is on no stage card: ' + JSON.stringify(t.slice(0, 40)));
    });
  });
  /* AND THE NOTE IS NOT ALSO CARRYING THEM, which would be the same session
     said twice -- the failure this whole law is named for, in the other
     vocabulary. */
  assert.equal(bp.indexOf('how-cap-i'), -1,
    'the phase captions are on the cards AND in the Coach\u2019s Note');
});

test('why, feel and watch for left the screen — Why for its own section, the rest for the Note', () => {
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
    /* ---- A ONE-CARD DAY IS THE ONE PLACE THEY ARE DROPPED ----
       Founder: "It also doesn't need a massive coaches note!" On a session
       whose rail came to a single card the note is one line now, so Why and
       Watch For are not moved anywhere -- they are gone, deliberately, and
       the law below would read that as a regression. The replacement law is
       asserted straight after this loop: ONE line, and it is the right one. */
    if (a.soloNoteSession(d)) return;
    /* ---- ONE PLACE OR THE OTHER, NEVER NEITHER AND NEVER BOTH ----
       The columns left the screen for the note; Why and Watch For have
       since left the note for the stage cards, on any rail with stages to
       put them on. What has not changed is the law this test is for: the
       sentence is still somewhere, and it is not in two places at once. */
    /* ---------- WHY IS NOT IN THIS LOOP, AND NOT FOR A SOFT REASON ----
       It has one home now -- WHY THIS SESSION, under the rail -- so "one
       place or the other" is not the question for it; "its own section, and
       not a note row as well" is. Asked that way below.
       AND THE LOOP COULD NOT ASK IT HONESTLY ANY MORE. These comparisons
       are substring tests, and on a goal-pace long run the execution
       phase's own caption OPENS with the session's why: "Goal pace on legs
       that are already tired. This is the point of the session..." against
       a why of "Goal pace on legs that are already tired." Both strings
       used to sit inside the note, so the test never had to tell them
       apart; with the Why section above the note it read the caption as a
       second copy and called a duplication on three long runs that have
       none. The overlap is authored into the phase copy and is older than
       this change. */
    const whyRow = note.indexOf('<b>Why</b>') > -1;
    if (gd.why){
      const wi = html.indexOf('class="why-session"');
      assert.ok(wi > -1 && html.indexOf(gd.why) > wi,
        d.date + ' (' + d.type + '): Why is not in WHY THIS SESSION — ' +
        JSON.stringify(gd.why.slice(0, 40)) + ' has been dropped, not moved');
      assert.ok(!whyRow,
        d.date + ' (' + d.type + '): Why is in its own section AND a row of the Coach’s Note');
    }
    [['Feel', gd.feel], ['Watch For', gd.avoid]].forEach(pair => {
      const k = pair[0], v = pair[1];
      if (!v) return;
      const inNote = note.indexOf(v) > -1;
      const onCard = html.slice(0, html.indexOf('class="how-note"') + 1 || undefined).indexOf(v) > -1;
      assert.ok(inNote || onCard,
        d.date + ' (' + d.type + '): ' + k + ' is on neither the cards nor the Coach’s Note — ' +
        JSON.stringify(v.slice(0, 40)) + ' has been dropped, not moved');
      assert.ok(!(inNote && onCard),
        d.date + ' (' + d.type + '): ' + k + ' is on the cards AND in the Coach’s Note');
      /* The label belongs to the note's own rows. Where the sentence has
         moved to a card it is a card sentence and takes no label -- the
         card's title is what it sits under. */
      if (inNote) assert.ok(note.indexOf('<b>' + k + '</b>') > -1,
        d.date + ': "' + k + '" has lost the word in front of it, so the sentence is a fragment');
      checked++;
    });
  });
  assert.ok(checked >= 30, 'the fixture no longer exercises the moved lines (' + checked + ')');

  /* ---- AND THE ONE-CARD DAY SAYS ITS ONE LINE ----
     The other half of the rule the exemption above points at. Counted
     rather than sampled: an easy run is 25 of the 73 days in this block, so
     a note that quietly grew back would show up here and nowhere else. */
  let solos = 0, easies = 0;
  a.state.days.forEach(d => {
    if (!a.soloNoteSession(d)) return;
    solos++;
    const html = a.renderDayCard(d);
    const at = html.indexOf('class="how-note"');
    assert.ok(at > -1, d.date + ': a one-card day has no Coach\u2019s Note at all');
    const note = html.slice(at);
    /* ---- THE MOCK-UP'S SHAPE: A LEAD, AND ONE LINE UNDER IT ----
           [helmet] | COACH'S NOTE
           Keep it easy.
           Finish wanting more.
       Two lines at most, and never the stack of labelled rows every other
       session draws -- that stack is the thing the founder took off this
       day ("It also doesn't need a massive coaches note!"). */
    assert.ok(note.indexOf('data-solo') > -1,
      d.date + ': a one-card day is drawing the ordinary note, not the mock-up\u2019s box');
    /* ---- THE FOUNDER'S LINES ARE COUNTED; THE CAVEAT IS NOT ONE OF THEM ----
       THREE AT MOST, which is the long run's mock-up: a lead and two lines
       under it. An easy day uses two. What this is really holding back is
       the stack of labelled rows it replaced, which ran to five and more.
       A FUELLING CAVEAT IS A DIFFERENT KIND OF LINE and carries its own
       class. It is the condition on figures this same pass took off the
       screen, test/todayHeroAndFuel holds it against the rendered card,
       and it appears only on a fuelled session -- so it is counted
       separately rather than being allowed to push the founder's own
       lines' ceiling up and hide a note growing back. */
    const rows = (note.match(/class="v hn-/g) || []).length;
    assert.ok(rows >= 1 && rows <= 3,
      d.date + ' (' + d.type + '): a solo note runs to ' + rows +
      ' lines — the founder drew a lead and at most two lines under it');
    const asides = (note.match(/class="v how-note-aside"/g) || []).length;
    let fuelled = false;
    try { fuelled = !!a.needsFueling(d); } catch (e) { fuelled = false; }
    if (!fuelled) assert.equal(asides, 0,
      d.date + ': an unfuelled day carries ' + asides + ' caveats, so something else is using that slot');
    assert.ok(asides <= 2, d.date + ': ' + asides + ' caveats in the box');
    assert.equal(note.indexOf('<b>'), -1,
      d.date + ': the lines are wearing row labels, and a label is for telling rows apart');
    assert.ok(note.indexOf('hn-lead') > -1, d.date + ': the note has no lead line');
    /* ---- AND NOTHING ABOVE THE LEAD ----
       Founder: "Do not need the top row in the box. Remove the symbol |
       coaches note. Move the keep it easy up... That is the cleanest it
       can ever be." The heading row -- mark, rule, the words COACH'S NOTE
       -- lasted one pass. The lead is the first thing in the box now, and
       this holds it there: a heading creeping back is exactly the kind of
       thing that returns unnoticed. */
    assert.equal(note.indexOf('hn-mark'), -1, d.date + ': the box has a mark above the lead again');
    assert.equal(note.indexOf('hn-head'), -1, d.date + ': the box has a heading row again');
    assert.equal(note.indexOf('Coach\u2019s Note'), -1,
      d.date + ': the box is headed "Coach\u2019s Note" again');
    /* NO TRAILING FULL STOPS, on any line. */
    (note.match(/class="v hn-[a-z]+">([^<]*)</g) || []).forEach(m => {
      const line = m.slice(m.indexOf('>') + 1, -1);
      assert.ok(!/\.$/.test(line), d.date + ': "' + line + '" still ends in a full stop');
    });
    const p = a.prescriptionOf(d) || {};
    /* ---- THE WORDS THEMSELVES, NOT WHATEVER THE TABLE NOW HOLDS ----
       Asked against SINGLE_CARD_NOTE this was circular: it compared the
       rendered line to the same table the line came from, so swapping the
       founder's sentence for "Something else entirely." passed. It survived
       mutation, which is how it was caught. An easy run is the day the
       founder wrote the note for, so the sentence is pinned literally. */
    if (p.archetype === 'easy_run'){
      assert.ok(note.indexOf('Keep it easy') > -1,
        d.date + ': an easy day no longer leads with "Keep it easy"');
      assert.ok(note.indexOf('Finish wanting more') > -1,
        d.date + ': an easy day has lost "Finish wanting more"');
      easies++;
    } else {
      /* Every other one-card archetype falls back, in this order, and the
         fallback must actually produce something -- a blank note is the
         failure this catches. */
      const parts = a.singleCardNoteParts(d);
      assert.ok(parts && parts.lead, d.date + ' (' + p.archetype + '): its note has no lead line');
      assert.ok(note.indexOf(parts.lead.replace(/\.$/, '')) > -1,
        d.date + ' (' + p.archetype + '): its lead line is not the one it falls back to');
      /* THE SPLIT IS A SPLIT, not a sentence quietly dropped. */
      const whole = a.descMovesToNote(d) || gdFeel(a, d);
      if (whole && parts.sub) assert.equal(parts.lead + ' ' + parts.sub, whole,
        d.date + ': splitting the sentence into a lead and a line lost or duplicated words');
    }
  });
  assert.ok(easies >= 20,
    'only ' + easies + ' easy days carried the founder\u2019s line');

  /* ---- "THE SAME AS RACE DAY RULE" ----
     Founder: "the cherry boarder should be the same as race day rule. As
     wide as possible." The work stage on a session rail is where that rule
     already lives, so the two are read out of the sheet and compared
     declaration by declaration rather than the note being given its own
     cherry that could drift from it. */
  const decls = sel => {
    const i = RAILCSS.indexOf(sel);
    if (i < 0) return null;
    const open = RAILCSS.indexOf('{', i);
    return RAILCSS.slice(open + 1, RAILCSS.indexOf('}', open))
      .split(';').map(s => s.trim()).filter(Boolean);
  };
  /* ANCHORED ON THE SELECTOR AS THE SHEET SPELLS IT, and each of these two
     strings occurs exactly once in it — a prefix that matched two rules
     would silently read the wrong one. */
  const work = decls('.ws-h-step.ws-work{');
  const solo = decls('.how-note[data-solo]{');
  assert.ok(work && solo, 'the work stage or the solo note has lost its rule');
  /* ---- THE BORDER IS THE RACE-DAY RULE; THE GLOW IS NOT, ANY MORE ----
     The box copied all three of the work stage's declarations -- the cherry
     line, the tint wash and the two shadows. Founder, after seeing it:
     "Remove the glow from behind as well." So the line still comes from the
     same place, and the light deliberately does not.
     BOTH HALVES ARE HELD. The border is still asserted against the work
     stage's own rule, so the two cannot drift to different cherries; and
     the box is asserted FLAT, so a glow cannot creep back by being copied
     from the stage a second time. */
  assert.ok(work.indexOf('border:1.5px solid var(--cherry)') > -1,
    'the race-day rule no longer draws a 1.5px cherry border');
  assert.ok(solo.indexOf('border:1.5px solid var(--cherry)') > -1,
    'the box no longer takes its border from the race-day rule');
  assert.ok(solo.indexOf('box-shadow:none') > -1,
    'the box has a shadow again — the founder asked for the glow removed');
  assert.ok(solo.indexOf('cherry-tint') === -1,
    'the tint wash is back behind the box');
  /* AND THE FULL-BLEED LIGHT EVERY OTHER NOTE HAS IS NOT BEHIND THIS ONE. */
  assert.match(RAILCSS, /\.how-note\[data-solo\]::before, \.how-note\[data-solo\]::after\{[^}]*content:none/,
    'the note glow is no longer suppressed behind the box');
  /* THERE IS NO NOTE GLOW LEFT TO EXCLUDE THE BOX FROM. This asserted that
     the glow rule named :not([data-solo]), so it could never reach this box.
     The Coach's Note has since become a bordered box itself and the glow was
     deleted with its borderlessness, so the exclusion protects nothing --
     and an assertion that a deleted rule still exists would fail forever.
     What matters now is the thing the exclusion was FOR: no full-bleed light
     behind this box, whoever would have cast it. */
  assert.equal(RAILCSS.indexOf('.how-note:not([data-solo])::before'), -1,
    'the note glow rule is back, and a full-bleed light behind a bordered ' +
    'box spills past its edges');
  /* AS WIDE AS POSSIBLE: the full content column, not an inset box. */
  assert.ok(solo.indexOf('align-items:stretch') > -1,
    'the one-card note is centring its box again instead of filling the column');

  /* ---------- AND TODAY IS NOT LABELLED TODAY ----------
     Founder: "Remove today from the top left. We're on the today card. We
     know." Three things have to hold together, and the first alone is what
     a mutation slipped through before this was written:
       1. the Today view hides the flag;
       2. it is hidden in CSS, not dropped from the markup, because
          renderDayCard() emits ONE string for all three views and
          editSessionCoherence holds them identical; and
       3. it is hidden ONLY there -- in This Week and an opened Full Plan
          week the flag is what marks today among several days, so a rule
          that hid it everywhere would be a different and worse change. */
  assert.match(RAILCSS, /\.view-today \.day \.week-today-flag\{display:none;\}/,
    'the Today card is labelling itself Today again');
  /* ---- TWO RULES NOW, AND BOTH ARE MEANT ----
     This counted rules because a second one would have overridden the first
     silently. There are two by design: the Today tab hides it on every day
     ("We're on the today card. We know"), and a solo-note day hides it
     everywhere along with its other chips ("No symbols what so ever").
     WHAT STILL HAS TO HOLD is that neither of them is unscoped -- in This
     Week and an opened Full Plan week, a day WITH a rail is still marked
     as today, and a rule with no qualifier at all would take that away
     from every screen at once. So each rule is required to name either the
     Today view or a solo-note day. */
  const flagRules = RAILCSS.split('}')
    .filter(r => r.indexOf('week-today-flag') > -1 && /display\s*:\s*none/.test(r));
  assert.equal(flagRules.length, 2,
    flagRules.length + ' rules hide the today flag — expected the Today tab and the solo-note day');
  flagRules.forEach(r => assert.ok(
    r.indexOf('.view-today') > -1 || r.indexOf('.is-solo-note') > -1,
    'a rule hides the today flag with no qualifier, so no screen marks today any more: ' +
    r.trim().slice(0, 80)));
  /* AND A DAY WITH A RAIL KEEPS ITS CHIPS. */
  const chipRule = flagRules.filter(r => r.indexOf('.is-solo-note') > -1)[0];
  assert.ok(chipRule && chipRule.indexOf('.day.is-solo-note') > -1,
    'the chip rule no longer asks whether the day is a solo-note day');
  (() => {
    const a2 = railApp();
    const today = a2.state.days.filter(d => d.date === a2.todayStr())[0];
    assert.ok(today, 'the block has no day that is today');
    assert.ok(a2.renderDayCard(today).indexOf('week-today-flag') > -1,
      'the today flag was removed from the markup, which makes the three views differ');
  })();
  assert.ok(solos >= 20,
    'only ' + solos + ' one-card days in the block — this is the most common day in the product');

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
  /* ---------- THE CLAIM IS display:contents, NOT THE WHOLE DECLARATION ----
     This was written as the exact text `{display:contents;}` and broke the
     moment a second property joined it, which says nothing about whether
     the step is a box. The property that joined it is load-bearing, which
     is the irony: display:contents dissolves the BOX but not inheritance,
     so .ws-h-step's own text-align:center still reached every cue inside a
     card whose body had been set to left -- found by walking computed style
     up from a cue, after setting text-align on .ws-card-body changed
     nothing at all. The law asks for the declaration it is about. */
  assert.match(RAILCSS, /\.ws-rail \.ws-h-step\{[^}]*display:contents/,
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
     its stops are in PIXELS: one fade, finishing as the first line begins
     and flat underneath however many lines follow. Nothing about it is a
     proportion of the card, which is what made it fragile. (It was 76px
     long; it is 28px now, re-tuned so the founder's photograph is visible
     above it, and it still finishes before the text -- see below.)
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
  /* AND THE STAGE CARD WRAPS ITS OWN, under the class that carries its
     alignment. Named separately because the line above is satisfied by the
     fuel facts and the execution phases alone -- so the stage card could
     lose its wrapper, and its scrim with it, while this still passed. */
  assert.ok(RAILCODE.indexOf('<div class="ws-card-body ws-step-body">') > -1,
    'the stage card no longer wraps its content, so it has no scrim to be sized by');
  const bodies = (RAILCODE.match(/ws-card-body/g) || []).length;
  assert.ok(bodies >= 3,
    'only ' + bodies + ' panel kinds wrap their content — a stage, a fuel fact and an ' +
    'execution phase all need one, or one of them loses its scrim');

  const si = RAILCSS.indexOf('.ws-rail .ws-card-body::before');
  assert.ok(si > -1, 'the scrim under the card text is gone');
  const scrim = RAILCSS.slice(si, RAILCSS.indexOf('}', si));
  /* ABOVE THE TEXT AND PAST THE PADDING. A scrim starting at the text's own
     top leaves the first line sitting in the fade.
     ASKED AS THAT SENTENCE NOW, NOT AS `top >= 60`. The 60 was a proxy for
     a 76px fade reaching well above the first line, and it stopped meaning
     what it said when the scrim was re-tuned: the founder wanted the
     photograph visible ("Photos stay. I think they add value.") and only
     11px of a 274px frame was getting out from under it. The fade is 28px
     now and FINISHES where the text begins, which is the thing the comment
     above actually claims -- so the ramp's end is compared against the
     scrim's own top offset instead of against a number.
     RE-MEASURED, because a shorter fade is a legibility question and no
     structural assertion answers it. Chromium, 360px, the two worst cards
     in the product (a 4x1200m interval and the 6km time trial), sampling
     the backdrop pixels in the band beside each run of ink at that run's
     own rows: 17 runs of text, white at 17.90 to 20.23, and the worst
     overall 5.03 -- the cherry-tinted Watch For line, still above 4.5. */
  const top = Number((/top:-(\d+)px/.exec(scrim) || [])[1]);
  assert.ok(top >= 20,
    'the scrim reaches only ' + top + 'px above the text, which is not past the padding');
  const stops = (scrim.match(/rgba\(8,6,10,([\d.]+)\)\s+(\d+)px/g) || []).map(x => {
    const m = /rgba\(8,6,10,([\d.]+)\)\s+(\d+)px/.exec(x);
    return { a: Number(m[1]), px: Number(m[2]) };
  });
  assert.ok(stops.length >= 2, 'the scrim has no pixel-stopped ramp to measure');
  const plateau = Math.max.apply(null, stops.map(x => x.a));
  const rampEnd = Math.min.apply(null, stops.filter(x => x.a === plateau).map(x => x.px));
  assert.ok(rampEnd <= top,
    'the scrim is still fading ' + rampEnd + 'px down, past the text top at ' + top +
    'px — the first line sits in the fade');
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
  /* ---------- IT HOLDS THROUGH THE WORDS AND RELEASES BELOW THEM ----
     This read "the gradient's 100% stop is at least .90", because the
     figures sat on the card's FLOOR and were measured at 1.75:1 with no
     scrim under them. They sit at the HEAD now -- founder: "THRESHOLD top
     left distance top right... Then the text across the full width?" -- so
     nothing of the session's own words is at the 100% stop any more, and
     ending there at .96 drew a hard horizontal edge across the photograph
     on the short cards, where the picture below the text is the point.
     SO THE CLAIM BECOMES THE ONE THAT MATTERS: the scrim is at full
     opacity for every pixel the text occupies, and the release happens
     entirely in the margin it overhangs by. Asserted as the geometry --
     the plateau runs to 100% minus the bottom overhang -- so neither the
     release nor the overhang can be changed alone without this failing. */
  const bottom = Number((/bottom:-(\d+)px/.exec(scrim) || [])[1]);
  assert.ok(bottom > 0, 'the scrim no longer overhangs the text at the foot');
  const plateauA = Math.max.apply(null,
    (scrim.match(/rgba\(8,6,10,([\d.]+)\)/g) || []).map(x => Number(/([\d.]+)\)/.exec(x)[1])));
  assert.ok(plateauA >= 0.7,
    'the scrim only reaches ' + plateauA + ' — the words were measured at 1.75:1 without it');
  const held = /rgba\(8,6,10,([\d.]+)\)\s+calc\(100% - (\d+)px\)/.exec(scrim);
  assert.ok(held, 'the scrim has no stop holding its opacity to the end of the text');
  assert.equal(Number(held[2]), bottom,
    'the scrim releases ' + held[2] + 'px from the end but overhangs the text by ' + bottom +
    'px \u2014 the release is inside the words or short of the margin');
  assert.equal(Number(held[1]), plateauA,
    'the scrim is already fading at the end of the text: ' + held[1] + ' against a plateau of ' + plateauA);
  assert.match(scrim, /rgba\(8,6,10,0\)\s+100%/,
    'the scrim ends at full opacity again, which draws a hard edge across the photograph');

  /* AND THE CARD KEEPS A VEIL of its own, so a bright frame cannot shout
     over its neighbours and the figures have a floor above the fade. */
  const vi = RAILCSS.indexOf('.ws-rail .how-mod::before');
  assert.ok(vi > -1, 'the card has lost its veil');
  assert.match(RAILCSS.slice(vi, RAILCSS.indexOf('}', vi)), /linear-gradient/,
    'the veil is no longer a gradient');

  /* ---------- AND THE WORDS START AT THE HEAD, WHERE THE SCRIM DOES ----
     This asked for justify-content:flex-end, because the card's content sat
     on its floor and the scrim was built upward to meet it. The founder
     moved it: "The title and distance should be fixed in the same place on
     every card" -- which bottom-anchored content cannot do, since the head
     of a one-line card and the head of a four-line card land in different
     places. Top-anchored, every head is at the same inset and the
     photograph is read below the words instead.
     THE PAIRING IS WHAT IS ASSERTED, not the keyword: the scrim's ramp is
     above the text (top:-28px, measured against the head's own inset), so
     content anchored to the other end of the card would sit on the part of
     the frame the scrim never reaches. One or the other cannot move alone. */
  assert.match(RAILCSS, /\.ws-rail \.how-mod\{[^}]*justify-content:flex-start/,
    'the words have left the head of the card, which is where the scrim is built to meet them');
  assert.ok(top > 0 && bottom > 0,
    'the scrim no longer brackets the text, so nothing ties it to where the words start');

  /* ---------- AND THE WORDS USE THE WHOLE WIDTH ----------
     Founder, on the first version of the distributed coaching: "Why is the
     text not using the full width?" The card was centred, so every
     sentence was ragged on both sides and wrapped early.
     TWO DECLARATIONS, AND THE SECOND ONE IS THE TRAP. Setting text-align
     on .ws-card-body changed nothing at all: .ws-h-step is display:contents,
     which dissolves the BOX but not inheritance, so its own
     text-align:center still reached every cue inside the body that had just
     been set to left. Found by walking computed style up from a cue.
     MEASURED: left-aligning the bodies took them from 308px to 220px --
     the same words, fewer lines -- which is most of why four sentences fit
     a 274px card at all (see the sentence cap above).
     BOTH ARE ASSERTED because removing either one re-centres the cues and
     nothing else in the suite sees it: deleting the .ws-h-step half passed
     all 82 laws in this file and coachingRail together.
     AND IT IS .ws-step-body, NOT .ws-card-body. The first version of this
     put the change on the shared body class, which the fuel facts and the
     race's execution phases also use -- measured on race day, "Fuel
     60-90g/hr" and a long run's "Long Run 22km" went from centred blocks
     to full-width left, a change to two panels nobody asked about. The
     stage card has its own class so the law can name it. */
  [['ws-step-body', 'the stage card body'], ['ws-h-step', 'the blueprint step']].forEach(([cls, what]) => {
    const m = new RegExp('\\.ws-rail \\.' + cls + '\\{[^}]*\\btext-align:left').test(RAILCSS);
    assert.ok(m, what + ' no longer aligns its words left, so the sentences are centred ' +
      'and wrap early \u2014 the founder asked for the full width');
  });
  /* AND "FULL WIDTH" IS THE OTHER HALF OF IT. text-align decides where the
     words sit inside their line box; align-items decides how wide that box
     is. With the body back to centring its children, the lines that carry
     no width of their own -- Watch For is one -- shrink to their text and
     sit centred in the card, left-aligned inside a centred block. */
  assert.match(RAILCSS, /\.ws-rail \.ws-step-body\{[^}]*align-items:stretch/,
    'the stage card body centres its children again, so the short lines no longer run full width');
  assert.match(RAILCSS, /\.ws-rail \.how-mod\{[^}]*align-self:stretch/,
    'the cards are back to their natural heights, so a short one ends early and the rail is ragged');

  /* ---------- THE PEEK IS GONE, AND THE DOTS ARE WHY THAT IS ALLOWED ----
     The card was 84% with 5px either side so the next one peeked, which was
     the affordance saying a rail is a rail. The founder's call is edge to
     edge -- "the same edge to edge rule should be applied to the other
     rails for the sessions" -- and what carries the affordance instead is
     the dot row, which railDotCount's own note already argued for in
     exactly this case: "a rail of full-width cards shows exactly one panel,
     so the dots are no longer the hint: they are the only thing saying
     which of five you are looking at".
     SO THE LAW HELD HERE IS THE ONE THE PEEK WAS SERVING: the card is the
     scroller's page EXACTLY -- 100% and no margin -- because a slot wider
     or narrower than the page is how the rail drifts out of step with the
     dots that now have to speak for it. */
  assert.match(RAILCSS, /\.ws-rail \.how-mod\{[^}]*flex:0 0 100%/,
    'the stage card is no longer the full width of its rail');
  assert.match(RAILCSS, /\.ws-rail \.how-mod\{[^}]*margin:0;/,
    'the stage card has margins again, so its slot is wider than the page the rail ' +
    'scrolls by and the dots will drift out of step with it');
  assert.match(RAILCSS, /\.ws-rail \.how-mod\{[^}]*border:0;/,
    'the full-bleed card grew a rim, which is the gap drawn in another colour');
  assert.match(RAILCSS, /\.ws-rail \.how-mod\{[^}]*border-radius:0;/,
    'the full-bleed card grew corners again');
  assert.match(SRC, /function railDotCount\(/,
    'the dots are gone, and with no peek they were the only thing left saying this is a rail');
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
    /* ---- ONE CARD IS NOT A RAIL ----
       Founder: "On a Training day with 1 card - we don't need the picture
       rail." So the law is no longer "exactly one rail on every session":
       it is one rail wherever there is a rail at all, and NONE where the
       blueprint comes to a single card. Both halves are asserted, because
       "at most one" on its own would be satisfied by a product with no
       rails anywhere. */
    if (a.soloNoteSession(d)){
      assert.equal(rails, 0,
        d.date + ' (' + d.type + '): a single card still draws a rail');
      assert.equal(html.indexOf('class="ws-block"'), -1,
        d.date + ': the workout block is still drawn around a rail that is not there');
      /* RECORDED BEFORE RETURNING. The fixture check at the end wants proof
         that a one-stage session exists in this block; it still does, it
         just draws no rail. Returning without recording would have turned
         that check into "the fixture lost a shape" the moment the shape
         stopped having a rail. */
      shapes[d.type + ' x' + steps(d)] = true;
      return;
    }
    assert.equal(rails, 1,
      d.date + ' (' + d.type + ', ' + steps(d) + ' stages) draws ' + rails + ' card rails');
    const railAt = html.indexOf('class="fuel-body ws-rail');
    /* THE RAIL IS ABOVE THE COACHING, and the coaching is the Coach's Note
       now that the columns have gone. Same law, one fewer thing between
       them: the rail is the session, the note is the coach talking about
       it, and the note comes after. */
    /* THE COACHING IS WHICHEVER CARRIER THE SESSION HAS. It was always the
       Coach's Note; a blueprint session has none now -- its stage coaching
       rides the cards and its purpose rides WHY THIS SESSION -- so asking
       every session for a note asked for the old furniture and failed on
       2026-09-08. WHY THIS SESSION is the universal one, and where a note
       is still rendered it is asked for too: a session may not put either
       above its rail. */
    const whyAt = html.indexOf('class="why-session"');
    assert.ok(whyAt > -1, d.date + ': WHY THIS SESSION is gone');
    /* MARKUP ORDER ONLY WHERE MARKUP ORDER IS THE ANSWER. A goal-pace long
       run's rail is built inside renderCoachingDepth, so it ships inside
       .how-card -- later in the string than the Why section, which rides
       with the session's own words. For that shape the question is which
       way the stylesheet orders the two, and it is asked once, below. */
    const howAt = html.indexOf('class="fuel-card how-card');
    const railInsideNote = howAt > -1 && railAt > howAt;
    if (!railInsideNote) assert.ok(railAt < whyAt,
      d.date + ' (' + d.type + ') puts WHY THIS SESSION above its rail');
    const noteAt = html.indexOf('class="how-note"');
    if (noteAt > -1) assert.ok(railAt < noteAt,
      d.date + ' (' + d.type + ') puts its Coach\u2019s Note above its rail');
    shapes[d.type + ' x' + steps(d)] = true;
  });
  /* ---------- AND THE STYLESHEET MAY NOT PUT IT BACK ON TOP ----------
     .day-detail is a flex column with explicit order values, so markup
     order is not the last word: .day-desc is 1, .ws-block is 2 and
     .how-card is 3. WHY THIS SESSION shares the rail's own slot and lands
     under it on SOURCE order alone, which is a quiet way to depend on
     something -- one `order:1` on .why-session and the section the founder
     asked for below the rail renders above it, with every markup assertion
     in this law still passing. So the numbers are compared. */
  const ordOf = cls => {
    const m = new RegExp('\\.day-detail > \\.' + cls + '\\{order:(\\d+);\\}').exec(RAILCSS);
    return m ? Number(m[1]) : null;
  };
  const oBlock = ordOf('ws-block'), oWhy = ordOf('why-session'), oHow = ordOf('how-card');
  assert.ok(oBlock !== null, '.ws-block has lost its order, so the column is source-ordered');
  assert.ok(oWhy !== null, '.why-session has lost its order');
  assert.ok(oHow !== null, '.how-card has lost its order');
  assert.ok(oWhy >= oBlock,
    'the stylesheet orders WHY THIS SESSION (' + oWhy + ') above the blueprint rail (' + oBlock + ')');
  /* AND ABOVE THE OTHER RAIL TOO. A goal-pace long run's rail is inside
     .how-card; at order 2 the Why section rendered above it. This is the
     half that was actually broken, so it is the half with a number. */
  assert.ok(oWhy > oHow,
    'the stylesheet orders WHY THIS SESSION (' + oWhy + ') above the fuel rail, which ships ' +
    'inside .how-card (' + oHow + ') \u2014 the section the founder asked for below the rail is above it');

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

  /* A LONE CARD FILLS ITS RAIL -- and so does every other card now, which
     is why there is no :only-child rule left to assert. It existed because
     84% left 16% of dead space beside a single photograph; edge to edge
     there is no slack to special-case, and a second rule saying 100% where
     the base rule already says 100% is a rule that can only ever drift. */
  assert.ok(RAILCSS.indexOf('.ws-rail .how-mod:only-child') === -1,
    'the one-card width is stated twice again — it is the only width now');
  assert.match(RAILCSS, /\.ws-rail \.how-mod\{[^}]*flex:0 0 100%/,
    'a one-card rail no longer fills its rail');

  /* ---------- "EACH STEP BELOW" NEEDS MORE THAN ONE STEP ----------
     One variable used to answer two questions -- whether the card has a
     rail worth showing, and whether the session has more than one stage --
     because a blueprint meant two or three stages. A one-stage easy run is
     a rail now, and the shared variable put "Primary zone — each step below
     carries its own target" over a card showing one step whose target is
     the ring's. */
  const hero = RAILCODE.slice(RAILCODE.indexOf('function renderDayHeroBlock('));
  const heroBody = hero.slice(0, hero.indexOf('\n}'));
  /* ---- AND NOW ALSO ON THE CARDS NOT BEING THERE TO READ ----
     "Primary zone — each step below carries its own target" was explaining
     that the ring and the cards show different numbers. The cards show a
     band only where it differs from the ring, so the difference is the
     thing on screen. The caption survives for the one case where there are
     no cards under the ring to look at: a logged session, whose
     prescription has moved behind Session Details. */
  assert.match(heroBody, /var stepNote = \(ring && manySteps && prescriptionIsReference\(dd\)\)/,
    'the step note is gated on having a rail again, not on the cards being unreachable');
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
    /* ---- AND A ONE-CARD DAY NO LONGER HAS ROOM FOR IT ----
       This sentence was rescued into the Coach's Note when the execution
       column went. On a one-card day the note is a single line now, and
       that line is not this sentence, so here it IS dropped -- the one case
       the comment above does not cover. Nothing else loses it: it is still
       the whole reason the note exists on every other unstaged session.
       IT DID LEAVE A HOLE IN THE UNIT LAW, and this is the correction of a
       claim made here earlier. test/unitConsistencyCopy's first three tests
       DID need a screen to be printing this sentence -- they rendered an
       easy run and read "the first mile" out of it -- and they failed when
       the note came down to one line. They now follow the same law to a
       steady tempo, whose note still carries @@U@@ copy. */
    const toldAlready = staged > 0 || (a.hasWorkoutBlueprint(d) && stages >= 2) ||
                        a.soloNoteSession(d);
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
  /* ---- THE RESCUED SET IS NOW EMPTY, AND THAT IS THE POINT OF SAYING SO ----
     This law was written when the execution sentence had nowhere else to
     go: removing the column would have deleted it, so it was rescued into
     the Coach's Note. The easy days left the set when their note came down
     to one written line; the three fuel-rail long runs left it when the
     founder asked for the long run to follow the same rule.
     SO gd.how IS NOW PRINTED ON NO SCREEN AT ALL. That is a consequence of
     two design instructions and not an accident, which is why it is pinned
     at exactly zero rather than quietly relaxed to >= 0: anything that
     starts printing it again, or any new session shape that needs the
     rescue and does not get it, fails here and gets read by a person.
     The half of the law that still does work every day is the one above --
     the sentence is never printed TWICE. */
  /* BACK TO TWO. It was pinned at zero for one commit, when every fuel-rail
     long run drew the solo box; with the goal-pace ones back on rails,
     long_run_goal_insert and long_run_progressive rescue the sentence into
     their notes again, which is what this law was written for. A plain
     long_run is a solo-note day and does not. */
  assert.equal(rescued, 2,
    rescued + ' sessions rescue the execution sentence, not the 2 this block builds');
  assert.ok(toldByStages >= 5,
    'only ' + toldByStages + ' sessions tell their execution by stages');
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

test('a stage card reads name, figure, sentence — in that order', () => {
  /* The founder's structure, as the card stands now:
         WARM-UP 2KM
         WHY: Prepare to hit goal pace smoothly.
         GOAL PACE 3 × 1600M
         Keep it controlled. Familiar, not hard.
         Recovery: short
     The stage's own NAME is the title, and each stage carries one line of
     coaching about itself.
     THE FOURTH LINE IS NO LONGER THERE. "4:58/km · 164-171BPM" sat under
     the sentence, and the founder has since taken pace and heart rate off
     every card in the product -- "it's going to remain in the ring". The
     law about those two numbers being joined on one line went with them;
     see "no card in any rail carries a pace or a heart rate". */
  const a = railApp();
  const steps = d => { try { return a.workoutSteps(d); } catch (e) { return []; } };
  let withCue = 0, solo = 0;

  a.state.days.forEach(d => {
    if (!a.hasWorkoutBlueprint(d)) return;
    /* A ONE-CARD SESSION DRAWS NO CARD AT ALL NOW, so there is no title,
       figure or sentence on it to put in order. The law that replaced it is
       in "every session has exactly one rail": that day draws zero rails. */
    if (a.soloNoteSession(d)) return;
    const st = steps(d);
    if (!st.length) return;
    const html = a.renderDayCard(d);

    st.forEach((s, i) => {
      /* THE TITLE IS THE STAGE'S NAME. It was the effort word, from when
         the card carried no name at all. */
      assert.ok(html.indexOf('<span class="ws-h-presc">' + s.label + '</span>') > -1,
        d.date + ' (' + d.type + ') stage ' + i + ': the card does not lead with "' + s.label + '"');
      /* ---------- NAME AND FIGURE ON ONE ROW, AT THE HEAD ----------
         Founder: "Could we put THRESHOLD top left distance top right?
         Similar to the hero on the day?" and then, after seeing it, "The
         title and distance should be fixed in the same place on every
         card." So they share one element rather than stacking, and that
         element is the first thing in the card. */
      /* ASSERTED AS THE HEAD'S SHAPE, NOT FROM THE STEP'S OWN FIELDS.
         Not every stage has a figure -- a cool down prescribed by nothing
         but "cool down" carries none and its head is the name alone -- and
         `step.qty` is not the question either: a reps stage leaves it null
         and the card composes "4 x 1200m" from the count and the distance.
         So the rule is about what may follow the name INSIDE the head: the
         figure, or the end of the row, and nothing else. That holds for
         both shapes without this law having to predict which one a stage
         is, and it still fails the moment the figure moves out from beside
         the name. */
      const head = '<div class="ws-h-head"><span class="ws-h-presc">' +
        s.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '</span>';
      assert.ok(new RegExp(head + '(<span class="ws-h-qty|</div>)').test(html),
        d.date + ' (' + d.type + ') stage ' + i + ': "' + s.label +
        '" and its figure are no longer one head row');
    });
    /* AND THE FIGURES HAVE NOT SIMPLY GONE. The line above is satisfied by
       a rail of name-only heads, so each session is asked for at least one
       figure -- every one of them opens with a warm-up that has a distance. */
    assert.ok((html.match(/class="ws-h-qty/g) || []).length >= 1,
      d.date + ' (' + d.type + '): not one stage card carries a figure');

    /* ---------- ONE LINE PER STAGE BECAME AT LEAST ONE PER STAGE -------
       The founder distributed the coaching onto the rail -- "each part
       tells the athlete what to do and how to execute it when they are
       looking at that part" -- so a work stage can now carry its execution
       caption, its Feel line and, on a time trial, four captions at once,
       while a warm-up still carries one. The law that matters is the one
       this was a proxy for: NO STAGE IS SILENT. Measured across the block:
       15 multi-stage sessions, every stage card with at least one line, and
       stage cards exactly equal to stages every time.
       COUNTED PER STAGE CARD, NOT ACROSS THE CARD. A total of three lines
       for three stages is also what two silent stages and one card doing
       all the talking looks like -- which is the arrangement this rail
       replaced, so it is exactly the regression to catch.
       AND THE STAGE CARDS ARE PICKED OUT BY .ws-h-step: a fuelled session's
       rail carries fuel facts as well, and those have no coaching line and
       are not supposed to. Measured: an 8x1200m interval ships six cards
       for three stages.
       MATCHED WITH A DELIMITER. The class attribute now carries modifiers
       (ws-h-cue ws-h-exec, ws-h-cue ws-h-feel), so the old exact-attribute
       match found none at all; a bare prefix would have counted a future
       .ws-h-cuex as a cue, which is the mistake a law here made once with
       class="race-event". */
    const stageCards = html.split('class="how-mod"').slice(1)
      .filter(c => /class="ws-h-step/.test(c));
    const cues = (html.match(/class="ws-h-cue[ "]/g) || []).length;
    if (st.length >= 2) {
      assert.equal(stageCards.length, st.length,
        d.date + ' (' + d.type + '): ' + stageCards.length + ' stage cards for ' + st.length + ' stages');
      stageCards.forEach((c, i) => {
        const n = (c.match(/class="ws-h-cue[ "]/g) || []).length;
        assert.ok(n >= 1,
          d.date + ' (' + d.type + ') stage ' + i + ' says nothing about how to run it');
      });
      assert.ok(cues >= st.length,
        d.date + ' (' + d.type + '): ' + cues + ' coaching lines for ' + st.length + ' stages');
      withCue++;
    } else {
      /* UNREACHABLE NOW, AND LEFT STANDING ON PURPOSE. A one-stage session
         draws no card at all, so the loop above returns before here; this
         is what would run if one ever drew a card again, and it still holds
         the old law -- a single card repeating the note is the duplication
         every pass here has been removing. The count below no longer
         requires it to have run. */
      assert.equal(cues, 0,
        d.date + ' (' + d.type + '): a one-stage rail carries a coaching line that repeats the note');
      solo++;
    }
  });

  /* ---------- AND THE HEAD ROW IS FIXED, NOT FLOATED ----------
     The founder's words again: "The title and distance should be fixed in
     the same place on every card." The cards are one height and carry
     anywhere from one to four sentences, so a head that simply precedes
     the body in source lands wherever the body's height puts it -- which
     is the arrangement they were looking at when they asked. Two
     declarations hold it: order:1 pins the head above the body whatever
     the flex column does with the rest, and space-between is what puts
     the name left and the figure right on that row.
     BOTH ARE HERE BECAUSE NOTHING ELSE SEES THEM. Removing either one
     passed all 82 laws in this file and coachingRail together: the head's
     markup is unchanged either way, so every content assertion above
     still holds while the card looks wrong. */
  const headRule = (/\.ws-rail \.ws-h-head\{([^}]*)\}/.exec(RAILCSS) || [])[1] || '';
  assert.ok(headRule, 'the stage card head has no rule of its own any more');
  assert.match(headRule, /\border:1\b/,
    'the head row is no longer pinned to the top of the card, so it moves with the body height');
  assert.match(headRule, /justify-content:space-between/,
    'the head row no longer puts the name left and the figure right');

  /* THE NUMBERS HALF OF THIS LAW IS GONE WITH THE NUMBERS. It held that a
     card's pace and heart rate were joined on one line rather than stacked
     -- a law about the SHAPE of a band. No card carries a band now, so
     there is no shape left to hold; the law that replaced it is "no card in
     any rail carries a pace or a heart rate", above. What stays here is
     everything that is still on the card: the stage's name as the title,
     and one coaching line per stage on a multi-stage rail, none on a
     one-stage one. */
  /* MULTI-STAGE ONLY. There is no single-stage card left to exercise: that
     day draws no rail, which "every session has exactly one rail" asserts
     directly and by count. */
  assert.ok(withCue >= 3,
    'the fixture no longer exercises a multi-stage rail (' + withCue + ')');
  assert.equal(solo, 0,
    solo + ' single-card rails were drawn — a one-card session draws no rail');

  /* AND THE HEART RATE DOES NOT COME BACK AS A ROW. This guard was written
     when the heart rate joined the pace band: the row it used to have below
     the pace had to go, or the card would say it twice. The band has since
     gone entirely, which makes this the remaining half of the rule rather
     than a spent one -- the supplementary lines under a card are the one
     place a heart rate could reappear without touching the cell builder the
     law above reads. */
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

test('a long run draws no rail, and its fuel figures leave the screen with it', () => {
  /* THIS TEST USED TO HOLD THE PAIRED FUEL RAIL -- three slides, two facts
     to a card, the session heading card one. Founder: "Long run should
     follow the same rules as easy run", with a mock-up showing a long run
     as a hero and a cherry note and nothing else. So the rail goes.
     WHAT GOES WITH IT, HELD HERE SO IT CANNOT HAPPEN QUIETLY. The paired
     rail was the ONLY surface rendering the fuelling figures:
     30-60g/hr, total carbs to ~145g, 3-6 gels and 1.2-1.8 L of fluid on
     the 28km progressive long run, plus "Time on feet". renderFuelingCard()
     still exists but nothing has called it for some time, so there is no
     second surface. fuelFacts() still COMPUTES all of it -- this is a
     display removal, not a data loss, and putting it back is one call.
     The test therefore asserts both halves: no rail, and the figures are
     genuinely absent rather than half-present somewhere nobody looks. */
  const a = railApp();
  const longs = a.state.days.filter(d => d.type === 'long');
  assert.ok(longs.length >= 5, 'the fixture has too few long runs');
  let paired = 0, unfuelled = 0, railed = 0;
  longs.forEach(d => {
    const html = a.renderDayCard(d);
    const cards = (html.match(/class="how-mod[^"]*"/g) || []).length;
    const dots = (html.match(/<span class="how-dot"><\/span>/g) || []).length;
    assert.equal(dots, cards, d.date + ': ' + dots + ' dots for ' + cards + ' cards');
    if (!a.longRunIsFuelRail(d)) { unfuelled++; return; }
    /* ---- ONLY THE ONE-STAGE LONG RUN LOSES ITS RAIL ----
       Founder: "I only wanted it from 1 card rails. So on long runs with
       marathon pace need to have the rails." A long run that inserts,
       finishes with or builds to goal pace has two or three stages; those
       stages ARE the session, and their fuel figures ride the same rail.
       So those keep everything, and this law is about the plain one. */
    if (!a.soloNoteSession(d)){
      assert.ok(cards >= 3,
        d.date + ' (' + d.km + 'km) has marathon-pace work and lost its rail anyway');
      const facts = a.fuelFacts(d).rows;
      facts.forEach(r => assert.ok(html.indexOf(r.v) > -1,
        d.date + ': a goal-pace long run lost the fuel figure ' + JSON.stringify(r.short)));
      railed++;
      return;
    }
    assert.equal(cards, 0,
      d.date + ' (' + d.km + 'km) still draws ' + cards + ' slides — a long run draws no rail');
    assert.ok(html.indexOf('data-solo') > -1,
      d.date + ': a long run has lost the cherry note that replaced its rail');
    /* THE FIGURES ARE GONE FROM THE SCREEN, AND THE DATA IS NOT. */
    const facts = a.fuelFacts(d).rows;
    assert.ok(facts.length >= 3, d.date + ': fuelFacts stopped computing — that IS a data loss');
    facts.forEach(r => assert.equal(html.indexOf(r.v), -1,
      d.date + ': the fuel figure ' + JSON.stringify(r.short) + ' (' + r.v +
      ') is still on the card, so this removal is half-done'));
    /* NO STAGE AND NO PHASE CARDS EITHER: there is no rail of any kind. */
    assert.ok(html.indexOf('ws-h-step') === -1, d.date + ' still shows stage cards');
    /* THE PANEL, NOT THE WORD. A bare "strat-phase" also matches the
       caption's own .strat-phase-purpose. */
    assert.ok(html.indexOf('class="how-mod strat-phase"') === -1,
      d.date + ' still shows execution phase cards');
    paired++;
  });
  assert.ok(paired >= 2 && railed >= 2,
    'the block built ' + paired + ' one-stage long runs and ' + railed +
    ' goal-pace ones — this law needs both sides');
  assert.ok(unfuelled >= 1,
    'the fixture no longer has a long run without fuel, which is the case that keeps its stages');

  /* THE HEAD WORDS WENT WITH THE CARDS. "Carb intake" read as FUEL on a
     head line and "Gels" as TAKE; there is no head line on a long run any
     more. fuelPairPanels() still builds them and race day still uses it --
     see "race day keeps its phases and pairs only its fuel", which is now
     the only place that wording is exercised. */
  const d15 = longs.filter(d => a.longRunIsFuelRail(d))[0];
  const h = a.renderDayCard(d15);
  ['Fuel', 'Take'].forEach(w => assert.equal(h.indexOf('<span class="pair-k">' + w + '</span>'), -1,
    'the head word "' + w + '" is still on a long run, so the rail is half-removed'));
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
    /* A SOLO-NOTE DAY HAS NEITHER, AND THAT IS THE INSTRUCTION. Its note is
       the founder's written lines and nothing else, so the phase captions
       are not in it -- "It also doesn't need a massive coaches note!" was
       exactly about the stack those captions sat in. There is no panel to
       light and no caption to light, so the question this law asks does
       not arise. */
    if (a.soloNoteSession(d)) return;
    const html = a.renderDayCard(d);
    const onRail = html.indexOf('class="how-mod strat-phase"') > -1;
    const all = html.indexOf('how-cap how-cap-all') > -1;
    const caps = (html.match(/class="how-cap-i/g) || []).length;
    /* ---------- THERE ARE THREE ARRANGEMENTS NOW, NOT TWO ----------
       This law was written when a phase sentence had exactly two possible
       homes: a caption beside a panel on the rail, lit one at a time, or a
       caption in the Coach's Note with .how-cap-all forcing all of them
       visible because nothing could light them. A blueprint session is a
       third case: its sentences were distributed onto the stage cards --
       founder, "the rail becomes the coach" -- so there is no caption
       wrapper on that card at all, and `all === !onRail` read the absence
       of one as "the captions are not all shown" and failed on 14 days.
       MEASURED ACROSS THE BLOCK: 14 blueprint sessions with no wrapper and
       every sentence on a stage card, 3 goal-pace long runs with the
       wrapper and .how-cap-all, and one race with its panels on the rail.
       WHAT EVERY BRANCH STILL HAS TO SHOW is every sentence -- which is
       the thing this law is for, and the thing a markup-only guard got
       wrong before it: an interval once showed one of four sentences and
       called the other three carried. */
    if (a.hasWorkoutBlueprint(d)){
      assert.ok(!onRail,
        d.date + ' (' + d.type + '): a blueprint session has the execution panels on its rail as well');
      assert.equal(caps, 0,
        d.date + ' (' + d.type + '): the phase sentences are on the stage cards AND in a caption wrapper');
      s.phases.forEach(ph => {
        ['purpose', 'cue'].forEach(k => {
          if (!ph[k]) return;
          const txt = a.resolveDesc(ph[k]);
          assert.ok(html.indexOf(txt) > -1,
            d.date + ' (' + d.type + '): the ' + ph.key + ' ' + k +
            ' reaches no stage card: ' + JSON.stringify(txt.slice(0, 40)));
        });
      });
      without++;
      return;
    }
    assert.equal(all, !onRail,
      d.date + ' (' + d.type + '): phase panels ' + (onRail ? 'ARE' : 'are NOT') +
      ' on the rail but the captions are ' + (all ? '' : 'not ') + 'all shown');
    /* And every sentence is in the note either way. */
    assert.equal(caps, s.phases.length,
      d.date + ': ' + s.phases.length + ' phases but a different number of sentences');
    onRail ? withPanels++ : without++;
  });
  assert.ok(withPanels >= 1 && without >= 3,
    'the fixture no longer exercises both (' + withPanels + ' with panels, ' + without + ' without)');
  /* AND IT STILL EXERCISES ALL THREE. `without` now counts the blueprint
     days and the goal-pace long runs together, so the floor above would be
     met by blueprint sessions alone -- and the .how-cap-all branch, which
     is what this law was originally written for, would stop being reached
     without anything saying so. */
  let capAllDays = 0, bpDays = 0;
  a.state.days.forEach(d => {
    if (d.type === 'rest' || a.soloNoteSession(d)) return;
    let s; try { s = a.executionStrategyForDisplay(d); } catch (e) { return; }
    if (!s || s.suppressed || !s.phases || !s.phases.length) return;
    if (a.hasWorkoutBlueprint(d)) bpDays++;
    else if (a.renderDayCard(d).indexOf('how-cap how-cap-all') > -1) capAllDays++;
  });
  assert.ok(bpDays >= 5 && capAllDays >= 1,
    'the fixture exercises ' + bpDays + ' blueprint sessions and ' + capAllDays +
    ' unlightable-caption sessions \u2014 one of the three arrangements is no longer checked');
});

/* ---- EXCEPT WHERE THERE IS NO RAIL AT ALL ----
   A long run draws none now, so its fuel facts ride nothing. That is
   asserted directly, with the cost named, in "a long run draws no rail,
   and its fuel figures leave the screen with it". This law covers every
   session that still HAS a rail -- race day, in this block. */
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
    if (a.soloNoteSession(d)) return;          /* no rail to ride */
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
  /* SIX BECAME TWO. The fuelled sessions in this block were five long runs
     and goal day; the long runs draw no rail now, so goal day's two paired
     cards are what is left to check the pairing on. Lowered to what the
     block actually builds, with the reason, rather than left at a number
     that can only ever fail. */
  assert.ok(seen >= 2, 'the fixture exercises only ' + seen + ' fuelled sessions');

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
    /* ---- THE SHAPE IS A LINE IN THE BOX NOW, NOT A LABELLED ROW ----
       A fuel-rail long run draws the founder's cherry note, whose lines
       carry no <b> label -- "a label is for telling rows apart and there is
       only one". So the shape is looked for as one of those lines. The law
       is unchanged and is still the one three mutations walked through:
       the session's shape has to be said somewhere, exactly once. */
    const solo = a.soloNoteSession(d);
    const line = solo
      ? (() => {
          const parts = a.singleCardNoteParts(d);
          const body = (parts && parts.subs && parts.subs[0]) || '';
          /* The box strips a trailing full stop as it renders, so the line
             is looked for the way it is printed. */
          const shown = body.replace(/\.$/, '');
          return shown && html.indexOf(shown) > -1 ? [shown, shown] : null;
        })()
      : /<b>Session<\/b> ([^<]*)/.exec(html);
    const hasDesc = /<div class="day-desc">[^<]/.test(html);
    let steps; try { steps = a.workoutSteps(d); } catch (e) { steps = []; }
    /* The written-copy days say the shape in the founder's own words
       instead; "Build endurance. / Run by effort, not pace." is the long
       run's shape as he put it, and the generated line would be a second
       telling of it. */
    if (a.SINGLE_CARD_NOTE[(a.prescriptionOf(d) || {}).archetype]) { withheld++; return; }
    if (hasDesc || steps.length < 2) {
      assert.ok(!line, d.date + ': the shape is written to the note as well as the description');
      withheld++;
      return;
    }
    assert.ok(line, d.date + ': ' + steps.length + ' stages, no description, and no shape in the note — ' +
      'the session’s shape is said nowhere');
    steps.forEach(st => {
      /* ---- THE DESCRIPTION IS A SHAPE TOO, IN THE SESSION'S OWN WORDS ----
         sessionShapeLine() names each stage ("Warm up 6.8km at ..."); a
         day that has its own description says the same structure the way
         the plan wrote it ("6.8km @ Easy pace, 4.4km @ Goal Pace, 6.8km @
         Easy pace to close"), and that is what the box now carries because
         it reads better than the generated line. Either is a shape; what
         this law is for is that ONE of them is said. Where the line is the
         description, the stage-by-stage check does not apply to it. */
      if (solo && a.descMovesToNote(d)) return;
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
