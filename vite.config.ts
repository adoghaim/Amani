import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
//
// IMPORTANT: the `@capacitor/*` plugin aliases below are deliberately gated to
// the dev server (`command === 'serve'`) only. In production builds we MUST
// resolve the real `@capacitor/*` packages so that `cap:sync` ships working
// native plugins to iOS/Android — otherwise camera capture, in-app browser,
// network detection, and the Android back button silently no-op on device.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: './',
  optimizeDeps: {
    exclude: ['lucide-react', '@capacitor/app', '@capacitor/browser', '@capacitor/camera', '@capacitor/network', '@capacitor/core'],
  },
  resolve: command === 'serve'
    ? {
        alias: {
          '@capacitor/app': '/src/lib/capacitor-stubs/app.ts',
          '@capacitor/browser': '/src/lib/capacitor-stubs/browser.ts',
          '@capacitor/camera': '/src/lib/capacitor-stubs/camera.ts',
          '@capacitor/network': '/src/lib/capacitor-stubs/network.ts',
        },
      }
    : undefined,
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2018',
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/react-router-dom/') || id.includes('/react-router/')) {
            return 'react-router-vendor';
          }
          if (id.includes('/@supabase/')) {
            return 'supabase-vendor';
          }
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) {
            return 'react-vendor';
          }
          return undefined;
        },
      },
    },
  },
}));
