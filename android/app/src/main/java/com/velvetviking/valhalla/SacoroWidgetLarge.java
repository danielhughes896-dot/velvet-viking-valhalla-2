package com.velvetviking.valhalla;

/** The Today widget, starting at 4x4: today, then the next three days.
 *  Resizable to any size, like every entry: see SacoroWidgetProvider. */
public class SacoroWidgetLarge extends SacoroWidgetProvider {
    @Override
    float[] startSize() { return new float[] { 276, 455 }; }
}
