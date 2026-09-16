package com.amani.health;

import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Keeps the system bars drawing DARK icons, because Amani's web UI is always
 * light regardless of the device's dark-mode setting.
 *
 * Two things had to be true for the bars to be legible, and only one of them
 * was obvious.
 *
 * 1. The theme. It was Theme.AppCompat.DayNight, so on a phone in dark mode
 *    Android resolved the dark variant and asked for light (white) icons over a
 *    permanently ivory page. That is fixed in styles.xml, which now pins Light
 *    and sets windowLightStatusBar.
 *
 * 2. The timing, which is the part that actually bit. Setting the appearance in
 *    onCreate or onResume is not enough: something in the bridge/WebView
 *    start-up resets it afterwards. Measured directly — a delayed read reported
 *    `isAppearanceLightStatusBars() == false` a second after onResume had set
 *    it to true, and the captured status bar went from white-on-white (250 vs
 *    255, about 1.02:1) to legible dark glyphs (100 vs 250) once it was
 *    re-asserted.
 *
 * So the appearance is re-applied at the points where the window is known to be
 * settled, rather than once at start-up. onWindowFocusChanged is the meaningful
 * one — it fires after the window is fully up, and again after returning from
 * recents, a store sheet or the keyboard, each of which can hand the window
 * back with the system default.
 *
 * Deliberately not a Capacitor plugin: this is androidx that already ships with
 * the project, and a plugin would add a dependency plus a JS round trip to set
 * something that must be true before the first frame.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyLightSystemBars();
    }

    @Override
    public void onResume() {
        super.onResume();
        applyLightSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyLightSystemBars();
    }

    /**
     * "Light bars" means "these bars sit on a light background, so draw DARK
     * icons on them" — the opposite of what the name reads like.
     *
     * The trailing post() covers the start-up case: onWindowFocusChanged can
     * arrive before the bridge finishes clobbering the appearance, so the value
     * is asserted once more on the next frame.
     */
    private void applyLightSystemBars() {
        setLightBars();
        getWindow().getDecorView().post(this::setLightBars);
    }

    private void setLightBars() {
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(true);
        controller.setAppearanceLightNavigationBars(true);
    }
}
