package com.velvetviking.valhalla;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The app's side of the Today widget. update() stores the coming days the
 * web layer prepared (widgetPayload in the runtime) and redraws every placed
 * widget at once, so a change in SACORO reaches the home screen as soon as
 * the app has made it. See SacoroWidgetProvider for how the widget keeps
 * itself right when the app is not open.
 */
@CapacitorPlugin(name = "SacoroWidget")
public class SacoroWidgetPlugin extends Plugin {

    /* ---------- THE DAY A WIDGET TAP ASKED FOR ----------
       Founder: "Tapping the session opens it in SACORO." The 4x2 widget's
       tap carries the date it was showing (EXTRA_OPEN_DAY). It is held here
       until the web app, starting or resuming, asks for it once; taken, it
       is gone, so a later ordinary open is not sent to an old day. Only a
       plain yyyy-mm-dd is kept. */
    static volatile String pendingOpenDay = null;

    static void noteOpenDay(Intent intent) {
        if (intent == null) return;
        String d = intent.getStringExtra(SacoroWidgetProvider.EXTRA_OPEN_DAY);
        if (d != null && d.matches("\\d{4}-\\d{2}-\\d{2}")) pendingOpenDay = d;
        intent.removeExtra(SacoroWidgetProvider.EXTRA_OPEN_DAY);
    }

    @PluginMethod
    public void takeOpenDay(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("day", pendingOpenDay);
        pendingOpenDay = null;
        call.resolve(ret);
    }

    @PluginMethod
    public void update(PluginCall call) {
        JSArray days = call.getArray("days");
        Boolean hasPlan = call.getBoolean("hasPlan", false);
        Context ctx = getContext();
        SharedPreferences.Editor e = ctx.getSharedPreferences(SacoroWidgetProvider.PREFS, Context.MODE_PRIVATE).edit();
        e.putString(SacoroWidgetProvider.KEY_DAYS, days == null ? "[]" : days.toString());
        e.putBoolean(SacoroWidgetProvider.KEY_HAS_PLAN, hasPlan != null && hasPlan);
        e.apply();
        SacoroWidgetProvider.refreshAll(ctx);
        JSObject ret = new JSObject();
        ret.put("stored", days == null ? 0 : days.length());
        call.resolve(ret);
    }
}
