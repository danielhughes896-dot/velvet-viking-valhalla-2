'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* CIRCLES: THE APP SIDE.

   The database decides every permission (test/circlesMigration.test.js and
   tools/db-proof). These laws hold what the app sends, what it draws, and
   that it stays out of sight until the database is there. */

const TODAY = '2026-05-23';                // a Saturday
const ME = 'a0000000-0000-0000-0000-000000000001';

function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 16, distanceKey: 'half', startDate: a.addDays(TODAY, -42), lthr: 170, maxHR: 190 });
  a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').forEach(d => logAsPrescribed(a, d, {}));
  a.cloudSession = { access_token: 'x', user_id: ME };
  a.cloudConfigured = () => true; a.cloudSignedIn = () => true;
  a.cloudRefreshIfNeeded = () => Promise.resolve(true);
  return a;
}
/* A cloud that answers like PostgREST, and records what it was asked. */
function cloud(a, answer){
  const calls = [];
  a.cloudFetch = (path, opts) => {
    opts = opts || {};
    calls.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    const r = answer(path, opts) || { status: 404, body: { code: 'PGRST202', message: 'missing' } };
    return Promise.resolve({ ok: r.status < 300, status: r.status,
      text: () => Promise.resolve(r.body == null ? '' : JSON.stringify(r.body)),
      json: () => Promise.resolve(r.body) });
  };
  return calls;
}
function member(a, extra){
  a.circle = a.circleFresh();
  a.circle.status = 'member'; a.circle.id = 'c1'; a.circle.name = 'The Sunday Runners';
  a.circle.members = [Object.assign({ user_id: ME, display_name: 'Dan', sharing: true, show_km: false }, extra || {}),
                      { user_id: 's', display_name: 'Sarah', sharing: true, show_km: true }];
  return a.circle;
}

test('hidden until the database exists: no circle box when the functions are missing', async () => {
  const a = athlete();
  cloud(a, () => null);                                   // every call is a 404
  await a.circleLoad();
  assert.equal(a.circle.status, 'unavailable');
  assert.equal(a.circlePlateHtml(), '', 'a box appeared for a feature that is not there');
  assert.equal(a.renderCircleTodayLine(), '');
});

test('signed out: nothing is asked, and the box offers to sign in rather than hiding', async () => {
  const a = athlete();
  a.cloudSignedIn = () => false;
  const calls = cloud(a, () => null);
  await a.circleLoad();
  assert.equal(calls.length, 0);
  assert.match(a.circlePlateHtml(), /data-action="circle-signin"[\s\S]*Your Circle[\s\S]*Sign in/,
    'an athlete without an account never learns circles exist');
  assert.match(a.circleSigninSheetHtml(), /id="cloud-email"[\s\S]*data-action="cloud-sign-in"/);
  a.cloudConfigured = () => false;
  assert.equal(a.circlePlateHtml(), '', 'a build with no account service offered sign-in');
});

test('not in a circle yet: the box offers to start one', async () => {
  const a = athlete();
  cloud(a, p => (/rpc\/circle_my_id/.test(p) ? { status: 200, body: null } : null));
  await a.circleLoad();
  assert.equal(a.circle.status, 'none');
  assert.match(a.circlePlateHtml(), /data-action="circle-open"[\s\S]*Your Circle[\s\S]*Start one/);
});

test('what the athlete sends: one line a day from the plan, and never the plan', () => {
  const a = athlete();
  member(a);
  const done = a.state.days.find(d => d.date < TODAY && d.date >= a.circleWeekStart(TODAY) && d.completed);
  const missed = a.state.days.find(d => d.date < TODAY && d.date >= a.addDays(TODAY, -14) && d.type !== 'rest');
  missed.completed = false; delete missed.actual;
  const restricted = a.state.days.find(d => d.date === a.addDays(TODAY, 1));   // Sunday
  restricted.restricted = true;
  const today = a.state.days.find(d => d.date === TODAY);
  if (today.type === 'rest') today.type = 'easy';
  const rows = a.circleMyDayRows();
  const by = d => rows.find(r => r.day === d.date);
  assert.ok(rows.length >= 28, 'the last three weeks and this one');
  rows.forEach(r => assert.deepEqual(Object.keys(r).sort(), ['day', 'km', 'session_label', 'state', 'user_id']));
  assert.equal(by(done).state, 'done');
  assert.equal(by(missed).state, 'missed');
  assert.equal(by(restricted).state, 'restricted');
  assert.equal(by(restricted).session_label, null, 'a restriction must not say what it is');
  assert.equal(by(today).state, 'planned');
  rows.filter(r => r.state === 'planned' || r.state === 'rest').forEach(r =>
    assert.equal(r.session_label, null, 'a day still to come showed its session name, which is the plan'));
  rows.filter(r => r.state === 'done' || r.state === 'missed').forEach(r => assert.ok(r.session_label));
  assert.ok(rows.every(r => r.km === null), 'km was sent while km is off');
  rows.forEach(r => assert.equal(r.user_id, ME));
});

