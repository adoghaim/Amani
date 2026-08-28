import { describe, it, expect } from 'vitest';
import { decideAiRefinement } from './aiRefinementGate';
import type { LabSource, ReportItem } from './types';

type GateItem = Pick<ReportItem, 'canonical_slug' | 'confidence_score' | 'needs_review' | 'parse_error'>;

/** A clean, mapped, confident item — the case we want to be able to skip on. */
const good = (over: Partial<GateItem> = {}): GateItem => ({
  canonical_slug: 'ferritin',
  confidence_score: 'high',
  needs_review: false,
  parse_error: null,
  ...over,
});

const input = (items: GateItem[], over: Partial<Parameters<typeof decideAiRefinement>[0]> = {}) => ({
  items,
  heuristics: { isWeak: false, score: 0.95 },
  detectedSource: 'quest' as LabSource | undefined,
  ...over,
});

describe('decideAiRefinement', () => {
  describe('skips the OpenAI call when the local parse is clean', () => {
    it('a full, mapped, confident panel from a recognised lab', () => {
      const d = decideAiRefinement(input(Array.from({ length: 12 }, () => good())));
      expect(d.refine).toBe(false);
      expect(d.reason).toContain('quest');
    });

    it('tolerates a minority of unmapped items', () => {
      // 1 of 12 unmapped = 8.3%, under the 15% bar
      const items = [...Array.from({ length: 11 }, () => good()), good({ canonical_slug: null })];
      expect(decideAiRefinement(input(items)).refine).toBe(false);
    });

    it('tolerates a minority of low-confidence items', () => {
      // 2 of 12 low = 16.7%, under the 25% bar
      const items = [
        ...Array.from({ length: 10 }, () => good()),
        good({ confidence_score: 'low' }),
        good({ confidence_score: 'low' }),
      ];
      expect(decideAiRefinement(input(items)).refine).toBe(false);
    });
  });

  describe('refines when the parse shows any sign of trouble', () => {
    it('heuristics flagged the extraction weak, and says why', () => {
      const d = decideAiRefinement(
        input(Array.from({ length: 12 }, () => good()), {
          heuristics: { isWeak: true, score: 0.1, reason: 'No items detected' },
        }),
      );
      expect(d).toEqual({ refine: true, reason: 'No items detected' });
    });

    it('too few items even when every one of them is clean', () => {
      const d = decideAiRefinement(input(Array.from({ length: 9 }, () => good())));
      expect(d.refine).toBe(true);
      expect(d.reason).toContain('below 10');
    });

    it('any item carrying a parse error', () => {
      const items = [...Array.from({ length: 11 }, () => good()), good({ parse_error: 'bad range' })];
      expect(decideAiRefinement(input(items)).refine).toBe(true);
    });

    it('an empty-string parse_error is not treated as an error', () => {
      const items = [...Array.from({ length: 11 }, () => good()), good({ parse_error: '' })];
      expect(decideAiRefinement(input(items)).refine).toBe(false);
    });

    it('any item the parser flagged for review', () => {
      const items = [...Array.from({ length: 11 }, () => good()), good({ needs_review: true })];
      expect(decideAiRefinement(input(items)).refine).toBe(true);
    });

    it('too many unmapped items', () => {
      // 2 of 12 = 16.7%, over the 15% bar
      const items = [
        ...Array.from({ length: 10 }, () => good()),
        good({ canonical_slug: null }),
        good({ canonical_slug: null }),
      ];
      const d = decideAiRefinement(input(items));
      expect(d.refine).toBe(true);
      expect(d.reason).toContain('unmapped');
    });

    it('too many low-confidence items', () => {
      // 4 of 12 = 33%, over the 25% bar
      const items = [
        ...Array.from({ length: 8 }, () => good()),
        ...Array.from({ length: 4 }, () => good({ confidence_score: 'low' as const })),
      ];
      expect(decideAiRefinement(input(items)).refine).toBe(true);
    });

    it('an unrecognised lab layout', () => {
      const d = decideAiRefinement(
        input(Array.from({ length: 12 }, () => good()), { detectedSource: 'unknown' }),
      );
      expect(d).toEqual({ refine: true, reason: 'Lab source not recognised' });
    });

    it('a MISSING lab source is treated as unrecognised, not as a pass', () => {
      const d = decideAiRefinement(
        input(Array.from({ length: 12 }, () => good()), { detectedSource: undefined }),
      );
      expect(d.refine).toBe(true);
    });

    it('no items at all', () => {
      expect(decideAiRefinement(input([])).refine).toBe(true);
    });
  });

  it('never divides by zero on an empty panel', () => {
    expect(() => decideAiRefinement(input([]))).not.toThrow();
  });

  it('recognises every known lab source as skippable', () => {
    for (const source of ['quest', 'labcorp', 'hone'] as const) {
      const d = decideAiRefinement(
        input(Array.from({ length: 12 }, () => good()), { detectedSource: source }),
      );
      expect(d.refine, `${source} should be skippable`).toBe(false);
    }
  });
});
