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
});
