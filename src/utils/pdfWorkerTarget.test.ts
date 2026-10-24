// @vitest-environment node
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import { build } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

/*
  F062 (review of 70fdd2a) — the app ships to iOS 15.0 and Android 7, and the
  production build is lowered to es2018 (vite.config.ts `build.target`). A
  worker imported with a bare `?url` is copied verbatim and never lowered, and
  pdf.js 6's worker contains class static blocks (`static { ... }`), which
  WebKit below 16.4 cannot even parse: the fake-worker import fails and every
  PDF read, including the OCR rasterising fallback, errors on iOS 15.0-16.3.

  This test runs the REAL production Vite pipeline over the real
  pdfExtractor.ts entry and parses everything it emits, the pdf.js worker
  included, as an es2018 module. It fails the moment the worker is wired so
  that it bypasses the build target again.
*/
const root = fileURLToPath(new URL('../../', import.meta.url));

interface Emitted {
  fileName: string;
  code: string;
}

let emitted: Emitted[] = [];

beforeAll(async () => {
  const result = await build({
    root,
    configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
    logLevel: 'silent',
    build: {
      write: false,
      copyPublicDir: false,
      sourcemap: false,
      reportCompressedSize: false,
      // App mode, not lib mode: lib mode bundles a `?url` worker as a chunk
      // and would hide exactly the verbatim-copy behaviour this guards.
      rollupOptions: {
        input: fileURLToPath(new URL('./pdfExtractor.ts', import.meta.url)),
        preserveEntrySignatures: 'strict',
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(r =>
    'output' in r ? r.output : [],
  );
  emitted = outputs.flatMap(o => {
    if (o.type === 'chunk') return [{ fileName: o.fileName, code: o.code }];
    const code = typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8');
    return /\.m?js$/.test(o.fileName) ? [{ fileName: o.fileName, code }] : [];
  });
}, 240_000);

describe('production build lowers the pdf.js worker to the app target (es2018)', () => {
  it('emits a pdf.js worker module', () => {
    expect(emitted.some(e => /pdf\.worker/.test(e.fileName))).toBe(true);
  });

  it('parses every emitted script, the worker included, as a pre-2022 module', () => {
    expect(emitted.length).toBeGreaterThan(1);
    const failures: string[] = [];
    for (const { fileName, code } of emitted) {
      try {
        // ecmaVersion 2020 admits the dynamic import() the app code uses;
        // class static blocks (ES2022) are what iOS < 16.4 cannot parse.
        acorn.parse(code, { ecmaVersion: 2020, sourceType: 'module' });
      } catch (error) {
        failures.push(`${fileName}: ${(error as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
