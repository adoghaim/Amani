import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig, type UserConfig } from 'vite';
import appConfig from '../vite.config';

// Vite 5 requires a directory string; false falls back to the project root.
// Type the override before mergeConfig, whose arguments otherwise accept any.
const e2eOverrides = {
  envDir: fileURLToPath(new URL('./no-env', import.meta.url)),
  server: { hmr: false },
} satisfies UserConfig;

export default defineConfig(env => mergeConfig(appConfig(env), e2eOverrides));
