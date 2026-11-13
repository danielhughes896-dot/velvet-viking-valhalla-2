package com.velvetviking.valhalla;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Which of the stored days the Today widget shows. Kept apart from the
 * provider, with nothing from Android in it, so it can be run and checked on
 * its own (test/todayWidget.test.js compiles and runs it).
 *
 * WHEN IT CANNOT KNOW, IT SAYS SO. No plan, nothing stored, or stored days
 * that no longer reach today: it asks to be opened rather than showing a
 * session that may since have changed.
 */
final class SacoroWidgetDays {
    private SacoroWidgetDays() {}

    static final String[] NO_PLAN = { "SACORO", "No plan yet", "Build your training block in SACORO.", "" };
    static final String[] UNKNOWN = { "TODAY", "Open SACORO", "Today's session will appear here once the app has updated.", "" };

    /** The four lines the widget shows (label, title, line, note), chosen for today. */
    static String[] linesForToday(String daysJson, boolean hasPlan, String today) {
        if (!hasPlan) return NO_PLAN;
        try {
            JSONArray days = new JSONArray(daysJson == null ? "[]" : daysJson);
            for (int i = 0; i < days.length(); i++) {
                JSONObject d = days.getJSONObject(i);
                if (!today.equals(d.optString("date"))) continue;
                return new String[] {
                    d.optString("label", "TODAY"),
                    d.optString("title", ""),
                    d.optString("line", ""),
                    d.optString("note", "")
                };
            }
        } catch (Exception e) {
            // fall through to the honest answer
        }
        return UNKNOWN;
    }

    /** The 2x1 widget's two words for today: {distance, kind}, e.g. {"8 KM",
     *  "EASY"}; a rest day is {"", "REST DAY"}. An app too old to send them
     *  still gets the session's own name rather than an empty widget, and the
     *  honest answers stand when nothing is known. */
    static String[] compactForToday(String daysJson, boolean hasPlan, String today) {
        if (!hasPlan) return new String[] { "", "NO PLAN" };
        try {
            JSONArray days = new JSONArray(daysJson == null ? "[]" : daysJson);
            for (int i = 0; i < days.length(); i++) {
                JSONObject d = days.getJSONObject(i);
                if (!today.equals(d.optString("date"))) continue;
                String kind = d.optString("kind", "");
                if (kind.isEmpty()) kind = d.optString("title", "").toUpperCase(Locale.UK);
                return new String[] { d.optString("dist", ""), kind };
            }
        } catch (Exception e) {
            // fall through
        }
        return new String[] { "", "OPEN SACORO" };
    }

    /** The days after today the large widget lists: up to n of them, in order,
     *  each as {day word, title, line}. Only days the app actually handed over
     *  and only consecutive ones from tomorrow: a gap ends the list rather than
     *  being skipped over, so nothing is shown under the wrong day. */
    static String[][] upcoming(String daysJson, boolean hasPlan, String today, int n) {
        List<String[]> out = new ArrayList<>();
        if (!hasPlan || n <= 0) return new String[0][];
        try {
            JSONArray days = new JSONArray(daysJson == null ? "[]" : daysJson);
            for (int k = 1; k <= n; k++) {
                String date = addDays(today, k);
                if (date == null) break;
                JSONObject found = null;
                for (int i = 0; i < days.length(); i++) {
                    JSONObject d = days.getJSONObject(i);
                    if (date.equals(d.optString("date"))) { found = d; break; }
                }
                if (found == null) break;
                out.add(new String[] { dayWord(date, k), found.optString("title", ""), found.optString("line", "") });
            }
        } catch (Exception e) {
            return new String[0][];
        }
        return out.toArray(new String[0][]);
    }

    static String addDays(String ymd, int k) {
        try {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            Date d = f.parse(ymd);
            Calendar c = Calendar.getInstance();
            c.setTime(d);
            c.add(Calendar.DAY_OF_YEAR, k);
            return f.format(c.getTime());
        } catch (ParseException e) {
            return null;
        }
    }

    /** "TOMORROW", then the weekday in capitals: words, no symbols. */
    static String dayWord(String ymd, int k) {
        if (k == 1) return "TOMORROW";
        try {
            Date d = new SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(ymd);
            return new SimpleDateFormat("EEEE", Locale.UK).format(d).toUpperCase(Locale.UK);
        } catch (ParseException e) {
            return "";
        }
    }
}
