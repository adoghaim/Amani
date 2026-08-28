import type { AmaniStatus } from '../../types';

export type StatusPillVariant =
  | 'optimal'
  | 'normal'
  | 'borderline_low'
  | 'borderline_high'
  | 'out_of_range'
  | 'unknown';

export function amaniStatusToVariant(status: AmaniStatus): StatusPillVariant {
  if (status === 'optimal') return 'optimal';
  if (status === 'normal') return 'normal';
  if (status === 'borderline_low' || status === 'borderline_high') return status as StatusPillVariant;
  if (status === 'out_of_range_low' || status === 'out_of_range_high') return 'out_of_range';
  return 'unknown';
}

export const STATUS_PILL_CONFIG: Record<StatusPillVariant, {
  label: string;
  bg: string;
  text: string;
  border: string;
  dot: string;
}> = {
  optimal:       { label: 'Optimal',          bg: 'bg-theme-flag-ok-bg', text: 'text-theme-flag-ok', border: 'border-theme-flag-ok-border', dot: 'bg-theme-flag-ok' },
  normal:        { label: 'Normal',            bg: 'bg-theme-info-bg',    text: 'text-theme-info',    border: 'border-theme-info-border',   dot: 'bg-theme-info' },
  borderline_low:  { label: 'Borderline Low',  bg: 'bg-theme-flag-watch-bg',   text: 'text-theme-flag-watch',   border: 'border-theme-flag-watch-border',  dot: 'bg-theme-flag-watch' },
  borderline_high: { label: 'Borderline High', bg: 'bg-theme-flag-watch-bg',  text: 'text-theme-flag-watch',  border: 'border-theme-flag-watch-border', dot: 'bg-theme-flag-watch' },
  out_of_range:  { label: 'Outside Optimal',   bg: 'bg-theme-flag-low-bg',     text: 'text-theme-flag-low',     border: 'border-theme-flag-low-border',    dot: 'bg-theme-flag-low' },
  unknown:       { label: 'No Range',          bg: 'bg-theme-neutral-100',   text: 'text-theme-neutral-600',    border: 'border-theme-neutral-200',   dot: 'bg-theme-neutral-400' },
};
