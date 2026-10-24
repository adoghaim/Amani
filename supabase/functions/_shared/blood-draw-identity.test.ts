import { describe, expect, it } from 'vitest';
import {
  deriveBloodDrawIdentity,
  extractDrawEvidence,
  fingerprintAnalytes,
  hashDrawKey,
  type DrawEvidence,
} from './blood-draw-identity';

/**
 * The evidence hierarchy is what stops Introductory Deep Access being either
 * trivially farmable (a new credit per upload) or wrongly denied (two real
 * draws on one day merged into one). Both failure directions are tested.
 */

const REPORT_ID = '3f1c2b7a-0000-4000-8000-000000000001';
const OTHER_REPORT_ID = '3f1c2b7a-0000-4000-8000-000000000002';

const full: DrawEvidence = {
  accessionId: 'AB12345678',
  labIdentity: 'quest',
  collectionDateTime: '2026-08-14T09:30',
  collectionDate: '2026-08-14',
};

describe('deriveBloodDrawIdentity — evidence hierarchy', () => {
  it('prefers the accession id above everything else', () => {
    const id = deriveBloodDrawIdentity(full, { reportId: REPORT_ID, contentHash: 'abc' });
    expect(id.tier).toBe('accession');
    expect(id.key).toBe('acc:quest:AB12345678');
    expect(id.identified).toBe(true);
  });

  it('falls to lab + collection datetime when there is no accession', () => {
    const id = deriveBloodDrawIdentity(
      { ...full, accessionId: null },
      { reportId: REPORT_ID, contentHash: 'abc' },
    );
    expect(id.tier).toBe('lab_collection_datetime');
    expect(id.key).toBe('dt:quest:2026-08-14T09:30');
  });

  it('falls to lab + collection date when there is no time', () => {
    const id = deriveBloodDrawIdentity(
      { ...full, accessionId: null, collectionDateTime: null },
      { reportId: REPORT_ID, contentHash: 'abc' },
    );
    expect(id.tier).toBe('lab_collection_date');
    expect(id.key).toBe('d:quest:2026-08-14');
  });

  it('falls to the content hash when no collection evidence survives', () => {
    const id = deriveBloodDrawIdentity(
      { accessionId: null, labIdentity: 'quest', collectionDateTime: null, collectionDate: null },
      { reportId: REPORT_ID, contentHash: 'DEADBEEF' },
    );
    expect(id.tier).toBe('content_hash');
    expect(id.key).toBe('sha256:deadbeef');
    expect(id.identified).toBe(false);
  });

  it('falls to the report id when there is nothing at all', () => {
    const id = deriveBloodDrawIdentity(null, { reportId: REPORT_ID });
    expect(id.tier).toBe('unidentified');
    expect(id.key).toBe(`report:${REPORT_ID}`);
    expect(id.identified).toBe(false);
  });

  it('uses an unknown lab rather than dropping to a weaker tier', () => {
    const id = deriveBloodDrawIdentity(
      { accessionId: null, labIdentity: null, collectionDateTime: '2026-08-14T09:30', collectionDate: null },
      { reportId: REPORT_ID },
    );
    expect(id.tier).toBe('lab_collection_datetime');
    expect(id.key).toBe('dt:unknown:2026-08-14T09:30');
  });
});

describe('deriveBloodDrawIdentity — ambiguity resolves in the user\'s favour', () => {
  it('mints a distinct key per report when identity cannot be established', () => {
    // Under-identification must count as a NEW draw, so the user stays eligible
    // rather than being folded into an earlier draw and denied.
    const a = deriveBloodDrawIdentity(null, { reportId: REPORT_ID });
    const b = deriveBloodDrawIdentity(null, { reportId: OTHER_REPORT_ID });
    expect(a.key).not.toBe(b.key);
  });

  it('reuses the same key when the same report is regenerated', () => {
    const a = deriveBloodDrawIdentity(null, { reportId: REPORT_ID });
    const b = deriveBloodDrawIdentity(null, { reportId: REPORT_ID });
    expect(a.key).toBe(b.key);
  });

  it('collapses two same-day draws at one lab onto one key', () => {
    /*
      Over-identification. This is a real collision the date-only tier can
      produce, and it is deliberately left in: introductory-access.ts grants
      any already-claimed draw for free, so the second draw is served without
      spending the second credit. More access, never less.
    */
    const morning = deriveBloodDrawIdentity(
      { labIdentity: 'labcorp', collectionDate: '2026-08-14' },
      { reportId: REPORT_ID },
    );
    const afternoon = deriveBloodDrawIdentity(
      { labIdentity: 'labcorp', collectionDate: '2026-08-14' },
      { reportId: OTHER_REPORT_ID },
    );
    expect(morning.key).toBe(afternoon.key);
  });

  it('keeps two same-day draws apart once a time is available', () => {
    const morning = deriveBloodDrawIdentity(
      { labIdentity: 'labcorp', collectionDateTime: '2026-08-14T08:15' },
      { reportId: REPORT_ID },
    );
    const afternoon = deriveBloodDrawIdentity(
      { labIdentity: 'labcorp', collectionDateTime: '2026-08-14T16:40' },
      { reportId: OTHER_REPORT_ID },
    );
    expect(morning.key).not.toBe(afternoon.key);
  });
});

