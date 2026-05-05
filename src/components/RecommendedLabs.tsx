import { useState, useMemo } from 'react';
import { FlaskConical, ChevronDown, ChevronUp } from 'lucide-react';
import { RECOMMENDED_LABS, rankRecommendedLabs } from '../lib/biomarkers/recommendedLabs';
import { getDisplayName } from '../lib/biomarkers/dictionary';
import { CATEGORY_DISPLAY } from '../types';
import type { BiomarkerCategory, BiomarkerName } from '../types';

interface Props {
  presentBiomarkers: string[];
  activeCategory?: BiomarkerCategory | null;
}

const TOP_N = 5;

export function RecommendedLabs({ presentBiomarkers, activeCategory }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const ranked = useMemo(() => {
    const presentSet = new Set(presentBiomarkers);
    const categories = activeCategory
      ? [activeCategory]
      : (Object.keys(RECOMMENDED_LABS) as BiomarkerCategory[]);

    const flat: { name: BiomarkerName; reason: string; category: BiomarkerCategory }[] = [];
    for (const cat of categories) {
      const recs = RECOMMENDED_LABS[cat] ?? [];
      for (const r of recs) {
        if (!presentSet.has(r.name)) {
          flat.push({ ...r, category: cat });
        }
      }
    }

    return rankRecommendedLabs(flat, [], activeCategory ?? undefined);
  }, [presentBiomarkers, activeCategory]);

  if (ranked.length === 0) return null;

  const top = ranked.slice(0, TOP_N);
  const rest = ranked.slice(TOP_N);
  const visible = showAll ? ranked : top;

  return (
    <div className="bg-white rounded-2xl border border-[#E9D6DA] p-6">
      <div className="flex items-center gap-2 mb-1">
        <FlaskConical className="w-5 h-5 text-[#C97C8B]" />
        <h2 className="text-lg font-semibold text-[#2A1F23]">Recommended Labs</h2>
      </div>
      <p className="text-sm text-[#7A6570]">
        {ranked.length} {ranked.length === 1 ? 'lab' : 'labs'} suggested based on this report
      </p>

      {!expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-4 w-full flex items-center justify-center gap-1.5 px-4 py-2.5 bg-[#FDF4F6] hover:bg-[#F8E6EA] border border-[#E9D6DA] rounded-lg text-sm font-medium text-[#C97C8B] transition-colors"
        >
          View suggested labs
          <ChevronDown className="w-4 h-4" />
        </button>
      )}

      {expanded && (
        <>
          <p className="text-xs text-[#7A6570] mt-4 mb-3">
            These labs are sometimes used for additional context and may be worth discussing with your provider, depending on your situation.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {visible.map(item => (
              <div
                key={`${item.category}-${item.name}`}
                className="flex items-start gap-2.5 bg-[#FDF4F6] border border-[#E9D6DA] rounded-lg px-3 py-2.5"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-[#C97C8B] mt-1.5 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-[#2A1F23]">
                    {getDisplayName(item.name)}
                  </div>
                  <div className="text-[11px] uppercase tracking-wide text-[#9A8A90] mt-0.5">
                    {CATEGORY_DISPLAY[item.category].shortLabel}
                  </div>
                  <div className="text-xs text-[#7A6570] mt-0.5">{item.reason}</div>
                </div>
              </div>
            ))}
          </div>

          {rest.length > 0 && !showAll && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-3 w-full flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-[#C97C8B] hover:text-[#A85F6E] transition-colors"
            >
              View {rest.length} more {rest.length === 1 ? 'lab' : 'labs'}
              <ChevronDown className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setExpanded(false);
              setShowAll(false);
            }}
            className="mt-3 w-full flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-[#9A8A90] hover:text-[#7A6570] transition-colors"
          >
            Hide
            <ChevronUp className="w-4 h-4" />
          </button>

          <p className="text-xs text-[#9A8A90] mt-4 italic">
            These are not recommendations — your provider is best placed to determine what's appropriate for your situation.
          </p>
        </>
      )}
    </div>
  );
}
