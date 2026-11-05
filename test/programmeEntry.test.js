'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');
const fs = require('fs');
const path = require('path');
const { RUNTIME_RELATIVE } = require('./harness.js');
const RUNTIME_SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');

// VALHALLA -- THE PROGRAMME ENTRY (SCREEN 1).
//
// A brief signed-in surface shown once per genuine app launch, before Today,
// to an athlete who already has a programme: crest, "Hello <first name>",
// the programme and week, a day-based progress bar, and the way on.
//
// THE SEAM IS THE COLD-LAUNCH ONE THE PRODUCT ALREADY OWNS. loadState() runs
// exactly once, from init(), at real process start -- foregrounding a live
// session re-fires visibilitychange and never calls it again (see
// freshLaunchDefaultView.test.js, which leans on the same property for
// state.view). So the flag is armed in loadState()'s restore branch and
// nowhere else, and renderMainContent() decides whether the athlete actually
// qualifies. These tests drive those functions directly rather than
// re-simulating a browser lifecycle.
//
// PROGRESS IS DAY-BASED, through the programme timeline -- NOT mileage, and
// not weeks-elapsed rounded. The mock's 35% was illustrative and is
// deliberately not reproduced here; every expectation below is computed from
// the plan's own first and last dates.

const TODAY = '2026-06-08'; // a Monday
const app = () => loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });

const signIn = a => {
  a.cloudSession = { access_token: 't', refresh_token: 'r', user_id: 'uid-1',
                     email: 'a@b.c', expires_at: Date.now() + 3600e3 };
  return a;
};

// An athlete three weeks into a twelve-week block, signed in, named, and
// arrived at Today the way a cold start arrives.
function athleteInProgramme(opts) {
  const o = opts || {};
  const a = app();
  a.showToast = () => {};
  buildPlan(a, { weeks: o.weeks || 12, startDate: a.addDays(TODAY, -21) });
  signIn(a);
  if (o.name !== null) a.athlete().firstName = o.name || 'Dan';
  a.programmeEntryPending = true;
  return a;
}

// ---------------------------------------------------------------------------
// WHO IT GREETS
// ---------------------------------------------------------------------------

test('1. the greeting uses the athlete’s own first name', () => {
  const a = athleteInProgramme({ name: 'Dan' });
  const html = a.renderProgrammeEntry();
  assert.match(html, /Hello Dan/);
});

test('2. a name is never invented, and a generic greeting never stands in', () => {
  const a = athleteInProgramme({ name: null });
  const html = a.renderProgrammeEntry();
  assert.doesNotMatch(html, /Hello/);
  // instead the one-time capture stands where the greeting will stand
  assert.match(html, /What should we call you\?/);
  assert.match(html, /id="pe-name"/);
});

test('3. the capture is asked once: having answered, the athlete is greeted', () => {
  const a = athleteInProgramme({ name: null });
  // The harness's document is a stub whose getElementById always returns null
  // (see test/harness.js), so the field the handler reads is supplied here.
  // The real DOM path is exercised in the browser, against the rendered page.
  a.document.getElementById = id => (id === 'pe-name' ? { value: 'Dan', focus(){} } : null);
  a.handleProgrammeEntryName();
  assert.equal(a.athleteFirstName(), 'Dan');
  assert.match(a.renderProgrammeEntry(), /Hello Dan/);
  assert.doesNotMatch(a.renderProgrammeEntry(), /What should we call you\?/);
});

// ---------------------------------------------------------------------------
// THE NAME ITSELF
// ---------------------------------------------------------------------------

test('4. a name is trimmed, length-capped, and stripped of what is not a name', () => {
  const a = app();
  assert.equal(a.sanitiseFirstName('  Dan  '), 'Dan');
  assert.equal(a.sanitiseFirstName('Dan\u0000\u001F'), 'Dan');
  assert.equal(a.sanitiseFirstName('<script>'), 'script');
  assert.equal(a.sanitiseFirstName('x'.repeat(200)).length, 80);
  assert.equal(a.sanitiseFirstName('   '), null);
  assert.equal(a.sanitiseFirstName(null), null);
  assert.equal(a.sanitiseFirstName(undefined), null);
});

test('5. an empty answer is refused rather than stored', () => {
  const a = app();
  assert.equal(a.setAthleteFirstName('   '), false);
  assert.equal(a.athleteFirstName(), null);
  assert.equal(a.setAthleteFirstName('Dan'), true);
  assert.equal(a.athleteFirstName(), 'Dan');
});

