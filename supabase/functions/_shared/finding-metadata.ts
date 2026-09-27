import { carriesFindingSafety, isAbnormalStatus } from "./tier.ts";
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

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const hasComparison = (c: Record<string, unknown>) =>
  finite(c.delta) || (finite(c.previous_value) && finite(c.current_value));

/** Markers flagged abnormal now, with their FINDING_STATUS value when one is
 * stated (null for a boolean-only flag). Deterministic payloads flag markers in
 * top_findings, AI ones in key_findings. */
export function abnormalMarkerStatuses(payload: InterpretationPayload): Map<string, string | null> {
  const markers = new Map<string, string | null>();
  for (const key of ["key_findings", "top_findings"] as const) {
    const values = payload[key];
    if (!Array.isArray(values)) continue;
    for (const finding of values) {
      if (!finding || typeof finding !== "object" || typeof finding.biomarker_slug !== "string"
        || !carriesFindingSafety(finding)) continue;
      const status = ["status", "current_status", "flag", "flagged"].map(k => finding[k]).find(isAbnormalStatus);
      if (!markers.get(finding.biomarker_slug)) markers.set(finding.biomarker_slug, typeof status === "string" ? status : null);
    }
  }
  return markers;
}

/** First usable trend_evidence entry per biomarker slug. */
export function trendEvidenceBySlug(payload: InterpretationPayload): Map<string, Record<string, unknown>> {
  const evidence = new Map<string, Record<string, unknown>>();
  if (Array.isArray(payload.trend_evidence)) {
    for (const entry of payload.trend_evidence) {
      if (entry && typeof entry === "object" && typeof entry.biomarker_slug === "string"
        && hasComparison(entry) && !evidence.has(entry.biomarker_slug)) evidence.set(entry.biomarker_slug, entry);
    }
  }
  return evidence;
}

/** A change on a marker that is abnormal now is safety-relevant, so Basic shows
 * it as a line of values (no narrative body). Never a preview, never counted. */
export interface FlaggedTrend {
  biomarker_slug: string;
  marker: string;
  previous_value: unknown;
  current_value: unknown;
  unit: unknown;
  previous_date: unknown;
  direction: unknown;
  status: string | null;
  summary: unknown;
}

export function flaggedTrends(payload: InterpretationPayload): FlaggedTrend[] {
  const abnormal = abnormalMarkerStatuses(payload);
  return [...trendEvidenceBySlug(payload).entries()].filter(([slug]) => abnormal.has(slug)).map(([slug, e]) => ({
    biomarker_slug: slug,
    marker: typeof e.marker === "string" ? e.marker : slug,
    previous_value: e.previous_value ?? null,
    current_value: e.current_value ?? null,
    unit: e.unit ?? null,
    previous_date: e.previous_date ?? null,
    direction: e.direction ?? null,
    status: abnormal.get(slug) ?? null,
    summary: e.summary ?? null,
  }));
}

/** Stored-only additive catalog for PR 3: json_output.findings[] contains
 * { source_path, content, kind, confidence, magnitude_normalized, observed_at,
 *   visibility_hint }. source_path is a JSON pointer into the unchanged legacy
 * payload; content retains its object/string shape. This avoids replacing string
 * findings or pattern_signals' existing categorical confidence. No model prompt
 * changes or display/entitlement decisions are made here. Unknown quantitative
 * evidence stays null: categorical confidence is not a calibrated probability.
 *
 * Trend evidence is the server's own trend_evidence[] (see trend-evidence.ts).
 * A pattern becomes a trend only through inline numeric evidence or a
 * trend_biomarker naming a stored evidence entry; the model cannot assert one.
 * Evidence entries no pattern references are catalogued on their own.
 */
export function addFindingMetadata(
  payload: InterpretationPayload,
  context: { observedAt?: string | null } = {},
): InterpretationPayload {
  const timestamp = context.observedAt && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(context.observedAt)
    ? Date.parse(context.observedAt) : NaN;
  const observedAt = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  const findings: Array<FindingMetadata & { source_path: string; content: unknown }> = [];
  const abnormalMarkers = abnormalMarkerStatuses(payload);
  const evidence = trendEvidenceBySlug(payload);
  const referenced = new Set<string>();
  const append = (path: string, content: unknown, kind: FindingMetadata["kind"]) => {
    const record = content && typeof content === "object" ? content as Record<string, unknown> : {};
    const trendSlug = typeof record.trend_biomarker === "string" && evidence.has(record.trend_biomarker)
      ? record.trend_biomarker : null;
    const related = [...new Set([
      ...(Array.isArray(record.related_biomarkers) ? record.related_biomarkers : []),
      ...(typeof record.biomarker_slug === "string" ? [record.biomarker_slug] : []),
      ...(trendSlug ? [trendSlug] : []),
    ].filter((slug): slug is string => typeof slug === "string" && slug.trim().length > 0))];
    const safety = carriesFindingSafety(content) || related.some(slug => abnormalMarkers.has(slug));
    // A label or global prior-report context alone is not trend evidence.
    const comparison = record.prior_comparison && typeof record.prior_comparison === "object"
      ? record.prior_comparison as Record<string, unknown> : trendSlug ? evidence.get(trendSlug)! : record;
    const trendEvidence = hasComparison(comparison);
    if (kind !== "floor" && kind !== "narrative" && trendEvidence) kind = "trend";
    // First catalogued comparison for a slug wins, including multiple model
    // patterns referring to the same stored evidence. Keep the original source
    // path/content and do not count the same analyte twice. This can reduce
    // locked.patterns/cross_report by one when duplicate findings previously
    // counted the same analyte twice; it does not remove a distinct finding.
    const comparisonSlug = trendSlug ?? (typeof record.biomarker_slug === "string" ? record.biomarker_slug : null);
    if (kind === "trend" && comparisonSlug) {
      if (referenced.has(comparisonSlug)) return;
      referenced.add(comparisonSlug);
    }
    const confidence = record.confidence;
    const magnitude = finite(record.magnitude_normalized) ? record.magnitude_normalized
      : kind === "trend" && finite(comparison.percent_change) ? Math.abs(comparison.percent_change) / 100 : null;
    findings.push({
      source_path: path, content, kind: safety ? "floor" : kind,
      ...(!safety && ((kind === "cross_marker" && related.length >= 2)
        || ((kind === "trend" || kind === "lifestyle") && related.length >= 1))
        ? { preview_eligible: true } : {}),
      confidence: typeof confidence === "number" && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
        ? confidence : null,
      magnitude_normalized: magnitude,
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
  if (Array.isArray(payload.trend_evidence)) {
    payload.trend_evidence.forEach((entry, index) => {
      if (entry && typeof entry === "object" && evidence.get(entry.biomarker_slug) === entry
        && !referenced.has(entry.biomarker_slug)) append(`/trend_evidence/${index}`, entry, "trend");
    });
  }
  for (const key of ["primary_concern", "overall_interpretation"] as const) {
    if (payload[key] != null) append(`/${key}`, payload[key], "narrative");
  }
  return { ...payload, findings };
}
