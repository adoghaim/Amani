# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Capacitor: keep the bridge, plugin classes, and annotation-discovered plugins
# so the JS bridge can resolve them via reflection.
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class com.getcapacitor.plugin.** { *; }

# Keep the app's own classes — Capacitor's PluginManager scans these.
-keep class com.amani.health.** { *; }

# Cordova plugins shimmed via capacitor-cordova-android-plugins
-keep class org.apache.cordova.** { *; }
-keepclassmembers class * extends org.apache.cordova.CordovaPlugin {
    public <methods>;
}

# WebView JS interface bridges
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep line numbers for crash-report symbolication, hide source filenames.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
