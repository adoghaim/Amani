import type { LabSource } from '../types';

const QUEST_PATTERNS = [
  /quest\s*diagnostics/i,
  /myquest/i,
  /questdiagnostics\.com/i,
  /quest\s+diagnostics\s+incorporated/i,
];

const LABCORP_PATTERNS = [
  /laboratory\s+corporation/i,
  /labcorp/i,
  /lab\s*corp/i,
  /labcorp\s+patient/i,
  /labcorp\.com/i,
  /lca\s+(?:patient|portal)/i,
];

export function detectLabSource(text: string): LabSource {
  for (const pattern of QUEST_PATTERNS) {
    if (pattern.test(text)) return 'quest';
  }

  for (const pattern of LABCORP_PATTERNS) {
    if (pattern.test(text)) return 'labcorp';
  }

  return 'unknown';
}

export function labSourceLabel(source: LabSource): string {
  if (source === 'quest') return 'Quest';
  if (source === 'labcorp') return 'Labcorp';
  return 'Unknown';
}
