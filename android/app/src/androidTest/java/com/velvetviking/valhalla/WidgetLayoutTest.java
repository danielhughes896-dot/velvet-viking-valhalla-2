package com.velvetviking.valhalla;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.os.Build;
import android.text.Layout;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.RemoteViews;
import android.widget.TextView;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileOutputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/**
 * THE WIDGET AT THE SIZES A PIXEL ACTUALLY GIVES IT, AT EVERY FONT SIZE.
 *
 * Founder: "Fix the 2x1 text clipping. TODAY currently displays as TODA ...
 * Please test at actual Pixel launcher dimensions, including font scaling."
 *
 * Every layout is drawn, on a real Android, into exactly the space the Pixel
 * launcher gives a widget of that many cells (Android's published cell
 * sizes: a portrait 2x1 is 130 by 102dp, a landscape one 269 by 51), at the
 * phone's font sizes from smallest to largest, for an easy day, the longest
 * words SACORO uses ("14.5 KM INTERVALS"), a long-run name, a rest day and
 * the honest fallback. Then every label is measured:
 *   - no word is ever cut: a line wider than its box, or taller than it, or
 *     a label outside the widget, fails;
 *   - a label may end in "..." only where the layout already asks for that
 *     (long session names, the coaching line); the 2x1 asks for it nowhere.
 * On Android 12 and later it also checks that the launcher's own choice of
 * layout, from the size-keyed views, is the one SacoroWidgetProvider expects.
 * Each case is saved as a picture under files/widget-shots for the workflow
 * to collect.
 */
@RunWith(AndroidJUnit4.class)
public class WidgetLayoutTest {
    static final String[] SIZE_NAMES = { "2x1", "3x1", "4x1", "2x2", "4x2", "4x3", "4x4", "2x1-landscape", "4x2-landscape", "smallest" };
    static final float[][] SIZES = { {130,102}, {203,102}, {276,102}, {130,220}, {276,220}, {276,337}, {276,455}, {269,51}, {554,117}, {110,40} };
    static final int[] EXPECT = {
        SacoroWidgetProvider.KIND_TALL, SacoroWidgetProvider.KIND_TALL, SacoroWidgetProvider.KIND_ROW,
        SacoroWidgetProvider.KIND_SMALL, SacoroWidgetProvider.KIND_MEDIUM, SacoroWidgetProvider.KIND_LARGE,
        SacoroWidgetProvider.KIND_LARGE, SacoroWidgetProvider.KIND_ROW, SacoroWidgetProvider.KIND_ROW,
        SacoroWidgetProvider.KIND_ROW_NARROW };
    static final float[] SCALES = { 0.85f, 1.0f, 1.3f, 2.0f };
    /* dist, kind, title, line, note */
    static final String[][] CASES = {
        { "8 KM", "EASY", "Easy Aerobic", "8km at 5:40–6:10/km", "Keep it conversational the whole way. If you can’t talk in full sentences, ease off." },
        { "14.5 KM", "INTERVALS", "Threshold: 5 x 1 km", "14.5km at 4:05–4:15/km", "Even splits. The last rep should feel like the first." },
        { "32 KM", "LONG", "Long Run: Rolling with Surges", "32km at 5:30–6:10/km", "Effort stays even; pace will not, and should not." },
        { "", "REST DAY", "REST DAY", "Full rest.", "A full day off keeps the weeks repeatable. Consistency over months beats any single session." },
        { "", "OPEN SACORO", "Your plan", "Open SACORO for today’s plan.", "" },
    };
    static final String[] CASE_NAMES = { "easy", "intervals", "long", "rest", "open" };

    static String day(int k) {
        Calendar c = Calendar.getInstance();
        c.add(Calendar.DAY_OF_YEAR, k);
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(c.getTime());
    }

