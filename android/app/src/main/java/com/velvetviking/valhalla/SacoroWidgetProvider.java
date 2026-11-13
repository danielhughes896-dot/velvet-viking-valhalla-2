package com.velvetviking.valhalla;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.util.ArrayMap;
import android.util.SizeF;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
import android.text.style.StyleSpan;
import android.view.View;
import android.widget.RemoteViews;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.Map;

/**
 * THE TODAY WIDGET, in four sizes. This class is the medium one (4x2) and
 * the shared machinery; SacoroWidgetMini (2x1), SacoroWidgetSmall (2x2) and
 * SacoroWidgetLarge (4x4) differ only in what they draw.
 *
 * Founder: "I particularly like the idea of an athlete waking up, glancing at
 * their phone and immediately seeing what SACORO has planned." And the three
 * conditions the founder set: automatic updates ("No stale training advice"),
 * rest days that say REST DAY and the coaching message, and privacy ("No
 * heart rate, recovery status, injury information or sensitive health data").
 * Phase two: "let's do small and large".
 *
 * WHERE THE WORDS COME FROM. The app (SacoroWidgetPlugin.update) hands over
 * the next fortnight as plain words -- the title, the distance and pace line,
 * the coaching line -- already stripped of anything health-related in the
 * web layer (widgetPayload). Nothing here computes training; it only chooses
 * which of the stored days is today, and which follow it.
 *
 * WHY A FORTNIGHT, AND NOT TODAY ALONE. A widget is not guaranteed to refresh
 * when the app changes, and it certainly cannot ask the app at 00:01. Holding
 * the coming days and choosing today by the phone's own clock means the
 * widget is right the morning after even if SACORO was never opened.
 *
 * WHEN IT REDRAWS: whenever the app saves (the plugin asks for it), every 30
 * minutes (updatePeriodMillis, the shortest Android honours), and once just
 * after midnight via an INEXACT alarm -- never an exact one: SACORO does not
 * hold SCHEDULE_EXACT_ALARM, and asking for it is what trapped the app on the
 * "Alarms and reminders" screen. Every redraw redraws all three sizes, so
 * one placed alone is never left behind.
 *
 * WHEN IT CANNOT KNOW, IT SAYS SO: see SacoroWidgetDays, which chooses the day.
 */
public class SacoroWidgetProvider extends AppWidgetProvider {
    static final String PREFS = "sacoro_widget";
    static final String KEY_DAYS = "days";
    static final String KEY_HAS_PLAN = "hasPlan";
    static final String ACTION_MIDNIGHT = "com.velvetviking.valhalla.WIDGET_MIDNIGHT";

    /* ---------- ANY SIZE, ANY ENTRY ----------
       Founder: "Enable Android widget resizing, like the standard weather
       widget. Ideally, users should be able to drag the widget edges and
       have the layout adapt between compact and expanded sizes."
       The four entries in the picker are now four STARTING sizes of one
       widget: every one can be dragged to any size, and draws whichever of
       the five layouts fits the space it has. On Android 12 and later the
       launcher is handed all five at once (a size-keyed RemoteViews) and
       switches between them itself as the edges move, rotation included; on
       older Android the same choice is made here from the size the launcher
       reports, and remade whenever it reports a new one.
       A layout is chosen the way Android 12 chooses: of those whose minimum
       size fits inside the widget, the one with the largest area. The keys
       below were set against the Pixel launcher's own cell sizes (portrait
       2x1 is 130 by 102dp, landscape 269 by 51), so a portrait 2x1 is the
       stacked two-word layout, a landscape one the single row, 2x2 the small
       layout, 4x2 the medium and 4x3 and up the large.
       The device check at every font size then found three more things.
       Below 160dp wide the row left the session 30dp, which no session fits,
       so the very smallest row is the mark and the session alone. And the
       large layout is keyed twice, at 4x3 and at 4x4 heights, so it knows
       how tall it is at its smallest and lists only the coming days that fit
       (see comingRows). Its 4x3 key is 330dp, not 300: the Pixel 4x3 is 337,
       and from 300 to 330 three days fit only at the smallest fonts. */
    static final int KIND_ROW = 0, KIND_TALL = 1, KIND_SMALL = 2, KIND_MEDIUM = 3, KIND_LARGE = 4, KIND_ROW_NARROW = 5;
    static final float[][] LAYOUT_KEYS = {
        { 110, 40 },   // the very smallest: the mark, then the session alone
        { 110, 90 },   // TODAY beside the distance over the kind: a narrow 2x1
        { 160, 40 },   // the single row: TODAY, then the session
        { 240, 50 },   // the single row, wide: a landscape 2x1, any 4x1
        { 110, 180 },  // small
        { 240, 130 },  // medium
        { 240, 330 },  // large, as tall as a 4x3
        { 240, 440 },  // large, as tall as a 4x4
    };
    static final int[] LAYOUT_KIND = { KIND_ROW_NARROW, KIND_TALL, KIND_ROW, KIND_ROW, KIND_SMALL, KIND_MEDIUM, KIND_LARGE, KIND_LARGE };

