/**
 * Renders a synthetic lab text as a page image for the OCR part of the eval
 * (RV-MM1 AC8, AC15), behind a port so the offline tests use a fake. The real
 * renderer lazily imports chromium from @playwright/test; without an installed
 * browser the OCR cases are SKIPPED (`npx playwright install chromium`) and the
 * other uses still run. The page is built from the text alone and every
 * request it might make is aborted, so rendering never touches the network.
 */
import type { Browser } from '@playwright/test';
import type { RenderMode } from './fixtures';

export interface Renderer {
  /** The text as a page: a PNG data URL, or a degraded (slightly rotated, lossy) JPEG one. */
  render(text: string, mode: RenderMode): Promise<string>;
  close(): Promise<void>;
}

export const INSTALL_HINT = 'npx playwright install chromium';

/** No browser to render with: the OCR cases are skipped. */
export class RendererUnavailable extends Error {}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

export function pageHtml(text: string, mode: RenderMode): string {
  const tilt = mode === 'jpeg-degraded' ? ' transform: rotate(1.2deg); transform-origin: 20% 10%;' : '';
  return '<!doctype html><html><head><meta charset="utf-8"><style>'
    + 'html, body { margin: 0; background: #fff; }'
    + ` pre { margin: 0; padding: 40px 56px; font: 17px/1.45 "Courier New", Courier, monospace; color: #111; white-space: pre;${tilt} }`
    + `</style></head><body><pre>${text.replace(/[&<>"]/g, ch => ESCAPES[ch]!)}</pre></body></html>`;
}

/** JPEG quality of the degraded page. */
export const DEGRADED_JPEG_QUALITY = 40;

export function playwrightRenderer(): Renderer {
  let browser: Promise<Browser> | null = null;
  const launch = async (): Promise<Browser> => {
    try {
      const { chromium } = await import('@playwright/test');
      return await chromium.launch({ headless: true });
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error';
      throw new RendererUnavailable(`no Chromium to render the OCR pages (${name}); run: ${INSTALL_HINT}`);
    }
  };
  return {
    async render(text, mode) {
      browser ??= launch();
      const page = await (await browser).newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 });
      try {
        await page.route('**/*', route => route.abort());
        await page.setContent(pageHtml(text, mode), { waitUntil: 'load' });
        const image = mode === 'png'
          ? await page.screenshot({ fullPage: true, type: 'png' })
          : await page.screenshot({ fullPage: true, type: 'jpeg', quality: DEGRADED_JPEG_QUALITY });
        return `data:image/${mode === 'png' ? 'png' : 'jpeg'};base64,${image.toString('base64')}`;
      } finally {
        await page.close();
      }
    },
    async close() {
      const open = browser ? await browser.catch(() => null) : null;
      await open?.close();
    },
  };
}
