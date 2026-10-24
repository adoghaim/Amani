/**
 * The draw an activated Free generation is metered by (RV-GI2).
 *
 * F032: generate-interpretation reads Storage with the service role, and it
 * used to download whatever the report's `file_url` named and store the hash
 * where the caller can read it. The file is now hashed only when `file_url`
 * names an object in the caller's own folder (`resolveLabFileTarget`, the rule
 * report deletion uses). A foreign or unrecognised reference makes no Storage
 * call and writes nothing: the request ends in the handler's fixed 500, the
 * same answer whether or not the object exists, logged with a fixed reason.
 *
 * F042: a file hash names the upload, not the values the interpretation is
 * generated from, which the owner writes. The key binds the hash, or the
 * report when there is none, to `fingerprintAnalytes` of those rows. So another
 * report of the same bytes with other values, or a claimed report whose values
 * were edited, is another draw. `legacyBloodDrawId` is the key claims made
 * before this binding carry; `claimCoverage` accepts it only for the report it
 * was claimed from.
 *
 * Pure apart from the injected port. Web Crypto for the digests.
 */

import {
  deriveBloodDrawIdentity,
  fingerprintAnalytes,
  hashDrawKey,
  type EvidenceTier,
  type FingerprintedAnalyte,
} from "./blood-draw-identity.ts";
import { resolveLabFileTarget } from "./report-deletion.ts";

export interface GenerationDrawIdentityActions {
  /** The report's stored file reference and server-computed hash; null when the row is gone. */
  readReportFile(reportId: string): Promise<{ file_url: string | null; content_hash: string | null } | null>;
  /** One object of the lab-files bucket, by a path already proven to be in the caller's folder. */
  downloadOwnedObject(path: string): Promise<ArrayBuffer>;
  /** Stores the hash where `content_hash` is still null. */
  saveContentHash(reportId: string, contentHash: string): Promise<void>;
}

export interface GenerationDrawIdentity {
  /** Hashed key bound to the analytes: what this request looks up and claims. */
  bloodDrawId: string;
  /** Hashed key without the analytes: what a claim made before the binding carries. */
  legacyBloodDrawId: string;
  evidenceTier: EvidenceTier;
}

/** The fixed log reason; never the reference itself, which may name another user's object. */
export function labFileRefusal(kind: "foreign" | "unrecognized"): string {
  return `Report file is not in the caller's folder (${kind})`;
}

export async function resolveGenerationDrawIdentity(
  actions: GenerationDrawIdentityActions,
  input: { userId: string; reportId: string; analytes: readonly FingerprintedAnalyte[] },
): Promise<GenerationDrawIdentity> {
  const { userId, reportId } = input;
  const stored = await actions.readReportFile(reportId);
  let contentHash = stored?.content_hash ?? null;
  if (contentHash === null && stored?.file_url) {
    const target = resolveLabFileTarget(stored.file_url, userId);
    if (target.kind !== "owned") throw new Error(labFileRefusal(target.kind));
    contentHash = await sha256Hex(await actions.downloadOwnedObject(target.path));
    await actions.saveContentHash(reportId, contentHash);
  }

  const analyteFingerprint = await fingerprintAnalytes(input.analytes);
  const bound = deriveBloodDrawIdentity(null, { reportId, contentHash, analyteFingerprint });
  const legacy = deriveBloodDrawIdentity(null, { reportId, contentHash });
  return {
    bloodDrawId: await hashDrawKey(bound.key),
    legacyBloodDrawId: await hashDrawKey(legacy.key),
    evidenceTier: bound.tier,
  };
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
