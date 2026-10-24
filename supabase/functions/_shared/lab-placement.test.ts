import { describe, expect, it } from 'vitest';
import { labPlacement, labPlacementPhrase } from './lab-placement.ts';
import { labIntervalPlacement } from '../../../src/lib/scoring/insightCopy';

/*
  The server words a marker's position with the same rule the report page uses
  (TASK-045 release invariant 1: her lab's printed bounds, no margin). If the
  two copies ever disagree, a stored narrative could call a value "below the
  lab's reference range" that the page shows as "Within your lab's range".
*/

describe('labPlacement: the page\'s rule, on the server', () => {
  it('agrees with the page on every bound, operator and value', () => {
    const bounds: [number | null, number | null][] = [[16, 154], [30, 100], [0.4, 4.5], [null, 100], [50, null], [null, null], [5, 5]];
    const operators: [string | null, number | null][] = [[null, null], ['<', 100], ['<=', 5.7], ['< OR =', 200], ['>', 40], ['>=', 50], ['> OR =', 50], ['~', 3]];
    const values = [null, Number.NaN, -1, 0, 0.39, 0.4, 4.5, 4.51, 4.86, 5, 5.7, 5.71, 15.99, 16, 18, 24, 24.4, 25, 30, 49, 50, 99, 100, 100.01, 112, 154, 154.1, 200, 201];
    let compared = 0;
    for (const [min, max] of bounds) for (const [operator, operatorValue] of operators) for (const value of values) {
      const label = JSON.stringify({ value, min, max, operator, operatorValue });
      expect(labPlacement(value, min, max, operator, operatorValue), label)
        .toBe(labIntervalPlacement(value, min, max, operator, operatorValue));
      compared += 1;
    }
    expect(compared).toBeGreaterThan(1000);
  });

  it('places the 2026-10-17 smoke panel as the page did', () => {
    expect(labPlacement(18, 16, 154)).toBe('within');   // ferritin: inside its printed range, whatever the printed flag says
    expect(labPlacement(2.85, 0.4, 4.5)).toBe('within'); // TSH
    expect(labPlacement(25, 30, 100)).toBe('below');     // vitamin D: no margin, so never "borderline"
    expect(labPlacement(24, 30, 100)).toBe('below');
    expect(labPlacement(112, null, null, '<', 100)).toBe('above'); // LDL
    expect(labPlacement(61, null, null, '> OR =', 50)).toBe('within'); // HDL
  });

  it('words each placement against the lab\'s reference range', () => {
    expect(labPlacementPhrase('below')).toBe("below the lab's reference range");
    expect(labPlacementPhrase('within')).toBe("within the lab's reference range");
    expect(labPlacementPhrase('above')).toBe("above the lab's reference range");
  });
});
