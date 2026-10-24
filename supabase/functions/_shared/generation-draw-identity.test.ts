import { describe, expect, it } from 'vitest';
import { fingerprintAnalytes, hashDrawKey } from './blood-draw-identity';
import { resolveGenerationDrawIdentity, type GenerationDrawIdentityActions } from './generation-draw-identity';

/**
 * RV-GI2. F032: the upload is hashed only from the caller's own folder. F042:
 * the draw key is bound to the analytes the interpretation is generated from.
 * Synthetic ids, bytes and values only.
 */

const USER = '0a8b4d6e-1f2a-4b3c-8d9e-0000000000aa';
const OTHER_USER = '0a8b4d6e-1f2a-4b3c-8d9e-0000000000bb';
const REPORT = '0a8b4d6e-1f2a-4b3c-8d9e-000000000101';
const BYTES = 'synthetic lab file bytes';
const OWNED = `${USER}/1730000000000.pdf`;

const TSH = {
  id: 'a1', raw_name: 'TSH', canonical_slug: 'tsh', value_numeric: 2.1, raw_value_text: '2.1', unit: 'mIU/L',
  raw_reference_range: '0.4-4.0', normalized_min: 0.4, normalized_max: 4, normalized_operator: null,
  normalized_operator_value: null, is_core: true,
};
const FERRITIN = {
  id: 'a2', raw_name: 'Ferritin', canonical_slug: 'ferritin', value_numeric: 18, raw_value_text: '18', unit: 'ng/mL',
  raw_reference_range: '16-154', normalized_min: 16, normalized_max: 154, normalized_operator: null,
  normalized_operator_value: null, is_core: false,
};
const ANALYTES = [TSH, FERRITIN];

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function port(stored: { file_url: string | null; content_hash: string | null } | null, objects: Record<string, string> = {}) {
  const calls = { downloads: [] as string[], saves: [] as [string, string][] };
  const actions: GenerationDrawIdentityActions = {
    async readReportFile(reportId) {
      expect(reportId).toBe(REPORT);
      return stored;
    },
    async downloadOwnedObject(path) {
      calls.downloads.push(path);
      if (!(path in objects)) throw new Error('synthetic: object not found');
      return new TextEncoder().encode(objects[path]).buffer as ArrayBuffer;
    },
    async saveContentHash(reportId, contentHash) {
      calls.saves.push([reportId, contentHash]);
    },
  };
  return { actions, calls };
}

const resolve = (actions: GenerationDrawIdentityActions, analytes: readonly object[] = ANALYTES) =>
  resolveGenerationDrawIdentity(actions, { userId: USER, reportId: REPORT, analytes });

