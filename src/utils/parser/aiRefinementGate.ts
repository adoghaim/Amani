import type { LabSource, ReportItem } from './types';

/*
  Should we spend an OpenAI call refining this parse?

  Today every confident parse still fires `extract-biomarkers`, so we pay for a
  refinement pass on reports the local parser already handled cleanly. The
  parser exists precisely so the model is the safety net rather than the first
  resort (see the pipeline's "parser handles known formats, AI is the safety
  net" design), and the call sits on the upload path for every user.

  This is deliberately fail-OPEN: every rule below turns refinement ON. If the
  signals are ambiguous, or a field we rely on is missing, we refine. A wrong
  "skip" degrades someone's lab report to save a fraction of a cent, which is
  the wrong trade in a health product; a wrong "refine" only costs money.
*/

/** Below this, a panel is too thin to trust on its own. */
const MIN_ITEMS = 10;
/** Share of items the parser could not map to the canonical catalogue. */
const MAX_UNMAPPED_RATIO = 0.15;
/** Share of items parsed with low confidence. */
const MAX_LOW_CONFIDENCE_RATIO = 0.25;

type GateItem = Pick<
  ReportItem,
  'canonical_slug' | 'confidence_score' | 'needs_review' | 'parse_error'
>;

export interface AiRefinementInput {
  items: GateItem[];
  heuristics: { isWeak: boolean; score: number; reason?: string };
  /** From ParserDebugOutput. `undefined` means detection did not run. */
  detectedSource: LabSource | undefined;
}

export interface AiRefinementDecision {
  refine: boolean;
  /** Why, in words — surfaced in the parser debugger and worth logging. */
  reason: string;
}

export function decideAiRefinement({
  items,
  heuristics,
  detectedSource,
}: AiRefinementInput): AiRefinementDecision {
  if (heuristics.isWeak) {
    return { refine: true, reason: heuristics.reason ?? 'Parse flagged as weak' };
  }

  if (items.length < MIN_ITEMS) {
    return { refine: true, reason: `Only ${items.length} item(s) parsed, below ${MIN_ITEMS}` };
  }

  const errored = items.filter((i) => i.parse_error != null && i.parse_error !== '').length;
  if (errored > 0) {
    return { refine: true, reason: `${errored} item(s) reported a parse error` };
  }

  const flagged = items.filter((i) => i.needs_review).length;
  if (flagged > 0) {
    return { refine: true, reason: `${flagged} item(s) flagged needs_review` };
  }

  const unmapped = items.filter((i) => i.canonical_slug == null).length;
  if (unmapped / items.length > MAX_UNMAPPED_RATIO) {
    return {
      refine: true,
      reason: `${unmapped}/${items.length} items unmapped to the analyte catalogue`,
    };
  }

  const lowConf = items.filter((i) => i.confidence_score === 'low').length;
  if (lowConf / items.length > MAX_LOW_CONFIDENCE_RATIO) {
    return {
      refine: true,
      reason: `${lowConf}/${items.length} items parsed with low confidence`,
    };
  }

  /*
    An unrecognised layout means the generic adapter did the work, and the
    generic adapter is the one we trust least. `undefined` lands here too: a
    missing signal is not evidence of a good parse.
  */
  if (detectedSource === undefined || detectedSource === 'unknown') {
    return { refine: true, reason: 'Lab source not recognised' };
  }

  return {
    refine: false,
    reason: `${items.length} items from a recognised ${detectedSource} layout, all mapped and confident`,
  };
}
