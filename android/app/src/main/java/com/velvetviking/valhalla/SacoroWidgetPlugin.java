package com.velvetviking.valhalla;

import android.content.Context;
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
