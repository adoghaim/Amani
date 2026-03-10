import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

export async function extractTextFromPDF(file: File): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = '';

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      interface TextItem {
        str: string;
        transform: number[];
        width: number;
        height: number;
      }

      const items = textContent.items as TextItem[];

      if (items.length === 0) continue;

      const sortedItems = [...items].sort((a, b) => {
        const yDiff = b.transform[5] - a.transform[5];
        if (Math.abs(yDiff) > 3) return yDiff;
        return a.transform[4] - b.transform[4];
      });

      let pageText = '';
      let prevY: number | null = null;
      let prevX: number | null = null;

      for (const item of sortedItems) {
        if (!item.str.trim()) continue;

        const x = item.transform[4];
        const y = item.transform[5];

        if (prevY !== null && Math.abs(y - prevY) > 3) {
          pageText += '\n';
        } else if (prevX !== null && x - prevX > 20) {
          pageText += '  ';
        }

        pageText += item.str;
        prevY = y;
        prevX = x + item.width;
      }

      fullText += pageText + '\n\n';
    }

    return fullText;
  } catch (error) {
    console.error('Error extracting PDF text:', error);
    throw new Error('Failed to extract text from PDF');
  }
}
