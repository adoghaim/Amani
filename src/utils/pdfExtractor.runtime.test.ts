// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/*
  F062 — runs the REAL pdf.js (the library is not mocked) against a synthetic
  lab PDF in an engine that lacks Promise.try and Uint8Array.prototype.toHex,
  the feature set of WebKit 17.4-18.1 and Android 7-9 WebView. The modern build
  needs both and never settles or throws there; the legacy build bundles those
  two polyfills. Only the Vite `?url` worker specifiers are replaced, with file
  URLs that a Node fake worker can import. The APIs the legacy build does NOT
  polyfill (Promise.withResolvers, .at, Object.hasOwn, ...) come from
  ./pdfjsPolyfills; pdfWorkerTarget.test.ts deletes them all and runs the
  built files in a fresh process.
*/
const fromPackage = (rel: string) =>
  pathToFileURL(fileURLToPath(new URL(`../../node_modules/pdfjs-dist/${rel}`, import.meta.url))).href;

vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?lowered-url', () => ({
  default: fromPackage('legacy/build/pdf.worker.min.mjs'),
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?lowered-url', () => ({
  default: fromPackage('build/pdf.worker.min.mjs'),
}));

const PDF_PATH = fileURLToPath(new URL('../../e2e/extraction/fixtures/synthetic-quest-labs.pdf', import.meta.url));

const promiseCtor = Promise as unknown as { try?: unknown };
const u8proto = Uint8Array.prototype as unknown as { toHex?: unknown };
let savedTry: unknown;
let savedToHex: unknown;

beforeAll(() => {
  // The modern build touches these at import time; a browser has them, Node does not.
  const g = globalThis as unknown as Record<string, unknown>;
  for (const name of ['DOMMatrix', 'Path2D', 'ImageData']) g[name] ??= class {};
  savedTry = promiseCtor.try;
  savedToHex = u8proto.toHex;
  delete promiseCtor.try;
  delete u8proto.toHex;
});
afterAll(() => {
  if (savedTry !== undefined) promiseCtor.try = savedTry;
  if (savedToHex !== undefined) u8proto.toHex = savedToHex;
});

describe('pdfExtractor on an engine without Promise.try / Uint8Array.toHex', () => {
  it('extracts text from a synthetic Quest PDF', async () => {
    expect(typeof promiseCtor.try).toBe('undefined');
    expect(typeof u8proto.toHex).toBe('undefined');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { extractStructuredTextFromPDF } = await import('./pdfExtractor');
    const file = new File([readFileSync(PDF_PATH)], 'synthetic-quest-labs.pdf', { type: 'application/pdf' });
    const result = await Promise.race([
      extractStructuredTextFromPDF(file),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('extraction did not settle in 12s')), 12_000);
      }),
    ]);
    expect(result.totalPages).toBeGreaterThan(0);
    expect(result.fullText).toMatch(/Vitamin D/i);
    expect(result.fullText).toMatch(/Ferritin/i);
  }, 20_000);
});
