package com.amani.health;

/** Native PK-DEVICE-01 boundary; malformed releases fail closed like the JS guard. */
public final class DevicePrivacyRelease {
    private DevicePrivacyRelease() {}

    public static boolean isActive(String version) {
        if (version == null || !version.matches("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)")) return false;
        String[] parts = version.split("\\.");
        long[] values = new long[3];
        try {
            for (int i = 0; i < parts.length; i++) {
                values[i] = Long.parseLong(parts[i]);
                if (values[i] > 9007199254740991L) return false;
            }
        } catch (NumberFormatException error) {
            return false;
        }
        return values[0] > 1 || (values[0] == 1 && (values[1] > 0 || (values[1] == 0 && values[2] >= 7)));
    }
}
