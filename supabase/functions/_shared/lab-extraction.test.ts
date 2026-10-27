import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MAX_BASE64_LENGTH, MAX_IMAGES, ocrImagesRefusal, toExtractedItem, type ExtractedAnalyte,
} from './lab-extraction.ts';

/*
  IB1: the lab-extraction contract. Review F093 and F114 (OCR rows reach the
  save under the names it reads) and F026 (only the app's own image data URLs
  reach OpenAI). Synthetic rows and pixels only.
*/

const censored: ExtractedAnalyte = {
  raw_name: 'TSH', raw_value_text: '<0.5', value_numeric: 0.25, unit: 'uIU/mL',
  raw_reference_range: '0.45-4.5', normalized_min: 0.45, normalized_max: 4.5,
  normalized_operator: null, normalized_operator_value: null, source_snippet: 'TSH <0.5 uIU/mL 0.45-4.5',
  confidence_score: 'high', canonical_analyte_id: '00000000-0000-4000-a000-0000000000a1', canonical_slug: 'tsh',
  parse_status: 'mapped', needs_review: false, is_core: true, category: 'thyroid',
};
const comparator: ExtractedAnalyte = {
  raw_name: 'LDL Cholesterol', raw_value_text: '112', value_numeric: 112, unit: 'mg/dL',
  raw_reference_range: '<100', normalized_min: null, normalized_max: null,
  normalized_operator: '<', normalized_operator_value: 100, source_snippet: null,
  confidence_score: 'medium', canonical_analyte_id: null, canonical_slug: null,
  parse_status: 'unmapped', needs_review: true, is_core: false, category: null,
};

describe('toExtractedItem: one row under the names the app saves (F093, F114)', () => {
  it('carries the printed value text, the interval and every other field', () => {
    expect(toExtractedItem(censored)).toEqual({
      raw_name: 'TSH', canonical_slug: 'tsh', category: 'thyroid', value_numeric: 0.25, value_text: '<0.5',
      unit: 'uIU/mL', raw_reference_range: '0.45-4.5', normalized_reference_min: 0.45, normalized_reference_max: 4.5,
      reference_operator: null, reference_operator_value: null, confidence_score: 'high', needs_review: false,
      is_core_biomarker: true, source_snippet: 'TSH <0.5 uIU/mL 0.45-4.5',
    });
  });

  it('carries a comparator range as its operator and bound', () => {
    expect(toExtractedItem(comparator)).toMatchObject({
      value_text: '112', raw_reference_range: '<100', normalized_reference_min: null, normalized_reference_max: null,
      reference_operator: '<', reference_operator_value: 100, confidence_score: 'medium', needs_review: true,
      is_core_biomarker: false,
    });
  });

  it('coerces the renamed fields from untrusted model output: text to a string, bounds to finite numbers', () => {
    // The model can type any JSON value; the app calls .trim() on value_text at save.
    const loose = {
      ...censored, raw_value_text: 5.2, normalized_min: '0.45', normalized_max: Number.NaN,
      normalized_operator: 7, normalized_operator_value: '100',
    } as unknown as ExtractedAnalyte;
    expect(toExtractedItem(loose)).toMatchObject({
      value_text: '5.2', normalized_reference_min: null, normalized_reference_max: null,
      reference_operator: null, reference_operator_value: null,
    });
    const absent = { ...censored, raw_value_text: undefined, normalized_operator: undefined } as unknown as ExtractedAnalyte;
    expect(toExtractedItem(absent)).toMatchObject({ value_text: null, reference_operator: null });
  });

  it('keeps the key order extract-biomarkers answered with before it used this mapping', () => {
    expect(Object.keys(toExtractedItem(censored))).toEqual([
      'raw_name', 'canonical_slug', 'category', 'value_numeric', 'value_text', 'unit', 'raw_reference_range',
      'normalized_reference_min', 'normalized_reference_max', 'reference_operator', 'reference_operator_value',
      'confidence_score', 'needs_review', 'is_core_biomarker', 'source_snippet',
    ]);
  });
});

// Valid base64 of a few synthetic bytes, as FileReader and canvas.toDataURL emit it.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1Pe';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

