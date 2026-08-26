package com.velvetviking.valhalla;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;

/**
 * Speech input for the installed Valhalla app.
 *
 * WHY THIS IS LOCAL CODE RATHER THAN A DEPENDENCY. Two reasons, and the second
 * is the one that mattered:
 *
 *   1. @capacitor-community/speech-recognition is at 7.0.1, published June 2025,
 *      and declares a peer of @capacitor/core >=7.0.0. This app is on Capacitor
 *      8. Taking an unmaintained plugin across a major version, on the
 *      microphone path, is not a trade worth making for ~150 lines.
 *   2. The privacy answer depends on EXACTLY which recogniser is used, and a
 *      third-party wrapper does not let this app choose -- or truthfully report
 *      -- that. See below.
 *
 * THE PRIVACY POINT, STATED PLAINLY BECAUSE IT IS EASY TO GET WRONG.
 * Android's ordinary SpeechRecognizer is a front end to whatever recognition
 * service the device has, which on most phones is Google's -- and that service
 * MAY send the audio to Google's servers. "On-device" is therefore not a claim
 * this plugin can make by default, and it does not make it.
 *
 * So it asks for the on-device recogniser explicitly where the platform has one
 * (API 31+, isOnDeviceRecognitionAvailable), sets EXTRA_PREFER_OFFLINE
 * otherwise, and RETURNS WHICH ONE IT ACTUALLY USED in `onDevice`. The web
 * layer decides what to do with that answer; this class never pretends.
 *
 * Raw audio never reaches Valhalla. Android hands back a transcript string; the
 * audio itself is never read, buffered, written to disk or logged here, and no
 * transcript is logged either.
 */
