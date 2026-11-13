package com.velvetviking.valhalla;

/** The Today widget, starting at 2x1 (the size the founder drew: the mark,
 *  TODAY, and the session in two words). Resizable to any size, like every
 *  entry: see SacoroWidgetProvider. */
public class SacoroWidgetMini extends SacoroWidgetProvider {
    @Override
    float[] startSize() { return new float[] { 130, 102 }; }
}
