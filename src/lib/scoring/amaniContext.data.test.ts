import { describe, expect, it, vi } from 'vitest';

// Proves suppression follows catalog data rather than a list of analyte names:
// flipping one non-hormone analyte's catalog flags flips its behaviour, and
// clearing a hormone's flags would let it score unphased.
vi.mock('../biomarkers/rangeContext.generated', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../biomarkers/rangeContext.generated')>();
  return {
    ...actual,
    ANALYTE_CONTEXT: actual.ANALYTE_CONTEXT.map(a => {
      if (a.key === 'ferritin') {
        return { ...a, bands: a.bands.map(b => ({ ...b, modifiers: { ...b.modifiers, cycle: 'requires_context' as const } })) };
      }
      if (a.key === 'progesterone') {
        return { ...a, cycleDependent: false,
          bands: a.bands.map(b => ({ ...b, modifiers: { ...b.modifiers, cycle: 'UNKNOWN' as const } })) };
      }
      return a;
    }),
  };
});

const { assessAmaniContext, contextFromReport, requiresCycleContext } = await import('./amaniContext');

describe('context-required suppression is driven by catalog data', () => {
  it('a catalog cycle flag on ferritin withholds ferritin without a phase', () => {
    expect(requiresCycleContext('ferritin')).toBe(true);
    expect(assessAmaniContext('ferritin', 12, contextFromReport(null))).toMatchObject({ kind: 'withheld', reason: 'cycle_phase_missing' });
    // Ferritin has no phase bands, so a phase cannot unlock a band that does not exist.
    expect(assessAmaniContext('ferritin', 12, contextFromReport('luteal'))).toMatchObject({ kind: 'withheld', reason: 'cycle_phase_unsupported' });
  });

  it('without catalog cycle flags, progesterone is no longer treated as cycle-dependent', () => {
    expect(requiresCycleContext('progesterone')).toBe(false);
    expect(assessAmaniContext('progesterone', 2, contextFromReport(null)).kind).toBe('scored');
  });
});
