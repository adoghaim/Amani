/**
 * V2-03c — server clinical-claim authority and projection safety.
 *
 *   model output (untrusted proposal) ─┐
 *   server facts ── issueClaimSet ──── AUTHORIZED CLAIM SET ── projectBasic ── Basic / paid
 *
 * An unauthorized or unvalidated clinical claim is not an insight. The server
 * issues claims only from its own facts: trend_evidence[] (buildTrendEvidence)
 * and the existing reference-range classifier. Model output never issues,
 * strengthens or adds a claim; it is audited against the set and otherwise
 * ignored. The Basic preview and locked counts are selected from the claim set
 * alone, so model content can neither fill a preview slot nor inflate a count.
 *
 * Server gating may reduce visibility, never expand it. Every step below is a
 * filter over what buildBasicProjection already emitted, or a selection over
 * entries the existing selector already treated as eligible (trend_evidence).
 * BASIC_KEYS, tiers and entitlement are untouched.
 *
 * Legacy rows (no known policy version) are not rewritten. Their stored preview
 * and counts cannot be traced to a claim, so reads serve neither. Pure — no
 * Deno, no network, no clock.
 */
import type { MovementLanguage } from "./clinical-movement-policy.generated.ts";
import { FLOOR_FINDING_KEYS, FLOOR_REQUIRED_KEYS, findFloorViolations, type InterpretationPayload } from "./response-shaping.ts";
import { SAFETY_KEYS, buildBasicProjection, isDeterministicSource } from "./interpretation-visibility.ts";
import { contentFingerprint, selectPremiumPreview, type CatalogFinding, type LockedCounts } from "./preview-selector.ts";
import { isAbnormalStatus } from "./tier.ts";
import type { TrendEvidence } from "./trend-evidence.ts";

export const CLAIM_POLICY_VERSION = "v2-03c.1" as const;
/** Versions a reader may trust. Anything else, including absence, is legacy. */
export const KNOWN_CLAIM_POLICY_VERSIONS: readonly string[] = Object.freeze([CLAIM_POLICY_VERSION]);

/** json_output keys only the server writes. A model payload never supplies one. */
export const SERVER_OWNED_KEYS = Object.freeze(["trend_evidence", "findings", "clinical_claims", "claim_audit"] as const);

/** The existing classifier's vocabulary (generate-interpretation classifyAnalyte). */
export type ReferenceRangeStatus = "in_range" | "borderline" | "out_of_range" | "unknown";

export interface MeasuredStatus {
  biomarker_slug: string;
  marker: string;
  value: number;
  unit: string | null;
  status: ReferenceRangeStatus;
}

interface ClaimProvenance {
  claim_id: string;
  policy_version: typeof CLAIM_POLICY_VERSION;
  recommendation_authority: "none";
}

/** A measured change between two reports, as the server computed it. */
export interface TrendClaim extends ClaimProvenance {
  category: "factual_observation";
  rule: "trend_evidence.significant_change";
  /** JSON pointer to the server's own trend_evidence entry in json_output. */
  source_path: string;
  fact: TrendEvidence;
  /** Same shape as the generated movement policy's authority. */
  authority: MovementLanguage["authority"];
  safety_authority: "none";
}

/** A value outside its lab reference range, by the existing classifier. Its
 * only effect on projection is to withhold: it excludes the marker's trend from
 * preview and counts, and is the only thing that lets a safety flag survive. */
export interface SafetyClaim extends ClaimProvenance {
  category: "safety_alert";
  rule: "analyte.reference_range_status";
  fact: { biomarker_slug: string; value: number; unit: string | null; status: "out_of_range" };
  authority: { kind: "lab_reference_range"; subject: string; current: number; unit: string };
  safety_authority: "deterministic_reference_range";
}

export type AuthorizedClaim = TrendClaim | SafetyClaim;

export interface ClaimSet {
  policy_version: typeof CLAIM_POLICY_VERSION;
  claims: AuthorizedClaim[];
}

