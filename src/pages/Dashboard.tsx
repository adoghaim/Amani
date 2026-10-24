import { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from '../components/Button';
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
import { CalmNotice, UNREACHABLE_SAFE_LINE, UNREACHABLE_TITLE } from '../components/CalmNotice';
import { errorMessage } from '../lib/errors';
import { TodayCard } from '../components/TodayCard';
import { TrackerCalendar } from '../components/TrackerCalendar';
import { PeriodLogModal } from '../components/PeriodLogModal';
import { SymptomLogModal } from '../components/SymptomLogModal';
import { SubscriptionStatus } from '../components/SubscriptionStatus';
import { supabase } from '../lib/supabase';
import { fetchAllRows } from '../lib/fetchAllRows';
import { useAuth } from '../contexts/AuthContext';
import { useSubscription } from '../hooks/useSubscription';
import { resolveDashboardEntitlementView } from '../lib/dashboardEntitlement';
import type { LabReport, PeriodLog, Intervention, Biomarker, SymptomLog, FlowIntensity, DailySymptom } from '../types';
import {
  computeCyclePrediction,
  buildDayMap,
  dateToKey,
  toDateOnly,
} from '../utils/cyclePredictor';
import { getTrialDaysRemaining } from '../utils/subscription';
import { clientFreemiumActive } from '../lib/tier';
import { formatDate } from '../utils/formatters';
import { ReportCycleLine } from '../components/ReportCycleLine';
import { reportCycleLine } from '../lib/reportCycleLine';

type NoteModalState = { open: boolean; defaultDate: string };
type SymptomLogRow = Omit<SymptomLog, 'symptoms'> & { symptoms: unknown };

export function Dashboard() {
  const { user, userProfile } = useAuth();
  const { entitled, source, loading: subscriptionLoading } = useSubscription();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The reads failed (F065): shown as such, never as an empty account.
  const [loadFailed, setLoadFailed] = useState(false);
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
      setError(null);
      setLoadFailed(false);
      const [reportsRes, periodRes, symptomRes, interventionRes] = await Promise.all([
        supabase.from('lab_reports').select('*').eq('user_id', user.id).order('report_date', { ascending: false }),
        supabase.from('period_logs').select('*').eq('user_id', user.id).order('start_date', { ascending: false }),
        supabase.from('symptom_logs').select('*').eq('user_id', user.id).order('log_date', { ascending: false }),
        supabase.from('interventions').select('*').eq('user_id', user.id).order('start_date', { ascending: false }),
      ]);
      // A read that fails resolves with `error` (postgrest-js does not throw).
      // Offline, that used to become [] and the first-run "No lab reports yet".
      if ([reportsRes, periodRes, symptomRes, interventionRes].some(res => res.error)) {
        setLoadFailed(true);
        return;
      }

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
        // R27: a user's values across every report can pass PostgREST's 1,000-row cap.
        const { data: bm, error: bmError } = await fetchAllRows<Biomarker>(() =>
          supabase.from('biomarkers').select('*').in('lab_report_id', ids).order('id'));
        // Reports without their values would read as reports with nothing in them.
        if (bmError) {
          setLoadFailed(true);
          return;
        }
        if (bm) {
          const grouped = (bm as Biomarker[]).reduce<Record<string, Biomarker[]>>((acc, b) => {
            const bucket = acc[b.lab_report_id] ?? [];
            bucket.push(b);
            acc[b.lab_report_id] = bucket;
            return acc;
          }, {});
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
      setError(errorMessage(err, "Couldn't load your dashboard. Check your connection and try again."));
    } finally {
      setLoading(false);
    }
  };

  const prediction = useMemo(() => computeCyclePrediction(periodLogs, userProfile), [periodLogs, userProfile]);
  const today = toDateOnly(new Date());
  const lastPeriodLog = periodLogs[0] ?? null;
  const lastReport = reports[0] ?? null;

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
      setError(errorMessage(err, 'Failed to save period log.'));
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
      setError(errorMessage(err, 'Failed to save symptom log.'));
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
      setError(errorMessage(err, 'Failed to save note.'));
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

  /*
    See SubscriptionStatus.tsx: `users.subscription_status` is never written, so
    the old `=== 'active'` check was permanently false and this CTA was disabled
    for every paying subscriber once their 7 days elapsed. `entitled` is the
    Stripe / StoreKit / Play / trial union the server also uses.

    `subscriptionLoading` matters as much as `entitled`: the hook reports
    `entitled: false` until its query settles, which is indistinguishable from
    having no subscription. See lib/dashboardEntitlement.ts.
  */
  const trialDaysRemaining = getTrialDaysRemaining(userProfile);
  const { canCreateReport, showTrialEndedNotice, showUpsell, showTrialCountdown } =
    resolveDashboardEntitlementView({
      subscriptionLoading,
      entitled,
      source,
      trialDaysRemaining,
      freemiumActive: clientFreemiumActive(),
    });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'processing': return <Clock className="w-4 h-4 text-theme-flag-watch" />;
      case 'ready': return <CheckCircle className="w-4 h-4 text-theme-flag-ok" />;
      case 'error': return <XCircle className="w-4 h-4 text-theme-flag-low" />;
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

  if (loadFailed) {
    return (
      <Layout>
        <div className="max-w-5xl mx-auto">
          <CalmNotice
            title={UNREACHABLE_TITLE}
            safe={UNREACHABLE_SAFE_LINE}
            action={{ label: 'Try again', onClick: () => { void fetchData(); } }}
          />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        {error && (
          <div className="mb-5 px-4 py-3 rounded-xl bg-theme-flag-low-bg border border-theme-flag-low-border flex items-start justify-between gap-3">
            <div className="text-sm text-theme-flag-low flex-1">{error}</div>
            <button
              onClick={() => setError(null)}
              className="text-sm font-medium text-theme-flag-low underline hover:no-underline whitespace-nowrap"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="mb-5">
          <SubscriptionStatus />
        </div>

        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl">Dashboard</h1>
            <p className="text-sm text-theme-muted-text-2 mt-1">Where you are, and what your last panel said.</p>
          </div>
          <Link to="/app/new">
            <Button size="md" disabled={!canCreateReport} className="gap-2">
              <Plus className="w-4 h-4" />
              New panel
            </Button>
          </Link>
        </div>

        {/*
          One notice, not four.

          These were four independent blocks that could all render at once —
          pricing promo, trial countdown, trial-expired warning and the context
          nudge — pushing the actual dashboard below the fold behind a stack of
          banners. They are now prioritised, and only the most urgent shows.
          Someone whose trial has expired does not need to be told how many days
          are left in it.
        */}
        {(() => {
          if (showTrialEndedNotice) {
            return (
              <Notice tone="watch">
                <p className="text-sm text-theme-flag-watch">
                  Your trial has ended.{' '}
                  <Link to="/app/pricing" className="underline font-medium hover:no-underline">
                    See pricing
                  </Link>{' '}
                  to keep uploading panels.
                </p>
              </Notice>
            );
          }

          if (showTrialCountdown) {
            return (
              <Notice>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base mb-0.5">Keep your timeline intact</h3>
                    <p className="text-sm text-theme-muted-text-2">
                      <span className="font-mono tabular-nums">{trialDaysRemaining}</span>
                      {trialDaysRemaining === 1 ? ' day' : ' days'} left in your trial.
                    </p>
                  </div>
                  <Link to="/app/billing">
                    <Button size="sm">Continue</Button>
                  </Link>
                </div>
              </Notice>
            );
          }

          if (showContextNudge) {
            return (
              <Notice>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-base mb-0.5">Add context to your labs</h3>
                    <p className="text-sm text-theme-muted-text-2 mb-3">
                      Tracking even one change helps explain future results.
                    </p>
                    <div className="flex flex-wrap gap-2.5">
                      <Button size="sm" onClick={openStartPeriod}>Add cycle start</Button>
                      <Link to="/app/tracker">
                        <Button size="sm" variant="secondary">Add intervention</Button>
                      </Link>
                    </div>
                  </div>
                  <button
                    onClick={() => { sessionStorage.setItem('contextNudgeDismissed', 'true'); setShowContextNudge(false); }}
                    aria-label="Dismiss"
                    className="shrink-0 w-11 h-11 -mr-2 -mt-2 flex items-center justify-center rounded-lg text-theme-muted-text hover:bg-theme-surface-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-primary"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </Notice>
            );
          }

          if (showUpsell) {
            return (
              <Link to="/app/pricing" className="block mb-5 group">
                <div className="flex flex-wrap items-center justify-between gap-3 bg-theme-surface border border-theme-border rounded-xl px-5 py-4 transition-colors group-hover:border-theme-primary">
                  <p className="text-sm text-theme-text">
                    <span className="font-mono tabular-nums">$9.99</span> a month, or{' '}
                    <span className="font-mono tabular-nums">$99.99</span> a year
                  </p>
                  <span className="text-sm font-medium text-theme-primary shrink-0">See pricing &rarr;</span>
                </div>
              </Link>
            );
          }

          return null;
        })()}

        <div className="space-y-5">
          <TodayCard
            prediction={prediction}
            lastReport={lastReport}
            activeInterventions={activeInterventions}
            lastPeriodLog={lastPeriodLog}
            periodLogs={periodLogs}
            symptomLogsThisCycle={symptomLogsThisCycle}
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

          <div className="bg-theme-surface rounded-2xl border border-theme-border shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-theme-border">
              <h3 className="text-sm text-theme-text">Quick log</h3>
            </div>
            <div className="px-5 py-4">
              <div className="flex flex-wrap gap-2">
                <QuickLogButton icon={<Droplets className="w-4 h-4" />} label="Period start" onClick={openStartPeriod} emphasis />
                <QuickLogButton icon={<Droplets className="w-4 h-4 opacity-60" />} label="Period end" onClick={openEndPeriod} />
                <QuickLogButton icon={<Plus className="w-4 h-4" />} label="Add symptom" onClick={openAddSymptom} />
                <QuickLogButton
                  icon={<StickyNote className="w-4 h-4" />}
                  label="Add note"
                  onClick={() => setNoteModal({ open: true, defaultDate: dateToKey(today) })}
                />
                <QuickLogButton icon={<Upload className="w-4 h-4" />} label="Upload labs" onClick={() => navigate('/app/new')} />
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base text-theme-text">Recent lab reports</h2>
              <Link to="/app/reports" className="flex items-center gap-1 text-sm text-theme-primary hover:text-theme-primary-dark font-medium transition-colors">
                View all <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            {reports.length === 0 ? (
              <div className="bg-theme-surface rounded-2xl border border-theme-border shadow-sm px-5 py-12 text-center">
                <TestTube2 className="w-12 h-12 text-theme-primary-faded mx-auto mb-3" />
                <h3 className="text-base text-theme-text mb-1">No lab reports yet</h3>
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
                    <div className="bg-theme-surface rounded-2xl border border-theme-border shadow-sm px-5 py-4 hover:shadow-md hover:border-theme-primary/40 transition-all cursor-pointer border-l-4 border-l-theme-primary">
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
                              {/* D10: the report's cycle day first; any phase labelled as an estimate. */}
                              {reportCycleLine(report) && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <ReportCycleLine report={report} />
                                </>
                              )}
                            </div>
                            {(() => {
                              const reportBiomarkers = biomarkersByReport[report.id];
                              return reportBiomarkers ? (
                                <div className="text-xs text-theme-muted-text-3 mt-1.5">
                                  {reportBiomarkers.length} biomarkers
                                </div>
                              ) : null;
                            })()}
                          </div>
                        </div>
                        <ArrowRight className="w-4 h-4 text-theme-muted-text-3 mt-0.5" />
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
          <div className="bg-theme-surface rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-theme-border">
              <h2 className="text-base text-theme-text">Add note</h2>
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
                  className="w-full px-3 py-2 text-sm border border-theme-border rounded-lg focus:outline-none focus:ring-2 focus:ring-theme-primary/30 focus:border-theme-primary text-theme-text resize-none placeholder:text-theme-muted-text-3"
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
  icon, label, onClick, emphasis = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  /** The most likely next action gets the filled treatment. At most one. */
  emphasis?: boolean;
}) {
  /*
    These were five different colours — flag-low, flag-watch, flag-ok and two
    more — which meant "Upload labs" was green and "Add symptom" was amber. The
    three status tokens are reserved for whether a result is in range; using
    them as button decoration told the user a panel upload was "good" and
    logging a symptom was a "warning". They are all just actions, so they all
    look like actions.
  */
  return (
    <button
      onClick={onClick}
      className={[
        'inline-flex items-center gap-2 px-4 min-h-[44px] rounded-xl text-sm font-medium',
        'transition-all duration-150 active:scale-[0.98] motion-reduce:active:scale-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-primary focus-visible:ring-offset-2 focus-visible:ring-offset-theme-surface',
        emphasis
          ? 'bg-theme-primary text-white hover:bg-theme-primary-dark'
          : 'bg-theme-surface-2 text-theme-text hover:bg-theme-surface-hover border border-theme-border',
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  );
}

/** A single dashboard notice. Neutral by default; `watch` for the one case
 *  that is actually blocking — an ended trial. */
function Notice({ tone = 'neutral', children }: { tone?: 'neutral' | 'watch'; children: React.ReactNode }) {
  return (
    <div
      className={[
        'mb-5 rounded-2xl border px-5 py-4',
        tone === 'watch'
          ? 'bg-theme-flag-watch-bg border-theme-flag-watch-border'
          : 'bg-theme-surface border-theme-border',
      ].join(' ')}
    >
      {children}
    </div>
  );
}
