'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* Founder: "Update the existing 4x2 widget to allow browsing the seven days of
   the current training week. But only future days ... Add subtle left/right
   navigation to move between days. Display each day's prescribed session,
   distance and type. Default to TODAY whenever the widget loads. Automatically
   return to TODAY after locking/unlocking the phone where Android permits, and
   when the date changes. Tapping the session opens it in SACORO. Keep the
   existing design, rounded edges, colours and branding unchanged. Keep the 2x1
   widget as TODAY only. Use Android-supported widget interactions rather than
   relying on swipe gestures."
   The behaviour on a phone -- arrows, resets, every size and font -- is proved
   on an emulator by androidTest/.../WidgetBrowseTest. These are the laws that
   can be read off the source, and the app's half of the tap, which runs here. */

const ROOT = path.join(__dirname, '..');
const AND = p => fs.readFileSync(path.join(ROOT, 'android/app/src/main', p), 'utf8');
const JAVA = n => AND('java/com/velvetviking/valhalla/' + n + '.java');
const body = (src, sig) => { const i = src.indexOf(sig); assert.ok(i > -1, sig); return src.slice(i, src.indexOf('\n    }\n', i)); };

test('the 4x2 has two arrows in its label row, white, named for a screen reader, and keeps its look', () => {
  const lay = AND('res/layout/widget_today.xml');
  ['widget_prev', 'widget_next'].forEach(id => {
    const own = lay.slice(lay.indexOf('android:id="@+id/' + id + '"'));
    const v = own.slice(0, own.indexOf('/>'));
    assert.match(v, /android:contentDescription="(Previous|Next) day"/, id);
    assert.match(v, /android:src="@drawable\/widget_chevron_(left|right)"/, id);
    assert.match(v, /android:layout_height="30dp"/, id + ': the row and the target are one height');
  });
  ['left', 'right'].forEach(n => {
    const d = AND('res/drawable/widget_chevron_' + n + '.xml');
    assert.match(d, /strokeColor="#FFFFFF"/, 'the arrow is not white');
  });
  /* The same ground, colours and label: gold TODAY, white words. */
  assert.match(lay, /android:background="@drawable\/widget_bg"/);
  const colours = (lay.match(/textColor="#[0-9A-Fa-f]+"/g) || []).map(s => s.slice(11, -1).toUpperCase());
  assert.deepEqual([...new Set(colours)].sort(), ['#E3B15A', '#FFFFFF']);
  const label = lay.slice(lay.indexOf('android:id="@+id/widget_label"'));
  assert.match(label.slice(0, label.indexOf('/>')), /android:autoSizeTextType="uniform"[\s\S]*android:autoSizeMaxTextSize="11sp"/,
    'WEDNESDAY at the largest font would wrap or be cut beside the arrows');
});

