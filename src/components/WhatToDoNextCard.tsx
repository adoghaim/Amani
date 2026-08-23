import { Eye, MessageSquareText, FlaskConical, ArrowRight } from 'lucide-react';

type Bucket = 'track' | 'discuss' | 'retest';

interface BucketedItem {
  text: string;
  bucket: Bucket | null;
}

const BUCKET_PATTERNS: Record<Bucket, RegExp> = {
  track: /\b(track|monitor|watch|log|note(?:\s+down)?|keep an eye|observe|record)\b/i,
  discuss: /\b(ask|discuss|provider|doctor|clinician|healthcare|talk(?:\s+to)?|speak\s+with|consult|bring up|raise)\b/i,
  retest: /\b(retest|recheck|re-?check|re-?test|follow[\s-]?up\s+lab|next\s+lab|repeat\s+(?:lab|panel|test)|panel|order\s+(?:a|an|the)?\s*(?:test|panel)|lab\s+work|reassess)\b/i,
};

function classify(text: string): Bucket | null {
  // Order matters when an item could match multiple — prefer the most specific.
  if (BUCKET_PATTERNS.retest.test(text)) return 'retest';
  if (BUCKET_PATTERNS.discuss.test(text)) return 'discuss';
  if (BUCKET_PATTERNS.track.test(text)) return 'track';
  return null;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenSet(s: string): Set<string> {
  return new Set(normalize(s).split(' ').filter(t => t.length > 3));
}

function similar(a: string, b: string): boolean {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  const smaller = Math.min(ta.size, tb.size);
  return overlap / smaller >= 0.7;
}

function dedup(items: string[], existing: string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (existing.some(e => similar(item, e))) continue;
    if (out.some(o => similar(item, o))) continue;
    out.push(item);
  }
  return out;
}

const BUCKET_META: Record<Bucket, { label: string; icon: typeof Eye; iconColor: string; bg: string }> = {
  track: { label: 'Track', icon: Eye, iconColor: 'text-theme-info', bg: 'bg-theme-info-bg' },
  discuss: { label: 'Discuss with your provider', icon: MessageSquareText, iconColor: 'text-theme-cat-sleep', bg: 'bg-theme-cat-sleep' },
  retest: { label: 'Prepare for next labs', icon: FlaskConical, iconColor: 'text-theme-flag-ok', bg: 'bg-theme-flag-ok-bg' },
};

interface Props {
  items: string[];
  existingNextSteps?: string[];
}

export function WhatToDoNextCard({ items, existingNextSteps = [] }: Props) {
  const filtered = dedup(items, existingNextSteps).map<BucketedItem>(text => ({ text, bucket: classify(text) }));

  if (filtered.length === 0) return null;

  // Group by bucket; null bucket → "other"
  const buckets: Bucket[] = ['discuss', 'track', 'retest'];
  const grouped: Record<Bucket, BucketedItem[]> = { track: [], discuss: [], retest: [] };
  const ungrouped: BucketedItem[] = [];
  for (const item of filtered) {
    if (item.bucket) grouped[item.bucket].push(item);
    else ungrouped.push(item);
  }

  const hasGroups = buckets.some(b => grouped[b].length > 0);
  const useGrouped = hasGroups && ungrouped.length <= filtered.length / 2;

  return (
    <div className="rounded-2xl border border-theme-border-subtle bg-theme-surface overflow-hidden">
      <div className="px-5 py-4 border-b border-theme-border-inner">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-theme-flag-watch-bg flex items-center justify-center">
            <ArrowRight className="w-4 h-4 text-theme-flag-watch" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-theme-text">What to Do Next</h2>
            <p className="text-xs text-theme-muted-text-3 mt-0.5">Practical next moves based on this report</p>
          </div>
        </div>
      </div>

      <div className="px-5 py-4 space-y-5">
        {useGrouped ? (
          <>
            {buckets.map(b => {
              const bucketItems = grouped[b];
              if (bucketItems.length === 0) return null;
              const meta = BUCKET_META[b];
              const Icon = meta.icon;
              return (
                <div key={b}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-6 h-6 rounded-md ${meta.bg} flex items-center justify-center`}>
                      <Icon className={`w-3.5 h-3.5 ${meta.iconColor}`} />
                    </span>
                    <h3 className="text-xs font-semibold text-theme-muted-text-2 uppercase tracking-wide">{meta.label}</h3>
                  </div>
                  <ul className="space-y-1.5 ml-8">
                    {bucketItems.map((item, i) => (
                      <li key={i} className="text-sm text-theme-text-body leading-relaxed list-disc list-outside">
                        {item.text}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {ungrouped.length > 0 && (
              <ul className="space-y-1.5 ml-2 list-disc list-inside">
                {ungrouped.map((item, i) => (
                  <li key={i} className="text-sm text-theme-text-body leading-relaxed">
                    {item.text}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <ul className="space-y-2 list-disc list-inside">
            {filtered.map((item, i) => (
              <li key={i} className="text-sm text-theme-text-body leading-relaxed">
                {item.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
