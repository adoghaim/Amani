/**
 * The lab-extraction contract (packet IB1; review F093, F114, F026): what the
 * app may send parse-lab-report-ocr, and the rows parse-lab-report-ocr and
 * extract-biomarkers send back.
 *
 * Both functions build ExtractedAnalyte rows, named like report_analytes.
 * parse-lab-report-ocr answers with them as `items`. extract-biomarkers answers
 * with them as `analytes`, and as `items` mapped by toExtractedItem to the
 * names the app's ReportItem (src/utils/parser/types.ts) and its save read.
 * The app maps OCR rows with the same toExtractedItem before review
 * (src/pages/NewReport.tsx). Unmapped, the save found no value_text or
 * normalized_reference_* on an OCR row and stored the lab's printed value
 * text, range and comparator as null, so the report of every photo upload said
 * her lab printed no range.
 *
 * Plain TypeScript: no Deno, npm or DOM import, so Vitest, Deno and Vite can
 * all load it.
 */

import { censoredPlaceholder } from "./censored-value.ts";

/** One extracted result, named like its report_analytes row. */
export interface ExtractedAnalyte {
  raw_name: string;
  raw_value_text: string | null;
  value_numeric: number;
  unit: string | null;
  raw_reference_range: string | null;
  normalized_min: number | null;
  normalized_max: number | null;
  normalized_operator: string | null;
  normalized_operator_value: number | null;
  source_snippet: string | null;
  confidence_score: "high" | "medium" | "low";
  canonical_analyte_id: string | null;
  canonical_slug: string | null;
  parse_status: "mapped" | "partial" | "unmapped";
  needs_review: boolean;
  is_core: boolean;
  category: string | null;
}

/** The same result under the app's ReportItem names. */
export interface ExtractedItem {
  raw_name: string;
  canonical_slug: string | null;
  category: string | null;
  value_numeric: number;
  value_text: string | null;
  unit: string | null;
  raw_reference_range: string | null;
  normalized_reference_min: number | null;
  normalized_reference_max: number | null;
  reference_operator: string | null;
  reference_operator_value: number | null;
  confidence_score: "high" | "medium" | "low";
  needs_review: boolean;
  is_core_biomarker: boolean;
  source_snippet: string | null;
}

/*
  Both functions copy these fields from the model's JSON as it typed them, so
  a row can carry value_text 5.2 or a bound "0.45". The save calls .trim() on
  value_text, and a bound that is not a finite number must not place a value.
*/
const textOrNull = (v: unknown): string | null =>
  typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : null;
const finiteOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** The one mapping between the two names, field for field. */
export function toExtractedItem(a: ExtractedAnalyte): ExtractedItem {
  return {
    raw_name: a.raw_name,
    canonical_slug: a.canonical_slug,
    category: a.category,
    value_numeric: a.value_numeric,
    value_text: textOrNull(a.raw_value_text),
    unit: a.unit,
    raw_reference_range: a.raw_reference_range,
    normalized_reference_min: finiteOrNull(a.normalized_min),
    normalized_reference_max: finiteOrNull(a.normalized_max),
    reference_operator: typeof a.normalized_operator === "string" ? a.normalized_operator : null,
    reference_operator_value: finiteOrNull(a.normalized_operator_value),
    confidence_score: a.confidence_score,
    needs_review: a.needs_review,
    is_core_biomarker: a.is_core,
    source_snippet: a.source_snippet,
  };
}

/*
  RV-PX2 A1 (#175 Handoff 3): a model row whose value_text is censored ("<0.5",
  "> OR = 60", "≤8", "<OR=150", "≥ OR = 100") stores the placeholder for that
  text, whatever number the model typed: 0, null or its own. parse-lab-report-ocr's
  own regex read only "<", ">", "<=" and ">=", and only when the model typed 0
  or nothing. Any other row keeps the model's number. extract-biomarkers reads
  its rows the same way.
*/
export function withCensoredPlaceholder<T extends { value_numeric?: number | null; value_text?: unknown }>(item: T): T {
  const placeholder = censoredPlaceholder(item.value_text);
  return placeholder === null ? item : { ...item, value_numeric: placeholder };
}

/** Images per parse-lab-report-ocr call. */
export const MAX_IMAGES = 10;
/** Characters per image data URL: about 5 MB of image. */
export const MAX_BASE64_LENGTH = 7_000_000;

/*
  parse-lab-report-ocr forwards each image to OpenAI as an image_url, which
  also accepts a remote URL. Only what the app itself sends may pass: a base64
  PNG or JPEG data URL, from FileReader.readAsDataURL (a chosen or captured
  photo) or canvas.toDataURL("image/jpeg") (a rendered PDF page).
*/
const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

/** The answer to an unusable `base64Images`, or null to go on. Never echoes the input. */
export function ocrImagesRefusal(images: unknown): { status: number; body: { error: string; code: string } } | null {
  if (!Array.isArray(images) || images.length === 0) {
    return { status: 400, body: { error: "base64Images array is required", code: "images_required" } };
  }
  if (images.length > MAX_IMAGES) {
    return { status: 413, body: { error: `Too many images (max ${MAX_IMAGES})`, code: "too_many_images" } };
  }
  for (const image of images) {
    if (typeof image === "string" && image.length > MAX_BASE64_LENGTH) {
      return { status: 413, body: { error: "Image too large (max ~5MB per image)", code: "image_too_large" } };
    }
    if (typeof image !== "string" || !IMAGE_DATA_URL.test(image)) {
      return { status: 400, body: { error: "Each image must be a PNG or JPEG data URL", code: "image_unsupported" } };
    }
  }
  return null;
}
