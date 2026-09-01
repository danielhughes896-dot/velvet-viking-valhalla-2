'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THE GOAL WEEK BELONGS TO THE TAPER IT CLOSES
   =========================================================================
   WHAT WAS WRONG, and it was only ever visual. renderWeeksList() opens a new
   section whenever trainingPhase() changes. The goal week's phase name is its
   own -- "Race Week" for a real event, "Final Week" for a self-set goal -- so
   it never equals 'Taper' and always opened a section of its own:

       TAPER PHASE   [Week 12]
       RACE WEEK     [Week 13]
       RACE DAY      [the race]

   which reads as the athlete having LEFT the taper for a separate phase. They
   have not. Race Week is the last week OF the taper.

   HOW THE GROUPING IS DECIDED, and this is the part that must not rot.
   phaseForWeek() already knows; it simply answers 'Final' first:

       if (arc.hasGoalEffort && weekNum >= totalWeeks) return 'Final';
       if (weekNum > arc.buildWeeks)                   return 'Taper';

   so goalWeekContinuesTaper() is that second test with the mask removed, read
   from the same arc for the same purpose and distance -- plus the requirement
   that the week before it is genuinely a taper week, because a one-week taper
   IS the goal week and has no section above for it to join.

   "The last two weeks are the taper" is NOT the rule and must never become it:
   the arcs differ by distance and purpose, and a maintenance block has neither
   a taper nor a goal effort. */

const PINNED = '2026-09-02T09:00:00Z';
function athlete(distanceKey, weeks, opts) {
  const a = loadApp({ pinnedDate: PINNED });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, Object.assign({ distanceKey: distanceKey || 'full', volume: 50,
    weeks: weeks || 12, lthr: 172, maxHR: 188 }, opts || {}));
  return a;
}
const dividerLabels = html =>
  [...html.matchAll(/phase-divider[^>]*>\s*<span class="l font-head">([^<]+)</g)].map(m => m[1]);
const weekClasses = (html, w) =>
  ((html.match(new RegExp('class="week([^"]*)" id="week-' + w + '"')) || [])[1] || '').trim();
const weekLabel = (html, w) =>
  (html.match(new RegExp('id="week-' + w + '"[\\s\\S]*?week-phase font-head">([^<]*)')) || [])[1] || '';

const DISTANCES = ['5k', '10k', 'half', 'full', 'ultra'];

// =====================================================================
// 1. THE GROUPING IS DERIVED, NOT ASSUMED
// =====================================================================

test('the goal week continues the taper exactly when the arc says it does', () => {
  DISTANCES.forEach(dk => [10, 12, 16].forEach(weeks => {
    const a = athlete(dk, weeks);
    const total = a.totalWeeksInPlan();
    const arc = a.blockArcFor(a.blockPurposeOf(a.planPurpose()), total, dk);
    const expected = !!arc.hasGoalEffort && total > arc.buildWeeks && a.isTaperWeek(total - 1);
    assert.equal(a.goalWeekContinuesTaper(total), expected,
      dk + '/' + weeks + ': the grouping must follow the arc, not a week count');
  }));
});

test('it is the unmasked taper test — never "the last two weeks"', () => {
  const a = athlete('full', 14);
  const total = a.totalWeeksInPlan();
  const arc = a.blockArcFor(a.blockPurposeOf(a.planPurpose()), total, 'full');
  // the goal week sits beyond the build, which is precisely why it is taper
  assert.ok(total > arc.buildWeeks);
  // and the week before it is a real taper week, so there is a section to join
  assert.equal(a.isTaperWeek(total - 1), true);
  assert.equal(a.goalWeekContinuesTaper(total), true);
  // no earlier week is ever grouped this way
  for (let w = 1; w < total; w++)
    assert.equal(a.goalWeekContinuesTaper(w), false, 'week ' + w + ' is not the goal week');
});

