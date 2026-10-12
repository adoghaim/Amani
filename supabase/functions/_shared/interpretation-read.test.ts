import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { readInterpretation as readWithFlag, type InterpretationReadActions } from './interpretation-read';
import { resolveEntitlement } from './entitlement';
import { legacyCustomerFloor, visibleClaimProjection } from './claim-authority';
import { buildBasicProjection, sanitizeBasicProjection } from './interpretation-visibility';
import type { InterpretationPayload } from './response-shaping';
const readInterpretation = (actions: InterpretationReadActions) => readWithFlag(actions, true);
const full = { headline: 'h', cycle_context: {}, questions_for_doctor: [], disclaimer: 'd', key_findings: [], private: 'full body' };
function actions(overrides: Partial<InterpretationReadActions> = {}): InterpretationReadActions {
  return { ownsReport: async () => true, resolveEntitlement: async () => ({ allowed: true, plan: 'free' }),
    readSelected: async premium => ({ json_output: premium ? full : buildBasicProjection(full), stored_depth: 'deep', has_claim: false, tier: 'free' }),
    countClaims: async () => 3, ...overrides };
}
describe('authoritative interpretation reads', () => {
  it('keeps deep Free rows Basic; upgrades and downgrades without rewriting', async () => {
    const basic = await readInterpretation(actions());
    expect(basic.body.access).toBe('basic');
    expect(basic.body.interpretation).not.toHaveProperty('private');
    expect(basic.body.complimentary).toEqual({ used: 3, total: 3, remaining: 0 });
    const premium = await readInterpretation(actions({ resolveEntitlement: async () => ({ allowed: true, plan: 'premium', reason: 'active_subscription', source: 'active_subscription' }) }));
    expect(premium.body.access).toBe('full');
    expect(premium.body.interpretation).toEqual(legacyCustomerFloor());
    expect(premium.body.complimentary).toEqual({ used: 3, total: 3, remaining: 0 });
    expect((await readInterpretation(actions())).body).toEqual(basic.body);
  });
  it('unlocks a committed claim, never credits merely remaining', async () => {
    const result = await readInterpretation(actions({ readSelected: async () => ({ json_output: full, stored_depth: 'deep', has_claim: true, tier: 'free' }) }));
    expect(result.body.access).toBe('full');
    expect((await readInterpretation(actions({ countClaims: async () => 0 }))).body.access).toBe('basic');
  });
  it('uses the TS sandbox + beta decision, even without onboarding', async () => {
    const entitlement = resolveEntitlement({ freemiumActive: true, onboarded: false, stripeStatus: null,
      trialStartDate: null, userId: 'u', now: Date.parse('2026-09-26'),
      iapRecords: [{ status: 'active', environment: 'sandbox', platform: 'ios', product_id: 'com.amani.health.premium.monthly', expires_at: '2027-01-01' }],
      betaTester: { user_id: 'u', platform: 'apple', enabled: true, expires_at: null } });
    const result = await readInterpretation(actions({ resolveEntitlement: async () => entitlement }));
    expect(result.body.access).toBe('full');
    expect(result.body.plan).toBe('premium');
  });
  it.each(['standard','unknown'])('requests generation for Premium %s depth', async stored_depth => {
    const result = await readInterpretation(actions({ resolveEntitlement: async () => ({ allowed: true, plan: 'premium', reason: 'complimentary', source: 'complimentary' }),
      readSelected: async () => ({ json_output: full, stored_depth, has_claim: false, tier: 'plus' }) }));
    expect(result.body.access).toBe('generation_needed');
    expect(result.body.stored_depth).toBe(stored_depth);
    expect(result.body.interpretation).not.toHaveProperty('private');
  });
  it('distinguishes missing generation, ownership denial and DB errors', async () => {
    expect((await readInterpretation(actions({ readSelected: async () => null }))).body.access).toBe('generation_needed');
    const read = vi.fn();
    expect((await readInterpretation(actions({ ownsReport: async () => false, readSelected: read }))).status).toBe(404);
    expect(read).not.toHaveBeenCalled();
    for (const key of ['ownsReport','resolveEntitlement','readSelected','countClaims'] as const) {
      const result = await readInterpretation(actions({ [key]: async () => { throw new Error('offline'); } }));
      expect(result).toMatchObject({ status: 503, body: { access: 'error', code: 'entitlement_unavailable', retryable: true, interpretation: null } });
    }
  });
  it('does not treat an entitlement error or legacy allowed result as Premium', async () => {
    const read = vi.fn();
    for (const entitlement of [{ allowed: false as const, reason: 'error' as const, detail: 'offline' }, { allowed: true as const, reason: 'trial' as const }]) {
      const result = await readInterpretation(actions({ resolveEntitlement: async () => entitlement, readSelected: read }));
      expect(result.status).toBe(503);
    }
    expect(read).not.toHaveBeenCalled();
  });
});

