import { fileURLToPath } from 'node:url';
import { build, type Rollup } from 'vite';
import { describe, expect, it } from 'vitest';

/*
  Review F068: the dev-only pages must not ship. A lazy() declared at module
  scope keeps its import() — and so its chunk — in a production build even
  when its route is never registered. This compiles App.tsx alone, every import
  left external, so the output lists exactly the modules App.tsx still loads.
*/

const app = fileURLToPath(new URL('./App.tsx', import.meta.url));
const DEV_ONLY_PAGES = ['ParserDebugger', 'DesignGallery'];

/** Rollup rewrites the specifier relative to the output chunk, e.g. import("../pages/Dashboard"). */
const importsPage = (code: string, page: string) =>
  new RegExp(`import\\(["'](?:\\.\\.?/)+pages/${page}["']\\)`).test(code);

async function compileApp(nodeEnv: 'production' | 'development'): Promise<string> {
  // `vite build` decides import.meta.env.DEV from NODE_ENV, which Vitest sets to 'test'.
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;
  try {
    const result = await build({
      configFile: false,
      envFile: false,
      logLevel: 'silent',
      mode: nodeEnv,
      esbuild: { jsx: 'automatic' },
      build: {
        write: false,
        minify: false,
        rollupOptions: {
          input: app,
          external: (_id, importer) => importer !== undefined,
        },
      },
    });
    const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
    return outputs.flatMap(o => o.output).map(o => (o.type === 'chunk' ? o.code : '')).join('\n');
  } finally {
    process.env.NODE_ENV = previous;
  }
}

describe('dev-only pages (F068)', () => {
  it('a production build of App.tsx imports neither dev page, so neither chunk is emitted', async () => {
    const code = await compileApp('production');
    expect(importsPage(code, 'Dashboard')).toBe(true);
    for (const page of DEV_ONLY_PAGES) {
      expect(importsPage(code, page), page).toBe(false);
      expect(code, page).not.toContain(page);
    }
  });

  it('a development build still registers both dev pages', async () => {
    const code = await compileApp('development');
    for (const page of DEV_ONLY_PAGES) expect(importsPage(code, page), page).toBe(true);
  });
});