/** What a preview carries about its claim. No fact beyond its content. */
export interface ClaimReference {
  claim_id: string;
  category: "factual_observation";
  rule: TrendClaim["rule"];
  policy_version: string;
  recommendation_authority: "none";
  safety_authority: "none";
}

export type ClaimCatalogFinding = CatalogFinding & { claim: ClaimReference };

export interface ProposalOutcome {
  path: string;
  outcome: "superseded_by_claim" | "rejected";
  reason: "restates_trend_claim" | "corroborates_safety_claim" | "no_authority" | "values_disagree"
    | "recommendation_without_authority" | "safety_without_authority" | "narrative_without_authority";
  claim_id?: string;
}

const EMPTY_LOCKED: LockedCounts = Object.freeze({ patterns: 0, cross_report: 0, lifestyle: 0 });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/* ── Issuance: server facts only ─────────────────────────────────────────── */

function trendClaim(entry: unknown, index: number): TrendClaim | null {
  if (!isRecord(entry)) return null;
  const e = entry as unknown as TrendEvidence;
  if (!nonEmpty(e.biomarker_slug) || !nonEmpty(e.marker) || !finite(e.previous_value) || !finite(e.current_value)
    || !finite(e.delta) || e.delta === 0 || (e.unit !== null && typeof e.unit !== "string")
    || e.direction !== (e.current_value > e.previous_value ? "increased" : "decreased")
    || e.current_value === e.previous_value) return null;
  return {
    claim_id: `trend:${e.biomarker_slug}`, policy_version: CLAIM_POLICY_VERSION,
    category: "factual_observation", rule: "trend_evidence.significant_change",
    source_path: `/trend_evidence/${index}`, fact: e,
    authority: { kind: "lab_data", subject: e.marker, previous: e.previous_value, current: e.current_value, unit: e.unit ?? "" },
    recommendation_authority: "none", safety_authority: "none",
  };
}

function safetyClaim(status: MeasuredStatus): SafetyClaim | null {
  if (status.status !== "out_of_range" || !nonEmpty(status.biomarker_slug) || !nonEmpty(status.marker)
    || !finite(status.value) || (status.unit !== null && typeof status.unit !== "string")) return null;
  return {
    claim_id: `safety:${status.biomarker_slug}`, policy_version: CLAIM_POLICY_VERSION,
    category: "safety_alert", rule: "analyte.reference_range_status",
    fact: { biomarker_slug: status.biomarker_slug, value: status.value, unit: status.unit, status: "out_of_range" },
    authority: { kind: "lab_reference_range", subject: status.marker, current: status.value, unit: status.unit ?? "" },
    recommendation_authority: "none", safety_authority: "deterministic_reference_range",
  };
}

function trendClaims(evidence: readonly unknown[]): TrendClaim[] {
  const seen = new Set<string>();
  return evidence.flatMap((entry, index) => {
    const claim = trendClaim(entry, index);
    if (!claim || seen.has(claim.claim_id)) return [];
    seen.add(claim.claim_id);
    return [claim];
  });
}

/**
 * The only issuer. Inputs are the server's trend_evidence and classifier
 * statuses; there is deliberately no parameter through which model output can
 * reach a claim. Out-of-range is the existing safety rule (the deterministic
 * writer maps it to "discuss"; borderline is "monitor", not safety).
 */
export function issueClaimSet(input: { trendEvidence: readonly TrendEvidence[]; statuses: readonly MeasuredStatus[] }): ClaimSet {
  const seen = new Set<string>();
  const safety = input.statuses.flatMap(status => {
    const claim = safetyClaim(status);
    if (!claim || seen.has(claim.claim_id)) return [];
    seen.add(claim.claim_id);
    return [claim];
  });
  return { policy_version: CLAIM_POLICY_VERSION, claims: [...trendClaims(input.trendEvidence), ...safety] };
}

export function safetySlugs(set: ClaimSet): Set<string> {
  return new Set(set.claims.flatMap(c => c.category === "safety_alert" ? [c.fact.biomarker_slug] : []));
}

/* ── Provenance validation of a stored set ───────────────────────────────── */

