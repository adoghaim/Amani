import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readInterpretation, type InterpretationReadActions } from './interpretation-read';
import { visibleClaimProjection } from './claim-authority';
import { sanitizeBasicProjection } from './interpretation-visibility';
import type { EntitlementResult } from './entitlement';
import type { InterpretationPayload } from './response-shaping';

/**
 * PK-03e-H (docs/clinical/TASK-048/turn-14-minimal-reader.md): the minimal
 * current-version reader. Every customer read serves the CURRENT version of a
 * report's interpretation, Basic and Premium both project that version, and a
 * regeneration that appends a version switches the next read to it.
 *
 * The store below is a declared stand-in for the SQL, not a reimplementation
 * that anything trusts: its rows have the exact shape and selection rule of
 * read_interpretation_for_server after 20261012000007 (pointer wins, else the
 * anchor; Full for Premium or a covered claim, else the selected body's own
 * sanitized Basic) and of append_interpretation_version (append, move the
 * pointer, an identical retry returns its version without moving it). The SQL
 * itself is proven in interpretation-versions.read.sql step 8
 * (H048V-REGEN-THEN-READ / -SWITCHES / -ANCHOR-UNCHANGED) and in the live
 * SQL -> TS parity case `current-regenerated` (legacy-sql-parity.test.ts).
 * What this file proves is the real edge read policy on those rows.
 */

type Corpus = { name: string; full: InterpretationPayload; basic: InterpretationPayload }[];
const corpus: Corpus = JSON.parse(readFileSync(new URL('../../migrations/__verification__/legacy-quarantine.corpus.json', import.meta.url), 'utf8'));
const current = corpus.find(c => c.name === 'current-authorized')!;

interface Stored { id: string; generated_at: string; full: InterpretationPayload; basic: InterpretationPayload;
  stored_depth: string; source: string; tier: string; request_id?: string }

function body(label: string, depth: 'deep' | 'standard' = 'deep') {
  // Floor keys present so every stored body is complete (no floor log).
  const full = { ...current.full, cycle_context: {}, disclaimer: 'd', headline: `${label} full`, h048h_full_only: `${label} FULL ONLY` };
  const basic = { ...current.basic, headline: `${label} basic` };
  return { full, basic, depth };
}

class VersionStore {
  readonly anchor: Stored;
  readonly versions: Stored[] = [];
  pointer: string | null = null;
  claimCovered = false;
  private seq = 0;
  constructor(depth: 'deep' | 'standard' = 'deep') {
    const b = body('anchor', depth);
    this.anchor = { id: 'anchor-0000', generated_at: '2026-10-01T00:00:00+00:00', full: b.full, basic: b.basic,
      stored_depth: b.depth, source: 'ai', tier: depth === 'deep' ? 'plus' : 'free' };
  }
  /** append_interpretation_version: deep only, keyed by request, selects what it appends. */
  regenerate(requestId: string, label: string): Stored {
    const twin = this.versions.find(v => v.request_id === requestId);
    if (twin) return twin;
    const b = body(label);
    this.seq += 1;
    const version: Stored = { id: `version-${this.seq}`, generated_at: `2026-10-12T0${this.seq}:00:00+00:00`,
      full: b.full, basic: b.basic, stored_depth: 'deep', source: 'ai', tier: 'plus', request_id: requestId };
    this.versions.push(version);
    this.pointer = version.id;
    return version;
  }
  /** read_interpretation_for_server(user, report, premium). */
  readSelected: InterpretationReadActions['readSelected'] = async premium => {
    const selected = this.versions.find(v => v.id === this.pointer) ?? null;
    const served = selected ?? this.anchor;
    return {
      json_output: premium || this.claimCovered ? served.full : sanitizeBasicProjection(served.basic, served.source),
      stored_depth: served.stored_depth, has_claim: this.claimCovered, tier: served.tier,
      interpretation_source: served.source,
      historical_interpretation_id: selected ? this.anchor.id : null,
      selected_version_id: selected?.id ?? null,
      selected_generated_at: selected?.generated_at ?? null,
    };
  };
}

const premium = async (): Promise<EntitlementResult> => ({ allowed: true, plan: 'premium', reason: 'active_subscription', source: 'active_subscription' });
const free = async (): Promise<EntitlementResult> => ({ allowed: true, plan: 'free' });
function read(store: VersionStore, entitlement = free, flagOn = true) {
  return readInterpretation({ ownsReport: async () => true, resolveEntitlement: entitlement,
    readSelected: store.readSelected, countClaims: async () => 1 }, flagOn);
}
const expectedBasic = (s: Stored) => ({ ...sanitizeBasicProjection(sanitizeBasicProjection(s.basic, 'ai'), 'ai'),
  ...visibleClaimProjection(sanitizeBasicProjection(s.basic, 'ai')) });

