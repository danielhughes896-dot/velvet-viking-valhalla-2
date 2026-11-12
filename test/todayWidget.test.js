'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* THE TODAY WIDGET, PHASE ONE: one medium Android widget.
   Founder: "I particularly like the idea of an athlete waking up, glancing at
   their phone and immediately seeing what SACORO has planned." And three
   conditions: "1. Automatic updates: If SACORO changes today's session, the
   widget should update when the operating system permits. No stale training
   advice. 2. Rest days: Display REST DAY and the coaching message, not an
   empty widget. 3. Privacy: No heart rate, recovery status, injury information
   or sensitive health data." Plus: "native widgets aren't guaranteed to
   refresh immediately. You should build a reliable update mechanism and
   handle stale or unavailable data gracefully." */

const ROOT = path.join(__dirname, '..');
const AND = p => fs.readFileSync(path.join(ROOT, 'android/app/src/main', p), 'utf8');
const JAVA = n => AND('java/com/velvetviking/valhalla/' + n + '.java');
const PRIVATE = /heart|\bhr\b|bpm|pulse|recover|injur|\bill\b|illness|sick|pain|sore|sleep|fatigue|tired|strain|niggle|hurt|\brpe\b|readiness/i;

function app(opts){
  const a = loadApp({ pinnedDate: '2026-11-12T07:00:00Z' });
  a.renderApp = () => {}; a.scheduleSave = () => {}; a.showToast = () => {};
  buildPlan(a, Object.assign({ distanceKey: 'half', volume: 45, weeks: 12, startDate: '2026-11-02' }, opts || {}));
  return a;
}
function withWidget(a, fail){
  const w = { sent: [] };
  a.window.Capacitor = { Plugins: { SacoroWidget: {
    update: p => { w.sent.push(JSON.parse(JSON.stringify(p))); return fail && fail() ? Promise.reject(new Error('x')) : Promise.resolve({ stored: p.days.length }); }
  } } };
  return w;
}

test('a fortnight from today, one entry per date, every entry fully worded', () => {
  for (const o of [{}, { distanceKey: 'full', volume: 70, weeks: 16 }, { distanceKey: '10k', volume: 30, weeks: 8 }, { distanceKey: '5k', volume: 25, weeks: 8 }]){
    const a = app(o);
    const p = a.widgetPayload();
    assert.equal(p.hasPlan, true);
    assert.equal(p.days.length, 14);
    p.days.forEach((d, i) => {
      assert.equal(d.date, a.addDays('2026-11-12', i), 'the stored days are not consecutive from today');
      assert.deepEqual(Object.keys(d).sort(), ['date', 'label', 'line', 'note', 'title'], 'the widget was handed something other than words for one day');
      assert.equal(d.label, 'TODAY');
      assert.ok(d.title && d.line, d.date + ' would draw an empty widget');
      for (const k of ['title', 'line', 'note']) assert.doesNotMatch(d[k], /—/, 'an em dash reached the home screen: ' + d[k]);
    });
  }
});

test('a session says what the card says: its name, its distance and its pace', () => {
  const a = app();
  const p = a.widgetPayload();
  const runs = p.days.map(d => [d, a.findDayByDate(d.date)]).filter(([, dd]) => dd && dd.type !== 'rest');
  assert.ok(runs.length >= 6);
  runs.forEach(([d, dd]) => {
    assert.equal(d.title, String(a.displayCardTitle(dd)).replace(/\s*[—–]\s*/g, ': '));
    assert.ok(d.line.indexOf(a.fmtDist(dd.km)) === 0, 'the distance is not the first thing on the line');
    const pace = a.getDayTargets(dd).pace;
    if (pace) assert.ok(d.line.endsWith(' at ' + pace), 'the prescribed pace is missing');
  });
});