it.each([false, true])('quarantines floor-violating legacy Full without an infrastructure denial (claim=%s)', async has_claim => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const payload = { headline: 'Existing full narrative', private: 'paid content' };
    const result = await readInterpretation(actions({
      resolveEntitlement: async () => ({ allowed: true, plan: has_claim ? 'free' : 'premium' }),
      readSelected: async () => ({ json_output: payload, stored_depth: 'deep', has_claim, tier: 'plus' }),
    }));
    expect(result).toMatchObject({ status: 200, body: { access: 'full', interpretation: legacyCustomerFloor(), stored_depth: 'deep' } });
    expect(log).not.toHaveBeenCalled();
  } finally { log.mockRestore(); }
});

describe('Full readers of non-deep rows (read RPC returns interpretation_source)', () => {
  const deterministic = { headline: 'h', cycle_context: {}, questions_for_doctor: [], disclaimer: 'd',
    key_findings: [], top_findings: [], overall_interpretation: 'DETERMINISTIC_OVERALL',
    pattern_signals: [{ title: 'p', explanation: 'DETERMINISTIC_PATTERN' }] };
  const premium = async () => ({ allowed: true as const, plan: 'premium' as const,
    reason: 'active_subscription' as const, source: 'active_subscription' as const });
  const row = (has_claim: boolean, interpretation_source?: string | null) => async () => ({
    json_output: deterministic, stored_depth: 'standard', has_claim, tier: 'free',
    ...(interpretation_source === undefined ? {} : { interpretation_source }) });
  it.each(['fallback', 'deterministic'])('%s standard row: Premium and claimed readers receive the stored deterministic body', async source => {
    for (const overrides of [{ resolveEntitlement: premium, readSelected: row(false, source) }, { readSelected: row(true, source) }]) {
      const result = await readInterpretation(actions(overrides));
      expect(result.body.access).toBe('generation_needed');
      expect(result.body.interpretation).toEqual(deterministic);
    }
  });
  it.each(['ai', null, undefined])('source %s standard row receives the neutral legacy shell', async source => {
    const result = await readInterpretation(actions({ resolveEntitlement: premium, readSelected: row(false, source) }));
    expect(result.body.access).toBe('generation_needed');
    expect(result.body.interpretation).toEqual(legacyCustomerFloor());
    expect(JSON.stringify(result.body.interpretation)).not.toMatch(/DETERMINISTIC_(OVERALL|PATTERN)/);
  });
});

