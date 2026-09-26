import { readFileSync } from "node:fs";
import { FINDING_STATUS } from "./tier";
import { selectPremiumPreview } from "./preview-selector";
import { describe, expect, it } from 'vitest';
import { buildBasicProjection, carriesSafety, PROJECTION_VERSION } from './interpretation-visibility';
import { FLOOR_FINDING_KEYS, FLOOR_REQUIRED_KEYS, findFloorViolations } from './response-shaping';
import type { CatalogFinding } from './preview-selector';
import { addFindingMetadata } from './finding-metadata';

const full = { headline: 'headline', cycle_context: {}, questions_for_doctor: ['doctor'], disclaimer: 'disclaimer',
  key_findings: [{ status: 'attention', title: 'visible abnormal' }],
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
    expect(result.safety_findings).toEqual([{ abnormal: true }]);
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
    expect(basic).not.toHaveProperty('overall_interpretation');
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
    expect(result.safety_findings).toEqual([{ safety_related: true }, { abnormal: true }]);
    expect(JSON.stringify(result)).not.toContain("call clinician");
    expect(result.preview).toBeNull();
    expect(result.locked).toEqual({ patterns: 0, cross_report: 0, lifestyle: 0 });
  });
});

// One prompt-shaped fixture is consumed by both Vitest and the SQL rehearsal.
const verifySql = readFileSync(new URL('../../migrations/__verification__/interpretation-visibility.verify.sql', import.meta.url), 'utf8');
const preludeSql = readFileSync(new URL('../../migrations/__verification__/interpretation-visibility.prelude.sql', import.meta.url), 'utf8');
const promptFixture = JSON.parse(preludeSql.match(/\$prompt_fixture\$([\s\S]*?)\$prompt_fixture\$/)![1]);
const expectedKeys: string[] = JSON.parse(verifySql.match(/\$projection_keys\$([\s\S]*?)\$projection_keys\$/)![1]);

describe('production vocabulary and composite projection', () => {
  it('keeps the frozen SQL status copy derived from the owner vocabulary', () => {
    const sql = readFileSync(new URL('../../migrations/20260926000000_prepare_interpretation_visibility.sql', import.meta.url), 'utf8');
    const list = FINDING_STATUS.ABNORMAL.map(status => `'${status}'`).join(',');
    expect(sql).toContain(`lower(v #>> '{}') IN (${list})`);
    expect(PROJECTION_VERSION).toBe(2);
    expect(sql).toContain('DEFAULT 2 CHECK (projection_version = 2)');
  });
  it.each([...FINDING_STATUS.NORMAL, ...FINDING_STATUS.BORDERLINE, 'unknown', 'high'])('%s does not force narrative into Basic', status => {
    expect(carriesSafety({ status })).toBe(false);
  });
  it.each(FINDING_STATUS.ABNORMAL)('%s is abnormal, including nested flags', status => {
    expect(carriesSafety({ nested: [{ status }] })).toBe(true);
  });
  it('only explicit boolean safety flags confer safety', () => {
    expect(carriesSafety({ abnormal: true })).toBe(true);
    expect(carriesSafety({ abnormal: 'false' })).toBe(false);
    expect(carriesSafety({ abnormal: false })).toBe(false);
  });
  it.each(['reassuring', 'monitor', 'attention'])('composes catalog, Basic and selector for %s', status => {
    const payload = structuredClone(promptFixture);
    payload.key_findings[0].status = status;
    const stored = addFindingMetadata(payload);
    const catalog = stored.findings as CatalogFinding[];
    const basic = buildBasicProjection(stored);
    const selection = selectPremiumPreview({ findings: catalog,
      floorKeys: [...FLOOR_REQUIRED_KEYS, ...FLOOR_FINDING_KEYS], floorPaths: new Set(),
      floorContentFingerprints: new Set(), abnormalOrSafetyPaths: new Set(),
      ineligiblePaths: new Set(catalog.filter(f => !f.preview_eligible).map(f => f.source_path)),
    });
    expect(basic.preview).toEqual(selection.preview);
    expect(basic.locked).toEqual(selection.locked);
    expect(selection.preview).not.toBeNull();
    expect(basic.locked).toEqual({ patterns: status === 'attention' ? 2 : 3, cross_report: 0, lifestyle: 2 });
    expect(basic).not.toHaveProperty('overall_interpretation');
    expect(basic).not.toHaveProperty('primary_concern');
    expect(basic).not.toHaveProperty('pattern_signals');
    for (const f of catalog.filter(f => f.source_path.startsWith('/pattern_signals/') && f !== selection.preview)) {
      expect(JSON.stringify(basic)).not.toContain((f.content as { explanation: string }).explanation);
    }
    expect(findFloorViolations(basic)).toEqual([]);
    expect(Object.keys(basic).sort()).toEqual(expectedKeys);
    // Unknown legacy provenance is deliberately floor-only in both languages.
    expect(Object.keys(buildBasicProjection(payload)).sort()).toEqual(expectedKeys);
    expect(basic.key_findings).toContainEqual({ biomarker_slug: 'a', status });
    if (status === 'attention') {
      expect(catalog.find(f => f.source_path === '/pattern_signals/0')?.kind).toBe('floor');
      expect((selection.preview?.content as { related_biomarkers: string[] }).related_biomarkers).not.toContain('a');
    }
  });
  it('keeps nested safety flags and explicit follow-ups, never the surrounding narrative', () => {
    const basic = buildBasicProjection({ ...promptFixture,
      primary_concern: { biomarker_slug: 'a', status: 'attention', explanation: 'LOCKED_PRIMARY', follow_up: 'Discuss results' },
      overall_interpretation: { abnormal: true, narrative: 'LOCKED_OVERALL' },
    });
    expect(basic.safety_findings).toEqual([
      { abnormal: true }, { status: 'attention', biomarker_slug: 'a', follow_up: 'Discuss results' },
    ]);
    expect(JSON.stringify(basic)).not.toMatch(/LOCKED_PRIMARY|LOCKED_OVERALL/);
  });
});
