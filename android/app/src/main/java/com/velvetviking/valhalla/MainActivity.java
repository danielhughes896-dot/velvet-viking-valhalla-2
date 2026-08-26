package com.velvetviking.valhalla;

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
        super.onCreate(savedInstanceState);
    }
}