describe('deriveBloodDrawIdentity — never consults client-editable fields', () => {
  it('ignores anything resembling report_date passed in by mistake', () => {
    const withJunk = {
      ...full,
      accessionId: null,
      collectionDateTime: null,
      collectionDate: null,
      // report_date is client-writable, so it must not influence entitlement.
      report_date: '2026-01-01',
    } as unknown as DrawEvidence;

    const id = deriveBloodDrawIdentity(withJunk, { reportId: REPORT_ID });
    expect(id.tier).toBe('unidentified');
    expect(id.key).not.toContain('2026-01-01');
  });
});

describe('extractDrawEvidence — accession identifiers', () => {
  it('reads a Quest specimen id', () => {
    const ev = extractDrawEvidence('Quest Diagnostics\nSpecimen ID: AB12345678\n');
    expect(ev.accessionId).toBe('AB12345678');
    expect(ev.labIdentity).toBe('quest');
  });

  it('reads a LabCorp accession number', () => {
    const ev = extractDrawEvidence('LabCorp\nAccession Number: 1234567890\n');
    expect(ev.accessionId).toBe('1234567890');
    expect(ev.labIdentity).toBe('labcorp');
  });

  it('reads order and requisition forms', () => {
    expect(extractDrawEvidence('Order Number: X99881122').accessionId).toBe('X99881122');
    expect(extractDrawEvidence('Requisition #: 55512345').accessionId).toBe('55512345');
  });

  it('normalizes separators and case', () => {
    expect(extractDrawEvidence('Specimen ID: ab-123-456').accessionId).toBe('AB123456');
  });

  it('rejects placeholders that are not identifiers', () => {
    // A wrong accession is worse than none — it fabricates a distinct draw.
    expect(extractDrawEvidence('Specimen ID: PENDING').accessionId).toBeNull();
    expect(extractDrawEvidence('Accession Number: 000000').accessionId).toBeNull();
    expect(extractDrawEvidence('Specimen ID: A1').accessionId).toBeNull();
  });

  it('returns nulls for empty or non-string input', () => {
    expect(extractDrawEvidence('').accessionId).toBeNull();
    expect(extractDrawEvidence(null).labIdentity).toBeNull();
    expect(extractDrawEvidence(undefined).collectionDate).toBeNull();
  });
});

