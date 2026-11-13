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

    /** What this size draws. The medium one; the other sizes override it. */
    RemoteViews build(Context context) { return renderMedium(context); }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        RemoteViews views = build(context);
        for (int id : ids) manager.updateAppWidget(id, views);
        scheduleMidnight(context);
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
        if (medium.length > 0) { RemoteViews v = renderMedium(context); for (int id : medium) manager.updateAppWidget(id, v); }
        if (mini.length > 0) { RemoteViews v = renderMini(context); for (int id : mini) manager.updateAppWidget(id, v); }
        if (small.length > 0) { RemoteViews v = renderSmall(context); for (int id : small) manager.updateAppWidget(id, v); }
        if (large.length > 0) { RemoteViews v = renderLarge(context); for (int id : large) manager.updateAppWidget(id, v); }
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

    /** Large, 4x4: today in full, then the next three days. A day the app has
     *  not handed over is left out rather than guessed. */
    static RemoteViews renderLarge(Context context) {
        String[] l = todayLines(context);
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_today_large);
        v.setTextViewText(R.id.widget_label, l[0]);
        v.setTextViewText(R.id.widget_title, l[1]);
        v.setTextViewText(R.id.widget_line, l[2]);
        v.setTextViewText(R.id.widget_note, l[3]);
        SharedPreferences p = prefs(context);
        String[][] next = SacoroWidgetDays.upcoming(p.getString(KEY_DAYS, null), p.getBoolean(KEY_HAS_PLAN, false),
                todayKey(), LARGE_ROWS.length);
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