    /** Of the layouts that fit in w by h dp, the largest; the smallest if none fits. */
    static int pickLayout(float w, float h) {
        int best = -1;
        float bestArea = -1;
        for (int i = 0; i < LAYOUT_KEYS.length; i++) {
            float kw = LAYOUT_KEYS[i][0], kh = LAYOUT_KEYS[i][1];
            if (kw <= w && kh <= h && kw * kh > bestArea) { best = i; bestArea = kw * kh; }
        }
        return best < 0 ? 0 : best;
    }

    /** The layout for LAYOUT_KEYS[i]; the large one is told the height it has at least. */
    static RemoteViews renderLayout(Context context, int i) {
        switch (LAYOUT_KIND[i]) {
            case KIND_ROW_NARROW: return renderMiniNarrow(context);
            case KIND_ROW: return renderMini(context);
            case KIND_TALL: return renderMiniTall(context);
            case KIND_SMALL: return renderSmall(context);
            case KIND_LARGE: return renderLarge(context, LAYOUT_KEYS[i][1]);
            default: return renderMedium(context);
        }
    }

    /** Android 12 and later: every layout at once, for the launcher to choose from. */
    static RemoteViews responsive(Context context) {
        Map<SizeF, RemoteViews> m = new ArrayMap<>();
        for (int i = 0; i < LAYOUT_KEYS.length; i++)
            m.put(new SizeF(LAYOUT_KEYS[i][0], LAYOUT_KEYS[i][1]), renderLayout(context, i));
        return new RemoteViews(m);
    }

    /** The size this entry starts at, for older Android before it reports one. */
    float[] startSize() { return new float[] { 276, 220 }; }

