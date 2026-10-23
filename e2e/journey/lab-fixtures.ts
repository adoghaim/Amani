import { deflateSync } from 'node:zlib';

/*
  Synthetic lab uploads for the PK-03e-I journey. Never real patient files.
  Values, units and printed intervals mirror the claim-authority testkit
  (supabase/functions/_shared/claim-authority.testkit.ts: TSH 6 -> 9 mIU/L,
  ferritin 25 -> 30 ng/mL, synthetic 0-100 printed intervals), whose trend and
  claim behaviour is already proven by Vitest; nothing clinical is authored here.
*/

export interface SyntheticUpload {
  label: string;
  reportDate: string;
  tsh: number;
  ferritin: number;
  png: Buffer;
}

function crc32(buffer: Buffer): number {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A valid 1x1 PNG whose pixel encodes `seed`, so each upload is a distinct image. */
export function syntheticPng(seed: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const pixel = Buffer.from([0, seed & 0xff, (seed >> 8) & 0xff, 0x5a]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(pixel)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const dataUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;

const upload = (seed: number, label: string, reportDate: string, tsh: number, ferritin: number): SyntheticUpload =>
  ({ label, reportDate, tsh, ferritin, png: syntheticPng(seed) });

/** Five draws: two trend pairs and a Premium fallback, so the fourth upload meets an exhausted introductory ledger. */
export const UPLOADS = [
  upload(1, 'synthetic-lab-a', '2026-01-05', 6, 25),
  upload(2, 'synthetic-lab-b', '2026-04-05', 9, 30),
  upload(3, 'synthetic-lab-c', '2026-07-05', 6, 25),
  upload(4, 'synthetic-lab-d', '2026-09-05', 9, 30),
  upload(5, 'synthetic-lab-e', '2026-10-05', 6, 25),
] as const;

/** parse-lab-report-ocr's `items` (ReportAnalyte) for one upload, field for field. */
export function ocrItems(u: SyntheticUpload) {
  const row = (rawName: string, slug: string, value: number, unit: string) => ({
    raw_name: rawName, raw_value_text: String(value), value_numeric: value, unit,
    raw_reference_range: '0-100', normalized_min: 0, normalized_max: 100,
    normalized_operator: null, normalized_operator_value: null,
    source_snippet: `${rawName} ${value} ${unit} 0-100`, confidence_score: 'high',
    canonical_analyte_id: null, canonical_slug: slug, parse_status: 'mapped', needs_review: false,
    is_core: true, category: null,
  });
  return [row('TSH', 'tsh', u.tsh, 'mIU/L'), row('Ferritin', 'ferritin', u.ferritin, 'ng/mL')];
}