describe('ocrImagesRefusal: only PNG or JPEG data URLs reach OpenAI (F026)', () => {
  it('lets the app\'s own images through: a chosen photo, a camera capture, rendered PDF pages', () => {
    expect(ocrImagesRefusal([PNG])).toBeNull();
    expect(ocrImagesRefusal([JPEG])).toBeNull();
    expect(ocrImagesRefusal(Array.from({ length: MAX_IMAGES }, (_, i) => (i % 2 ? PNG : JPEG)))).toBeNull();
    const largest = `data:image/jpeg;base64,${'A'.repeat(MAX_BASE64_LENGTH - 'data:image/jpeg;base64,'.length)}`;
    expect(largest).toHaveLength(MAX_BASE64_LENGTH);
    expect(ocrImagesRefusal([largest])).toBeNull();
  });

  it.each([
    ['a remote https URL', 'https://example.invalid/lab-page.png'],
    ['a remote http URL', 'http://127.0.0.1/lab-page.png'],
    ['a protocol-relative URL', '//example.invalid/lab-page.png'],
    ['an SVG data URL', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['a GIF data URL', 'data:image/gif;base64,R0lGODlhAQABAAAAACw='],
    ['a WebP data URL', 'data:image/webp;base64,UklGRhIAAABXRUJQ'],
    ['an HTML data URL', 'data:text/html;base64,PGgxPmhpPC9oMT4='],
    ['a data URL that is not base64', 'data:image/png,%89PNG%0D%0A'],
    ['an empty payload', 'data:image/png;base64,'],
    ['a payload with a quote', 'data:image/png;base64,iVBORw0K"GgoAAAA'],
    ['a payload with a space', 'data:image/png;base64,iVBORw0K GgoAAAA'],
    ['a second line after the payload', `${PNG}\nhttps://example.invalid/lab-page.png`],
    ['a data URL inside other text', ` ${PNG}`],
  ])('refuses %s with a fixed 400', (_label, image) => {
    const refusal = ocrImagesRefusal([PNG, image]);
    expect(refusal).toEqual({ status: 400, body: { error: 'Each image must be a PNG or JPEG data URL', code: 'image_unsupported' } });
    expect(JSON.stringify(refusal)).not.toContain(image.trim());
  });

  it.each([[null], [42], [{ url: PNG }], [['nested']]])('refuses a non-string entry (%j)', entry => {
    expect(ocrImagesRefusal([entry])).toMatchObject({ status: 400, body: { code: 'image_unsupported' } });
  });

  it('refuses a missing or empty list', () => {
    for (const images of [undefined, null, [], PNG, { 0: PNG, length: 1 }]) {
      expect(ocrImagesRefusal(images)).toEqual({ status: 400, body: { error: 'base64Images array is required', code: 'images_required' } });
    }
  });

  it('refuses more than MAX_IMAGES images, and any image over MAX_BASE64_LENGTH characters', () => {
    expect(ocrImagesRefusal(Array.from({ length: MAX_IMAGES + 1 }, () => PNG)))
      .toEqual({ status: 413, body: { error: `Too many images (max ${MAX_IMAGES})`, code: 'too_many_images' } });
    const oversized = `data:image/png;base64,${'A'.repeat(MAX_BASE64_LENGTH)}`;
    expect(ocrImagesRefusal([PNG, oversized]))
      .toEqual({ status: 413, body: { error: 'Image too large (max ~5MB per image)', code: 'image_too_large' } });
  });
});

/*
  The Deno handlers cannot be imported here (npm:/jsr: specifiers, Deno
  globals), so, as ai-guards-wiring.test.ts does, read their source and pin
  the wiring this module relies on.
*/
const source = (fn: string) => readFileSync(new URL(`../${fn}/index.ts`, import.meta.url), 'utf8');

describe('wiring: both functions answer with this contract', () => {
  it.each(['parse-lab-report-ocr', 'extract-biomarkers'])('%s takes its row type from lab-extraction.ts and declares none of its own', fn => {
    const text = source(fn);
    expect(text).toMatch(/type ExtractedAnalyte as ReportAnalyte \} from "\.\.\/_shared\/lab-extraction\.ts";/);
    expect(text).not.toMatch(/interface ReportAnalyte\b/);
  });

  it('extract-biomarkers answers `items` mapped by toExtractedItem', () => {
    const text = source('extract-biomarkers');
    expect(text).toContain('const legacyItems = validatedAnalytes.map(toExtractedItem);');
    expect(text).toMatch(/JSON\.stringify\(\{ items: legacyItems, analytes: validatedAnalytes, coverage \}\)/);
  });

  it('parse-lab-report-ocr refuses unusable images before any of them goes into the model request', () => {
    const text = source('parse-lab-report-ocr');
    const refusal = text.indexOf('const imagesRefused = ocrImagesRefusal(base64Images);');
    expect(refusal).toBeGreaterThan(-1);
    const forwarded = text.indexOf('image_url: { url: b64 }');
    expect(forwarded).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(forwarded);
    expect(text).toMatch(/if \(imagesRefused\) \{\s*return new Response\(JSON\.stringify\(imagesRefused\.body\), \{\s*status: imagesRefused\.status,/);
    // The inline checks it replaced, which let any string through.
    expect(text).not.toMatch(/typeof b64 !== "string"/);
  });
});