/**
 * The stored set is trusted only if it re-derives exactly: every trend claim
 * from json_output.trend_evidence (server-owned), every safety claim from its
 * own fact, a known policy version and no claim of any other kind. Any
 * disagreement fails closed to legacy handling (no preview, no counts).
 */
export function storedClaimSet(full: InterpretationPayload): ClaimSet | null {
  const stored = full.clinical_claims;
  if (!isRecord(stored) || typeof stored.policy_version !== "string"
    || !KNOWN_CLAIM_POLICY_VERSIONS.includes(stored.policy_version) || !Array.isArray(stored.claims)) return null;
  const evidence = Array.isArray(full.trend_evidence) ? full.trend_evidence : [];
  const trends = trendClaims(evidence);
  const storedTrends = stored.claims.filter(c => isRecord(c) && c.category === "factual_observation");
  if (contentFingerprint(storedTrends) !== contentFingerprint(trends)) return null;
  const safety: SafetyClaim[] = [];
  for (const c of stored.claims) {
    if (isRecord(c) && c.category === "factual_observation") continue;
    if (!isRecord(c) || c.category !== "safety_alert" || !isRecord(c.fact) || !isRecord(c.authority)) return null;
    const fact = c.fact as SafetyClaim["fact"];
    const reissued = safetyClaim({ biomarker_slug: fact.biomarker_slug, marker: c.authority.subject as string,
      value: fact.value, unit: fact.unit, status: fact.status });
    if (!reissued || contentFingerprint(reissued) !== contentFingerprint(c)) return null;
    safety.push(reissued);
  }
  return { policy_version: CLAIM_POLICY_VERSION, claims: [...trends, ...safety] };
}

/* ── Claim catalog and model-proposal audit ──────────────────────────────── */

/**
 * Catalog entries for trend claims only, in the selector's existing shape. A
 * trend on a marker with a safety claim is floor: never a preview, never
 * counted. The payload must hold the claim's fact at its path, verbatim.
 * observed_at is null: every claim shares the report date, so it never
 * decides a tie, and the stored catalog equals the one projection recomputes.
 */
export function claimCatalog(full: InterpretationPayload, set: ClaimSet): ClaimCatalogFinding[] {
  const safety = safetySlugs(set);
  const evidence = Array.isArray(full.trend_evidence) ? full.trend_evidence : [];
  return set.claims.flatMap(claim => {
    if (claim.category !== "factual_observation") return [];
    const index = Number(claim.source_path.slice("/trend_evidence/".length));
    if (contentFingerprint(evidence[index]) !== contentFingerprint(claim.fact)) return [];
    const floor = safety.has(claim.fact.biomarker_slug);
    return [{
      source_path: claim.source_path, content: claim.fact,
      kind: floor ? "floor" as const : "trend" as const,
      ...(floor ? {} : { preview_eligible: true }),
      confidence: null,
      magnitude_normalized: finite(claim.fact.percent_change) ? Math.abs(claim.fact.percent_change) / 100 : null,
      observed_at: null,
      visibility_hint: floor ? "basic" as const : "premium" as const,
      claim: { claim_id: claim.claim_id, category: claim.category, rule: claim.rule, policy_version: claim.policy_version,
        recommendation_authority: claim.recommendation_authority, safety_authority: claim.safety_authority },
    }];
  });
}

const FLAG_KEYS = /^(abnormal|is_abnormal|safety|safety_related|is_safety|critical|urgent)$/;
const STATUS_KEYS = /^(flag|flagged|status|current_status)$/;
const assertsAbnormal = (key: string, value: unknown) =>
  (FLAG_KEYS.test(key) && value === true) || (STATUS_KEYS.test(key) && isAbnormalStatus(value));

/**
 * What the model proposed, and what became of it. Paths and reasons only, no
 * prose. A proposal is never itself a claim: at most it restates one the server
 * issued, and then only the server's claim enters projection.
 */
