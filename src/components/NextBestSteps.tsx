import { TrendingUp, MessageSquare, Heart, Calendar, ArrowRight } from 'lucide-react';
import { categorizeNextSteps, type NextStepBucket } from '../lib/insights/categorizeNextSteps';

interface NextBestStepsProps {
  whatYouCanDoNow: string[] | undefined;
  whatToDoNext: string[] | undefined;
  hideSupportBucket?: boolean;
  primaryDisplayName?: string | null;
}

const BUCKET_ORDER: NextStepBucket[] = ['track', 'discuss', 'support', 'retest'];

const BUCKET_META: Record<NextStepBucket, {
  label: string;
  icon: typeof TrendingUp;
  iconColor: string;
  iconBg: string;
}> = {
  track: {
    label: 'Track',
    icon: TrendingUp,
    iconColor: 'text-theme-info',
    iconBg: 'bg-theme-info-bg',
  },
  discuss: {
    label: 'Discuss',
    icon: MessageSquare,
    iconColor: 'text-theme-cat-sleep',
    iconBg: 'bg-theme-cat-sleep',
  },
  support: {
    label: 'Support',
    icon: Heart,
    iconColor: 'text-theme-flag-low',
    iconBg: 'bg-theme-flag-low-bg',
  },
  retest: {
    label: 'Retest',
    icon: Calendar,
    iconColor: 'text-theme-flag-ok',
    iconBg: 'bg-theme-flag-ok-bg',
  },
};

export function NextBestSteps({ whatYouCanDoNow, whatToDoNext, hideSupportBucket, primaryDisplayName }: NextBestStepsProps) {
  const buckets = categorizeNextSteps(whatYouCanDoNow, whatToDoNext);

  // Phase 8C safety net: when there's a clear primary finding but the AI's
  // next-steps text never mentions it, inject one non-prescriptive Discuss
  // item so the Main Focus always has at least one explicit next step.
  if (primaryDisplayName) {
    const needle = primaryDisplayName.toLowerCase();
    const mentioned = (Object.values(buckets) as string[][]).some(items =>
      items.some(item => item.toLowerCase().includes(needle)),
    );
    if (!mentioned) {
      buckets.discuss = [
        `Discuss whether ${primaryDisplayName} should be rechecked and what range your provider wants to target.`,
        ...buckets.discuss,
      ];
    }
  }

  const bucketOrder = hideSupportBucket
    ? BUCKET_ORDER.filter(b => b !== 'support')
    : BUCKET_ORDER;
  const populated = bucketOrder.filter(b => buckets[b].length > 0);

  if (populated.length === 0) return null;

  return (
    <div className="rounded-2xl border border-theme-border-subtle bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-theme-border-inner">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-theme-flag-watch-bg flex items-center justify-center">
            <ArrowRight className="w-4 h-4 text-theme-flag-watch" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-theme-text">Next Best Steps</h2>
            <p className="text-xs text-theme-muted-text-3 mt-0.5">Practical next moves grouped by intent</p>
          </div>
        </div>
      </div>

      <div className="px-5 py-4 space-y-5">
        {populated.map(bucket => {
          const meta = BUCKET_META[bucket];
          const Icon = meta.icon;
          const items = buckets[bucket];
          return (
            <div key={bucket}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-6 h-6 rounded-md ${meta.iconBg} flex items-center justify-center`}>
                  <Icon className={`w-3.5 h-3.5 ${meta.iconColor}`} />
                </span>
                <h3 className="text-xs font-semibold text-theme-muted-text-2 uppercase tracking-wide">
                  {meta.label}
                </h3>
              </div>
              <ul className="space-y-1.5 ml-8 list-disc list-outside">
                {items.map((item, i) => (
                  <li key={i} className="text-sm text-theme-text-body leading-relaxed">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