describe('extractDrawEvidence — collection date and time', () => {
  it('reads US date with 24-hour time', () => {
    const ev = extractDrawEvidence('Collected: 08/14/2026 09:30');
    expect(ev.collectionDateTime).toBe('2026-08-14T09:30');
  });

  it('reads a PM meridiem', () => {
    const ev = extractDrawEvidence('Collected: 8/14/2026 4:05 PM');
    expect(ev.collectionDateTime).toBe('2026-08-14T16:05');
  });

  it('treats 12 AM as midnight and 12 PM as noon', () => {
    expect(extractDrawEvidence('Collected: 8/14/2026 12:00 AM').collectionDateTime)
      .toBe('2026-08-14T00:00');
    expect(extractDrawEvidence('Collected: 8/14/2026 12:00 PM').collectionDateTime)
      .toBe('2026-08-14T12:00');
  });

  it('expands a two-digit year into this century', () => {
    const ev = extractDrawEvidence('Collection Date/Time: 8/14/26 09:30');
    expect(ev.collectionDateTime).toBe('2026-08-14T09:30');
  });

  it('reads an ISO collection date', () => {
    const ev = extractDrawEvidence('Specimen Collected: 2026-08-14 09:30');
    expect(ev.collectionDateTime).toBe('2026-08-14T09:30');
  });

  it('falls back to a date when no time is printed', () => {
    const ev = extractDrawEvidence('Date Collected: 08/14/2026');
    expect(ev.collectionDateTime).toBeNull();
    expect(ev.collectionDate).toBe('2026-08-14');
  });

  it('reads "Drawn"', () => {
    expect(extractDrawEvidence('Drawn: 08/14/2026').collectionDate).toBe('2026-08-14');
  });

  it('ignores reported, received and printed dates', () => {
    // Two reports from one draw can disagree on these; only collection is stable.
    const ev = extractDrawEvidence('Reported: 08/20/2026\nReceived: 08/15/2026\nPrinted: 08/21/2026');
    expect(ev.collectionDate).toBeNull();
    expect(ev.collectionDateTime).toBeNull();
  });

  it('rejects an impossible date rather than guessing', () => {
    expect(extractDrawEvidence('Collected: 13/45/2026').collectionDate).toBeNull();
  });

  it('only scans the header, not a full history section', () => {
    const header = 'Quest Diagnostics\nCollected: 08/14/2026 09:30\n';
    const noise = 'x'.repeat(9000);
    const ev = extractDrawEvidence(`${header}${noise}Collected: 01/02/2020 08:00`);
    expect(ev.collectionDateTime).toBe('2026-08-14T09:30');
  });
});