export function auditModelProposals(payload: InterpretationPayload, set: ClaimSet): ProposalOutcome[] {
  const trends = new Map(set.claims.flatMap(c => c.category === "factual_observation" ? [[c.fact.biomarker_slug, c] as const] : []));
  const safety = safetySlugs(set);
  const out: ProposalOutcome[] = [];
  const each = (key: string, visit: (value: unknown, path: string) => void) => {
    const value = payload[key];
    if (Array.isArray(value)) value.forEach((entry, index) => visit(entry, `/${key}/${index}`));
  };
  each("pattern_signals", (value, path) => {
    const record = isRecord(value) ? value : {};
    const claim = typeof record.trend_biomarker === "string" ? trends.get(record.trend_biomarker) : undefined;
    if (!claim) {
      out.push({ path, outcome: "rejected", reason: "no_authority" });
      return;
    }
    const disagrees = (["previous_value", "current_value"] as const).some(k =>
      record[k] !== undefined && record[k] !== claim.fact[k]);
    out.push(disagrees ? { path, outcome: "rejected", reason: "values_disagree", claim_id: claim.claim_id }
      : { path, outcome: "superseded_by_claim", reason: "restates_trend_claim", claim_id: claim.claim_id });
  });
  for (const key of ["what_you_can_do_now", "what_to_do_next"]) {
    each(key, (_, path) => out.push({ path, outcome: "rejected", reason: "recommendation_without_authority" }));
  }
  for (const key of [...FLOOR_FINDING_KEYS, ...SAFETY_KEYS.filter(k => k !== "what_to_do_next")]) {
    each(key, (value, path) => {
      if (!isRecord(value) || !Object.entries(value).some(([k, v]) => assertsAbnormal(k, v))) return;
      const slug = value.biomarker_slug;
      out.push(typeof slug === "string" && safety.has(slug)
        ? { path, outcome: "superseded_by_claim", reason: "corroborates_safety_claim", claim_id: `safety:${slug}` }
        : { path, outcome: "rejected", reason: "safety_without_authority" });
    });
  }
  for (const key of ["primary_concern", "overall_interpretation"]) {
    if (payload[key] != null) out.push({ path: `/${key}`, outcome: "rejected", reason: "narrative_without_authority" });
  }
  return out;
}

/**
 * The persisted full body: the shaped payload with every server-owned key
 * replaced by the server's own value, so a model-supplied trend_evidence,
 * findings or claim set can never reach storage. A deterministic payload is
 * server-authored floor and is not audited.
 */
export function withClaimAuthority(payload: InterpretationPayload, input: {
  source: string; trendEvidence: readonly TrendEvidence[]; statuses: readonly MeasuredStatus[];
}): InterpretationPayload {
  const full: InterpretationPayload = Object.fromEntries(Object.entries(payload)
    .filter(([key]) => !(SERVER_OWNED_KEYS as readonly string[]).includes(key)));
  if (input.trendEvidence.length > 0) full.trend_evidence = [...input.trendEvidence];
  const set = issueClaimSet(input);
  full.findings = claimCatalog(full, set);
  full.clinical_claims = set;
  full.claim_audit = isDeterministicSource(input.source) ? [] : auditModelProposals(payload, set);
  return full;
}

/* ── Projection ──────────────────────────────────────────────────────────── */

/** Keep an entry's safety assertion only where a safety claim backs it. */
function withoutUnauthorizedSafety(entry: unknown, safety: ReadonlySet<string>): unknown | null {
  if (!isRecord(entry)) return entry;
  const backed = typeof entry.biomarker_slug === "string" && safety.has(entry.biomarker_slug);
  const kept = Object.fromEntries(Object.entries(entry).filter(([key, value]) =>
    !(FLAG_KEYS.test(key) || STATUS_KEYS.test(key)) || (backed && assertsAbnormal(key, value))));
  return Object.keys(kept).length ? kept : null;
}

/**
 * Basic for a row with a validated claim set. The floor is buildBasicProjection
 * with no catalog; then, reductions only:
 *  - AI/unknown sources: a safety flag or status survives only on a marker with
 *    a safety claim (model prose cannot manufacture safety authority);
 *  - flagged_trends keeps a line only for a marker with a safety claim;
 *  - preview and locked come from the claim catalog alone.
 */
