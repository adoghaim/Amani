// Dev-only stub for `@capacitor/camera`. Aliased in vite.config.ts when
// `command === 'serve'`. Only the surface used by `src/lib/native.ts`
// (`getPhoto` + the `CameraResultType` / `CameraSource` enums) is implemented.
// Other plugin methods are intentionally absent so callers that need them on
// web get a TypeScript error rather than a silent runtime no-op.

export enum CameraResultType {
  Uri = 'uri',
  Base64 = 'base64',
  DataUrl = 'dataUrl',
}

export enum CameraSource {
  Prompt = 'PROMPT',
  Camera = 'CAMERA',
  Photos = 'PHOTOS',
}

export type CameraPermissionState = 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied' | 'limited';
export type CameraPermissionType = 'camera' | 'photos';

export interface PermissionStatus {
  camera: CameraPermissionState;
  photos: CameraPermissionState;
}

export interface CameraPluginPermissions {
  permissions: CameraPermissionType[];
}

export interface ImageOptions {
  quality?: number;
  allowEditing?: boolean;
  resultType: CameraResultType;
  saveToGallery?: boolean;
  width?: number;
  height?: number;
  correctOrientation?: boolean;
  source?: CameraSource;
}

export interface Photo {
  base64String?: string;
  dataUrl?: string;
  path?: string;
  webPath?: string;
  format: string;
  saved: boolean;
}

const NOT_AVAILABLE = 'Camera not available on web';

export const Camera = {
  getPhoto: (_options: ImageOptions): Promise<Photo> =>
    Promise.reject(new Error(NOT_AVAILABLE)),
  checkPermissions: (): Promise<PermissionStatus> =>
    Promise.resolve({ camera: 'denied', photos: 'denied' }),
  requestPermissions: (
    _permissions?: CameraPluginPermissions,
  ): Promise<PermissionStatus> =>
    Promise.resolve({ camera: 'denied', photos: 'denied' }),
};
