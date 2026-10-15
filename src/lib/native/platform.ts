import { Capacitor } from '@capacitor/core';

// ─── Platform detection ────────────────────────────────────────────────────

export const isNative = () => Capacitor.isNativePlatform();
export const platform = () => Capacitor.getPlatform(); // 'ios' | 'android' | 'web'
