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
      assert.deepEqual(Object.keys(d).sort(), ['date', 'dist', 'kind', 'label', 'line', 'note', 'title'], 'the widget was handed something other than words for one day');
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
  /* "today" only of today: the 4x2 widget now shows the days after it too. */
  const when = h.date === a.todayStr() ? 'today' : 'that day';
  assert.deepEqual([h.title, h.line, h.note], ['Your plan', 'Open SACORO for ' + when + '’s plan.', ''], 'a restricted day says more than to open the app');
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
  const lft = days.slice(days.indexOf('static String[] linesForToday('), days.indexOf('static String[][] upcoming('));
  assert.match(lft, /return UNKNOWN;\s*\}\s*(\/\*\*[\s\S]*)?$/, 'the last word of linesForToday must be the honest one');
  assert.match(days, /UNKNOWN = \{ "TODAY", "Open SACORO", /);
  /* SACORO's own colours only: white words, gold for the label. */
  const lay = AND('res/layout/widget_today.xml');
  const colours = (lay.match(/textColor="#[0-9A-Fa-f]+"/g) || []).map(s => s.slice(11, -1).toUpperCase());
  assert.deepEqual([...new Set(colours)].sort(), ['#E3B15A', '#FFFFFF']);
  assert.match(fs.readFileSync(path.join(ROOT, 'android/app/build.gradle'), 'utf8'), /versionCode 10\s+versionName "1\.9"/);
});

/* PHASE TWO. Founder: "8 - let's do small and large." Same data, same
   privacy, same redraws; only what each size draws differs. */
test('four sizes on the home screen: 2x1, small 2x2, medium 4x2, large 4x4, each its own entry', () => {
  const man = AND('AndroidManifest.xml');
  const receivers = man.match(/<receiver[\s\S]*?<\/receiver>/g) || [];
  const byName = {};
  receivers.forEach(r => { const n = /android:name="\.(\w+)"/.exec(r); if (n) byName[n[1]] = r; });
  [['SacoroWidgetProvider', 'sacoro_widget_info', 4, 2], ['SacoroWidgetMini', 'sacoro_widget_mini_info', 2, 1],
   ['SacoroWidgetSmall', 'sacoro_widget_small_info', 2, 2],
   ['SacoroWidgetLarge', 'sacoro_widget_large_info', 4, 4]].forEach(([cls, info, w, h]) => {
    const r = byName[cls];
    assert.ok(r, cls + ' is not on the home screen list');
    assert.match(r, /android:exported="true"/);
    assert.match(r, /android\.appwidget\.action\.APPWIDGET_UPDATE/);
    assert.match(r, new RegExp('android:resource="@xml/' + info + '"'));
    const x = AND('res/xml/' + info + '.xml');
    assert.match(x, new RegExp('android:targetCellWidth="' + w + '"[\\s\\S]*android:targetCellHeight="' + h + '"'));
    assert.match(x, /android:updatePeriodMillis="1800000"/);
    const desc = /android:description="@string\/(\w+)"/.exec(x)[1];
    assert.match(AND('res/values/strings.xml'), new RegExp('name="' + desc + '"'));
  });
  /* Four starting sizes of ONE resizable widget. Founder: "Enable Android
     widget resizing, like the standard weather widget ... drag the widget
     edges and have the layout adapt between compact and expanded sizes."
     Each entry differs only in the size it starts at; every one draws
     whichever layout fits the space it is given. */
  assert.match(JAVA('SacoroWidgetMini'), /extends SacoroWidgetProvider[\s\S]*float\[\] startSize\(\) \{ return new float\[\] \{ 130, 102 \}; \}/);
  assert.match(JAVA('SacoroWidgetSmall'), /extends SacoroWidgetProvider[\s\S]*float\[\] startSize\(\) \{ return new float\[\] \{ 130, 220 \}; \}/);
  assert.match(JAVA('SacoroWidgetLarge'), /extends SacoroWidgetProvider[\s\S]*float\[\] startSize\(\) \{ return new float\[\] \{ 276, 455 \}; \}/);
  assert.match(JAVA('SacoroWidgetProvider'), /float\[\] startSize\(\) \{ return new float\[\] \{ 276, 220 \}; \}/);
  ['sacoro_widget_info', 'sacoro_widget_mini_info', 'sacoro_widget_small_info', 'sacoro_widget_large_info'].forEach(n => {
    const x = AND('res/xml/' + n + '.xml');
    assert.match(x, /android:resizeMode="horizontal\|vertical"/, n + ' cannot be dragged both ways');
    assert.match(x, /android:minResizeWidth="110dp"/, n);
    assert.match(x, /android:minResizeHeight="40dp"/, n);
  });
});

