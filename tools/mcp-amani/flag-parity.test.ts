import { describe, expect, it, vi } from 'vitest';

// src/lib/runtimeConfig.ts creates the app's Supabase client at import; the parity
// check needs only its pure parser, so the client module is replaced.
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }));

const { parseRuntimeConfig } = await import('../../src/lib/runtimeConfig');
const { FEATURE_FLAG, isConnectorFlagOn } = await import('./src/connector.ts');

// D5: the connector reads features.ai_assistant_connector with exactly the app's semantics.
describe('the connector flag agrees with src/lib/runtimeConfig.ts', () => {
  it.each([
    [[]],
    [[{ key: 'features', value: {} }]],
    [[{ key: 'features', value: { [FEATURE_FLAG]: true } }]],
    [[{ key: 'features', value: { [FEATURE_FLAG]: false } }]],
    [[{ key: 'features', value: { [FEATURE_FLAG]: 'true' } }]],
    [[{ key: 'features', value: { [FEATURE_FLAG]: 1 } }]],
    [[{ key: 'features', value: null }]],
    [[{ key: 'features', value: [FEATURE_FLAG] }]],
    [[null, 'x', { key: 'features', value: { [FEATURE_FLAG]: true, consent_gate: true } }]],
  ])('%j', rows => {
    expect(isConnectorFlagOn(rows)).toBe(parseRuntimeConfig(rows).enabledFeatures.includes(FEATURE_FLAG));
  });
});
