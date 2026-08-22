import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import { useAuth } from '../contexts/AuthContext';
import type { AnalyteBlockDebug } from '../utils/biomarkerParser';
import {
  ChevronDown, ChevronRight, Copy, Check, AlertTriangle, AlertCircle,
  CheckCircle, Search, X, ArrowLeft, RefreshCw, ExternalLink, Bug,
  FileText, Layers, FlaskConical, Link2, Database, Cpu, Filter
} from 'lucide-react';

interface ReportAnalyteRow {
  id: string;
  raw_name: string;
  raw_value_text: string | null;
  value_numeric: number | null;
  unit: string | null;
  raw_reference_range: string | null;
  normalized_min: number | null;
  normalized_max: number | null;
  normalized_operator: string | null;
  normalized_operator_value: number | null;
  source_snippet: string | null;
  confidence_score: string;
  canonical_slug: string | null;
  parse_status: string;
  needs_review: boolean;
  is_core: boolean;
}

interface DebugRecord {
  id: string;
  report_id: string;
  raw_text: string | null;
  page_count: number;
  file_name: string | null;
  analyte_blocks_json: AnalyteBlockDebug[];
  parsed_candidates_json: unknown[];
  mapping_debug_json: unknown[];
  ai_input_json: unknown[];
  created_at: string;
}

interface LabReport {
  id: string;
  report_date: string;
  status: string;
  lab_name: string | null;
  file_url: string | null;
}

type FilterStatus = 'all' | 'mapped' | 'unmapped' | 'parse_error' | 'core' | 'extended' | 'miss' | 'reject';
type ActiveStage = 1 | 2 | 3 | 4 | 5 | 6;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-theme-neutral-100 hover:bg-theme-neutral-200 text-theme-neutral-600 transition-colors"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
    >
      {copied ? <Check className="w-3 h-3 text-theme-flag-ok" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function ConfidencePill({ conf, className = '' }: { conf: string; className?: string }) {
  const cfg: Record<string, string> = {
    high:   'bg-theme-flag-ok-bg text-theme-flag-ok border-theme-flag-ok-border',
    medium: 'bg-theme-flag-watch-bg text-theme-flag-watch border-theme-flag-watch-border',
    low:    'bg-theme-flag-low-bg text-theme-flag-low border-theme-flag-low-border',
    miss:   'bg-theme-neutral-100 text-theme-neutral-600 border-theme-neutral-300',
    reject: 'bg-theme-flag-low-bg text-theme-flag-low border-theme-flag-low-border',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cfg[conf] ?? cfg.low} ${className}`}>
      {conf}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    mapped:   'bg-theme-flag-ok-bg text-theme-flag-ok',
    partial:  'bg-theme-flag-watch-bg text-theme-flag-watch',
    unmapped: 'bg-theme-flag-low-bg text-theme-flag-low',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg[status] ?? 'bg-theme-neutral-100 text-theme-neutral-700'}`}>
      {status}
    </span>
  );
}