// ---------------------------------------------------------------------------
// THE HANDOFF FROM /start
//
// The account step is a magic link: the athlete types their name, LEAVES the
// page for their inbox, and returns through a fresh load. A name held only in
// a DOM input is gone by the time an account exists, so /start banks it to a
// same-origin key -- exactly as vvv_pending_build already banks a plan -- and
// the app adopts it once on arrival.
// ---------------------------------------------------------------------------

test('6. the banked name is adopted once and the key is cleared', () => {
  const a = app();
  a.showToast = () => {};
  a.localStorage.setItem('vvv_identity', JSON.stringify({ firstName: '  Dan  ' }));
  assert.equal(a.adoptPendingIdentity(), true);
  assert.equal(a.athleteFirstName(), 'Dan');
  assert.equal(a.localStorage.getItem('vvv_identity'), null);
  // and never a second time
  assert.equal(a.adoptPendingIdentity(), false);
});

test('7. a stale handoff never overwrites the name on this device', () => {
  const a = app();
  a.showToast = () => {};
  a.athlete().firstName = 'Dan';
  a.localStorage.setItem('vvv_identity', JSON.stringify({ firstName: 'Someone Else' }));
  assert.equal(a.adoptPendingIdentity(), false);
  assert.equal(a.athleteFirstName(), 'Dan');
  // the stale key is still consumed, so it cannot reappear later
  assert.equal(a.localStorage.getItem('vvv_identity'), null);
});

test('8. a corrupt or empty handoff is survived, not thrown', () => {
  const a = app();
  a.showToast = () => {};
  a.localStorage.setItem('vvv_identity', '{not json');
  assert.equal(a.adoptPendingIdentity(), false);
  a.localStorage.setItem('vvv_identity', JSON.stringify({ firstName: '   ' }));
  assert.equal(a.adoptPendingIdentity(), false);
  assert.equal(a.athleteFirstName(), null);
});

// THE REGRESSION THAT MATTERS MOST HERE. The name is banked at the ACCOUNT
// step, which happens before any plan and before any session exists. A save
// carrying nothing but firstName must survive a cold launch -- otherwise the
// athlete is asked "What should we call you?" having already answered at
// sign-up. loadState()'s guard scores a save as usable if it carries a plan
// OR a person; a name is the earliest thing that makes someone a person.
test('9. a name alone survives a cold launch, with no plan and no history', () => {
  const a = app();
  a.showToast = () => {};
  a.athlete().firstName = 'Dan';
  a.persistStateLocalOnly();

  const b = app();
  b.showToast = () => {};
  b.localStorage.setItem(b.STORAGE_KEY, a.localStorage.getItem(a.STORAGE_KEY));
  b.loadState();
  assert.equal(b.athleteFirstName(), 'Dan',
    'the name banked at sign-up was discarded by the next cold start');
});

// ---------------------------------------------------------------------------
// WHEN IT SHOWS
// ---------------------------------------------------------------------------

test('10. shown to a signed-in athlete with a programme, on a cold launch', () => {
  const a = athleteInProgramme();
  assert.equal(a.resolveAppState(), 'signed-in-plan');
  assert.equal(a.shouldShowProgrammeEntry(a.resolveAppState()), true);
});

test('11. never without the cold-launch arming', () => {
  const a = athleteInProgramme();
  a.programmeEntryPending = false;
  assert.equal(a.shouldShowProgrammeEntry(a.resolveAppState()), false);
});

test('12. an open ownership decision outranks it', () => {
  const a = athleteInProgramme();
  assert.equal(a.shouldShowProgrammeEntry('reconcile-required'), false);
});

test('13. never in front of an athlete with no programme', () => {
  const a = app();
  a.showToast = () => {};
  signIn(a);
  a.programmeEntryPending = true;
  assert.equal(a.shouldShowProgrammeEntry(a.resolveAppState()), false);
});

test('14. never to a signed-out athlete, even one with a local plan', () => {
  const a = app();
  a.showToast = () => {};
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -21) });
  a.programmeEntryPending = true;
  assert.equal(a.resolveAppState(), 'signed-out-local-plan');
  assert.equal(a.shouldShowProgrammeEntry(a.resolveAppState()), false);
});