describe('resolveGenerationDrawIdentity — F032: only her own file is read', () => {
  it.each([
    `${OTHER_USER}/1.pdf`,
    '../x',
    '%2e%2e/x',
    `${USER}/../${OTHER_USER}/1.pdf`,
    `https://example.supabase.co/storage/v1/object/public/avatars/${USER}/1.pdf`,
    `https://example.supabase.co/storage/v1/object/public/lab-files/${OTHER_USER}/1.pdf`,
    '   ',
  ])('refuses %j: no download, no hash write, and a fixed reason', async (fileUrl) => {
    // The object exists: the refusal must not depend on whether it does.
    const { actions, calls } = port({ file_url: fileUrl, content_hash: null },
      { [fileUrl.trim()]: BYTES, [`${OTHER_USER}/1.pdf`]: BYTES });
    const error = await resolve(actions).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^Report file is not in the caller's folder \((foreign|unrecognized)\)$/);
    expect((error as Error).message).not.toContain(OTHER_USER);
    expect(calls.downloads).toEqual([]);
    expect(calls.saves).toEqual([]);
  });

  it('treats an empty file_url as no file, as before: no download, no write, keyed to the report', async () => {
    const { actions, calls } = port({ file_url: '', content_hash: null }, { '': BYTES });
    const identity = await resolve(actions);
    expect(identity.evidenceTier).toBe('unidentified');
    expect(identity.legacyBloodDrawId).toBe(await hashDrawKey(`report:${REPORT}`));
    expect(calls.downloads).toEqual([]);
    expect(calls.saves).toEqual([]);
  });

  it.each([
    OWNED,
    `/${OWNED}`,
    `  ${OWNED}  `,
    `https://example.supabase.co/storage/v1/object/public/lab-files/${OWNED}`,
    `https://example.supabase.co/storage/v1/object/authenticated/lab-files/${OWNED}`,
  ])('downloads %j once, as the mapped path, and saves its hash', async (fileUrl) => {
    // An object stored under the raw reference must never be the one hashed.
    const { actions, calls } = port({ file_url: fileUrl, content_hash: null }, { [fileUrl]: 'other bytes', [OWNED]: BYTES });
    const identity = await resolve(actions);
    const contentHash = await sha256Hex(BYTES);
    expect(calls.downloads).toEqual([OWNED]);
    expect(calls.saves).toEqual([[REPORT, contentHash]]);
    expect(identity.evidenceTier).toBe('content_hash');
    expect(identity.legacyBloodDrawId).toBe(await hashDrawKey(`sha256:${contentHash}`));
  });

  it('uses a stored hash as is: no download, no write', async () => {
    const { actions, calls } = port({ file_url: `${OTHER_USER}/1.pdf`, content_hash: 'c'.repeat(64) });
    const identity = await resolve(actions);
    expect(identity.legacyBloodDrawId).toBe(await hashDrawKey(`sha256:${'c'.repeat(64)}`));
    expect(calls.downloads).toEqual([]);
    expect(calls.saves).toEqual([]);
  });

  it('propagates a failed download of her own file and saves nothing', async () => {
    const { actions, calls } = port({ file_url: OWNED, content_hash: null });
    await expect(resolve(actions)).rejects.toThrow('synthetic: object not found');
    expect(calls.downloads).toEqual([OWNED]);
    expect(calls.saves).toEqual([]);
  });

  it('keys a report whose row is gone to the report, as before', async () => {
    const { actions, calls } = port(null);
    const identity = await resolve(actions);
    expect(identity.evidenceTier).toBe('unidentified');
    expect(calls.downloads).toEqual([]);
  });
});

describe('resolveGenerationDrawIdentity — F042: the key is bound to the analytes', () => {
  it('returns the analyte-bound id, the pre-binding id and the evidence tier', async () => {
    const { actions } = port({ file_url: OWNED, content_hash: 'c'.repeat(64) });
    const fingerprint = await fingerprintAnalytes(ANALYTES);
    expect(await resolve(actions)).toEqual({
      bloodDrawId: await hashDrawKey(`sha256:${'c'.repeat(64)}:analytes:${fingerprint}`),
      legacyBloodDrawId: await hashDrawKey(`sha256:${'c'.repeat(64)}`),
      evidenceTier: 'content_hash',
    });
  });

  it('binds the per-report key too, when there is no file', async () => {
    const { actions } = port({ file_url: null, content_hash: null });
    const fingerprint = await fingerprintAnalytes(ANALYTES);
    expect(await resolve(actions)).toEqual({
      bloodDrawId: await hashDrawKey(`report:${REPORT}:analytes:${fingerprint}`),
      legacyBloodDrawId: await hashDrawKey(`report:${REPORT}`),
      evidenceTier: 'unidentified',
    });
  });

  it('the same rows in another order are the same draw; another value is another draw, same legacy id', async () => {
    const { actions } = port({ file_url: OWNED, content_hash: 'c'.repeat(64) });
    const original = await resolve(actions);
    expect(await resolve(actions, [FERRITIN, TSH])).toEqual(original);
    const edited = await resolve(actions, [{ ...TSH, value_numeric: 9, raw_value_text: '9' }, FERRITIN]);
    expect(edited.bloodDrawId).not.toBe(original.bloodDrawId);
    expect(edited.legacyBloodDrawId).toBe(original.legacyBloodDrawId);
  });
});
