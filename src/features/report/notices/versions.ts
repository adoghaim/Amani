import type { ShownExplanation } from './types';

/** An explanation is on screen, but the read that produced it did not say which. */
export const UNIDENTIFIED_EXPLANATION: ShownExplanation = Object.freeze({ id: null, generatedAt: null });

/** The identity of the explanation an interpretations row carries, as far as the row has it. */
export function shownExplanationOf(row: { id?: unknown; generated_at?: unknown }): ShownExplanation {
  return {
    id: typeof row.id === 'string' ? row.id : null,
    generatedAt: typeof row.generated_at === 'string' ? row.generated_at : null,
  };
}
