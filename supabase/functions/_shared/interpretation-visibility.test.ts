import { readFileSync } from "node:fs";
import { FINDING_STATUS } from "./tier";
import { selectPremiumPreview } from "./preview-selector";
import { describe, expect, it } from 'vitest';
import { basicCycleContext, basicFindingArray, basicSafetyValue, sanitizeBasicProjection, SAFETY_KEYS, buildBasicProjection, carriesSafety, DETERMINISTIC_NARRATIVE_KEYS, DETERMINISTIC_SOURCES, isDeterministicSource } from './interpretation-visibility';
import { FLOOR_FINDING_KEYS, FLOOR_REQUIRED_KEYS, findFloorViolations } from './response-shaping';
import type { CatalogFinding } from './preview-selector';
import { addFindingMetadata } from './finding-metadata';
import { buildTrendEvidence } from './trend-evidence';

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
    expect(result.key_findings).toEqual([{ status: 'attention' }]);
    expect(result.safety_findings).toEqual([{ abnormal: true }]);
    // Prompt-authored narrative: withheld for unknown/AI provenance, floor for deterministic.
    expect(result.what_to_do_next).toEqual([]);
    expect(buildBasicProjection({ ...full, findings: catalog }, undefined, { source: 'fallback' }).what_to_do_next)
      .toEqual(full.what_to_do_next);
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
    const basic = buildBasicProjection(addFindingMetadata({ ...full, overall_interpretation: 'abnormal explanation' }));
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
  it('keeps nested safety flags and safety notes, never follow-up prose or the surrounding narrative', () => {
    const basic = buildBasicProjection({ ...promptFixture,
      primary_concern: { biomarker_slug: 'a', status: 'attention', explanation: 'LOCKED_PRIMARY', follow_up: 'LOCKED_FOLLOW_UP',
        marker: 'LOCKED_MARKER', safety_notes: ['Seek care promptly'] },
      overall_interpretation: { abnormal: true, narrative: 'LOCKED_OVERALL' },
    });
    expect(basic.safety_findings).toEqual([
      { abnormal: true }, { status: 'attention', biomarker_slug: 'a', safety_notes: ['Seek care promptly'] },
    ]);
    expect(JSON.stringify(basic)).not.toMatch(/LOCKED_PRIMARY|LOCKED_OVERALL|LOCKED_FOLLOW_UP|LOCKED_MARKER/);
  });
});

// The deterministic fixture and key contract are shared with the SQL rehearsal
// (deterministic-projection.prelude.sql / .verify.sql, migration 20260926000003).
const deterministicPreludeSql = readFileSync(new URL('../../migrations/__verification__/deterministic-projection.prelude.sql', import.meta.url), 'utf8');
const deterministicVerifySql = readFileSync(new URL('../../migrations/__verification__/deterministic-projection.verify.sql', import.meta.url), 'utf8');
const deterministicMigration = readFileSync(new URL('../../migrations/20260926000003_deterministic_projection_floor.sql', import.meta.url), 'utf8');
const deterministicFixture = JSON.parse(deterministicPreludeSql.match(/\$deterministic_fixture\$([\s\S]*?)\$deterministic_fixture\$/)![1]);
const deterministicKeys: string[] = JSON.parse(deterministicVerifySql.match(/\$deterministic_keys\$([\s\S]*?)\$deterministic_keys\$/)![1]);

