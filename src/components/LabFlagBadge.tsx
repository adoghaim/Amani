import { LAB_FLAG_PREFIX } from '../lib/scoring/insightCopy';

/*
  The lab's own flag beside a value, exactly as printed (DESIGN.md "Result
  row" and Shapes: a 3px square ink badge, so it reads as printed rather than
  as an app chip). One badge for the result row and the result card: no status
  tint, role or live region.
*/
export function LabFlagBadge({ flag }: { flag: string }) {
  return (
    <span
      className="inline-flex items-center px-1 font-mono text-xs font-medium text-theme-text border border-theme-text rounded-[3px]"
      data-testid="lab-flag"
    >
      <span className="sr-only">{LAB_FLAG_PREFIX}</span>
      {flag}
    </span>
  );
}
