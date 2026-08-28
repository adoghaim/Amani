type AmaniLogoProps = {
  className?: string;
  lockup?: boolean;
  markOnly?: boolean;
  size?: 'sm' | 'md' | 'lg';
};

const compactSizes = {
  sm: { mark: 'h-7 w-7', word: 'text-[1.35rem]' },
  md: { mark: 'h-9 w-9', word: 'text-[1.75rem]' },
  lg: { mark: 'h-12 w-12', word: 'text-[2.35rem]' },
};

const lockupSizes = {
  sm: 'w-40 sm:w-44',
  md: 'w-56 sm:w-64',
  lg: 'w-[19rem] sm:w-[28rem] md:w-[34rem]',
};

/**
 * Canonical Amani identity. Compact mode keeps the mark legible in navigation;
 * lockup mode includes the approved “Understand today. Empower tomorrow.” line.
 */
export function AmaniLogo({ className = '', lockup = false, markOnly = false, size = 'md' }: AmaniLogoProps) {
  if (lockup) {
    return (
      <img
        src="/brand/amani-lockup.png"
        alt="Amani — Understand today. Empower tomorrow."
        className={`${lockupSizes[size]} h-auto object-contain ${className}`}
      />
    );
  }

  const dimensions = compactSizes[size];
  if (markOnly) {
    return (
      <img
        src="/brand/amani-mark.png"
        alt="Amani"
        className={`${dimensions.mark} object-contain ${className}`}
      />
    );
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className}`} aria-label="Amani">
      <img
        src="/brand/amani-mark.png"
        alt=""
        aria-hidden="true"
        className={`${dimensions.mark} object-contain shrink-0`}
      />
      <span className={`${dimensions.word} font-display font-medium leading-none tracking-[-0.03em] text-theme-text lowercase`}>
        amani
      </span>
    </span>
  );
}