test('a rest day says REST DAY and carries the coaching message, never an empty widget', () => {
  const a = app();
  const rests = a.widgetPayload().days.filter(d => { const dd = a.findDayByDate(d.date); return dd && dd.type === 'rest' && !a.isOptionalRunDay(dd); });
  assert.ok(rests.length >= 3);
  rests.forEach(d => {
    assert.equal(d.title, 'REST DAY');
    assert.equal(d.line, 'Full rest.');
    assert.ok(d.note.length > 20, 'a rest day lost its coaching message');
    const cue = a.coachingEntryFor(a.findDayByDate(d.date));
    if (cue && cue.cue && !PRIVATE.test(cue.cue)) assert.equal(d.note, a.brandCase(cue.cue.replace(/\s+/g, ' ').trim()), 'the rest day is not saying the coach’s own words');
  });
  /* And when the coaching line itself touches on health, a neutral line
     takes its place rather than nothing. */
  const dd = a.findDayByDate(rests[0].date);
  a.coachingEntryFor = () => ({ cue: 'Recovery is the point today; sleep well and let your heart rate settle.' });
  const d = a.widgetDay(dd.date);
  assert.equal(d.title, 'REST DAY');
  assert.equal(d.note, a.WIDGET_REST_NOTE);
});

test('privacy: nothing health-related, nothing logged and no reason for a restriction ever reaches it', () => {
  const a = app();
  /* A logged run, with every measured number a watch could send. */
  const done = a.state.days.filter(dd => dd.date >= '2026-11-12' && dd.type !== 'rest' && !a.isOptionalRunDay(dd))[0];
  logAsPrescribed(a, done);
  done.actual = Object.assign({}, done.actual, { avgHr: 163, maxHr: 181, rpe: 8, notes: 'left knee sore, slept badly' });
  /* A day the athlete restricted because they are hurt. */
  const hurt = a.state.days.filter(dd => dd.date > done.date && dd.type !== 'rest' && !a.isOptionalRunDay(dd))[0];
  hurt.restricted = { at: '2026-11-12', level: 'injury' };
  const p = a.widgetPayload();
  const all = JSON.stringify(p);
  assert.doesNotMatch(all, PRIVATE, 'a health word reached the widget');
  assert.doesNotMatch(all, /163|181|knee|slept/, 'something the athlete logged reached the widget');
  const h = p.days.find(d => d.date === hurt.date);
  assert.deepEqual([h.title, h.line, h.note], ['Your plan', 'Open SACORO for today’s plan.', ''], 'a restricted day says more than to open the app');
  const c = p.days.find(d => d.date === done.date);
  assert.equal(c.note, 'Logged. Nicely done.');
  /* Any coaching line naming a health topic is dropped whole, not edited. */
  ['Watch your heart rate.', 'Keep HR under 150.', 'If the knee is sore, stop.', 'Recovery first.', 'Sleep matters most this week.', 'Ease off if fatigue builds.']
    .forEach(t => assert.equal(a.widgetSafe(t), '', t));
  assert.equal(a.widgetSafe('Keep it conversational the whole way.'), 'Keep it conversational the whole way.');
});

test('no plan: the widget is told so, and is handed no days', () => {
  const a = loadApp({ pinnedDate: '2026-11-12T07:00:00Z' });
  assert.deepEqual(JSON.parse(JSON.stringify(a.widgetPayload())), { hasPlan: false, days: [] });
});

test('automatic updates: every save sends a changed fortnight once, and a failed send is retried', async () => {
  const a = app();
  assert.equal(await a.widgetSync(), false, 'with no widget plugin (an older installed app) it must return quietly');
  let failing = false;
  const w = withWidget(a, () => failing);
  assert.equal(await a.widgetSync(), true);
  assert.equal(w.sent.length, 1);
  assert.equal(await a.widgetSync(), false, 'an unchanged fortnight was sent again');
  assert.equal(w.sent.length, 1);
  /* SACORO changes today's session: the next save carries it. */
  const today = a.findDayByDate('2026-11-14');
  today.km = 14;
  failing = true;
  assert.equal(await a.widgetSync(), false);
  assert.equal(w.sent.length, 2);
  failing = false;
  assert.equal(await a.widgetSync(), true, 'a failed send was not retried, so the widget is left stale');
  assert.equal(w.sent.length, 3);
  assert.match(w.sent[2].days.find(d => d.date === '2026-11-14').line, /^14/);
  /* The plugin throwing outright is no different. */
  a.window.Capacitor.Plugins.SacoroWidget.update = () => { throw new Error('gone'); };
  today.km = 15;
  assert.equal(await a.widgetSync(), false);
  a.window.Capacitor.Plugins.SacoroWidget.update = p => { w.sent.push(p); return Promise.resolve(); };
  assert.equal(await a.widgetSync(), true);
});

