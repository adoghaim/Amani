import { useState } from 'react';
import { ChevronDown, ChevronUp, LayoutGrid } from 'lucide-react';
import type { BuiltCard } from '../lib/cards/buildCards';

interface GuidanceCardsProps {
  cards: BuiltCard[];
}

interface ChipTone {
  bg: string;
  text: string;
  border: string;
}

const CHIP_TONES: Record<'food' | 'topic' | 'track', ChipTone> = {
  food: {
    bg: 'bg-theme-flag-ok-bg',
    text: 'text-theme-flag-ok',
    border: 'border-theme-flag-ok-border',
  },
  topic: {
    bg: 'bg-theme-cat-sleep',
    text: 'text-theme-cat-sleep',
    border: 'border-theme-cat-sleep',
  },
  track: {
    bg: 'bg-theme-info-bg',
    text: 'text-theme-info',
    border: 'border-theme-info-border',
  },
};

function ChipRow({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone: ChipTone;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2.5">
      <p className="text-[10px] uppercase tracking-wide font-medium text-theme-muted-text-3 mb-1.5">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, idx) => (
          <span
            key={idx}
            className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border ${tone.bg} ${tone.text} ${tone.border}`}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

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
        <h2 className="text-sm text-theme-text">Support plan</h2>
      </div>
      <p className="text-xs text-theme-muted-text-3 px-1">
        Practical food, tracking, and discussion topics based on this report
      </p>

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
                  <p className="text-xs text-theme-muted-text-2 leading-relaxed mt-1.5">
                    {card.summary}
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
                <>
                  <ChipRow
                    label="Foods to focus on"
                    items={card.examples}
                    tone={CHIP_TONES.food}
                  />
                  <ChipRow
                    label="Topics to discuss"
                    items={card.discussionItems}
                    tone={CHIP_TONES.topic}
                  />
                  <ChipRow
                    label="Track next"
                    items={card.trackingItems}
                    tone={CHIP_TONES.track}
                  />

                  {card.note && (
                    <div className="mt-2.5 pt-2 border-t border-theme-border-inner">
                      <p className="text-[10px] uppercase tracking-wide font-medium text-theme-muted-text-3 mb-0.5">
                        Safety note
                      </p>
                      <p className="text-[11px] text-theme-muted-text-3 leading-relaxed">
                        {card.note}
                      </p>
                    </div>
                  )}
                </>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