test('km goes only on a done day, and only once switched on', () => {
  const a = athlete();
  member(a, { show_km: true });
  const rows = a.circleMyDayRows();
  rows.filter(r => r.state === 'done').forEach(r => assert.ok(r.km > 0, 'a done day without its km'));
  rows.filter(r => r.state !== 'done').forEach(r => assert.equal(r.km, null));
});

test('a paused athlete sends nothing', async () => {
  const a = athlete();
  member(a, { sharing: false });
  const calls = cloud(a, () => ({ status: 201, body: null }));
  const pushes = () => calls.filter(x => /circle_days/.test(x.path));
  assert.equal(await a.circlePush(), false);
  assert.equal(pushes().length, 0);
  member(a);
  assert.equal(await a.circlePush(), true);
  assert.equal(pushes()[0].method, 'POST');
  assert.match(pushes()[0].path, /^\/rest\/v1\/circle_days$/);
});

test('the table: join order, sessions done of set, km only where shared, missed and paused drawn honestly', () => {
  const a = athlete();
  const c = member(a);
  c.members.push({ user_id: 'k', display_name: 'Kate', sharing: false, show_km: false });
  const ws = a.circleWeekStart(TODAY);
  const day = i => a.addDays(ws, i);
  c.days = [
    { user_id: 's', day: day(0), state: 'done', session_label: 'Long Run', km: 16 },
    { user_id: 's', day: day(1), state: 'missed', session_label: 'Threshold', km: null },
    { user_id: 's', day: day(2), state: 'rest', session_label: null, km: null },
    { user_id: 's', day: day(6), state: 'planned', session_label: 'Easy', km: null },
    { user_id: ME,  day: day(0), state: 'done', session_label: 'Easy', km: null }
  ];
  const html = a.circleTableHtml();
  const order = ['>You<', '>Sarah<', '>Kate<'].map(n => html.indexOf(n));
  assert.ok(order[0] < order[1] && order[1] < order[2], 'rows are not in join order');
  assert.match(html, />1 of 3<\/b>16km/, 'Sarah: one done of three set, with her km');
  assert.match(html, />1 of 1<\/b><\/div>/, 'my km is off, so no km');
  assert.match(html, /cc-miss/);
  assert.match(html, />Kate<\/div><div class="cc-paused">Not sharing right now<\/div>/);
  assert.equal((html.match(/data-user="k"/g) || []).length, 0, 'a paused member\'s days were drawn');
  assert.doesNotMatch(html, /\bpace\b|bpm|\bHR\b/i);
});

test('a week turns green only when everyone who shared it kept it', () => {
  const a = athlete();
  const c = member(a);
  const last = a.addDays(a.circleWeekStart(TODAY), -7);
  c.days = [
    { user_id: ME, day: last, state: 'done' }, { user_id: 's', day: last, state: 'done' },
    { user_id: ME, day: a.addDays(last, -7), state: 'done' }, { user_id: 's', day: a.addDays(last, -7), state: 'missed' }
  ];
  const html = a.circlePastWeeksHtml();
  assert.match(html, /class="cc-kept"[\s\S]*?Week kept\. All 2 of you did your plan/);
  assert.match(html, /class="cc-past"[\s\S]*?1 of 2 kept their week/);
});

test('Nice work: a heart on the day, a line on Today, gone once read', async () => {
  const a = athlete();
  const c = member(a);
  const d = a.addDays(TODAY, -2);
  c.days = [{ user_id: ME, day: d, state: 'done', session_label: 'Long Run', km: null }];
  c.cheers = [{ from_user: 's', to_user: ME, day: d, seen_at: null }];
  assert.match(a.circleCellHtml(ME, d, TODAY), /cc-heart/);
  assert.match(a.renderCircleTodayLine(), /data-action="circle-open-seen"[\s\S]*Sarah said nice work on your long run/);
  const calls = cloud(a, () => ({ status: 200, body: 1 }));
  a.openCirclePage = () => {};
  a.handleCircleOpenSeen();
  assert.equal(a.renderCircleTodayLine(), '', 'the line stayed after it was read');
  assert.ok(calls.some(x => /rpc\/circle_nice_work_seen/.test(x.path)));
});

