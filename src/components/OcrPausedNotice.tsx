import { CalmNotice } from './CalmNotice';
import { OCR_PAUSED_SAFE, OCR_PAUSED_TITLE } from '../lib/aiPause';

/**
 * PK-FIX-01b (D12, D7): reading the photos answered that the owner has paused
 * AI processing. A calm notice, not an error: no rose, no warning icon, and
 * manual entry still works. Announced politely (CalmNotice).
 */
export function OcrPausedNotice({ className = '' }: { className?: string }) {
  return <CalmNotice title={OCR_PAUSED_TITLE} safe={OCR_PAUSED_SAFE} className={className} />;
}
