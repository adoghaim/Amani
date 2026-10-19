package com.amani.health;

import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * AmaniPrivacy: Amani's own local plugin (PK-DEVICE-01, owner decision R15).
 *
 * One method, setSecure({ secure }), called only from src/lib/native/privacyScreen.ts.
 * It sets or clears FLAG_SECURE on the activity window. FLAG_SECURE hides the
 * app-switcher preview on every Android version, and also blocks screenshots,
 * screen recording and screen sharing, so it is on only while the biometric
 * lock is on. Settings says so next to the lock toggle.
 *
 * From native release 1.0.7, every user on Android 13+ is hidden in the app switcher regardless, by
 * setRecentsScreenshotEnabled(false) in MainActivity.
 */
@CapacitorPlugin(name = "AmaniPrivacy")
public class PrivacyPlugin extends Plugin {

    @PluginMethod
    public void setSecure(PluginCall call) {
        if (!(getActivity() instanceof MainActivity) || !((MainActivity) getActivity()).isDevicePrivacyActive()) {
            JSObject result = new JSObject();
            result.put("secure", false);
            call.resolve(result);
            return;
        }
        final boolean secure = Boolean.TRUE.equals(call.getBoolean("secure", false));
        getActivity().runOnUiThread(() -> {
            if (secure) {
                getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            } else {
                getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            }
            JSObject result = new JSObject();
            result.put("secure", secure);
            call.resolve(result);
        });
    }
}
