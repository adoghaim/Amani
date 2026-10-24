// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as acorn from 'acorn';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
// Every emitted file (chunks and assets) by fileName, so the build can be run from disk.
let allFiles: { fileName: string; source: string | Uint8Array; isEntry: boolean }[] = [];

beforeAll(async () => {
  const result = await build({
    root,
    configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
    logLevel: 'silent',
    // The native base: asset URLs become `new URL(..., import.meta.url)`, so the
    // built chunks can find the built worker when run from a temp directory.
    base: './',
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
  allFiles = outputs.map(o =>
    o.type === 'chunk'
      ? { fileName: o.fileName, source: o.code, isEntry: o.isEntry }
      : { fileName: o.fileName, source: o.source, isEntry: false },
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

  /*
    Wave 3 (review of 8c3f059): below es2020 esbuild replaced `import.meta` with
    an empty object, so the worker's emscripten JBig2/OpenJPEG loaders read
    `import.meta.url` as undefined. Lowering must leave it as the package has it.
  */
  it('keeps import.meta.url in the lowered worker', () => {
    const pkg = readFileSync(
      fileURLToPath(new URL('../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url)),
      'utf8',
    );
    const worker = emitted
      .filter(e => /pdf\.worker/.test(e.fileName))
      .sort((a, b) => b.code.length - a.code.length)[0];
    const count = (code: string) => code.split('import.meta.url').length - 1;
    expect(count(pkg)).toBeGreaterThan(0);
    expect(count(worker?.code ?? '')).toBe(count(pkg));
  });
});

/*
  F062 follow-up (review of d22dba5) — lowering the worker must not cost it its
  `export { WorkerMessageHandler }`. pdf.js falls back to a fake worker
  whenever a module Worker cannot start (CSP worker-src, a custom-scheme
  WebView, an engine without module workers): it does
  `(await import(workerSrc)).WorkerMessageHandler`. Vite's own `?worker`
  bundler hard-codes preserveEntrySignatures:false and strips that export, so
  every getDocument() then rejects with "Cannot read properties of undefined
  (reading 'setup')". These tests load the BUILT worker the way the fallback
  does.
*/
describe('the built pdf.js worker keeps its ES export for the fake-worker fallback', () => {
  let dir = '';
  let workerFile = '';

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'amani-pdf-worker-'));
    const worker = emitted
      .filter(e => /pdf\.worker/.test(e.fileName))
      .sort((a, b) => b.code.length - a.code.length)[0]; // the worker itself, not the URL stub chunk
    if (!worker) throw new Error('no pdf.js worker emitted');
    workerFile = join(dir, 'worker.mjs');
    writeFileSync(workerFile, worker.code);
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('exports WorkerMessageHandler as a function', async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(workerFile).href)) as Record<string, unknown>;
    expect(typeof mod.WorkerMessageHandler).toBe('function');
  });

  it('extracts a synthetic Quest PDF through the fake worker using the built file', async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    for (const name of ['DOMMatrix', 'Path2D', 'ImageData']) g[name] ??= class {};
    // Importing the worker module sets this global, which pdf.js prefers over the export; drop it so the export is what is exercised.
    delete g.pdfjsWorker;
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerFile).href;
    const data = new Uint8Array(
      readFileSync(fileURLToPath(new URL('../../e2e/extraction/fixtures/synthetic-quest-labs.pdf', import.meta.url))),
    );
    const task = pdfjs.getDocument({ data });
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const text = (await page.getTextContent()).items.map(i => ('str' in i ? i.str : '')).join(' ');
    expect(text).toMatch(/Vitamin D/i);
    await task.destroy();
  }, 30_000);
});

