import { carriesFindingSafety, FINDING_STATUS, isAbnormalStatus } from "./tier.ts";
import { FLOOR_REQUIRED_KEYS, FLOOR_FINDING_KEYS, findFloorViolations, type InterpretationPayload } from "./response-shaping.ts";
import { contentFingerprint, pathWithin, selectPremiumPreview, type CatalogFinding } from "./preview-selector.ts";
import { flaggedTrends } from "./finding-metadata.ts";

const defaults: InterpretationPayload = {
  headline: "Your lab results", cycle_context: {}, questions_for_doctor: [],
  disclaimer: "This report is for educational purposes only and does not constitute medical advice.",
};
export const SAFETY_KEYS = ["safety_notes", "abnormal_flags", "flags", "warnings", "critical_findings", "what_to_do_next"] as const;

/** interpretation_source values of the rule-based interpretation, which
 * MEDICAL_FLOOR.deterministicInterpretation makes free. SQL copy in
 * 20260926000003_deterministic_projection_floor.sql is parity-tested. */
export const DETERMINISTIC_SOURCES = Object.freeze(["fallback", "deterministic"] as const);
/** Narrative the deterministic payload carries beyond the shared floor keys. */
export const DETERMINISTIC_NARRATIVE_KEYS = Object.freeze(["overall_interpretation", "pattern_signals"] as const);

export function isDeterministicSource(source: unknown): boolean {
  return typeof source === "string" && (DETERMINISTIC_SOURCES as readonly string[]).includes(source);
}

/** Basic keeps cycle facts, never model-authored prose (including old stored
 * strings, explanation, and unknown nested fields). Full bodies are untouched.
 * Mirrored by interpretation_basic_cycle_context in the additive SQL migration. */
export function basicCycleContext(value: unknown): Record<string, unknown> {
  const context = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const day = context.estimated_cycle_day;
  const phase = context.estimated_cycle_phase;
  const confidence = context.confidence;
  return {
    estimated_cycle_day: typeof day === "number" && Number.isSafeInteger(day) && day > 0 ? day : null,
    estimated_cycle_phase: typeof phase === "string" && ["menstrual", "follicular", "ovulatory", "luteal",
      "pregnancy_t1", "pregnancy_t2", "pregnancy_t3", "unknown"].includes(phase) ? phase : "unknown",
    confidence: typeof confidence === "string" && ["low", "medium", "high"].includes(confidence) ? confidence : null,
    explanation: "",
  };
}

/** Findings are not a prose floor merely because they carry an abnormal flag.
 * Only typed facts and explicitly named clinical follow-ups survive. Text from
 * trusted rule-based writers is itself the medical floor (source is a DB column,
 * never a field taken from the model payload). Unknown source fails closed.
 */
export function basicFindingArray(value: unknown, source?: string | null): unknown[] {
  if (!Array.isArray(value)) return [];
  if (isDeterministicSource(source)) return value;
  return value.flatMap(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const finding: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(entry)) {
      if (key === "biomarker_slug" && typeof child === "string" && /^[a-z0-9_]{1,80}$/.test(child)) finding[key] = child;
      if (["value", "previous_value", "current_value", "reference_min", "reference_max"].includes(key)
        && (child === null || (typeof child === "number" && Number.isFinite(child)))) finding[key] = child;
      if (key === "unit" && typeof child === "string" && /^[a-zA-Z0-9µμ%/^. *()-]{1,24}$/.test(child)) finding[key] = child;
      if (["abnormal", "is_abnormal", "safety", "safety_related", "is_safety", "critical", "urgent"].includes(key)
        && typeof child === "boolean") finding[key] = child;
      if (["status", "current_status", "flag", "flagged"].includes(key) && typeof child === "string"
        && [...FINDING_STATUS.NORMAL, ...FINDING_STATUS.BORDERLINE, ...FINDING_STATUS.ABNORMAL, "unknown"].includes(child.toLowerCase())) finding[key] = child;
      // Explicit safety-floor fields only, not title/explanation/summary or any
      // unclassified nested object. An abnormal parent does not authorize prose.
      if (["safety_notes", "follow_up", "what_to_do_next"].includes(key)) {
        if (typeof child === "string") finding[key] = child;
        else if (Array.isArray(child)) finding[key] = child.filter(v => typeof v === "string");
      }
    }
    return Object.keys(finding).length ? [finding] : [];
  });
}

/** Re-sanitize stored Basic without rebuilding its preview or locked counts. */
export function sanitizeBasicProjection(basic: InterpretationPayload, source?: string | null): InterpretationPayload {
  const result: InterpretationPayload = { ...basic, cycle_context: basicCycleContext(basic.cycle_context) };
  for (const key of FLOOR_FINDING_KEYS) result[key] = basicFindingArray(basic[key], source);
  return result;
}

/** Flags are evidence of floor membership, never evidence of preview eligibility. */
export const carriesSafety = carriesFindingSafety;

/** Retain flags/identifiers and explicit safety follow-ups, never their narrative container. */
function safetyFlags(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(safetyFlags);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const flags = Object.fromEntries(Object.entries(record).filter(([key, child]) =>
    (/^(abnormal|is_abnormal|safety|safety_related|is_safety|critical|urgent)$/.test(key) && child === true)
    || (/^(flag|flagged|status|current_status)$/.test(key) && isAbnormalStatus(child))));
  if (Object.keys(flags).length) {
    for (const key of ["biomarker_slug", "marker", "related_biomarkers", "safety_notes", "follow_up", "what_to_do_next"]) {
      if (record[key] != null) flags[key] = record[key];
    }
  }
  return [...(Object.keys(flags).length ? [flags] : []), ...Object.values(record).flatMap(safetyFlags)];
}

