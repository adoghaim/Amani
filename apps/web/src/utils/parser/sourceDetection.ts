import type { LabSource } from './types';

const QUEST_HEADER_RE    = /quest\s*diagnostics/i;
const LABCORP_HEADER_RE  = /labcorp|laboratory\s+corporation/i;
const HONE_HEADER_RE     = /hone\s+health|honehealth\.com/i;

const QUEST_ACCESSION_RE  = /specimen\s+id\s*[:.]?\s*[A-Z0-9]{6,}/i;
export const QUEST_HISTORY_RE   = /\bFrom\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s+To\s+\d{1,2}\/\d{1,2}\/\d{2,4}/i;
export const QUEST_FOOTER_RE    = /\([A-Z]{2,}\d+[A-Z]*\)\s+\d+\s*\/\s*\d+/;
const QUEST_REPORTING_RE  = /reporting\s+physician|performing\s+laboratory/i;

const LABCORP_ACCESSION_RE   = /accession\s+(?:number|#|no)?\s*[:.]?\s*\d{10,}/i;
const LABCORP_REFINTERVAL_RE = /ref(?:erence)?\.\s*interval\b/i;
const LABCORP_DIRECTOR_RE    = /laboratory\s+director|medical\s+director/i;

const HONE_MEMBER_RE      = /member\s+id|member\s+number/i;
const HONE_HISTORY_RE     = /current\s+result|previous\s+results?|your\s+trend/i;
const HONE_LAYOUT_RE      = /optimal\s+range|your\s+result/i;

export function detectReportSource(text: string): LabSource {
  if (QUEST_HEADER_RE.test(text))   return 'quest';
  if (LABCORP_HEADER_RE.test(text)) return 'labcorp';
  if (HONE_HEADER_RE.test(text))    return 'hone';

  const questScore =
    +QUEST_ACCESSION_RE.test(text) +
    +QUEST_HISTORY_RE.test(text) +
    +QUEST_FOOTER_RE.test(text) +
    +QUEST_REPORTING_RE.test(text);

  const labcorpScore =
    +LABCORP_ACCESSION_RE.test(text) +
    +LABCORP_REFINTERVAL_RE.test(text) +
    +LABCORP_DIRECTOR_RE.test(text);

  const honeScore =
    +HONE_MEMBER_RE.test(text) +
    +HONE_HISTORY_RE.test(text) +
    +HONE_LAYOUT_RE.test(text);

  const max = Math.max(questScore, labcorpScore, honeScore);
  if (max < 2) return 'unknown';
  if (questScore === max)   return 'quest';
  if (labcorpScore === max) return 'labcorp';
  if (honeScore === max)    return 'hone';
  return 'unknown';
}