test('15. armed by a cold launch that restores a programme, and only then', () => {
  const a = app();
  a.showToast = () => {};
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -21) });
  a.persistStateLocalOnly();

  const b = app();
  b.showToast = () => {};
  assert.equal(b.programmeEntryPending, false, 'not armed before a restore');
  b.localStorage.setItem(b.STORAGE_KEY, a.localStorage.getItem(a.STORAGE_KEY));
  b.loadState();
  assert.equal(b.programmeEntryPending, true);
});

test('16. a cold launch with no programme does not arm it', () => {
  const a = app();
  a.showToast = () => {};
  a.athlete().firstName = 'Dan';
  a.persistStateLocalOnly();

  const b = app();
  b.showToast = () => {};
  b.localStorage.setItem(b.STORAGE_KEY, a.localStorage.getItem(a.STORAGE_KEY));
  b.loadState();
  assert.equal(b.programmeEntryPending, false);
});

test('17. Continue goes on to Today, and it does not come back this process', () => {
  const a = athleteInProgramme();
  a.handleProgrammeEntryContinue();
  assert.equal(a.programmeEntryPending, false);
  assert.equal(a.shouldShowProgrammeEntry(a.resolveAppState()), false);
});

test('18. the bottom navigation is suppressed while it stands', () => {
  const a = athleteInProgramme();
  const shown = a.renderApp();
  void shown;
  // nav is allowed for this app state in general ...
  assert.equal(a.appStateAllowsNav('signed-in-plan'), true);
  // ... and withheld only because the entry screen is in front
  assert.equal(
    a.appStateAllowsNav(a.resolveAppState()) && !a.shouldShowProgrammeEntry(a.resolveAppState()),
    false);
  a.handleProgrammeEntryContinue();
  assert.equal(
    a.appStateAllowsNav(a.resolveAppState()) && !a.shouldShowProgrammeEntry(a.resolveAppState()),
    true);
});

// ---------------------------------------------------------------------------
// WHAT IT SAYS
// ---------------------------------------------------------------------------

test('19. the programme reads "Marathon", not "Full Marathon"', () => {
  const a = athleteInProgramme();
  a.state.setup.distanceKey = 'full';   // whose own label is "Full Marathon"
  assert.equal(a.programmeShortLabel(), 'Marathon');
  assert.match(a.renderProgrammeEntry(), /Marathon \(Week \d+ of \d+\)/);
  assert.doesNotMatch(a.renderProgrammeEntry(), /Full Marathon/);
});

// EVERY PROGRAMME NAMES ITSELF. The label takes the same branch
// blockIdentityParts() takes, so a block is called the same thing here as in
// Programme Status: a Race Goal by its distance, every other purpose by the
// ledger's own label. Before this it read DISTANCE_PROFILES alone, so a
// non-race block had no distanceKey to find and the programme line vanished
// entirely -- an athlete in an Aerobic Base block was told nothing about it.
test('19b. each race distance is named by its own distance', () => {
  const cases = [['5k','5K'], ['10k','10K'], ['half','Half Marathon'],
                 ['full','Marathon'], ['ultra','Ultra (50K)']];
  for (const [key, want] of cases){
    const a = app();
    a.showToast = () => {};
    buildPlan(a, { distanceKey: key, weeks: 12, startDate: a.addDays(TODAY, -21) });
    signIn(a);
    assert.equal(a.programmeShortLabel(), want, key);
    assert.ok(a.renderProgrammeEntry().includes(want + ' (Week 4 of 12)'), key);
  }
});

test('19c. every other purpose is named by the ledger, not left blank', () => {
  const cases = [['base','Aerobic Base'], ['maintain','Maintain & Protect'],
                 ['speed','Speed & Threshold'], ['recovery','Recovery']];
  for (const [purpose, want] of cases){
    const a = app();
    a.showToast = () => {};
    buildPlan(a, { weeks: 8, startDate: a.addDays(TODAY, -14) });
    signIn(a);
    a.state.setup.purpose = purpose;
    assert.equal(a.programmeShortLabel(), want, purpose);
    assert.match(a.renderProgrammeEntry(), /\(Week 3 of 8\)/, purpose);
  }
});

test('19d. a plan with no purpose recorded is read as a Race Goal', () => {
  const a = athleteInProgramme();
  delete a.state.setup.purpose;
  a.state.setup.distanceKey = 'half';
  assert.equal(a.programmeShortLabel(), 'Half Marathon');
});

