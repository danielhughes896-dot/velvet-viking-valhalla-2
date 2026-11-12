package com.velvetviking.valhalla;

import org.json.JSONArray;
import org.json.JSONObject;

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
}
