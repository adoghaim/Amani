import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { Loading } from '../components/Loading';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { LabReport } from '../types';

type SortKey = 'report_date' | 'created_at' | 'status';
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
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
        <CheckCircle className="w-3 h-3" /> Ready
      </span>
    );
  }
  if (status === 'processing') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-100">
        <Clock className="w-3 h-3 animate-pulse" /> Processing
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-100">
        <XCircle className="w-3 h-3" /> Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-50 text-gray-600 border border-gray-200">
      <Clock className="w-3 h-3" /> {status}
    </span>
  );
}

function PhaseBadge({ phase }: { phase?: string | null }) {
  if (!phase || phase === 'unknown') return null;
  const colors: Record<string, string> = {
    menstrual: 'bg-rose-50 text-rose-700 border-rose-100',
    follicular: 'bg-sky-50 text-sky-700 border-sky-100',
    ovulatory: 'bg-teal-50 text-teal-700 border-teal-100',
    luteal: 'bg-violet-50 text-violet-700 border-violet-100',
  };
  const cls = colors[phase] ?? 'bg-gray-50 text-gray-600 border-gray-200';
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
}

function DeleteModal({ report, onConfirm, onCancel, deleting }: DeleteModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-5 border-b border-[#E9D6DA]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#2A1F23]">Delete report?</h2>
              <p className="text-sm text-[#6B5B60] mt-0.5">This cannot be undone.</p>
            </div>
          </div>
        </div>
        <div className="px-6 py-4">
          <p className="text-sm text-[#4A3A3E]">
            You are about to permanently delete the report from{' '}
            <span className="font-semibold text-[#2A1F23]">{formatDate(report.report_date)}</span>
            , including all biomarkers and AI insights. This action cannot be reversed.
          </p>
        </div>
        <div className="px-6 py-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="px-4 py-2 text-sm font-medium text-[#4A3A3E] bg-white border border-[#E9D6DA] rounded-xl hover:bg-[#F6ECEB] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors disabled:opacity-60 flex items-center gap-2"
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
  const [reports, setReports] = useState<LabReport[]>([]);
  const [biomarkerCounts, setBiomarkerCounts] = useState<Record<string, number>>({});
  const [analyteCounts, setAnalyteCounts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('report_date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [deleteTarget, setDeleteTarget] = useState<LabReport | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (user) fetchData();
  }, [user]);

  const fetchData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const reportsRes = await supabase
        .from('lab_reports')
        .select('*')
        .eq('user_id', user.id)
        .order('report_date', { ascending: false });

      const fetchedReports = reportsRes.data ?? [];
      setReports(fetchedReports as LabReport[]);

      const reportIds = fetchedReports.map(r => r.id);

      const [biomarkersRes, analytesRes] = reportIds.length > 0
        ? await Promise.all([
            supabase.from('biomarkers').select('lab_report_id').in('lab_report_id', reportIds),
            supabase.from('report_analytes').select('lab_report_id').in('lab_report_id', reportIds),
          ])
        : [{ data: [] }, { data: [] }];

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
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from('lab_reports').delete().eq('id', deleteTarget.id);
    setDeleting(false);
    if (!error) {
      setReports(prev => prev.filter(r => r.id !== deleteTarget.id));
      setDeleteTarget(null);
    }
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
          onCancel={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}

      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[#2A1F23]">Lab Reports</h1>
            <p className="text-sm text-[#6B5B60] mt-1">
              {reports.length === 0
                ? 'No reports yet'
                : `${reports.length} report${reports.length !== 1 ? 's' : ''} total`}
            </p>
          </div>
          <a
            href="/app/new"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#C97C8B] text-white text-sm font-semibold rounded-xl hover:bg-[#A85C6D] transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            New report
          </a>
        </div>

        {reports.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#E9D6DA] shadow-sm px-6 py-20 text-center">
            <div className="w-16 h-16 bg-[#F6ECEB] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <TestTube2 className="w-8 h-8 text-[#C97C8B]" />
            </div>
            <h3 className="text-lg font-semibold text-[#2A1F23] mb-2">No lab reports yet</h3>
            <p className="text-sm text-[#6B5B60] mb-6 max-w-xs mx-auto">
              Upload your first lab report to start tracking your biomarkers and getting AI insights.
            </p>
            <a
              href="/app/new"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#C97C8B] text-white text-sm font-semibold rounded-xl hover:bg-[#A85C6D] transition-colors"
            >
              <Plus className="w-4 h-4" />
              Upload first report
            </a>
          </div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row gap-3 mb-5">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A8969C]" />
                <input
                  type="text"
                  placeholder="Search by date or cycle phase..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 text-sm border border-[#E9D6DA] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#C97C8B]/30 focus:border-[#C97C8B] text-[#2A1F23] placeholder:text-[#A8969C]"
                />
              </div>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="px-3 py-2.5 text-sm border border-[#E9D6DA] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#C97C8B]/30 focus:border-[#C97C8B] text-[#4A3A3E] min-w-[140px]"
              >
                <option value="all">All statuses</option>
                <option value="ready">Ready</option>
                <option value="processing">Processing</option>
                <option value="error">Error</option>
              </select>
            </div>

            {filtered.length === 0 ? (
              <div className="bg-white rounded-2xl border border-[#E9D6DA] shadow-sm px-6 py-16 text-center">
                <Search className="w-8 h-8 text-[#D4A8B0] mx-auto mb-3" />
                <p className="text-sm font-medium text-[#4A3A3E]">No reports match your filters</p>
                <button
                  onClick={() => { setSearch(''); setStatusFilter('all'); }}
                  className="mt-3 text-sm text-[#C97C8B] hover:underline"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-[#E9D6DA] shadow-sm overflow-hidden">
                <div className="hidden sm:grid grid-cols-[1fr_120px_120px_80px_48px] gap-4 px-5 py-3 border-b border-[#F0E4E7] bg-[#FAF4F5]">
                  <button
                    onClick={() => cycleSort('report_date')}
                    className="text-left text-xs font-semibold text-[#6B5B60] uppercase tracking-wide hover:text-[#C97C8B] transition-colors"
                  >
                    Report date <SortIcon col="report_date" />
                  </button>
                  <button
                    onClick={() => cycleSort('status')}
                    className="text-left text-xs font-semibold text-[#6B5B60] uppercase tracking-wide hover:text-[#C97C8B] transition-colors"
                  >
                    Status <SortIcon col="status" />
                  </button>
                  <div className="text-xs font-semibold text-[#6B5B60] uppercase tracking-wide">Phase</div>
                  <div className="text-xs font-semibold text-[#6B5B60] uppercase tracking-wide">Markers</div>
                  <div />
                </div>

                <div className="divide-y divide-[#F0E4E7]">
                  {filtered.map((report) => {
                    const markerCount = analyteCounts[report.id] ?? biomarkerCounts[report.id] ?? 0;
                    return (
                      <div
                        key={report.id}
                        className="group grid grid-cols-1 sm:grid-cols-[1fr_120px_120px_80px_48px] gap-3 sm:gap-4 px-5 py-4 hover:bg-[#FAF4F5] transition-colors items-center"
                      >
                        <a href={`/app/reports/${report.id}`} className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 bg-[#F6ECEB] rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-[#EDD8DC] transition-colors">
                            <FileText className="w-4 h-4 text-[#C97C8B]" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-sm text-[#2A1F23] truncate">
                              {formatDate(report.report_date)}
                            </div>
                            <div className="text-xs text-[#A8969C] mt-0.5">
                              Uploaded {timeAgo(report.created_at ?? report.report_date)}
                            </div>
                          </div>
                        </a>

                        <a href={`/app/reports/${report.id}`} className="hidden sm:block">
                          <StatusBadge status={report.status} />
                        </a>

                        <a href={`/app/reports/${report.id}`} className="hidden sm:block">
                          <PhaseBadge phase={report.estimated_cycle_phase} />
                          {(!report.estimated_cycle_phase || report.estimated_cycle_phase === 'unknown') && (
                            <span className="text-xs text-[#A8969C]">—</span>
                          )}
                        </a>

                        <a href={`/app/reports/${report.id}`} className="hidden sm:flex items-center gap-1">
                          <span className="text-sm font-medium text-[#4A3A3E]">
                            {markerCount > 0 ? markerCount : '—'}
                          </span>
                          {markerCount > 0 && (
                            <span className="text-xs text-[#A8969C]">items</span>
                          )}
                        </a>

                        <div className="flex items-center justify-between sm:justify-end gap-2">
                          <div className="flex sm:hidden items-center gap-2 flex-wrap">
                            <StatusBadge status={report.status} />
                            <PhaseBadge phase={report.estimated_cycle_phase} />
                          </div>
                          <div className="flex items-center gap-1">
                            <a
                              href={`/app/reports/${report.id}`}
                              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#EDD8DC] text-[#A8969C] hover:text-[#C97C8B] transition-colors"
                              title="View report"
                            >
                              <ArrowRight className="w-4 h-4" />
                            </a>
                            <button
                              onClick={(e) => { e.stopPropagation(); setDeleteTarget(report); }}
                              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-[#A8969C] hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                              title="Delete report"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="px-5 py-3 border-t border-[#F0E4E7] bg-[#FAF4F5]">
                  <p className="text-xs text-[#A8969C]">
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