describe('explicit server dark gate', () => {
  it.each([false, true])('OFF quarantines owned legacy Full independent of claim=%s, depth, or legacy eligibility', async has_claim => {
    const entitlements = [
      { allowed: false as const, reason: 'trial_expired' as const },
      { allowed: false as const, reason: 'no_subscription' as const },
      { allowed: false as const, reason: 'onboarding_incomplete' as const },
      { allowed: true as const, reason: 'trial' as const },
      { allowed: true as const, reason: 'active_subscription' as const },
      { allowed: true as const, reason: 'active_iap' as const },
      { allowed: true as const, reason: 'complimentary' as const },
      { allowed: false as const, reason: 'error' as const, detail: 'offline' },
    ];
    for (const entitlement of entitlements) for (const stored_depth of ['deep', 'standard', 'unknown']) {
      const readSelected = vi.fn(async () => ({ json_output: full, stored_depth, has_claim, tier: 'free' }));
      const countClaims = vi.fn();
      const result = await readWithFlag(actions({ resolveEntitlement: async () => entitlement, readSelected, countClaims }), false);
      expect(result).toEqual({ status: 200, body: {
        access: 'full', interpretation: legacyCustomerFloor(), stored_depth, preview: null,
        locked: { patterns: 0, cross_report: 0, lifestyle: 0 }, complimentary: null,
        historical_interpretation_id: null, version: null,
        plan: ['active_subscription', 'active_iap', 'complimentary'].includes(entitlement.reason)
          ? 'premium' : entitlement.reason === 'error' ? null : 'free',
      } });
      expect(readSelected).toHaveBeenCalledTimes(1);
      expect(readSelected).toHaveBeenCalledWith(true);
      expect(countClaims).not.toHaveBeenCalled();
    }
  });
  it.each([false, true])('missing rows request generation with gate=%s', async flag => {
    const result = await readWithFlag(actions({ readSelected: async () => null }), flag);
    expect(result).toMatchObject({ status: 200, body: { access: 'generation_needed', interpretation: null } });
    if (!flag) expect(result.body.complimentary).toBeNull();
  });
  it('OFF plan resolution failure cannot block an owned Full read', async () => {
    const result = await readWithFlag(actions({ resolveEntitlement: async () => { throw new Error('offline'); } }), false);
    expect(result).toMatchObject({ status: 200, body: { access: 'full', interpretation: legacyCustomerFloor(), plan: null, complimentary: null } });
  });
  it.each([false, true])('OFF preserves ownership and database errors (owns=%s)', async owns => {
    const read = vi.fn(async () => { throw new Error('offline'); });
    const result = await readWithFlag(actions({ ownsReport: async () => owns, readSelected: read }), false);
    expect(result.status).toBe(owns ? 503 : 404);
    if (!owns) expect(read).not.toHaveBeenCalled();
  });
  it.each([false, true])('ON shallow Free row needs generation only with a claim=%s', async has_claim => {
    const result = await readWithFlag(actions({ readSelected: async () => ({ json_output: buildBasicProjection(full),
      stored_depth: 'standard', has_claim, tier: 'free' }) }), true);
    expect(result.body.access).toBe(has_claim ? 'generation_needed' : 'basic');
  });
  it('quarantines legacy cycle values on Basic and Full without changing storage', async () => {
    const payload = { ...full, cycle_context: { estimated_cycle_day: 21, estimated_cycle_phase: 'luteal',
      confidence: 'high', explanation: 'PRIVATE CROSS-MARKER NARRATIVE', other: 'PRIVATE LIFESTYLE' },
      preview: { content: 'chosen preview' }, locked: { patterns: 2, cross_report: 1, lifestyle: 3 } };
    for (const flag of [false, true]) for (const has_claim of [false, true]) {
      const result = await readWithFlag(actions({ readSelected: async () => ({ json_output: payload,
        stored_depth: 'deep', has_claim, tier: 'free' }) }), flag);
      if (flag && !has_claim) {
        expect(JSON.stringify(result.body)).not.toContain('PRIVATE');
        // V2-03c: a legacy (unversioned) preview and counts were chosen from
        // unvalidated model content; they are withheld, the row is not rewritten.
        expect(result.body.preview).toBeNull();
        expect(result.body.locked).toEqual({ patterns: 0, cross_report: 0, lifestyle: 0 });
        expect(payload.preview).toEqual({ content: 'chosen preview' });
        expect(result.body.interpretation?.cycle_context).toEqual(legacyCustomerFloor().cycle_context);
      } else expect(result.body.interpretation).toEqual(legacyCustomerFloor());
    }
  });
});

it('endpoint threads the exact environment gate through entitlement and read policy', () => {
  const source = readFileSync(new URL('../get-interpretation/index.ts', import.meta.url), 'utf8');
  expect(source).toContain('const freemiumActive = Deno.env.get("FREEMIUM_ACTIVE") === "true"');
  expect(source).toContain('checkUserSubscription(userClient, user.id, freemiumActive, true)');
  expect(source).toContain('}, freemiumActive)');
  expect(source).not.toMatch(/checkUserSubscription\([^)]*,\s*true\s*,\s*true\s*\)/);
  const policy = readFileSync(new URL('./interpretation-read.ts', import.meta.url), 'utf8');
  expect(policy).not.toContain('Deno.env');
});

