import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  F062 (legacy build + extraction timeout) and F108 (dead isEvalSupported
  option). pdf.js itself is replaced by fakes here; the real library runs in
  pdfExtractor.runtime.test.ts.
*/
const h = vi.hoisted(() => ({
  legacyGetDocument: vi.fn(),
  modernGetDocument: vi.fn(),
  legacyOptions: { workerSrc: '' },
  modernOptions: { workerSrc: '' },
}));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: h.legacyGetDocument,
  GlobalWorkerOptions: h.legacyOptions,
}));
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&url', () => ({ default: 'legacy-worker-url' }));
vi.mock('pdfjs-dist', () => ({
  getDocument: h.modernGetDocument,
  GlobalWorkerOptions: h.modernOptions,
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker&url', () => ({ default: 'modern-worker-url' }));

const pdfFile = () => new File([new Uint8Array([37, 80, 68, 70])], 'lab.pdf', { type: 'application/pdf' });

const textPage = (str: string) => ({
  getTextContent: async () => ({ items: [{ str, transform: [1, 0, 0, 1, 10, 700], width: 10, height: 10 }] }),
});

const loadModule = async () => {
  vi.resetModules();
  return import('./pdfExtractor');
};

// Only the deadline timers are faked: File.arrayBuffer() and the mocked dynamic
// imports settle on real I/O ticks. `flushIo` lets them through, until the code
// under test has reached getDocument, before the fake clock moves.
const useDeadlineTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const flushIo = async () => {
  for (let i = 0; i < 2000 && h.legacyGetDocument.mock.calls.length === 0; i++) await tick();
  for (let i = 0; i < 5; i++) await tick();
};

beforeEach(() => {
  h.legacyGetDocument.mockReset();
  h.modernGetDocument.mockReset();
  h.legacyOptions.workerSrc = '';
  h.modernOptions.workerSrc = '';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('pdf.js build selection (F062)', () => {
  it('loads the legacy build and its polyfilled worker, never the modern one', async () => {
    h.legacyGetDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage: async () => textPage('Ferritin 18') }),
      destroy: vi.fn(),
    });
    const { extractStructuredTextFromPDF } = await loadModule();
    const result = await extractStructuredTextFromPDF(pdfFile());
    expect(result.fullText).toBe('Ferritin 18');
    expect(h.legacyOptions.workerSrc).toBe('legacy-worker-url');
    expect(h.legacyGetDocument).toHaveBeenCalledTimes(1);
    expect(h.modernGetDocument).not.toHaveBeenCalled();
    expect(h.modernOptions.workerSrc).toBe('');
  });
});

describe('getDocument parameters (F108)', () => {
  it('does not pass isEvalSupported, which pdfjs-dist 6.x no longer reads', async () => {
    h.legacyGetDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 0, getPage: async () => textPage('') }),
      destroy: vi.fn(),
    });
    const { extractStructuredTextFromPDF } = await loadModule();
    await extractStructuredTextFromPDF(pdfFile());
    const params = h.legacyGetDocument.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(params)).toEqual(['data']);
  });
});

describe('extraction deadline (F062)', () => {
  it('rejects, and tears the loading task down, when getDocument never settles', async () => {
    useDeadlineTimers();
    const destroy = vi.fn().mockResolvedValue(undefined);
    h.legacyGetDocument.mockReturnValue({ promise: new Promise(() => {}), destroy });
    const { extractStructuredTextFromPDF, PDF_EXTRACT_TIMEOUT_MS } = await loadModule();

    let outcome: 'pending' | 'rejected' | 'resolved' = 'pending';
    let message = '';
    extractStructuredTextFromPDF(pdfFile()).then(
      () => { outcome = 'resolved'; },
      (e: Error) => { outcome = 'rejected'; message = e.message; },
    );
    await flushIo();
    await vi.advanceTimersByTimeAsync(PDF_EXTRACT_TIMEOUT_MS - 1);
    expect(outcome).toBe('pending');
    await vi.advanceTimersByTimeAsync(2);
    expect(outcome).toBe('rejected');
    expect(message).toBe('Failed to extract text from PDF');
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects when a page never settles', async () => {
    useDeadlineTimers();
    const destroy = vi.fn().mockResolvedValue(undefined);
    h.legacyGetDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 2, getPage: () => new Promise(() => {}) }),
      destroy,
    });
    const { extractStructuredTextFromPDF, PDF_EXTRACT_TIMEOUT_MS } = await loadModule();
    const settled = extractStructuredTextFromPDF(pdfFile()).then(() => 'resolved', () => 'rejected');
    await flushIo();
    await vi.advanceTimersByTimeAsync(PDF_EXTRACT_TIMEOUT_MS + 1);
    await expect(settled).resolves.toBe('rejected');
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys a loading task created after the deadline already passed', async () => {
    useDeadlineTimers();
    const destroy = vi.fn().mockResolvedValue(undefined);
    h.legacyGetDocument.mockReturnValue({ promise: new Promise(() => {}), destroy });
    const { extractStructuredTextFromPDF, PDF_EXTRACT_TIMEOUT_MS } = await loadModule();
    let releaseRead: (buf: ArrayBuffer) => void = () => {};
    const slowFile = {
      arrayBuffer: () => new Promise<ArrayBuffer>(resolve => { releaseRead = resolve; }),
    } as unknown as File;
    const settled = extractStructuredTextFromPDF(slowFile).then(() => 'resolved', () => 'rejected');
    await vi.advanceTimersByTimeAsync(PDF_EXTRACT_TIMEOUT_MS + 1);
    await expect(settled).resolves.toBe('rejected');
    expect(destroy).not.toHaveBeenCalled();
    releaseRead(new ArrayBuffer(4));
    await flushIo();
    // The late read still creates a task; it must be destroyed, not leaked.
    expect(h.legacyGetDocument).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('leaves no timer behind after a normal extraction', async () => {
    useDeadlineTimers();
    h.legacyGetDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage: async () => textPage('TSH 2.85') }),
      destroy: vi.fn(),
    });
    const { extractStructuredTextFromPDF } = await loadModule();
    await expect(extractStructuredTextFromPDF(pdfFile())).resolves.toMatchObject({ fullText: 'TSH 2.85' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('applies a deadline to page rasterisation for OCR as well', async () => {
    useDeadlineTimers();
    const destroy = vi.fn().mockResolvedValue(undefined);
    h.legacyGetDocument.mockReturnValue({ promise: new Promise(() => {}), destroy });
    const { convertPDFToImages, PDF_RENDER_TIMEOUT_MS } = await loadModule();
    const settled = convertPDFToImages(pdfFile()).then(() => 'resolved', (e: Error) => e.message);
    await flushIo();
    await vi.advanceTimersByTimeAsync(PDF_RENDER_TIMEOUT_MS + 1);
    await expect(settled).resolves.toMatch(/timed out/i);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
