import { Button } from '../../../components/Button';
import { MoreMenu } from '../../../components/MoreMenu';
import { arrangeReportHeader, REPORT_HEADER_ACTIONS, type ReportHeaderAction, type ReportHeaderContext } from './index';

/**
 * The report header slot (D19): one primary action plus a labelled More menu,
 * mounted from REPORT_HEADER_ACTIONS. The primary keeps the look the header's
 * button had; every other action is in More.
 */
export function ReportHeaderActions({ context, actions = REPORT_HEADER_ACTIONS }: {
  context: ReportHeaderContext;
  /** The header's list; tests pass their own. */
  actions?: readonly ReportHeaderAction[];
}) {
  const { primary, more } = arrangeReportHeader(actions, context);
  if (!primary && more.length === 0) return null;
  const PrimaryIcon = primary?.icon;
  return (
    <div className="flex flex-shrink-0 items-start gap-2">
      {primary && PrimaryIcon && (
        <Button variant="primary" size="sm" onClick={() => primary.onSelect()} disabled={primary.disabled}>
          <PrimaryIcon aria-hidden="true" className={`w-3.5 h-3.5 mr-1.5 ${primary.busy ? 'animate-spin' : ''}`} />
          {primary.label}
        </Button>
      )}
      {more.length > 0 && <MoreMenu label="More" listLabel="More report actions" items={more} />}
    </div>
  );
}