export function buildAuthorizedBasicProjection(
  full: InterpretationPayload, set: ClaimSet, provenance: { source?: string | null } = {},
): InterpretationPayload {
  const basic = buildBasicProjection(full, [], provenance);
  const safety = safetySlugs(set);
  if (!isDeterministicSource(provenance.source)) {
    for (const key of [...FLOOR_FINDING_KEYS, ...SAFETY_KEYS, "safety_findings"]) {
      if (Array.isArray(basic[key])) {
        basic[key] = (basic[key] as unknown[]).flatMap(entry => withoutUnauthorizedSafety(entry, safety) ?? []);
      }
    }
    basic.safety_findings = (basic.safety_findings as unknown[]).filter(entry =>
      isRecord(entry) && typeof entry.biomarker_slug === "string" && safety.has(entry.biomarker_slug));
  }
  if (Array.isArray(basic.flagged_trends)) {
    const kept = basic.flagged_trends.filter(line => isRecord(line) && safety.has(line.biomarker_slug as string));
    if (kept.length) basic.flagged_trends = kept;
    else delete basic.flagged_trends;
  }
  const catalog = claimCatalog(full, set);
  const selection = selectPremiumPreview({
    findings: catalog,
    floorKeys: [...FLOOR_REQUIRED_KEYS, ...FLOOR_FINDING_KEYS, ...SAFETY_KEYS],
    floorPaths: new Set(),
    floorContentFingerprints: new Set(),
    abnormalOrSafetyPaths: new Set(catalog.filter(f => f.kind === "floor").map(f => f.source_path)),
    ineligiblePaths: new Set(),
  });
  basic.preview = selection.preview;
  basic.locked = { ...selection.locked, claim_policy_version: set.policy_version };
  if (findFloorViolations(basic).length) throw new Error("Invalid Basic medical floor");
  return basic;
}

/**
 * Basic for any stored full body. A validated claim set selects preview and
 * counts; anything else is legacy and gets the unchanged floor with neither.
 */
export function projectBasic(full: InterpretationPayload, provenance: { source?: string | null } = {}): InterpretationPayload {
  const set = storedClaimSet(full);
  if (set) return buildAuthorizedBasicProjection(full, set, provenance);
  return { ...buildBasicProjection(full, undefined, provenance), preview: null, locked: { ...EMPTY_LOCKED } };
}

const count = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;

function claimPreview(value: unknown): ClaimCatalogFinding | null {
  if (!isRecord(value) || value.kind !== "trend" || !isRecord(value.content) || !isRecord(value.claim)) return null;
  const claim = value.claim;
  return typeof claim.policy_version === "string" && KNOWN_CLAIM_POLICY_VERSIONS.includes(claim.policy_version)
    && claim.category === "factual_observation" && claim.rule === "trend_evidence.significant_change"
    && claim.recommendation_authority === "none" && claim.safety_authority === "none"
    ? value as unknown as ClaimCatalogFinding : null;
}

/**
 * The preview and counts a stored Basic body may show. Only a body compiled
 * under a known claim policy has either; a legacy body's were chosen from
 * unvalidated model content, so they are withheld, not reinterpreted. The
 * stored row is never modified.
 */
export function visibleClaimProjection(basic: InterpretationPayload): { preview: ClaimCatalogFinding | null; locked: LockedCounts } {
  const locked = basic.locked;
  if (!isRecord(locked) || typeof locked.claim_policy_version !== "string"
    || !KNOWN_CLAIM_POLICY_VERSIONS.includes(locked.claim_policy_version)) {
    return { preview: null, locked: { ...EMPTY_LOCKED } };
  }
  return { preview: claimPreview(basic.preview),
    locked: { patterns: count(locked.patterns), cross_report: count(locked.cross_report), lifestyle: count(locked.lifestyle) } };
}

/** A Basic body as served: its preview/locked are exactly the gated top-level ones. */
export function servedBasic(basic: InterpretationPayload): InterpretationPayload {
  return { ...basic, ...visibleClaimProjection(basic) };
}
