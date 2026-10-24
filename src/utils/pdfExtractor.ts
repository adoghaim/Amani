// Lazy pdfjs loader. The static import was pulling ~530 kB / 153 kB gz into
// the NewReport route chunk on cold start; most users never upload a PDF on
// first visit. The promise is cached so multiple PDF operations in one
// session don't re-fetch the chunk.
//
// The LEGACY build is deliberate. The modern build calls Promise.try and
// Uint8Array.prototype.toHex with no polyfill, which WebKit below 18.2 and
// Android 7-9 WebViews lack, and the app still ships to iOS 15 and Android 7.
// There getDocument() never settles (Promise.try) or rejects (toHex). The
// legacy build bundles core-js for those (and Set methods, iterator helpers,
// URL.parse), but NOT for Promise.withResolvers, .at, Object.hasOwn,
// findLast, structuredClone, ArrayBuffer#transferToFixedLength or
// ReadableStream async iteration (which getTextContent() needs, and WebKit
// only has from 27). ./pdfjsPolyfills supplies those: imported here before
// pdf.mjs, and prepended to the worker by `?lowered-url`, since the worker is
// a separate realm. Guarded by pdfWorkerTarget.test.ts, which runs the built
// files with those APIs deleted.
//
// The worker is imported with `?lowered-url` (the `loweredUrlAsset` plugin in
// vite.config.ts), NOT a bare `?url` and NOT `?worker&url`. A bare `?url` copies
// the file verbatim, so the build target (es2018) never touches it, and
// pdf.js 6's worker contains syntax (class static blocks, ES2022) that WebKit
// below 16.4 cannot parse: PDF reading then failed on iOS 15.0-16.3.
// `?worker&url` lowers it, but Vite's worker bundler also strips the worker's
// `export { WorkerMessageHandler }`, which pdf.js's fake-worker fallback (module
// Worker blocked by CSP or a custom-scheme WebView) imports: every getDocument()
// then rejected. `?lowered-url` lowers the syntax and keeps the export (both
// guarded by pdfWorkerTarget.test.ts). The legacy build and ./pdfjsPolyfills
// supply the missing runtime APIs; this supplies the missing syntax.
type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJs> | null = null;

async function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      // Before pdf.mjs evaluates: kept out of the route chunk like pdf.js itself.
      await import('./pdfjsPolyfills');
      const [pdfjsLib, workerUrlMod] = await Promise.all([
        import('pdfjs-dist/legacy/build/pdf.mjs'),
        import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?lowered-url'),
      ]);
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrlMod.default;
      return pdfjsLib;
    })();
  }
  return pdfjsPromise;
}

/*
  A lab PDF is attacker-influenceable input: the user uploads whatever a portal
  (or anyone else) handed her. GHSA-hq66-cqwq-w95j ("arbitrary JavaScript
  execution upon opening a malicious PDF", fixed in pdfjs-dist 6.2.108) needs
  `enableScripting: true` together with a page that sets no CSP. We only call
  getDocument(), getTextContent() and page.render() to a canvas, and never build
  an AnnotationLayer, the pdf.js viewer or its scripting sandbox, which are the
  only readers of `enableScripting`. The dependency is on the patched 6.x line
  regardless, so safety does not hinge on that.

  There is deliberately no `isEvalSupported` option: pdfjs-dist 5.7 and 6.x do
  not read it (zero occurrences in the shipped builds), so passing it hardened
  nothing. Do not re-add it as a mitigation. Defence in depth is a
  Content-Security-Policy on the hosting side, which is tracked separately.
*/

/*
  A scanned or malformed PDF, or an engine the library cannot run on, can leave
  getDocument() or getPage() pending forever, which used to leave "Reading your
  report…" on screen with Next disabled. Past the deadline the loading task is
  destroyed and the call rejects; NewReport turns that into its manual-entry
  message (text extraction) or its OCR-failed message (rasterisation).
*/
export const PDF_EXTRACT_TIMEOUT_MS = 45_000;
// Rasterising every page at 2x for OCR is slower than reading the text layer.
export const PDF_RENDER_TIMEOUT_MS = 120_000;

interface DeadlineState {
  expired: boolean;
  /** Register the loading task so the deadline can destroy it. Throws if the deadline already passed. */
  track(task: { destroy(): unknown }): void;
}

function destroyQuietly(task: { destroy(): unknown } | null) {
  try {
    Promise.resolve(task?.destroy()).catch(() => {});
  } catch {
    // already torn down
  }
}