describe('PK-03e-H current-version selection', () => {
  it('serves the anchor with no version identity before any regeneration', async () => {
    const store = new VersionStore();
    const result = await read(store, premium);
    expect(result.body).toMatchObject({ access: 'full', interpretation: store.anchor.full,
      historical_interpretation_id: null, version: null });
  });

  it('serves the pointed version, never a newer unselected one and never the anchor', async () => {
    const store = new VersionStore();
    const v1 = store.regenerate('req-1', 'v1');
    store.regenerate('req-2', 'v2');
    store.pointer = v1.id; // explicit selection, not recency
    const result = await read(store, premium);
    expect(result.body.interpretation).toEqual(v1.full);
    expect(result.body.version).toEqual({ id: v1.id, generated_at: v1.generated_at });
    expect(result.body.historical_interpretation_id).toBe(store.anchor.id);
    expect(JSON.stringify(result.body)).not.toContain('v2 FULL ONLY');
    expect(JSON.stringify(result.body)).not.toContain('anchor FULL ONLY');
  });
});

describe('PK-03e-H Basic and Premium project the current version', () => {
  it('Premium gets the current version Full', async () => {
    const store = new VersionStore();
    const v1 = store.regenerate('req-1', 'v1');
    const result = await read(store, premium);
    expect(result.body).toMatchObject({ access: 'full', plan: 'premium', interpretation: v1.full, stored_depth: 'deep' });
  });

  it("an uncovered Free reader gets Basic built from the current version's own Basic, with its preview", async () => {
    const store = new VersionStore();
    const v1 = store.regenerate('req-1', 'v1');
    const result = await read(store);
    expect(result.body.access).toBe('basic');
    expect(result.body.interpretation).toEqual(expectedBasic(v1));
    expect(result.body.interpretation?.headline).toBe('v1 basic');
    expect(result.body.preview).not.toBeNull();
    expect(JSON.stringify(result.body)).not.toContain('FULL ONLY');
    expect(JSON.stringify(result.body)).not.toContain('anchor basic');
    expect(result.body.version?.id).toBe(v1.id);
  });

  it('a covered claim holder gets the current version Full on the Free plan', async () => {
    const store = new VersionStore();
    store.claimCovered = true;
    const v1 = store.regenerate('req-1', 'v1');
    const result = await read(store);
    expect(result.body).toMatchObject({ access: 'full', plan: 'free', interpretation: v1.full });
  });

  it('with the freemium switch off the current version is served Full', async () => {
    const store = new VersionStore();
    const v1 = store.regenerate('req-1', 'v1');
    const result = await read(store, free, false);
    expect(result.body).toMatchObject({ access: 'full', interpretation: v1.full, version: { id: v1.id } });
  });
});

describe('PK-03e-H regenerate, then read', () => {
  it('each new request switches every reader to the version it appended; a retry never rewinds', async () => {
    const store = new VersionStore();
    const before = { premium: await read(store, premium), free: await read(store) };
    expect(before.premium.body.interpretation).toEqual(store.anchor.full);
    expect(before.free.body.interpretation?.headline).toBe('anchor basic');

    const v1 = store.regenerate('req-1', 'v1');
    expect((await read(store, premium)).body.interpretation).toEqual(v1.full);
    expect((await read(store)).body.interpretation).toEqual(expectedBasic(v1));

    const v2 = store.regenerate('req-2', 'v2');
    expect(store.regenerate('req-1', 'v1').id).toBe(v1.id); // identical retry: its own version back
    const after = { premium: await read(store, premium), free: await read(store) };
    expect(after.premium.body).toMatchObject({ interpretation: v2.full, version: { id: v2.id, generated_at: v2.generated_at },
      historical_interpretation_id: store.anchor.id });
    expect(after.free.body.interpretation).toEqual(expectedBasic(v2));
    expect(after.free.body.version?.id).toBe(v2.id);
    for (const result of Object.values(after)) {
      expect(JSON.stringify(result.body)).not.toMatch(/anchor (full|basic|FULL ONLY)|v1 (full|basic|FULL ONLY)/);
    }
    // The anchor is history: still there, untouched, no longer served.
    expect(store.anchor.full.headline).toBe('anchor full');
  });

  it('a Premium reader of a standard-depth anchor is asked to generate, then reads the deep version', async () => {
    const store = new VersionStore('standard');
    const before = await read(store, premium);
    expect(before.body.access).toBe('generation_needed');
    expect(before.body.stored_depth).toBe('standard');
    const v1 = store.regenerate('req-1', 'v1');
    const after = await read(store, premium);
    expect(after.body).toMatchObject({ access: 'full', stored_depth: 'deep', interpretation: v1.full, version: { id: v1.id } });
  });

  it('negative control: a reader that ignores the pointer serves the anchor, which these checks reject', async () => {
    const store = new VersionStore();
    store.regenerate('req-1', 'v1');
    const stale: InterpretationReadActions['readSelected'] = async p => ({ ...(await store.readSelected(p))!,
      json_output: p ? store.anchor.full : sanitizeBasicProjection(store.anchor.basic, 'ai') });
    const result = await readInterpretation({ ownsReport: async () => true, resolveEntitlement: premium,
      readSelected: stale, countClaims: async () => 1 }, true);
    expect(result.body.interpretation).not.toEqual(store.versions[0].full);
  });
});
