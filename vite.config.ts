import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  optimizeDeps: {
    exclude: ['lucide-react', '@capacitor/app', '@capacitor/browser', '@capacitor/camera', '@capacitor/network', '@capacitor/core'],
  },
  resolve: {
    alias: {
      '@capacitor/app': '/src/lib/capacitor-stubs/app.ts',
      '@capacitor/browser': '/src/lib/capacitor-stubs/browser.ts',
      '@capacitor/camera': '/src/lib/capacitor-stubs/camera.ts',
      '@capacitor/network': '/src/lib/capacitor-stubs/network.ts',
    },
  },
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
});