test('wired where every change passes: persistState, startup and coming back to the front', () => {
  const src = fs.readFileSync(path.join(ROOT, 'protected/velvet-viking-valhalla.html'), 'utf8');
  const body = n => { const i = src.indexOf('function ' + n + '('); return src.slice(i, src.indexOf('\n}\n', i)); };
  assert.match(body('persistState'), /scheduleCloudPush\(\);[\s\S]*widgetSync\(\)/);
  assert.match(body('init'), /startNotificationScheduler\(\);\s*try\{ widgetSync\(\); \}catch\(e\)\{\}/);
  const vis = src.slice(src.indexOf("document.addEventListener('visibilitychange', function(){\n  if (document.visibilityState!=='visible'){ stravaHiddenSince"));
  assert.match(vis.slice(0, 1200), /checkDateRollover\(\);[\s\S]*widgetSync\(\)/);
});

test('native: the receiver, the plugin and its name, and the redraws it can count on', () => {
  const man = AND('AndroidManifest.xml');
  const rec = man.slice(man.indexOf('<receiver'), man.indexOf('</receiver>'));
  assert.match(rec, /android:name="\.SacoroWidgetProvider"/);
  assert.match(rec, /android:exported="true"/);
  assert.match(rec, /android\.appwidget\.action\.APPWIDGET_UPDATE/);
  assert.match(rec, /android\.intent\.action\.TIME_SET/);
  assert.match(rec, /android\.intent\.action\.TIMEZONE_CHANGED/);
  assert.match(rec, /android:name="android\.appwidget\.provider"\s+android:resource="@xml\/sacoro_widget_info"/);
  /* Never an exact alarm: that permission is what trapped the app before. */
  (man.match(/<uses-permission[^>]*EXACT_ALARM[^>]*>/g) || [])
    .forEach(p => assert.match(p, /tools:node="remove"/, 'an exact-alarm permission is held: ' + p));
  const prov = JAVA('SacoroWidgetProvider');
  assert.doesNotMatch(prov, /setExact|setAlarmClock|canScheduleExactAlarms/);
  assert.match(prov, /am\.set\(AlarmManager\.RTC, /);
  assert.match(prov, /FLAG_IMMUTABLE/);
  assert.match(prov, /SacoroWidgetDays\.linesForToday\(/);
  const info = AND('res/xml/sacoro_widget_info.xml');
  assert.match(info, /android:updatePeriodMillis="1800000"/);
  assert.match(info, /android:targetCellWidth="4"[\s\S]*android:targetCellHeight="2"/);
  /* The plugin's name is the one the runtime asks for, and it is registered
     before the bridge starts. */
  const plug = JAVA('SacoroWidgetPlugin');
  assert.match(plug, /@CapacitorPlugin\(name = "SacoroWidget"\)/);
  assert.match(fs.readFileSync(path.join(ROOT, 'protected/velvet-viking-valhalla.html'), 'utf8'), /nativePlugin\('SacoroWidget'\)/);
  const act = JAVA('MainActivity');
  assert.ok(act.indexOf('registerPlugin(SacoroWidgetPlugin.class)') > -1 && act.indexOf('registerPlugin(SacoroWidgetPlugin.class)') < act.indexOf('super.onCreate(savedInstanceState)'));
});

test('stale or missing data: the widget asks to be opened rather than guessing', () => {
  const days = JAVA('SacoroWidgetDays');
  assert.doesNotMatch(days, /import android\./, 'the day picker must stay runnable off the phone');
  assert.match(days, /if \(!hasPlan\) return NO_PLAN;/);
  assert.match(days, /if \(!today\.equals\(d\.optString\("date"\)\)\) continue;/);
  assert.match(days, /return UNKNOWN;\s*\}\s*\}\s*$/);
  assert.match(days, /UNKNOWN = \{ "TODAY", "Open SACORO", /);
  /* SACORO's own colours only: white words, gold for the label. */
  const lay = AND('res/layout/widget_today.xml');
  const colours = (lay.match(/textColor="#[0-9A-Fa-f]+"/g) || []).map(s => s.slice(11, -1).toUpperCase());
  assert.deepEqual([...new Set(colours)].sort(), ['#E3B15A', '#FFFFFF']);
  assert.match(fs.readFileSync(path.join(ROOT, 'android/app/build.gradle'), 'utf8'), /versionCode 7\s+versionName "1\.6"/);
});
