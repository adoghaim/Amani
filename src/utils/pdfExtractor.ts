import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

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
  transform: number[];
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

    if (!lineMap.has(bucketY)) lineMap.set(bucketY, []);
    lineMap.get(bucketY)!.push({ x: item.transform[4], str: item.str });
  }

  const sortedYs = [...lineMap.keys()].sort((a, b) => b - a);

  const lines: string[] = [];
  for (const y of sortedYs) {
    const lineItems = lineMap.get(y)!.sort((a, b) => a.x - b.x);
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
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const pages: PDFPageText[] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const items = textContent.items as TextItem[];

      const pageText = extractPageLines(items);
      pages.push({ pageNumber: pageNum, text: pageText });
    }

    const fullText = pages.map(p => p.text).join('\n\n');

    console.log(`[pdfExtractor] Extracted ${pdf.numPages} pages, ${fullText.length} chars total`);
    if (pages.length > 0) {
      console.log('[pdfExtractor] Page 1 preview (first 500 chars):', pages[0].text.substring(0, 500));
    }

    return { fullText, pages, totalPages: pdf.numPages };
  } catch (error) {
    console.error('Error extracting PDF text:', error);
    throw new Error('Failed to extract text from PDF');
  }
}
