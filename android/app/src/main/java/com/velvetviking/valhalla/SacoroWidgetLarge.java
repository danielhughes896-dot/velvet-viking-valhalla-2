package com.velvetviking.valhalla;

import android.content.Context;
import android.widget.RemoteViews;

/** The Today widget, large (4x4): today, then the next three days.
 *  Everything but the drawing is the medium one's: see SacoroWidgetProvider. */
public class SacoroWidgetLarge extends SacoroWidgetProvider {
    @Override
    RemoteViews build(Context context) { return renderLarge(context); }
}