describe('deterministic interpretation stays on the Free medical floor', () => {
  it('keeps the frozen SQL source and narrative lists derived from TypeScript', () => {
    const sources = DETERMINISTIC_SOURCES.map(s => `'${s}'`).join(',');
    const keys = DETERMINISTIC_NARRATIVE_KEYS.map(k => `'${k}'`).join(',');
    expect(deterministicMigration).toContain(`p_source IN (${sources})`);
    expect(deterministicMigration).toContain(`interpretation_source IN (${sources})`);
    expect(deterministicMigration).toContain(`ARRAY[${keys}]`);
    expect(deterministicKeys).toEqual([...expectedKeys, ...DETERMINISTIC_NARRATIVE_KEYS, 'flagged_trends'].sort());
    expect(isDeterministicSource('fallback')).toBe(true);
    expect(isDeterministicSource('ai')).toBe(false);
    expect(isDeterministicSource(null)).toBe(false);
  });

  // The current SQL contract includes flagged_trends for this evidence-bearing fixture.
  const { trend_evidence: _evidence, ...withoutEvidence } = deterministicFixture;
  it.each(DETERMINISTIC_SOURCES)('%s: full deterministic narrative in Basic, SQL key parity', source => {
    const basic = buildBasicProjection(deterministicFixture, undefined, { source });
    expect(basic.overall_interpretation).toBe(deterministicFixture.overall_interpretation);
    expect(basic.pattern_signals).toEqual(deterministicFixture.pattern_signals);
    expect(Object.keys(basic).sort()).toEqual(deterministicKeys);
    expect(Object.keys(buildBasicProjection(withoutEvidence, undefined, { source })).sort()).toEqual(deterministicKeys.filter(key => key !== 'flagged_trends'));
    expect(findFloorViolations(basic)).toEqual([]);
    expect(basic).not.toHaveProperty('trend_evidence');
  });

  it.each(['ai', null, undefined, 'unknown'])('source %s keeps the narrative locked (unchanged behaviour)', source => {
    const basic = buildBasicProjection(deterministicFixture, undefined, { source });
    expect(basic).toEqual(buildBasicProjection(deterministicFixture));
    expect(Object.keys(basic).sort()).toEqual([...expectedKeys, 'flagged_trends'].sort());
    expect(Object.keys(buildBasicProjection(withoutEvidence, undefined, { source })).sort()).toEqual(expectedKeys);
    expect(JSON.stringify(basic)).not.toMatch(/DETERMINISTIC_(OVERALL|PATTERN)/);
  });

  it('composite: catalog + fallback projection previews the canonical trend and counts the rest', () => {
    const stored = addFindingMetadata(deterministicFixture, { observedAt: '2026-09-20' });
    const basic = buildBasicProjection(stored, undefined, { source: 'fallback' });
    expect(basic.overall_interpretation).toBe('DETERMINISTIC_OVERALL');
    expect(basic.pattern_signals).toEqual(deterministicFixture.pattern_signals);
    expect((basic.preview as CatalogFinding).source_path).toBe('/trend_evidence/0');
    expect((basic.preview as CatalogFinding).content).toMatchObject({ summary: 'Vitamin D increased 18 → 31 ng/mL since 2026-03-01' });
    // TSH is locked; the ferritin trend touches a discuss marker and is floor, not a count.
    expect(basic.locked).toEqual({ patterns: 0, cross_report: 1, lifestyle: 0 });
    expect(JSON.stringify(basic)).not.toContain('TSH increased');
    // ...and is shown as a flagged trend line, the only trend Basic reveals.
    expect(basic.flagged_trends).toEqual([expect.objectContaining({ biomarker_slug: 'ferritin',
      previous_value: 20, current_value: 9, direction: 'decreased', status: 'discuss' })]);
    // The same stored AI-sourced body keeps its narrative locked.
    const ai = buildBasicProjection(stored, undefined, { source: 'ai' });
    expect(ai).not.toHaveProperty('overall_interpretation');
    expect(ai).not.toHaveProperty('pattern_signals');
    expect(JSON.stringify(ai)).not.toContain('DETERMINISTIC_PATTERN');
  });
});

const flaggedTrendSql = readFileSync(new URL('../../migrations/__verification__/flagged-trends.verify.sql', import.meta.url), 'utf8');
const flaggedTrendCases = JSON.parse(flaggedTrendSql.match(/\$trend_cases\$([\s\S]*?)\$trend_cases\$/)![1]);
describe('SQL/TS flagged_trends shared value fixtures', () => {
  it.each(flaggedTrendCases)('matches the SQL expected values for $full', ({ full, expected }) => {
    for (const source of ['ai', 'fallback', 'deterministic', null]) {
      const basic = buildBasicProjection(full, undefined, { source });
      expect(basic.flagged_trends ?? []).toEqual(expected);
      if (!expected.length) expect(basic).not.toHaveProperty('flagged_trends');
    }
  });
  it('freezes the shared abnormal vocabulary in SQL', () => {
    const migration = readFileSync(new URL('../../migrations/20260927000000_flagged_trends_projection.sql', import.meta.url), 'utf8');
    expect(migration).toContain(`IN (${FINDING_STATUS.ABNORMAL.map(s => `'${s}'`).join(',')})`);
  });
});

const cycleMigration = readFileSync(new URL('../../migrations/20260927000001_basic_cycle_context.sql', import.meta.url), 'utf8');
const cycleCases: { input: unknown; expected: Record<string, unknown>; deterministic_explanation?: string }[] = JSON.parse(
  cycleMigration.match(/\$cycle_cases\$([\s\S]*?)\$cycle_cases\$/)![1]);