test('20. the week shown is the week the athlete is actually in', () => {
  const a = athleteInProgramme({ weeks: 12 });   // started 21 days ago
  assert.equal(a.currentWeekNum(), 4);
  assert.equal(a.totalWeeksInPlan(), 12);
  assert.match(a.renderProgrammeEntry(), /\(Week 4 of 12\)/);
});

// PROGRESS IS DAYS, NOT WEEKS AND NOT MILEAGE. Computed here from the plan's
// own range rather than asserted as a literal, so the expectation cannot
// quietly encode the implementation's arithmetic.
test('21. progress is the day through the programme’s own span', () => {
  const a = athleteInProgramme({ weeks: 12 });
  const first = a.weekDateRange(1), last = a.weekDateRange(a.totalWeeksInPlan());
  const span = a.daysBetween(first.start, last.end) + 1;
  const done = a.daysBetween(first.start, a.todayStr()) + 1;
  const expected = Math.round(done / span * 100);
  assert.equal(a.programmeProgressPct(), expected);
  assert.equal(span, 84, 'twelve programme weeks are 84 days');
  assert.equal(done, 22, 'day 22, having started 21 days ago');
  assert.equal(a.programmeProgressPct(), 26);
});

test('22. it is a timeline, so it does not move with mileage logged', () => {
  const a = athleteInProgramme({ weeks: 12 });
  const before = a.programmeProgressPct();
  const dd = a.state.days.find(d => d.km > 0);
  if (dd) { dd.done = true; dd.actualKm = (dd.km || 0) * 3; }
  assert.equal(a.programmeProgressPct(), before);
});

test('23. day one of the programme is not zero, and the last day is 100', () => {
  const a = app();
  a.showToast = () => {};
  buildPlan(a, { weeks: 12, startDate: TODAY });   // begins today
  signIn(a);
  assert.equal(a.programmeProgressPct(), 1);

  const b = app();
  b.showToast = () => {};
  buildPlan(b, { weeks: 12, startDate: b.addDays(TODAY, -83) });  // ends today
  signIn(b);
  assert.equal(b.programmeProgressPct(), 100);
});

test('24. it never reads below 0 or above 100, whatever the dates say', () => {
  const a = app();
  a.showToast = () => {};
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -400) });  // long finished
  signIn(a);
  const pct = a.programmeProgressPct();
  assert.ok(pct >= 0 && pct <= 100, 'reads ' + pct);
  assert.equal(pct, 100);

  const b = app();
  b.showToast = () => {};
  buildPlan(b, { weeks: 12, startDate: b.addDays(TODAY, 60) });    // not begun
  signIn(b);
  const pctB = b.programmeProgressPct();
  assert.ok(pctB >= 0 && pctB <= 100, 'reads ' + pctB);
  assert.equal(pctB, 0);
});

test('25. the bar carries the same number it prints, for a screen reader', () => {
  const a = athleteInProgramme();
  const html = a.renderProgrammeEntry();
  const pct = a.programmeProgressPct();
  assert.match(html, new RegExp('role="progressbar"'));
  assert.match(html, new RegExp('aria-valuenow="' + pct + '"'));
  assert.match(html, new RegExp('aria-valuemin="0"'));
  assert.match(html, new RegExp('Programme ' + pct + '% complete'));
});

// ---------------------------------------------------------------------------
// WHAT IT MUST NOT DISTURB
// ---------------------------------------------------------------------------

test('25b. bar and text never disagree, across programme shapes', () => {
  const shapes = [{distanceKey:'5k',weeks:8},  {distanceKey:'half',weeks:16},
                  {distanceKey:'full',weeks:20}, {distanceKey:'10k',weeks:10}];
  for (const sh of shapes){
    for (const ago of [0, 7, 40, 90]){
      const a = app();
      a.showToast = () => {};
      buildPlan(a, { distanceKey: sh.distanceKey, weeks: sh.weeks,
                     startDate: a.addDays(TODAY, -ago) });
      signIn(a);
      const pct = a.programmeProgressPct();
      if (pct == null) continue;
      const html = a.renderProgrammeEntry();
      const bar = /aria-valuenow="(\d+)"/.exec(html);
      const fill = /<span style="width:(\d+)%"><\/span>/.exec(html);
      const text = /Programme (\d+)% complete/.exec(html);
      const where = sh.distanceKey + '/' + sh.weeks + 'w/-' + ago + 'd';
      assert.ok(bar && fill && text, where);
      assert.equal(Number(bar[1]), pct, where);
      assert.equal(Number(fill[1]), pct, where);
      assert.equal(Number(text[1]), pct, where);
      assert.ok(pct >= 0 && pct <= 100, where + ' reads ' + pct);
    }
  }
});