test('every redraw redraws every size, and the midnight redraw outlives any one size', () => {
  const prov = JAVA('SacoroWidgetProvider');
  const refresh = prov.slice(prov.indexOf('static void refreshAll('), prov.indexOf('static String todayKey('));
  ['SacoroWidgetProvider', 'SacoroWidgetMini', 'SacoroWidgetSmall', 'SacoroWidgetLarge'].forEach(c => {
    assert.ok(refresh.indexOf(c + '.class') > -1, 'refreshAll leaves out ' + c);
    assert.ok(refresh.indexOf('new ' + c + '().startSize()') > -1, 'refreshAll does not redraw ' + c + ' at its own size');
  });
  assert.match(refresh, /viewsFor\(context, manager, id, /);
  /* Every layout can be drawn, and every one is offered to the launcher. */
  const rk = prov.slice(prov.indexOf('static RemoteViews renderLayout('), prov.indexOf('static RemoteViews responsive('));
  ['renderMiniNarrow(context)', 'renderMini(context)', 'renderMiniTall(context)', 'renderSmall(context)', 'renderMedium(context, widgetId)',
   'renderLarge(context, LAYOUT_KEYS[i][1])'].forEach(r =>
    assert.ok(rk.indexOf(r) > -1, 'renderLayout never draws ' + r));
  const disabled = prov.slice(prov.indexOf('public void onDisabled('), prov.indexOf('static int[] idsOf('));
  assert.match(disabled, /if \(placedCount\(context\) > 0\) return;/,
    'removing the last small widget would stop the midnight redraw for a medium one still placed');
  /* The plugin redraws through refreshAll, so a save reaches all three. */
  assert.match(JAVA('SacoroWidgetPlugin'), /SacoroWidgetProvider\.refreshAll\(ctx\);/);
});

test('the large widget lists only days it was given, from tomorrow, in words, and stops at a gap', () => {
  const days = JAVA('SacoroWidgetDays');
  const up = days.slice(days.indexOf('static String[][] upcoming('), days.indexOf('static String addDays('));
  assert.match(up, /if \(!hasPlan \|\| n <= 0\) return new String\[0\]\[\];/);
  assert.match(up, /for \(int k = 1; k <= n; k\+\+\)/);
  assert.match(up, /if \(found == null\) break;/, 'a missing day must end the list, not be skipped');
  assert.match(up, /catch \(Exception e\) \{\s*return new String\[0\]\[\];/);
  assert.match(days, /if \(k == 1\) return "TOMORROW";/);
  assert.match(days, /new SimpleDateFormat\("EEEE", Locale\.UK\)/);
  const prov = JAVA('SacoroWidgetProvider');
  assert.match(prov, /v\.setViewVisibility\(R\.id\.widget_next_head, next\.length > 0 \? View\.VISIBLE : View\.GONE\);/);
  assert.match(prov, /v\.setViewVisibility\(row\[0\], View\.GONE\);/);
  /* Small draws no coaching line: two lines of it would not fit. */
  const small = prov.slice(prov.indexOf('static RemoteViews renderSmall('), prov.indexOf('static final int[][] LARGE_ROWS'));
  assert.doesNotMatch(small, /widget_note/);
});

test('the new sizes keep SACORO’s colours: white words, gold only for the label', () => {
  ['widget_today_small', 'widget_today_large'].forEach(n => {
    const lay = AND('res/layout/' + n + '.xml');
    const colours = (lay.match(/textColor="#[0-9A-Fa-f]+"/g) || []).map(s => s.slice(11, -1).toUpperCase());
    assert.deepEqual([...new Set(colours)].sort(), ['#E3B15A', '#FFFFFF'], n);
    const gold = lay.split(/<TextView/).filter(t => /#E3B15A/i.test(t));
    assert.equal(gold.length, 1, n + ': gold on more than the label');
    assert.match(gold[0], /android:id="@\+id\/widget_label"/);
    assert.match(lay, /android:background="@drawable\/widget_bg"/);
    assert.doesNotMatch(lay, /ImageView|<View\b/, n + ': an icon or a dividing rule');
  });
  for (let i = 1; i <= 3; i++) assert.match(AND('res/layout/widget_today_large.xml'), new RegExp('widget_next' + i + '_day'));
});

/* THE 2x1. Founder: "Could you build a 2 x 1 widget with dot SACORO dot top
   centre, left aligned today and then right aligned 8km easy. Make the text
   as big as possible for the box size? Or that fits neatly inside. Keep the
   colours." And of the mock: "No pace, no unnecessary text." */
test('2x1: every day carries its distance and one word for the run, and nothing else', () => {
  for (const o of [{}, { distanceKey: 'full', volume: 70, weeks: 16 }, { distanceKey: '5k', volume: 25, weeks: 8 }]){
    const a = app(o);
    a.widgetPayload().days.forEach(d => {
      const dd = a.findDayByDate(d.date);
      assert.match(d.kind, /^[A-Z ]+$/, d.date + ': the kind is not one word in capitals: ' + d.kind);
      assert.doesNotMatch(d.dist + ' ' + d.kind, /\/km|\/mi|:\d\d|bpm|at /i, 'a pace or a heart rate reached the 2x1');
      if (dd && dd.type !== 'rest' && !a.isOptionalRunDay(dd) && !a.dayRestricted(dd)){
        assert.equal(d.dist, a.kmToDisplay(dd.km) + ' ' + a.displayUnit().toUpperCase(), 'the distance is not the card’s');
      } else assert.equal(d.dist, '');
    });
  }
  const a = app();
  const kinds = new Set(a.widgetPayload().days.map(d => d.kind));
  assert.ok(kinds.has('EASY') && kinds.has('REST DAY'), [...kinds].join(', '));
  assert.ok(![...kinds].some(k => /LONG RUN|INTERVAL$/.test(k)), 'the long names reached the 2x1');
  /* Miles when the athlete runs in miles. */
  a.state.units = 'mi';
  const run = a.widgetPayload().days.find(d => d.dist);
  assert.match(run.dist, / MI$/);
});

test('2x1: the mark across the top, TODAY left, the session right, both sized to the box, in SACORO’s colours', () => {
  /* Founder: "TODAY currently displays as TODA. Adjust the spacing and
     responsive text sizing so all labels remain visible." TODAY has a column
     of its own width and sizes itself to fit inside it, so it can shrink but
     never be cut; the session takes the rest. The real proof is on a device:
     androidTest/.../WidgetLayoutTest at every Pixel size and font size. */
  ['widget_today_mini', 'widget_today_mini_tall'].forEach(n => {
    const lay = AND('res/layout/' + n + '.xml');
    assert.match(lay, /android:background="@drawable\/widget_bg"/, n + ': the rounded dark ground is gone');
    /* At the largest font size the mark wanted three lines on a 2x1 (found
       on a Pixel 7 emulator): it has a fixed line and shrinks into it. */
    const mark = lay.slice(lay.indexOf('android:id="@+id/widget_mark"'));
    const markOwn = mark.slice(0, mark.indexOf('/>'));
    assert.match(markOwn, /android:layout_height="14dp"/, n + ': the mark grows with the font and wraps');
    assert.match(markOwn, /android:autoSizeTextType="uniform"/, n);
    assert.match(markOwn, /android:autoSizeMinTextSize="6dp"/, n);
    assert.match(lay, /android:id="@\+id\/widget_mark"[\s\S]*?android:gravity="center_horizontal"[\s\S]*?android:text="•  SACORO  •"[\s\S]*?android:textColor="#E3B15A"/, n);
    const label = lay.slice(lay.indexOf('android:id="@+id/widget_label"'));
    const own = label.slice(0, label.indexOf('/>'));
    assert.match(own, /android:layout_width="44dp"/, n + ': TODAY has lost its own column');
    assert.match(own, /android:text="TODAY"/, n);
    assert.match(own, /android:textColor="#FFFFFF"/, n);
    assert.match(own, /android:autoSizeTextType="uniform"/, n + ': TODAY no longer shrinks to fit');
    assert.match(own, /android:autoSizeMinTextSize="6dp"/, n + ': a minimum in sp grows with the font and pushes TODAY past its column');
  });
  const row = AND('res/layout/widget_today_mini.xml');
  const label = row.slice(row.indexOf('android:id="@+id/widget_label"'), row.indexOf('android:id="@+id/widget_session"'));
  const sess = row.slice(row.indexOf('android:id="@+id/widget_session"'));
  assert.match(sess, /android:layout_weight="1"/);
  assert.match(sess, /android:gravity="end\|center_vertical"/);
  assert.match(sess, /android:autoSizeTextType="uniform"/);
  assert.ok(+/autoSizeMaxTextSize="(\d+)sp"/.exec(sess)[1] > +/autoSizeMaxTextSize="(\d+)sp"/.exec(label)[1],
    'the session should be the biggest thing in the box');
  assert.match(sess, /android:maxLines="1"/);
  /* Narrow 2x1: the distance over the kind, white then cherry. */
  const tall = AND('res/layout/widget_today_mini_tall.xml');
  assert.match(tall, /android:id="@\+id\/widget_dist"[\s\S]*?android:textColor="#FFFFFF"[\s\S]*?android:textStyle="bold"[\s\S]*?android:autoSizeTextType="uniform"/);
  assert.match(tall, /android:id="@\+id\/widget_kind"[\s\S]*?android:textColor="#C46A89"[\s\S]*?android:autoSizeTextType="uniform"/, 'the kind is not cherry');
  const prov = JAVA('SacoroWidgetProvider');
  assert.match(prov, /static final int CHERRY = 0xFFC46A89;/, 'the kind is not in SACORO’s cherry');
  const cs = prov.slice(prov.indexOf('static CharSequence compactSession('), prov.indexOf('static RemoteViews renderMini('));
  assert.match(cs, /new StyleSpan\(Typeface\.BOLD\)/);
  assert.match(cs, /new ForegroundColorSpan\(CHERRY\)/);
  const days = JAVA('SacoroWidgetDays');
  const c = days.slice(days.indexOf('static String[] compactForToday('), days.indexOf('/** The days after today'));
  assert.match(c, /if \(!hasPlan\) return new String\[\] \{ "", "NO PLAN" \};/);
  assert.match(c, /if \(kind\.isEmpty\(\)\) kind = d\.optString\("title", ""\)\.toUpperCase\(Locale\.UK\);/,
    'an app too old to send the kind would leave the 2x1 empty');
  assert.match(c, /return new String\[\] \{ "", "OPEN SACORO" \};/);
});

test('resizing: the layout picked at every Pixel launcher size, and dragging an edge redraws it', () => {
  /* Founder: "drag the widget edges and have the layout adapt between
     compact and expanded sizes." pickLayout is run here as written in Java,
     against the space the Pixel launcher gives each cell size (dp). */
  const prov = JAVA('SacoroWidgetProvider');
  const keys = /static final float\[\]\[\] LAYOUT_KEYS = \{([\s\S]*?)\};/.exec(prov)[1]
    .replace(/\/\/.*$/gm, '').match(/\{\s*\d+,\s*\d+\s*\}/g).map(k => k.match(/\d+/g).map(Number));
  const kinds = /static final int\[\] LAYOUT_KIND = \{([^}]*)\};/.exec(prov)[1].split(',').map(x => x.trim());
  const body = /static int pickLayout\(float w, float h\) \{([\s\S]*?)\n    \}/.exec(prov)[1]
    .replace(/\bint |\bfloat /g, 'let ').replace(/let kw = (.*), kh = /, 'let kw = $1; let kh = ');
  const pick = new Function('LAYOUT_KEYS', 'w', 'h', body);
  const at = (w, h) => kinds[pick(keys, w, h)];
  const want = [
    ['portrait 2x1', 130, 102, 'KIND_TALL'],
    ['landscape 2x1', 269, 51, 'KIND_ROW'],
    ['3x1', 203, 102, 'KIND_TALL'],
    ['4x1', 276, 102, 'KIND_ROW'],
    ['2x2', 130, 220, 'KIND_SMALL'],
    ['4x2', 276, 220, 'KIND_MEDIUM'],
    ['landscape 4x2', 554, 117, 'KIND_ROW'],
    ['4x3', 276, 337, 'KIND_LARGE'],
    ['4x4', 276, 455, 'KIND_LARGE'],
    ['smallest it can be dragged to', 110, 40, 'KIND_ROW_NARROW'],
    ['smaller than any layout', 60, 30, 'KIND_ROW_NARROW'],
    ['a short row wide enough for TODAY', 160, 40, 'KIND_ROW'],
    ['just short of a 4x3', 276, 320, 'KIND_MEDIUM'],
  ];
  want.forEach(([name, w, h, k]) => assert.equal(at(w, h), k, name + ' (' + w + 'x' + h + ') draws ' + at(w, h)));
  /* Android 12 and later: every layout handed to the launcher at once. */
  /* Each placed widget is drawn as itself, so a 4x2 shows the day it is on. */
  assert.match(prov, /if \(Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.S\) return responsive\(context, id\);/);
  assert.match(prov, /m\.put\(new SizeF\(LAYOUT_KEYS\[i\]\[0\], LAYOUT_KEYS\[i\]\[1\]\), renderLayout\(context, i, widgetId\)\);/);
  /* Older Android: the size the launcher reports, remade when it changes. */
  assert.match(prov, /return renderLayout\(context, pickLayout\(w, h\), id\);/);
  assert.match(prov, /public void onAppWidgetOptionsChanged\(Context context, AppWidgetManager manager, int id, Bundle newOptions\) \{\s*manager\.updateAppWidget\(id, viewsFor\(context, manager, id, startSize\(\)\)\);/);
  /* The narrow 2x1 keeps the session data: distance white, kind cherry. */
  const tall = prov.slice(prov.indexOf('static RemoteViews renderMiniTall('));
  assert.match(tall.slice(0, tall.indexOf('\n    }\n')), /SacoroWidgetDays\.compactForToday\(/);
});

/* Widget check run 3, at every Pixel size and every font size: the smallest
   row had 30dp for the session, "TOMORROW" outgrew its column at 130%, and
   the large widget listed more days than fit at 130% and 200%. */
test('the smallest row is the mark and the session across the whole width', () => {
  const lay = AND('res/layout/widget_today_mini_narrow.xml');
  assert.doesNotMatch(lay, /widget_label/, 'TODAY\u2019s column leaves the session 30dp');
  assert.match(lay, /android:id="@\+id\/widget_mark"[\s\S]*?android:layout_height="14dp"[\s\S]*?android:text="\u2022  SACORO  \u2022"[\s\S]*?android:textColor="#E3B15A"/);
  const sess = lay.slice(lay.indexOf('android:id="@+id/widget_session"'));
  assert.match(sess, /android:layout_width="match_parent"/);
  assert.match(sess, /android:maxLines="1"/);
  assert.match(sess, /android:autoSizeTextType="uniform"/);
  assert.match(sess, /android:autoSizeMinTextSize="\d+dp"/, 'a minimum in sp grows with the font');
  const prov = JAVA('SacoroWidgetProvider');
  const narrow = prov.slice(prov.indexOf('static RemoteViews renderMiniNarrow('), prov.indexOf('static RemoteViews renderMiniTall('));
  assert.match(narrow, /R\.layout\.widget_today_mini_narrow/);
  assert.match(narrow, /compactSession\(c\[0\], c\[1\]\)/, 'the session loses its white distance and cherry kind');
});

test('the large widget lists only the coming days that fit its height at the phone\u2019s font size', () => {
  const prov = JAVA('SacoroWidgetProvider');
  const k = n => +new RegExp(n + ' = ([\\d.]+)f').exec(prov)[1];
  const body = /static int comingRows\(float heightDp, float fontScale\) \{([\s\S]*?)\n    \}/.exec(prov)[1];
  assert.match(body, /LARGE_TOP_DP \+ LARGE_TOP_SP \* LINE \* fontScale/, 'the words above the list do not grow with the font');
  assert.match(body, /LARGE_ROW_DP \+ LARGE_ROW_SP \* LINE \* fontScale/);
  assert.match(body, /Math\.max\(0, Math\.min\(LARGE_ROWS\.length, n\)\)/);
  const rows = (h, s) => {
    const top = k('LARGE_TOP_DP') + k('LARGE_TOP_SP') * k('LINE') * s;
    const row = k('LARGE_ROW_DP') + k('LARGE_ROW_SP') * k('LINE') * s;
    return Math.max(0, Math.min(3, Math.floor((h - top) / row)));
  };
  /* At 4x3 and 4x4, by font size: what the device check showed would fit. */
  assert.deepEqual([0.85, 1, 1.3, 2].map(s => rows(330, s)), [3, 3, 2, 0], '4x3');
  assert.deepEqual([0.85, 1, 1.3, 2].map(s => rows(440, s)), [3, 3, 3, 1], '4x4');
  const large = prov.slice(prov.indexOf('static RemoteViews renderLarge('), prov.indexOf('static PendingIntent midnightIntent('));
  assert.match(large, /comingRows\(heightDp, context\.getResources\(\)\.getConfiguration\(\)\.fontScale\)/);
  /* The day takes the room its word needs: the same 92dp at normal sizes. */
  const lay = AND('res/layout/widget_today_large.xml');
  for (let i = 1; i <= 3; i++) {
    const d = lay.slice(lay.indexOf('android:id="@+id/widget_next' + i + '_day"'));
    const own = d.slice(0, d.indexOf('/>'));
    assert.match(own, /android:layout_width="wrap_content"/, 'day ' + i + ' has a fixed column again');
    assert.match(own, /android:minWidth="82dp"/);
    assert.match(own, /android:layout_marginEnd="10dp"/);
    assert.match(own, /android:maxLines="1"/);
  }
});
