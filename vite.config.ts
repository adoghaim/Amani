import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, transformWithEsbuild, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/*
  Release identifier stamped into every Sentry event (see
  src/lib/observability/initSentry.ts). Without it, two deploys of the same
  version are indistinguishable and a minified frame can resolve against the
  wrong uploaded source map, should a build ever upload them (see
  removeSourceMaps below). Netlify exposes the commit as COMMIT_REF; local
  builds fall back to the bare version.
*/
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string };
const commit = process.env.COMMIT_REF ?? process.env.GITHUB_SHA;
const appRelease = commit ? `amani@${version}+${commit.slice(0, 7)}` : `amani@${version}`;

/*
  `<file>?lowered-url` resolves to the URL of <file> after esbuild has lowered
  it to `build.target`, with its ES exports intact. It exists for the pdf.js
  worker (src/utils/pdfExtractor.ts), which must satisfy two things at once:

  - Syntax: a bare `?url` copies the worker verbatim, and pdf.js 6's worker has
    ES2022 syntax (class static blocks) that WebKit below 16.4 cannot parse.
  - Exports: pdf.js falls back to a fake worker when a module Worker cannot
    start (CSP worker-src, a custom-scheme WebView), and then does
    `(await import(workerSrc)).WorkerMessageHandler`. Vite's `?worker&url`
    bundler hard-codes preserveEntrySignatures:false, which strips that export,
    so the fallback gets undefined and every getDocument() rejects.

  A plain esbuild transform lowers the syntax and leaves the exports alone.
  Guarded by src/utils/pdfWorkerTarget.test.ts. The asset goes through Vite's
  own `__VITE_ASSET__` placeholder so `base` (absolute on web, './' on native)
  is applied to the URL as for any other asset.

  - Runtime APIs: lowering is syntax only. `prelude` (src/utils/pdfjsPolyfills.ts)
    is compiled to an IIFE and put in front of the file, because the worker is
    its own realm and does not see the main thread's polyfills.
  - `import.meta` stays: esbuild would otherwise replace it below es2020 with an
    empty object, and the worker's emscripten (JBig2/OpenJPEG) loaders read
    `import.meta.url`. Every engine with module workers supports it.
*/
const LOWERED_URL = '?lowered-url';
function loweredUrlAsset({ prelude }: { prelude: string }): Plugin {
  let target: string | string[] | false = 'es2018';
  let isBuild = false;
  return {
    name: 'amani:lowered-url',
    enforce: 'pre',
    configResolved(config) {
      isBuild = config.command === 'build';
      target = config.build.target as string | string[] | false;
    },
    async resolveId(source, importer, options) {
      if (!source.endsWith(LOWERED_URL)) return null;
      const resolved = await this.resolve(source.slice(0, -LOWERED_URL.length), importer, {
        ...options,
        skipSelf: true,
      });
      return resolved ? `${resolved.id}${LOWERED_URL}` : null;
    },
    async load(id) {
      if (!id.endsWith(LOWERED_URL)) return null;
      const file = id.slice(0, -LOWERED_URL.length);
      this.addWatchFile(file);
      // The dev server serves modern browsers unbundled; only a build lowers.
      if (!isBuild) return `export default ${JSON.stringify(`/@fs/${file.replace(/^\//, '')}`)};`;
      this.addWatchFile(prelude);
      const esbuildTarget = target || 'es2018';
      const polyfills = await transformWithEsbuild(readFileSync(prelude, 'utf-8'), prelude, {
        format: 'iife',
        target: esbuildTarget,
        sourcemap: false,
      });
      const { code } = await transformWithEsbuild(`${polyfills.code}\n${readFileSync(file, 'utf-8')}`, file, {
        format: 'esm',
        target: esbuildTarget,
        supported: { 'import-meta': true },
        minify: true,
        sourcemap: false,
        legalComments: 'none',
      });
      const name = file.slice(file.lastIndexOf('/') + 1);
      const ref = this.emitFile({ type: 'asset', name, source: code });
      return `export default "__VITE_ASSET__${ref}__";`;
    },
  };
}

/*
  A source map embeds the original source of this private repo, and every file
  vite build writes is public: Netlify serves dist/, and cap sync copies it into
  the iOS and Android apps. So no build emits maps (build.sourcemap below), and
  this deletes any *.map left in the output — copied from public/, or emitted
  by a future step that uploads maps (to Sentry, say), which must upload before
  the build ends. Being part of this config, it runs in every vite build:
  npm run build, cap:sync and the release scripts, whichever Netlify runs.
*/
export function removeSourceMaps(): Plugin {
  let outDir = '';
  const remove = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) remove(path);
      else if (entry.name.endsWith('.map')) rmSync(path);
    }
  };
  return {
    name: 'amani:remove-source-maps',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      if (existsSync(outDir)) remove(outDir);
    },
  };
}

// https://vitejs.dev/config/
//
// IMPORTANT: the `@capacitor/*` plugin aliases below are deliberately gated to
// the dev server (`command === 'serve'`) only. In production builds we MUST
// resolve the real `@capacitor/*` packages so that `cap:sync` ships working
// native plugins to iOS/Android — otherwise camera capture, in-app browser,
// network detection, and the Android back button silently no-op on device.
export default defineConfig(({ command }) => ({
  plugins: [
    loweredUrlAsset({ prelude: fileURLToPath(new URL('./src/utils/pdfjsPolyfills.ts', import.meta.url)) }),
    react(),
    removeSourceMaps(),
  ],
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
    // The pdf.js worker is only ever imported as `?lowered-url`; pre-bundling it would hand that plugin an
    // optimizer path instead of the package file.
    exclude: ['lucide-react', '@capacitor/app', '@capacitor/browser', '@capacitor/camera', '@capacitor/network', '@capacitor/core', 'pdfjs-dist/legacy/build/pdf.worker.min.mjs'],
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
    // Not 'hidden': that only drops the sourceMappingURL comment, and the map
    // files still ship beside every chunk. See removeSourceMaps above.
    sourcemap: false,
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