@CapacitorPlugin(
    name = "VvvSpeech",
    permissions = {
        @Permission(alias = VvvSpeechPlugin.MIC, strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class VvvSpeechPlugin extends Plugin {

    static final String MIC = "microphone";

    private SpeechRecognizer recognizer;
    private PluginCall listening;
    private boolean usedOnDevice = false;

    /** Whether the platform can recognise speech at all, and whether it can do
     *  it without leaving the device. Both are facts the UI needs BEFORE it
     *  draws a microphone. */
    @PluginMethod
    public void available(PluginCall call) {
        JSObject out = new JSObject();
        boolean supported = false;
        boolean onDevice = false;
        try {
            supported = SpeechRecognizer.isRecognitionAvailable(getContext());
        } catch (Throwable t) {
            supported = false;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                onDevice = SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext());
            } catch (Throwable t) {
                onDevice = false;
            }
        }
        out.put("supported", supported || onDevice);
        out.put("onDevice", onDevice);
        out.put("granted", getPermissionState(MIC) == com.getcapacitor.PermissionState.GRANTED);
        call.resolve(out);
    }

    /**
     * Listen once and resolve with the transcript.
     *
     * `requireOnDevice` is the caller's policy, not this class's: when true, a
     * device with no on-device recogniser is refused rather than quietly handed
     * to a networked one. Valhalla sets it, because sending an athlete's spoken
     * "my calf hurts" to a third-party service is a decision the product makes,
     * not a detail a plugin settles.
     */
    @PluginMethod
    public void listen(PluginCall call) {
        if (getPermissionState(MIC) != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias(MIC, call, "micPermissionResult");
            return;
        }
        startListening(call);
    }

    @PermissionCallback
    private void micPermissionResult(PluginCall call) {
        if (getPermissionState(MIC) != com.getcapacitor.PermissionState.GRANTED) {
            /* Denied is an answer, not a crash. The web layer turns this into a
               sentence and leaves the typed box in front of the athlete. */
            call.reject("Microphone permission was not granted", "PERMISSION_DENIED");
            return;
        }
        startListening(call);
    }

    private void startListening(final PluginCall call) {
        final boolean requireOnDevice = Boolean.TRUE.equals(call.getBoolean("requireOnDevice", Boolean.TRUE));
        final String lang = call.getString("lang", "en-GB");

        boolean canOnDevice = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                canOnDevice = SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext());
            } catch (Throwable t) {
                canOnDevice = false;
            }
        }
        if (requireOnDevice && !canOnDevice) {
            call.reject("No on-device speech recognition on this device", "NO_ON_DEVICE");
            return;
        }

        final boolean onDevice = canOnDevice;
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    releaseRecognizer();
                    if (onDevice && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext());
                        usedOnDevice = true;
                    } else {
                        recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                        usedOnDevice = false;
                    }
                } catch (Throwable t) {
                    call.reject("Speech recognition could not start", "UNAVAILABLE");
                    return;
                }
                if (recognizer == null) {
                    call.reject("Speech recognition is unavailable", "UNAVAILABLE");
                    return;
                }

                listening = call;
                recognizer.setRecognitionListener(new Listener());

                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                        RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
                /* Belt and braces on the networked path: even when the caller
                   permits it, ask the service to stay offline if it can. */
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
                }
                try {
                    recognizer.startListening(intent);
                } catch (Throwable t) {
                    finish(null, "Speech recognition could not start", "UNAVAILABLE");
                }
            }
        });
    }

    /** Athlete pressed cancel, or the web layer's watchdog fired. */
    @PluginMethod
    public void cancel(PluginCall call) {
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                releaseRecognizer();
            }
        });
        if (listening != null) {
            listening.reject("Cancelled", "CANCELLED");
            listening = null;
        }
        call.resolve();
    }

    private void releaseRecognizer() {
        if (recognizer != null) {
            try { recognizer.cancel(); } catch (Throwable ignored) {}
            try { recognizer.destroy(); } catch (Throwable ignored) {}
            recognizer = null;
        }
    }

    /** One exit for every outcome, so a call can never be left unresolved and
     *  the WebView can never be left showing "Listening…" for ever. */
    private void finish(String transcript, String message, String code) {
        PluginCall call = listening;
        listening = null;
        releaseRecognizer();
        if (call == null) return;
        if (transcript != null) {
            JSObject out = new JSObject();
            out.put("transcript", transcript);
            out.put("onDevice", usedOnDevice);
            call.resolve(out);
        } else {
            call.reject(message == null ? "Speech recognition failed" : message,
                        code == null ? "FAILED" : code);
        }
    }

    private class Listener implements RecognitionListener {
        @Override public void onResults(Bundle results) {
            ArrayList<String> said = results == null ? null
                : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            /* The transcript is handed straight to the caller and held nowhere.
               It is never written to the log: a spoken question can contain
               health information, which is exactly what must not end up in
               logcat. */
            if (said != null && !said.isEmpty() && said.get(0) != null && said.get(0).length() > 0) {
                finish(said.get(0), null, null);
            } else {
                finish(null, "No speech detected", "NO_SPEECH");
            }
        }
        @Override public void onError(int error) {
            String code;
            switch (error) {
                case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: code = "PERMISSION_DENIED"; break;
                case SpeechRecognizer.ERROR_NO_MATCH:
                case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:           code = "NO_SPEECH"; break;
                case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:          code = "BUSY"; break;
                case SpeechRecognizer.ERROR_NETWORK:
                case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:          code = "NETWORK"; break;
                default:                                              code = "FAILED";
            }
            finish(null, "Speech recognition failed", code);
        }
        @Override public void onReadyForSpeech(Bundle params) {}
        @Override public void onBeginningOfSpeech() {}
        @Override public void onRmsChanged(float rmsdB) {}
        @Override public void onBufferReceived(byte[] buffer) { /* never read or stored */ }
        @Override public void onEndOfSpeech() {}
        @Override public void onPartialResults(Bundle partialResults) {}
        @Override public void onEvent(int eventType, Bundle params) {}
    }

    @Override
    protected void handleOnDestroy() {
        releaseRecognizer();
        listening = null;
    }
}
