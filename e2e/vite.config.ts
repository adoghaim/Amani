import { defineConfig, mergeConfig } from 'vite';
import appConfig from '../vite.config';

// Preserve the app's plugins/aliases while disabling local env-file loading.
export default defineConfig(env => mergeConfig(appConfig(env), {
  envDir: false,
  server: { hmr: false },
}));