it.each(['ai', null, undefined, 'fallback', 'deterministic'])('quarantines legacy findings at customer reads with source %s; deterministic Full remains identical', async interpretation_source => {
  const finding = { biomarker_slug: 'ferritin', status: 'attention', abnormal: true, value: 9,
    title: 'PRIVATE CROSS-MARKER NARRATIVE', explanation: 'PRIVATE CROSS-MARKER NARRATIVE' };
  const payload = { ...full, key_findings: [finding], top_findings: [finding], summary_bullets: ['PRIVATE CROSS-MARKER NARRATIVE'],
    cycle_context: 'PRIVATE CROSS-MARKER NARRATIVE', preview: { content: 'selected preview' },
    what_to_do_next: ['PRIVATE CROSS-MARKER NARRATIVE'],
    safety_findings: [{ abnormal: true, biomarker_slug: 'ferritin', follow_up: 'PRIVATE CROSS-MARKER NARRATIVE' }],
    locked: { patterns: 2, cross_report: 1, lifestyle: 3 } };
  const original = structuredClone(payload);
  for (const flag of [false, true]) for (const has_claim of [false, true]) {
    const result = await readWithFlag(actions({ readSelected: async () => ({ json_output: payload,
      stored_depth: 'deep', has_claim, tier: 'free', interpretation_source }) }), flag);
    if (flag && !has_claim) {
      // V2-03c: legacy preview/counts withheld at every source; the body agrees.
      expect(result.body.preview).toBeNull();
      expect(result.body.locked).toEqual({ patterns: 0, cross_report: 0, lifestyle: 0 });
      expect(result.body.interpretation?.preview).toBeNull();
      expect(JSON.stringify(result.body)).not.toContain('selected preview');
      expect(result.body.interpretation?.cycle_context).toEqual({ estimated_cycle_day: null,
        estimated_cycle_phase: 'unknown', confidence: null, explanation: '' });
      if (interpretation_source === 'fallback' || interpretation_source === 'deterministic') {
        expect(result.body.interpretation?.top_findings).toEqual(payload.top_findings);
        expect(result.body.interpretation?.summary_bullets).toEqual(payload.summary_bullets);
        expect(result.body.interpretation?.what_to_do_next).toEqual(payload.what_to_do_next);
        expect(result.body.interpretation?.safety_findings).toEqual(payload.safety_findings);
      } else {
        expect(result.body.interpretation?.what_to_do_next).toEqual([]);
        expect(result.body.interpretation?.safety_findings).toEqual([]);
        expect(JSON.stringify(result.body)).not.toContain('PRIVATE CROSS-MARKER NARRATIVE');
        expect(result.body.interpretation?.key_findings).toEqual([]);
        expect(result.body.interpretation?.top_findings).toEqual(result.body.interpretation?.key_findings);
        expect(result.body.interpretation?.summary_bullets).toEqual([]);
      }
    } else expect(result.body.interpretation).toEqual(interpretation_source === 'fallback' || interpretation_source === 'deterministic' ? payload : legacyCustomerFloor());
  }
  expect(payload).toEqual(original);
});

