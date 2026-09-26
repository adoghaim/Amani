import { Sparkles } from 'lucide-react';
import { complimentaryCounterCopy } from '../../lib/freemium/copy';

interface ComplimentaryCounterProps {
  /** Lifetime claims used — `useSubscription().complimentary.used`. */
  used: number;
  /** `compact` is the one-line form for status badges. */
  variant?: 'card' | 'compact';
  /** Omit "Premium Analysis N of 3 included" (a Basic report used no claim). */
  hideUsage?: boolean;
}

/** The locked §6 counter copy. Only ever shown to a Free account. */
export function ComplimentaryCounter({ used, variant = 'card', hideUsage = false }: ComplimentaryCounterProps) {
  const copy = complimentaryCounterCopy(used);
  const usage = hideUsage ? null : copy.usage;
  const { status } = copy;

  if (variant === 'compact') {
    return <p className="text-xs text-theme-muted-text-2">{status}</p>;
  }

  return (
    <div className="rounded-xl border border-theme-border bg-theme-surface px-4 py-3 flex items-start gap-3">
      <Sparkles className="w-4 h-4 text-theme-primary shrink-0 mt-0.5" />
      <div className="space-y-0.5">
        {usage && <p className="text-sm font-medium text-theme-text">{usage}</p>}
        <p className="text-sm text-theme-muted-text-2">{status}</p>
      </div>
    </div>
  );
}
