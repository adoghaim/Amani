import { TrendingUp, MessageSquare, Heart, Calendar, ArrowRight } from 'lucide-react';
import { categorizeNextSteps, type NextStepBucket } from '../lib/insights/categorizeNextSteps';

interface NextBestStepsProps {
  whatYouCanDoNow: string[] | undefined;
  whatToDoNext: string[] | undefined;
  hideSupportBucket?: boolean;
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
    iconColor: 'text-sky-600',
    iconBg: 'bg-sky-50',
  },
  discuss: {
    label: 'Discuss',
    icon: MessageSquare,
    iconColor: 'text-violet-600',
    iconBg: 'bg-violet-50',
  },
  support: {
    label: 'Support',
    icon: Heart,
    iconColor: 'text-rose-600',
    iconBg: 'bg-rose-50',
  },
  retest: {
    label: 'Retest',
    icon: Calendar,
    iconColor: 'text-emerald-600',
    iconBg: 'bg-emerald-50',
  },
};

export function NextBestSteps({ whatYouCanDoNow, whatToDoNext, hideSupportBucket }: NextBestStepsProps) {
  const buckets = categorizeNextSteps(whatYouCanDoNow, whatToDoNext);
  const bucketOrder = hideSupportBucket
    ? BUCKET_ORDER.filter(b => b !== 'support')
    : BUCKET_ORDER;
  const populated = bucketOrder.filter(b => buckets[b].length > 0);

  if (populated.length === 0) return null;

  return (
    <div className="rounded-2xl border border-theme-border-subtle bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-theme-border-inner">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
            <ArrowRight className="w-4 h-4 text-amber-700" />
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
