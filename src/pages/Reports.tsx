import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  FileText,
  Plus,
  Search,
  Trash2,
  ArrowRight,
  TestTube2,
  Clock,
  CheckCircle,
  XCircle,
  ChevronDown,
  AlertTriangle,
  FlaskConical,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { supabase } from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import { useAuth } from '../contexts/AuthContext';
import type { LabReport } from '../types';

type SortKey = 'report_date' | 'upload_date' | 'status';
type SortDir = 'asc' | 'desc';

function formatDate(dateStr: string) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatDateShort(dateStr: string) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function timeAgo(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 30) return `${diffDays} days ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths === 1) return '1 month ago';
  if (diffMonths < 12) return `${diffMonths} months ago`;
  return formatDateShort(dateStr);
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'ready') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-theme-flag-ok-bg text-theme-flag-ok border border-theme-flag-ok-border">
        <CheckCircle className="w-3 h-3" /> Ready
      </span>
    );
  }
  if (status === 'processing') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-theme-flag-watch-bg text-theme-flag-watch border border-theme-flag-watch-border">
        <Clock className="w-3 h-3 animate-pulse" /> Processing
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-theme-flag-low-bg text-theme-flag-low border border-theme-flag-low-border">
        <XCircle className="w-3 h-3" /> Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-theme-neutral-50 text-theme-neutral-600 border border-theme-neutral-200">
      <Clock className="w-3 h-3" /> {status}
    </span>
  );
}

function PhaseBadge({ phase }: { phase?: string | null }) {
  if (!phase || phase === 'unknown') return null;
  const colors: Record<string, string> = {
    menstrual: 'bg-theme-flag-low-bg text-theme-flag-low border-theme-flag-low-border',
    follicular: 'bg-theme-info-bg text-theme-info border-theme-info-border',
    ovulatory: 'bg-theme-flag-ok-bg text-theme-flag-ok border-theme-flag-ok-border',
    luteal: 'bg-theme-cat-sleep text-theme-cat-sleep border-theme-cat-sleep',
  };
  const cls = colors[phase] ?? 'bg-theme-neutral-50 text-theme-neutral-600 border-theme-neutral-200';
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border capitalize ${cls}`}>
      {phase}
    </span>
  );
}

interface DeleteModalProps {
  report: LabReport;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
  error?: string | null;
}

