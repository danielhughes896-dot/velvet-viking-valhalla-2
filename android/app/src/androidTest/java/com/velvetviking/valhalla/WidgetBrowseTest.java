package com.velvetviking.valhalla;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.RemoteViews;
import android.widget.TextView;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * THE 4x2 WIDGET BROWSES THE REST OF THE TRAINING WEEK.
 *
 * Founder: "Update the existing 4x2 widget to allow browsing the seven days of
 * the current training week. But only future days ... Default to TODAY whenever
 * the widget loads. Automatically return to TODAY after locking/unlocking the
 * phone where Android permits, and when the date changes. Tapping the session
 * opens it in SACORO ... Keep the 2x1 widget as TODAY only ... Test navigation,
 * automatic reset and resizing before the next APK build."
 *
 * The date is fixed (a Monday, then a Friday and a Sunday), so the test proves
 * the same thing whatever day the emulator thinks it is. Every browsable day is
 * drawn at the Pixel 4x2 size and a 5x2, at every font size,
 * measured with WidgetLayoutTest's own rules, and saved as a picture.
 */
@RunWith(AndroidJUnit4.class)
public class WidgetBrowseTest {
    static final String MON = "2026-11-16", TUE = "2026-11-17", WED = "2026-11-18",
            FRI = "2026-11-20", SAT = "2026-11-21", SUN = "2026-11-22";
    static final int ID = 4242;
    Context ctx;

    static String daysJson(String from, int n, String skip) throws Exception {
        JSONArray days = new JSONArray();
        for (int k = 0; k < n; k++) {
            String date = SacoroWidgetDays.addDays(from, k);
            if (date.equals(skip)) continue;
            String[] d = WidgetLayoutTest.CASES[k % WidgetLayoutTest.CASES.length];
            JSONObject o = new JSONObject();
            o.put("date", date); o.put("label", "TODAY");
            o.put("title", d[2]); o.put("line", d[3]); o.put("note", d[4]);
            o.put("dist", d[0]); o.put("kind", d[1]);
            days.put(o);
        }
        return days.toString();
    }

    void store(String from, int n, String skip) throws Exception {
        ctx.getSharedPreferences(SacoroWidgetProvider.PREFS, Context.MODE_PRIVATE).edit()
            .putString(SacoroWidgetProvider.KEY_DAYS, daysJson(from, n, skip))
            .putBoolean(SacoroWidgetProvider.KEY_HAS_PLAN, true).commit();
    }

    @Before
    public void setUp() throws Exception {
        ctx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        SacoroWidgetProvider.sTodayForTest = MON;
        store(MON, 14, null);
        SacoroWidgetProvider.backToToday(ctx);
    }

    @After
    public void tearDown() {
        SacoroWidgetProvider.sTodayForTest = null;
        SacoroWidgetProvider.backToToday(ctx);
    }