    static RemoteViews viewsFor(Context context, AppWidgetManager manager, int id, float[] start) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return responsive(context);
        Bundle o = manager.getAppWidgetOptions(id);
        // Portrait width is the minimum width and portrait height the maximum height.
        int w = o == null ? 0 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        int h = o == null ? 0 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        if (w <= 0 || h <= 0) { w = (int) start[0]; h = (int) start[1]; }
        return renderLayout(context, pickLayout(w, h));
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, viewsFor(context, manager, id, startSize()));
        scheduleMidnight(context);
    }

    /** The athlete dragged an edge (or the launcher changed the size). */
    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle newOptions) {
        manager.updateAppWidget(id, viewsFor(context, manager, id, startSize()));
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String a = intent.getAction();
        if (ACTION_MIDNIGHT.equals(a)
                || Intent.ACTION_TIME_CHANGED.equals(a)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(a)) {
            refreshAll(context);
        }
    }

    @Override
    public void onEnabled(Context context) {
        scheduleMidnight(context);
    }

    /** The last of ONE size removed is not the last widget: the midnight
     *  redraw stops only when no size is left on the home screen. */
    @Override
    public void onDisabled(Context context) {
        if (placedCount(context) > 0) return;
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(midnightIntent(context));
    }

    static int[] idsOf(Context context, Class<?> cls) {
        int[] ids = AppWidgetManager.getInstance(context).getAppWidgetIds(new ComponentName(context, cls));
        return ids == null ? new int[0] : ids;
    }

    static int placedCount(Context context) {
        return idsOf(context, SacoroWidgetProvider.class).length
             + idsOf(context, SacoroWidgetMini.class).length
             + idsOf(context, SacoroWidgetSmall.class).length
             + idsOf(context, SacoroWidgetLarge.class).length;
    }

    /** Redraw every placed widget, of every size, from what is stored. */
    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] medium = idsOf(context, SacoroWidgetProvider.class);
        int[] mini = idsOf(context, SacoroWidgetMini.class);
        int[] small = idsOf(context, SacoroWidgetSmall.class);
        int[] large = idsOf(context, SacoroWidgetLarge.class);
        if (medium.length + mini.length + small.length + large.length == 0) return;
        for (int id : medium) manager.updateAppWidget(id, viewsFor(context, manager, id, new SacoroWidgetProvider().startSize()));
        for (int id : mini) manager.updateAppWidget(id, viewsFor(context, manager, id, new SacoroWidgetMini().startSize()));
        for (int id : small) manager.updateAppWidget(id, viewsFor(context, manager, id, new SacoroWidgetSmall().startSize()));
        for (int id : large) manager.updateAppWidget(id, viewsFor(context, manager, id, new SacoroWidgetLarge().startSize()));
        scheduleMidnight(context);
    }

    static String todayKey() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String[] todayLines(Context context) {
        SharedPreferences p = prefs(context);
        return SacoroWidgetDays.linesForToday(p.getString(KEY_DAYS, null), p.getBoolean(KEY_HAS_PLAN, false), todayKey());
    }

    /** Tapping any size opens SACORO. */
    static void openOnTap(Context context, RemoteViews v, int rootId) {
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(context, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        v.setOnClickPendingIntent(rootId, pi);
    }

    /** Medium, 4x2: label, title, distance and pace, the coaching line. */
    static RemoteViews renderMedium(Context context) {
        String[] l = todayLines(context);
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_today);
        v.setTextViewText(R.id.widget_label, l[0]);
        v.setTextViewText(R.id.widget_title, l[1]);
        v.setTextViewText(R.id.widget_line, l[2]);
        v.setTextViewText(R.id.widget_note, l[3]);
        openOnTap(context, v, R.id.widget_root);
        return v;
    }

    static final int CHERRY = 0xFFC46A89;   // the cherry of ACORO on the icon

    /** "8 KM EASY": the distance in white and bold, the kind in cherry, a
     *  little smaller. A day with no distance (rest, optional) is the kind
     *  alone. */
    static CharSequence compactSession(String dist, String kind) {
        SpannableStringBuilder b = new SpannableStringBuilder();
        if (dist != null && !dist.isEmpty()) {
            b.append(dist);
            b.setSpan(new StyleSpan(Typeface.BOLD), 0, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            b.append(' ');
        }
        int start = b.length();
        b.append(kind == null ? "" : kind);
        b.setSpan(new ForegroundColorSpan(CHERRY), start, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        if (start > 0) b.setSpan(new RelativeSizeSpan(0.8f), start, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return b;
    }

    /** Mini, 2x1. Founder: "a 2 x 1 widget with dot SACORO dot top centre,
     *  left aligned today and then right aligned 8km easy. Make the text as big
     *  as possible for the box size ... Keep the colours." The layout sizes
     *  both lines to fill their space (autoSize); this only supplies words. */
    static RemoteViews renderMini(Context context) {
        SharedPreferences p = prefs(context);
        String[] c = SacoroWidgetDays.compactForToday(p.getString(KEY_DAYS, null), p.getBoolean(KEY_HAS_PLAN, false), todayKey());
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_today_mini);
        v.setTextViewText(R.id.widget_session, compactSession(c[0], c[1]));
        openOnTap(context, v, R.id.widget_root);
        return v;
    }

    /** The very smallest row, under 160dp wide: the mark, then the session
     *  across the whole width. TODAY's own column would leave the session
     *  30dp, and no session fits that. */
    static RemoteViews renderMiniNarrow(Context context) {
        SharedPreferences p = prefs(context);
        String[] c = SacoroWidgetDays.compactForToday(p.getString(KEY_DAYS, null), p.getBoolean(KEY_HAS_PLAN, false), todayKey());
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_today_mini_narrow);
        v.setTextViewText(R.id.widget_session, compactSession(c[0], c[1]));
        openOnTap(context, v, R.id.widget_root);
        return v;
    }

    /** The narrow 2x1 (a portrait Pixel 2x1 is 130dp wide): TODAY beside the
     *  distance, with the kind under it, so neither is ever cut. A day with
     *  no distance shows its kind alone in the top line. */
    static RemoteViews renderMiniTall(Context context) {
        SharedPreferences p = prefs(context);
        String[] c = SacoroWidgetDays.compactForToday(p.getString(KEY_DAYS, null), p.getBoolean(KEY_HAS_PLAN, false), todayKey());
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_today_mini_tall);
        boolean hasDist = c[0] != null && !c[0].isEmpty();
        v.setTextViewText(R.id.widget_dist, hasDist ? c[0] : c[1]);
        v.setTextColor(R.id.widget_dist, hasDist ? 0xFFFFFFFF : CHERRY);
        v.setTextViewText(R.id.widget_kind, hasDist ? c[1] : "");
        v.setViewVisibility(R.id.widget_kind, hasDist ? View.VISIBLE : View.GONE);
        openOnTap(context, v, R.id.widget_root);
        return v;
    }

    /** Small, 2x2: the glance. Label, title, distance and pace; no coaching
     *  line, because two lines of it would not fit and one would be cut. */
    static RemoteViews renderSmall(Context context) {
        String[] l = todayLines(context);
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_today_small);
        v.setTextViewText(R.id.widget_label, l[0]);
        v.setTextViewText(R.id.widget_title, l[1]);
        v.setTextViewText(R.id.widget_line, l[2]);
        openOnTap(context, v, R.id.widget_root);
        return v;
    }

    static final int[][] LARGE_ROWS = {
        { R.id.widget_next1, R.id.widget_next1_day, R.id.widget_next1_title, R.id.widget_next1_line },
        { R.id.widget_next2, R.id.widget_next2_day, R.id.widget_next2_title, R.id.widget_next2_line },
        { R.id.widget_next3, R.id.widget_next3_day, R.id.widget_next3_title, R.id.widget_next3_line },
    };

    /* HOW MANY COMING DAYS FIT. A widget cannot measure itself, so this is
       the large layout's own arithmetic (widget_today_large.xml): 60dp of
       padding and gaps above the list, and 87sp of words (label, title,
       line, two lines of note, COMING UP); each day is a 10dp gap and 25sp
       (title and line). Lines are 1.35 times their size, the tallest the
       device check measured. Text grows with the phone's font size, the
       gaps do not. Measured against the height the layout is guaranteed
       (its key), never the height it may have, so the last day is never cut:
       at 4x3, three days at normal sizes, two at 130%, none at 200%; at 4x4,
       three, three and one. */
    static final float LARGE_TOP_DP = 60f, LARGE_TOP_SP = 87f, LARGE_ROW_DP = 10f, LARGE_ROW_SP = 25f, LINE = 1.35f;

    static int comingRows(float heightDp, float fontScale) {
        float top = LARGE_TOP_DP + LARGE_TOP_SP * LINE * fontScale;
        float row = LARGE_ROW_DP + LARGE_ROW_SP * LINE * fontScale;
        int n = (int) Math.floor((heightDp - top) / row);
        return Math.max(0, Math.min(LARGE_ROWS.length, n));
    }

    /** Large, 4x3 and up: today in full, then as many of the next three days
     *  as fit. A day the app has not handed over is left out rather than
     *  guessed. */
    static RemoteViews renderLarge(Context context, float heightDp) {
        String[] l = todayLines(context);
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_today_large);
        v.setTextViewText(R.id.widget_label, l[0]);
        v.setTextViewText(R.id.widget_title, l[1]);
        v.setTextViewText(R.id.widget_line, l[2]);
        v.setTextViewText(R.id.widget_note, l[3]);
        SharedPreferences p = prefs(context);
        String[][] next = SacoroWidgetDays.upcoming(p.getString(KEY_DAYS, null), p.getBoolean(KEY_HAS_PLAN, false),
                todayKey(), comingRows(heightDp, context.getResources().getConfiguration().fontScale));
        v.setViewVisibility(R.id.widget_next_head, next.length > 0 ? View.VISIBLE : View.GONE);
        for (int i = 0; i < LARGE_ROWS.length; i++) {
            int[] row = LARGE_ROWS[i];
            if (i < next.length) {
                v.setViewVisibility(row[0], View.VISIBLE);
                v.setTextViewText(row[1], next[i][0]);
                v.setTextViewText(row[2], next[i][1]);
                v.setTextViewText(row[3], next[i][2]);
            } else {
                v.setViewVisibility(row[0], View.GONE);
            }
        }
        openOnTap(context, v, R.id.widget_root);
        return v;
    }

    static PendingIntent midnightIntent(Context context) {
        Intent i = new Intent(context, SacoroWidgetProvider.class).setAction(ACTION_MIDNIGHT);
        return PendingIntent.getBroadcast(context, 1, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Just after the next midnight, inexact: Android may deliver it a little late, never early. */
    static void scheduleMidnight(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Calendar c = Calendar.getInstance();
        c.add(Calendar.DAY_OF_YEAR, 1);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 1);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        am.set(AlarmManager.RTC, c.getTimeInMillis(), midnightIntent(context));
    }
}
