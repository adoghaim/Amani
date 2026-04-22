export const Network = {
  getStatus: () => Promise.resolve({ connected: navigator.onLine, connectionType: 'unknown' }),
  addListener: () => Promise.resolve({ remove: () => {} }),
  removeAllListeners: () => Promise.resolve(),
};