test('the Nice work button is for someone else\'s done day in the last 7 days, once', () => {
  const a = athlete();
  const c = member(a);
  const recent = a.addDays(TODAY, -1), old = a.addDays(TODAY, -9);
  c.days = [{ user_id: 's', day: recent, state: 'done', session_label: 'Easy', km: 6 },
            { user_id: 's', day: old, state: 'done', session_label: 'Easy', km: 6 },
            { user_id: ME, day: recent, state: 'done', session_label: 'Easy', km: null }];
  assert.match(a.circleDaySheetHtml('s', recent), /data-action="circle-nice-work"/);
  assert.match(a.circleDaySheetHtml('s', recent), /6km/, 'Sarah shares km, so it shows');
  assert.doesNotMatch(a.circleDaySheetHtml('s', old), /circle-nice-work/);
  assert.doesNotMatch(a.circleDaySheetHtml(ME, recent), /circle-nice-work/, 'nice work to yourself');
  c.cheers = [{ from_user: ME, to_user: 's', day: recent }];
  assert.match(a.circleDaySheetHtml('s', recent), /You said nice work/);
  assert.match(a.circleDaySheetHtml('s', recent), /Nothing is sent to the phone|You said nice work/);
});

test('consent first: nothing is asked of the database until the box is ticked', async () => {
  const a = athlete();
  a.circle = a.circleFresh(); a.circle.status = 'none'; a.circle.view = 'start';
  const fields = { 'circle-me-name': { value: 'Dan' }, 'circle-name': { value: 'Sunday' }, 'circle-consent': { checked: false } };
  a.document.getElementById = id => fields[id] || null;
  const calls = cloud(a, () => ({ status: 200, body: 'c1' }));
  await a.circleSubmit('start');
  assert.equal(calls.filter(x => /circle_create|circle_join/.test(x.path)).length, 0, 'a circle was asked for before consent');
  assert.match(a.circle.error, /Tick the box/);
  fields['circle-consent'].checked = true;
  await a.circleSubmit('start');
  const create = calls.find(x => /rpc\/circle_create/.test(x.path));
  assert.ok(create);
  assert.equal(create.body.p_consent_version, a.CIRCLE_CONSENT_VERSION);
});

test('the database\'s own refusal is what the athlete reads', async () => {
  const a = athlete();
  a.circle = a.circleFresh(); a.circle.status = 'none'; a.circle.view = 'join';
  const fields = { 'circle-me-name': { value: 'Dan' }, 'circle-code': { value: '0123456789ab' }, 'circle-consent': { checked: true } };
  a.document.getElementById = id => fields[id] || null;
  cloud(a, () => ({ status: 400, body: { code: 'P0001', message: 'That circle is full. A circle holds up to 8 people.' } }));
  await a.circleSubmit('join');
  assert.equal(a.circle.error, 'That circle is full. A circle holds up to 8 people.');
});

test('the consent screen says what is shared and what never is, before the tick', () => {
  const a = athlete();
  const h = a.circleConsentHtml();
  assert.match(h, /Your circle will see[\s\S]*Kilometres only if you turn them on/);
  assert.match(h, /Your circle will never see[\s\S]*pace, heart rate, readiness, notes, your plan, or why you are resting/);
  assert.match(h, /Your programme is never changed by your circle/);
  assert.match(h, /<input type="checkbox" id="circle-consent">/, 'the box must start unticked');
});

test('nothing in the circle code writes to the plan', () => {
  const fs = require('node:fs'), path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', require('./harness.js').RUNTIME_RELATIVE), 'utf8');
  const start = src.indexOf('CIRCLES -- A SMALL PRIVATE GROUP');
  const block = src.slice(start, src.indexOf('function activityClock', start));
  assert.ok(block.length > 2000);
  const code = block.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /state\.days\s*(\[|=[^=])|\.completed\s*=[^=]|scheduleSave\(|cloudPutPlan\(|\/rest\/v1\/plans/,
    'the circle module changes the training record');
  assert.doesNotMatch(code, /PushNotifications|LocalNotifications|new Notification/, 'something is sent to the phone');
});
