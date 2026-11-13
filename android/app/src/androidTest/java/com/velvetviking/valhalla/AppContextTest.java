package com.velvetviking.valhalla;

import static org.junit.Assert.assertEquals;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

/** The app under test is SACORO. (Capacitor's template asserted its own
 *  placeholder package, which would fail the first time these tests ran.) */
@RunWith(AndroidJUnit4.class)
public class AppContextTest {
    @Test
    public void isSacoro() {
        Context ctx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.velvetviking.valhalla", ctx.getPackageName());
    }
}