test('26. it is presentation only: no day, plan or setup field is touched', () => {
  const a = athleteInProgramme();
  const before = JSON.stringify({ days: a.state.days, setup: a.state.setup });
  a.renderProgrammeEntry();
  a.programmeProgressPct();
  a.programmeShortLabel();
  a.handleProgrammeEntryContinue();
  const after = JSON.stringify({ days: a.state.days, setup: a.state.setup });
  assert.equal(after, before);
});

test('27. a plan with no weeks yields no percentage rather than a wrong one', () => {
  const a = app();
  a.showToast = () => {};
  signIn(a);
  assert.equal(a.programmeProgressPct(), null);
  assert.equal(a.programmeShortLabel(), null);
});

// ---------------------------------------------------------------------------
// THE STARTUP ORDERING -- the hole every test above went through.
//
// Everything above set cloudSession and THEN rendered, so it only ever proved
// the gate's logic. A real cold launch does the opposite: init() calls
// loadState(), paints ONCE, and only then calls cloudInit(), un-awaited, so
// that cloud sync can never delay startup. At that single paint cloudSession
// is still null, cloudSignedIn() is false, and resolveAppState() answers
// 'signed-out-local-plan' for a signed-in athlete whose plan is on the device.
// The arrival asked for 'signed-in-plan', so it never rendered -- and nothing
// repaints on the ordinary path, so it was never shown at all.
//
// These reproduce that window directly: loadState() has run, the session is in
// storage, and cloudSession is deliberately left unhydrated.
// ---------------------------------------------------------------------------

const STORED_SESSION = { access_token:'t', refresh_token:'r', user_id:'uid-1',
                         email:'a@b.c', expires_at: Date.now() + 3600e3 };

// A second device-start that restores the first one's save, exactly as a cold
// launch does -- and stops where init()'s first paint happens.
function coldLaunch(opts){
  const o = opts || {};
  const a = app();
  a.showToast = () => {};
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -21) });
  if (o.name) a.athlete().firstName = o.name;
  a.persistStateLocalOnly();

  const b = app();
  b.showToast = () => {};
  b.localStorage.setItem(b.STORAGE_KEY, a.localStorage.getItem(a.STORAGE_KEY));
  if (o.storedSession !== false)
    b.localStorage.setItem(b.CLOUD_SESSION_KEY, JSON.stringify(STORED_SESSION));
  b.loadState();            // what init() does first
  // cloudSession deliberately NOT set: this IS the unhydrated window
  return b;
}

test('28. REGRESSION: the arrival paints on the cold-launch paint, before the cloud session hydrates', () => {
  const b = coldLaunch({ name: 'Dan' });
  assert.equal(b.cloudSignedIn(), false, 'precondition: the session has not hydrated yet');
  assert.equal(b.resolveAppState(), 'signed-out-local-plan',
    'precondition: this is exactly what the app believes at the only paint');
  assert.equal(b.programmeEntryPending, true, 'and the launch armed the arrival');
  assert.equal(b.shouldShowProgrammeEntry(b.resolveAppState()), true);
  assert.match(b.renderMainContent(), /class="pe"/,
    'the arrival was never painted at all before this');
});

test('29. an existing athlete WITH a first name is greeted on that same paint', () => {
  const b = coldLaunch({ name: 'Dan' });
  assert.match(b.renderMainContent(), /Hello Dan/);
});

test('30. an existing athlete with NO first name still gets the arrival, and is asked', () => {
  const b = coldLaunch({});
  assert.equal(b.athleteFirstName(), null, 'precondition: an account older than the field');
  assert.equal(b.shouldShowProgrammeEntry(b.resolveAppState()), true,
    'a missing name must never suppress the arrival');
  const html = b.renderMainContent();
  assert.match(html, /class="pe"/);
  assert.match(html, /What should we call you\?/);
});

