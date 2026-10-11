import { describe, expect, it, vi } from 'vitest';
import {
  isHistoryProtected,
  LEGACY_REMEDIATION_MODE,
  parseRemediationRequest,
  RemediationAppendError,
  remediationErrorResponse,
  remediationServedBody,
  runLegacyRemediation,
  type RemediationActions,
  type RemediationEligibility,
  type RemediationOutput,
  type RemediationVersion,
} from './legacy-remediation';

/**
 * Remediation exists to give a claim holder a current-policy interpretation
 * without touching history. The wrong outcomes worth pinning: model spend for an
 * ineligible or already-served request, a write after a failed generation, a
 * deterministic fallback stored as the remediation, and a refusal that says why.
 */

const USER = 'user-1';
const REPORT = 'report-1';
const REQUEST = '0a8b4d6e-1f2a-4b3c-8d9e-0f1a2b3c4d5e';
const HISTORY = 'history-1';
const input = { userId: USER, reportId: REPORT, requestId: REQUEST };

const eligible: RemediationEligibility = { eligible: true, historyId: HISTORY, claimId: 'claim-1' };
const notEligible: RemediationEligibility = { eligible: false, historyId: null, claimId: null };

const output = (overrides: Partial<RemediationOutput> = {}): RemediationOutput => ({
  full: { headline: 'current policy' },
  basic: { headline: 'basic' },
  depth: 'deep',
  source: 'ai',
  provenance: { mode: LEGACY_REMEDIATION_MODE },
  ...overrides,
});

const version = (overrides: Partial<RemediationVersion> = {}): RemediationVersion => ({
  versionId: 'version-1',
  historicalInterpretationId: HISTORY,
  generatedAt: '2026-10-11T00:00:00Z',
  full: { headline: 'current policy' },
  basic: { headline: 'basic' },
  ...overrides,
});

function fakeActions(opts: {
  eligibility?: RemediationEligibility | Error;
  existing?: RemediationVersion | null;
  twin?: RemediationVersion | null;
  generated?: RemediationOutput | null | Error;
  append?: RemediationVersion | Error;
} = {}) {
  let lookups = 0;
  const actions = {
    evaluate: vi.fn(async () => {
      if (opts.eligibility instanceof Error) throw opts.eligibility;
      return opts.eligibility ?? eligible;
    }),
    findVersion: vi.fn(async () => (lookups++ === 0 ? opts.existing ?? null : opts.twin ?? null)),
    generate: vi.fn(async () => {
      if (opts.generated instanceof Error) throw opts.generated;
      return opts.generated === undefined ? output() : opts.generated;
    }),
    append: vi.fn(async () => {
      if (opts.append instanceof Error) throw opts.append;
      return opts.append ?? version();
    }),
  } satisfies RemediationActions;
  return actions;
}

describe('parseRemediationRequest', () => {
  it('leaves a body without mode on the ordinary path', () => {
    expect(parseRemediationRequest({ reportId: REPORT })).toEqual({ kind: 'ordinary' });
    expect(parseRemediationRequest(null)).toEqual({ kind: 'ordinary' });
  });

  it('accepts the remediation mode with a UUID request id, normalised', () => {
    expect(parseRemediationRequest({ mode: LEGACY_REMEDIATION_MODE, request_id: REQUEST.toUpperCase() }))
      .toEqual({ kind: 'remediation', requestId: REQUEST });
  });

  it('refuses an unknown mode or a missing or malformed request id', () => {
    expect(parseRemediationRequest({ mode: 'remediate' , request_id: REQUEST })).toEqual({ kind: 'invalid' });
    expect(parseRemediationRequest({ mode: LEGACY_REMEDIATION_MODE })).toEqual({ kind: 'invalid' });
    expect(parseRemediationRequest({ mode: LEGACY_REMEDIATION_MODE, request_id: 'retry-1' })).toEqual({ kind: 'invalid' });
    expect(parseRemediationRequest({ mode: LEGACY_REMEDIATION_MODE, request_id: 7 })).toEqual({ kind: 'invalid' });
  });
});

