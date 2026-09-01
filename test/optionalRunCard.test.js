'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

/* THE OPTIONAL RUN, AS THE ATHLETE SEES IT
 * ===========================================================================
 * Three facts share the type 'rest'. The card must tell them apart, and must
 * not let the third look like training.
 */
const TODAY = '2026-03-04';
function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {}; a.showToast = () => {};
  a.state = a.makeDefaultState();
  const monday = a.addDays(TODAY, -a.isoWeekday(TODAY));
  const sessions = [];
  for (let i = 0; i < 52; i++){
    const m = a.addDays(monday, -7 * (52 - i));
    for (let d = 0; d < 3; d++)
      sessions.push({ date: a.addDays(m, d), completed: true, actualKm: 9, plannedKm: 9 });
  }
  a.state.athlete = { sessions };
  /* EVERY DAY AVAILABLE, because a protected rest day needs one to spare.
     Prescribed frequency is a capacity now and it develops: a six-day athlete
     reaches six prescribed days within three weeks and the programme has
     nothing left over to protect. A protected rest day is an AVAILABLE day the
     programme did not need and then declined to offer a run on, so the athlete
     who has one is the athlete with a day to spare. The three kinds and the
     rule that distinguishes them are unchanged. */
  const schedule = { activeDays: [0, 1, 2, 3, 4, 5, 6], longRunDay: 6 };
  const start = a.addDays(TODAY, -14);
  const end = a.addDays(a.addDays(start, -a.isoWeekday(start)), 14 * 7 - 1);
  a.state.days = a.buildDaysFromWeeks(a.buildBlockWeeks('half', 45, 14, {}), end, schedule, start, false);
  a.state.setup = { distanceKey: 'half', currentVolume: 45, planWeeks: 14, schedule: schedule,
    benchmark: { distanceKey: '10k', timeSec: 2700 }, goals: { A: { timeSec: 5400 } },
    activeGoal: 'A', paceOverrides: {}, lthr: 165, maxHR: 190, experience: 'experienced',
    startDate: start, raceDate: end, hasEvent: false, purpose: 'race' };
  return a;
}
const kinds = a => {
  const out = { optional: [], protectedRest: [], notOffered: [] };
  a.state.days.forEach(d => {
    if (d.type !== 'rest') return;
    const wk = a.state.days.filter(x => x.week === d.week);
    if (a.optionalRunEligible(d, wk)) out.optional.push(d);
    else if (d.availableUnused) out.protectedRest.push(d);
    else out.notOffered.push(d);
  });
  return out;
};

test('the three kinds of rest day all occur, and only one is offered', () => {
  const a = athlete();
  const k = kinds(a);
  assert.ok(k.optional.length > 0, 'a day the programme did not need');
  assert.ok(k.protectedRest.length > 0, 'a day recovery is protecting');
  assert.ok(k.notOffered.length > 0, 'a day the athlete never offered');

  k.optional.forEach(d => assert.match(a.renderDayCard(d), /optional-block/,
    d.date + ' is free and must be offered'));
  k.protectedRest.concat(k.notOffered).forEach(d =>
    assert.doesNotMatch(a.renderDayCard(d), /optional-block/,
      d.date + ' must not carry an optional-run invitation'));
});

test('it prescribes nothing', () => {
  /* No distance, no pace, no duration, no session type. The athlete chooses,
     which is the whole of what makes it optional. */
  const a = athlete();
  const dd = kinds(a).optional[0];
  const html = a.renderDayCard(dd);
  const block = html.slice(html.indexOf('optional-block'));
  assert.equal(dd.km, 0, 'the day still carries no distance');
  assert.equal(dd.prescription, undefined, 'and no prescription');
  assert.equal(dd.type, 'rest', 'and is still a rest day');
  assert.doesNotMatch(block, /\d+\s*km|\d+\s*min|Easy|Tempo|Threshold|Interval/,
    'the invitation must not name a distance, a duration or a session type');
});

test('it does not read as a required session, a missed one, or a warning', () => {
  const a = athlete();
  const dd = kinds(a).optional[0];
  const html = a.renderDayCard(dd);
  /* THE DAY'S IDENTITY IS ITS OWN, and this is the assertion that changed:
     it used to require `day-badge type-rest`, on the reasoning that an
     optional run is a rest day with an offer on it. That reading was
     overturned deliberately -- one day may not carry two coaching identities,
     and a day Valhalla is not asking to rest is not a Rest Day. So the badge
     is now the optional one, and the assertion is tightened rather than
     relaxed: the rest identity must be ABSENT, not merely coexisting. */
  assert.match(html, /day-badge type-optional/);
  assert.doesNotMatch(html, /day-badge type-rest/);
  assert.doesNotMatch(html, /Rest Day|Full rest/i);
  /* Nothing owed, nothing missed, nothing scored. */
  assert.doesNotMatch(html, /exec-pill font-mono/);
  assert.doesNotMatch(html, /is-missed|status-missed|Missed/);
  assert.doesNotMatch(html, /class="[^"]*\bkey\b/);
  /* And the language says what it is. */
  assert.match(html, />Optional Run</);
  /* "today" only where it is true; see optionalRunHeadline(). The dated
     variant is proved in optionalRunProduct.test.js. */
  assert.match(html, /No run needed\.?/);
  const block = html.slice(html.indexOf('optional-block'));
  assert.match(block, /Rest, or run if you feel like it/);
});

test('opening it is a view state and writes nothing to the plan', () => {
  const a = athlete();
  const dd = kinds(a).optional[0];
  const before = JSON.stringify(dd);
  assert.doesNotMatch(a.renderDayCard(dd), /optional-log/);
  a.handleOptionalRunLog(dd.id);
  assert.match(a.renderDayCard(dd), /optional-log/, 'the entry point opens');
  assert.equal(JSON.stringify(a.findDay(dd.id)), before,
    'and the day itself is untouched by opening it');
  a.handleOptionalRunLog(dd.id);
  assert.doesNotMatch(a.renderDayCard(dd), /optional-log/);
});

test('an offered day contributes nothing to the week either way', () => {
  const a = athlete();
  const dd = kinds(a).optional[0];
  const week = a.state.days.filter(d => d.week === dd.week);
  const km = ds => ds.reduce((t, d) => t + (d.km || 0), 0);
  assert.equal(km(week), km(week.filter(d => d.date !== dd.date)));
  const st = a.horizonStimulus(week), st2 = a.horizonStimulus(week.filter(d => d.date !== dd.date));
  assert.equal(st.qualityExposures, st2.qualityExposures);
  assert.equal(st.totalKm, st2.totalKm);
  assert.equal(st.sessions, st2.sessions);
  a.handleOptionalRunLog(dd.id);
  const after = a.state.days.filter(d => d.week === dd.week);
  assert.equal(km(after), km(week), 'and opening the editor changes none of it');
});
