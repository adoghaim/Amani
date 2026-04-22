import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Droplets,
  Plus,
  Upload,
  FileText,
  StickyNote,
  Bell,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Layout } from '../components/Layout';
import { Loading } from '../components/Loading';
import { TodayCard } from '../components/TodayCard';
import { TrackerCalendar } from '../components/TrackerCalendar';
import { CycleSummary } from '../components/CycleSummary';
import { PeriodLogModal } from '../components/PeriodLogModal';
import { SymptomLogModal } from '../components/SymptomLogModal';
import { InsightsModal } from '../components/InsightsModal';
import { Interventions } from '../components/Interventions';
import { CompareView } from '../components/CompareView';
import { LabsTimeline } from '../components/LabsTimeline';
import {
  LabReport,
  Biomarker,
  Intervention,
  PeriodLog,
  SymptomLog,
  FlowIntensity,
  DailySymptom,
} from '../types';
import {
  computeCyclePrediction,
  buildDayMap,
  dateToKey,
  toDateOnly,
} from '../utils/cyclePredictor';

type ActiveTab = 'tracker' | 'labs' | 'interventions';

type NoteModalState = {
  open: boolean;
  defaultDate: string;
};

export function Tracker() {
  const { user, userProfile } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>('tracker');

  const [reports, setReports] = useState<LabReport[]>([]);
  const [biomarkersByReport, setBiomarkersByReport] = useState<Record<string, Biomarker[]>>({});
  const [periodLogs, setPeriodLogs] = useState<PeriodLog[]>([]);
  const [symptomLogs, setSymptomLogs] = useState<SymptomLog[]>([]);
  const [interventions, setInterventions] = useState<Intervention[]>([]);

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

  const [showInsightsModal, setShowInsightsModal] = useState(false);
  const [insightsData, setInsightsData] = useState<any>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  useEffect(() => {
    if (user) fetchData();
  }, [user]);

  const fetchData = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const [reportsRes, periodRes, symptomRes, interventionRes] = await Promise.all([
        supabase
          .from('lab_reports')
          .select('*')
          .eq('user_id', user.id)
          .order('report_date', { ascending: false }),
        supabase
          .from('period_logs')
          .select('*')
          .eq('user_id', user.id)
          .order('start_date', { ascending: false }),
        supabase
          .from('symptom_logs')
          .select('*')
          .eq('user_id', user.id)
          .order('log_date', { ascending: false }),
        supabase
          .from('interventions')
          .select('*')
          .eq('user_id', user.id)
          .order('start_date', { ascending: false }),
      ]);

      if (reportsRes.error) throw reportsRes.error;
      if (periodRes.error) throw periodRes.error;
      if (symptomRes.error) throw symptomRes.error;
      if (interventionRes.error) throw interventionRes.error;

      const fetchedReports = reportsRes.data as LabReport[];
      setReports(fetchedReports);
      setPeriodLogs(periodRes.data as PeriodLog[]);
      setSymptomLogs(
        (symptomRes.data as any[]).map((r) => ({
          ...r,
          symptoms: Array.isArray(r.symptoms) ? r.symptoms : [],
        })) as SymptomLog[]
      );
      setInterventions(interventionRes.data as Intervention[]);

      if (fetchedReports.length > 0) {
        const ids = fetchedReports.map((r) => r.id);
        const { data: bm } = await supabase
          .from('biomarkers')
          .select('*')
          .in('lab_report_id', ids);
        if (bm) {
          const grouped = (bm as Biomarker[]).reduce((acc, b) => {
            if (!acc[b.lab_report_id]) acc[b.lab_report_id] = [];
            acc[b.lab_report_id].push(b);
            return acc;
          }, {} as Record<string, Biomarker[]>);
          setBiomarkersByReport(grouped);
        }
      }
    } catch (err) {
      console.error('Error fetching tracker data:', err);
    } finally {
      setLoading(false);
    }
  };

  const prediction = useMemo(
    () => computeCyclePrediction(periodLogs, userProfile),
    [periodLogs, userProfile]
  );

  const today = toDateOnly(new Date());
  const lastPeriodLog = periodLogs.length > 0 ? periodLogs[0] : null;
  const lastReport = reports.length > 0 ? reports[0] : null;

  const activeInterventions = useMemo(() => {
    const todayKey = dateToKey(today);
    return interventions.filter((iv) => {
      const started = iv.start_date <= todayKey;
      const notEnded = !iv.end_date || iv.end_date >= todayKey;
      return started && notEnded;
    });
  }, [interventions, today]);

  const symptomLogsThisCycle = useMemo(() => {
    if (!lastPeriodLog) return symptomLogs;
    const cycleStart = lastPeriodLog.start_date;
    return symptomLogs.filter((s) => s.log_date >= cycleStart);
  }, [symptomLogs, lastPeriodLog]);

  const labDateSet = useMemo(
    () => new Set(reports.map((r) => r.report_date)),
    [reports]
  );

  const symptomDateSet = useMemo(
    () => new Set(symptomLogs.map((s) => s.log_date)),
    [symptomLogs]
  );

  const interventionActiveDateSet = useMemo(() => {
    const set = new Set<string>();
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const key = dateToKey(new Date(year, month, d));
      for (const iv of interventions) {
        if (iv.start_date <= key && (!iv.end_date || iv.end_date >= key)) {
          set.add(key);
          break;
        }
      }
    }
    return set;
  }, [interventions, calendarMonth]);

  const dayMap = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    return buildDayMap(
      year,
      month,
      periodLogs,
      prediction,
      labDateSet,
      symptomDateSet,
      interventionActiveDateSet
    );
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
      const log = periodLogs.find(
        (p) =>
          p.start_date <= dateKey &&
          (!p.end_date || p.end_date >= dateKey)
      ) || null;
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
        const { error } = await supabase
          .from('period_logs')
          .update({
            start_date: data.start_date,
            end_date: data.end_date,
            flow_intensity: data.flow_intensity,
            notes: data.notes || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', activePeriodLog.id);
        if (error) throw error;
      } else if (periodModalMode === 'end' && activePeriodLog) {
        const { error } = await supabase
          .from('period_logs')
          .update({
            end_date: data.end_date,
            flow_intensity: data.flow_intensity,
            notes: data.notes || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', activePeriodLog.id);
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

  const handleSaveSymptomLog = async (
    logDate: string,
    symptoms: DailySymptom[],
    notes: string
  ) => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('symptom_logs')
        .upsert(
          {
            user_id: user.id,
            log_date: logDate,
            symptoms: symptoms,
            notes: notes || null,
            updated_at: new Date().toISOString(),
          },
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
      await fetchData();
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

  const handleGenerateInsights = async (reportId: string, previousReportId: string | null) => {
    if (!user || !previousReportId) return;
    setShowInsightsModal(true);
    setInsightsLoading(true);
    setInsightsError(null);
    setInsightsData(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setInsightsError('Session expired. Please log in again.');
        setInsightsLoading(false);
        return;
      }
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/lab-insights`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ currentReportId: reportId, previousReportId }),
      });
      if (!res.ok) throw new Error('Failed to generate insights');
      const data = await res.json();
      setInsightsData(data);
    } catch (err) {
      setInsightsError(err instanceof Error ? err.message : 'Failed to generate insights');
    } finally {
      setInsightsLoading(false);
    }
  };

  const handleAddIntervention = async (
    intervention: Omit<Intervention, 'id' | 'user_id' | 'created_at'>
  ) => {
    if (!user) return;
    const { error } = await supabase
      .from('interventions')
      .insert({ user_id: user.id, ...intervention });
    if (!error) await fetchData();
  };

  const handleUpdateIntervention = async (id: string, data: Partial<Intervention>) => {
    const { error } = await supabase.from('interventions').update(data).eq('id', id);
    if (!error) await fetchData();
  };

  const handleDeleteIntervention = async (id: string) => {
    const { error } = await supabase.from('interventions').delete().eq('id', id);
    if (!error) await fetchData();
  };

  if (loading) {
    return (
      <Layout>
        <Loading />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#2A1F23]">Tracker</h1>
            <p className="text-sm text-[#6B5B60] mt-0.5">
              Your cycle, labs, and interventions in one view
            </p>
          </div>
          <button
            onClick={() => navigate('/app/settings')}
            className="w-9 h-9 flex items-center justify-center rounded-xl border border-[#E9D6DA] hover:bg-[#F6ECEB] transition-colors"
            title="Notification preferences"
          >
            <Bell className="w-4 h-4 text-[#6B5B60]" />
          </button>
        </div>

        <div className="flex gap-1 mb-6 p-1 bg-[#F6ECEB] rounded-xl">
          {(['tracker', 'labs', 'interventions'] as ActiveTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg capitalize transition-all duration-150 ${
                activeTab === tab
                  ? 'bg-white text-[#2A1F23] shadow-sm'
                  : 'text-[#6B5B60] hover:text-[#2A1F23]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'tracker' && (
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

            <div className="bg-white rounded-2xl border border-[#E9D6DA] shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-[#E9D6DA]">
                <h3 className="text-sm font-semibold text-[#2A1F23]">Quick log</h3>
              </div>
              <div className="px-5 py-4">
                <div className="flex flex-wrap gap-2">
                  <QuickLogButton
                    icon={<Droplets className="w-4 h-4" />}
                    label="Period start"
                    onClick={openStartPeriod}
                    variant="rose"
                  />
                  <QuickLogButton
                    icon={<Droplets className="w-4 h-4 opacity-60" />}
                    label="Period end"
                    onClick={openEndPeriod}
                    variant="rose-light"
                  />
                  <QuickLogButton
                    icon={<Plus className="w-4 h-4" />}
                    label="Add symptom"
                    onClick={openAddSymptom}
                    variant="amber"
                  />
                  <QuickLogButton
                    icon={<StickyNote className="w-4 h-4" />}
                    label="Add note"
                    onClick={() =>
                      setNoteModal({ open: true, defaultDate: dateToKey(today) })
                    }
                    variant="neutral"
                  />
                  <QuickLogButton
                    icon={<Upload className="w-4 h-4" />}
                    label="Upload labs"
                    onClick={() => navigate('/app/new')}
                    variant="teal"
                  />
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
          </div>
        )}

        {activeTab === 'labs' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-semibold text-[#2A1F23] mb-4">Compare Labs</h2>
              <CompareView reports={reports} biomarkersByReport={biomarkersByReport} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#2A1F23] mb-4">Labs Timeline</h2>
              <LabsTimeline
                reports={reports}
                biomarkersByReport={biomarkersByReport}
                interventions={interventions}
                onGenerateInsights={handleGenerateInsights}
              />
            </div>
          </div>
        )}

        {activeTab === 'interventions' && (
          <Interventions
            interventions={interventions}
            onAdd={handleAddIntervention}
            onUpdate={handleUpdateIntervention}
            onDelete={handleDeleteIntervention}
          />
        )}
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
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E9D6DA]">
              <h2 className="text-base font-semibold text-[#2A1F23]">Add note</h2>
              <button
                onClick={() => setNoteModal({ open: false, defaultDate: '' })}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#F6ECEB] transition-colors"
              >
                <FileText className="w-4 h-4 text-[#6B5B60]" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#6B5B60] mb-1.5">Date</label>
                <input
                  type="date"
                  value={noteModal.defaultDate}
                  onChange={(e) =>
                    setNoteModal((prev) => ({ ...prev, defaultDate: e.target.value }))
                  }
                  max={dateToKey(today)}
                  className="w-full px-3 py-2 text-sm border border-[#E9D6DA] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C97C8B]/30 focus:border-[#C97C8B] text-[#2A1F23]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B5B60] mb-1.5">Note</label>
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  rows={4}
                  placeholder="Write a note..."
                  className="w-full px-3 py-2 text-sm border border-[#E9D6DA] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C97C8B]/30 focus:border-[#C97C8B] text-[#2A1F23] resize-none placeholder:text-[#A8969C]"
                />
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-3">
              <button
                onClick={handleSaveNote}
                disabled={savingNote || !noteText.trim()}
                className="flex-1 py-2.5 bg-[#C97C8B] text-white text-sm font-medium rounded-xl hover:bg-[#A85C6D] transition-colors disabled:opacity-50"
              >
                {savingNote ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => setNoteModal({ open: false, defaultDate: '' })}
                className="flex-1 py-2.5 bg-[#F6ECEB] text-[#6B5B60] text-sm font-medium rounded-xl hover:bg-[#EED9D9] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <InsightsModal
        isOpen={showInsightsModal}
        onClose={() => setShowInsightsModal(false)}
        insights={insightsData?.insights || null}
        reportDates={insightsData?.report_dates}
        loading={insightsLoading}
        error={insightsError || undefined}
      />
    </Layout>
  );
}

function QuickLogButton({
  icon,
  label,
  onClick,
  variant,
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
    neutral: 'bg-[#F6ECEB] text-[#6B5B60] hover:bg-[#EED9D9] border border-[#E9D6DA]',
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