describe('runLegacyRemediation — before the model', () => {
  it('an ineligible report spends nothing and writes nothing', async () => {
    const actions = fakeActions({ eligibility: notEligible });
    expect(await runLegacyRemediation(actions, input)).toEqual({ status: 'not_available' });
    expect(actions.findVersion).not.toHaveBeenCalled();
    expect(actions.generate).not.toHaveBeenCalled();
    expect(actions.append).not.toHaveBeenCalled();
  });

  it('an eligibility answer without history or claim identity is not eligible', async () => {
    for (const partial of [{ ...eligible, historyId: null }, { ...eligible, claimId: null }]) {
      const actions = fakeActions({ eligibility: partial });
      expect(await runLegacyRemediation(actions, input)).toEqual({ status: 'not_available' });
      expect(actions.generate).not.toHaveBeenCalled();
    }
  });

  it('a failed eligibility lookup fails closed, before any model spend', async () => {
    const actions = fakeActions({ eligibility: new Error('db down') });
    expect(await runLegacyRemediation(actions, input)).toEqual({ status: 'failed', stage: 'eligibility' });
    expect(actions.generate).not.toHaveBeenCalled();
    expect(actions.append).not.toHaveBeenCalled();
  });

  it('a committed request is returned without calling the model', async () => {
    const existing = version();
    const actions = fakeActions({ existing });
    expect(await runLegacyRemediation(actions, input)).toEqual({ status: 'served', version: existing, created: false });
    expect(actions.findVersion).toHaveBeenCalledWith(REPORT, REQUEST);
    expect(actions.generate).not.toHaveBeenCalled();
    expect(actions.append).not.toHaveBeenCalled();
  });

  it('never serves a version anchored on a different history', async () => {
    const actions = fakeActions({ existing: version({ historicalInterpretationId: 'other-history' }) });
    expect(await runLegacyRemediation(actions, input)).toEqual({ status: 'failed', stage: 'lookup' });
    expect(actions.generate).not.toHaveBeenCalled();
  });
});

describe('runLegacyRemediation — generation and commit', () => {
  it('a failed or throwing model writes nothing', async () => {
    for (const generated of [null, new Error('timeout')]) {
      const actions = fakeActions({ generated });
      expect(await runLegacyRemediation(actions, input)).toEqual({ status: 'failed', stage: 'generation' });
      expect(actions.append).not.toHaveBeenCalled();
    }
  });

  it('a deterministic fallback or a non-deep result is never stored as the remediation', async () => {
    for (const generated of [output({ source: 'fallback', depth: 'standard' }), output({ depth: 'standard' })]) {
      const actions = fakeActions({ generated });
      expect(await runLegacyRemediation(actions, input)).toEqual({ status: 'failed', stage: 'policy' });
      expect(actions.append).not.toHaveBeenCalled();
    }
  });

  it('commits exactly the pipeline output through the append action, once', async () => {
    const generated = output();
    const actions = fakeActions({ generated });
    expect(await runLegacyRemediation(actions, input)).toEqual({ status: 'served', version: version(), created: true });
    expect(actions.append).toHaveBeenCalledTimes(1);
    expect(actions.append).toHaveBeenCalledWith({ userId: USER, reportId: REPORT, requestId: REQUEST, output: generated });
  });

  it('a commit-time refusal is not available, not a failure', async () => {
    const actions = fakeActions({ append: new RemediationAppendError('P0490') });
    expect(await runLegacyRemediation(actions, input)).toEqual({ status: 'not_available' });
  });

  it('a concurrent twin that committed this request first is served', async () => {
    const twin = version({ versionId: 'version-twin' });
    const actions = fakeActions({ append: new RemediationAppendError('22023'), twin });
    expect(await runLegacyRemediation(actions, input)).toEqual({ status: 'served', version: twin, created: false });
  });

  it('every other refusal fails without a fallback', async () => {
    for (const append of [new RemediationAppendError('22023'), new RemediationAppendError('40001'),
      new RemediationAppendError('23514'), new Error('network')]) {
      const actions = fakeActions({ append });
      expect(await runLegacyRemediation(actions, input)).toEqual({ status: 'failed', stage: 'append' });
    }
  });
});

describe('responses', () => {
  it('refusals carry a stable code and never the reason', () => {
    expect(remediationErrorResponse({ status: 'not_available' }))
      .toEqual({ status: 404, body: { error: 'remediation_not_available' } });
    const bodies = (['eligibility', 'lookup', 'generation', 'policy', 'append'] as const)
      .map(stage => remediationErrorResponse({ status: 'failed', stage }));
    for (const response of bodies) {
      expect(response).toEqual({ status: 503, body: { error: 'remediation_failed', retryable: true } });
    }
  });

  it('a served body names the historical source and the version separately', () => {
    const body = remediationServedBody(version(), true);
    expect(body).toMatchObject({
      success: true, access: 'full', reused: false,
      interpretation: version().full,
      historical_interpretation_id: HISTORY,
      version: { id: 'version-1', generated_at: '2026-10-11T00:00:00Z' },
    });
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('generated_at');
  });

  it('recognises the history guard by SQLSTATE only', () => {
    expect(isHistoryProtected({ code: '55000' })).toBe(true);
    expect(isHistoryProtected({ code: '23503' })).toBe(false);
    expect(isHistoryProtected(null)).toBe(false);
  });
});