    View draw(Context c, int id, float wDp, float hDp) {
        final View[] out = new View[1];
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            float d = c.getResources().getDisplayMetrics().density;
            int wPx = Math.round(wDp * d), hPx = Math.round(hDp * d);
            RemoteViews rv = SacoroWidgetProvider.renderMedium(c, id);
            View v = rv.apply(c, new FrameLayout(c));
            v.measure(View.MeasureSpec.makeMeasureSpec(wPx, View.MeasureSpec.EXACTLY),
                      View.MeasureSpec.makeMeasureSpec(hPx, View.MeasureSpec.EXACTLY));
            v.layout(0, 0, wPx, hPx);
            out[0] = v;
        });
        return out[0];
    }

    static String text(View v, int id) { return String.valueOf(((TextView) v.findViewById(id)).getText()); }

    @Test
    public void onlyTodayToSundayCanBeBrowsed() throws Exception {
        String json = daysJson(MON, 14, null);
        assertEquals(Arrays.asList(MON, TUE, WED, "2026-11-19", FRI, SAT, SUN),
                SacoroWidgetDays.browsableDates(json, true, MON));
        assertEquals("Tuesday does not show Monday", TUE, SacoroWidgetDays.browsableDates(json, true, TUE).get(0));
        assertEquals("Friday is Friday, Saturday and Sunday", Arrays.asList(FRI, SAT, SUN),
                SacoroWidgetDays.browsableDates(json, true, FRI));
        assertEquals(Arrays.asList(SUN), SacoroWidgetDays.browsableDates(json, true, SUN));
        assertEquals("no plan: today alone", Arrays.asList(MON), SacoroWidgetDays.browsableDates(json, false, MON));
        assertEquals("a day the app did not hand over ends the list", Arrays.asList(MON, TUE),
                SacoroWidgetDays.browsableDates(daysJson(MON, 14, WED), true, MON));
        assertEquals("TODAY", SacoroWidgetDays.dayLabel(MON, MON));
        assertEquals("TOMORROW", SacoroWidgetDays.dayLabel(MON, TUE));
        assertEquals("WEDNESDAY", SacoroWidgetDays.dayLabel(MON, WED));
        assertEquals("SUNDAY", SacoroWidgetDays.dayLabel(MON, SUN));
    }

    @Test
    public void arrowsStepOneDayAndStopAtTodayAndSunday() {
        View v = draw(ctx, ID, 276, 220);
        assertEquals("the widget does not open on TODAY", "TODAY", text(v, R.id.widget_label));
        assertEquals(View.INVISIBLE, v.findViewById(R.id.widget_prev).getVisibility());
        assertEquals(View.VISIBLE, v.findViewById(R.id.widget_next).getVisibility());

        SacoroWidgetProvider.step(ctx, ID, 1);
        v = draw(ctx, ID, 276, 220);
        assertEquals("TOMORROW", text(v, R.id.widget_label));
        assertEquals("Tuesday's session is not the one shown", WidgetLayoutTest.CASES[1][2], text(v, R.id.widget_title));
        assertEquals(WidgetLayoutTest.CASES[1][3], text(v, R.id.widget_line));
        assertEquals(View.VISIBLE, v.findViewById(R.id.widget_prev).getVisibility());

        for (int i = 0; i < 10; i++) SacoroWidgetProvider.step(ctx, ID, 1);
        v = draw(ctx, ID, 276, 220);
        assertEquals("it went past Sunday", "SUNDAY", text(v, R.id.widget_label));
        assertEquals(View.INVISIBLE, v.findViewById(R.id.widget_next).getVisibility());

        for (int i = 0; i < 10; i++) SacoroWidgetProvider.step(ctx, ID, -1);
        v = draw(ctx, ID, 276, 220);
        assertEquals("it went before today", "TODAY", text(v, R.id.widget_label));
        assertEquals(View.INVISIBLE, v.findViewById(R.id.widget_prev).getVisibility());

        /* Friday: three days, and no more. */
        SacoroWidgetProvider.sTodayForTest = FRI;
        for (int i = 0; i < 5; i++) SacoroWidgetProvider.step(ctx, ID, 1);
        assertEquals(SUN, SacoroWidgetProvider.shownDate(ctx, ID));
        for (int i = 0; i < 5; i++) SacoroWidgetProvider.step(ctx, ID, -1);
        assertEquals(FRI, SacoroWidgetProvider.shownDate(ctx, ID));
        /* Sunday: nowhere to go either way. */
        SacoroWidgetProvider.sTodayForTest = SUN;
        v = draw(ctx, ID, 276, 220);
        assertEquals(View.INVISIBLE, v.findViewById(R.id.widget_prev).getVisibility());
        assertEquals(View.INVISIBLE, v.findViewById(R.id.widget_next).getVisibility());
    }

    @Test
    public void theArrowBroadcastMovesOnlyThatWidget() {
        SacoroWidgetProvider p = new SacoroWidgetProvider();
        Intent next = new Intent(ctx, SacoroWidgetProvider.class).setAction(SacoroWidgetProvider.ACTION_NEXT)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, ID);
        try { p.onReceive(ctx, next); p.onReceive(ctx, next); } catch (Exception e) { /* no such widget to redraw on a test device */ }
        assertEquals(WED, SacoroWidgetProvider.shownDate(ctx, ID));
        assertEquals("another widget moved with it", MON, SacoroWidgetProvider.shownDate(ctx, ID + 1));
        Intent prev = new Intent(next).setAction(SacoroWidgetProvider.ACTION_PREV);
        try { p.onReceive(ctx, prev); } catch (Exception e) { }
        assertEquals(TUE, SacoroWidgetProvider.shownDate(ctx, ID));
        assertTrue("the lock and unlock listener was not started", SacoroWidgetProvider.watchingLock);
    }

    @Test
    public void everyFreshLookReturnsToToday() {
        /* Locking or unlocking (the running listener calls refreshAll), the app saving, midnight. */
        SacoroWidgetProvider.step(ctx, ID, 2);
        assertEquals(WED, SacoroWidgetProvider.shownDate(ctx, ID));
        SacoroWidgetProvider.refreshAll(ctx);
        assertEquals(MON, SacoroWidgetProvider.shownDate(ctx, ID));
        /* Placed, or the half-hourly update. */
        SacoroWidgetProvider.step(ctx, ID, 2);
        try { new SacoroWidgetProvider().onUpdate(ctx, AppWidgetManager.getInstance(ctx), new int[] { ID }); } catch (Exception e) { }
        assertEquals(MON, SacoroWidgetProvider.shownDate(ctx, ID));
        /* The date changes with the widget on another day: the new today, not yesterday's choice. */
        SacoroWidgetProvider.step(ctx, ID, 2);
        SacoroWidgetProvider.sTodayForTest = TUE;
        assertEquals(TUE, SacoroWidgetProvider.shownDate(ctx, ID));
        View v = draw(ctx, ID, 276, 220);
        assertEquals("TODAY", text(v, R.id.widget_label));
        /* Removed: nothing left behind. */
        SacoroWidgetProvider.step(ctx, ID, 1);
        new SacoroWidgetProvider().onDeleted(ctx, new int[] { ID });
        assertEquals(TUE, SacoroWidgetProvider.shownDate(ctx, ID));
    }

    @Test
    public void theArrowsAndTheSessionAreTappable() {
        SacoroWidgetProvider.step(ctx, ID, 1);
        View v = draw(ctx, ID, 276, 220);
        assertTrue("the previous arrow does nothing", v.findViewById(R.id.widget_prev).hasOnClickListeners());
        assertTrue("the next arrow does nothing", v.findViewById(R.id.widget_next).hasOnClickListeners());
        assertTrue("tapping the session does nothing", v.findViewById(R.id.widget_root).hasOnClickListeners());
        Intent open = SacoroWidgetProvider.openDayIntent(ctx, TUE);
        assertEquals(TUE, open.getStringExtra(SacoroWidgetProvider.EXTRA_OPEN_DAY));
        SacoroWidgetPlugin.pendingOpenDay = null;
        SacoroWidgetPlugin.noteOpenDay(open);
        assertEquals("SACORO is not told which day", TUE, SacoroWidgetPlugin.pendingOpenDay);
        SacoroWidgetPlugin.pendingOpenDay = null;
        SacoroWidgetPlugin.noteOpenDay(new Intent().putExtra(SacoroWidgetProvider.EXTRA_OPEN_DAY, "not a day"));
        assertEquals(null, SacoroWidgetPlugin.pendingOpenDay);
    }

    @Test
    public void theTwoByOneStaysOnToday() {
        SacoroWidgetProvider.step(ctx, ID, 3);
        final View[] out = new View[1];
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            int row = SacoroWidgetProvider.pickLayout(269, 51);
            out[0] = SacoroWidgetProvider.renderLayout(ctx, row, ID).apply(ctx, new FrameLayout(ctx));
        });
        assertEquals("the 2x1 grew arrows", null, out[0].findViewById(R.id.widget_next));
        String session = text(out[0], R.id.widget_session);
        assertTrue("the 2x1 followed the 4x2 off today: " + session, session.startsWith(WidgetLayoutTest.CASES[0][0]));
    }

    @Test
    public void everyDayFitsAtEveryFontSizeAndMediumSize() throws Exception {
        final File dir = new File(ctx.getExternalFilesDir(null), "widget-shots");
        dir.mkdirs();
        List<String> failures = new ArrayList<>();
        StringBuilder report = new StringBuilder();
        /* The Pixel 4x2, and a 5x2 on a wider launcher grid. */
        float[][] sizes = { { 276, 220 }, { 349, 220 } };
        String[] sizeNames = { "4x2", "5x2" };
        for (int s = 0; s < sizes.length; s++) {
            if (SacoroWidgetProvider.LAYOUT_KIND[SacoroWidgetProvider.pickLayout(sizes[s][0], sizes[s][1])] != SacoroWidgetProvider.KIND_MEDIUM) continue;
            for (float scale : WidgetLayoutTest.SCALES) {
                Context c = WidgetLayoutTest.scaled(ctx, scale);
                SacoroWidgetProvider.backToToday(ctx);
                for (int day = 0; day < 7; day++) {
                    final String tag = "browse_" + sizeNames[s] + "_day" + day + "_font" + Math.round(scale * 100);
                    View v = draw(c, ID, sizes[s][0], sizes[s][1]);
                    float d = c.getResources().getDisplayMetrics().density;
                    int hPx = Math.round(sizes[s][1] * d), wPx = Math.round(sizes[s][0] * d);
                    List<String> cut = WidgetLayoutTest.cuts(v, hPx);
                    for (String x : cut) failures.add(tag + ": " + x);
                    report.append(tag).append(cut.isEmpty() ? " ok" : " CUT " + cut).append('\n');
                    final View fv = v;
                    InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                        try {
                            Bitmap bm = Bitmap.createBitmap(wPx + 2 * Math.round(8 * d), hPx + 2 * Math.round(8 * d), Bitmap.Config.ARGB_8888);
                            Canvas cv = new Canvas(bm);
                            cv.drawColor(0xFF3A3F47);
                            cv.translate(8 * d, 8 * d);
                            fv.draw(cv);
                            try (FileOutputStream fo = new FileOutputStream(new File(dir, tag + ".png"))) {
                                bm.compress(Bitmap.CompressFormat.PNG, 100, fo);
                            }
                        } catch (Exception e) {
                            failures.add(tag + ": " + e);
                        }
                    });
                    SacoroWidgetProvider.step(ctx, ID, 1);
                }
            }
        }
        try (FileOutputStream fo = new FileOutputStream(new File(dir, "browse-report.txt"))) {
            fo.write(report.toString().getBytes("UTF-8"));
        }
        assertTrue(failures.size() + " labels cut while browsing:\n" + String.join("\n", failures), failures.isEmpty());
    }
}