test('31. a genuinely signed-out athlete with a local plan still gets no arrival', () => {
  const b = coldLaunch({ name: 'Dan', storedSession: false });
  assert.equal(b.resolveAppState(), 'signed-out-local-plan');
  assert.equal(b.storedCloudSessionPresent(), false, 'no stored session to vouch for them');
  assert.equal(b.shouldShowProgrammeEntry(b.resolveAppState()), false);
});

test('32. resolveAppState() is not widened -- the allowance belongs to the arrival alone', () => {
  const b = coldLaunch({ name: 'Dan' });
  assert.equal(b.resolveAppState(), 'signed-out-local-plan',
    'the app’s idea of who is signed in must be untouched');
  assert.equal(b.appStateAllowsNav('signed-out-local-plan'),
               app().appStateAllowsNav('signed-out-local-plan'),
               'and navigation must read exactly as it did');
});

// A DEVICE WITH NOTHING TO ARM FROM. programmeEntryPending is armed in
// loadState() from the LOCAL plan, so a new device never armed it -- the
// programme only exists in the account. It arrives through the normal
// hydration of this same launch, and the arrival goes with it.
test('33. a cloud-only programme arriving during the launch shows the arrival once', async () => {
  const seedApp = app();
  seedApp.showToast = () => {};
  buildPlan(seedApp, { weeks: 12, startDate: seedApp.addDays(TODAY, -21) });
  seedApp.athlete().firstName = 'Dan';
  const remote = JSON.parse(JSON.stringify(seedApp.state));

  const b = app();                       // a brand-new device: nothing stored
  b.showToast = () => {};
  b.loadState();
  assert.equal(b.programmeEntryPending, false, 'precondition: nothing local to arm from');
  assert.equal(b.planHasContent(), false);

  b.cloudSession = Object.assign({}, STORED_SESSION);
  b.fetch = url => /\/rest\/v1\/plans\?select=/.test(String(url))
    ? Promise.resolve({ ok:true, status:200,
        json: () => Promise.resolve([{ data: remote, updated_at: '2026-06-01T08:00:00Z' }]) })
    : Promise.resolve({ ok:true, status:200, json: () => Promise.resolve([{}]) });
  await b.cloudReconcile();
  await new Promise(res => setTimeout(res, 0));

  assert.equal(b.planHasContent(), true, 'the programme arrived');
  assert.equal(b.shouldShowProgrammeEntry(b.resolveAppState()), true);
  assert.match(b.renderMainContent(), /Hello Dan/);

  b.handleProgrammeEntryContinue();
  assert.equal(b.shouldShowProgrammeEntry(b.resolveAppState()), false, 'and only once');
});

// AN ARRIVAL BELONGS TO THE START OF A LAUNCH OR TO NOTHING. The gate already
// refused to paint over an unanswered two-plans decision, but refusing is not
// forgetting: pending was only ever cleared by Continue, so the moment the
// athlete chose, the next render would have dropped "Hello ..." on top of a
// session already under way.
test('34. reconciliation spends the launch’s arrival rather than deferring it', () => {
  const b = coldLaunch({ name: 'Dan' });
  assert.equal(b.programmeEntryPending, true, 'precondition: armed by this launch');

  const remote = JSON.parse(JSON.stringify(b.state));
  b.openCloudConflictModal(remote, '2026-06-01T08:00:00Z');

  assert.equal(b.cloudPendingReconcile, true);
  assert.equal(b.shouldShowProgrammeEntry('reconcile-required'), false,
    'not during the decision');
  assert.equal(b.programmeEntryPending, false, 'and the opportunity is spent, not stored');

  // the decision resolves and the session carries on -- no greeting lands on it
  b.cloudSession = Object.assign({}, STORED_SESSION);
  b.cloudPendingReconcile = false;
  assert.equal(b.resolveAppState(), 'signed-in-plan');
  assert.equal(b.shouldShowProgrammeEntry(b.resolveAppState()), false,
    'no mid-session greeting after reconciliation');
  assert.doesNotMatch(b.renderMainContent(), /class="pe"/);
});

