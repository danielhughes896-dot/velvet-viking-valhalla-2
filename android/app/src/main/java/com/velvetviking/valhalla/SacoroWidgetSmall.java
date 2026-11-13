package com.velvetviking.valhalla;

import android.content.Context;
import android.widget.RemoteViews;

/** The Today widget, small (2x2). Everything but the drawing is the medium
 *  one's: see SacoroWidgetProvider. */
public class SacoroWidgetSmall extends SacoroWidgetProvider {
    @Override
    RemoteViews build(Context context) { return renderSmall(context); }
}