async function withDeadline<T>(ms: number, run: (state: DeadlineState) => Promise<T>): Promise<T> {
  let task: { destroy(): unknown } | null = null;
  const state: DeadlineState = {
    expired: false,
    track(t) {
      task = t;
      if (state.expired) {
        // The deadline passed while the file was being read: do not leave a worker task behind.
        destroyQuietly(t);
        throw new Error('PDF processing timed out');
      }
    },
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      state.expired = true;
      destroyQuietly(task);
      reject(new Error(`PDF processing timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
  });
  const work = run(state);
  // After a timeout the abandoned work rejects (its task was destroyed); expected.
  work.catch(() => {});
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export interface PDFPageText {
  pageNumber: number;
  text: string;
}

export interface PDFExtractResult {
  fullText: string;
  pages: PDFPageText[];
  totalPages: number;
}

interface TextItem {
  str: string;
  // pdfjs transform is a 6-tuple [a, b, c, d, e, f] where e=x, f=y.
  transform: [number, number, number, number, number, number];
  width: number;
  height: number;
}

function extractPageLines(items: TextItem[]): string {
  if (items.length === 0) return '';

  const sortedItems = [...items].sort((a, b) => {
    const yDiff = b.transform[5] - a.transform[5];
    if (Math.abs(yDiff) > 3) return yDiff;
    return a.transform[4] - b.transform[4];
  });

  const lineMap = new Map<number, { x: number; str: string }[]>();

  for (const item of sortedItems) {
    if (!item.str.trim()) continue;
    const y = Math.round(item.transform[5]);

    let bucketY = y;
    for (const existingY of lineMap.keys()) {
      if (Math.abs(existingY - y) <= 3) {
        bucketY = existingY;
        break;
      }
    }

    let bucket = lineMap.get(bucketY);
    if (!bucket) {
      bucket = [];
      lineMap.set(bucketY, bucket);
    }
    bucket.push({ x: item.transform[4], str: item.str });
  }

  const sortedYs = [...lineMap.keys()].sort((a, b) => b - a);

  const lines: string[] = [];
  for (const y of sortedYs) {
    const bucket = lineMap.get(y);
    if (!bucket) continue;
    const lineItems = bucket.sort((a, b) => a.x - b.x);
    const lineStr = lineItems.map(it => it.str).join(' ').trim();
    if (lineStr) lines.push(lineStr);
  }

  return lines.join('\n');
}

export async function extractTextFromPDF(file: File): Promise<string> {
  const result = await extractStructuredTextFromPDF(file);
  return result.fullText;
}

export async function extractStructuredTextFromPDF(file: File): Promise<PDFExtractResult> {
  try {
    const { pdf, pages } = await withDeadline(PDF_EXTRACT_TIMEOUT_MS, async state => {
      const arrayBuffer = await file.arrayBuffer();
      const pdfjsLib = await loadPdfJs();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      state.track(loadingTask);
      const doc = await loadingTask.promise;

      const collected: PDFPageText[] = [];

      for (let pageNum = 1; pageNum <= doc.numPages && !state.expired; pageNum++) {
        const page = await doc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const items = textContent.items as unknown as TextItem[];

        const pageText = extractPageLines(items);
        collected.push({ pageNumber: pageNum, text: pageText });
      }

      return { pdf: doc, pages: collected };
    });

    const fullText = pages.map(p => p.text).join('\n\n');

    /*
      Dev-only. The first 500 characters of a lab report are its header block —
      patient name, date of birth, MRN, ordering physician — so in a production
      build this line wrote PHI into the browser console and, on Capacitor, into
      the Android device log, where any app with READ_LOGS or anyone with adb can
      read it. `src/lib/observability/scrub.ts` already drops console breadcrumbs
      because of this line; that closed the Sentry egress path but left the
      device log itself. The page-count line goes behind the same gate because it
      exists only to make the preview line readable.
    */
    if (import.meta.env.DEV) {
      console.log(`[pdfExtractor] Extracted ${pdf.numPages} pages, ${fullText.length} chars total`);
      if (pages.length > 0 && pages[0]) {
        console.log('[pdfExtractor] Page 1 preview (first 500 chars):', pages[0].text.substring(0, 500));
      }
    }

    return { fullText, pages, totalPages: pdf.numPages };
  } catch (error) {
    console.error('Error extracting PDF text:', error);
    throw new Error('Failed to extract text from PDF');
  }
}

export async function convertPDFToImages(file: File): Promise<string[]> {
  return withDeadline(PDF_RENDER_TIMEOUT_MS, async state => {
    const arrayBuffer = await file.arrayBuffer();
    const pdfjsLib = await loadPdfJs();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    state.track(loadingTask);
    const pdf = await loadingTask.promise;
    const images: string[] = [];

    for (let i = 1; i <= pdf.numPages && !state.expired; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 }); // Higher scale for better OCR
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) continue;

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({ canvas, canvasContext: context, viewport }).promise;
      images.push(canvas.toDataURL('image/jpeg', 0.85));
    }

    return images;
  });
}