test('35. once per genuine launch: Continue ends it, and the next launch arms it again', () => {
  const b = coldLaunch({ name: 'Dan' });
  assert.equal(b.shouldShowProgrammeEntry(b.resolveAppState()), true);
  b.handleProgrammeEntryContinue();
  assert.equal(b.shouldShowProgrammeEntry(b.resolveAppState()), false);
  // the hydrated session arriving later must not revive it
  b.cloudSession = Object.assign({}, STORED_SESSION);
  assert.equal(b.resolveAppState(), 'signed-in-plan');
  assert.equal(b.shouldShowProgrammeEntry(b.resolveAppState()), false);

  const next = coldLaunch({ name: 'Dan' });   // a new process start
  assert.equal(next.shouldShowProgrammeEntry(next.resolveAppState()), true);
});

/* THE ARRIVAL IS A STOP-GAP, NOT A DECISION.
 * ===========================================================================
 * It exists to stand in front of the app while the plan loads, so it has to
 * behave like a splash and not like a screen: no chrome above it, nothing to
 * press, and it stands itself down. A Continue button was asking the athlete
 * to acknowledge a loading screen.
 */
function arrived(){
  const a = loadApp({ pinnedDate: '2026-11-05' });
  buildPlan(a, { weeks: 11, startDate: '2026-08-24', distanceKey: 'full', volume: 55 });
  a.state.athlete = a.state.athlete || {};
  a.state.athlete.firstName = 'Dan';
  return a;
}

test('ARRIVAL: there is nothing to press', () => {
  const a = arrived();
  const html = a.renderProgrammeEntry();
  assert.doesNotMatch(html, /class="pe-go"/, 'the Continue button is back');
  assert.doesNotMatch(html, /data-action="programme-entry-continue"/,
    'the arrival still asks to be dismissed by hand');
  /* The name form's own Continue is a different thing and stays: it submits
     an answer rather than acknowledging a loading screen. */
  /* And the styling went with it rather than being left behind. Read from
     the file: an earlier version of this line tested `a.CODE || ''`, and
     since the app object carries no CODE it was asserting that the empty
     string contains no rule -- which it never can. */
  assert.doesNotMatch(RUNTIME_SRC, /\.pe-go\{/, 'dead .pe-go styling survived');
  // the greeting itself is untouched
  assert.match(html, /Hello Dan/, 'the arrival stopped greeting anybody');
});

test('ARRIVAL: it stands itself down, once, and only when there is a name', () => {
  const a = arrived();
  const fired = [];
  let armedDelay = null;
  a.programmeEntryPending = true;
  a.window = a.window || {};
  a.window.setTimeout = (fn, ms) => { armedDelay = ms; fired.push(fn); return 1; };
  a.window.clearTimeout = () => {};

  a.programmeEntryAutoAdvance();
  assert.equal(fired.length, 1, 'the arrival never armed its own exit');
  assert.ok(armedDelay >= 2000 && armedDelay <= 3500,
    'the hold is ' + armedDelay + 'ms, outside the 2-3s this screen is for');

  /* A redraw must not stack a second timer: two would fire two renders, and
     the second would land after the athlete was already somewhere else. */
  a.programmeEntryAutoAdvance();
  a.programmeEntryAutoAdvance();
  assert.equal(fired.length, 1, 'a redraw armed another exit on top of the first');
});

test('ARRIVAL: the first open asks, and only a screen with nothing to ask holds', () => {
  /* THE QUESTION AND THE CLOCK NEVER COEXIST. On the very first open this
     screen carries the one-time name question, and a question that answers
     itself after 2.6 seconds has been skipped rather than answered -- so the
     hold is not armed while anything is still being asked. Once answered the
     name is stored, and every launch after that, force quits included, is
     purely a splash that holds and goes on its own. */
  const a = arrived();
  a.state.athlete.firstName = '';
  a.programmeEntryPending = true;
  let armed = 0;
  a.window = a.window || {};
  a.window.setTimeout = () => { armed++; return 1; };
  a.programmeEntryAutoAdvance();
  assert.equal(armed, 0, 'the name question times out instead of being answered');
  assert.match(a.renderProgrammeEntry(), /data-action="programme-entry-name"/,
    'the name form lost its way to submit');

  // answered once -- and from here it is a splash, every time
  a.state.athlete.firstName = 'Dan';
  a.programmeEntryAutoAdvance();
  assert.equal(armed, 1, 'a named athlete is left sitting on the arrival');
  const html = a.renderProgrammeEntry();
  assert.match(html, /Hello Dan/);
  assert.doesNotMatch(html, /<input/, 'the question is asked again after it was answered');
});
