import { CalmNotice } from '../../../components/CalmNotice';
import { REPORT_PAUSED_SAFE, REPORT_PAUSED_TITLE } from '../../../lib/aiPause';
import type { ReportNoticeProps } from './types';

/**
 * DT9 (D12, D7): the last generation for this report answered while the
 * owner's AI kill switch was on, so the explanation shown is the basic one.
 * A calm notice, never an error: nothing of hers was lost.
 */
export function AiPausedNotice({ versions }: ReportNoticeProps) {
  if (!versions.aiPaused || versions.shown === null) return null;
  return <CalmNotice title={REPORT_PAUSED_TITLE} safe={REPORT_PAUSED_SAFE} />;
}
