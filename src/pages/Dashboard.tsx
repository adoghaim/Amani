import { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Droplets,
  Plus,
  Upload,
  FileText,
  StickyNote,
  ArrowRight,
  X,
  TestTube2,
  Clock,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { Loading } from '../components/Loading';
import { TodayCard } from '../components/TodayCard';
import { TrackerCalendar } from '../components/TrackerCalendar';
import { CycleSummary } from '../components/CycleSummary';
import { PeriodLogModal } from '../components/PeriodLogModal';
import { SymptomLogModal } from '../components/SymptomLogModal';
import { SubscriptionStatus } from '../components/SubscriptionStatus';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { LabReport, PeriodLog, Intervention, Biomarker, SymptomLog, FlowIntensity, DailySymptom } from '../types';
import {
  computeCyclePrediction,
  buildDayMap,
  dateToKey,
  toDateOnly,
} from '../utils/cyclePredictor';
import { isTrialActive, getTrialDaysRemaining } from '../utils/subscription';
import { formatDate } from '../utils/formatters';

type NoteModalState = { open: boolean; defaultDate: string };
type SymptomLogRow = Omit<SymptomLog, 'symptoms'> & { symptoms: unknown };

export function Dashboard() {
  const { user, userProfile } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<LabReport[]>([]);
  const [biomarkersByReport, setBiomarkersByReport] = useState<Record<string, Biomarker[]>>({});
  const [periodLogs, setPeriodLogs] = useState<PeriodLog[]>([]);
  const [symptomLogs, setSymptomLogs] = useState<SymptomLog[]>([]);
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [showContextNudge, setShowContextNudge] = useState(false);

  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [periodModalMode, setPeriodModalMode] = useState<'start' | 'end' | 'edit'>('start');
  const [activePeriodLog, setActivePeriodLog] = useState<PeriodLog | null>(null);
  const [periodModalDate, setPeriodModalDate] = useState<string | undefined>();

  const [symptomModalOpen, setSymptomModalOpen] = useState(false);
  const [symptomModalDate, setSymptomModalDate] = useState<string | undefined>();
  const [activeSymptomLog, setActiveSymptomLog] = useState<SymptomLog | null>(null);

  const [noteModal, setNoteModal] = useState<NoteModalState>({ open: false, defaultDate: '' });
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const [calendarMonth, setCalendarMonth] = useState(new Date());

  useEffect(() => {
    if (user) fetchData();
  }, [user]);

  const fetchData = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const [reportsRes, periodRes, symptomRes, interventionRes] = await Promise.all([
        supabase.from('lab_reports').select('*').eq('user_id', user.id).order('report_date', { ascending: false }),
        supabase.from('period_logs').select('*').eq('user_id', user.id).order('start_date', { ascending: false }),
        supabase.from('symptom_logs').select('*').eq('user_id', user.id).order('log_date', { ascending: false }),
        supabase.from('interventions').select('*').eq('user_id', user.id).order('start_date', { ascending: false }),
      ]);

      const fetchedReports = (!reportsRes.error && reportsRes.data) ? reportsRes.data as LabReport[] : [];
      setReports(fetchedReports);

      if (!periodRes.error && periodRes.data) setPeriodLogs(periodRes.data as PeriodLog[]);
      if (!symptomRes.error && symptomRes.data) {
        setSymptomLogs(
          (symptomRes.data as SymptomLogRow[]).map((r) => ({
            ...r,
            symptoms: Array.isArray(r.symptoms) ? r.symptoms : [],
          })) as SymptomLog[]
        );
      }
      if (!interventionRes.error && interventionRes.data) setInterventions(interventionRes.data as Intervention[]);

      if (fetchedReports.length > 0) {
        const ids = fetchedReports.map((r) => r.id);
        const { data: bm } = await supabase.from('biomarkers').select('*').in('lab_report_id', ids);
        if (bm) {
          const grouped = (bm as Biomarker[]).reduce((acc, b) => {
            if (!acc[b.lab_report_id]) acc[b.lab_report_id] = [];
            acc[b.lab_report_id].push(b);
            return acc;
          }, {} as Record<string, Biomarker[]>);
          setBiomarkersByReport(grouped);
        }
      }

      const hasPeriodLogs = (periodRes.data as PeriodLog[])?.length > 0;
      const hasInterventions = (interventionRes.data as Intervention[])?.length > 0;
      if (fetchedReports.length >= 1 && !hasInterventions && !hasPeriodLogs) {
        const nudgeDismissed = sessionStorage.getItem('contextNudgeDismissed');
        setShowContextNudge(!nudgeDismissed);
      }
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const prediction = useMemo(() => computeCyclePrediction(periodLogs, userProfile), [periodLogs, userProfile]);
  const today = toDateOnly(new Date());
  const lastPeriodLog = periodLogs.length > 0 ? periodLogs[0] : null;
  const lastReport = reports.length > 0 ? reports[0] : null;

  const activeInterventions = useMemo(() => {
    const todayKey = dateToKey(today);
    return interventions.filter((iv) => iv.start_date <= todayKey && (!iv.end_date || iv.end_date >= todayKey));
  }, [interventions, today]);

  const symptomLogsThisCycle = useMemo(() => {
    if (!lastPeriodLog) return symptomLogs;
    return symptomLogs.filter((s) => s.log_date >= lastPeriodLog.start_date);
  }, [symptomLogs, lastPeriodLog]);

  const labDateSet = useMemo(() => new Set(reports.map((r) => r.report_date)), [reports]);
  const symptomDateSet = useMemo(() => new Set(symptomLogs.map((s) => s.log_date)), [symptomLogs]);

  const interventionActiveDateSet = useMemo(() => {
    const set = new Set<string>();
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const key = dateToKey(new Date(year, month, d));
      for (const iv of interventions) {
        if (iv.start_date <= key && (!iv.end_date || iv.end_date >= key)) { set.add(key); break; }
      }
    }
    return set;
  }, [interventions, calendarMonth]);

  const dayMap = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    return buildDayMap(year, month, periodLogs, prediction, labDateSet, symptomDateSet, interventionActiveDateSet);
  }, [calendarMonth, periodLogs, prediction, labDateSet, symptomDateSet, interventionActiveDateSet]);

  const handleDayClick = (dateKey: string) => {
    const info = dayMap.get(dateKey);
    if (!info) return;

    if (info.hasSymptom) {
      const existing = symptomLogs.find((s) => s.log_date === dateKey) || null;
      setActiveSymptomLog(existing);
      setSymptomModalDate(dateKey);
      setSymptomModalOpen(true);
      return;
    }

    if (info.states.includes('confirmed_period')) {
      const log = periodLogs.find((p) => p.start_date <= dateKey && (!p.end_date || p.end_date >= dateKey)) || null;
      if (log) {
        setActivePeriodLog(log);
        setPeriodModalMode('edit');
        setPeriodModalDate(dateKey);
        setPeriodModalOpen(true);
        return;
      }
    }

    setSymptomModalDate(dateKey);
    setActiveSymptomLog(null);
    setSymptomModalOpen(true);
  };

  const handleSavePeriodLog = async (data: {
    start_date: string;
    end_date: string | null;
    flow_intensity: FlowIntensity | null;
    notes: string;
  }) => {
    if (!user) return;
    try {
      if (periodModalMode === 'edit' && activePeriodLog) {
        const { error } = await supabase.from('period_logs').update({
          start_date: data.start_date,
          end_date: data.end_date,
          flow_intensity: data.flow_intensity,
          notes: data.notes || null,
          updated_at: new Date().toISOString(),
        }).eq('id', activePeriodLog.id);
        if (error) throw error;
      } else if (periodModalMode === 'end' && activePeriodLog) {
        const { error } = await supabase.from('period_logs').update({
          end_date: data.end_date,
          flow_intensity: data.flow_intensity,
          notes: data.notes || null,
          updated_at: new Date().toISOString(),
        }).eq('id', activePeriodLog.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('period_logs').insert({
          user_id: user.id,
          start_date: data.start_date,
          end_date: data.end_date,
          flow_intensity: data.flow_intensity,
          notes: data.notes || null,
        });
        if (error) throw error;
      }
      await fetchData();
    } catch (err) {
      console.error('Error saving period log:', err);
    }
  };

  const handleSaveSymptomLog = async (logDate: string, symptoms: DailySymptom[], notes: string) => {
    if (!user) return;
    try {
      const { error } = await supabase.from('symptom_logs').upsert(
        { user_id: user.id, log_date: logDate, symptoms, notes: notes || null, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,log_date' }
      );
      if (error) throw error;
      await fetchData();
    } catch (err) {
      console.error('Error saving symptom log:', err);
    }
  };

  const handleSaveNote = async () => {
    if (!user || !noteText.trim()) return;
    setSavingNote(true);
    try {
      await supabase.from('cycle_events').insert({
        user_id: user.id,
        event_date: noteModal.defaultDate || dateToKey(today),
        event_type: 'note',
        notes: noteText.trim(),
      });
      setNoteText('');
      setNoteModal({ open: false, defaultDate: '' });
    } catch (err) {
      console.error('Error saving note:', err);
    } finally {
      setSavingNote(false);
    }
  };

  const openStartPeriod = () => {
    setActivePeriodLog(null);
    setPeriodModalMode('start');
    setPeriodModalDate(dateToKey(today));
    setPeriodModalOpen(true);
  };

  const openEndPeriod = () => {
    if (lastPeriodLog && !lastPeriodLog.end_date) {
      setActivePeriodLog(lastPeriodLog);
      setPeriodModalMode('end');
      setPeriodModalDate(dateToKey(today));
    } else {
      setActivePeriodLog(null);
      setPeriodModalMode('start');
      setPeriodModalDate(dateToKey(today));
    }
    setPeriodModalOpen(true);
  };

  const openAddSymptom = () => {
    setActiveSymptomLog(null);
    setSymptomModalDate(dateToKey(today));
    setSymptomModalOpen(true);
  };

  const canCreateReport = userProfile?.subscription_status === 'active' || isTrialActive(userProfile);
  const trialDaysRemaining = getTrialDaysRemaining(userProfile);
  const showTrialBanner = trialDaysRemaining !== null && trialDaysRemaining <= 3;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'processing': return <Clock className="w-4 h-4 text-yellow-600" />;
      case 'ready': return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'error': return <XCircle className="w-4 h-4 text-red-600" />;
      default: return null;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'processing': return 'Processing';
      case 'ready': return 'Ready';
      case 'error': return 'Error';
      default: return status;
    }
  };

  if (loading) {
    return <Layout><Loading /></Layout>;
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <div className="mb-5">
          <SubscriptionStatus />
        </div>

        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-theme-text">Dashboard</h1>
            <p className="text-sm text-theme-muted-text mt-0.5">Your health overview at a glance</p>
          </div>
          <Link to="/app/new">
            <button
              disabled={!canCreateReport}
              className="flex items-center gap-2 px-4 py-2 bg-theme-primary text-white text-sm font-medium rounded-xl hover:bg-theme-primary-dark transition-colors disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              New lab report
            </button>
          </Link>
        </div>

        {userProfile?.subscription_status !== 'active' && (
          <Link to="/app/pricing" className="block mb-5">
            <div className="flex items-center justify-between gap-4 bg-white border border-theme-border rounded-xl px-5 py-4 hover:border-theme-primary hover:shadow-sm transition-all">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wide shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block"></span>
                  Founders Launch
                </span>
                <span className="text-sm text-theme-text font-medium">
                  <span className="text-theme-muted-text-4 line-through mr-1.5">$19.99/mo</span>
                  $9.99/mo &nbsp;&middot;&nbsp;
                  <span className="text-theme-muted-text-4 line-through mr-1.5">$199.99/yr</span>
                  $99.99/yr
                </span>
              </div>
              <span className="text-sm font-medium text-theme-primary shrink-0">View pricing &rarr;</span>
            </div>
          </Link>
        )}

        {showTrialBanner && (
          <div className="mb-5 bg-gradient-to-r from-theme-surface-2 to-theme-background-tint border border-theme-border rounded-2xl px-5 py-4">
            <h3 className="text-base font-semibold text-theme-text mb-1">Keep your health timeline intact</h3>
            <p className="text-sm text-theme-muted-text mb-3">
              {trialDaysRemaining === 1 ? '1 day' : `${trialDaysRemaining} days`} left in your trial.
            </p>
            <Link to="/app/billing">
              <button className="px-4 py-2 bg-theme-primary text-white text-sm font-medium rounded-xl hover:bg-theme-primary-dark transition-colors">
                Continue tracking
              </button>
            </Link>
          </div>
        )}

        {!canCreateReport && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-5 py-4 mb-5">
            <p className="text-sm text-yellow-800">
              Your trial has expired.{' '}
              <Link to="/app/pricing" className="text-yellow-900 underline font-medium">View pricing</Link> to continue.
            </p>
          </div>
        )}

        {showContextNudge && (
          <div className="mb-5 bg-gradient-to-r from-theme-surface-2 to-theme-background-tint border border-theme-border rounded-2xl px-5 py-4 flex items-start justify-between gap-4">
            <div className="flex-1">
              <h3 className="text-base font-semibold text-theme-text mb-1">Add context to your labs</h3>
              <p className="text-sm text-theme-muted-text mb-3">Tracking even one change helps explain future results.</p>
              <div className="flex gap-3">
                <button
                  onClick={openStartPeriod}
                  className="px-3 py-1.5 bg-theme-primary text-white text-sm font-medium rounded-xl hover:bg-theme-primary-dark transition-colors"
                >
                  Add cycle start
                </button>
                <Link to="/app/tracker">
                  <button className="px-3 py-1.5 bg-theme-surface-2 text-theme-muted-text text-sm font-medium rounded-xl border border-theme-border hover:bg-theme-surface-hover transition-colors">
                    Add intervention
                  </button>
                </Link>
              </div>
            </div>
            <button
              onClick={() => { sessionStorage.setItem('contextNudgeDismissed', 'true'); setShowContextNudge(false); }}
              aria-label="Dismiss"
              className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-theme-surface-2 transition-colors"
            >
              <X className="w-4 h-4 text-theme-muted-text" />
            </button>
          </div>
        )}

        <div className="space-y-5">
          <TodayCard
            prediction={prediction}
            lastReport={lastReport}
            activeInterventions={activeInterventions}
            lastPeriodLog={lastPeriodLog}
            onLogPeriod={openStartPeriod}
            onAddSymptom={openAddSymptom}
            onUploadLabs={() => navigate('/app/new')}
          />

          <TrackerCalendar
            dayMap={dayMap}
            onDayClick={handleDayClick}
            currentMonth={calendarMonth}
            onMonthChange={setCalendarMonth}
          />

          <div className="bg-white rounded-2xl border border-theme-border shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-theme-border">
              <h3 className="text-sm font-semibold text-theme-text">Quick log</h3>
            </div>
            <div className="px-5 py-4">
              <div className="flex flex-wrap gap-2">
                <QuickLogButton icon={<Droplets className="w-4 h-4" />} label="Period start" onClick={openStartPeriod} variant="rose" />
                <QuickLogButton icon={<Droplets className="w-4 h-4 opacity-60" />} label="Period end" onClick={openEndPeriod} variant="rose-light" />
                <QuickLogButton icon={<Plus className="w-4 h-4" />} label="Add symptom" onClick={openAddSymptom} variant="amber" />
                <QuickLogButton
                  icon={<StickyNote className="w-4 h-4" />}
                  label="Add note"
                  onClick={() => setNoteModal({ open: true, defaultDate: dateToKey(today) })}
                  variant="neutral"
                />
                <QuickLogButton icon={<Upload className="w-4 h-4" />} label="Upload labs" onClick={() => navigate('/app/new')} variant="teal" />
              </div>
            </div>
          </div>

          <CycleSummary
            lastPeriodLog={lastPeriodLog}
            periodLogs={periodLogs}
            lastReport={lastReport}
            activeInterventions={activeInterventions}
            symptomLogsThisCycle={symptomLogsThisCycle}
            prediction={prediction}
          />

          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-theme-text">Recent Lab Reports</h2>
              <Link to="/app/reports" className="flex items-center gap-1 text-sm text-theme-primary hover:text-theme-primary-dark font-medium transition-colors">
                View all <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            {reports.length === 0 ? (
              <div className="bg-white rounded-2xl border border-theme-border shadow-sm px-5 py-12 text-center">
                <TestTube2 className="w-12 h-12 text-theme-primary-faded mx-auto mb-3" />
                <h3 className="text-base font-semibold text-theme-text mb-1">No lab reports yet</h3>
                <p className="text-sm text-theme-muted-text mb-4">Upload your first lab report to get started.</p>
                {canCreateReport && (
                  <Link to="/app/new">
                    <button className="inline-flex items-center gap-2 px-4 py-2 bg-theme-primary text-white text-sm font-medium rounded-xl hover:bg-theme-primary-dark transition-colors">
                      <Plus className="w-4 h-4" />
                      New lab report
                    </button>
                  </Link>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {reports.slice(0, 6).map((report) => (
                  <Link key={report.id} to={`/app/reports/${report.id}`} className="block">
                    <div className="bg-white rounded-2xl border border-theme-border shadow-sm px-5 py-4 hover:shadow-md hover:border-theme-primary/40 transition-all cursor-pointer border-l-4 border-l-theme-primary">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3 flex-1">
                          <div className="bg-theme-surface-2 p-2 rounded-lg">
                            <FileText className="w-4 h-4 text-theme-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-theme-text text-sm">{formatDate(report.report_date)}</div>
                            <div className="text-xs text-theme-muted-text flex items-center gap-2 mt-1 flex-wrap">
                              {getStatusIcon(report.status)}
                              <span>{getStatusText(report.status)}</span>
                              {report.estimated_cycle_phase !== 'unknown' && (
                                <>
                                  <span>·</span>
                                  <span className="capitalize">{report.estimated_cycle_phase}</span>
                                </>
                              )}
                            </div>
                            {biomarkersByReport[report.id] && (
                              <div className="text-xs text-theme-muted-text-4 mt-1.5">
                                {biomarkersByReport[report.id].length} biomarkers
                              </div>
                            )}
                          </div>
                        </div>
                        <ArrowRight className="w-4 h-4 text-theme-muted-text-4 mt-0.5" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {reports.length > 6 && (
              <div className="mt-3 text-center">
                <Link to="/app/reports" className="text-sm text-theme-primary hover:text-theme-primary-dark font-medium transition-colors">
                  View all {reports.length} lab reports
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      <PeriodLogModal
        isOpen={periodModalOpen}
        mode={periodModalMode}
        onClose={() => setPeriodModalOpen(false)}
        onSave={handleSavePeriodLog}
        existingLog={activePeriodLog}
        defaultDate={periodModalDate}
      />

      <SymptomLogModal
        isOpen={symptomModalOpen}
        onClose={() => setSymptomModalOpen(false)}
        onSave={handleSaveSymptomLog}
        existingLog={activeSymptomLog}
        defaultDate={symptomModalDate}
      />

      {noteModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-theme-border">
              <h2 className="text-base font-semibold text-theme-text">Add note</h2>
              <button
                onClick={() => setNoteModal({ open: false, defaultDate: '' })}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-theme-surface-2 transition-colors"
              >
                <X className="w-4 h-4 text-theme-muted-text" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-theme-muted-text mb-1.5">Date</label>
                <input
                  type="date"
                  value={noteModal.defaultDate}
                  onChange={(e) => setNoteModal((prev) => ({ ...prev, defaultDate: e.target.value }))}
                  max={dateToKey(today)}
                  className="w-full px-3 py-2 text-sm border border-theme-border rounded-lg focus:outline-none focus:ring-2 focus:ring-theme-primary/30 focus:border-theme-primary text-theme-text"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-theme-muted-text mb-1.5">Note</label>
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  rows={4}
                  placeholder="Write a note..."
                  className="w-full px-3 py-2 text-sm border border-theme-border rounded-lg focus:outline-none focus:ring-2 focus:ring-theme-primary/30 focus:border-theme-primary text-theme-text resize-none placeholder:text-theme-muted-text-4"
                />
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-3">
              <button
                onClick={handleSaveNote}
                disabled={savingNote || !noteText.trim()}
                className="flex-1 py-2.5 bg-theme-primary text-white text-sm font-medium rounded-xl hover:bg-theme-primary-dark transition-colors disabled:opacity-50"
              >
                {savingNote ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => setNoteModal({ open: false, defaultDate: '' })}
                className="flex-1 py-2.5 bg-theme-surface-2 text-theme-muted-text text-sm font-medium rounded-xl hover:bg-theme-surface-hover transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

function QuickLogButton({
  icon, label, onClick, variant,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant: 'rose' | 'rose-light' | 'amber' | 'teal' | 'neutral';
}) {
  const classes = {
    rose: 'bg-rose-500 text-white hover:bg-rose-600',
    'rose-light': 'bg-rose-100 text-rose-600 hover:bg-rose-200 border border-dashed border-rose-300',
    amber: 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200',
    teal: 'bg-teal-50 text-teal-700 hover:bg-teal-100 border border-teal-200',
    neutral: 'bg-theme-surface-2 text-theme-muted-text hover:bg-theme-surface-hover border border-theme-border',
  };
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-150 ${classes[variant]}`}
    >
      {icon}
      {label}
    </button>
  );
}
