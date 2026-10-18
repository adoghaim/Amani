import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
  PK-DEVICE-01, R15: the native halves of the app-switcher cover. There is no
  toolchain in CI, so these pin the source the owner's native build compiles.
  The native build itself is PENDING (an owner action, with a store release).
*/

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const mainActivity = read('android/app/src/main/java/com/amani/health/MainActivity.java');
const privacyPlugin = read('android/app/src/main/java/com/amani/health/PrivacyPlugin.java');
const appDelegate = read('ios/App/App/AppDelegate.swift');
const infoPlist = read('ios/App/App/Info.plist');

/** The body of a Java/Swift method, from its signature to its closing brace. */
function body(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, signature).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed ${signature}`);
}

describe('Android (R15)', () => {
  it('every user on Android 13+ (API 33): setRecentsScreenshotEnabled(false), behind the API-level guard', () => {
    const guard = body(mainActivity, 'private void hideFromRecentsScreenshots()');
    expect(guard).toMatch(/if \(Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.TIRAMISU\) \{\s*setRecentsScreenshotEnabled\(false\);\s*\}/);
    expect(body(mainActivity, 'public void onCreate(Bundle savedInstanceState)')).toContain('hideFromRecentsScreenshots();');
    // Exactly one call, and only inside the guard.
    expect(mainActivity.match(/setRecentsScreenshotEnabled\(/g)).toHaveLength(1);
  });

  it('FLAG_SECURE is never set for everyone: only the local AmaniPrivacy plugin touches it, set and cleared', () => {
    expect(mainActivity).not.toMatch(/(addFlags|setFlags)\([^)]*FLAG_SECURE/);
    expect(privacyPlugin).toContain('@CapacitorPlugin(name = "AmaniPrivacy")');
    const method = body(privacyPlugin, 'public void setSecure(PluginCall call)');
    expect(method).toContain('addFlags(WindowManager.LayoutParams.FLAG_SECURE)');
    expect(method).toContain('clearFlags(WindowManager.LayoutParams.FLAG_SECURE)');
  });

  it('the plugin is registered before the bridge starts', () => {
    const onCreate = body(mainActivity, 'public void onCreate(Bundle savedInstanceState)');
    expect(onCreate.indexOf('registerPlugin(PrivacyPlugin.class);')).toBeGreaterThan(-1);
    expect(onCreate.indexOf('registerPlugin(PrivacyPlugin.class);')).toBeLessThan(onCreate.indexOf('super.onCreate(savedInstanceState);'));
  });

  it("MainActivity's status-bar re-assertion is unchanged", () => {
    expect(body(mainActivity, 'public void onResume()')).toMatch(/super\.onResume\(\);\s*applyLightSystemBars\(\);\s*\}/);
    expect(body(mainActivity, 'public void onWindowFocusChanged(boolean hasFocus)'))
      .toMatch(/super\.onWindowFocusChanged\(hasFocus\);\s*if \(hasFocus\) applyLightSystemBars\(\);\s*\}/);
    expect(body(mainActivity, 'private void applyLightSystemBars()'))
      .toMatch(/setLightBars\(\);\s*getWindow\(\)\.getDecorView\(\)\.post\(this::setLightBars\);/);
    const bars = body(mainActivity, 'private void setLightBars()');
    expect(bars).toContain('controller.setAppearanceLightStatusBars(true);');
    expect(bars).toContain('controller.setAppearanceLightNavigationBars(true);');
    expect(body(mainActivity, 'public void onCreate(Bundle savedInstanceState)')).toContain('applyLightSystemBars();');
  });
});

describe('iOS (D16, D24, R15)', () => {
  it('shows the launch screen as soon as the app resigns active, and removes it when active again', () => {
    expect(body(appDelegate, 'func applicationWillResignActive')).toContain('showPrivacyCover()');
    expect(body(appDelegate, 'func applicationDidBecomeActive')).toContain('hidePrivacyCover()');
    expect(body(appDelegate, 'private func showPrivacyCover()')).toContain('UIStoryboard(name: "LaunchScreen", bundle: nil)');
  });

  it('declares why it uses Face ID (required, or iOS refuses Face ID)', () => {
    expect(infoPlist).toMatch(/<key>NSFaceIDUsageDescription<\/key>\s*<string>[^<]+<\/string>/);
  });
});
