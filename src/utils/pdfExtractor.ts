// Lazy pdfjs loader. The static import was pulling ~530 kB / 153 kB gz into
// the NewReport route chunk on cold start; most users never upload a PDF on
// first visit. The promise is cached so multiple PDF operations in one
// session don't re-fetch the chunk.
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function loadPdfJs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [pdfjsLib, workerUrlMod] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ]);
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrlMod.default;
      return pdfjsLib;
    })();
  }
  return pdfjsPromise;
}

/*
  A lab PDF is attacker-influenceable input: the user uploads whatever a portal
  (or anyone else) handed her. pdfjs-dist defaults `isEvalSupported` to true,
  which lets a crafted font program reach `Function` during rendering —
  GHSA-hq66-cqwq-w95j, "arbitrary JavaScript execution upon opening a malicious
  PDF". Turning eval off closes that path; the cost is slower font rendering,
  which does not matter here because we only extract text and rasterise for OCR.

  This is the cheap half of the mitigation. The advisory is fixed in pdfjs-dist
  6.2.108, a semver-major bump from the pinned 5.x — that upgrade is a separate,
  scoped change because it touches the parser's regression surface.
*/
const PDF_HARDENING = { isEvalSupported: false } as const;

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
    const arrayBuffer = await file.arrayBuffer();
    const pdfjsLib = await loadPdfJs();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, ...PDF_HARDENING }).promise;

    const pages: PDFPageText[] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const items = textContent.items as unknown as TextItem[];

      const pageText = extractPageLines(items);
      pages.push({ pageNumber: pageNum, text: pageText });
    }

    const fullText = pages.map(p => p.text).join('\n\n');

    console.log(`[pdfExtractor] Extracted ${pdf.numPages} pages, ${fullText.length} chars total`);
    if (pages.length > 0 && pages[0]) {
      console.log('[pdfExtractor] Page 1 preview (first 500 chars):', pages[0].text.substring(0, 500));
    }

    return { fullText, pages, totalPages: pdf.numPages };
  } catch (error) {
    console.error('Error extracting PDF text:', error);
    throw new Error('Failed to extract text from PDF');
  }
}

export async function convertPDFToImages(file: File): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfjsLib = await loadPdfJs();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, ...PDF_HARDENING }).promise;
  const images: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
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
}