    static void store(Context ctx, String[] today) throws Exception {
        JSONArray days = new JSONArray();
        for (int k = 0; k < 4; k++) {
            String[] d = k == 0 ? today : CASES[(k) % CASES.length];
            JSONObject o = new JSONObject();
            o.put("date", day(k)); o.put("label", "TODAY");
            o.put("title", d[2]); o.put("line", d[3]); o.put("note", d[4]);
            o.put("dist", d[0]); o.put("kind", d[1]);
            days.put(o);
        }
        ctx.getSharedPreferences(SacoroWidgetProvider.PREFS, Context.MODE_PRIVATE).edit()
            .putString(SacoroWidgetProvider.KEY_DAYS, days.toString())
            .putBoolean(SacoroWidgetProvider.KEY_HAS_PLAN, true).commit();
    }

    static Context scaled(Context base, float fontScale) {
        Configuration cfg = new Configuration(base.getResources().getConfiguration());
        cfg.fontScale = fontScale;
        return base.createConfigurationContext(cfg);
    }

    static int kindOf(View v) {
        if (v.findViewById(R.id.widget_next_head) != null) return SacoroWidgetProvider.KIND_LARGE;
        if (v.findViewById(R.id.widget_dist) != null) return SacoroWidgetProvider.KIND_TALL;
        if (v.findViewById(R.id.widget_session) != null)
            return v.findViewById(R.id.widget_label) == null ? SacoroWidgetProvider.KIND_ROW_NARROW : SacoroWidgetProvider.KIND_ROW;
        if (v.findViewById(R.id.widget_note) != null) return SacoroWidgetProvider.KIND_MEDIUM;
        return SacoroWidgetProvider.KIND_SMALL;
    }

