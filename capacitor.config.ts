import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.amani.health',
  appName: 'Amani',
  webDir: 'dist',
  server: {
    // Remove this block before building for production/app store submission.
    // Uncomment and set to your local machine IP for live-reload during development:
    // url: 'http://192.168.x.x:5173',
    // cleartext: true,
  },
};

export default config;