test('a maintenance block has no taper and no goal week to group', () => {
  const a = athlete('full', 14);
  a.state.setup.purpose = 'maintain';
  assert.equal(a.goalWeekContinuesTaper(a.totalWeeksInPlan()), false,
    'maintain has no goal effort; grouping it under a Taper heading would invent a phase');
});

test('a goal week with no taper week above it is not grouped', () => {
  /* Synthesised rather than waited for: if an arc ever tapers for exactly one
     week, that week IS the goal week and there is no section above it. */
  const a = athlete('full', 14);
  const total = a.totalWeeksInPlan();
  const realIsTaper = a.isTaperWeek;
  a.isTaperWeek = w => (w === total - 1 ? false : realIsTaper(w));
  assert.equal(a.goalWeekContinuesTaper(total), false,
    'with no taper week above it there is nothing for the goal week to continue');
  a.isTaperWeek = realIsTaper;
});

// =====================================================================
// 2. THE RENDERED HIERARCHY
// =====================================================================

test('the redundant goal-week divider is gone, on every race distance', () => {
  DISTANCES.forEach(dk => {
    const a = athlete(dk, 12);
    const labels = dividerLabels(a.renderWeeksList(false));
    assert.ok(labels.indexOf('Taper Phase') !== -1, dk + ' must still open a Taper section');
    assert.equal(labels.indexOf(a.vGoalWeek()), -1,
      dk + ': "' + a.vGoalWeek() + '" must no longer open a section of its own — it is '
        + 'the last week OF the taper. Got: ' + labels.join(' | '));
  });
});

test('Race Day remains its own destination below the taper', () => {
  const a = athlete('full', 14);
  a.state.setup.hasEvent = true;
  const labels = dividerLabels(a.renderWeeksList(false));
  assert.equal(labels[labels.length - 1], a.vGoalDay(),
    'the race is still introduced on its own, last');
  assert.equal(labels.filter(l => l === 'Taper Phase').length, 1, 'and there is one Taper heading');
});

test('the week card keeps its Race Week identity — only the divider went', () => {
  const a = athlete('full', 14);
  a.state.setup.hasEvent = true;
  const total = a.totalWeeksInPlan();
  const html = a.renderWeeksList(false);
  assert.equal(weekLabel(html, total), a.vGoalWeek(),
    'the athlete-facing RACE WEEK label is useful and stays');
  assert.notEqual(weekLabel(html, total), 'Taper Phase',
    'Race Week must never be relabelled as Taper Phase inside the card');
  assert.equal(weekLabel(html, total - 1), 'Taper Phase', 'and the week above is still the taper');
});

