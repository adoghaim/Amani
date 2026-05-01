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
  optimal:       { label: 'Optimal',          bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  normal:        { label: 'Normal',            bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200',   dot: 'bg-blue-400' },
  borderline_low:  { label: 'Borderline Low',  bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',  dot: 'bg-amber-400' },
  borderline_high: { label: 'Borderline High', bg: 'bg-orange-50',  text: 'text-orange-700',  border: 'border-orange-200', dot: 'bg-orange-400' },
  out_of_range:  { label: 'Outside Optimal',   bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200',    dot: 'bg-red-500' },
  unknown:       { label: 'No Range',          bg: 'bg-gray-100',   text: 'text-gray-600',    border: 'border-gray-200',   dot: 'bg-gray-400' },
};
