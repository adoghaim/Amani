import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Layout } from '../components/Layout';
import { Calendar } from '../components/Calendar';
import { LabsTimeline } from '../components/LabsTimeline';
import { Interventions } from '../components/Interventions';
import { CompareView } from '../components/CompareView';
import { InsightsModal } from '../components/InsightsModal';
import { Loading } from '../components/Loading';
import { LabReport, Biomarker, CycleEvent, Intervention } from '../types';

export function Tracker() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<LabReport[]>([]);
  const [biomarkersByReport, setBiomarkersByReport] = useState<Record<string, Biomarker[]>>({});
  const [cycleEvents, setCycleEvents] = useState<CycleEvent[]>([]);
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [showInsightsModal, setShowInsightsModal] = useState(false);
  const [insightsData, setInsightsData] = useState<any>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    if (!user) return;

    try {
      setLoading(true);

      const [reportsResult, eventsResult, interventionsResult] = await Promise.all([
        supabase
          .from('lab_reports')
          .select('*')
          .eq('user_id', user.id)
          .order('report_date', { ascending: false }),
        supabase
          .from('cycle_events')
          .select('*')
          .eq('user_id', user.id)
          .order('event_date', { ascending: false }),
        supabase
          .from('interventions')
          .select('*')
          .eq('user_id', user.id)
          .order('start_date', { ascending: false }),
      ]);

      if (reportsResult.error) throw reportsResult.error;
      if (eventsResult.error) throw eventsResult.error;
      if (interventionsResult.error) throw interventionsResult.error;

      const fetchedReports = reportsResult.data as LabReport[];
      setReports(fetchedReports);
      setCycleEvents(eventsResult.data as CycleEvent[]);
      setInterventions(interventionsResult.data as Intervention[]);

      if (fetchedReports.length > 0) {
        const reportIds = fetchedReports.map((r) => r.id);
        const { data: biomarkersData, error: biomarkersError } = await supabase
          .from('biomarkers')
          .select('*')
          .in('lab_report_id', reportIds);

        if (biomarkersError) throw biomarkersError;

        const grouped = (biomarkersData as Biomarker[]).reduce((acc, biomarker) => {
          if (!acc[biomarker.lab_report_id]) {
            acc[biomarker.lab_report_id] = [];
          }
          acc[biomarker.lab_report_id].push(biomarker);
          return acc;
        }, {} as Record<string, Biomarker[]>);

        setBiomarkersByReport(grouped);
      }
    } catch (error) {
      console.error('Error fetching tracker data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDateClick = async (date: string) => {
    const periodStartEvent = cycleEvents.find(
      (e) => e.event_date === date && e.event_type === 'period_start'
    );
    const periodEndEvent = cycleEvents.find(
      (e) => e.event_date === date && e.event_type === 'period_end'
    );

    const existingEvents = [];
    if (periodStartEvent) existingEvents.push('Period Start');
    if (periodEndEvent) existingEvents.push('Period End');

    let message = '';
    if (existingEvents.length > 0) {
      message = `This date has: ${existingEvents.join(', ')}\n\nWhat would you like to do?`;
      const options = ['Add Period Start', 'Add Period End'];
      if (periodStartEvent) options.push('Remove Period Start');
      if (periodEndEvent) options.push('Remove Period End');
      options.push('Cancel');

      const choice = prompt(message + '\n\nEnter:\n1 - Add Period Start\n2 - Add Period End' +
        (periodStartEvent ? '\n3 - Remove Period Start' : '') +
        (periodEndEvent ? '\n' + (periodStartEvent ? '4' : '3') + ' - Remove Period End' : '') +
        '\n' + (periodStartEvent && periodEndEvent ? '5' : periodStartEvent || periodEndEvent ? '4' : '3') + ' - Cancel');

      if (!choice) return;

      const num = parseInt(choice);
      if (num === 1) {
        if (!periodStartEvent) await addPeriodEvent(date, 'period_start');
      } else if (num === 2) {
        if (!periodEndEvent) await addPeriodEvent(date, 'period_end');
      } else if (periodStartEvent && num === 3) {
        await deletePeriodEvent(periodStartEvent.id);
      } else if (periodEndEvent && num === (periodStartEvent ? 4 : 3)) {
        await deletePeriodEvent(periodEndEvent.id);
      }
    } else {
      const choice = prompt('Add a period marker:\n\n1 - Period Start\n2 - Period End\n3 - Cancel');
      if (!choice) return;

      const num = parseInt(choice);
      if (num === 1) {
        await addPeriodEvent(date, 'period_start');
      } else if (num === 2) {
        await addPeriodEvent(date, 'period_end');
      }
    }
  };

  const addPeriodEvent = async (date: string, eventType: 'period_start' | 'period_end') => {
    if (!user) return;

    try {
      const { error } = await supabase.from('cycle_events').insert({
        user_id: user.id,
        event_date: date,
        event_type: eventType,
      });

      if (error) throw error;
      await fetchData();
    } catch (error) {
      console.error('Error adding period event:', error);
      alert(`Failed to add ${eventType === 'period_start' ? 'period start' : 'period end'} marker. Please try again.`);
    }
  };

  const deletePeriodEvent = async (eventId: string) => {
    try {
      const { error } = await supabase.from('cycle_events').delete().eq('id', eventId);

      if (error) throw error;
      await fetchData();
    } catch (error) {
      console.error('Error deleting period event:', error);
      alert('Failed to remove period start marker. Please try again.');
    }
  };

  const handleAddIntervention = async (intervention: Omit<Intervention, 'id' | 'user_id' | 'created_at'>) => {
    if (!user) return;

    try {
      const { error } = await supabase.from('interventions').insert({
        user_id: user.id,
        ...intervention,
      });

      if (error) throw error;
      await fetchData();
    } catch (error) {
      console.error('Error adding intervention:', error);
      alert('Failed to add intervention. Please try again.');
    }
  };

  const handleUpdateIntervention = async (id: string, intervention: Partial<Intervention>) => {
    try {
      const { error } = await supabase
        .from('interventions')
        .update(intervention)
        .eq('id', id);

      if (error) throw error;
      await fetchData();
    } catch (error) {
      console.error('Error updating intervention:', error);
      alert('Failed to update intervention. Please try again.');
    }
  };

  const handleDeleteIntervention = async (id: string) => {
    try {
      const { error } = await supabase.from('interventions').delete().eq('id', id);

      if (error) throw error;
      await fetchData();
    } catch (error) {
      console.error('Error deleting intervention:', error);
      alert('Failed to delete intervention. Please try again.');
    }
  };

  const handleGenerateInsights = async (reportId: string, previousReportId: string | null) => {
    if (!user || !previousReportId) return;

    setShowInsightsModal(true);
    setInsightsLoading(true);
    setInsightsError(null);
    setInsightsData(null);

    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/lab-insights`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentReportId: reportId,
          previousReportId,
          userId: user.id,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate insights');
      }

      const data = await response.json();
      setInsightsData(data);
    } catch (error) {
      console.error('Error generating insights:', error);
      setInsightsError(error instanceof Error ? error.message : 'Failed to generate insights');
    } finally {
      setInsightsLoading(false);
    }
  };

  const calendarEvents = [
    ...reports.map((r) => ({
      date: r.report_date,
      type: 'lab' as const,
      label: r.lab_name || 'Lab report',
    })),
    ...cycleEvents
      .filter((e) => e.event_type === 'period_start')
      .map((e) => ({
        date: e.event_date,
        type: 'period_start' as const,
      })),
    ...cycleEvents
      .filter((e) => e.event_type === 'period_end')
      .map((e) => ({
        date: e.event_date,
        type: 'period_end' as const,
      })),
  ];

  if (loading) {
    return (
      <Layout>
        <Loading />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Tracker</h1>
          <p className="mt-2 text-gray-600">
            Track your lab results, interventions, and cycle over time
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
          <div className="lg:col-span-2">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Calendar</h2>
            <Calendar events={calendarEvents} onDateClick={handleDateClick} />
            <div className="mt-4 p-4 bg-theme-surface-2 rounded-lg border border-theme-border">
              <p className="text-sm text-theme-muted-text">
                Click any date to add or remove period markers (start and end). This helps you track your cycle
                alongside your lab results.
              </p>
            </div>
          </div>

          <div>
            <Interventions
              interventions={interventions}
              onAdd={handleAddIntervention}
              onUpdate={handleUpdateIntervention}
              onDelete={handleDeleteIntervention}
            />
          </div>
        </div>

        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Compare Labs</h2>
          <CompareView reports={reports} biomarkersByReport={biomarkersByReport} />
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Labs Timeline</h2>
          <div className="space-y-4">
            <LabsTimeline
              reports={reports}
              biomarkersByReport={biomarkersByReport}
              interventions={interventions}
              onGenerateInsights={handleGenerateInsights}
            />
          </div>
        </div>
      </div>

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
