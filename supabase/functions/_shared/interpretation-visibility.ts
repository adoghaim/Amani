import { FLOOR_REQUIRED_KEYS, FLOOR_FINDING_KEYS, findFloorViolations, type InterpretationPayload } from "./response-shaping.ts";
import { contentFingerprint, pathWithin, selectPremiumPreview, type CatalogFinding } from "./preview-selector.ts";

export const PROJECTION_VERSION = 1;
const defaults: InterpretationPayload = {
  headline: "Your lab results", cycle_context: {}, questions_for_doctor: [],
  disclaimer: "This report is for educational purposes only and does not constitute medical advice.",
};
export const SAFETY_KEYS = ["safety_notes", "abnormal_flags", "flags", "warnings", "critical_findings", "what_to_do_next", "primary_concern"] as const;

/** Flags are evidence of floor membership, never evidence of preview eligibility. */
export function carriesSafety(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(carriesSafety);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => {
    if (/^(abnormal|is_abnormal|safety|safety_related|is_safety|critical|urgent)$/.test(key)) return child !== false && child != null;
    if (/^(flag|flagged|status|current_status)$/.test(key) && typeof child === "string") {
      return !["normal", "in_range", "optimal", "within_range"].includes(child.toLowerCase());
    }
    return carriesSafety(child);
  });
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
 */
export function buildBasicProjection(full: InterpretationPayload, findings?: readonly CatalogFinding[]): InterpretationPayload {
  const basic: InterpretationPayload = {};
  for (const key of FLOOR_REQUIRED_KEYS) basic[key] = full[key] ?? defaults[key];
  for (const key of FLOOR_FINDING_KEYS) basic[key] = Array.isArray(full[key]) ? full[key] : [];
  for (const key of SAFETY_KEYS) {
    if (key === "primary_concern" && full[key] == null) continue;
    basic[key] = full[key] ?? [];
  }
  const floorPaths = new Set([...FLOOR_REQUIRED_KEYS, ...FLOOR_FINDING_KEYS, ...SAFETY_KEYS].map(key => `/${key}`));
  const fingerprints = new Set<string>();
  const collect = (value: unknown) => {
    fingerprints.add(contentFingerprint(value));
    if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  Object.values(basic).forEach(collect);
  if (FLOOR_FINDING_KEYS.some(key => carriesSafety(full[key])) && full.overall_interpretation != null) {
    basic.overall_interpretation = full.overall_interpretation;
    floorPaths.add("/overall_interpretation");
    collect(full.overall_interpretation);
  }
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
        safety.push(entry);
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
      if (![...floorPaths].some(path => pathWithin(f.source_path, path))) safety.push(f.content);
      collect(f.content);
    }
    // Only explicit server-authored classification can qualify opaque prose.
    if (f.preview_eligible !== true) ineligiblePaths.add(f.source_path);
  }
  basic.safety_findings = [...new Map(safety.map(value => [contentFingerprint(value), value])).values()];
  const selection = selectPremiumPreview({ findings: valid,
    floorKeys: [...FLOOR_REQUIRED_KEYS, ...FLOOR_FINDING_KEYS, ...SAFETY_KEYS], floorPaths,
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
