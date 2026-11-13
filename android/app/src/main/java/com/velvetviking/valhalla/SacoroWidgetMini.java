package com.velvetviking.valhalla;

import android.content.Context;
import android.widget.RemoteViews;

/** The Today widget, 2x1: "• SACORO •" across the top, TODAY on the left and
 *  "8 KM EASY" on the right, as big as the box allows. Everything but the
 *  drawing is the medium one's: see SacoroWidgetProvider. */
public class SacoroWidgetMini extends SacoroWidgetProvider {
    @Override
    RemoteViews build(Context context) { return renderMini(context); }
}
