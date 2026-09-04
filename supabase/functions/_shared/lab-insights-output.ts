/**
 * Normalizes `lab-insights` model output before it reaches a client.
 *
 * ## The bug this closes
 *
 * `lab-insights` was the one OpenAI path with no output validation at all:
 *
 *     const insights = JSON.parse(openaiData.choices[0].message.content);
 *     return new Response(JSON.stringify({ insights, ... }));
 *
 * Straight from the model to the client. `generate-interpretation` validates its
 * output against a Zod schema and sanitizes it against the nutrient policy; this
 * function did neither, and the shape was declared only inside the prompt.
 *
 * The client does not defend itself either. `InsightsModal.tsx` renders
 * `<ChangeIcon text={change.change} />`, and `ChangeIcon` calls
 * `text.toLowerCase()` with no guard. So a single `notable_changes` element
 * missing its `change` field throws inside render — and because `ErrorBoundary`
 * sits at the app root with no per-route boundary, that blanks the **entire
 * app**, not just the modal.
 *
 * That is reachable today, from one malformed model response. It is also exactly
 * what tier-based trimming would produce, which is how it was found.
 *
 * Fixing it here rather than only in the client is deliberate: the shipped
 * native builds (1.0.3, build 5) cannot be updated, and they contain the same
 * unguarded `toLowerCase()`. A server-side guarantee protects them; a client fix
 * does not.
 *
 * ## Degrade, don't reject
 *
 * A malformed element drops; the rest of the response survives. Rejecting the
 * whole payload would turn one bad array entry into "no insights at all", which
 * is worse for the user and no safer.
 *
 * Pure — no Deno, no zod, no network — so vitest drives it directly.
 */

export interface NotableChange {
  biomarker: string;
  change: string;
  possible_factors: string[];
}

export interface LabInsightsOutput {
  summary: string;
  notable_changes: NotableChange[];
  questions_to_ask: string[];
  next_steps_general: string[];
}

/** Bounds, so a runaway model response cannot become a payload problem. */
const MAX_NOTABLE_CHANGES = 25;
const MAX_LIST_ITEMS = 25;
const MAX_STRING_LENGTH = 4000;

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, MAX_STRING_LENGTH);
}

function asStringList(value: unknown, max = MAX_LIST_ITEMS): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const str = asString(item);
    if (str !== null) out.push(str);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * A `notable_changes` element is only usable when both `biomarker` and `change`
 * are non-empty strings — `change` because the client calls `.toLowerCase()` on
 * it, `biomarker` because an unlabelled change tells the user nothing.
 */
function asNotableChange(value: unknown): NotableChange | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  const biomarker = asString(record.biomarker);
  const change = asString(record.change);
  if (biomarker === null || change === null) return null;

  return {
    biomarker,
    change,
    possible_factors: asStringList(record.possible_factors),
  };
}

/**
 * Coerces arbitrary parsed JSON into the shape every client already expects.
 * Never throws, never returns undefined fields.
 */
export function normalizeLabInsights(raw: unknown): LabInsightsOutput {
  const record = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};

  const notableChanges: NotableChange[] = [];
  if (Array.isArray(record.notable_changes)) {
    for (const entry of record.notable_changes) {
      const normalized = asNotableChange(entry);
      if (normalized !== null) notableChanges.push(normalized);
      if (notableChanges.length >= MAX_NOTABLE_CHANGES) break;
    }
  }

  return {
    summary: asString(record.summary) ?? "",
    notable_changes: notableChanges,
    questions_to_ask: asStringList(record.questions_to_ask),
    next_steps_general: asStringList(record.next_steps_general),
  };
}

/**
 * Parses an OpenAI chat completion body into normalized insights.
 *
 * Returns null when there is nothing usable — no choices, no content, or
 * unparseable JSON — so the handler can fail explicitly instead of throwing on
 * `choices[0]` being undefined, which it previously did.
 */
export function parseLabInsightsCompletion(
  completion: unknown,
): LabInsightsOutput | null {
  if (!completion || typeof completion !== "object") return null;

  const choices = (completion as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;

  const first = choices[0];
  if (!first || typeof first !== "object") return null;

  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== "object") return null;

  const content = (message as Record<string, unknown>).content;
  if (typeof content !== "string") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  return normalizeLabInsights(parsed);
}
