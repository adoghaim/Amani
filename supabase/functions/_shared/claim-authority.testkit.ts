/** Synthetic facts only. Shared by component and browser projection proofs. */
import { projectBasic, servedBasic, visibleClaimProjection, withClaimAuthority } from './claim-authority';
import { buildTrendEvidence } from './trend-evidence';

export const projectionCanary = 'Your markers are telling a gentle story about how your energy is settling';
export function projectedPreviewFixture(currentTsh = 9) {
  const current = [
    { slug: 'tsh', name: 'TSH', value: currentTsh, unit: 'uIU/mL' },
    { slug: 'ferritin', name: 'Ferritin', value: 30, unit: 'ng/mL' },
  ] as const;
  const previous = [{ ...current[0], value: 6 }, { ...current[1], value: 25 }];
  const full = withClaimAuthority({
    headline: 'Synthetic panel', overall_interpretation: projectionCanary,
    pattern_signals: [{ title: projectionCanary, explanation: projectionCanary, confidence: 'high' }],
  }, {
    source: 'ai', trendEvidence: buildTrendEvidence(current, previous, '2026-01-05'),
    statuses: current.map(v => ({ biomarker_slug: v.slug, marker: v.name, value: v.value, unit: v.unit, status: 'in_range' })),
  });
  const basic = projectBasic(full, { source: 'ai' });
  const visible = visibleClaimProjection(basic);
  return { current, previous, full, basic, visible, response: {
    access: 'basic', interpretation: servedBasic(basic), ...visible,
    plan: 'free', complimentary: { used: 3, total: 3, remaining: 0 }, stored_depth: 'deep',
  } };
}