function atPointer(payload: InterpretationPayload, path: string): unknown {
  let value: unknown = payload;
  for (const token of path.slice(1).split("/").map(p => p.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, token)) return undefined;
    value = (value as Record<string, unknown>)[token];
  }
  return value;
}

/** Allowlist compilation, never basic ?? full. Unclassified narrative is not a preview.
 * The existing catalog cannot prove that prose is a meaningful, safety-independent
 * correlation. Such entries are omitted until the server has classification evidence.
 *
 * A deterministic source (the rule-based fallback) is the medical floor itself:
 * its overall_interpretation and pattern_signals are returned whole and leave
 * the preview/count pool. AI narrative, and any unknown source, stays locked.
 */
export function buildBasicProjection(
  full: InterpretationPayload,
  findings?: readonly CatalogFinding[],
  provenance: { source?: string | null } = {},
): InterpretationPayload {
  const basic: InterpretationPayload = {};
  for (const key of FLOOR_REQUIRED_KEYS) basic[key] = full[key] ?? defaults[key];
  basic.cycle_context = basicCycleContext(full.cycle_context);
  for (const key of FLOOR_FINDING_KEYS) basic[key] = basicFindingArray(full[key], provenance.source);
  for (const key of SAFETY_KEYS) {
    basic[key] = full[key] ?? [];
  }
  const floorPaths = new Set([...FLOOR_REQUIRED_KEYS, ...FLOOR_FINDING_KEYS, ...SAFETY_KEYS].map(key => `/${key}`));
  const deterministicKeys = isDeterministicSource(provenance.source)
    ? DETERMINISTIC_NARRATIVE_KEYS.filter(key => full[key] != null) : [];
  const fingerprints = new Set<string>();
  const collect = (value: unknown) => {
    fingerprints.add(contentFingerprint(value));
    if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  Object.values(basic).forEach(collect);
  // Selection still excludes the original floor content, even when prose was stripped.
  for (const key of FLOOR_FINDING_KEYS) if (Array.isArray(full[key])) collect(full[key]);
  const catalog = findings ?? (Array.isArray(full.findings) ? full.findings as CatalogFinding[] : []);
  const abnormalOrSafetyPaths = new Set<string>();
  const ineligiblePaths = new Set<string>();
  const safety: unknown[] = [];
  // Preserve explicitly flagged material even if it is outside the catalog.
  for (const [key, value] of Object.entries(full)) {
    if (key === "findings" || floorPaths.has(`/${key}`)) continue;
    const values = Array.isArray(value) ? value : [value];
    values.forEach((entry, index) => {
      if (carriesSafety(entry)) {
        safety.push(...safetyFlags(entry));
        abnormalOrSafetyPaths.add(Array.isArray(value) ? `/${key}/${index}` : `/${key}`);
        collect(entry);
      }
    });
  }
  const valid = catalog.filter(f => f && typeof f.source_path === "string"
    && f.source_path.startsWith("/") && f.content != null
    && contentFingerprint(atPointer(full, f.source_path)) === contentFingerprint(f.content));
  for (const f of valid) {
    if (f.kind === "floor" || f.visibility_hint === "basic" || carriesSafety(f.content)) {
      abnormalOrSafetyPaths.add(f.source_path);
      if (![...floorPaths].some(path => pathWithin(f.source_path, path))) safety.push(...safetyFlags(f.content));
      collect(f.content);
    }
    // Only explicit server-authored classification can qualify opaque prose.
    if (f.preview_eligible !== true) ineligiblePaths.add(f.source_path);
  }
  basic.safety_findings = [...new Map(safety.map(value => [contentFingerprint(value), value])).values()];
  // A trend on a marker abnormal now is floor: values only, never a narrative
  // body, a preview or a locked count. Emitted only when present, so a payload
  // without trend_evidence (every legacy row) projects exactly as before and as
  // SQL interpretation_floor does.
  const flagged = flaggedTrends(full);
  if (flagged.length) {
    basic.flagged_trends = flagged;
    collect(flagged);
    const slugs = new Set(flagged.map(line => line.biomarker_slug));
    if (Array.isArray(full.trend_evidence)) full.trend_evidence.forEach((entry, index) => {
      if (entry && typeof entry === "object" && slugs.has(entry.biomarker_slug)) abnormalOrSafetyPaths.add(`/trend_evidence/${index}`);
    });
  }
  // Added after the safety scan so safety_findings match SQL interpretation_floor.
  for (const key of deterministicKeys) {
    basic[key] = full[key];
    floorPaths.add(`/${key}`);
    collect(full[key]);
  }
  const selection = selectPremiumPreview({ findings: valid,
    floorKeys: [...FLOOR_REQUIRED_KEYS, ...FLOOR_FINDING_KEYS, ...SAFETY_KEYS, ...deterministicKeys], floorPaths,
    floorContentFingerprints: fingerprints, abnormalOrSafetyPaths, ineligiblePaths });
  // The headline is already part of the unconditionally visible floor. Reuse
  // its concise result summary, never truncate a locked Premium narrative.
  basic.basic_interpretation = typeof basic.headline === "string" && basic.headline.trim()
    ? basic.headline : defaults.headline;
  basic.preview = selection.preview;
  basic.locked = selection.locked;
  if (findFloorViolations(basic).length) throw new Error("Invalid Basic medical floor");
  return basic;
}
