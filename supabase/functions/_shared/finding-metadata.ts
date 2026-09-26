import { FLOOR_FINDING_KEYS, type InterpretationPayload } from "./response-shaping.ts";

export interface FindingMetadata {
  /** Set only by a server classifier with meaningful, floor-independent evidence. */
  preview_eligible?: boolean;
  kind: "trend" | "cross_marker" | "lifestyle" | "narrative" | "floor";
  confidence: number | null;
  magnitude_normalized: number | null;
  observed_at: string | null;
  visibility_hint: "basic" | "premium";
}

/** Stored-only additive catalog for PR 3: json_output.findings[] contains
 * { source_path, content, kind, confidence, magnitude_normalized, observed_at,
 *   visibility_hint }. source_path is a JSON pointer into the unchanged legacy
 * payload; content retains its object/string shape. This avoids replacing string
 * findings or pattern_signals' existing categorical confidence. No model prompt
 * changes or display/entitlement decisions are made here. Unknown quantitative
 * evidence stays null: categorical confidence is not a calibrated probability.
 */
export function addFindingMetadata(
  payload: InterpretationPayload,
  context: { observedAt?: string | null; hasPriorComparison?: boolean } = {},
): InterpretationPayload {
  const timestamp = context.observedAt && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(context.observedAt)
    ? Date.parse(context.observedAt) : NaN;
  const observedAt = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  const findings: Array<FindingMetadata & { source_path: string; content: unknown }> = [];
  const normalStatuses = new Set(["normal", "in_range", "within_range", "optimal"]);
  const markerStatuses = new Map<string, string>();
  if (Array.isArray(payload.key_findings)) {
    for (const finding of payload.key_findings) {
      if (finding && typeof finding === "object" && typeof finding.biomarker_slug === "string") {
        markerStatuses.set(finding.biomarker_slug, finding.status);
      }
    }
  }
  const append = (path: string, content: unknown, kind: FindingMetadata["kind"]) => {
    const record = content && typeof content === "object" ? content as Record<string, unknown> : {};
    const related = Array.isArray(record.related_biomarkers) ? record.related_biomarkers : [];
    const touchesAbnormal = related.some(slug => typeof slug === "string"
      && markerStatuses.has(slug) && !normalStatuses.has(markerStatuses.get(slug)!));
    const safety = touchesAbnormal;
    const confidence = record.confidence;
    const magnitude = record.magnitude_normalized;
    findings.push({
      source_path: path, content, kind: safety ? "floor" : kind,
      ...(kind === "cross_marker" && !safety && related.length >= 2
        && related.every(slug => typeof slug === "string" && normalStatuses.has(markerStatuses.get(slug) ?? ""))
        ? { preview_eligible: true } : {}),
      confidence: typeof confidence === "number" && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
        ? confidence : null,
      magnitude_normalized: typeof magnitude === "number" && Number.isFinite(magnitude) ? magnitude : null,
      observed_at: observedAt,
      visibility_hint: kind === "floor" || safety ? "basic" : "premium",
    });
  };
  for (const key of FLOOR_FINDING_KEYS) {
    const values = payload[key];
    if (Array.isArray(values)) values.forEach((value, index) => append(`/${key}/${index}`, value, "floor"));
  }
  for (const [key, kind] of [
    ["pattern_signals", "cross_marker"],
    ["what_you_can_do_now", "lifestyle"],
    ["what_to_do_next", "narrative"],
  ] as const) {
    const values = payload[key];
    if (Array.isArray(values)) values.forEach((value, index) => append(`/${key}/${index}`, value, kind));
  }
  for (const key of ["primary_concern", "overall_interpretation"] as const) {
    if (payload[key] != null) append(`/${key}`, payload[key],
      key === "overall_interpretation" && context.hasPriorComparison ? "trend" : "narrative");
  }
  return { ...payload, findings };
}