describe('TASK-048 turn 8: the explicitly selected version (20261012000007)', () => {
  type Case = { name: string; source: string | null; full: InterpretationPayload; basic: InterpretationPayload };
  const corpus: Case[] = JSON.parse(readFileSync(new URL('../../migrations/__verification__/legacy-quarantine.corpus.json', import.meta.url), 'utf8'));
  const current = corpus.find(c => c.name === 'current-authorized')!;
  // Floor keys present so the version is a complete stored body (no floor log).
  const versionFull = { ...current.full, cycle_context: {}, disclaimer: 'd', h048v_version: 'V2' };
  const history = { id: '04880000-0000-4000-8000-0000000000a1', generated_at: '2026-01-01T00:00:00+00:00' };
  const selected = { id: '04880000-0000-4000-8000-0000000000b2', generated_at: '2026-10-11T09:00:00.123456+00:00' };
  const identity = { historical_interpretation_id: history.id, selected_version_id: selected.id,
    selected_generated_at: selected.generated_at };
  const premium = async () => ({ allowed: true as const, plan: 'premium' as const,
    reason: 'active_subscription' as const, source: 'active_subscription' as const });
  // The RPC has already chosen the body: Full for Premium or a covered claim,
  // otherwise the version's own sanitized json_output_basic.
  const versionRow = (has_claim: boolean, basic: InterpretationPayload = current.basic) => vi.fn(async (p: boolean) => ({
    json_output: p || has_claim ? versionFull : basic, stored_depth: 'deep', has_claim, tier: 'free',
    interpretation_source: 'ai', ...identity }));

  it.each([
    ['covered claim holder', () => ({ readSelected: versionRow(true) })],
    ['Premium', () => ({ resolveEntitlement: premium, readSelected: versionRow(false) })],
  ] as const)('serves the version body Full to the %s, under the version identity', async (_label, overrides) => {
    const result = await readInterpretation(actions(overrides()));
    expect(result.status).toBe(200);
    expect(result.body.access).toBe('full');
    expect(result.body.interpretation).toEqual(versionFull);
    expect(result.body.historical_interpretation_id).toBe(history.id);
    expect(result.body.version).toEqual(selected);
    expect(result.body.version?.id).not.toBe(history.id);
    expect(result.body.version?.generated_at).not.toBe(history.generated_at);
  });

  it("control 13: a non-covered Free reader gets Basic from the version's json_output_basic, preview only under a known policy", async () => {
    const readSelected = versionRow(false);
    const result = await readInterpretation(actions({ readSelected }));
    expect(readSelected).toHaveBeenCalledWith(false);
    expect(result.body.access).toBe('basic');
    expect(result.body.interpretation).toEqual({ ...sanitizeBasicProjection(current.basic, 'ai'), ...visibleClaimProjection(current.basic) });
    expect(result.body.interpretation).not.toHaveProperty('h048v_version');
    expect(result.body.preview).not.toBeNull();
    expect(result.body.locked).toMatchObject({ cross_report: 1 });
    expect(result.body.version).toEqual(selected);

    const unknownPolicy = { ...current.basic, locked: { ...(current.basic.locked as object), claim_policy_version: 'h048v-unknown', cross_report: 5 } };
    const withheld = await readInterpretation(actions({ readSelected: versionRow(false, unknownPolicy) }));
    expect(withheld.body.access).toBe('basic');
    expect(withheld.body.preview).toBeNull();
    expect(withheld.body.locked).toEqual({ patterns: 0, cross_report: 0, lifestyle: 0 });
    expect(withheld.body.interpretation?.preview).toBeNull();
  });

  it.each([false, true])('control 12: with no pointer the historical row stays quarantined, never its prose (gate=%s)', async flag => {
    const legacy = { headline: 'H048V historical canary', overall_interpretation: 'H048V historical prose canary' };
    for (const has_claim of [false, true]) {
      const result = await readWithFlag(actions({ readSelected: async () => ({ json_output: legacy, stored_depth: 'standard',
        has_claim, tier: 'free', interpretation_source: 'ai', historical_interpretation_id: null,
        selected_version_id: null, selected_generated_at: null }) }), flag);
      expect(result.status).toBe(200);
      expect(JSON.stringify(result.body)).not.toContain('H048V historical');
      expect(result.body.historical_interpretation_id).toBeNull();
      expect(result.body.version).toBeNull();
    }
  });

  it('gate OFF serves the selected version Full with its identity', async () => {
    const result = await readWithFlag(actions({ readSelected: versionRow(false) }), false);
    expect(result.body).toMatchObject({ access: 'full', interpretation: versionFull, stored_depth: 'deep',
      historical_interpretation_id: history.id, version: selected });
  });

  it('an older RPC without identity columns reads as no selection', async () => {
    const result = await readInterpretation(actions({ resolveEntitlement: premium,
      readSelected: async () => ({ json_output: versionFull, stored_depth: 'deep', has_claim: false, tier: 'plus', interpretation_source: 'ai' }) }));
    expect(result.body).toMatchObject({ access: 'full', interpretation: versionFull, historical_interpretation_id: null, version: null });
  });

  it.each([
    ['the historical id as the version', { ...identity, selected_version_id: history.id }],
    ['a version without its time', { ...identity, selected_generated_at: null }],
    ['a version without its history', { ...identity, historical_interpretation_id: null }],
    ['history without a version', { historical_interpretation_id: history.id, selected_version_id: null, selected_generated_at: null }],
  ])('fails closed on an incoherent identity: %s', async (_label, broken) => {
    for (const flag of [false, true]) {
      const result = await readWithFlag(actions({ resolveEntitlement: premium, readSelected: async () => ({ json_output: versionFull,
        stored_depth: 'deep', has_claim: false, tier: 'free', interpretation_source: 'ai', ...broken }) }), flag);
      expect(result).toMatchObject({ status: 503, body: { access: 'error', interpretation: null, version: null } });
    }
  });
});
