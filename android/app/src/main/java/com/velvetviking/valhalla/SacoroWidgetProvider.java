package com.velvetviking.valhalla;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

/**
 * THE TODAY WIDGET, PHASE ONE: one medium widget on Android.
 *
 * Founder: "I particularly like the idea of an athlete waking up, glancing at
 * their phone and immediately seeing what SACORO has planned." And the three
 * conditions the founder set: automatic updates ("No stale training advice"), rest days
 * that say REST DAY and the coaching message, and privacy ("No heart rate,
 * recovery status, injury information or sensitive health data").
 *
 * WHERE THE WORDS COME FROM. The app (SacoroWidgetPlugin.update) hands over
 * the next fortnight as plain words -- the title, the distance and pace line,
 * the coaching line -- already stripped of anything health-related in the
 * web layer (widgetPayload). Nothing here computes training; it only chooses
 * which of the stored days is today.
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
 * "Alarms and reminders" screen.
 *
 * WHEN IT CANNOT KNOW, IT SAYS SO: see SacoroWidgetDays, which chooses the day.
 */
public class SacoroWidgetProvider extends AppWidgetProvider {
    static final String PREFS = "sacoro_widget";
    static final String KEY_DAYS = "days";
    static final String KEY_HAS_PLAN = "hasPlan";
    static final String ACTION_MIDNIGHT = "com.velvetviking.valhalla.WIDGET_MIDNIGHT";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, render(context));
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

    @Override
    public void onDisabled(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(midnightIntent(context));
    }

    /** Redraw every placed widget from what is stored. */
    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, SacoroWidgetProvider.class));
        if (ids == null || ids.length == 0) return;
        RemoteViews views = render(context);
        for (int id : ids) manager.updateAppWidget(id, views);
        scheduleMidnight(context);
    }

    static String todayKey() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    static RemoteViews render(Context context) {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String[] l = SacoroWidgetDays.linesForToday(p.getString(KEY_DAYS, null), p.getBoolean(KEY_HAS_PLAN, false), todayKey());
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_today);
        v.setTextViewText(R.id.widget_label, l[0]);
        v.setTextViewText(R.id.widget_title, l[1]);
        v.setTextViewText(R.id.widget_line, l[2]);
        v.setTextViewText(R.id.widget_note, l[3]);
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(context, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        v.setOnClickPendingIntent(R.id.widget_root, pi);
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