test('the goal week takes the SAME taper treatment as the week above it', () => {
  /* HQ amendment: the two cards must visibly belong to one Taper section, so
     the goal week is not given a weaker variant -- it takes the SAME is-taper
     class. Identical treatment expressed as an identical class means there is
     one definition and nothing to drift apart, and it leaves the existing
     .week.is-taper rules untouched. is-taper-final rides alongside as a marker
     carrying no styling of its own.

     The two cards stay distinguishable by what they SAY -- one is labelled
     TAPER PHASE and carries the taper note, the other is labelled RACE WEEK and
     does not -- which is asserted separately below. */
  const a = athlete('full', 14);
  const total = a.totalWeeksInPlan();
  const html = a.renderWeeksList(false);
  const goal = weekClasses(html, total), taper = weekClasses(html, total - 1);

  assert.match(goal, /\bis-taper\b/, 'the goal week takes the taper treatment itself');
  assert.match(goal, /\bis-taper-final\b/, 'and is marked as the one that closes it');
  assert.match(taper, /\bis-taper\b/, 'the taper week above is unchanged');
  assert.doesNotMatch(taper, /\bis-taper-final\b/, 'and is not the goal week');

  const CODE = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  /* is-taper-final is a MARKER. If it ever acquires styling of its own, the two
     cards can diverge again -- which is exactly what this amendment undid. */
  assert.doesNotMatch(CODE, /\.week\.is-taper-final\s*[,{]/,
    'is-taper-final must carry no styling; the shared look comes from is-taper');
  assert.doesNotMatch(CODE, /is-taper-final[^{]*\{[^}]*(background|border|color)/,
    'no visual property may be attached to the marker');
});

test('the taper note is not repeated on the goal week', () => {
  const a = athlete('full', 14);
  const total = a.totalWeeksInPlan();
  const html = a.renderWeeksList(false);
  const card = html.slice(html.indexOf('id="week-' + total + '"'));
  const nextWeek = card.indexOf('id="week-');
  const own = nextWeek === -1 ? card : card.slice(0, nextWeek);
  assert.doesNotMatch(own, /taper-note/,
    'Race Week already says what it is; the taper note above is not said twice');
});

test('collapsed, expanded and current-week states all keep the grouping', () => {
  const a = athlete('full', 14);
  const total = a.totalWeeksInPlan();
  [false, true].forEach(openAll => {
    const html = a.renderWeeksList(openAll);
    assert.equal(dividerLabels(html).indexOf(a.vGoalWeek()), -1,
      (openAll ? 'expanded' : 'collapsed') + ': no goal-week divider');
    assert.match(weekClasses(html, total), /is-taper-final/);
  });
  // and with the goal week as the current week
  const now = loadApp({ pinnedDate: PINNED });
  now.state = JSON.parse(JSON.stringify(a.state));
  const last = now.state.days.filter(d => d.week === total)[0];
  assert.ok(last, 'the goal week must have days');
  assert.equal(now.goalWeekContinuesTaper(total), true, 'being the current week changes nothing');
});

// =====================================================================
// 3. NOTHING BUT THE RENDERING MOVED
// =====================================================================

test('no programme, session or phase output changed', () => {
  DISTANCES.forEach(dk => {
    const a = athlete(dk, 12);
    const total = a.totalWeeksInPlan();
    // the phase engine itself is untouched: the goal week is still 'Final'
    // underneath and still named for what it is on the surface
    assert.equal(a.phaseForWeek(total, total, a.planPurpose(), dk), 'Final');
    assert.equal(a.trainingPhase(total), a.vGoalWeek());
    assert.equal(a.isTaperWeek(total), false,
      'the goal week is still not a Taper week to the engine — only to the eye');
    // and the weeks above are unchanged
    assert.equal(a.isTaperWeek(total - 1), true);
  });
});

test('week volume, day count and prescriptions are untouched by the grouping', () => {
  const a = athlete('full', 14);
  const total = a.totalWeeksInPlan();
  const before = JSON.stringify({
    vol: [total - 2, total - 1, total].map(w => JSON.stringify(a.weekVolume(w))),
    days: a.state.days.map(d => [d.id, d.date, d.type, d.km, d.title,
      d.prescription ? JSON.stringify(d.prescription) : null].join('~')),
  });
  a.renderWeeksList(false); a.renderWeeksList(true);
  assert.equal(JSON.stringify({
    vol: [total - 2, total - 1, total].map(w => JSON.stringify(a.weekVolume(w))),
    days: a.state.days.map(d => [d.id, d.date, d.type, d.km, d.title,
      d.prescription ? JSON.stringify(d.prescription) : null].join('~')),
  }), before, 'rendering the plan must not change the plan');
});

test('Race Day and Race Strategy rendering is unaffected', () => {
  const a = athlete('full', 14);
  const total = a.totalWeeksInPlan();
  const race = a.state.days.filter(d => d.type === 'race')[0];
  assert.ok(race, 'the block still ends in a race day');
  const ev = a.renderRaceDayEvent(total);
  assert.match(ev, /race-event/);
  assert.match(ev, /race-strategy/, 'the strategy picker still renders on Race Day');
  assert.match(ev, /id="day-/, 'and so does the race card');
});