function SectionHeader({ icon: Icon, title, count, subtitle }: {
  icon: typeof Bug; title: string; count?: number; subtitle?: string
}) {
  return (
    <div className="flex items-start gap-3 mb-6">
      <div className="w-9 h-9 rounded-lg bg-theme-neutral-800 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon className="w-4.5 h-4.5 text-theme-neutral-200" style={{ width: 18, height: 18 }} />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-theme-neutral-900 flex items-center gap-2">
          {title}
          {count !== undefined && (
            <span className="text-sm font-mono bg-theme-neutral-100 text-theme-neutral-600 px-2 py-0.5 rounded">{count}</span>
          )}
        </h2>
        {subtitle && <p className="text-sm text-theme-neutral-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function CollapsibleBlock({ label, children, defaultOpen = false }: {
  label: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-theme-neutral-200 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-2.5 bg-theme-neutral-50 hover:bg-theme-neutral-100 text-left transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-sm font-medium text-theme-neutral-700">{label}</span>
        {open ? <ChevronDown className="w-4 h-4 text-theme-neutral-400" /> : <ChevronRight className="w-4 h-4 text-theme-neutral-400" />}
      </button>
      {open && <div className="p-4 bg-white">{children}</div>}
    </div>
  );
}

function MonoField({ label, value, highlight = false }: {
  label: string; value: string | number | null | undefined; highlight?: boolean
}) {
  if (value === null || value === undefined) {
    return (
      <div>
        <p className="text-xs text-theme-neutral-500 mb-0.5">{label}</p>
        <p className="text-xs font-mono text-theme-neutral-400 italic">null</p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-xs text-theme-neutral-500 mb-0.5">{label}</p>
      <p className={`text-xs font-mono ${highlight ? 'text-theme-flag-watch bg-theme-flag-watch-bg rounded px-1' : 'text-theme-neutral-800'}`}>
        {String(value)}
      </p>
    </div>
  );
}

/**
 * Mirror of `pipeline.ts` ExcludedReason derivation, for rows loaded from the DB
 * (which doesn't currently persist the field). Kept narrow to the failure modes
 * the pipeline actually produces:
 *   - included as core              → null
 *   - slug present, not in CORE     → 'non_core'
 *   - no slug at all                → 'no_canonical_match'
 *   - parse_status flagged an error → 'value_extraction_failed'
 * Anything else falls through to 'unknown'.
 */
function deriveExcludedReason(a: ReportAnalyteRow): string | null {
  if (a.is_core) return null;
  if (a.parse_status === 'parse_error') return 'value_extraction_failed';
  if (a.canonical_slug === null) return 'no_canonical_match';
  return 'non_core';
}

function isSuspicious(block: AnalyteBlockDebug): boolean {
  if (block.parseError) return true;
  if (block.confidence === 'miss' || block.confidence === 'reject') return true;
  if (!block.parsedUnit) return true;
  if (block.parsedValue !== null) {
    if (block.canonical === 'hdl_cholesterol' && block.parsedValue < 5) return true;
    if (block.canonical === 'triglycerides' && block.parsedValue < 5) return true;
    if (block.canonical === 'fasting_glucose' && block.parsedValue < 30) return true;
    if (block.canonical === 'egfr' && block.parsedValue < 15) return true;
    if (block.canonical === 'ldl_cholesterol' && block.parsedValue < 10) return true;
    if (block.canonical === 'total_cholesterol' && block.parsedValue < 50) return true;
  }
  return false;
}

function EditAnalyteModal({
  row,
  onSave,
  onClose,
}: {
  row: ReportAnalyteRow;
  onSave: (updated: Partial<ReportAnalyteRow>) => Promise<void>;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [vals, setVals] = useState({
    raw_name: row.raw_name,
    value_numeric: String(row.value_numeric ?? ''),
    unit: row.unit ?? '',
    raw_reference_range: row.raw_reference_range ?? '',
    canonical_slug: row.canonical_slug ?? '',
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-theme-neutral-200">
          <h3 className="font-semibold text-theme-neutral-900">Edit Analyte Row</h3>
          <button onClick={onClose} className="text-theme-neutral-400 hover:text-theme-neutral-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          {[
            { key: 'raw_name', label: 'Raw name' },
            { key: 'value_numeric', label: 'Value (numeric)' },
            { key: 'unit', label: 'Unit' },
            { key: 'raw_reference_range', label: 'Reference range (raw)' },
            { key: 'canonical_slug', label: 'Canonical slug' },
          ].map(({ key, label }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-theme-neutral-600 mb-1">{label}</label>
              <input
                className="w-full px-3 py-2 text-sm border border-theme-neutral-300 rounded-lg focus:ring-2 focus:ring-theme-neutral-500 focus:border-theme-neutral-500"
                value={vals[key as keyof typeof vals]}
                onChange={e => setVals(v => ({ ...v, [key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-theme-neutral-200">
          <button onClick={onClose} className="px-4 py-2 text-sm text-theme-neutral-600 hover:text-theme-neutral-800">Cancel</button>
          <button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await onSave({
                raw_name: vals.raw_name,
                value_numeric: vals.value_numeric ? parseFloat(vals.value_numeric) : null,
                unit: vals.unit || null,
                raw_reference_range: vals.raw_reference_range || null,
                canonical_slug: vals.canonical_slug || null,
              });
              setSaving(false);
              onClose();
            }}
            className="px-4 py-2 text-sm bg-theme-neutral-800 text-white rounded-lg hover:bg-theme-neutral-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ParserDebugger() {
  const { id: reportId } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [report, setReport] = useState<LabReport | null>(null);
  const [debugRecord, setDebugRecord] = useState<DebugRecord | null>(null);
  const [analytes, setAnalytes] = useState<ReportAnalyteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeStage, setActiveStage] = useState<ActiveStage>(1);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [search, setSearch] = useState('');
  const [rawTextExpanded, setRawTextExpanded] = useState(false);
  const [editRow, setEditRow] = useState<ReportAnalyteRow | null>(null);
  const [regenLoading, setRegenLoading] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [showOnlyExcluded, setShowOnlyExcluded] = useState(false);
  const [excludedCopyMsg, setExcludedCopyMsg] = useState('');

  useEffect(() => {
    if (!reportId || !user) return;
    setLoading(true);

    Promise.all([
      supabase.from('lab_reports').select('id,report_date,status,lab_name,file_url').eq('id', reportId).maybeSingle(),
      supabase.from('parser_debug').select('*').eq('report_id', reportId).maybeSingle(),
      supabase.from('report_analytes').select('*').eq('lab_report_id', reportId).order('raw_name'),
    ]).then(([{ data: rpt }, { data: dbg }, { data: anas }]) => {
      setReport(rpt as LabReport | null);
      setDebugRecord(dbg as DebugRecord | null);
      setAnalytes((anas ?? []) as ReportAnalyteRow[]);
    }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [reportId, user]);

  const blocks: AnalyteBlockDebug[] = useMemo(
    () => (debugRecord?.analyte_blocks_json as AnalyteBlockDebug[] ?? []),
    [debugRecord]
  );

  const filteredBlocks = useMemo(() => {
    return blocks.filter(b => {
      const q = search.toLowerCase();
      const nameMatch = !q || b.canonical.includes(q) || b.rawLabel.toLowerCase().includes(q);
      if (!nameMatch) return false;
      if (filterStatus === 'all') return true;
      if (filterStatus === 'parse_error') return !!b.parseError;
      if (filterStatus === 'miss') return b.confidence === 'miss';
      if (filterStatus === 'reject') return b.confidence === 'reject';
      return true;
    });
  }, [blocks, search, filterStatus]);

  const filteredAnalytes = useMemo(() => {
    return analytes.filter(a => {
      const q = search.toLowerCase();
      const nameMatch = !q || a.raw_name.toLowerCase().includes(q) || (a.canonical_slug ?? '').includes(q);
      if (!nameMatch) return false;
      if (filterStatus === 'all') return true;
      if (filterStatus === 'mapped') return a.parse_status === 'mapped';
      if (filterStatus === 'unmapped') return a.parse_status === 'unmapped';
      if (filterStatus === 'core') return a.is_core;
      if (filterStatus === 'extended') return !a.is_core;
      if (filterStatus === 'parse_error') return a.needs_review;
      return true;
    });
  }, [analytes, search, filterStatus]);

  const stats = useMemo(() => ({
    totalBlocks: blocks.length,
    matched: blocks.filter(b => b.confidence !== 'miss' && b.confidence !== 'reject').length,
    misses: blocks.filter(b => b.confidence === 'miss').length,
    rejects: blocks.filter(b => b.confidence === 'reject').length,
    parseErrors: blocks.filter(b => !!b.parseError).length,
    suspicious: blocks.filter(b => isSuspicious(b)).length,
    totalAnalytes: analytes.length,
    mapped: analytes.filter(a => a.parse_status === 'mapped').length,
    partial: analytes.filter(a => a.parse_status === 'partial').length,
    unmapped: analytes.filter(a => a.parse_status === 'unmapped').length,
    core: analytes.filter(a => a.is_core).length,
    needsReview: analytes.filter(a => a.needs_review).length,
  }), [blocks, analytes]);

  const aiInputItems = useMemo(() => {
    const KEY_SLUGS = new Set([
      'estradiol','progesterone','lh','fsh','tsh','free_t4','free_t3','fasting_glucose',
      'hemoglobin_a1c','total_cholesterol','ldl_cholesterol','hdl_cholesterol','triglycerides',
      'creatinine','egfr','alt','ast','ferritin','vitamin_d_25_oh','vitamin_b12','hs_crp',
    ]);
    const classify = (a: ReportAnalyteRow) => {
      const v = a.value_numeric ?? 0;
      const min = a.normalized_min, max = a.normalized_max;
      if (min !== null && max !== null) {
        const range = max - min, buf = range * 0.08;
        if (v < min - buf || v > max + buf) return 'out_of_range';
        if (v < min || v > max) return 'borderline';
        return 'in_range';
      }
      if (a.normalized_operator && a.normalized_operator_value !== null) {
        const op = a.normalized_operator, val = a.normalized_operator_value;
        if (op.startsWith('<')) return v <= val ? 'in_range' : 'out_of_range';
        if (op.startsWith('>')) return v >= val ? 'in_range' : 'out_of_range';
      }
      return 'unknown';
    };
    const outOfRange = analytes.filter(a => classify(a) === 'out_of_range');
    const borderline = analytes.filter(a => classify(a) === 'borderline');
    const keyItems = analytes.filter(a => a.canonical_slug && KEY_SLUGS.has(a.canonical_slug) && classify(a) === 'in_range');
    const others = analytes.filter(a => !outOfRange.includes(a) && !borderline.includes(a) && !keyItems.includes(a));
    return {
      included: [...outOfRange, ...borderline, ...keyItems, ...others].slice(0, 20),
      excluded: [...outOfRange, ...borderline, ...keyItems, ...others].slice(20),
      classifyFn: classify,
    };
  }, [analytes]);

  const handleSaveAnalyte = async (rowId: string, updated: Partial<ReportAnalyteRow>) => {
    const { error: saveErr } = await supabase
      .from('report_analytes')
      .update(updated)
      .eq('id', rowId);
    if (saveErr) { alert('Save failed: ' + saveErr.message); return; }
    setAnalytes(prev => prev.map(a => a.id === rowId ? { ...a, ...updated } : a));
    setSavedMsg('Saved');
    setTimeout(() => setSavedMsg(''), 2000);
  };

  const handleRegenerate = async () => {
    if (!reportId || !user) return;
    setRegenLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      await supabase.from('lab_reports').update({ status: 'processing' }).eq('id', reportId);
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-interpretation`;
      await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId }),
      });
      const { data: rpt } = await supabase.from('lab_reports').select('status').eq('id', reportId).maybeSingle();
      setReport(prev => prev ? { ...prev, status: rpt?.status ?? 'processing' } : prev);
      setSavedMsg('Report regenerated');
      setTimeout(() => setSavedMsg(''), 3000);
    } catch (e: unknown) {
      alert('Regen failed: ' + errorMessage(e));
    } finally {
      setRegenLoading(false);
    }
  };

  const STAGES: { id: ActiveStage; icon: typeof Bug; label: string; shortLabel: string }[] = [
    { id: 1, icon: FileText,    label: 'Raw Document Input',        shortLabel: 'Raw Text' },
    { id: 2, icon: Layers,      label: 'Detected Analyte Blocks',   shortLabel: 'Blocks' },
    { id: 3, icon: FlaskConical,label: 'Parsed Value / Unit / Range',shortLabel: 'Values' },
    { id: 4, icon: Link2,       label: 'Canonical Mapping',          shortLabel: 'Mapping' },
    { id: 5, icon: Database,    label: 'Stored report_analytes',     shortLabel: 'Stored' },
    { id: 6, icon: Cpu,         label: 'AI Report Input Preview',    shortLabel: 'AI Input' },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-theme-neutral-50 flex items-center justify-center">
        <div className="animate-spin w-6 h-6 border-2 border-theme-neutral-800 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-theme-neutral-50 flex items-center justify-center p-8">
        <div className="bg-theme-flag-low-bg border border-theme-flag-low-border rounded-xl p-6 max-w-md text-center">
          <AlertCircle className="w-8 h-8 text-theme-flag-low mx-auto mb-3" />
          <p className="text-theme-flag-low font-medium">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-theme-neutral-50 font-mono text-sm">
      {/* Top bar */}
      <div className="bg-theme-neutral-900 text-theme-neutral-100 px-6 py-3 flex items-center justify-between sticky top-0 z-40 shadow-lg">
        <div className="flex items-center gap-4">
          <Link to={`/app/reports/${reportId}`} className="flex items-center gap-1.5 text-theme-neutral-400 hover:text-theme-neutral-200 transition-colors text-xs">
            <ArrowLeft className="w-3.5 h-3.5" />Back to report
          </Link>
          <div className="w-px h-4 bg-theme-neutral-700" />
          <div className="flex items-center gap-2">
            <Bug className="w-4 h-4 text-theme-flag-watch" />
            <span className="text-xs font-bold text-theme-neutral-200 tracking-wide uppercase">Parser Debug</span>
            {report && <span className="text-xs text-theme-neutral-400 font-sans">— {report.report_date}</span>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {savedMsg && <span className="text-xs text-theme-flag-ok">{savedMsg}</span>}
          {report && (
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              report.status === 'ready' ? 'bg-theme-flag-ok text-theme-flag-ok' :
              report.status === 'error' ? 'bg-theme-flag-low text-theme-flag-low' : 'bg-theme-flag-watch text-theme-flag-watch'
            }`}>{report.status}</span>
          )}
          <button
            onClick={handleRegenerate}
            disabled={regenLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-theme-neutral-700 hover:bg-theme-neutral-600 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${regenLoading ? 'animate-spin' : ''}`} />
            Regen interpretation
          </button>
          {report?.id && (
            <Link
              to={`/app/reports/${reportId}`}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-theme-flag-watch hover:bg-theme-flag-watch rounded-lg transition-colors"
            >
              <ExternalLink className="w-3 h-3" />View report
            </Link>
          )}
        </div>
      </div>

      {/* Stats banner */}
      <div className="bg-theme-neutral-800 px-6 py-3 flex items-center gap-6 text-xs border-b border-theme-neutral-700">
        <div className="text-theme-neutral-300">File: <span className="text-white">{debugRecord?.file_name ?? 'Unknown'}</span></div>
        <div className="text-theme-neutral-300">Pages: <span className="text-white">{debugRecord?.page_count ?? '?'}</span></div>
        <div className="text-theme-neutral-300">Lines: <span className="text-white">{debugRecord ? (debugRecord.raw_text ?? '').split('\n').length : '?'}</span></div>
        <div className="w-px h-4 bg-theme-neutral-600" />
        <div className="text-theme-neutral-300">Blocks: <span className="text-white">{stats.totalBlocks}</span></div>
        <div className="text-theme-flag-ok">Matched: {stats.matched}</div>
        {stats.misses > 0 && <div className="text-theme-flag-watch">Misses: {stats.misses}</div>}
        {stats.rejects > 0 && <div className="text-theme-flag-low">Rejects: {stats.rejects}</div>}
        {stats.parseErrors > 0 && <div className="text-theme-flag-low">Parse errors: {stats.parseErrors}</div>}
        {stats.suspicious > 0 && <div className="text-theme-flag-watch">Suspicious: {stats.suspicious}</div>}
        <div className="w-px h-4 bg-theme-neutral-600" />
        <div className="text-theme-neutral-300">Stored: <span className="text-white">{stats.totalAnalytes}</span></div>
        <div className="text-theme-flag-ok">Mapped: {stats.mapped}</div>
        {stats.unmapped > 0 && <div className="text-theme-flag-low">Unmapped: {stats.unmapped}</div>}
        {stats.needsReview > 0 && <div className="text-theme-flag-watch">Review: {stats.needsReview}</div>}
      </div>

      <div className="flex h-[calc(100vh-105px)]">
        {/* Left sidebar — stage navigation */}
        <div className="w-52 flex-shrink-0 bg-theme-neutral-900 flex flex-col overflow-y-auto">
          {STAGES.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveStage(s.id)}
              className={`flex items-start gap-2.5 px-4 py-3.5 text-left transition-colors border-b border-theme-neutral-800 ${
                activeStage === s.id
                  ? 'bg-theme-neutral-700 text-white border-l-2 border-l-amber-400'
                  : 'text-theme-neutral-400 hover:bg-theme-neutral-800 hover:text-theme-neutral-200'
              }`}
            >
              <div className="flex-shrink-0 mt-0.5">
                <s.icon style={{ width: 14, height: 14 }} />
              </div>
              <div>
                <p className="text-xs font-medium leading-tight">{s.id}. {s.shortLabel}</p>
                <p className="text-[10px] text-theme-neutral-500 mt-0.5 leading-snug font-sans">{s.label}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Main content area */}
        <div className="flex-1 overflow-y-auto">
          {/* Search + filter toolbar */}
          {(activeStage === 2 || activeStage === 3 || activeStage === 4 || activeStage === 5) && (
            <div className="bg-white border-b border-theme-neutral-200 px-6 py-3 flex items-center gap-3 sticky top-0 z-10">
              <div className="relative flex-1 max-w-xs">
                <Search className="w-3.5 h-3.5 text-theme-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search analyte name..."
                  className="w-full pl-8 pr-8 py-1.5 text-xs border border-theme-neutral-200 rounded-lg focus:ring-2 focus:ring-theme-neutral-500 focus:border-theme-neutral-500 font-sans"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-theme-neutral-400 hover:text-theme-neutral-600">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Filter className="w-3.5 h-3.5 text-theme-neutral-400" />
                {(['all','mapped','unmapped','parse_error','core','extended','miss','reject'] as FilterStatus[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilterStatus(f)}
                    className={`px-2 py-1 text-xs rounded transition-colors font-sans ${
                      filterStatus === f ? 'bg-theme-neutral-800 text-white' : 'bg-theme-neutral-100 text-theme-neutral-600 hover:bg-theme-neutral-200'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="p-6 font-sans">
            {/* ─── STAGE 0: Raw extracted text (always visible, collapsible) ─── */}
            <details className="mb-6 bg-white border border-theme-neutral-200 rounded-lg overflow-hidden group">
              <summary className="flex items-center justify-between px-4 py-2.5 bg-theme-neutral-50 hover:bg-theme-neutral-100 cursor-pointer select-none transition-colors list-none">
                <span className="flex items-center gap-2 text-sm font-medium text-theme-neutral-700">
                  <ChevronRight className="w-4 h-4 text-theme-neutral-400 group-open:hidden" />
                  <ChevronDown className="w-4 h-4 text-theme-neutral-400 hidden group-open:block" />
                  Stage 0 — Raw extracted text
                  <span className="text-xs font-mono bg-theme-neutral-100 text-theme-neutral-500 px-1.5 py-0.5 rounded">
                    {(debugRecord?.raw_text ?? '').length.toLocaleString()} chars
                  </span>
                </span>
                <span className="text-xs text-theme-neutral-400 font-sans">
                  Cmd-F to grep silently-filtered lines
                </span>
              </summary>
              <pre className="p-4 text-xs font-mono text-theme-neutral-700 whitespace-pre-wrap break-words leading-relaxed overflow-auto max-h-[480px] select-text">
                {debugRecord?.raw_text ?? '(no raw text — re-upload to capture)'}
              </pre>
            </details>

            {/* ─── STAGE 1: Raw Document Input ─── */}
            {activeStage === 1 && (
              <div>
                <SectionHeader
                  icon={FileText}
                  title="Stage 1 — Raw Document Input"
                  subtitle="Extracted text from the uploaded PDF, before any parsing"
                />
                {!debugRecord ? (
                  <div className="bg-theme-flag-watch-bg border border-theme-flag-watch-border rounded-lg p-4 text-theme-flag-watch text-sm">
                    No debug record found for this report. Debug data is saved on new uploads. Re-upload to capture it.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: 'File name', value: debugRecord.file_name ?? 'Unknown' },
                        { label: 'Pages (estimated)', value: String(debugRecord.page_count) },
                        { label: 'Text length', value: `${(debugRecord.raw_text ?? '').length.toLocaleString()} chars` },
                        { label: 'Lines', value: `${(debugRecord.raw_text ?? '').split('\n').length.toLocaleString()}` },
                      ].map(item => (
                        <div key={item.label} className="bg-theme-neutral-50 border border-theme-neutral-200 rounded-lg p-3">
                          <p className="text-xs text-theme-neutral-500">{item.label}</p>
                          <p className="text-sm font-mono text-theme-neutral-800 font-medium mt-0.5">{item.value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="bg-white border border-theme-neutral-200 rounded-lg overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2.5 border-b border-theme-neutral-100 bg-theme-neutral-50">
                        <span className="text-sm font-medium text-theme-neutral-700">Raw extracted text</span>
                        <div className="flex items-center gap-2">
                          <CopyButton text={debugRecord.raw_text ?? ''} />
                          <button
                            onClick={() => setRawTextExpanded(e => !e)}
                            className="text-xs text-theme-neutral-500 hover:text-theme-neutral-700"
                          >
                            {rawTextExpanded ? 'Collapse' : 'Expand full text'}
                          </button>
                        </div>
                      </div>
                      <pre className={`p-4 text-xs font-mono text-theme-neutral-700 whitespace-pre-wrap break-all leading-relaxed overflow-y-auto ${rawTextExpanded ? '' : 'max-h-96'}`}>
                        {debugRecord.raw_text ?? '(empty)'}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ─── STAGE 2: Detected Analyte Blocks ─── */}
            {activeStage === 2 && (
              <div>
                <SectionHeader
                  icon={Layers}
                  title="Stage 2 — Detected Analyte Blocks"
                  count={filteredBlocks.length}
                  subtitle="Each block detected by the biomarker label matcher"
                />
                {blocks.length === 0 ? (
                  <div className="bg-theme-flag-watch-bg border border-theme-flag-watch-border rounded-lg p-4 text-theme-flag-watch text-sm">
                    No analyte blocks captured. Upload a new report to see parser debug data.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredBlocks.map(b => (
                      <div
                        key={b.blockIndex}
                        className={`border rounded-lg overflow-hidden ${
                          isSuspicious(b) ? 'border-theme-flag-watch-border bg-theme-flag-watch-bg/30' : 'border-theme-neutral-200 bg-white'
                        }`}
                      >
                        <div className="flex items-start justify-between px-4 py-2.5">
                          <div className="flex items-start gap-3 min-w-0">
                            <span className="text-xs font-mono text-theme-neutral-400 flex-shrink-0 mt-0.5">#{b.blockIndex}</span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-theme-neutral-800 font-medium text-xs truncate">{b.rawLabel}</span>
                                <span className="text-theme-neutral-400 text-xs">→</span>
                                <span className="font-mono text-theme-neutral-500 text-xs">{b.canonical}</span>
                                <ConfidencePill conf={b.confidence} />
                                {isSuspicious(b) && <span className="text-xs text-theme-flag-watch font-medium">suspicious</span>}
                              </div>
                              {b.matchedPattern && (
                                <p className="text-xs text-theme-neutral-400 mt-0.5">Matched pattern: <code className="bg-theme-neutral-100 px-1 rounded">{b.matchedPattern}</code></p>
                              )}
                            </div>
                          </div>
                          <span className="text-xs text-theme-neutral-400 flex-shrink-0 ml-3">line {b.lineIndex}</span>
                        </div>
                        {b.missReason && (
                          <div className="px-4 pb-2.5 flex items-center gap-2">
                            <AlertCircle className="w-3.5 h-3.5 text-theme-flag-watch flex-shrink-0" />
                            <p className="text-xs text-theme-flag-watch">{b.missReason}</p>
                          </div>
                        )}
                        {b.blockSnippet && (
                          <div className="px-4 pb-3">
                            <p className="text-xs text-theme-neutral-400 mb-1">Block snippet:</p>
                            <pre className="text-xs font-mono bg-theme-neutral-50 border border-theme-neutral-100 rounded p-2 whitespace-pre-wrap break-all text-theme-neutral-600 leading-relaxed">
                              {b.blockSnippet}
                            </pre>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ─── STAGE 3: Parsed Value / Unit / Range ─── */}
            {activeStage === 3 && (
              <div>
                <SectionHeader
                  icon={FlaskConical}
                  title="Stage 3 — Parsed Value / Unit / Range"
                  count={filteredBlocks.length}
                  subtitle="Per-analyte extraction details: value, unit, reference range"
                />
                {blocks.length === 0 ? (
                  <div className="bg-theme-flag-watch-bg border border-theme-flag-watch-border rounded-lg p-4 text-theme-flag-watch text-sm">
                    No parser blocks found. Upload a new report to capture debug data.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredBlocks.map(b => (
                      <CollapsibleBlock
                        key={b.blockIndex}
                        label={`#${b.blockIndex} ${b.canonical} (${b.rawLabel})`}
                        defaultOpen={isSuspicious(b)}
                      >
                        <div className="space-y-4">
                          {b.parseError && (
                            <div className="flex items-start gap-2 bg-theme-flag-low-bg border border-theme-flag-low-border rounded-md p-3">
                              <AlertCircle className="w-4 h-4 text-theme-flag-low flex-shrink-0 mt-0.5" />
                              <p className="text-xs text-theme-flag-low font-medium">{b.parseError}</p>
                            </div>
                          )}
                          {b.missReason && (
                            <div className="flex items-start gap-2 bg-theme-flag-watch-bg border border-theme-flag-watch-border rounded-md p-3">
                              <AlertTriangle className="w-4 h-4 text-theme-flag-watch flex-shrink-0 mt-0.5" />
                              <p className="text-xs text-theme-flag-watch">{b.missReason}</p>
                            </div>
                          )}
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                            <MonoField label="Parsed value" value={b.parsedValue} highlight={b.parsedValue === null || !!b.parseError} />
                            <MonoField label="Raw value text" value={b.parsedRawValue} />
                            <MonoField label="Unit" value={b.parsedUnit} highlight={!b.parsedUnit} />
                            <MonoField label="Confidence" value={b.confidence} />
                            <MonoField label="Ref range (raw)" value={b.parsedRefRaw} />
                            <MonoField label="Ref min" value={b.parsedRefMin} />
                            <MonoField label="Ref max" value={b.parsedRefMax} />
                            <MonoField label="Ref operator" value={b.parsedRefOperator} />
                            <MonoField label="Ref op value" value={b.parsedRefOperatorValue} />
                          </div>
                          <div>
                            <p className="text-xs text-theme-neutral-500 mb-1">Source block snippet:</p>
                            <pre className="text-xs font-mono bg-theme-neutral-50 border border-theme-neutral-100 rounded p-2 whitespace-pre-wrap break-all text-theme-neutral-600 leading-relaxed">
                              {b.blockSnippet}
                            </pre>
                          </div>
                        </div>
                      </CollapsibleBlock>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ─── STAGE 4: Canonical Mapping ─── */}
            {activeStage === 4 && (
              <div>
                <SectionHeader
                  icon={Link2}
                  title="Stage 4 — Canonical Analyte Mapping"
                  count={filteredAnalytes.length}
                  subtitle="How each raw analyte label was matched to a canonical slug"
                />
                {(() => {
                  const rowsWithReason = filteredAnalytes.map(a => ({ a, reason: deriveExcludedReason(a) }));
                  const visibleRows = showOnlyExcluded
                    ? rowsWithReason.filter(r => r.reason !== null && r.reason !== undefined && r.reason !== '')
                    : rowsWithReason;
                  const allExcludedRows = analytes
                    .map(a => ({ a, reason: deriveExcludedReason(a) }))
                    .filter(r => r.reason !== null && r.reason !== undefined && r.reason !== '');
                  const handleCopyExcluded = () => {
                    const arr = allExcludedRows.map(({ a, reason }) => ({
                      raw_name: a.raw_name ?? null,
                      value_numeric: a.value_numeric ?? null,
                      unit: a.unit ?? null,
                      excluded_reason: reason ?? null,
                    }));
                    navigator.clipboard.writeText(JSON.stringify(arr, null, 2));
                    setExcludedCopyMsg(`Copied ${arr.length} rows ✓`);
                    setTimeout(() => setExcludedCopyMsg(''), 2000);
                  };
                  return (
                    <>
                      <div className="flex items-center gap-3 mb-3 flex-wrap">
                        <button
                          onClick={() => setShowOnlyExcluded(v => !v)}
                          className={`px-3 py-1.5 text-xs rounded-full transition-colors font-sans border ${
                            showOnlyExcluded
                              ? 'bg-theme-flag-watch-bg text-theme-flag-watch border-theme-flag-watch-border'
                              : 'bg-white text-theme-neutral-600 border-theme-neutral-300 hover:bg-theme-neutral-50'
                          }`}
                        >
                          {showOnlyExcluded ? '✓ ' : ''}Show only excluded
                        </button>
                        <button
                          onClick={handleCopyExcluded}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full bg-theme-neutral-100 hover:bg-theme-neutral-200 text-theme-neutral-700 border border-theme-neutral-300 font-sans transition-colors"
                        >
                          <Copy className="w-3 h-3" />
                          Copy excluded rows
                        </button>
                        {excludedCopyMsg && (
                          <span className="text-xs text-theme-flag-ok font-sans">{excludedCopyMsg}</span>
                        )}
                        <span className="text-xs text-theme-neutral-400 font-sans ml-auto">
                          {allExcludedRows.length} excluded / {analytes.length} total
                        </span>
                      </div>
                      <div className="overflow-x-auto rounded-lg border border-theme-neutral-200">
                        <table className="w-full text-xs">
                          <thead className="bg-theme-neutral-50 border-b border-theme-neutral-200">
                            <tr>
                              {['Raw label','Canonical slug','Parse status','Method','Core?','Excluded reason','Needs review'].map(h => (
                                <th key={h} className="text-left px-3 py-2.5 font-medium text-theme-neutral-600 whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-theme-neutral-100">
                            {visibleRows.map(({ a, reason: excludedReason }) => {
                              const isExcluded = excludedReason !== null && excludedReason !== undefined && excludedReason !== '';
                              const rowClass = isExcluded
                                ? 'bg-theme-flag-watch-bg/50 hover:bg-theme-flag-watch-bg'
                                : a.needs_review
                                  ? 'bg-theme-flag-watch-bg/40'
                                  : 'bg-white hover:bg-theme-neutral-50';
                              return (
                                <tr key={a.id} className={rowClass}>
                                  <td className="px-3 py-2 font-mono text-theme-neutral-700 max-w-[200px] truncate">{a.raw_name}</td>
                                  <td className="px-3 py-2 font-mono text-theme-neutral-500">
                                    {a.canonical_slug ?? <span className="text-theme-flag-low italic">unmapped</span>}
                                  </td>
                                  <td className="px-3 py-2"><StatusPill status={a.parse_status} /></td>
                                  <td className="px-3 py-2 text-theme-neutral-400">
                                    {a.parse_status === 'mapped' ? 'synonym' : a.parse_status === 'partial' ? 'slug' : '—'}
                                  </td>
                                  <td className="px-3 py-2">
                                    {a.is_core
                                      ? <CheckCircle className="w-3.5 h-3.5 text-theme-flag-ok" />
                                      : <span className="text-theme-neutral-300">—</span>}
                                  </td>
                                  <td className="px-3 py-2">
                                    {!isExcluded
                                      ? <span className="text-theme-neutral-300">—</span>
                                      : <span className="font-mono text-theme-neutral-400 italic">{excludedReason}</span>}
                                  </td>
                                  <td className="px-3 py-2">
                                    {a.needs_review
                                      ? <AlertTriangle className="w-3.5 h-3.5 text-theme-flag-watch" />
                                      : <span className="text-theme-neutral-300">—</span>}
                                  </td>
                                </tr>
                              );
                            })}
                            {visibleRows.length === 0 && (
                              <tr>
                                <td colSpan={7} className="px-3 py-6 text-center text-xs text-theme-neutral-400 font-sans">
                                  {showOnlyExcluded ? 'No excluded rows match the current filter.' : 'No rows.'}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {/* ─── STAGE 5: Stored report_analytes ─── */}
            {activeStage === 5 && (
              <div>
                <SectionHeader
                  icon={Database}
                  title="Stage 5 — Stored report_analytes Rows"
                  count={filteredAnalytes.length}
                  subtitle="The exact rows persisted in the database. Click Edit to correct values."
                />
                <div className="space-y-2">
                  {filteredAnalytes.map(a => (
                    <CollapsibleBlock
                      key={a.id}
                      label={`${a.raw_name}${a.canonical_slug ? ` → ${a.canonical_slug}` : ' (unmapped)'} | ${a.value_numeric ?? 'null'} ${a.unit ?? ''}`}
                      defaultOpen={a.needs_review}
                    >
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                          <MonoField label="raw_name" value={a.raw_name} />
                          <MonoField label="raw_value_text" value={a.raw_value_text} />
                          <MonoField label="value_numeric" value={a.value_numeric} highlight={a.value_numeric === null || a.value_numeric === 0} />
                          <MonoField label="unit" value={a.unit} highlight={!a.unit} />
                          <MonoField label="raw_reference_range" value={a.raw_reference_range} />
                          <MonoField label="normalized_min" value={a.normalized_min} />
                          <MonoField label="normalized_max" value={a.normalized_max} />
                          <MonoField label="normalized_operator" value={a.normalized_operator} />
                          <MonoField label="normalized_operator_value" value={a.normalized_operator_value} />
                          <MonoField label="canonical_slug" value={a.canonical_slug} />
                          <MonoField label="parse_status" value={a.parse_status} />
                          <MonoField label="confidence_score" value={a.confidence_score} />
                          <MonoField label="needs_review" value={String(a.needs_review)} />
                          <MonoField label="is_core" value={String(a.is_core)} />
                        </div>
                        {a.source_snippet && (
                          <div>
                            <p className="text-xs text-theme-neutral-500 mb-1">source_snippet:</p>
                            <pre className="text-xs font-mono bg-theme-neutral-50 border border-theme-neutral-100 rounded p-2 whitespace-pre-wrap break-all text-theme-neutral-600">{a.source_snippet}</pre>
                          </div>
                        )}
                        <div className="flex items-center gap-3 pt-2 border-t border-theme-neutral-100">
                          <button
                            onClick={() => setEditRow(a)}
                            className="px-3 py-1.5 text-xs bg-theme-neutral-800 text-white rounded-lg hover:bg-theme-neutral-700 transition-colors"
                          >
                            Edit row
                          </button>
                          <CopyButton text={JSON.stringify(a, null, 2)} />
                        </div>
                      </div>
                    </CollapsibleBlock>
                  ))}
                </div>
              </div>
            )}

            {/* ─── STAGE 6: AI Input Preview ─── */}
            {activeStage === 6 && (
              <div>
                <SectionHeader
                  icon={Cpu}
                  title="Stage 6 — AI Report Input Preview"
                  subtitle="Exactly what gets sent to generate-interpretation (max 20 items, prioritized)"
                />
                <div className="space-y-5">
                  {/* Included items */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-theme-neutral-800">
                        Included in AI prompt
                        <span className="ml-2 text-xs font-mono bg-theme-flag-ok-bg text-theme-flag-ok px-2 py-0.5 rounded">{aiInputItems.included.length}</span>
                      </h3>
                      <CopyButton text={JSON.stringify(aiInputItems.included.map(a => ({
                        raw_name: a.raw_name,
                        value: a.value_numeric,
                        unit: a.unit,
                        ref: a.raw_reference_range,
                        status: aiInputItems.classifyFn(a),
                      })), null, 2)} />
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-theme-neutral-200">
                      <table className="w-full text-xs">
                        <thead className="bg-theme-neutral-50 border-b border-theme-neutral-200">
                          <tr>
                            {['#','Name','Value','Unit','Reference range','Status','Core?'].map(h => (
                              <th key={h} className="text-left px-3 py-2.5 font-medium text-theme-neutral-600 whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-theme-neutral-100">
                          {aiInputItems.included.map((a, idx) => {
                            const status = aiInputItems.classifyFn(a);
                            return (
                              <tr key={a.id} className={
                                status === 'out_of_range' ? 'bg-theme-flag-low-bg' :
                                status === 'borderline' ? 'bg-theme-flag-watch-bg' : 'bg-white'
                              }>
                                <td className="px-3 py-2 text-theme-neutral-400">{idx + 1}</td>
                                <td className="px-3 py-2 font-mono text-theme-neutral-700">{a.raw_name}</td>
                                <td className="px-3 py-2 font-mono font-medium text-theme-neutral-800">{a.value_numeric ?? 'null'}</td>
                                <td className="px-3 py-2 text-theme-neutral-500">{a.unit ?? '—'}</td>
                                <td className="px-3 py-2 text-theme-neutral-500">{a.raw_reference_range ?? '—'}</td>
                                <td className="px-3 py-2">
                                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                    status === 'out_of_range' ? 'bg-theme-flag-low-bg text-theme-flag-low' :
                                    status === 'borderline' ? 'bg-theme-flag-watch-bg text-theme-flag-watch' :
                                    status === 'in_range' ? 'bg-theme-flag-ok-bg text-theme-flag-ok' :
                                    'bg-theme-neutral-100 text-theme-neutral-600'
                                  }`}>{status}</span>
                                </td>
                                <td className="px-3 py-2">
                                  {a.is_core ? <CheckCircle className="w-3.5 h-3.5 text-theme-flag-ok" /> : <span className="text-theme-neutral-300">—</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Excluded items */}
                  {aiInputItems.excluded.length > 0 && (
                    <CollapsibleBlock label={`Excluded from AI prompt (${aiInputItems.excluded.length} items over the 20-item cap)`}>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="border-b border-theme-neutral-100">
                            <tr>
                              {['Name','Value','Unit','Status'].map(h => (
                                <th key={h} className="text-left px-2 py-1.5 font-medium text-theme-neutral-500">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-theme-neutral-50">
                            {aiInputItems.excluded.map(a => (
                              <tr key={a.id} className="text-theme-neutral-500">
                                <td className="px-2 py-1.5 font-mono">{a.raw_name}</td>
                                <td className="px-2 py-1.5">{a.value_numeric ?? '—'}</td>
                                <td className="px-2 py-1.5">{a.unit ?? '—'}</td>
                                <td className="px-2 py-1.5">{aiInputItems.classifyFn(a)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CollapsibleBlock>
                  )}

                  {/* Needs-review items */}
                  {analytes.filter(a => a.needs_review).length > 0 && (
                    <CollapsibleBlock label={`Flagged for review — excluded from AI highlights (${analytes.filter(a => a.needs_review).length})`}>
                      <div className="space-y-1">
                        {analytes.filter(a => a.needs_review).map(a => (
                          <div key={a.id} className="flex items-center gap-3 text-xs py-1">
                            <AlertTriangle className="w-3.5 h-3.5 text-theme-flag-watch flex-shrink-0" />
                            <span className="font-mono text-theme-neutral-700">{a.raw_name}</span>
                            <span className="text-theme-neutral-400">= {a.value_numeric ?? 'null'} {a.unit ?? ''}</span>
                            <span className="text-theme-flag-low">{a.parse_status}</span>
                          </div>
                        ))}
                      </div>
                    </CollapsibleBlock>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit modal */}
      {editRow && (
        <EditAnalyteModal
          row={editRow}
          onSave={async (updated) => handleSaveAnalyte(editRow.id, updated)}
          onClose={() => setEditRow(null)}
        />
      )}
    </div>
  );
}
