import type { FindingMetadata } from "./finding-metadata.ts";

export type CatalogFinding = FindingMetadata & { source_path: string; content: unknown };
export type LockedCounts = { patterns: number; cross_report: number; lifestyle: number };
export type PreviewSelection = { preview: CatalogFinding | null; locked: LockedCounts };

/** Stable across object insertion order; also used to exclude floor duplicates. */
export function contentFingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(contentFingerprint).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${JSON.stringify(k)}:${contentFingerprint(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function pathWithin(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}/`);
}

export function selectPremiumPreview(input: {
  findings: readonly CatalogFinding[];
  floorKeys: readonly string[];
  floorPaths: ReadonlySet<string>;
  floorContentFingerprints: ReadonlySet<string>;
  abnormalOrSafetyPaths: ReadonlySet<string>;
  ineligiblePaths: ReadonlySet<string>;
}): PreviewSelection {
  const priorities: Record<string, number> = { trend: 0, cross_marker: 1, lifestyle: 2 };
  const excluded = [...input.floorPaths, ...input.abnormalOrSafetyPaths, ...input.ineligiblePaths,
    ...input.floorKeys.map(key => `/${key}`)];
  const number = (n: unknown) => typeof n === "number" && Number.isFinite(n) ? n : -Infinity;
  const confidence = (n: unknown) => typeof n === "number" && n >= 0 && n <= 1 ? number(n) : -Infinity;
  const time = (date: unknown) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}(T|$)/.test(date)
    && Number.isFinite(Date.parse(date)) ? Date.parse(date) : -Infinity;
  const compare = (a: number, b: number) => a === b ? 0 : a > b ? -1 : 1;
  const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const candidates = input.findings.filter(f => f && Object.hasOwn(priorities, f.kind)
    && f.visibility_hint === "premium" && typeof f.source_path === "string"
    && /^\/(?:[^~/]|~[01])+(?:\/(?:[^~/]|~[01])+)*$/.test(f.source_path)
    && f.content != null && f.content !== ""
    && !excluded.some(path => pathWithin(f.source_path, path))
    && !input.floorContentFingerprints.has(contentFingerprint(f.content)))
    .sort((a, b) => priorities[a.kind] - priorities[b.kind]
      || compare(confidence(a.confidence), confidence(b.confidence))
      || compare(number(a.magnitude_normalized), number(b.magnitude_normalized))
      || compare(time(a.observed_at), time(b.observed_at))
      || lexical(a.source_path, b.source_path)
      || lexical(contentFingerprint(a.content), contentFingerprint(b.content)));
  const seen = new Set<string>();
  const unique = candidates.filter(f => {
    const fingerprint = contentFingerprint(f.content);
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
  const preview = unique.shift() ?? null;
  const locked: LockedCounts = { patterns: 0, cross_report: 0, lifestyle: 0 };
  for (const f of unique) {
    if (f.kind === "trend") locked.cross_report++;
    if (f.kind === "cross_marker") locked.patterns++;
    if (f.kind === "lifestyle") locked.lifestyle++;
  }
  return { preview, locked };
}
