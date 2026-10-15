import { isNative } from './platform';

// ─── Camera: capture a photo for lab report scanning ──────────────────────

export type CameraResult =
  | { ok: true; base64: string }
  | { ok: false; cancelled: boolean; error?: string };

/**
 * Prompts the user to take a photo or pick from the gallery.
 * Returns a base64-encoded JPEG string (without the data: prefix) on success.
 * Always returns a typed result — never throws.
 */
export async function captureLabPhoto(): Promise<CameraResult> {
  if (!isNative()) {
    return { ok: false, cancelled: false, error: 'Camera not available on web' };
  }

  try {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.Base64,
      source: CameraSource.Prompt,   // asks user: Camera or Photos
      quality: 85,
      correctOrientation: true,
      // No width/height constraint — we want full resolution for OCR accuracy
    });

    if (!photo.base64String) {
      return { ok: false, cancelled: false, error: 'No image data returned' };
    }

    // Prefix the base64 string so it can go straight into an <img src> or fetch body
    const mimeType = photo.format === 'png' ? 'image/png' : 'image/jpeg';
    return { ok: true, base64: `data:${mimeType};base64,${photo.base64String}` };
  } catch (err: unknown) {
    // User cancelled — Camera plugin throws with message containing 'cancel'
    const message = err instanceof Error ? err.message : undefined;
    const cancelled =
      typeof message === 'string' &&
      (message.toLowerCase().includes('cancel') ||
        message.toLowerCase().includes('dismiss'));
    return { ok: false, cancelled, error: message };
  }
}
