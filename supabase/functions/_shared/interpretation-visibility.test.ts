import { describe, expect, it } from 'vitest';
import { buildBasicProjection } from './interpretation-visibility';
import { FLOOR_FINDING_KEYS, FLOOR_REQUIRED_KEYS, findFloorViolations } from './response-shaping';
import type { CatalogFinding } from './preview-selector';
import { addFindingMetadata } from './finding-metadata';

const full = { headline: 'headline', cycle_context: {}, questions_for_doctor: ['doctor'], disclaimer: 'disclaimer',
  key_findings: [{ status: 'high', title: 'visible abnormal' }],
  pattern_signals: ['preview body', 'LOCKED_SECRET'], unknown: 'UNKNOWN_SECRET',
  nested: [{ abnormal: true, text: 'safety flag' }], what_to_do_next: ['clinical follow-up'] };
const catalog: CatalogFinding[] = full.pattern_signals.map((content, index) => ({
  content, source_path: `/pattern_signals/${index}`, kind: 'cross_marker', confidence: 1 - index,
  magnitude_normalized: null, observed_at: null, visibility_hint: 'premium', preview_eligible: true,
}));

describe('Basic projection boundary', () => {
  it('retains the floor, one preview and counts; no hidden bodies anywhere', () => {
    const result = buildBasicProjection({ ...full, findings: catalog });
    for (const key of [...FLOOR_FINDING_KEYS, ...FLOOR_REQUIRED_KEYS]) expect(result).toHaveProperty(key);
    expect(findFloorViolations(result)).toEqual([]);
    expect(result.key_findings).toEqual(full.key_findings);
    expect(result.safety_findings).toEqual(full.nested);
    expect(result.what_to_do_next).toEqual(full.what_to_do_next);
    expect(result.preview).toEqual(catalog[0]);
    expect(result.locked).toEqual({ patterns: 1, cross_report: 0, lifestyle: 0 });
    expect(JSON.stringify(result)).not.toMatch(/LOCKED_SECRET|UNKNOWN_SECRET/);
    expect(result).not.toHaveProperty('findings');
  });
  it('rejects forged provenance, floor duplicates and unclassified prose', () => {
    const data = { ...full, pattern_signals: ['doctor', 'opaque prose'] };
    const findings = catalog.map((f, i) => ({ ...f, content: data.pattern_signals[i], preview_eligible: i === 0 }));
    expect(buildBasicProjection(data, findings).preview).toBeNull();
    expect(buildBasicProjection(data, catalog).preview).toBeNull();
  });
  it('does not manufacture a preview from the legacy catalog', () => {
    const basic = buildBasicProjection(addFindingMetadata({ ...full, overall_interpretation: 'abnormal explanation' }, { hasPriorComparison: true }));
    expect(basic.preview).toBeNull();
    expect(basic.overall_interpretation).toBe('abnormal explanation');
  });
  it('supplies a floor-only projection for unknown/missing provenance', () => {
    const result = buildBasicProjection({ unknown: 'DO_NOT_RETURN' });
    expect(findFloorViolations(result)).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('DO_NOT_RETURN');
    expect(result.preview).toBeNull();
  });
  it('promotes safety entries and keeps them out of counts and previews', () => {
    const payload = { ...full, pattern_signals: [{ safety_related: true, text: 'call clinician' }] };
    const result = buildBasicProjection(payload, [{ ...catalog[0], content: payload.pattern_signals[0] }]);
    expect(result.safety_findings).toContainEqual(payload.pattern_signals[0]);
    expect(result.preview).toBeNull();
    expect(result.locked).toEqual({ patterns: 0, cross_report: 0, lifestyle: 0 });
  });
});
