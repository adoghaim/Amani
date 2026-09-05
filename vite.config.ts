import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/*
  Release identifier stamped into every Sentry event (see
  src/lib/observability/initSentry.ts). Without it, two deploys of the same
  version are indistinguishable and a minified frame can resolve against the
  wrong uploaded source map — which is the whole point of `sourcemap: 'hidden'`
  below. Netlify exposes the commit as COMMIT_REF; local builds fall back to
  the bare version.
*/
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string };
const commit = process.env.COMMIT_REF ?? process.env.GITHUB_SHA;
const appRelease = commit ? `amani@${version}+${commit.slice(0, 7)}` : `amani@${version}`;

// https://vitejs.dev/config/
//
// IMPORTANT: the `@capacitor/*` plugin aliases below are deliberately gated to
// the dev server (`command === 'serve'`) only. In production builds we MUST
// resolve the real `@capacitor/*` packages so that `cap:sync` ships working
// native plugins to iOS/Android — otherwise camera capture, in-app browser,
// network detection, and the Android back button silently no-op on device.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  /*
    Web needs an absolute base. With './', a nested route like /app/reports
    resolves its asset URLs against /app/, so the bundle 404s and the page
    dies — the relative base only ever worked at the root path.

    Native still needs './': cap:sync sets BUILD_TARGET=native, because the
    webview loads index.html from the bundled filesystem rather than a server
    root. Native never full-loads a nested path anyway — it boots at / and
    routes client-side, including for inbound universal links.
  */
  base: process.env.BUILD_TARGET === 'native' ? './' : '/',
  define: {
    __APP_RELEASE__: JSON.stringify(appRelease),
  },
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

          /*
            react-router MUST stay in the same chunk as react.

            Splitting them produced a blank white page in every production
            build: react-router touches React.createContext while its module
            body evaluates, so if the router chunk runs before the react chunk,
            React is undefined and the app throws before it ever mounts. There
            is no error boundary above that — the root render never happens, so
            the user just sees #root sitting empty.

            It never showed up in `npm run dev`, because the dev server serves
            unbundled ESM and manualChunks does not apply.

            Keep this predicate ordered before the react check, and keep both
            returning the same chunk name.
          */
          if (
            id.includes('/react-router-dom/') ||
            id.includes('/react-router/') ||
            id.includes('/react-dom/') ||
            id.includes('/react/') ||
            id.includes('/scheduler/')
          ) {
            return 'react-vendor';
          }
          if (id.includes('/@supabase/')) {
            return 'supabase-vendor';
          }
          return undefined;
        },
      },
    },
  },
}));
