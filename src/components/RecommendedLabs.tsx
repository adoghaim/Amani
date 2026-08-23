import { useState, useMemo } from 'react';
import { FlaskConical, ChevronDown, ChevronUp } from 'lucide-react';
import {
  RECOMMENDED_LABS,
  rankRecommendedLabs,
  type FlaggedSignal,
} from '../lib/biomarkers/recommendedLabs';
import { getDisplayName, getCategory } from '../lib/biomarkers/dictionary';
import { CATEGORY_DISPLAY } from '../types';
import type { BiomarkerCategory, BiomarkerName } from '../types';

interface Props {
  presentBiomarkers: string[];
  activeCategory?: BiomarkerCategory | null;
  primaryCategory?: BiomarkerCategory | null;
  flaggedSlugs?: BiomarkerName[];
  flaggedCategories?: BiomarkerCategory[];
}

const TOP_N = 3;

export function RecommendedLabs({
  presentBiomarkers,
  activeCategory,
  primaryCategory,
  flaggedSlugs,
  flaggedCategories,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const flagged: FlaggedSignal[] = useMemo(() => {
    const fromSlugs: FlaggedSignal[] = (flaggedSlugs ?? [])
      .map(slug => ({ slug, category: getCategory(slug) }))
      .filter((f): f is FlaggedSignal => f.category != null);

    if (!flaggedCategories || flaggedCategories.length === 0) return fromSlugs;

    // Cover categories flagged without a specific slug (aggregate findings).
    // Re-use any slug already mapped to that category so the +2 system match
    // fires without inventing a fake slug.
    const seen = new Set(fromSlugs.map(f => f.category));
    const extras: FlaggedSignal[] = [];
    for (const cat of flaggedCategories) {
      if (seen.has(cat)) continue;
      const proxy = (flaggedSlugs ?? []).find(s => getCategory(s) === cat);
      if (proxy) extras.push({ slug: proxy, category: cat });
      seen.add(cat);
    }
    return extras.length ? [...fromSlugs, ...extras] : fromSlugs;
  }, [flaggedSlugs, flaggedCategories]);

  const ranked = useMemo(() => {
    const presentSet = new Set(presentBiomarkers);
    const categories = activeCategory
      ? [activeCategory]
      : (Object.keys(RECOMMENDED_LABS) as BiomarkerCategory[]);

    const flat: (typeof RECOMMENDED_LABS[BiomarkerCategory][number] & {
      category: BiomarkerCategory;
    })[] = [];
    for (const cat of categories) {
      const recs = RECOMMENDED_LABS[cat] ?? [];
      for (const r of recs) {
        if (!presentSet.has(r.name)) {
          flat.push({ ...r, category: cat });
        }
      }
    }

    return rankRecommendedLabs(flat, flagged, primaryCategory ?? activeCategory ?? null);
  }, [presentBiomarkers, activeCategory, primaryCategory, flagged]);

  if (ranked.length === 0) return null;

  const hasMore = ranked.length > TOP_N;
  const visible = expanded || !hasMore ? ranked : ranked.slice(0, TOP_N);

  return (
    <div className="bg-theme-surface rounded-2xl border border-theme-border p-6">
      <div className="flex items-center gap-2 mb-1">
        <FlaskConical className="w-5 h-5 text-theme-primary" />
        <h2 className="text-lg text-theme-text">Recommended labs</h2>
      </div>
      <p className="text-sm text-theme-muted-text-2">
        {ranked.length} {ranked.length === 1 ? 'lab' : 'labs'} suggested based on this report
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
        {visible.map(item => (
          <div
            key={`${item.category}-${item.name}`}
            className="flex items-start gap-2.5 bg-theme-background-tint border border-theme-border rounded-lg px-3 py-2.5"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-theme-primary mt-1.5 shrink-0" />
            <div>
              <div className="text-sm font-medium text-theme-text">
                {getDisplayName(item.name)}
              </div>
              <div className="text-[11px] uppercase tracking-wide text-theme-muted-text-3 mt-0.5">
                {CATEGORY_DISPLAY[item.category].shortLabel}
              </div>
              <div className="text-xs text-theme-muted-text-2 mt-0.5">{item.reason}</div>
            </div>
          </div>
        ))}
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded(prev => !prev)}
          className="mt-3 w-full flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-theme-primary hover:text-theme-primary-dark transition-colors"
        >
          {expanded ? (
            <>
              Show fewer
              <ChevronUp className="w-4 h-4" />
            </>
          ) : (
            <>
              View all {ranked.length} labs
              <ChevronDown className="w-4 h-4" />
            </>
          )}
        </button>
      )}
    </div>
  );
}