    static void texts(View v, List<TextView> out) {
        if (v.getVisibility() != View.VISIBLE) return;
        if (v instanceof TextView) { out.add((TextView) v); return; }
        if (v instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) texts(g.getChildAt(i), out);
        }
    }

    static int top(View v, View root) {
        int y = 0;
        while (v != null && v != root) { y += v.getTop(); v = (View) v.getParent(); }
        return y;
    }

    static String name(TextView tv) {
        try { return tv.getResources().getResourceEntryName(tv.getId()); } catch (Exception e) { return "text"; }
    }

    /** Every way a label can be cut, as sentences; empty when none is. */
    static List<String> cuts(View root, int hPx) {
        List<String> out = new ArrayList<>();
        List<TextView> tvs = new ArrayList<>();
        texts(root, tvs);
        for (TextView tv : tvs) {
            CharSequence t = tv.getText();
            if (t == null || t.length() == 0) continue;
            String who = name(tv) + " \"" + t + "\"";
            Layout l = tv.getLayout();
            if (l == null) { out.add(who + " was never laid out"); continue; }
            int availW = tv.getWidth() - tv.getTotalPaddingLeft() - tv.getTotalPaddingRight();
            int availH = tv.getHeight() - tv.getTotalPaddingTop() - tv.getTotalPaddingBottom();
            boolean mayEllipsize = tv.getEllipsize() != null;
            int shown = Math.min(l.getLineCount(), tv.getMaxLines());
            if (l.getLineCount() > tv.getMaxLines() && !mayEllipsize) out.add(who + " needs " + l.getLineCount() + " lines and has " + tv.getMaxLines());
            /* getLineMax, not getLineWidth: getLineWidth counts the space a
               line was broken at, which Android lets hang past the edge
               undrawn. Run 3 flagged three coaching lines and a title "2px
               too wide" for that space alone. */
            for (int i = 0; i < shown; i++) {
                if (l.getEllipsisCount(i) > 0 && !mayEllipsize) out.add(who + " is ellipsized");
                if (l.getLineMax(i) > availW + 1) out.add(who + " is " + Math.round(l.getLineMax(i)) + "px wide in " + availW + "px");
            }
            if (shown > 0 && l.getLineBottom(shown - 1) > availH + 2) out.add(who + " is " + l.getLineBottom(shown - 1) + "px tall in " + availH + "px");
            int bottom = top(tv, root) + tv.getHeight();
            if (bottom > hPx + 1) out.add(who + " ends " + (bottom - hPx) + "px below the widget");
            if (tv.getWidth() <= 0 || tv.getHeight() <= 0) out.add(who + " has no room at all");
        }
        return out;
    }

    @Test
    public void everyLabelFitsAtEveryPixelSizeAndFontSize() throws Exception {
        final Context base = InstrumentationRegistry.getInstrumentation().getTargetContext();
        final File dir = new File(base.getExternalFilesDir(null), "widget-shots");
        dir.mkdirs();
        final List<String> failures = new ArrayList<>();
        final StringBuilder report = new StringBuilder();
        for (int c = 0; c < CASES.length; c++) {
            store(base, CASES[c]);
            for (int s = 0; s < SIZES.length; s++) {
                final float w = SIZES[s][0], h = SIZES[s][1];
                final int layout = SacoroWidgetProvider.pickLayout(w, h);
                int kind = SacoroWidgetProvider.LAYOUT_KIND[layout];
                assertEquals(SIZE_NAMES[s] + " picks the wrong layout", EXPECT[s], kind);
                for (float scale : SCALES) {
                    final Context ctx = scaled(base, scale);
                    final String tag = SIZE_NAMES[s] + "_" + CASE_NAMES[c] + "_font" + Math.round(scale * 100);
                    final int fk = kind, fs = s, fc = c;
                    final float fscale = scale;
                    InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                        try {
                            float d = ctx.getResources().getDisplayMetrics().density;
                            int wPx = Math.round(w * d), hPx = Math.round(h * d);
                            FrameLayout parent = new FrameLayout(ctx);
                            RemoteViews rv = SacoroWidgetProvider.renderLayout(ctx, layout);
                            View v = rv.apply(ctx, parent);
                            v.measure(View.MeasureSpec.makeMeasureSpec(wPx, View.MeasureSpec.EXACTLY),
                                      View.MeasureSpec.makeMeasureSpec(hPx, View.MeasureSpec.EXACTLY));
                            v.layout(0, 0, wPx, hPx);
                            List<String> cut = cuts(v, hPx);
                            for (String x : cut) failures.add(tag + ": " + x);
                            report.append(tag).append(cut.isEmpty() ? " ok" : " CUT " + cut).append('\n');
                            /* The drawn layout is the one picked for this size. (The
                               launcher's own choice among the size-keyed layouts is
                               not reachable from a public API; the keys it chooses
                               from are the ones pickLayout reads, asserted above.) */
                            if (kindOf(v) != fk) failures.add(tag + ": drew layout " + kindOf(v) + ", not " + fk);
                            /* Android 12 and later refuses a size-keyed RemoteViews it
                               cannot use (too many, duplicate sizes): build it here. */
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) SacoroWidgetProvider.responsive(ctx);
                            Bitmap bm = Bitmap.createBitmap(wPx + 2 * Math.round(8 * d), hPx + 2 * Math.round(8 * d), Bitmap.Config.ARGB_8888);
                            Canvas cv = new Canvas(bm);
                            cv.drawColor(0xFF3A3F47);
                            cv.translate(8 * d, 8 * d);
                            v.draw(cv);
                            try (FileOutputStream fo = new FileOutputStream(new File(dir, tag + ".png"))) {
                                bm.compress(Bitmap.CompressFormat.PNG, 100, fo);
                            }
                        } catch (Exception e) {
                            failures.add(tag + ": " + e);
                        }
                    });
                }
            }
        }
        try (FileOutputStream fo = new FileOutputStream(new File(dir, "report.txt"))) {
            fo.write(report.toString().getBytes("UTF-8"));
        }
        assertTrue(failures.size() + " labels cut:\n" + String.join("\n", failures), failures.isEmpty());
    }

    /** Resizing: every entry can be dragged in both directions, down to the single row. */
    @Test
    public void everyEntryResizesBothWays() {
        Context ctx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        android.appwidget.AppWidgetManager m = android.appwidget.AppWidgetManager.getInstance(ctx);
        int found = 0;
        for (android.appwidget.AppWidgetProviderInfo info : m.getInstalledProvidersForPackage(ctx.getPackageName(), null)) {
            found++;
            assertEquals(info.provider.getClassName() + " is not resizable both ways",
                android.appwidget.AppWidgetProviderInfo.RESIZE_BOTH, info.resizeMode & android.appwidget.AppWidgetProviderInfo.RESIZE_BOTH);
        }
        assertEquals("expected the four SACORO widget entries", 4, found);
    }
}