/*
  F062, wave 3 (review of 8c3f059) — the legacy build bundles core-js for
  Promise.try, Uint8Array toHex/base64, Set methods, iterator helpers and
  URL.parse, but NOT for the other post-iOS-15.0 APIs that the shipped main
  chunk and worker call unguarded:

    Promise.withResolvers                       WebKit 17.4, Chrome 119
    Array/String/TypedArray .at, Object.hasOwn  WebKit 15.4, Chrome 92/93
    Array/TypedArray .findLast(Index)           WebKit 15.4, Chrome 97
    structuredClone (fake-worker LoopbackPort)  WebKit 15.4, Chrome 98
    ArrayBuffer#transferToFixedLength (fonts)   WebKit 17.4, Chrome 114
    ReadableStream async iteration              WebKit 27,   Chrome 124
      (page.getTextContent() is `for await (... of readableStream)`)
    Response/Blob#bytes                         WebKit 18,   Chrome 132

  Each check runs in a FRESH Node process (deleting built-ins there cannot
  disturb the test runner) where those APIs are deleted before anything loads,
  and then loads the BUILT files: the oldest engine the app declares
  (IPHONEOS_DEPLOYMENT_TARGET 15.0, Android WebView below 119).
*/
const OLD_ENGINE_PRELUDE = String.raw`
const TA = Object.getPrototypeOf(Int8Array.prototype);
const ITER = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
const ours = [
  ['Promise.withResolvers', Promise, 'withResolvers'],
  ['Array.prototype.at', Array.prototype, 'at'],
  ['String.prototype.at', String.prototype, 'at'],
  ['TypedArray.prototype.at', TA, 'at'],
  ['Array.prototype.findLast', Array.prototype, 'findLast'],
  ['Array.prototype.findLastIndex', Array.prototype, 'findLastIndex'],
  ['TypedArray.prototype.findLast', TA, 'findLast'],
  ['TypedArray.prototype.findLastIndex', TA, 'findLastIndex'],
  ['Object.hasOwn', Object, 'hasOwn'],
  ['structuredClone', globalThis, 'structuredClone'],
  ['ArrayBuffer.prototype.transferToFixedLength', ArrayBuffer.prototype, 'transferToFixedLength'],
  ['ReadableStream.prototype[Symbol.asyncIterator]', ReadableStream.prototype, Symbol.asyncIterator],
  ['ReadableStream.prototype.values', ReadableStream.prototype, 'values'],
  ['Response.prototype.bytes', Response.prototype, 'bytes'],
  ['Blob.prototype.bytes', Blob.prototype, 'bytes'],
];
// Supplied by pdf.js legacy's own core-js; deleted too, as an iOS 15 engine lacks them.
const theirs = [
  ['Promise.try', Promise, 'try'],
  ['Uint8Array.prototype.toHex', Uint8Array.prototype, 'toHex'],
  ['Uint8Array.prototype.toBase64', Uint8Array.prototype, 'toBase64'],
  ['Uint8Array.fromBase64', Uint8Array, 'fromBase64'],
  ['Set.prototype.union', Set.prototype, 'union'],
  ['Set.prototype.difference', Set.prototype, 'difference'],
  ['Iterator.prototype.map', ITER, 'map'],
  ['Iterator.prototype.filter', ITER, 'filter'],
  ['Iterator.prototype.toArray', ITER, 'toArray'],
  ['URL.parse', URL, 'parse'],
];
for (const [, o, k] of [...ours, ...theirs]) delete o[k];
const missing = list => list.filter(([, o, k]) => typeof o[k] !== 'function').map(([n]) => n);
const report = r => console.log('RESULT ' + JSON.stringify(r));
const stillThere = [...ours, ...theirs].filter(([, o, k]) => typeof o[k] !== 'undefined').map(([n]) => n);
if (stillThere.length) { report({ ok: false, error: 'could not delete: ' + stillThere }); process.exit(0); }
for (const name of ['DOMMatrix', 'Path2D', 'ImageData']) globalThis[name] ??= class {};
const [arg1, arg2] = process.argv.slice(1).filter(a => a !== '--');
`;

function runOnOldEngine(body: string, args: string[]) {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', OLD_ENGINE_PRELUDE + body, '--', ...args], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  const detail = `exit ${child.status}\nstdout: ${child.stdout.slice(-2000)}\nstderr: ${child.stderr.slice(-2000)}`;
  const line = child.stdout.split('\n').find(l => l.startsWith('RESULT '));
  if (!line) throw new Error(`old-engine child produced no result\n${detail}`);
  return { result: JSON.parse(line.slice('RESULT '.length)) as Record<string, unknown>, detail };
}

describe('the BUILT pdf.js chunk and worker run on the oldest declared engine (iOS 15.0)', () => {
  let dir = '';
  let entryFile = '';
  let workerFile = '';
  const pdfPath = fileURLToPath(new URL('../../e2e/extraction/fixtures/synthetic-quest-labs.pdf', import.meta.url));

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'amani-pdf-old-engine-'));
    for (const f of allFiles) {
      const out = join(dir, f.fileName);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, f.source);
    }
    const entry = allFiles.find(f => f.isEntry);
    if (!entry) throw new Error('no entry chunk emitted');
    entryFile = join(dir, entry.fileName);
    const worker = allFiles
      .filter(f => /pdf\.worker/.test(f.fileName))
      .sort((a, b) => b.source.length - a.source.length)[0]; // the worker itself, not the URL stub chunk
    if (!worker) throw new Error('no pdf.js worker emitted');
    workerFile = join(dir, worker.fileName);
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('extracts the synthetic Quest PDF through the built entry, main chunk and worker', () => {
    const { result, detail } = runOnOldEngine(
      String.raw`
const { readFileSync } = await import('node:fs');
const file = new File([readFileSync(arg2)], 'synthetic-quest-labs.pdf', { type: 'application/pdf' });
try {
  const { extractStructuredTextFromPDF } = await import(arg1);
  const r = await Promise.race([
    extractStructuredTextFromPDF(file),
    new Promise((_, reject) => setTimeout(() => reject(new Error('did not settle in 20s')), 20000)),
  ]);
  report({ ok: true, totalPages: r.totalPages, text: r.fullText });
} catch (e) {
  report({ ok: false, error: String((e && e.message) || e) });
}
process.exit(0);
`,
      [pathToFileURL(entryFile).href, pdfPath],
    );
    expect(result, detail).toMatchObject({ ok: true });
    expect(result.totalPages).toBeGreaterThan(0);
    expect(result.text).toMatch(/Vitamin D/i);
    expect(result.text).toMatch(/Ferritin/i);
  }, 90_000);

  it('the built worker installs every missing API itself (it runs in its own realm)', () => {
    const { result, detail } = runOnOldEngine(
      String.raw`
try {
  await import(arg1);
  report({ ok: true, missing: missing([...ours, ...theirs]) });
} catch (e) {
  report({ ok: false, error: String((e && e.message) || e) });
}
process.exit(0);
`,
      [pathToFileURL(workerFile).href],
    );
    expect(result, detail).toEqual({ ok: true, missing: [] });
  }, 90_000);
});
