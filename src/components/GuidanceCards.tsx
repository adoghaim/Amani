import { useState } from 'react';
import { ChevronDown, ChevronUp, LayoutGrid } from 'lucide-react';
import type { BuiltCard } from '../lib/cards/buildCards';
import { EDUCATION_HEADING, EDUCATION_INTRO } from '../lib/scoring/insightCopy';

interface GuidanceCardsProps {
  cards: BuiltCard[];
}

/*
  V2-03b Stage 2, owner R4. This was the "Support plan": food, nutrient and
  tracking lists chosen by her out-of-band markers. It now shows only the
  policy's general education, labelled as such, and its product disclaimer.
*/
export function GuidanceCards({ cards }: GuidanceCardsProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(cards.map((c, i) => [c.id, i === 0]))
  );

  if (cards.length === 0) return null;

  const toggle = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <LayoutGrid className="w-3.5 h-3.5 text-theme-muted-text-2" />
        <h2 className="text-sm text-theme-text">{EDUCATION_HEADING}</h2>
      </div>
      <p className="text-xs text-theme-muted-text-3 px-1">{EDUCATION_INTRO}</p>

      <div className="space-y-2">
        {cards.map((card) => {
          const isOpen = expanded[card.id] ?? false;
          return (
            <article
              key={card.id}
              className="bg-theme-surface rounded-xl border border-theme-border px-4 py-3"
            >
              <button
                type="button"
                onClick={() => toggle(card.id)}
                aria-expanded={isOpen}
                className="w-full flex items-start gap-3 text-left"
              >
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm text-theme-text leading-snug">
                    {card.title}
                  </h3>
                  <p className="text-xs text-theme-muted-text-2 leading-relaxed mt-1.5"
                    data-language-category={card.summary.category} data-language-source={card.summary.authority.kind}
                    data-language-cue={card.summary.cue}>
                    {card.summary.text}
                  </p>
                </div>
                <span className="flex-shrink-0 mt-0.5 text-theme-muted-text-2">
                  {isOpen ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </span>
              </button>

              {isOpen && (
                <div className="mt-2.5 pt-2 border-t border-theme-border-inner">
                  {/* "Note", not "Safety note": a disclaimer is not the safety channel. */}
                  <p className="text-[10px] uppercase tracking-wide font-medium text-theme-muted-text-3 mb-0.5">
                    Note
                  </p>
                  <p className="text-[11px] text-theme-muted-text-3 leading-relaxed"
                    data-language-category={card.note.category} data-language-source={card.note.authority.kind}>
                    {card.note.text}
                  </p>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
