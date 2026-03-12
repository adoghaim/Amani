import { FlaskConical } from 'lucide-react';
import { RECOMMENDED_LABS, BIOMARKER_DISPLAY } from '../utils/biomarkerDefinitions';
import { CATEGORY_DISPLAY } from '../types';
import type { BiomarkerCategory, BiomarkerName } from '../types';

interface Props {
  presentBiomarkers: string[];
  activeCategory?: BiomarkerCategory | null;
}

export function RecommendedLabs({ presentBiomarkers, activeCategory }: Props) {
  const presentSet = new Set(presentBiomarkers);
  const categories = activeCategory
    ? [activeCategory]
    : (Object.keys(RECOMMENDED_LABS) as BiomarkerCategory[]);

  const missing: { category: BiomarkerCategory; items: { name: BiomarkerName; reason: string }[] }[] = [];

  for (const cat of categories) {
    const recs = RECOMMENDED_LABS[cat] ?? [];
    const missingItems = recs.filter(r => !presentSet.has(r.name));
    if (missingItems.length > 0) {
      missing.push({ category: cat, items: missingItems });
    }
  }

  if (missing.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-[#E9D6DA] p-6">
      <div className="flex items-center gap-2 mb-2">
        <FlaskConical className="w-5 h-5 text-[#C97C8B]" />
        <h2 className="text-lg font-semibold text-[#2A1F23]">Recommended Labs</h2>
      </div>
      <p className="text-sm text-[#7A6570] mb-5">
        These biomarkers weren't in your current panel. Adding them would give a more complete picture.
      </p>

      <div className="space-y-5">
        {missing.map(({ category, items }) => (
          <div key={category}>
            <h3 className="text-xs font-bold uppercase tracking-wide text-[#7A6570] mb-2">
              {CATEGORY_DISPLAY[category].label}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {items.map(item => (
                <div
                  key={item.name}
                  className="flex items-start gap-2.5 bg-[#FDF4F6] border border-[#E9D6DA] rounded-lg px-3 py-2.5"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-[#C97C8B] mt-1.5 shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-[#2A1F23]">
                      {BIOMARKER_DISPLAY[item.name] ?? item.name.replace(/_/g, ' ')}
                    </div>
                    <div className="text-xs text-[#7A6570] mt-0.5">{item.reason}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-[#9A8A90] mt-4 italic">
        Discuss with your provider which tests are appropriate for your situation.
      </p>
    </div>
  );
}
