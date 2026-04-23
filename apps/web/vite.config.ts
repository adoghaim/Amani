import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  envPrefix: 'EXPO_PUBLIC_',
  envDir: '../mobile',
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  worker: {
    format: 'es',
  },
});
