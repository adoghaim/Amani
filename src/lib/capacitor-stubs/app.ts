export const App = {
  addListener: () => Promise.resolve({ remove: () => {} }),
  removeAllListeners: () => Promise.resolve(),
  exitApp: () => {},
  getInfo: () => Promise.resolve({ id: '', name: '', build: '', version: '' }),
  getState: () => Promise.resolve({ isActive: true }),
  getLaunchUrl: () => Promise.resolve({ url: '' }),
  minimizeApp: () => Promise.resolve(),
};