describe('cycle context confidentiality (shared SQL fixture)', () => {
  it.each(cycleCases)('keeps only typed facts from $input', ({ input, expected, deterministic_explanation }) => {
    expect(basicCycleContext(input)).toEqual(expected);
    for (const source of ['ai', 'unknown', 'fallback', 'deterministic', null, undefined]) {
      const deterministic = isDeterministicSource(source);
      // The rule-based cycle sentence is floor; model prose never is.
      const want = deterministic ? { ...expected, explanation: deterministic_explanation ?? '' } : expected;
      const payload = { ...full, cycle_context: input };
      const original = structuredClone(payload);
      const basic = buildBasicProjection(payload, [], { source });
      expect(basicCycleContext(input, source)).toEqual(want);
      expect(basic.cycle_context).toEqual(want);
      expect(sanitizeBasicProjection(payload, source).cycle_context).toEqual(want);
      expect(JSON.stringify(basic)).not.toContain('PRIVATE');
      if (!deterministic) expect(JSON.stringify(basic)).not.toContain('CYCLE SENTENCE');
      expect(payload).toEqual(original);
    }
  });
  it('never fabricates a cycle fact or confidence for any source', () => {
    for (const source of ['ai', 'fallback', null]) {
      expect(basicCycleContext({ explanation: 'x' }, source)).toMatchObject({
        estimated_cycle_day: null, estimated_cycle_phase: 'unknown', confidence: null });
    }
  });
  it('sanitizes existing projections at both SQL read boundaries without a backfill', () => {
    expect(cycleMigration.match(/ELSE public.interpretation_sanitize_basic\(i.json_output_basic,i.interpretation_source\)/g)).toHaveLength(2);
    expect(cycleMigration).not.toMatch(/UPDATE\s+public\./);
    expect(cycleMigration).toContain('THEN i.json_output ELSE');
    expect(cycleMigration).toContain('WHEN p_premium OR claim.covered THEN i.json_output');
  });
  it('asks the model only for the explanation; phase/day/confidence are server-filled', () => {
    const writer = readFileSync(new URL('../generate-interpretation/index.ts', import.meta.url), 'utf8');
    expect(writer).toContain('"cycle_context": {"explanation": "string"}');
    expect(writer).not.toContain('"cycle_context": {"estimated_cycle_day":');
    expect(writer).toContain('aiResult.cycle_context = { ...deterministicCycleFacts(report as LabReportData), explanation: modelCycleExplanation(aiResult.cycle_context) }');
    const schema = readFileSync(new URL('./schemas/interpretation.ts', import.meta.url), 'utf8');
    expect(schema).toContain('cycle_context: z.unknown()');
  });
});

const findingCases: { input: unknown; expected: unknown[] }[] = JSON.parse(
  cycleMigration.match(/\$finding_cases\$([\s\S]*?)\$finding_cases\$/)![1]);
describe('findings confidentiality (one shared SQL fixture)', () => {
  it.each(findingCases)('keeps typed facts and explicit safety follow-ups from $input', ({ input, expected }) => {
    for (const key of FLOOR_FINDING_KEYS) for (const source of ['ai', 'unknown', null]) {
      const payload = { ...full, [key]: input };
      const original = structuredClone(payload);
      expect(basicFindingArray(input, source)).toEqual(expected);
      const basic = buildBasicProjection(payload, [], { source });
      expect(basic[key]).toEqual(expected);
      expect(JSON.stringify(basic)).not.toContain('PRIVATE CROSS-MARKER NARRATIVE');
      expect(sanitizeBasicProjection(payload, source)[key]).toEqual(expected);
      expect(payload).toEqual(original);
    }
    for (const source of DETERMINISTIC_SOURCES) {
      for (const key of FLOOR_FINDING_KEYS) {
        expect(buildBasicProjection({ ...full, [key]: input }, [], { source })[key]).toEqual(Array.isArray(input) ? input : []);
      }
    }
  });
  it('keeps selected preview and counts for legacy Basic while narrowing arrays', () => {
    const payload = { ...full, key_findings: findingCases[0].input,
      preview: catalog[0], locked: { patterns: 2, cross_report: 1, lifestyle: 3 } };
    const basic = sanitizeBasicProjection(payload, 'ai');
    expect(basic.preview).toBe(payload.preview);
    expect(basic.locked).toBe(payload.locked);
    expect(basic.key_findings).toEqual(findingCases[0].expected);
  });
  it('keeps original floor fingerprints out of preview selection after prose removal', () => {
    const payload = { ...full, key_findings: [{ explanation: 'duplicate prose' }], pattern_signals: ['duplicate prose'] };
    const basic = buildBasicProjection(payload, [{ ...catalog[0], content: 'duplicate prose' }]);
    expect(basic.preview).toBeNull();
    expect(basic.locked).toEqual({ patterns: 0, cross_report: 0, lifestyle: 0 });
  });
  it('covers generation, stored Basic reads, both SQL reads and both floor overloads', () => {
    const generator = readFileSync(new URL('../generate-interpretation/index.ts', import.meta.url), 'utf8');
    expect(generator).toContain('buildBasicProjection(interpretationJson, undefined, { source: shaped.source })');
    expect(generator).toContain('shaped.tier === "plus" ? interpretationJson : basicProjection');
    const reader = readFileSync(new URL('./interpretation-read.ts', import.meta.url), 'utf8');
    expect(reader).toContain('sanitizeBasicProjection(row.json_output, provenance.source)');
    expect(cycleMigration.match(/ELSE public.interpretation_sanitize_basic\(i.json_output_basic,i.interpretation_source\)/g)).toHaveLength(2);
    // One floor body: the one-argument floor is the NULL (fail-closed) source.
    expect(cycleMigration).toContain('RETURN public.interpretation_floor(p_full, NULL::text);');
    expect(cycleMigration).toContain('public.interpretation_basic_findings(p_full->k,p_source)');
    expect(cycleMigration).toContain('public.interpretation_basic_safety_value(k,p_full->k,p_source)');
    expect(cycleMigration).toContain("'safety_findings',public.interpretation_basic_findings(safety,p_source)");
    const harness = readFileSync(new URL('../../migrations/__verification__/run.sh', import.meta.url), 'utf8');
    expect(harness).toContain('BASIC=20260927000001_basic_cycle_context.sql');
    expect(harness.match(/psql_f -v ON_ERROR_STOP=1 -q -f "\/tmp\/\$BASIC"/g)).toHaveLength(2);
  });
  it('keeps the frozen SQL finding-status vocabulary derived from FINDING_STATUS', () => {
    const list = [...FINDING_STATUS.NORMAL, ...FINDING_STATUS.BORDERLINE, ...FINDING_STATUS.ABNORMAL, 'unknown'].map(s => `'${s}'`).join(',');
    expect(cycleMigration).toContain(`lower(v #>> '{}') IN (${list})`);
  });
});

