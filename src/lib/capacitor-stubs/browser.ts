export const Browser = {
  open: (options: { url: string }) => { window.open(options.url, '_blank', 'noopener,noreferrer'); return Promise.resolve(); },
  close: () => Promise.resolve(),
  addListener: () => Promise.resolve({ remove: () => {} }),
  removeAllListeners: () => Promise.resolve(),
};