function DeleteModal({ report, onConfirm, onCancel, deleting, error }: DeleteModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-theme-surface rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-5 border-b border-theme-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-theme-flag-low-bg flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-theme-flag-low" />
            </div>
            <div>
              <h2 className="text-base text-theme-text">Delete report?</h2>
              <p className="text-sm text-theme-muted-text mt-0.5">This cannot be undone.</p>
            </div>
          </div>
        </div>
        <div className="px-6 py-4">
          <p className="text-sm text-theme-text-body">
            You are about to permanently delete the report from{' '}
            <span className="font-semibold text-theme-text">{formatDate(report.report_date)}</span>
            , including all biomarkers and AI insights. This action cannot be reversed.
          </p>
          {error && (
            <div className="mt-3 px-3 py-2 rounded-lg bg-theme-flag-low-bg border border-theme-flag-low-border text-sm text-theme-flag-low">
              {error}
            </div>
          )}
        </div>
        <div className="px-6 py-4 bg-theme-neutral-50 flex justify-end gap-3 border-t border-theme-neutral-100">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="px-4 py-2 text-sm font-medium text-theme-text-body bg-theme-surface border border-theme-border rounded-xl hover:bg-theme-surface-2 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="px-4 py-2 text-sm font-medium text-white bg-theme-flag-low rounded-xl hover:bg-theme-flag-low transition-colors disabled:opacity-60 flex items-center gap-2"
          >
            {deleting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="w-3.5 h-3.5" /> Delete report
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Reports() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<LabReport[]>([]);
  const [biomarkerCounts, setBiomarkerCounts] = useState<Record<string, number>>({});
  const [analyteCounts, setAnalyteCounts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('report_date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [deleteTarget, setDeleteTarget] = useState<LabReport | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (user) fetchData();
  }, [user]);

  const fetchData = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const reportsRes = await supabase
        .from('lab_reports')
        .select('*')
        .eq('user_id', user.id)
        .order('report_date', { ascending: false });

      if (reportsRes.error) throw reportsRes.error;

      const fetchedReports = reportsRes.data ?? [];
      setReports(fetchedReports as LabReport[]);

      const reportIds = fetchedReports.map(r => r.id);

      const [biomarkersRes, analytesRes] = reportIds.length > 0
        ? await Promise.all([
            supabase.from('biomarkers').select('lab_report_id').in('lab_report_id', reportIds),
            supabase.from('report_analytes').select('lab_report_id').in('lab_report_id', reportIds),
          ])
        : [{ data: [], error: null }, { data: [], error: null }];

      if (biomarkersRes.error) throw biomarkersRes.error;
      if (analytesRes.error) throw analytesRes.error;

      const bCounts: Record<string, number> = {};
      for (const b of (biomarkersRes.data ?? [])) {
        bCounts[b.lab_report_id] = (bCounts[b.lab_report_id] ?? 0) + 1;
      }
      setBiomarkerCounts(bCounts);

      const aCounts: Record<string, number> = {};
      for (const a of (analytesRes.data ?? [])) {
        aCounts[a.lab_report_id] = (aCounts[a.lab_report_id] ?? 0) + 1;
      }
      setAnalyteCounts(aCounts);
    } catch (err) {
      setError(errorMessage(err, "Couldn't load your reports. Check your connection and try again."));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    const { error } = await supabase.from('lab_reports').delete().eq('id', deleteTarget.id);
    setDeleting(false);
    if (error) {
      setDeleteError(errorMessage(error, 'Failed to delete this report. Please try again.'));
      return;
    }
    setReports(prev => prev.filter(r => r.id !== deleteTarget.id));
    setDeleteTarget(null);
  };

  const cycleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const filtered = reports
    .filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const dateStr = formatDate(r.report_date).toLowerCase();
        const phase = (r.estimated_cycle_phase ?? '').toLowerCase();
        if (!dateStr.includes(q) && !phase.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      let av: string, bv: string;
      if (sortKey === 'status') {
        av = a.status; bv = b.status;
      } else {
        av = a[sortKey] ?? '';
        bv = b[sortKey] ?? '';
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

  const SortIcon = ({ col }: { col: SortKey }) => (
    <ChevronDown
      className={`w-3.5 h-3.5 ml-0.5 inline transition-transform ${sortKey === col && sortDir === 'asc' ? 'rotate-180' : ''} ${sortKey === col ? 'opacity-100' : 'opacity-30'}`}
    />
  );

  if (loading) return <Layout><Loading /></Layout>;

  return (
    <Layout>
      {deleteTarget && (
        <DeleteModal
          report={deleteTarget}
          onConfirm={handleDelete}
          onCancel={() => { setDeleteTarget(null); setDeleteError(null); }}
          deleting={deleting}
          error={deleteError}
        />
      )}

      <div className="max-w-5xl mx-auto">
        <PageHeader
          title="Lab panels"
          description={
            reports.length === 0
              ? 'Nothing uploaded yet.'
              : `${reports.length} panel${reports.length !== 1 ? 's' : ''} on file.`
          }
          action={
            <Link to="/app/new">
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                New panel
              </Button>
            </Link>
          }
        />

        {error && (
          <div className="mb-5 px-4 py-3 rounded-xl bg-theme-flag-low-bg border border-theme-flag-low-border flex items-start justify-between gap-3">
            <div className="text-sm text-theme-flag-low flex-1">{error}</div>
            <button
              onClick={fetchData}
              className="text-sm font-medium text-theme-flag-low underline hover:no-underline whitespace-nowrap"
            >
              Retry
            </button>
          </div>
        )}

        {reports.length === 0 ? (
          <div className="bg-theme-surface rounded-2xl border border-theme-border shadow-sm px-6 py-20 text-center">
            <div className="w-16 h-16 bg-theme-surface-2 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <TestTube2 className="w-8 h-8 text-theme-primary" />
            </div>
            <h3 className="text-lg text-theme-text mb-2">No lab reports yet</h3>
            <p className="text-sm text-theme-muted-text mb-6 max-w-xs mx-auto">
              Upload your first lab report to start tracking your biomarkers and getting AI insights.
            </p>
            <Link
              to="/app/new"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-theme-primary text-white text-sm font-semibold rounded-xl hover:bg-theme-primary-dark transition-colors"
            >
              <Plus className="w-4 h-4" />
              Upload first report
            </Link>
          </div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row gap-3 mb-5">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-muted-text-4" />
                <input
                  type="text"
                  placeholder="Search by date or cycle phase..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 text-sm border border-theme-border rounded-xl bg-theme-surface focus:outline-none focus:ring-2 focus:ring-theme-primary/30 focus:border-theme-primary text-theme-text placeholder:text-theme-muted-text-4"
                />
              </div>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="px-3 py-2.5 text-sm border border-theme-border rounded-xl bg-theme-surface focus:outline-none focus:ring-2 focus:ring-theme-primary/30 focus:border-theme-primary text-theme-text min-w-[140px]"
              >
                <option value="all">All statuses</option>
                <option value="ready">Ready</option>
                <option value="processing">Processing</option>
                <option value="error">Error</option>
              </select>
            </div>

            {filtered.length === 0 ? (
              <div className="bg-theme-surface rounded-2xl border border-theme-border shadow-sm px-6 py-16 text-center">
                <Search className="w-8 h-8 text-theme-primary-faded mx-auto mb-3" />
                <p className="text-sm font-medium text-theme-text-body">No reports match your filters</p>
                <button
                  onClick={() => { setSearch(''); setStatusFilter('all'); }}
                  className="mt-3 text-sm text-theme-primary hover:underline"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="bg-theme-surface rounded-2xl border border-theme-border shadow-sm overflow-hidden">
                <div className="hidden sm:grid grid-cols-[1fr_140px_120px_120px_80px_48px] gap-4 px-5 py-3 border-b border-theme-border-inner bg-theme-background-tint">
                  <button
                    onClick={() => cycleSort('report_date')}
                    className="text-left text-xs font-semibold text-theme-muted-text uppercase tracking-wide hover:text-theme-primary transition-colors"
                  >
                    Report date <SortIcon col="report_date" />
                  </button>
                  <button
                    onClick={() => cycleSort('upload_date')}
                    className="text-left text-xs font-semibold text-theme-muted-text uppercase tracking-wide hover:text-theme-primary transition-colors"
                  >
                    Analyzed <SortIcon col="upload_date" />
                  </button>
                  <button
                    onClick={() => cycleSort('status')}
                    className="text-left text-xs font-semibold text-theme-muted-text uppercase tracking-wide hover:text-theme-primary transition-colors"
                  >
                    Status <SortIcon col="status" />
                  </button>
                  <div className="text-xs font-semibold text-theme-muted-text uppercase tracking-wide">Phase</div>
                  <div className="text-xs font-semibold text-theme-muted-text uppercase tracking-wide">Markers</div>
                  <div />
                </div>

                <div className="divide-y divide-theme-border-inner">
                  {filtered.map((report) => {
                    const markerCount = analyteCounts[report.id] ?? biomarkerCounts[report.id] ?? 0;
                    return (
                      <div
                        key={report.id}
                        className="group grid grid-cols-1 sm:grid-cols-[1fr_140px_120px_120px_80px_48px] gap-3 sm:gap-4 px-5 py-4 hover:bg-theme-background-tint transition-colors items-center"
                      >
                        <Link to={`/app/reports/${report.id}`} className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 bg-theme-surface-2 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-theme-surface-hover transition-colors">
                            <FileText className="w-4 h-4 text-theme-primary" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-sm text-theme-text truncate">
                              {formatDate(report.report_date)}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-theme-muted-text-4">Uploaded {timeAgo(report.upload_date)}</span>
                              {report.lab_source && report.lab_source !== 'unknown' && (
                                <span className="inline-flex items-center gap-0.5 text-[11px] text-theme-muted-text-4">
                                  <FlaskConical className="w-2.5 h-2.5" />
                                  {report.lab_source === 'quest' ? 'Quest' : 'Labcorp'}
                                </span>
                              )}
                            </div>
                          </div>
                        </Link>

                        <Link to={`/app/reports/${report.id}`} className="hidden sm:block">
                          <div className="text-sm text-theme-text-body">
                            {timeAgo(report.upload_date)}
                          </div>
                          <div className="text-xs text-theme-muted-text-4 mt-0.5">
                            {formatDateShort(report.upload_date.slice(0, 10))}
                          </div>
                        </Link>

                        <Link to={`/app/reports/${report.id}`} className="hidden sm:block">
                          <StatusBadge status={report.status} />
                        </Link>

                        <Link to={`/app/reports/${report.id}`} className="hidden sm:block">
                          <PhaseBadge phase={report.estimated_cycle_phase} />
                          {(!report.estimated_cycle_phase || report.estimated_cycle_phase === 'unknown') && (
                            <span className="text-xs text-theme-muted-text-4">—</span>
                          )}
                        </Link>

                        <Link to={`/app/reports/${report.id}`} className="hidden sm:flex items-center gap-1">
                          <span className="text-sm font-medium text-theme-text-body">
                            {markerCount > 0 ? markerCount : '—'}
                          </span>
                          {markerCount > 0 && (
                            <span className="text-xs text-theme-muted-text-4">items</span>
                          )}
                        </Link>

                        <div className="flex items-center justify-between sm:justify-end gap-2">
                          <div className="flex sm:hidden items-center gap-2 flex-wrap">
                            <StatusBadge status={report.status} />
                            <PhaseBadge phase={report.estimated_cycle_phase} />
                          </div>
                          <div className="flex items-center gap-1">
                            <Link
                              to={`/app/reports/${report.id}`}
                              aria-label="View report"
                              className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-theme-surface-hover text-theme-muted-text-4 hover:text-theme-primary transition-colors"
                            >
                              <ArrowRight className="w-4 h-4" />
                            </Link>
                            <button
                              onClick={(e) => { e.stopPropagation(); setDeleteTarget(report); }}
                              aria-label="Delete report"
                              className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-theme-flag-low-bg text-theme-muted-text-4 hover:text-theme-danger transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="px-5 py-3 border-t border-theme-border-inner bg-theme-background-tint">
                  <p className="text-xs text-theme-muted-text-4">
                    Showing {filtered.length} of {reports.length} report{reports.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
