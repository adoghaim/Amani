import { REPORT_NOTICES, type ReportNotice, type ReportNoticeProps } from './index';

/**
 * The notices slot above the explanation (R22). It renders each notice in
 * list order, each given the report and its versions. It adds no element of
 * its own, so when no notice applies the page is exactly as it was.
 */
export function ReportNotices({ report, versions, notices = REPORT_NOTICES }: ReportNoticeProps & {
  /** The slot's list; tests pass their own. */
  notices?: readonly ReportNotice[];
}) {
  return (
    <>
      {notices.map(({ id, Component }) => <Component key={id} report={report} versions={versions} />)}
    </>
  );
}
