'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THE DAILY 08:00 REMINDER, ON THE PHONE.
   Founder: "Daily alarm - doesn't work." It used the browser's notification
   system, which the installed app's WebView does not have, and it could only
   fire while the app was open. Asked how to fix it: "Build it properly." */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const text = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function phone(pin, perm){
  const a = loadApp({ pinnedDate: pin });
  const toasts = [];
  a.renderApp = () => {}; a.showToast = m => toasts.push(m); a.scheduleSave = () => {};
  buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 12, startDate: '2026-11-02' });
  const ln = { scheduled: [], cancelled: 0, asked: 0, perm: perm || 'prompt', answer: 'granted' };
  a.window.Capacitor = { Plugins: { LocalNotifications: {
    checkPermissions: () => Promise.resolve({ display: ln.perm }),
    requestPermissions: () => { ln.asked++; ln.perm = ln.answer; return Promise.resolve({ display: ln.answer }); },
    cancel: o => { ln.cancelled++; ln.cancelledIds = o.notifications.map(n => n.id); return Promise.resolve(); },
    schedule: o => { ln.scheduled = o.notifications.slice(); return Promise.resolve(); }
  } } };
  a.isNativeApp = () => true;
  return { a, ln, toasts };
}

test('turning it on asks the phone, then schedules the next seven mornings at 08:00, each naming its session', async () => {
  const { a, ln, toasts } = phone('2026-11-12T07:00:00Z');
  assert.match(text(a.renderNotifyToggleRow()), /Daily 08:00 Workout Reminder Off/);
  await a.handleToggleNotify();
  assert.equal(ln.asked, 1, 'the phone was not asked for permission');
  assert.equal(a.state.notifyEnabled, true);
  assert.equal(ln.scheduled.length, 7);
  ln.scheduled.forEach((n, i) => {
    const date = a.addDays('2026-11-12', i);
    assert.equal(n.id, 8000 + i);
    assert.equal(n.schedule.at.getHours(), 8); assert.equal(n.schedule.at.getMinutes(), 0);
    assert.equal(n.schedule.allowWhileIdle, true);
    assert.deepEqual({ title: n.title, body: n.body }, JSON.parse(JSON.stringify(a.buildDayNotificationText(a.findDayByDate(date)))));
    assert.equal(n.title, 'SACORO');
    /* The words the reminder adds carry no symbol or dash; a session's own
       name is printed exactly as its card prints it. */
    const own = n.body.replace(/^Today: /, '').split(', ')[0];
    const added = n.body.replace(own, '');
    assert.doesNotMatch(n.title + added, /[\u2014\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|Earn your place/u, 'a symbol or a dash is back in the reminder');
    assert.match(n.body, /^Today: /);
  });
  /* A session's reminder names it the way its card does. */
  const run = a.state.days.filter(d => d.date >= '2026-11-12' && d.date <= '2026-11-18' && d.type !== 'rest' && !a.isOptionalRunDay(d))[0];
  const n = ln.scheduled.filter(x => x.schedule.at.toISOString().slice(0, 10) === run.date || x.id === 8000 + Math.round((Date.parse(run.date) - Date.parse('2026-11-12')) / 864e5))[0];
  assert.match(n.body, new RegExp('^Today: ' + a.displayCardTitle(run).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ', '));
  assert.deepEqual(toasts, ['Daily 08:00 reminder on']);
  assert.match(text(a.renderNotifyToggleRow()), /On\. Every morning at 08:00, with that day’s session/);
});

test('a morning already gone is not scheduled, and the last schedule is cleared first', async () => {
  const { a, ln } = phone('2026-11-12T09:30:00Z', 'granted');
  a.state.notifyEnabled = true;
  await a.nativeReadNotifyPermission();
  assert.equal(a.nativeNotifyPerm, 'granted');
  await a.nativeScheduleReminders();
  assert.equal(ln.cancelled, 1, 'the old reminders were not cleared, so a moved session is announced twice');
  assert.deepEqual(Array.from(ln.cancelledIds), [8000, 8001, 8002, 8003, 8004, 8005, 8006]);
  assert.equal(ln.scheduled.length, 6, 'a reminder was scheduled for a morning already past');
  assert.equal(ln.scheduled[0].id, 8001);
});

test('turning it off clears every reminder and schedules none', async () => {
  const { a, ln, toasts } = phone('2026-11-12T07:00:00Z', 'granted');
  a.nativeNotifyPerm = 'granted'; a.state.notifyEnabled = true;
  ln.scheduled = [{ id: 8000 }];
  await a.handleToggleNotify();
  assert.equal(a.state.notifyEnabled, false);
  await Promise.resolve(); await Promise.resolve();
  assert.ok(ln.cancelled >= 1, 'the scheduled reminders were left on the phone');
  assert.deepEqual(toasts, ['Daily reminder turned off']);
});

test('a refusal is said, and nothing is scheduled', async () => {
  const { a, ln, toasts } = phone('2026-11-12T07:00:00Z');
  ln.answer = 'denied';
  await a.handleToggleNotify();
  assert.equal(a.state.notifyEnabled, false);
  assert.equal(ln.scheduled.length, 0);
  assert.match(toasts[0], /Notifications are blocked\. Allow them for SACORO in your phone’s settings/);
  assert.match(text(a.renderNotifyToggleRow()), /Blocked\. Allow notifications for SACORO in your phone’s settings/);
});

test('it is scheduled again whenever the app opens or comes back, and never through the browser path on a phone', () => {
  const start = SRC.slice(SRC.indexOf('\nfunction startNotificationScheduler('), SRC.indexOf('\n}\n', SRC.indexOf('\nfunction startNotificationScheduler(')));
  assert.match(start, /if \(nativeNotifier\(\)\)\{\s*nativeReadNotifyPermission\(\)\.then\(function\(\)\{ patchNotifyToggle\(\); return nativeScheduleReminders\(\); \}\);\s*return;\s*\}/);
  assert.match(SRC, /checkDateRollover\(\);\n  if \(nativeNotifier\(\)\) nativeScheduleReminders\(\); else maybeFireDailyNotification\(\);/);
  /* An installed app from before this build says what it needs. */
  const a = loadApp({ pinnedDate: '2026-11-12T07:00:00Z' });
  a.isNativeApp = () => true;
  const old = text(a.renderNotifyToggleRow());
  if (typeof a.Notification === 'undefined') assert.match(old, /Needs the latest version of the app/);
});

test('the Android app carries the plugin and a version that can go to Play', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.dependencies['@capacitor/local-notifications'] || '', /^\^?8\./, 'the native notifications plugin is not a dependency');
  const settings = fs.readFileSync(path.join(ROOT, 'android/capacitor.settings.gradle'), 'utf8');
  assert.match(settings, /include ':capacitor-local-notifications'/);
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle'), 'utf8');
  assert.ok(+(/versionCode (\d+)/.exec(gradle)[1]) >= 6, 'the versionCode was not raised for the new native build');
});
