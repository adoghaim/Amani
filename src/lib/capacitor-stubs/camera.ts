export enum CameraResultType { Base64 = 'base64', Uri = 'uri', DataUrl = 'dataUrl' }
export enum CameraSource { Prompt = 'PROMPT', Camera = 'CAMERA', Photos = 'PHOTOS' }
export const Camera = {
  getPhoto: () => Promise.reject(new Error('Camera not available on web')),
  pickImages: () => Promise.reject(new Error('Camera not available on web')),
  requestPermissions: () => Promise.resolve({ camera: 'denied', photos: 'denied' }),
  checkPermissions: () => Promise.resolve({ camera: 'denied', photos: 'denied' }),
};
