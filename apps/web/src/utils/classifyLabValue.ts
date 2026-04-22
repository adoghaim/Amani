export type LabValueStatus = 'in_range' | 'out_of_range' | 'borderline' | 'unknown';

export function classifyLabValue(
  value: number | null | undefined,
  min: number | null | undefined,
  max: number | null | undefined,
  operator?: string | null,
  operatorValue?: number | null
): LabValueStatus {
  if (value == null) return 'unknown';

  if (min != null && max != null) {
    const range = max - min;
    const buf = range * 0.08;
    if (value < min - buf || value > max + buf) return 'out_of_range';
    if (value < min || value > max) return 'borderline';
    return 'in_range';
  }

  if (operator && operatorValue != null) {
    const op = operator;
    if (op === '<' || op === '<=' || op === '< OR =') {
      return value <= operatorValue ? 'in_range' : 'out_of_range';
    }
    if (op === '>' || op === '>=' || op === '> OR =') {
      return value >= operatorValue ? 'in_range' : 'out_of_range';
    }
  }

  return 'unknown';
}
