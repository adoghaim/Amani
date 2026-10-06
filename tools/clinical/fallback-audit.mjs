// Internal interval comparisons only: no clinical truth or replacement values.
// Use every strict numeric difference; no unsourced clinical tolerance is invented.
export function fallbackFindings(analyte, fallback) {
  if (fallback.candidate_id || fallback.phase !== null
    || fallback.min === null || fallback.max === null) return null;
  const phased = analyte.ranges.filter(r => !r.candidate_id && r.phase !== null
    && r.population === fallback.population && r.kind === fallback.kind
    && r.min !== null && r.max !== null);
  if (!phased.length) return null;
  const union = [];
  for (const r of [...phased].sort((a, b) => a.min - b.min || a.max - b.max)) {
    const last = union.at(-1);
    if (last && r.min <= last.max) last.max = Math.max(last.max, r.max);
    else union.push({ min: r.min, max: r.max });
  }
  const narrowerThanUnion = union.some(r => r.min < fallback.min || r.max > fallback.max);
  const widerThanUnion = !union.some(r => r.min <= fallback.min && r.max >= fallback.max);
  const widerThanPhases = phased.filter(r => fallback.min < r.min || fallback.max > r.max).map(r => r.phase).sort();
  const narrowerThanPhases = phased.filter(r => r.min < fallback.min || r.max > fallback.max).map(r => r.phase).sort();
  return { union, widerThanUnion, narrowerThanUnion, widerThanPhases, narrowerThanPhases };
}

export function fallbackSummary(finding) {
  const union = finding.union.map(r => `${r.min}–${r.max}`).join(' ∪ ');
  const direction = finding.widerThanUnion && finding.narrowerThanUnion ? 'both wider and narrower'
    : finding.widerThanUnion ? 'wider' : finding.narrowerThanUnion ? 'narrower' : 'equal';
  return `Actual phase union: ${union}; fallback is ${direction} relative to that union. `
    + (finding.widerThanPhases.length ? `WIDER than individual phase bands (${finding.widerThanPhases.join(', ')}): may fail to flag a phase-abnormal value, causing false reassurance. ` : '')
    + (finding.narrowerThanPhases.length ? `NARROWER than individual phase bands (${finding.narrowerThanPhases.join(', ')}): may flag a phase-normal value, causing unnecessary concern or action. ` : '')
    + 'Normal/abnormal here means inside/outside the unsourced catalog phase band, not independently established clinical normality.';
}