test('the 2x1 stays TODAY only: no arrows in either 2x1 layout, nor the smallest row', () => {
  ['widget_today_mini', 'widget_today_mini_tall', 'widget_today_mini_narrow', 'widget_today_small', 'widget_today_large'].forEach(n => {
    assert.doesNotMatch(AND('res/layout/' + n + '.xml'), /@\+id\/widget_(prev|next)"/, n + ' grew arrows');
  });
  const prov = JAVA('SacoroWidgetProvider');
  assert.doesNotMatch(body(prov, 'static RemoteViews renderMini(Context context)'), /shownDate|navIntent/);
  assert.doesNotMatch(body(prov, 'static RemoteViews renderMiniTall('), /shownDate|navIntent/);
});

test('only future days of this training week: today, then each day to Sunday, consecutive', () => {
  const days = JAVA('SacoroWidgetDays');
  const b = body(days, 'static List<String> browsableDates(');
  assert.match(b, /out\.add\(today\);/, 'today is not always first');
  assert.match(b, /int left = daysToSunday\(today\);/);
  assert.match(b, /if \(!found\) break;/, 'a gap must end the list, not be stepped over');
  /* Monday has six days after it, Friday two, Sunday none: run as written. */
  const d2s = body(days, 'static int daysToSunday(');
  assert.match(d2s, /return dow == Calendar\.SUNDAY \? 0 : 8 - dow;/);
  const left = dow => (dow === 1 ? 0 : 8 - dow);          // Calendar: SUNDAY 1 .. SATURDAY 7
  assert.deepEqual([2, 3, 4, 5, 6, 7, 1].map(left), [6, 5, 4, 3, 2, 1, 0]);
  /* Never before today, never past Sunday. */
  const step = body(JAVA('SacoroWidgetProvider'), 'static void step(');
  assert.match(step, /i = Math\.max\(0, Math\.min\(days\.size\(\) - 1, i \+ delta\)\);/);
});

test('arrows are taps that send a broadcast, not a swipe; each widget keeps its own day', () => {
  const prov = JAVA('SacoroWidgetProvider');
  const nav = body(prov, 'static PendingIntent navIntent(');
  assert.match(nav, /PendingIntent\.getBroadcast\(/);
  assert.match(nav, /putExtra\(AppWidgetManager\.EXTRA_APPWIDGET_ID, id\)/);
  const med = body(prov, 'static RemoteViews renderMedium(Context context, int widgetId)');
  assert.match(med, /setOnClickPendingIntent\(R\.id\.widget_prev, navIntent\(context, widgetId, ACTION_PREV\)\)/);
  assert.match(med, /setOnClickPendingIntent\(R\.id\.widget_next, navIntent\(context, widgetId, ACTION_NEXT\)\)/);
  /* An arrow with nowhere to go is hidden but keeps its place. */
  assert.match(med, /View\.INVISIBLE/);
  assert.doesNotMatch(med, /widget_(prev|next), [^;]*View\.GONE/);
  const recv = body(prov, 'public void onReceive(');
  assert.match(recv, /step\(context, id, ACTION_NEXT\.equals\(a\) \? 1 : -1\);/);
  assert.match(recv, /manager\.updateAppWidget\(id, viewsFor\(context, manager, id, startSize\(\)\)\);/);
  assert.match(prov, /KEY_SHOWN_PREFIX \+ id/);
});

test('back to TODAY: on every load, on a new date, and on locking or unlocking while SACORO runs', () => {
  const prov = JAVA('SacoroWidgetProvider');
  assert.match(body(prov, 'public void onUpdate('), /forgetShown\(context, id\);/, 'placing or the half-hourly update keeps an old day');
  assert.match(body(prov, 'static void refreshAll('), /backToToday\(context\);/, 'the app saving, midnight or a clock change keeps an old day');
  /* A day chosen yesterday is not a choice today. */
  assert.match(body(prov, 'static String shownDate('), /if \(parts\.length != 2 \|\| !today\.equals\(parts\[1\]\)\) return today;/);
  const watch = body(prov, 'static void watchForUnlock(');
  assert.match(watch, /Intent\.ACTION_SCREEN_OFF/);
  assert.match(watch, /Intent\.ACTION_USER_PRESENT/);
  assert.match(watch, /getApplicationContext\(\)/, 'a receiver may not register on its own context');
  assert.match(watch, /RECEIVER_NOT_EXPORTED/);
  assert.match(body(prov, 'public void onReceive('), /watchForUnlock\(context\);/);
  assert.match(JAVA('MainActivity'), /SacoroWidgetProvider\.watchForUnlock\(this\);/);
});

test('a tap opens SACORO on the day the widget shows', () => {
  const prov = JAVA('SacoroWidgetProvider');
  const med = body(prov, 'static RemoteViews renderMedium(Context context, int widgetId)');
  assert.match(med, /openDayIntent\(context, shown\)/);
  assert.match(med, /setOnClickPendingIntent\(R\.id\.widget_root, pi\)/);
  assert.match(body(prov, 'static Intent openDayIntent('), /putExtra\(EXTRA_OPEN_DAY, date\)/);
  const main = JAVA('MainActivity');
  assert.match(main, /SacoroWidgetPlugin\.noteOpenDay\(getIntent\(\)\);/);
  assert.match(main, /protected void onNewIntent\(Intent intent\) \{\s*super\.onNewIntent\(intent\);\s*SacoroWidgetPlugin\.noteOpenDay\(intent\);/);
  const plug = JAVA('SacoroWidgetPlugin');
  assert.match(plug, /public void takeOpenDay\(PluginCall call\)/);
  assert.match(plug, /pendingOpenDay = null;/, 'a taken day must not be opened twice');
});

function app() {
  const a = loadApp({ pinnedDate: '2026-11-18T09:00:00Z' });          // a Wednesday
  a.showToast = () => {}; a.renderApp = () => {}; a.scheduleSave = () => {}; a.flushSave = () => {};
  buildPlan(a, { weeks: 12, startDate: a.addDays('2026-11-18', -14) });
  return a;
}
function plugin(a, day) {
  const asked = { n: 0 };
  a.nativePlugin = name => name === 'SacoroWidget'
    ? { takeOpenDay: () => { asked.n++; const d = day; day = null; return Promise.resolve({ day: d }); } } : null;
  return asked;
}

test('the app opens a later day in This Week with its card open, and today on Today', async () => {
  const a = app();
  const later = a.addDays(a.todayStr(), 2);
  assert.ok(a.findDayByDate(later), 'the fixture has no day two days on');
  plugin(a, later);
  assert.equal(await a.widgetOpenDay(), later);
  assert.equal(a.state.view, 'week');
  assert.equal(a.weekSelectedDate, later);
  assert.equal(a.weekSessionOpen, true);
  /* Asked again, nothing is waiting: an ordinary open is not sent back to that day. */
  assert.equal(await a.widgetOpenDay(), null);
  const b = app();
  b.state.view = 'week';
  plugin(b, b.todayStr());
  assert.equal(await b.widgetOpenDay(), b.todayStr());
  assert.equal(b.state.view, 'today');
});

test('a day the plan does not have, or anything that is not a date, opens nothing', async () => {
  const a = app();
  a.state.view = 'full';
  for (const d of ['2031-01-01', 'yesterday', '', null]) {
    plugin(a, d);
    assert.equal(await a.widgetOpenDay(), null, String(d));
    assert.equal(a.state.view, 'full', String(d) + ' moved the app');
  }
  /* Older apps have no such method: nothing happens and nothing breaks. */
  a.nativePlugin = () => ({ update: () => Promise.resolve() });
  assert.equal(await a.widgetOpenDay(), null);
});

test('the app asks for the day on starting and on coming back to the foreground', () => {
  const RT = fs.readFileSync(path.join(ROOT, require('./harness.js').RUNTIME_RELATIVE), 'utf8');
  assert.equal((RT.match(/try\{ widgetOpenDay\(\); \}catch\(e\)\{\}/g) || []).length, 2);
  /* The foreground listener that already re-sends the widget its days. */
  const vis = RT.slice(RT.indexOf('/* A new day moves the fortnight on by one; unchanged, it sends nothing. */'));
  assert.match(vis.slice(0, 200), /widgetSync\(\); \}catch\(e\)\{\}\s*try\{ widgetOpenDay\(\); \}catch\(e\)\{\}/, 'resuming does not ask');
});
