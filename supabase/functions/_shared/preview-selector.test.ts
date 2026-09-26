import { describe, expect, it } from 'vitest';
import { contentFingerprint, selectPremiumPreview, type CatalogFinding } from './preview-selector';
const finding = (kind: CatalogFinding['kind'], path: string, extra: Partial<CatalogFinding> = {}): CatalogFinding => ({
  kind, source_path: path, content: path, confidence: null, magnitude_normalized: null,
  observed_at: null, visibility_hint: 'premium', ...extra,
});
const select = (findings: CatalogFinding[], extra = {}) => selectPremiumPreview({ findings,
  floorKeys: ['headline', 'key_findings'], floorPaths: new Set<string>(),
  floorContentFingerprints: new Set<string>(), abnormalOrSafetyPaths: new Set<string>(),
  ineligiblePaths: new Set<string>(), ...extra });

describe('deterministic preview selection', () => {
  it('snapshots kind priority and remaining counts', () => {
    const result = select([finding('lifestyle','/c'), finding('cross_marker','/b'), finding('trend','/a'), finding('trend','/d')]);
    expect(result).toMatchInlineSnapshot(`
      {
        "locked": {
          "cross_report": 1,
          "lifestyle": 1,
          "patterns": 1,
        },
        "preview": {
          "confidence": null,
          "content": "/a",
          "kind": "trend",
          "magnitude_normalized": null,
          "observed_at": null,
          "source_path": "/a",
          "visibility_hint": "premium",
        },
      }
    `);
  });
  it.each([
    ['confidence', { confidence: 0.8 }, { confidence: 0.7 }],
    ['zero vs null', { confidence: 0 }, { confidence: null }],
    ['magnitude', { magnitude_normalized: 2 }, { magnitude_normalized: 1 }],
    ['negative vs null', { magnitude_normalized: -1 }, { magnitude_normalized: null }],
    ['recency', { observed_at: '2026-09-26' }, { observed_at: '2026-09-25' }],
    ['invalid values', { confidence: 0, observed_at: '2026-09-26' }, { confidence: NaN, observed_at: 'bad' }],
  ])('orders %s descending with nulls last', (_label, good, bad) => {
    expect(select([finding('trend','/a',bad), finding('trend','/z',good)]).preview?.source_path).toBe('/z');
  });
  it('excludes floor, unsafe, unproven, malformed, narrative and duplicates', () => {
    const result = select([
      finding('trend','/headline'), finding('trend','/key_findings/0'), finding('floor','/floor'),
      finding('trend','/floor_alias',{ content: 'floor copy' }), finding('trend','/safety/0'),
      finding('lifestyle','/unproven'), finding('narrative','/narrative'), finding('trend','bad'),
      finding('trend','/basic',{ visibility_hint: 'basic' }),
      finding('cross_marker','/b',{ content: { x: 1, y: 2 } }), finding('cross_marker','/a',{ content: { y: 2, x: 1 } }),
    ], { floorContentFingerprints: new Set([contentFingerprint('floor copy')]),
      abnormalOrSafetyPaths: new Set(['/safety']), ineligiblePaths: new Set(['/unproven']) });
    expect(result.preview?.source_path).toBe('/a');
    expect(result.locked).toEqual({ patterns: 0, cross_report: 0, lifestyle: 0 });
  });
  it('is immutable and stable across permutations and exact ties', () => {
    const entries = [finding('trend','/b'), finding('trend','/a')];
    const before = structuredClone(entries);
    expect(select(entries)).toEqual(select([...entries].reverse()));
    expect(entries).toEqual(before);
    expect(select([])).toMatchInlineSnapshot(`
      {
        "locked": {
          "cross_report": 0,
          "lifestyle": 0,
          "patterns": 0,
        },
        "preview": null,
      }
    `);
  });
});
