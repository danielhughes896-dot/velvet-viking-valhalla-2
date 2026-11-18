package com.velvetviking.valhalla;

import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * The shell. It loads the live site (capacitor.config.json -> server.url), so
 * almost nothing belongs here.
 *
 * VvvSpeechPlugin is registered because speech input is the one capability the
 * WebView cannot provide for itself: Android WebView exposes
 * webkitSpeechRecognition but has no service behind it, which is why the
 * microphone appeared to work and never did. Registering the plugin BEFORE
 * super.onCreate() is Capacitor's requirement, not a style choice -- the bridge
 * is built during onCreate and a plugin added afterwards is not in it.
 *
 * Text-to-speech comes from @capacitor-community/text-to-speech, which
 * Capacitor registers automatically from the dependency; there is nothing to
 * add here for it.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VvvSpeechPlugin.class);
        registerPlugin(SacoroWidgetPlugin.class);   // the Today widget's link to the app
        super.onCreate(savedInstanceState);
        lockPhonesToPortrait();
        /* A tap on the 4x2 widget names the day to open; the web app asks
           for it (SacoroWidget.takeOpenDay) once it is running. */
        SacoroWidgetPlugin.noteOpenDay(getIntent());
        /* While SACORO is running, locking or unlocking returns every widget to TODAY. */
        SacoroWidgetProvider.watchForUnlock(this);
    }

    /* singleTask: a tap while SACORO is already open arrives here, before
       the app resumes and asks. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        SacoroWidgetPlugin.noteOpenDay(intent);
    }

    /**
     * PHONES STAY UPRIGHT; TABLETS DO NOT.
     *
     * Responsive correction 8. Founder: "portrait-locking Android is
     * reasonable for SACORO's current phone experience, provided it doesn't
     * unnecessarily restrict tablet layouts." On a phone turned on its side
     * the header and the glass tab bar took about 40% of a 360dp-tall screen
     * and a session left ~150dp to read; the iPhone app is already
     * portrait-only. A tablet (smallest width 600dp and up, Android's own
     * line between the two) is left free to turn, and Android 16 ignores a
     * fixed orientation on large screens in any case.
     *
     * Decided at run time, not in the manifest, because the manifest cannot
     * tell a phone from a tablet. USER_PORTRAIT so the phone's own rotation
     * lock and upside-down setting are still honoured. The activity already
     * handles orientation itself (configChanges), so nothing restarts.
     */
    static final int TABLET_MIN_DP = 600;

    void lockPhonesToPortrait() {
        int sw = getResources().getConfiguration().smallestScreenWidthDp;
        if (sw > 0 && sw < TABLET_MIN_DP) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_USER_PORTRAIT);
        }
    }
}
