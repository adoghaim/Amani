/*
  Test-only helpers for owner R1 (V2-03b turn 13). Not imported by the app.

  A prohibition check only finds the vocabulary it already knows: a re-mounted
  model sentence that names no forbidden word passes it. These helpers assert
  the positive property instead, which no vocabulary can miss: inside every
  model-fed surface, every piece of text sits inside a policy element whose
  claim resolves, and every model-derived sentence is an issued claim's phrase.
*/
import { resolveModelProposal, type MovementClaim } from './insightCopy';

/**
 * Model-shaped prose that carries no forbidden word, so a vocabulary guard
 * cannot see it. Any of these on a page means model text reached it.
 */
export const MODEL_CANARIES = [
  'Your thyroid looks well balanced for this time of the month.',
  'This combination usually reflects how busy life has been lately.',
  'Many women see this after travel, so it may settle by itself.',
  'Your iron picture fits a pattern of heavier cycles.',
  'This panel gives a calm overall picture of your metabolism.',
  'Your glucose handling looks typical for someone your age.',
  'The luteal phase explains most of what is visible here.',
  'A gentle reset of routine often helps with numbers like these.',
] as const;

/** Text inside `[data-model-surface]` that is not inside a policy-authored element. */
export function unprovenancedText(root: ParentNode, chrome: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const surface of Array.from(root.querySelectorAll('[data-model-surface]'))) {
    const walker = surface.ownerDocument.createTreeWalker(surface, 4 /* NodeFilter.SHOW_TEXT */);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').trim();
      if (!text || chrome.includes(text)) continue;
      const owner = node.parentElement?.closest('[data-language-category]');
      if (!owner || !surface.contains(owner)) out.push(`${surface.getAttribute('data-model-surface')}: ${text}`);
    }
  }
  return out;
}

/**
 * Every model-derived element must hold exactly one measured-movement claim
 * element, with nothing else in it, whose text resolves to one of `claims`
 * and carries the claim's category, source and neutral cue. Returns problems.
 */
export function unresolvedModelProse(root: ParentNode, claims: readonly MovementClaim[]): string[] {
  const out: string[] = [];
  for (const el of Array.from(root.querySelectorAll('[data-model-field]'))) {
    const field = el.getAttribute('data-model-field');
    const inner = el.querySelectorAll('[data-language-claim="measured_movement"]');
    const text = el.textContent ?? '';
    if (inner.length !== 1 || inner[0]!.textContent !== text) {
      out.push(`${field}: not exactly one claim element: ${text}`);
      continue;
    }
    const claim = inner[0]!;
    if (claim.getAttribute('data-language-category') !== 'factual_observation'
      || claim.getAttribute('data-language-source') !== 'lab_data'
      || claim.getAttribute('data-language-cue') !== 'neutral') out.push(`${field}: wrong authority attributes: ${text}`);
    if (!resolveModelProposal(claims, text)) out.push(`${field}: resolves to no claim: ${text}`);
  }
  return out;
}