describe('hashDrawKey', () => {
  it('produces a stable 64-character hex digest', async () => {
    const a = await hashDrawKey('acc:quest:AB12345678');
    const b = await hashDrawKey('acc:quest:AB12345678');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('separates different keys', async () => {
    const a = await hashDrawKey('acc:quest:AB12345678');
    const b = await hashDrawKey('acc:quest:AB12345679');
    expect(a).not.toBe(b);
  });

  it('matches the check constraint the migration enforces', async () => {
    const digest = await hashDrawKey(`report:${REPORT_ID}`);
    // introductory_deep_access_claims_draw_id_is_sha256
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

/*
  RV-GI2 (F042): a file hash names the upload, not the values the interpretation
  is generated from, which the owner can write. The key is bound to a
  fingerprint of those rows, so the same bytes with other values, or an edited
  report, is another draw. Synthetic rows only.
*/
const tsh = {
  raw_name: 'TSH', canonical_slug: 'tsh', value_numeric: 2.1, raw_value_text: '2.1', unit: 'mIU/L',
  raw_reference_range: '0.4-4.0', normalized_min: 0.4, normalized_max: 4, normalized_operator: null,
  normalized_operator_value: null,
};
const ferritin = {
  raw_name: 'Ferritin', canonical_slug: 'ferritin', value_numeric: 18, raw_value_text: '18', unit: 'ng/mL',
  raw_reference_range: '16-154', normalized_min: 16, normalized_max: 154, normalized_operator: null,
  normalized_operator_value: null,
};
const crp = {
  raw_name: 'hs-CRP', canonical_slug: 'hs_crp', value_numeric: null, raw_value_text: '<0.5', unit: 'mg/L',
  raw_reference_range: '<3.0', normalized_min: null, normalized_max: 3, normalized_operator: '<',
  normalized_operator_value: 0.5,
};
const rows = [tsh, ferritin, crp];

describe('fingerprintAnalytes — RV-GI2', () => {
  it('is a stable 64-character hex digest', async () => {
    const a = await fingerprintAnalytes(rows);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await fingerprintAnalytes(rows)).toBe(a);
  });

  it('is the same for the same rows in any order', async () => {
    const a = await fingerprintAnalytes(rows);
    expect(await fingerprintAnalytes([crp, tsh, ferritin])).toBe(a);
    expect(await fingerprintAnalytes([ferritin, crp, tsh])).toBe(a);
  });

  it.each([
    ['raw_name', 'TSH 3rd generation'],
    ['canonical_slug', 'free_t4'],
    ['value_numeric', 2.2],
    ['raw_value_text', '2.10'],
    ['unit', 'uIU/mL'],
    ['raw_reference_range', '0.45-4.5'],
    ['normalized_min', 0.45],
    ['normalized_max', 4.5],
    ['normalized_operator', '>'],
    ['normalized_operator_value', 2.1],
  ])('changes when %s changes', async (field, value) => {
    const changed = await fingerprintAnalytes([{ ...tsh, [field]: value }, ferritin, crp]);
    expect(changed).not.toBe(await fingerprintAnalytes(rows));
  });

  it('ignores id, is_core and the review columns', async () => {
    const withOthers = rows.map((row, i) => ({
      ...row, id: `synthetic-${i}`, is_core: i === 0, review_status: 'confirmed', reviewed_at: '2026-10-24T00:00:00Z',
    }));
    expect(await fingerprintAnalytes(withOthers)).toBe(await fingerprintAnalytes(rows));
  });

  it('normalises value_numeric through Number: null and non-finite are null, and null is not zero', async () => {
    expect(await fingerprintAnalytes([{ ...tsh, value_numeric: '2.1' }])).toBe(await fingerprintAnalytes([tsh]));
    const missing = await fingerprintAnalytes([{ ...tsh, value_numeric: null }]);
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, undefined, 'not a number']) {
      expect(await fingerprintAnalytes([{ ...tsh, value_numeric: value }])).toBe(missing);
    }
    expect(await fingerprintAnalytes([{ ...tsh, value_numeric: 0 }])).not.toBe(missing);
  });

  it('counts a repeated row, and keeps each value inside its own field', async () => {
    expect(await fingerprintAnalytes([tsh, tsh])).not.toBe(await fingerprintAnalytes([tsh]));
    expect(await fingerprintAnalytes([])).not.toBe(await fingerprintAnalytes([tsh]));
    expect(await fingerprintAnalytes([{ ...tsh, raw_name: 'TSHtsh', canonical_slug: '' }]))
      .not.toBe(await fingerprintAnalytes([tsh]));
  });
});

describe('deriveBloodDrawIdentity — the analyte binding (RV-GI2)', () => {
  const FP = 'f'.repeat(64);

  it('binds the content-hash key to the analytes', () => {
    expect(deriveBloodDrawIdentity(null, { reportId: REPORT_ID, contentHash: 'DEADBEEF', analyteFingerprint: FP }))
      .toEqual({ key: `sha256:deadbeef:analytes:${FP}`, tier: 'content_hash', identified: false });
  });

  it('binds the per-report key to the analytes', () => {
    expect(deriveBloodDrawIdentity(null, { reportId: REPORT_ID, analyteFingerprint: FP }))
      .toEqual({ key: `report:${REPORT_ID}:analytes:${FP}`, tier: 'unidentified', identified: false });
  });

  it('without a fingerprint each key is exactly today\'s: the legacy key', () => {
    for (const analyteFingerprint of [undefined, null, '']) {
      expect(deriveBloodDrawIdentity(null, { reportId: REPORT_ID, contentHash: 'DEADBEEF', analyteFingerprint }))
        .toEqual(deriveBloodDrawIdentity(null, { reportId: REPORT_ID, contentHash: 'DEADBEEF' }));
      expect(deriveBloodDrawIdentity(null, { reportId: REPORT_ID, contentHash: 'DEADBEEF', analyteFingerprint }).key)
        .toBe('sha256:deadbeef');
      expect(deriveBloodDrawIdentity(null, { reportId: REPORT_ID, analyteFingerprint }).key).toBe(`report:${REPORT_ID}`);
    }
  });

  it('leaves the collection-evidence tiers unbound', () => {
    const options = { reportId: REPORT_ID, contentHash: 'abc', analyteFingerprint: FP };
    expect(deriveBloodDrawIdentity(full, options).key).toBe('acc:quest:AB12345678');
    expect(deriveBloodDrawIdentity({ ...full, accessionId: null }, options).key).toBe('dt:quest:2026-08-14T09:30');
    expect(deriveBloodDrawIdentity({ ...full, accessionId: null, collectionDateTime: null }, options).key)
      .toBe('d:quest:2026-08-14');
  });

  it('the same bytes with the same analytes is one draw; with other analytes it is another', async () => {
    const key = async (analytes: typeof rows, reportId: string) => hashDrawKey(deriveBloodDrawIdentity(null,
      { reportId, contentHash: 'abc', analyteFingerprint: await fingerprintAnalytes(analytes) }).key);
    expect(await key([crp, ferritin, tsh], OTHER_REPORT_ID)).toBe(await key(rows, REPORT_ID));
    expect(await key([{ ...tsh, value_numeric: 9 }, ferritin, crp], OTHER_REPORT_ID)).not.toBe(await key(rows, REPORT_ID));
    // Neither is the legacy key of those bytes.
    expect(await key(rows, REPORT_ID)).not.toBe(await hashDrawKey('sha256:abc'));
  });
});