type SafetyCase = { full: Record<string, unknown>; expected: Record<string, unknown>; deterministic: Record<string, unknown> };
const safetyCase: SafetyCase = JSON.parse(cycleMigration.match(/\$safety_cases\$([\s\S]*?)\$safety_cases\$/)![1]);
describe('remaining floor channels (one shared SQL sentinel fixture)', () => {
  it.each(['ai', 'unknown', null, undefined, ...DETERMINISTIC_SOURCES])('source %s: model prose withheld, flags and safety text kept', source => {
    const deterministic = isDeterministicSource(source);
    const want = deterministic ? safetyCase.deterministic : safetyCase.expected;
    const original = structuredClone(safetyCase.full);
    const basic = buildBasicProjection(safetyCase.full, [], { source });
    // A stored Basic holds floor keys only (never primary_concern).
    const { primary_concern: _concern, ...floorKeys } = safetyCase.full;
    const stored = { ...floorKeys, safety_findings: safetyCase.deterministic.safety_findings };
    const read = sanitizeBasicProjection(stored, source);
    for (const [key, value] of Object.entries(want)) {
      expect(basic[key]).toEqual(value);
      if (key !== 'basic_interpretation') expect(read[key]).toEqual(value);
    }
    if (!deterministic) {
      expect(JSON.stringify(basic)).not.toContain('SENTINEL');
      expect(JSON.stringify(read)).not.toContain('SENTINEL');
      // Abnormal finding, status, value, unit and flags survive; so does
      // separately allowlisted safety text.
      expect(basic.abnormal_flags).toEqual([{ biomarker_slug: 'ferritin', status: 'discuss', abnormal: true, value: 9, unit: 'ng/mL' }]);
      expect(basic.warnings).toBe('Critical potassium: contact your clinician today.');
      expect(basic.safety_notes).toEqual(['Seek care promptly if you feel faint.']);
    }
    expect(safetyCase.full).toEqual(original);
  });
  it('what_to_do_next is the only SAFETY_KEY withheld outright', () => {
    for (const key of SAFETY_KEYS) {
      expect(basicSafetyValue(key, ['kept'], 'ai')).toEqual(key === 'what_to_do_next' ? [] : ['kept']);
      expect(basicSafetyValue(key, ['kept'], 'fallback')).toEqual(['kept']);
      expect(basicSafetyValue(key, null, 'ai')).toEqual([]);
    }
  });
  it('keeps the original floor fingerprints of stripped channels out of preview selection', () => {
    const payload = { ...full, what_to_do_next: ['duplicate prose'], cycle_context: { explanation: 'duplicate cycle' },
      pattern_signals: ['duplicate prose', 'duplicate cycle'] };
    const findings = payload.pattern_signals.map((content, i) => ({ ...catalog[0], content, source_path: `/pattern_signals/${i}` }));
    const basic = buildBasicProjection(payload, findings);
    expect(basic.preview).toBeNull();
    expect(basic.locked).toEqual({ patterns: 0, cross_report: 0, lifestyle: 0 });
  });
});
